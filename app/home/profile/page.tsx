"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { updateProfile } from "firebase/auth";

import { useAuth } from "@/app/providers";

export default function ProfilePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading } = useAuth();

  const roomId = searchParams.get("roomId");

  const initials = useMemo(() => {
    const base = (user?.displayName || user?.email || "U")
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase())
      .join("");
    return base || "U";
  }, [user?.displayName, user?.email]);

  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (user?.displayName) setDisplayName(user.displayName);
    else setDisplayName("");
  }, [user?.displayName]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <div className="text-sm font-medium text-zinc-600">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  async function onSave() {
    setSaved(false);
    setError(null);

    if (!user) return;

    const nextName = displayName.trim();
    if (!nextName) {
      setError("Vui lòng nhập tên hiển thị.");
      return;
    }

    setSaving(true);
    try {
      await updateProfile(user, { displayName: nextName });
      setSaved(true);
    } catch (e) {
      const anyErr = e as any;
      const msg = typeof anyErr?.message === "string" ? anyErr.message : "";
      setError(msg ? `Lưu thất bại: ${msg}` : "Lưu thất bại. Vui lòng thử lại.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
            onClick={() => {
              const next = roomId
                ? `/home/calendar?roomId=${encodeURIComponent(roomId)}`
                : "/home/calendar";
              router.push(next);
            }}
          >
            <svg
              viewBox="0 0 20 20"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 5l-5 5 5 5" />
            </svg>
            <span>Quay lại</span>
          </button>

          <div className="flex items-center gap-3">
            {user.photoURL ? (
              <img
                src={user.photoURL}
                alt="Avatar"
                className="h-8 w-8 rounded-lg object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-xs font-bold text-white">
                {initials}
              </div>
            )}
            <div className="min-w-0 text-left">
              <div className="truncate text-sm font-semibold text-zinc-900">
                {user.displayName ?? "(no name)"}
              </div>
              <div className="truncate text-xs text-zinc-500">{user.email}</div>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="text-center">
          <div className="text-2xl font-bold text-zinc-900">Quản lý thông tin cá nhân</div>
          <div className="mt-1 text-sm text-zinc-500">Cập nhật thông tin cá nhân</div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-12">
          <div className="md:col-span-4">
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
              <div className="text-sm font-semibold text-zinc-900">Ảnh đại diện</div>
              <div className="mt-5 flex items-center justify-center">
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt="Avatar"
                    className="h-32 w-32 rounded-xl object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="flex h-32 w-32 items-center justify-center rounded-xl bg-blue-600 text-3xl font-bold text-white">
                    {initials}
                  </div>
                )}
              </div>
              <div className="mt-4 text-center text-xs text-zinc-500">
                Ảnh đại diện được lấy từ tài khoản Google của bạn.
              </div>
            </div>
          </div>

          <div className="md:col-span-8">
            <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
              <div className="text-sm font-semibold text-zinc-900">Thông tin cá nhân</div>
              <div className="mt-1 text-xs text-zinc-500">Cập nhật thông tin cá nhân của bạn</div>

              <div className="mt-5">
                <label className="block text-xs font-semibold text-zinc-700">Tên hiển thị</label>
                <input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 outline-none focus:border-zinc-400"
                  placeholder="Nhập tên hiển thị"
                />
              </div>

              <div className="mt-4">
                <label className="block text-xs font-semibold text-zinc-700">Email</label>
                <input
                  value={user.email ?? ""}
                  disabled
                  className="mt-2 h-11 w-full cursor-not-allowed rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm font-medium text-zinc-700 outline-none"
                />
                <div className="mt-2 text-[11px] text-zinc-500">Email không thể thay đổi.</div>
              </div>

              {error ? <div className="mt-4 text-sm font-medium text-red-600">{error}</div> : null}
              {saved ? <div className="mt-4 text-sm font-medium text-green-700">Đã lưu thay đổi.</div> : null}

              <div className="mt-6 flex items-center justify-end">
                <button
                  type="button"
                  className="inline-flex h-11 items-center justify-center rounded-lg bg-blue-600 px-6 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"
                  onClick={onSave}
                  disabled={saving}
                >
                  Lưu thay đổi
                </button>
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold text-zinc-900">Tài khoản ngân hàng (Đang trong thời gian update)</div>
                  <div className="mt-1 text-xs text-zinc-500">Quản lý danh sách tài khoản ngân hàng và QA thanh toán</div>
                </div>
                <button
                  type="button"
                  className="inline-flex h-9 items-center justify-center rounded-lg bg-blue-600 px-4 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
                >
                  + Thêm tài khoản
                </button>
              </div>

              <div className="mt-6 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-6 text-center">
                <div className="text-sm font-medium text-zinc-600">Chưa có tài khoản ngân hàng nào</div>
                <button
                  type="button"
                  className="mt-4 inline-flex h-10 items-center justify-center rounded-lg border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
                >
                  + Thêm tài khoản đầu tiên
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
