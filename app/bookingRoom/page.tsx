"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  doc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";

import { useAuth } from "@/app/providers";
import { getFirestoreDb } from "@/lib/firebase";

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

export default function BookingRoomPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);

  const [roomName, setRoomName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useOnClickOutside(menuRef, () => setMenuOpen(false));

  const canCreate = useMemo(() => roomName.trim().length > 0, [roomName]);

  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/login?next=${encodeURIComponent("/bookingRoom")}`);
    }
  }, [loading, user, router]);

  async function onCreateRoom() {
    if (!user) return;
    if (!canCreate) return;

    setSubmitting(true);
    setError(null);

    try {
      const db = getFirestoreDb();
      const roomRef = doc(collection(db, "rooms"));
      const memberRef = doc(collection(db, `rooms/${roomRef.id}/members`), user.uid);

      const batch = writeBatch(db);
      batch.set(roomRef, {
        ownerId: user.uid,
        name: roomName.trim(),
        createdAt: serverTimestamp(),
      });
      batch.set(memberRef, {
        userId: user.uid,
        role: "owner",
        joinedAt: serverTimestamp(),
      });

      await batch.commit();

      setCreateOpen(false);
      setRoomName("");

      router.push(`/home/calendar?roomId=${encodeURIComponent(roomRef.id)}`);
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
            <div className="text-base font-semibold text-zinc-900">
              Danh sách lịch
            </div>

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
            Quản lý và theo dõi các lịch học của bạn
          </div>

          <div className="mt-4 rounded-xl border border-zinc-200 bg-white p-5">
            <div className="text-sm font-medium text-zinc-900">Chưa có lịch</div>
            <div className="mt-1 text-sm text-zinc-500">
              Nhấn “Thêm phòng” → “Tạo phòng mới” để tạo lịch đầu tiên.
            </div>
          </div>
        </div>
      </div>

      {createOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <div className="flex items-center justify-between">
              <div className="text-base font-semibold text-zinc-900">
                Tạo phòng mới
              </div>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-zinc-500 hover:bg-zinc-100"
                onClick={() => setCreateOpen(false)}
              >
                ✕
              </button>
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium text-zinc-700">
                Tên phòng
              </label>
              <input
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="Ví dụ: Lớp Toán 10A"
                className="mt-2 h-10 w-full rounded-md border border-zinc-200 px-3 text-sm outline-none focus:border-zinc-400"
              />

              {error ? (
                <div className="mt-3 text-sm font-medium text-red-600">
                  {error}
                </div>
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
              <div className="text-base font-semibold text-zinc-900">
                Gia nhập phòng
              </div>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-zinc-500 hover:bg-zinc-100"
                onClick={() => setJoinOpen(false)}
              >
                ✕
              </button>
            </div>

            <div className="mt-4 text-sm text-zinc-600">
              (Sẽ làm sau) Nhập mã phòng hoặc link mời để tham gia.
            </div>

            <div className="mt-5 flex items-center justify-end">
              <button
                type="button"
                className="h-10 rounded-md bg-zinc-900 px-4 text-sm font-semibold text-white hover:bg-zinc-800"
                onClick={() => setJoinOpen(false)}
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
