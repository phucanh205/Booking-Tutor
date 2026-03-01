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
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";

import { useAuth } from "@/app/providers";
import { getFirestoreDb, getFirebaseStorage } from "@/lib/firebase";

type Folder = {
  id: string;
  name: string;
  createdAt?: any;
  createdBy?: string;
};

type DocItem = {
  id: string;
  name: string;
  folderId: string | null;
  storagePath: string;
  size: number;
  contentType: string;
  createdAt?: any;
  createdBy?: string;
  deletedAt?: any | null;
};

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

function isPreviewable(contentType: string, fileName: string) {
  const lower = (fileName || "").toLowerCase();
  if (contentType === "application/pdf" || lower.endsWith(".pdf")) return true;
  if (contentType.startsWith("image/")) return true;
  return false;
}

function isPdf(contentType: string, fileName: string) {
  const lower = (fileName || "").toLowerCase();
  return contentType === "application/pdf" || lower.endsWith(".pdf");
}

export default function RoomDocumentsPage() {
  const router = useRouter();
  const params = useParams();
  const { user, loading } = useAuth();

  const roomId = typeof params?.roomId === "string" ? params.roomId : null;

  const [memberRole, setMemberRole] = useState<"owner" | "student" | null>(null);
  const isOwner = memberRole === "owner";

  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [roomName, setRoomName] = useState<string>("");

  const [folders, setFolders] = useState<Folder[]>([]);
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");

  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [createFolderName, setCreateFolderName] = useState("");
  const [createFolderSubmitting, setCreateFolderSubmitting] = useState(false);

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmDeleteDoc, setConfirmDeleteDoc] = useState<DocItem | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const [uploadSubmitting, setUploadSubmitting] = useState(false);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<DocItem | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

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

    const db = getFirestoreDb();
    setLoadingData(true);
    setError(null);

    let foldersReady = false;
    let docsReady = false;
    function maybeDone() {
      if (foldersReady && docsReady) setLoadingData(false);
    }

    const foldersUnsub = onSnapshot(
      collection(db, `rooms/${roomId}/folders`),
      (snap) => {
        const folderItems: Folder[] = snap.docs
          .map((d) => {
            const data = d.data() as any;
            return {
              id: d.id,
              name: typeof data?.name === "string" ? data.name : "(No name)",
              createdAt: data?.createdAt,
              createdBy: typeof data?.createdBy === "string" ? data.createdBy : undefined,
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name));
        setFolders(folderItems);
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
              storagePath: typeof data?.storagePath === "string" ? data.storagePath : "",
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
  }, [user, roomId]);

  const folderNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of folders) m.set(f.id, f.name);
    return m;
  }, [folders]);

  const filteredDocs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return docs.filter((d) => {
      if (q) {
        const hay = `${d.name} ${folderNameById.get(d.folderId ?? "") ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [docs, search, folderNameById]);

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
      });
      setCreateFolderOpen(false);
      pushToast("success", "Tạo folder thành công.");
    } catch (e) {
      console.error("Create folder failed", e);
      pushToast("error", "Tạo folder thất bại.");
    } finally {
      setCreateFolderSubmitting(false);
    }
  }

  async function onPreview(d: DocItem) {
    if (!d.storagePath) {
      showCenterNotice({
        title: "Chưa thể xem file",
        message: "File đang được xử lý. Vui lòng thử lại sau vài giây hoặc tải về để xem.",
        primaryLabel: "Tải về",
        onPrimary: () => onDownload(d),
        autoHideMs: 6000,
      });
      return;
    }

    const typeLabel = fileTypeLabel(d.contentType, d.name);
    if (typeLabel === "Word Document") {
      showCenterNotice({
        title: "Không hỗ trợ xem trực tiếp",
        message: "File Word cần tải về để xem trên thiết bị của bạn.",
        primaryLabel: "Tải về",
        onPrimary: () => onDownload(d),
      });
      return;
    }

    const maxPreviewBytes = 6 * 1024 * 1024;
    if ((d.size || 0) > maxPreviewBytes) {
      showCenterNotice({
        title: "File dung lượng lớn",
        message: `File này khoảng ${fmtBytes(d.size)}. Để tránh tải chậm khi xem trực tiếp, vui lòng tải về để xem.`,
        primaryLabel: "Tải về",
        onPrimary: () => onDownload(d),
      });
      return;
    }

    if (!isPreviewable(d.contentType, d.name)) {
      showCenterNotice({
        title: "Không hỗ trợ xem trực tiếp",
        message: "Định dạng file này hiện chưa hỗ trợ xem trực tiếp. Bạn có thể tải về để xem.",
        primaryLabel: "Tải về",
        onPrimary: () => onDownload(d),
        autoHideMs: 7000,
      });
      return;
    }

    try {
      setPreviewLoading(true);
      const storage = getFirebaseStorage();
      const url = await getDownloadURL(ref(storage, d.storagePath));
      setPreviewDoc(d);
      setPreviewUrl(url);
      setPreviewOpen(true);
    } catch (e) {
      console.error("Preview failed", e);
      pushToast("error", "Không thể mở preview.");
    } finally {
      setPreviewLoading(false);
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
      const db = getFirestoreDb();
      const storage = getFirebaseStorage();

      const docRef = await addDoc(collection(db, `rooms/${roomId}/documents`), {
        name: file.name,
        folderId: null,
        storagePath: "",
        size: file.size,
        contentType: file.type,
        createdAt: serverTimestamp(),
        createdBy: user.uid,
        deletedAt: null,
      });

      const storagePath = `rooms/${roomId}/documents/${docRef.id}/${file.name}`;
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, file, { contentType: file.type });

      await updateDoc(docRef, {
        storagePath,
      });
      pushToast("success", "Upload file thành công.");
    } catch (e) {
      console.error("Upload file failed", e);
      pushToast("error", "Upload thất bại.");
    } finally {
      setUploadSubmitting(false);
    }
  }

  async function onDownload(d: DocItem) {
    try {
      if (!roomId) return;
      const storage = getFirebaseStorage();

      const fallbackPath = `rooms/${roomId}/documents/${d.id}/${d.name}`;
      const effectivePath = d.storagePath || fallbackPath;

      let url: string;
      try {
        url = await getDownloadURL(ref(storage, effectivePath));
      } catch (e) {
        console.error("Get download URL failed", e);
        showCenterNotice({
          title: "Chưa thể tải file",
          message: "File đang được xử lý hoặc chưa upload xong. Vui lòng thử lại sau vài giây.",
          autoHideMs: 6000,
        });
        return;
      }

      if (!d.storagePath) {
        try {
          const db = getFirestoreDb();
          await updateDoc(doc(db, `rooms/${roomId}/documents`, d.id), {
            storagePath: effectivePath,
          });
        } catch (e) {
          console.error("Heal storagePath failed", e);
        }
      }

      const largeThresholdBytes = 20 * 1024 * 1024;
      if ((d.size || 0) >= largeThresholdBytes) {
        window.open(url, "_blank", "noopener,noreferrer");
        return;
      }

      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
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

      if (d.storagePath) {
        try {
          const storage = getFirebaseStorage();
          await deleteObject(ref(storage, d.storagePath));
        } catch (e) {
          console.error("Delete storage object failed", e);
        }
      }

      setConfirmDeleteOpen(false);
      setConfirmDeleteDoc(null);
      pushToast("success", "Đã xóa tài liệu.");
    } catch (e) {
      console.error("Delete doc failed", e);
      pushToast("error", "Xóa thất bại.");
    } finally {
      setDeleteSubmitting(false);
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

  return (
    <div className="min-h-dvh bg-zinc-50">
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
          <div className="pointer-events-none fixed left-1/2 top-1/2 z-[125] w-[92vw] max-w-lg -translate-x-1/2 -translate-y-1/2">
            <div className="pointer-events-auto rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl">
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
          <main className="px-6 py-6 sm:px-8 sm:py-8">
            <div className="mx-auto w-full max-w-6xl">
              <div className="flex items-center justify-between gap-6">
                <div className="min-w-0">
                  <div className="text-[24px] font-bold text-zinc-900">Upload Tài liệu</div>
                </div>

                <div className="flex shrink-0 items-center gap-3">
                  {isOwner ? (
                    <>
                      <button
                        type="button"
                        className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50"
                        onClick={onCreateFolder}
                        disabled={createFolderSubmitting || uploadSubmitting}
                      >
                        New Folder
                      </button>
                      <button
                        type="button"
                        className="inline-flex h-10 items-center justify-center rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
                        onClick={onPickUpload}
                        disabled={createFolderSubmitting || uploadSubmitting}
                      >
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

              <div className="mt-6 flex items-center gap-4">
                <div className="w-full max-w-2xl">
                  <div className="relative">
                    {/* <div className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400">
                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M10 18a8 8 0 1 1 6.32-3.09L21 19.6" />
                      </svg>
                    </div> */}
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Tìm kiếm"
                      className="h-11 w-full rounded-xl border border-zinc-200 bg-white pl-11 pr-4 text-sm font-medium text-zinc-900 outline-none focus:border-zinc-400"
                    />
                  </div>
                </div>
              </div>

              {error ? (
                <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                  {error}
                </div>
              ) : null}

              <section className="mt-8">
                <div className="text-sm font-bold text-zinc-900">Folders</div>

                <div className="mt-4 flex gap-4 overflow-x-auto pb-2">
                  {filteredFolders.length ? (
                    filteredFolders.map((f) => {
                      const stats = folderStatsById.get(f.id) ?? { fileCount: 0, totalSize: 0 };
                      return (
                        <div
                          key={f.id}
                          className="min-w-[220px] rounded-xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-zinc-300 hover:shadow"
                        >
                          <div className="flex items-start gap-3">
                            <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                                <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                              </svg>
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-bold text-zinc-900">{f.name}</div>
                              <div className="mt-1 text-xs font-medium text-zinc-500">
                                {stats.fileCount} files • {fmtBytes(stats.totalSize)}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="rounded-xl border border-zinc-200 bg-white px-4 py-8 text-sm font-semibold text-zinc-500">
                      No folders
                    </div>
                  )}
                </div>
              </section>

              <section className="mt-10">
                <div className="text-sm font-bold text-zinc-900">Recent Files</div>

                <div className="mt-4 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="min-w-[860px] w-full table-fixed">
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
                          <th className="px-5 py-3">Folder</th>
                          <th className="px-5 py-3">Loại</th>
                          <th className="px-5 py-3">Size</th>
                          <th className="px-5 py-3">Ngày update</th>
                          <th className="px-5 py-3 text-center">Hành động</th>
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
                                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700">
                                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                                      <path d="M6 2h9l3 3v17H6z" />
                                      <path d="M15 2v4h4" />
                                    </svg>
                                  </div>
                                  <div className="min-w-0">
                                    <button
                                      type="button"
                                      className="max-w-[320px] truncate text-left font-semibold text-zinc-900 hover:underline"
                                      onClick={() => onPreview(d)}
                                      disabled={previewLoading}
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
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                                    onClick={() => onDownload(d)}
                                    aria-label="Download"
                                  >
                                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                                      <path d="M12 3v10" />
                                      <path d="M8 9l4 4 4-4" />
                                      <path d="M4 21h16" />
                                    </svg>
                                  </button>

                                  {isOwner ? (
                                    <button
                                      type="button"
                                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-200 bg-white text-red-700 hover:bg-red-50"
                                      aria-label="Delete"
                                      onClick={() => onRequestDelete(d)}
                                    >
                                      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M3 6h18" />
                                        <path d="M8 6V4h8v2" />
                                        <path d="M6 6l1 16h10l1-16" />
                                        <path d="M10 11v6" />
                                        <path d="M14 11v6" />
                                      </svg>
                                    </button>
                                  ) : null}
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
            </div>
          </main>
        </div>
      </div>

      {createFolderOpen ? (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
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
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
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

      {previewOpen && previewDoc && previewUrl ? (
        <div className="fixed inset-0 z-[115] flex items-center justify-center bg-black/40 px-4">
          <div className="flex h-[80vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3">
              <div className="min-w-0 truncate text-sm font-bold text-zinc-900">{previewDoc.name}</div>
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100"
                onClick={() => {
                  setPreviewOpen(false);
                  setPreviewDoc(null);
                  setPreviewUrl(null);
                }}
                aria-label="Close"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M18 6L6 18" />
                  <path d="M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="min-h-0 flex-1 bg-zinc-50">
              {isPdf(previewDoc.contentType, previewDoc.name) ? (
                <iframe src={previewUrl} className="h-full w-full" />
              ) : (
                <div className="flex h-full w-full items-center justify-center p-6">
                  <img src={previewUrl} alt={previewDoc.name} className="max-h-full max-w-full rounded-lg" />
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
