"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";

import { useAuth } from "@/app/providers";
import { getFirestoreDb } from "@/lib/firebase";

type Folder = {
  id: string;
  name: string;
  createdAt?: any;
  createdBy?: string;
  deletedAt?: any | null;
};

type DocItem = {
  id: string;
  name: string;
  folderId: string | null;
  url: string;
  size: number;
  contentType: string;
  createdAt?: any;
  createdBy?: string;
  deletedAt?: any | null;
};

type BookingApprovalLite = {
  id: string;
  roomId: string;
  studentUid: string;
  status: "requested" | "approved" | "rejected" | "expired";
};

const CLOUDINARY_CLOUD_NAME = "dojxtuept";
const CLOUDINARY_UPLOAD_PRESET = "Upload_img_attendance";

function cloudinaryForceDownloadUrl(url: string) {
  if (!url) return url;
  if (url.includes("/raw/upload/")) return url;
  if (!url.includes("/image/upload/") && !url.includes("/video/upload/")) return url;
  const marker = "/upload/";
  const idx = url.indexOf(marker);
  if (idx === -1) return url;
  const before = url.slice(0, idx + marker.length);
  const after = url.slice(idx + marker.length);
  if (after.startsWith("fl_attachment/")) return url;
  return `${before}fl_attachment/${after}`;
}

function isLikelyRawFile(file: File) {
  const name = (file?.name || "").toLowerCase();
  if (file?.type === "application/pdf") return true;
  if (file?.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return true;
  if (name.endsWith(".pdf") || name.endsWith(".doc") || name.endsWith(".docx")) return true;
  return false;
}

async function downloadViaBlob(url: string, fileName: string) {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) {
    const err: any = new Error(`Download failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = fileName || "download";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(objUrl);
  }
}

function fmtBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const fixed = i === 0 ? 0 : i === 1 ? 0 : 1;
  return `${v.toFixed(fixed)} ${units[i]}`;
}

function fmtDate(ts: any) {
  try {
    const d = ts?.toDate ? ts.toDate() : ts?.seconds ? new Date(ts.seconds * 1000) : null;
    if (!d) return "—";
    return d.toLocaleDateString();
  } catch {
    return "—";
  }
}

function fileTypeLabel(contentType: string, fileName: string) {
  const lower = (fileName || "").toLowerCase();
  if (contentType === "application/pdf" || lower.endsWith(".pdf")) return "PDF Document";
  if (
    contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lower.endsWith(".docx") ||
    lower.endsWith(".doc")
  ) {
    return "Word Document";
  }
  if (contentType === "image/png" || lower.endsWith(".png")) return "PNG Image";
  if (contentType === "image/jpeg" || lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "JPG Image";
  if (contentType === "image/webp" || lower.endsWith(".webp")) return "WEBP Image";
  return "Document";
}

function fileKind(contentType: string, fileName: string): "pdf" | "word" | "image" | "other" {
  const lower = (fileName || "").toLowerCase();
  if (contentType === "application/pdf" || lower.endsWith(".pdf")) return "pdf";
  if (
    contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lower.endsWith(".docx") ||
    lower.endsWith(".doc")
  ) {
    return "word";
  }
  if (contentType.startsWith("image/") || lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".webp")) {
    return "image";
  }
  return "other";
}

export default function RoomDocumentsPage() {
  const router = useRouter();
  const params = useParams();
  const { user, loading } = useAuth();

  const roomId = typeof params?.roomId === "string" ? params.roomId : null;

  const [memberRole, setMemberRole] = useState<"owner" | "student" | null>(null);
  const isOwner = memberRole === "owner";

  const [approvedLoaded, setApprovedLoaded] = useState(false);
  const [isApprovedStudent, setIsApprovedStudent] = useState(false);

  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [roomName, setRoomName] = useState<string>("");

  const [folders, setFolders] = useState<Folder[]>([]);
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");

  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);

  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [createFolderName, setCreateFolderName] = useState("");
  const [createFolderSubmitting, setCreateFolderSubmitting] = useState(false);

  const [confirmDeleteFolderOpen, setConfirmDeleteFolderOpen] = useState(false);
  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState<Folder | null>(null);
  const [deleteFolderSubmitting, setDeleteFolderSubmitting] = useState(false);

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmDeleteDoc, setConfirmDeleteDoc] = useState<DocItem | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const [uploadSubmitting, setUploadSubmitting] = useState(false);

  const [centerNotice, setCenterNotice] = useState<
    | null
    | {
        id: string;
        title: string;
        message: string;
        primaryLabel?: string;
        onPrimary?: () => void;
        autoHideMs?: number;
      }
  >(null);

  const [toasts, setToasts] = useState<Array<{ id: string; type: "success" | "error"; message: string }>>([]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const hasAnyData = folders.length > 0 || docs.length > 0;

  useEffect(() => {
    if (!loading && !user) {
      const next = roomId ? `/rooms/${encodeURIComponent(roomId)}/documents` : "/rooms";
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [loading, user, router, roomId]);

  useEffect(() => {
    async function loadRoleAndRoom() {
      if (!user || !roomId) return;
      try {
        const db = getFirestoreDb();
        const roomSnap = await getDoc(doc(db, "rooms", roomId));
        const data = roomSnap.exists() ? (roomSnap.data() as any) : null;
        const ownerId = typeof data?.ownerId === "string" ? data.ownerId : "";
        const name = typeof data?.name === "string" ? data.name : "";
        setRoomName(name);
        setMemberRole(ownerId === user.uid ? "owner" : "student");
      } catch (e) {
        console.error("Load room/role failed", e);
        setRoomName("");
        setMemberRole(null);
      }
    }

    loadRoleAndRoom();
  }, [user, roomId]);

  useEffect(() => {
    if (!user || !roomId) return;
    if (isOwner) {
      setApprovedLoaded(true);
      setIsApprovedStudent(true);
      return;
    }

    setApprovedLoaded(false);
    setIsApprovedStudent(false);

    const db = getFirestoreDb();
    const unsub = onSnapshot(
      query(
        collection(db, "bookings"),
        where("studentUid", "==", user.uid),
        where("roomId", "==", roomId),
        where("status", "==", "approved")
      ),
      (snap) => {
        const list: BookingApprovalLite[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            roomId: typeof data?.roomId === "string" ? data.roomId : roomId,
            studentUid: typeof data?.studentUid === "string" ? data.studentUid : user.uid,
            status: (data?.status || "requested") as any,
          };
        });
        setIsApprovedStudent(list.length > 0);
        setApprovedLoaded(true);
      },
      (e) => {
        console.error("Approved bookings snapshot failed", e);
        setIsApprovedStudent(false);
        setApprovedLoaded(true);
      }
    );
    return () => unsub();
  }, [user, roomId, isOwner]);

  const canAccess = isOwner || (memberRole === "student" && approvedLoaded && isApprovedStudent);

  useEffect(() => {
    if (!user || !roomId) return;
    if (!canAccess) {
      setFolders([]);
      setDocs([]);
      setLoadingData(false);
      setError(null);
      return;
    }

    const db = getFirestoreDb();
    setLoadingData(true);
    setError(null);

    let foldersReady = false;
    let docsReady = false;
    function maybeDone() {
      if (foldersReady && docsReady) setLoadingData(false);
    }

    const foldersUnsub = onSnapshot(
      query(collection(db, `rooms/${roomId}/folders`), where("deletedAt", "==", null)),
      (snap) => {
        const folderItems: Folder[] = snap.docs
          .map((d) => {
            const data = d.data() as any;
            return {
              id: d.id,
              name: typeof data?.name === "string" ? data.name : "(No name)",
              createdAt: data?.createdAt,
              createdBy: typeof data?.createdBy === "string" ? data.createdBy : undefined,
              deletedAt: data?.deletedAt ?? null,
            };
          })
          .sort((a, b) => {
            const aT = a.createdAt?.seconds ? Number(a.createdAt.seconds) : 0;
            const bT = b.createdAt?.seconds ? Number(b.createdAt.seconds) : 0;
            return bT - aT;
          });

        setFolders(folderItems);

        setActiveFolderId((cur) => {
          if (!cur) return cur;
          return folderItems.some((f) => f.id === cur) ? cur : null;
        });

        foldersReady = true;
        maybeDone();
      },
      (e) => {
        console.error("Folders snapshot failed", e);
        setError("Không thể tải tài liệu.");
        foldersReady = true;
        maybeDone();
      }
    );

    const docsUnsub = onSnapshot(
      query(collection(db, `rooms/${roomId}/documents`), where("deletedAt", "==", null)),
      (snap) => {
        const docItems: DocItem[] = snap.docs
          .map((d) => {
            const data = d.data() as any;
            return {
              id: d.id,
              name: typeof data?.name === "string" ? data.name : "(No name)",
              folderId: typeof data?.folderId === "string" ? data.folderId : null,
              url: typeof data?.url === "string" ? data.url : "",
              size: typeof data?.size === "number" ? data.size : 0,
              contentType: typeof data?.contentType === "string" ? data.contentType : "",
              createdAt: data?.createdAt,
              createdBy: typeof data?.createdBy === "string" ? data.createdBy : undefined,
              deletedAt: data?.deletedAt ?? null,
            };
          })
          .sort((a, b) => {
            const aT = a.createdAt?.seconds ? Number(a.createdAt.seconds) : 0;
            const bT = b.createdAt?.seconds ? Number(b.createdAt.seconds) : 0;
            return bT - aT;
          });
        setDocs(docItems);
        docsReady = true;
        maybeDone();
      },
      (e) => {
        console.error("Documents snapshot failed", e);
        setError("Không thể tải tài liệu.");
        docsReady = true;
        maybeDone();
      }
    );

    return () => {
      foldersUnsub();
      docsUnsub();
    };
  }, [user, roomId, canAccess]);

  const folderNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of folders) m.set(f.id, f.name);
    return m;
  }, [folders]);

  const filteredDocs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return docs.filter((d) => {
      if (activeFolderId) {
        if (d.folderId !== activeFolderId) return false;
      }
      if (q) {
        const hay = `${d.name} ${folderNameById.get(d.folderId ?? "") ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [docs, search, folderNameById, activeFolderId]);

  const filteredFolders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return folders;
    return folders.filter((f) => f.name.toLowerCase().includes(q));
  }, [folders, search]);

  const folderStatsById = useMemo(() => {
    const m = new Map<string, { fileCount: number; totalSize: number }>();
    for (const f of folders) m.set(f.id, { fileCount: 0, totalSize: 0 });
    for (const d of docs) {
      if (!d.folderId) continue;
      const cur = m.get(d.folderId) ?? { fileCount: 0, totalSize: 0 };
      cur.fileCount += 1;
      cur.totalSize += d.size || 0;
      m.set(d.folderId, cur);
    }
    return m;
  }, [folders, docs]);

  function pushToast(type: "success" | "error", message: string) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((prev) => [...prev, { id, type, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }

  function showCenterNotice(next: {
    title: string;
    message: string;
    primaryLabel?: string;
    onPrimary?: () => void;
    autoHideMs?: number;
  }) {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setCenterNotice({ id, ...next });
    if (typeof next.autoHideMs === "number") {
      window.setTimeout(() => {
        setCenterNotice((cur) => (cur?.id === id ? null : cur));
      }, next.autoHideMs);
    }

    return id;
  }

  function onCreateFolder() {
    if (!user || !roomId) return;
    if (!isOwner) return;
    setCreateFolderName("");
    setCreateFolderOpen(true);
  }

  async function onSubmitCreateFolder() {
    if (!user || !roomId) return;
    if (!isOwner) return;
    const name = createFolderName.trim();
    if (!name) {
      pushToast("error", "Vui lòng nhập tên folder.");
      return;
    }

    try {
      setCreateFolderSubmitting(true);
      const db = getFirestoreDb();
      await addDoc(collection(db, `rooms/${roomId}/folders`), {
        name,
        createdAt: serverTimestamp(),
        createdBy: user.uid,
        deletedAt: null,
      });
      setCreateFolderOpen(false);
      showCenterNotice({
        title: "Thành công",
        message: "Tạo folder thành công.",
        autoHideMs: 1000,
      });
    } catch (e) {
      console.error("Create folder failed", e);
      pushToast("error", "Tạo folder thất bại.");
    } finally {
      setCreateFolderSubmitting(false);
    }
  }

  function validateFile(file: File) {
    const maxBytes = 10 * 1024 * 1024;
    if (file.size > maxBytes) return "File quá lớn (tối đa 10MB).";
    const allow = new Set([
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "image/png",
      "image/jpeg",
      "image/webp",
    ]);
    if (!allow.has(file.type)) return "Định dạng file không được hỗ trợ.";
    return null;
  }

  async function onPickUpload() {
    if (!isOwner) return;
    fileInputRef.current?.click();
  }

  async function onUploadFile(file: File) {
    if (!user || !roomId) return;
    if (!isOwner) return;

    const err = validateFile(file);
    if (err) {
      pushToast("error", err);
      return;
    }

    setError(null);

    try {
      setUploadSubmitting(true);
      const uploadingNoticeId = showCenterNotice({
        title: "Đang upload...",
        message: "Vui lòng chờ trong giây lát.",
      });
      const db = getFirestoreDb();

      const resource = isLikelyRawFile(file) ? "raw" : "image";
      const cloudinaryEndpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(
        CLOUDINARY_CLOUD_NAME
      )}/${resource}/upload`;
      const fd = new FormData();
      fd.append("file", file);
      fd.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
      const res = await fetch(cloudinaryEndpoint, { method: "POST", body: fd });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Cloudinary upload failed: ${res.status} ${t}`);
      }

      const json = (await res.json()) as any;
      const secureUrl = typeof json?.secure_url === "string" ? json.secure_url : "";
      if (!secureUrl) throw new Error("Cloudinary response missing secure_url");

      await addDoc(collection(db, `rooms/${roomId}/documents`), {
        name: file.name,
        folderId: activeFolderId ?? null,
        url: secureUrl,
        size: typeof json?.bytes === "number" ? json.bytes : file.size,
        contentType: file.type,
        createdAt: serverTimestamp(),
        createdBy: user.uid,
        deletedAt: null,
      });

      setCenterNotice((cur) => (cur?.id === uploadingNoticeId ? null : cur));
      showCenterNotice({
        title: "Thành công",
        message: "Upload file thành công.",
        autoHideMs: 1000,
      });
    } catch (e) {
      console.error("Upload file failed", e);
      const msg = typeof (e as any)?.message === "string" ? String((e as any).message) : "Upload thất bại.";
      pushToast("error", msg.length > 160 ? `${msg.slice(0, 160)}...` : msg);
    } finally {
      setUploadSubmitting(false);
    }
  }

  async function onDownload(d: DocItem) {
    try {
      if (!d.url) {
        showCenterNotice({
          title: "Chưa thể tải file",
          message: "File chưa có đường dẫn tải. Vui lòng upload lại hoặc kiểm tra kết nối.",
          autoHideMs: 6000,
        });
        return;
      }

      const isLegacyPdfOnImage = d.url.includes("/image/upload/") && d.name.toLowerCase().endsWith(".pdf");
      if (isLegacyPdfOnImage) {
        showCenterNotice({
          title: "File PDF bị lỗi",
          message: "PDF này đã upload sai định dạng (image). Vui lòng upload lại để tải được.",
          autoHideMs: 7000,
        });
        return;
      }

      const forced = cloudinaryForceDownloadUrl(d.url);
      try {
        await downloadViaBlob(forced, d.name);
      } catch (e) {
        const status = typeof (e as any)?.status === "number" ? Number((e as any).status) : null;
        if (status === 401) {
          showCenterNotice({
            title: "Không có quyền tải file (401)",
            message:
              "Cloudinary đang chặn truy cập link này. Hãy vào Cloudinary -> Settings -> Upload -> Upload presets -> preset đang dùng và đảm bảo Delivery type / Access mode là Public (upload), không phải private/authenticated. Sau đó upload lại file.",
            autoHideMs: 9000,
          });
          return;
        }

        console.error("Blob download failed, falling back", e);
        window.open(forced, "_blank", "noopener,noreferrer");
      }
    } catch (e) {
      console.error("Download failed", e);
      pushToast("error", "Không thể tải file.");
    }
  }

  function onRequestDelete(d: DocItem) {
    if (!user || !roomId) return;
    if (!isOwner) return;
    setConfirmDeleteDoc(d);
    setConfirmDeleteOpen(true);
  }

  async function onConfirmDelete() {
    if (!user || !roomId) return;
    if (!isOwner) return;
    if (!confirmDeleteDoc) return;
    const d = confirmDeleteDoc;

    try {
      setDeleteSubmitting(true);
      const db = getFirestoreDb();
      await updateDoc(doc(db, `rooms/${roomId}/documents`, d.id), {
        deletedAt: serverTimestamp(),
      });

      setConfirmDeleteOpen(false);
      setConfirmDeleteDoc(null);
      showCenterNotice({
        title: "Thành công",
        message: "Đã xóa tài liệu.",
        autoHideMs: 1000,
      });
    } catch (e) {
      console.error("Delete doc failed", e);
      pushToast("error", "Xóa thất bại.");
    } finally {
      setDeleteSubmitting(false);
    }
  }

  function onRequestDeleteFolder(f: Folder) {
    if (!user || !roomId) return;
    if (!isOwner) return;
    setConfirmDeleteFolder(f);
    setConfirmDeleteFolderOpen(true);
  }

  async function onConfirmDeleteFolder() {
    if (!user || !roomId) return;
    if (!isOwner) return;
    if (!confirmDeleteFolder) return;
    const f = confirmDeleteFolder;

    try {
      setDeleteFolderSubmitting(true);
      const db = getFirestoreDb();

      await updateDoc(doc(db, `rooms/${roomId}/folders`, f.id), {
        deletedAt: serverTimestamp(),
      });

      const affected = docs.filter((d) => d.folderId === f.id);
      await Promise.all(
        affected.map((d) =>
          updateDoc(doc(db, `rooms/${roomId}/documents`, d.id), {
            folderId: null,
          })
        )
      );

      setConfirmDeleteFolderOpen(false);
      setConfirmDeleteFolder(null);
      setActiveFolderId((cur) => (cur === f.id ? null : cur));
      showCenterNotice({
        title: "Thành công",
        message: "Đã xóa folder.",
        autoHideMs: 1000,
      });
    } catch (e) {
      console.error("Delete folder failed", e);
      pushToast("error", "Xóa folder thất bại.");
    } finally {
      setDeleteFolderSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <div className="text-sm font-medium text-zinc-600">Loading...</div>
      </div>
    );
  }

  if (!user) return null;

  if (memberRole === "student" && approvedLoaded && !isApprovedStudent) {
    return (
      <div className="min-h-dvh bg-white">
        <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col items-center justify-center px-6 text-center">
          <div className="text-xl font-bold text-zinc-900">Tài khoản đang chờ duyệt</div>
          <div className="mt-2 text-sm font-medium text-zinc-600">
            Bạn cần được giáo viên duyệt tham gia lớp trước khi xem tài liệu.
          </div>
          <button
            type="button"
            className="mt-6 inline-flex h-11 items-center justify-center rounded-2xl border border-zinc-200 bg-white px-6 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
            onClick={() => router.push(`/rooms/${encodeURIComponent(roomId ?? "")}/calendar`)}
          >
            Quay lại
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-white">
      <div className="flex min-h-dvh">
        <div className="fixed right-6 top-6 z-[120] space-y-2">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={
                t.type === "success"
                  ? "w-[320px] rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 shadow"
                  : "w-[320px] rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800 shadow"
              }
            >
              {t.message}
            </div>
          ))}
        </div>

        {centerNotice ? (
          <div className="pointer-events-none fixed left-1/2 top-[260px] z-[125] w-[92vw] max-w-lg -translate-x-1/2">
            <div className="pointer-events-auto rounded-2xl border border-zinc-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-zinc-900">{centerNotice.title}</div>
                  <div className="mt-1 text-sm font-medium text-zinc-600">{centerNotice.message}</div>
                </div>
                <button
                  type="button"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100"
                  onClick={() => setCenterNotice(null)}
                  aria-label="Close"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M18 6L6 18" />
                    <path d="M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {centerNotice.primaryLabel ? (
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    className="inline-flex h-10 items-center justify-center rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
                    onClick={() => {
                      const fn = centerNotice.onPrimary;
                      setCenterNotice(null);
                      fn?.();
                    }}
                  >
                    {centerNotice.primaryLabel}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {sidebarOpen ? (
          <div className="fixed inset-0 z-[90] bg-black/40 md:hidden" onClick={() => setSidebarOpen(false)} />
        ) : null}

        <aside
          className={
            sidebarOpen
              ? "fixed left-0 top-0 z-[95] h-screen w-64 border-r border-zinc-200 bg-zinc-50/95 backdrop-blur md:hidden"
              : "hidden"
          }
        >
          <div className="px-4 py-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 rounded-lg px-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-sm font-semibold text-white">T</div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-zinc-900">Trang chủ</div>
                  <div className="truncate text-xs text-zinc-500">Tạo Lịch dạy của bạn</div>
                </div>
              </div>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg hover:bg-white"
                onClick={() => setSidebarOpen(false)}
                aria-label="Close menu"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 text-zinc-600" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M18 6L6 18" />
                  <path d="M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <nav className="flex h-[calc(100vh-96px)] flex-col px-3 pb-5">
            <div className="space-y-2">
              <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Tổng quan</div>

              <button
                type="button"
                onClick={() => {
                  if (!roomId) return;
                  setSidebarOpen(false);
                  router.push(`/rooms/${encodeURIComponent(roomId)}/calendar`);
                }}
                className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-zinc-700 hover:bg-white hover:text-zinc-900"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 flex-none text-zinc-500 group-hover:text-zinc-700" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M8 3v3" />
                  <path d="M16 3v3" />
                  <path d="M4 7h16" />
                  <path d="M6 5h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
                  <path d="M8 11h4" />
                  <path d="M8 15h3" />
                </svg>
                <span className="flex-1">Lịch</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (!roomId) return;
                  setSidebarOpen(false);
                  if (isOwner) {
                    router.push(`/rooms/${encodeURIComponent(roomId)}/attendance`);
                  } else {
                    router.push(`/rooms/${encodeURIComponent(roomId)}/attendance-stats`);
                  }
                }}
                className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-zinc-700 hover:bg-white hover:text-zinc-900"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 flex-none text-zinc-500 group-hover:text-zinc-700" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 11l3 3L22 4" />
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
                <span className="flex-1">{isOwner ? "Điểm danh" : "Thống kê điểm danh"}</span>
              </button>

              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="group flex w-full items-center gap-3 rounded-xl bg-blue-50 px-3 py-2.5 text-left text-sm font-semibold text-blue-700"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 flex-none text-blue-600" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 4h16v16H4z" />
                  <path d="M8 8h8" />
                  <path d="M8 12h8" />
                  <path d="M8 16h6" />
                </svg>
                <span className="flex-1">Tài liệu</span>
              </button>
            </div>

            <div className="mt-auto pt-4">
              <button
                type="button"
                onClick={() => {
                  setSidebarOpen(false);
                  router.push("/rooms");
                }}
                className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-zinc-700 hover:bg-white hover:text-zinc-900"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 flex-none text-zinc-500 group-hover:text-zinc-700" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                  <path d="M10 17l5-5-5-5" />
                  <path d="M15 12H3" />
                </svg>
                <span className="flex-1">Thoát</span>
              </button>
            </div>
          </nav>
        </aside>

        <aside className="hidden w-64 border-r border-zinc-200 bg-white md:fixed md:inset-y-0 md:left-0 md:block">
          <div className="px-4 py-5">
            <div className="flex items-center gap-2 rounded-lg px-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-sm font-semibold text-white">T</div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-zinc-900">Trang chủ</div>
                <div className="truncate text-xs text-zinc-500">Tạo Lịch dạy của bạn</div>
              </div>
            </div>
          </div>

          <nav className="flex h-[calc(100vh-96px)] flex-col px-3 pb-5">
            <div className="space-y-2">
              <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">Tổng quan</div>

              <button
                type="button"
                onClick={() => {
                  if (!roomId) return;
                  router.push(`/rooms/${encodeURIComponent(roomId)}/calendar`);
                }}
                className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-zinc-700 hover:bg-white hover:text-zinc-900"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 flex-none text-zinc-500 group-hover:text-zinc-700" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M8 3v3" />
                  <path d="M16 3v3" />
                  <path d="M4 7h16" />
                  <path d="M6 5h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
                  <path d="M8 11h4" />
                  <path d="M8 15h3" />
                </svg>
                <span className="flex-1">Lịch</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (!roomId) return;
                  if (isOwner) {
                    router.push(`/rooms/${encodeURIComponent(roomId)}/attendance`);
                  } else {
                    router.push(`/rooms/${encodeURIComponent(roomId)}/attendance-stats`);
                  }
                }}
                className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-zinc-700 hover:bg-white hover:text-zinc-900"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 flex-none text-zinc-500 group-hover:text-zinc-700" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 11l3 3L22 4" />
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
                <span className="flex-1">{isOwner ? "Điểm danh" : "Thống kê điểm danh"}</span>
              </button>

              <button
                type="button"
                className="group flex w-full items-center gap-3 rounded-xl bg-blue-50 px-3 py-2.5 text-left text-sm font-semibold text-blue-700"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 flex-none text-blue-600" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 4h16v16H4z" />
                  <path d="M8 8h8" />
                  <path d="M8 12h8" />
                  <path d="M8 16h6" />
                </svg>
                <span className="flex-1">Tài liệu</span>
              </button>
            </div>

            <div className="mt-auto pt-4">
              <button
                type="button"
                onClick={() => {
                  router.push("/rooms");
                }}
                className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold text-zinc-700 hover:bg-white hover:text-zinc-900"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 flex-none text-zinc-500 group-hover:text-zinc-700" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                  <path d="M10 17l5-5-5-5" />
                  <path d="M15 12H3" />
                </svg>
                <span className="flex-1">Thoát</span>
              </button>
            </div>
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col md:ml-64">
          <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white md:hidden">
            <div className="flex items-center justify-between px-4 py-3">
              <button
                type="button"
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                onClick={() => setSidebarOpen(true)}
                aria-label="Open menu"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M4 6h16" />
                  <path d="M4 12h16" />
                  <path d="M4 18h16" />
                </svg>
              </button>

              <div className="min-w-0 px-3 text-sm font-bold text-zinc-900">Tài liệu</div>

              <button
                type="button"
                className="inline-flex h-10 items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
                onClick={() => {
                  if (!roomId) return;
                  router.push(`/rooms/${encodeURIComponent(roomId)}/calendar`);
                }}
                disabled={!roomId}
              >
                Lịch
              </button>
            </div>
          </header>

          <main className="px-4 py-5 sm:px-8 sm:py-8">
            <div className="mx-auto w-full max-w-6xl">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="text-[26px] font-bold tracking-tight text-zinc-900">Upload Tài liệu</div>
                  <div className="mt-1 text-sm font-medium text-zinc-500">Quản lý và lưu trữ tài liệu học tập</div>
                </div>

                <div className="flex shrink-0 items-center gap-3 sm:pt-1">
                  {isOwner ? (
                    <>
                      <button
                        type="button"
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50"
                        onClick={onCreateFolder}
                        disabled={createFolderSubmitting || uploadSubmitting}
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M4 7a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
                        </svg>
                        New Folder
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
                        onClick={onPickUpload}
                        disabled={createFolderSubmitting || uploadSubmitting}
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M12 3v12" />
                          <path d="M8 7l4-4 4 4" />
                          <path d="M4 21h16" />
                        </svg>
                        Upload File
                      </button>
                    </>
                  ) : null}

                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      e.target.value = "";
                      if (!f) return;
                      onUploadFile(f);
                    }}
                  />
                </div>
              </div>

              <div className="mt-6">
                <div className="relative">

                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Tìm kiếm file"
                    className="h-12 w-full rounded-2xl border border-zinc-200 bg-white pl-12 pr-4 text-base font-semibold text-zinc-900 outline-none shadow-sm focus:border-zinc-300 sm:text-sm"
                  />
                </div>
              </div>

              {error ? (
                <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                  {error}
                </div>
              ) : null}

              {!hasAnyData && !loadingData ? (
                <div className="mt-12 rounded-3xl border border-zinc-200 bg-white p-10">
                  <div className="mx-auto flex max-w-md flex-col items-center text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
                      <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M4 7a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
                        <path d="M12 10v6" />
                        <path d="M9 13h6" />
                      </svg>
                    </div>
                    <div className="mt-4 text-lg font-bold text-zinc-900">Chưa có tài liệu</div>
                    <div className="mt-1 text-sm font-medium text-zinc-500">Hãy tạo folder hoặc upload tài liệu để bắt đầu.</div>
                    {isOwner ? (
                      <button
                        type="button"
                        className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-blue-600 px-6 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
                        onClick={onPickUpload}
                        disabled={uploadSubmitting}
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M12 3v12" />
                          <path d="M8 7l4-4 4 4" />
                          <path d="M4 21h16" />
                        </svg>
                        Upload File
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <>
                  <section className="mt-8">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-bold text-zinc-900">Folders</div>
                      {activeFolderId ? (
                        <button
                          type="button"
                          className="text-sm font-semibold text-blue-700 hover:underline"
                          onClick={() => setActiveFolderId(null)}
                        >
                          Bỏ lọc
                        </button>
                      ) : null}
                    </div>

                    <div className="mt-4 grid grid-flow-col auto-cols-[240px] gap-4 overflow-x-auto pb-2">
                      {filteredFolders.length ? (
                        filteredFolders.map((f) => {
                          const stats = folderStatsById.get(f.id) ?? { fileCount: 0, totalSize: 0 };
                          const selected = activeFolderId === f.id;
                          return (
                            <div
                              key={f.id}
                              role="button"
                              tabIndex={0}
                              onClick={() => setActiveFolderId((cur) => (cur === f.id ? null : f.id))}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  setActiveFolderId((cur) => (cur === f.id ? null : f.id));
                                }
                              }}
                              className={
                                selected
                                  ? "rounded-2xl border border-blue-200 bg-blue-50/40 p-4 shadow-sm transition hover:border-blue-300"
                                  : "rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-zinc-300"
                              }
                            >
                              <div className="flex items-start gap-3">
                                <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
                                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                                    <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                                  </svg>
                                </div>

                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-sm font-bold text-zinc-900">{f.name}</div>
                                  <div className="mt-1 text-xs font-semibold text-zinc-500">
                                    {stats.fileCount} files • {fmtBytes(stats.totalSize)}
                                  </div>
                                  {selected ? (
                                    <div className="mt-2 inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700">
                                      Đang lọc
                                    </div>
                                  ) : null}
                                </div>

                                <button
                                  type="button"
                                  className="ml-2 inline-flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                                  aria-label="More"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    if (isOwner) onRequestDeleteFolder(f);
                                  }}
                                  disabled={!isOwner}
                                >
                                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M12 12h.01" />
                                    <path d="M12 5h.01" />
                                    <path d="M12 19h.01" />
                                  </svg>
                                </button>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-sm font-semibold text-zinc-500">Chưa có folder</div>
                      )}
                    </div>
                  </section>

                  <section className="mt-10">
                    <div className="text-sm font-bold text-zinc-900">Recent Files</div>

                    <div className="mt-4 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
                      <div className="sm:hidden">
                        {loadingData ? (
                          <div className="px-5 py-8 text-sm font-semibold text-zinc-600">Loading...</div>
                        ) : filteredDocs.length ? (
                          <div className="divide-y divide-zinc-100">
                            {filteredDocs
                              .slice()
                              .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))
                              .map((d) => (
                                <div key={d.id} className="flex items-center justify-between gap-3 px-5 py-4">
                                  <button
                                    type="button"
                                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                                    onClick={() => onDownload(d)}
                                  >
                                    {(() => {
                                      const k = fileKind(d.contentType, d.name);
                                      const cls =
                                        k === "pdf"
                                          ? "bg-red-50 text-red-700"
                                          : k === "word"
                                            ? "bg-blue-50 text-blue-700"
                                            : k === "image"
                                              ? "bg-emerald-50 text-emerald-700"
                                              : "bg-zinc-100 text-zinc-700";
                                      return (
                                        <div className={`flex h-10 w-10 flex-none items-center justify-center rounded-xl ${cls}`}>
                                          <svg
                                            viewBox="0 0 24 24"
                                            className="h-5 w-5"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="1.8"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            aria-hidden="true"
                                          >
                                            <path d="M6 2h9l3 3v17H6z" />
                                            <path d="M15 2v4h4" />
                                          </svg>
                                        </div>
                                      );
                                    })()}

                                    <div className="min-w-0">
                                      <div className="truncate text-sm font-semibold text-zinc-900">{d.name}</div>
                                      <div className="mt-1 truncate text-xs font-semibold text-zinc-500">
                                        {fmtDate(d.createdAt)} • {fmtBytes(d.size)}
                                      </div>
                                    </div>
                                  </button>

                                  <div className="flex flex-none items-center gap-2">
                                    <button
                                      type="button"
                                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                                      onClick={() => onDownload(d)}
                                      aria-label="Download"
                                    >
                                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                                        <path d="M12 3v10" />
                                        <path d="M8 9l4 4 4-4" />
                                        <path d="M4 21h16" />
                                      </svg>
                                    </button>
                                    <button
                                      type="button"
                                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
                                      aria-label="More"
                                      onClick={() => {
                                        if (!isOwner) return;
                                        onRequestDelete(d);
                                      }}
                                      disabled={!isOwner}
                                    >
                                      <svg
                                        viewBox="0 0 24 24"
                                        className="h-5 w-5"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.8"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        aria-hidden="true"
                                      >
                                        <path d="M12 12h.01" />
                                        <path d="M12 5h.01" />
                                        <path d="M12 19h.01" />
                                      </svg>
                                    </button>
                                  </div>
                                </div>
                              ))}
                          </div>
                        ) : (
                          <div className="px-5 py-12 text-center text-sm font-semibold text-zinc-500">Không có tài liệu.</div>
                        )}
                      </div>

                      <div className="hidden overflow-x-auto sm:block">
                        <table className="w-full min-w-[860px] table-fixed">
                      <colgroup>
                        <col className="w-[360px]" />
                        <col className="w-[160px]" />
                        <col className="w-[160px]" />
                        <col className="w-[120px]" />
                        <col className="w-[140px]" />
                        <col className="w-[120px]" />
                      </colgroup>
                      <thead>
                        <tr className="bg-zinc-50 text-left text-xs font-bold text-zinc-600">
                          <th className="px-5 py-3">Tên File</th>
                          <th className="px-5 py-3">Tên thư mục</th>
                          <th className="px-5 py-3">Loại</th>
                          <th className="px-5 py-3">Dung lượng</th>
                          <th className="px-5 py-3">Ngày tải lên</th>
                          <th className="px-5 py-3 text-center">Thao tác</th>
                        </tr>
                      </thead>
                      <tbody>
                        {loadingData ? (
                          <tr>
                            <td colSpan={6} className="px-5 py-8 text-sm font-semibold text-zinc-600">
                              Loading...
                            </td>
                          </tr>
                        ) : filteredDocs.length ? (
                          filteredDocs.map((d) => (
                            <tr
                              key={d.id}
                              className="border-t border-zinc-100 text-sm font-medium text-zinc-800 transition hover:bg-zinc-50"
                            >
                              <td className="px-5 py-3">
                                <div className="flex items-center gap-3">
                                  {(() => {
                                    const k = fileKind(d.contentType, d.name);
                                    const cls =
                                      k === "pdf"
                                        ? "bg-red-50 text-red-700"
                                        : k === "word"
                                          ? "bg-blue-50 text-blue-700"
                                          : k === "image"
                                            ? "bg-emerald-50 text-emerald-700"
                                            : "bg-zinc-100 text-zinc-700";
                                    return (
                                      <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${cls}`}>
                                        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                          <path d="M6 2h9l3 3v17H6z" />
                                          <path d="M15 2v4h4" />
                                        </svg>
                                      </div>
                                    );
                                  })()}
                                  <div className="min-w-0">
                                    <button
                                      type="button"
                                      className="max-w-[320px] truncate text-left font-semibold text-zinc-900 hover:underline"
                                      onClick={() => onDownload(d)}
                                    >
                                      {d.name}
                                    </button>
                                  </div>
                                </div>
                              </td>
                              <td className="px-5 py-3 text-zinc-600">
                                <div className="max-w-[220px] truncate">{d.folderId ? folderNameById.get(d.folderId) ?? "—" : "—"}</div>
                              </td>
                              <td className="px-5 py-3 text-zinc-600">{fileTypeLabel(d.contentType, d.name)}</td>
                              <td className="px-5 py-3 text-zinc-600">{fmtBytes(d.size)}</td>
                              <td className="px-5 py-3 text-zinc-600">{fmtDate(d.createdAt)}</td>
                              <td className="relative px-5 py-3 text-center">
                                <div className="flex items-center justify-center gap-2">
                                  <button
                                    type="button"
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                                    onClick={() => onDownload(d)}
                                    aria-label="Download"
                                  >
                                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                                      <path d="M12 3v10" />
                                      <path d="M8 9l4 4 4-4" />
                                      <path d="M4 21h16" />
                                    </svg>
                                  </button>

                                  <button
                                    type="button"
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
                                    aria-label="More"
                                    onClick={() => {
                                      if (!isOwner) return;
                                      onRequestDelete(d);
                                    }}
                                    disabled={!isOwner}
                                  >
                                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                      <path d="M12 12h.01" />
                                      <path d="M12 5h.01" />
                                      <path d="M12 19h.01" />
                                    </svg>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={6} className="px-5 py-12 text-center text-sm font-semibold text-zinc-500">
                              Không có tài liệu.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                  </section>
                </>
              )}
            </div>
          </main>
        </div>
      </div>

      {createFolderOpen ? (
        <div className="fixed inset-0 z-[110] flex items-start justify-center bg-transparent px-4 pt-[260px]">
          <div className="w-full max-w-md rounded-2xl bg-white p-6">
            <div className="flex items-start justify-between">
              <div className="text-base font-bold text-zinc-900">Điền tên folder</div>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100"
                onClick={() => {
                  if (createFolderSubmitting) return;
                  setCreateFolderOpen(false);
                }}
                aria-label="Close"
                disabled={createFolderSubmitting}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M18 6L6 18" />
                  <path d="M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="mt-4">
              <input
                value={createFolderName}
                onChange={(e) => setCreateFolderName(e.target.value)}
                placeholder="Tên folder"
                className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-900 outline-none focus:border-zinc-400"
                disabled={createFolderSubmitting}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSubmitCreateFolder();
                }}
              />
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-5 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
                onClick={() => setCreateFolderOpen(false)}
                disabled={createFolderSubmitting}
              >
                Hủy
              </button>
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center rounded-xl bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                onClick={onSubmitCreateFolder}
                disabled={createFolderSubmitting}
              >
                Tạo
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmDeleteOpen && confirmDeleteDoc ? (
        <div className="fixed inset-0 z-[110] flex items-start justify-center bg-transparent px-4 pt-[260px]">
          <div className="w-full max-w-md rounded-2xl bg-white p-6">
            <div className="text-base font-bold text-zinc-900">Xác nhận xóa</div>
            <div className="mt-2 text-sm font-medium text-zinc-600">
              Bạn có chắc muốn xóa "{confirmDeleteDoc.name}"?
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-5 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
                onClick={() => {
                  if (deleteSubmitting) return;
                  setConfirmDeleteOpen(false);
                  setConfirmDeleteDoc(null);
                }}
                disabled={deleteSubmitting}
              >
                Hủy
              </button>
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center rounded-xl bg-red-600 px-5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                onClick={onConfirmDelete}
                disabled={deleteSubmitting}
              >
                Xóa
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmDeleteFolderOpen && confirmDeleteFolder ? (
        <div className="fixed inset-0 z-[110] flex items-start justify-center bg-transparent px-4 pt-[260px]">
          <div className="w-full max-w-md rounded-2xl bg-white p-6">
            <div className="text-base font-bold text-zinc-900">Xác nhận xóa folder</div>
            <div className="mt-2 text-sm font-medium text-zinc-600">
              Bạn có chắc muốn xóa folder "{confirmDeleteFolder.name}"?
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-5 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
                onClick={() => {
                  if (deleteFolderSubmitting) return;
                  setConfirmDeleteFolderOpen(false);
                  setConfirmDeleteFolder(null);
                }}
                disabled={deleteFolderSubmitting}
              >
                Hủy
              </button>
              <button
                type="button"
                className="inline-flex h-10 items-center justify-center rounded-xl bg-red-600 px-5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                onClick={onConfirmDeleteFolder}
                disabled={deleteFolderSubmitting}
              >
                Xóa
              </button>
            </div>
          </div>
        </div>
      ) : null}

    </div>
  );
}
