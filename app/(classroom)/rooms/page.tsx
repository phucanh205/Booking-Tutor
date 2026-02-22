"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";

import { useAuth } from "@/app/providers";
import { getFirestoreDb } from "@/lib/firebase";

function normalizeRoomId(input: string) {
  const raw = input.trim();
  if (!raw) return null;

  // If user pasted a full URL, extract roomId from:
  // - /rooms/<roomId>/calendar
  // - /home/calendar?roomId=<roomId>
  // - ?roomId=<roomId>
  try {
    if (/^https?:\/\//i.test(raw)) {
      const u = new URL(raw);
      const fromQuery = u.searchParams.get("roomId");
      if (fromQuery) return fromQuery.trim();

      const parts = u.pathname.split("/").filter(Boolean);
      const roomsIdx = parts.indexOf("rooms");
      if (roomsIdx >= 0 && parts[roomsIdx + 1]) return parts[roomsIdx + 1].trim();
    }
  } catch {
    // ignore URL parsing
  }

  // If user pasted a path-like value, take the last non-empty segment.
  const noQuery = raw.split("?")[0] ?? raw;
  const segs = noQuery.split("/").filter(Boolean);
  const candidate = segs[segs.length - 1] ?? "";
  const id = candidate.trim();
  if (!id) return null;

  // Firestore doc ids cannot contain '/'
  if (id.includes("/")) return null;
  return id;
}

function useOnClickOutside(
  ref: React.RefObject<HTMLElement | null>,
  handler: () => void
) {
  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      const el = ref.current;
      if (!el) return;
      if (el.contains(e.target as Node)) return;
      handler();
    }

    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [ref, handler]);
}

export default function RoomsPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [roomsLoading, setRoomsLoading] = useState(false);
  const [roomsError, setRoomsError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<
    Array<{ id: string; name: string; ownerId: string; ownerEmail: string | null; role: "owner" | "student" }>
  >([]);

  const [deletingRoomId, setDeletingRoomId] = useState<string | null>(null);
  const [confirmDeleteRoomId, setConfirmDeleteRoomId] = useState<string | null>(null);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);

  const [roomName, setRoomName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [joinRoomId, setJoinRoomId] = useState("");
  const [joinSubmitting, setJoinSubmitting] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  useOnClickOutside(menuRef, () => setMenuOpen(false));

  const canCreate = useMemo(() => roomName.trim().length > 0, [roomName]);

  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/login?next=${encodeURIComponent("/rooms")}`);
    }
  }, [loading, user, router]);

  useEffect(() => {
    async function loadRooms() {
      if (!user) return;

      setRoomsLoading(true);
      setRoomsError(null);

      try {
        const db = getFirestoreDb();

        let idxSnap = await getDocs(collection(db, `users/${user.uid}/rooms`));

        // Backfill index for owners that created rooms before we introduced users/{uid}/rooms.
        if (idxSnap.empty) {
          try {
            const ownedSnap = await getDocs(
              query(collection(db, "rooms"), where("ownerId", "==", user.uid))
            );

            if (!ownedSnap.empty) {
              const batch = writeBatch(db);
              for (const d of ownedSnap.docs) {
                const data = d.data() as any;
                if (data?.deletedAt) continue;
                batch.set(
                  doc(db, `users/${user.uid}/rooms`, d.id),
                  {
                    roomId: d.id,
                    role: "owner",
                    joinedAt: data?.createdAt ?? serverTimestamp(),
                  },
                  { merge: true }
                );
              }
              await batch.commit();
              idxSnap = await getDocs(collection(db, `users/${user.uid}/rooms`));
            }
          } catch (e) {
            console.warn("Rooms index backfill skipped", e);
          }
        }

        const roomIds = new Set<string>(idxSnap.docs.map((d) => d.id));
        const roleByRoomId = new Map<string, "owner" | "student">(
          idxSnap.docs.map((d) => {
            const data = d.data() as any;
            const role = data?.role === "owner" ? "owner" : "student";
            return [d.id, role];
          })
        );

        const roomDocs = await Promise.all(
          Array.from(roomIds).map(async (id) => {
            const snap = await getDoc(doc(db, "rooms", id));
            return snap.exists() ? ({ id, ...(snap.data() as any) } as any) : null;
          })
        );

        const merged = roomDocs
          .filter(Boolean)
          .filter((r: any) => !r?.deletedAt)
          .map((r: any) => {
            const id = String(r.id);
            return {
              id,
              name: typeof r?.name === "string" ? r.name : "(No name)",
              ownerId: typeof r?.ownerId === "string" ? r.ownerId : "",
              ownerEmail: (typeof r?.ownerEmail === "string" ? r.ownerEmail : null) as
                | string
                | null,
              role: roleByRoomId.get(id) ?? "student",
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name));

        // Cleanup indexes pointing to deleted or missing rooms.
        const mergedIds = new Set(merged.map((m) => m.id));
        for (const roomId of roomIds) {
          if (!mergedIds.has(roomId)) {
            try {
              await setDoc(
                doc(db, `users/${user.uid}/rooms`, roomId),
                { removedAt: serverTimestamp() },
                { merge: true }
              );
              // best-effort delete index doc so it won't keep appearing
              await updateDoc(doc(db, `users/${user.uid}/rooms`, roomId), { removedAt: serverTimestamp() });
            } catch {
              // ignore cleanup errors
            }
          }
        }

        setRooms(merged);
      } catch (e) {
        console.error("Load rooms failed", e);
        const anyErr = e as any;
        const code = typeof anyErr?.code === "string" ? anyErr.code : null;
        const message = typeof anyErr?.message === "string" ? anyErr.message : null;
        setRoomsError(
          code || message
            ? `Không thể tải danh sách lớp: ${code ?? "unknown"}${message ? ` - ${message}` : ""}`
            : "Không thể tải danh sách lớp."
        );
      } finally {
        setRoomsLoading(false);
      }
    }

    loadRooms();
  }, [user]);

  async function onDeleteRoom(roomId: string) {
    if (!user) return;
    const room = rooms.find((r) => r.id === roomId);
    if (!room) return;
    if (room.role !== "owner") return;

    setConfirmDeleteRoomId(roomId);
  }

  async function onConfirmDeleteRoom() {
    if (!user) return;
    const roomId = confirmDeleteRoomId;
    if (!roomId) return;
    const room = rooms.find((r) => r.id === roomId);
    if (!room) return;
    if (room.role !== "owner") return;

    setDeletingRoomId(roomId);
    try {
      const db = getFirestoreDb();
      await updateDoc(doc(db, "rooms", roomId), {
        deletedAt: serverTimestamp(),
        deletedBy: user.uid,
      });

      await setDoc(
        doc(db, `users/${user.uid}/rooms`, roomId),
        { removedAt: serverTimestamp() },
        { merge: true }
      );

      setRooms((prev) => prev.filter((r) => r.id !== roomId));
    } catch (e) {
      console.error("Delete room failed", e);
      alert("Xóa lớp thất bại. Vui lòng thử lại.");
    } finally {
      setConfirmDeleteRoomId(null);
      setDeletingRoomId((cur) => (cur === roomId ? null : cur));
    }
  }

  async function onCreateRoom() {
    if (!user) return;
    if (!canCreate) return;

    setSubmitting(true);
    setError(null);

    try {
      const db = getFirestoreDb();
      const roomRef = doc(collection(db, "rooms"));
      const memberRef = doc(collection(db, `rooms/${roomRef.id}/members`), user.uid);
      const idxRef = doc(db, `users/${user.uid}/rooms`, roomRef.id);

      const batch = writeBatch(db);
      batch.set(roomRef, {
        ownerId: user.uid,
        ownerEmail: (user.email ?? null)?.toLowerCase?.() ?? null,
        name: roomName.trim(),
        createdAt: serverTimestamp(),
      });
      batch.set(memberRef, {
        userId: user.uid,
        role: "owner",
        joinedAt: serverTimestamp(),
      });
      batch.set(idxRef, {
        roomId: roomRef.id,
        role: "owner",
        joinedAt: serverTimestamp(),
      });

      await batch.commit();

      setCreateOpen(false);
      setRoomName("");

      router.push(`/rooms/${encodeURIComponent(roomRef.id)}/calendar`);
    } catch (e) {
      console.error("Create room failed", e);
      const anyErr = e as any;
      const code = typeof anyErr?.code === "string" ? anyErr.code : null;
      const message = typeof anyErr?.message === "string" ? anyErr.message : null;

      if (code || message) {
        setError(
          `Tạo phòng thất bại: ${code ?? "unknown"}${message ? ` - ${message}` : ""}`
        );
      } else {
        setError("Tạo phòng thất bại. Vui lòng thử lại.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function onJoinRoom() {
    if (!user) return;

    const rid = normalizeRoomId(joinRoomId);
    if (!rid) {
      setJoinError("Vui lòng nhập Room ID hợp lệ.");
      return;
    }

    setJoinSubmitting(true);
    setJoinError(null);

    try {
      const db = getFirestoreDb();
      const roomRef = doc(db, "rooms", rid);
      const roomSnap = await getDoc(roomRef);

      if (!roomSnap.exists()) {
        setJoinError("Không tìm thấy phòng. Vui lòng kiểm tra Room ID.");
        return;
      }

      const room = roomSnap.data() as {
        ownerId?: string;
        ownerEmail?: string | null;
      };

      if (!room?.ownerId) {
        setJoinError("Phòng không hợp lệ (thiếu ownerId).");
        return;
      }

      if (room.ownerId === user.uid) {
        setJoinError("Bạn là chủ phòng, không thể tham gia phòng của chính mình.");
        return;
      }

      const myEmail = (user.email ?? "").toLowerCase();
      const ownerEmail = (room.ownerEmail ?? "").toLowerCase();
      if (ownerEmail && myEmail && ownerEmail === myEmail) {
        setJoinError("Bạn phải dùng Gmail khác với tài khoản tạo phòng để tham gia.");
        return;
      }

      const memberRef = doc(db, `rooms/${rid}/members`, user.uid);
      const memberSnap = await getDoc(memberRef);
      if (!memberSnap.exists()) {
        await setDoc(memberRef, {
          userId: user.uid,
          role: "student",
          joinedAt: serverTimestamp(),
        });
      }

      const idxRef = doc(db, `users/${user.uid}/rooms`, rid);
      await setDoc(
        idxRef,
        {
          roomId: rid,
          role: "student",
          joinedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setJoinOpen(false);
      setJoinRoomId("");

      router.push(`/rooms/${encodeURIComponent(rid)}/calendar`);
    } catch (e) {
      console.error("Join room failed", e);
      const anyErr = e as any;
      const code = typeof anyErr?.code === "string" ? anyErr.code : null;
      const message = typeof anyErr?.message === "string" ? anyErr.message : null;

      if (code || message) {
        setJoinError(
          `Gia nhập thất bại: ${code ?? "unknown"}${message ? ` - ${message}` : ""}`
        );
      } else {
        setJoinError("Gia nhập thất bại. Vui lòng thử lại.");
      }
    } finally {
      setJoinSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="text-sm font-medium text-zinc-600">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-white px-6 py-6">
      <div className="mx-auto max-w-6xl">
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <div className="text-base font-semibold text-zinc-900">Danh sách lớp</div>

            <div className="relative" ref={menuRef}>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm font-semibold text-zinc-900 hover:bg-zinc-50"
                onClick={() => setMenuOpen((v) => !v)}
              >
                <span className="text-base leading-none">+</span>
                <span>Thêm phòng</span>
                <svg
                  viewBox="0 0 20 20"
                  className="h-4 w-4 text-zinc-500"
                  aria-hidden="true"
                >
                  <path
                    d="M5 7l5 6 5-6"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>

              {menuOpen ? (
                <div className="absolute right-0 mt-2 w-56 rounded-md border border-zinc-200 bg-white shadow-sm">
                  <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-900 hover:bg-zinc-50"
                    onClick={() => {
                      setMenuOpen(false);
                      setCreateOpen(true);
                      setJoinOpen(false);
                      setError(null);
                    }}
                  >
                    <span className="text-zinc-500">+</span>
                    <span>Tạo phòng mới</span>
                  </button>
                  <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-900 hover:bg-zinc-50"
                    onClick={() => {
                      setMenuOpen(false);
                      setJoinOpen(true);
                      setCreateOpen(false);
                      setJoinError(null);
                    }}
                  >
                    <span className="text-zinc-500">↗</span>
                    <span>Gia nhập phòng</span>
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-1 text-sm text-zinc-500">
            Quản lý và theo dõi các lớp học của bạn
          </div>

          <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-5">
            {roomsError ? (
              <div className="text-sm font-medium text-red-600">{roomsError}</div>
            ) : roomsLoading ? (
              <div className="text-sm font-medium text-zinc-600">Đang tải...</div>
            ) : rooms.length === 0 ? (
              <>
                <div className="text-sm font-medium text-zinc-900">Chưa có lớp</div>
                <div className="mt-1 text-sm text-zinc-500">
                  Nhấn “Thêm phòng” để tạo hoặc gia nhập một lớp.
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-3">
                {rooms.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-4"
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left hover:opacity-90"
                      onClick={() => router.push(`/rooms/${encodeURIComponent(r.id)}/calendar`)}
                    >
                      <div className="text-sm font-semibold text-zinc-900">{r.name}</div>
                      <div className="mt-1 text-xs text-zinc-500">Room ID: {r.id}</div>
                    </button>

                    {r.role === "owner" ? (
                      <button
                        type="button"
                        className="h-9 rounded-md border border-red-200 bg-white px-3 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60"
                        onClick={() => onDeleteRoom(r.id)}
                        disabled={deletingRoomId === r.id}
                      >
                        {deletingRoomId === r.id ? "Đang xóa..." : "Xóa"}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {confirmDeleteRoomId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
                  <span className="text-xl text-red-600">🗑️</span>
                </div>
                <div>
                  <div className="text-lg font-bold text-zinc-900">Xác nhận xóa</div>
                  <div className="mt-1 text-sm text-zinc-500">Bạn chắc chắn muốn xóa lớp này không?</div>
                </div>
              </div>
              <button
                type="button"
                className="rounded-lg px-2 py-1 text-zinc-500 hover:bg-zinc-100"
                onClick={() => setConfirmDeleteRoomId(null)}
                aria-label="Close"
                disabled={!!deletingRoomId}
              >
                ✕
              </button>
            </div>

            <div className="mt-4 text-sm font-medium text-zinc-500">Hành động này không thể hoàn tác.</div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                className="h-11 rounded-xl bg-zinc-100 px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-200 disabled:opacity-60"
                onClick={() => setConfirmDeleteRoomId(null)}
                disabled={!!deletingRoomId}
              >
                Hủy
              </button>
              <button
                type="button"
                className="h-11 rounded-xl bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                onClick={onConfirmDeleteRoom}
                disabled={!!deletingRoomId}
              >
                {deletingRoomId ? "Đang xóa..." : "Xóa"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {createOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <div className="flex items-center justify-between">
              <div className="text-base font-semibold text-zinc-900">Tạo phòng mới</div>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-zinc-500 hover:bg-zinc-100"
                onClick={() => setCreateOpen(false)}
              >
                ✕
              </button>
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium text-zinc-700">Tên phòng</label>
              <input
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="Ví dụ: Lớp Toán 10A"
                className="mt-2 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-400"
              />

              {error ? (
                <div className="mt-3 text-sm font-medium text-red-600">{error}</div>
              ) : null}

              <div className="mt-5 flex items-center justify-end gap-2">
                <button
                  type="button"
                  className="h-10 rounded-md px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
                  onClick={() => setCreateOpen(false)}
                  disabled={submitting}
                >
                  Hủy
                </button>
                <button
                  type="button"
                  className="h-10 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                  onClick={onCreateRoom}
                  disabled={!canCreate || submitting}
                >
                  {submitting ? "Đang tạo..." : "Tạo"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {joinOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <div className="flex items-center justify-between">
              <div className="text-base font-semibold text-zinc-900">Gia nhập phòng</div>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-zinc-500 hover:bg-zinc-100"
                onClick={() => setJoinOpen(false)}
              >
                ✕
              </button>
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium text-zinc-700">Room ID</label>
              <input
                value={joinRoomId}
                onChange={(e) => setJoinRoomId(e.target.value)}
                placeholder="Nhập Id phòng"
                className="mt-2 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-400"
              />

              {joinError ? (
                <div className="mt-3 text-sm font-medium text-red-600">{joinError}</div>
              ) : null}

              <div className="mt-5 flex items-center justify-end gap-2">
                <button
                  type="button"
                  className="h-10 rounded-md px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
                  onClick={() => setJoinOpen(false)}
                  disabled={joinSubmitting}
                >
                  Hủy
                </button>
                <button
                  type="button"
                  className="h-10 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                  onClick={onJoinRoom}
                  disabled={!joinRoomId.trim() || joinSubmitting}
                >
                  {joinSubmitting ? "Đang tham gia..." : "Tham gia"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
