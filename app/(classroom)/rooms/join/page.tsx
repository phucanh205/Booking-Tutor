"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";

import { useAuth } from "@/app/providers";
import { getFirestoreDb } from "@/lib/firebase";

function normalizeRoomId(input: string) {
  const raw = input.trim();
  if (!raw) return null;

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

  const noQuery = raw.split("?")[0] ?? raw;
  const segs = noQuery.split("/").filter(Boolean);
  const candidate = segs[segs.length - 1] ?? "";
  const id = candidate.trim();
  if (!id) return null;
  if (id.includes("/")) return null;
  return id;
}

export default function JoinRoomPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  const [roomId, setRoomId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(() => roomId.trim().length > 0, [roomId]);

  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/login?next=${encodeURIComponent("/rooms/join")}`);
    }
  }, [loading, user, router]);

  async function onJoin() {
    if (!user) return;
    if (!canSubmit) return;

    const rid = normalizeRoomId(roomId);
    if (!rid) {
      setError("Vui lòng nhập Room ID hợp lệ.");
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      const db = getFirestoreDb();
      const roomRef = doc(db, "rooms", rid);
      const roomSnap = await getDoc(roomRef);

      if (!roomSnap.exists()) {
        setError("Không tìm thấy phòng. Vui lòng kiểm tra Room ID.");
        return;
      }

      const room = roomSnap.data() as {
        ownerId?: string;
        ownerEmail?: string | null;
      };

      if (!room?.ownerId) {
        setError("Phòng không hợp lệ (thiếu ownerId).");
        return;
      }

      if (room.ownerId === user.uid) {
        setError("Bạn là chủ phòng, không thể tham gia phòng của chính mình.");
        return;
      }

      const myEmail = (user.email ?? "").toLowerCase();
      const ownerEmail = (room.ownerEmail ?? "").toLowerCase();
      if (ownerEmail && myEmail && ownerEmail === myEmail) {
        setError("Bạn phải dùng Gmail khác với tài khoản tạo phòng để tham gia.");
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

      router.push(`/rooms/${encodeURIComponent(rid)}/calendar`);
    } catch (e) {
      console.error("Join room failed", e);
      const anyErr = e as any;
      const code = typeof anyErr?.code === "string" ? anyErr.code : null;
      const message = typeof anyErr?.message === "string" ? anyErr.message : null;

      if (code || message) {
        setError(
          `Gia nhập thất bại: ${code ?? "unknown"}${message ? ` - ${message}` : ""}`
        );
      } else {
        setError("Gia nhập thất bại. Vui lòng thử lại.");
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
    <div className="min-h-screen bg-white px-6 py-10">
      <div className="mx-auto w-full max-w-lg rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="text-xl font-bold text-zinc-900">Nhập Id phòng</div>
        <div className="mt-1 text-sm text-zinc-500">Nhập id phòng để tham gia lớp học</div>

        <div className="mt-5">
          <label className="block text-sm font-semibold text-zinc-700">Id phòng</label>
          <input
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 outline-none focus:border-zinc-400"
            placeholder="Ví dụ: 428482dbda"
          />

          {error ? (
            <div className="mt-3 text-sm font-medium text-red-600">{error}</div>
          ) : null}

          <div className="mt-6 flex items-center justify-end gap-3">
            <button
              type="button"
              className="h-11 rounded-lg border border-zinc-300 bg-white px-5 text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
              onClick={() => router.push("/rooms")}
              disabled={submitting}
            >
              Hủy
            </button>
            <button
              type="button"
              className="h-11 rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              onClick={onJoin}
              disabled={!canSubmit || submitting}
            >
              {submitting ? "Đang tham gia..." : "Tham Gia"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
