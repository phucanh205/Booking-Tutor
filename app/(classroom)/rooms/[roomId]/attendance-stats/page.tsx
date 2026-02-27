"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import type { User } from "firebase/auth";

import { getFirestoreDb } from "@/lib/firebase";
import { useAuth } from "@/app/providers";
import { signOutUser } from "@/lib/auth";

type AttendanceStatus = "completed" | "absent";

type AttendanceLog = {
  id: string;
  slotId: string;
  bookingId: string;
  date: string;
  status: AttendanceStatus;
  note?: string | null;
  imageUrls?: string[];
  createdAt?: any;
  updatedAt?: any;
};

type Booking = {
  id: string;
  roomId: string;
  slotId: string;
  studentUid: string;
  studentName: string;
  studentPhone?: string;
  studentEmail?: string;
  subject: string;
  note?: string;
  status: "requested" | "approved" | "rejected";
  createdAt?: any;
};

type TeachingSlot = {
  id: string;
  roomId: string;
  dayOfWeek: string;
  startMin: number;
  endMin: number;
  status: "available" | "pending" | "booked";
  bookedBookingId?: string | null;
};

type HistoryRow = {
  id: string;
  date: string;
  startMin: number;
  endMin: number;
  subject: string;
  studentName: string;
  status: AttendanceStatus;
  note?: string | null;
  imageUrls: string[];
};

function minutesToTime(minutes: number) {
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export default function StudentAttendanceStatsPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params?.roomId;
  const router = useRouter();

  const { user, loading: authLoading } = useAuth();
  const [roomName, setRoomName] = useState<string>("");
  const [isOwner, setIsOwner] = useState<boolean | null>(null);

  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [slots, setSlots] = useState<TeachingSlot[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [logs, setLogs] = useState<AttendanceLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  const [historySearch, setHistorySearch] = useState("");
  const [historyStatus, setHistoryStatus] = useState<"all" | AttendanceStatus>("all");
  const [historySubject, setHistorySubject] = useState<string>("all");

  const [imagesOpen, setImagesOpen] = useState(false);
  const [imagesUrls, setImagesUrls] = useState<string[]>([]);

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      const el = userMenuRef.current;
      if (!el) return;
      if (el.contains(e.target as Node)) return;
      setUserMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const initials = useMemo(() => {
    if (!user?.displayName) return "";
    return user.displayName
      .split(" ")
      .map((n: string) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }, [user?.displayName]);

  async function onLogout() {
    try {
      await signOutUser();
      router.replace("/login");
    } catch (e) {
      console.error("Logout failed", e);
    }
  }

  // Load room info and check role
  useEffect(() => {
    if (!roomId || !user) return;

    async function init() {
      const db = getFirestoreDb();
      const roomRef = doc(db, "rooms", roomId);
      const roomSnap = await getDoc(roomRef);
      if (!roomSnap.exists()) return;
      const roomData = roomSnap.data();
      setRoomName(roomData?.name || "");
      const ownerId = roomData?.ownerId;
      setIsOwner(ownerId === user?.uid);
    }

    init();
  }, [roomId, user]);

  // Load slots
  useEffect(() => {
    if (!roomId || !user) return;
    const db = getFirestoreDb();
    const q = query(collection(db, "slots"), where("roomId", "==", roomId));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: TeachingSlot[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            roomId: data?.roomId || roomId,
            dayOfWeek: data?.dayOfWeek || "Monday",
            startMin: Number(data?.startMin ?? 0),
            endMin: Number(data?.endMin ?? 0),
            status: data?.status || "available",
            bookedBookingId: data?.bookedBookingId || null,
          };
        });
        setSlots(list);
      },
      (err) => console.error("Slots snapshot error", err)
    );
    return () => unsub();
  }, [roomId, user]);

  // Load bookings for current student
  useEffect(() => {
    if (!roomId || !user) return;
    const db = getFirestoreDb();
    const q = query(
      collection(db, "bookings"),
      where("studentUid", "==", user.uid),
      where("status", "==", "approved"),
      where("roomId", "==", roomId)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list: Booking[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            roomId: data?.roomId || roomId,
            slotId: data?.slotId || "",
            studentUid: data?.studentUid || "",
            studentName: data?.studentName || "",
            studentPhone: data?.studentPhone || "",
            studentEmail: data?.studentEmail || "",
            subject: data?.subject || "",
            note: data?.note || "",
            status: data?.status || "requested",
            createdAt: data?.createdAt,
          };
        });
        setBookings(list);
      },
      (err) => console.error("Bookings snapshot error", err)
    );
    return () => unsub();
  }, [roomId, user]);

  // Load attendance logs
  useEffect(() => {
    if (!roomId || !user) return;
    setLogsLoading(true);

    async function loadLogs() {
      try {
        const db = getFirestoreDb();
        const snap = await getDocs(collection(db, "rooms", roomId, "attendanceLogs"));
        const list: AttendanceLog[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            slotId: data?.slotId || "",
            bookingId: data?.bookingId || "",
            date: data?.date || "",
            status: data?.status || "completed",
            note: data?.note || null,
            imageUrls: data?.imageUrls || [],
            createdAt: data?.createdAt,
            updatedAt: data?.updatedAt,
          };
        });
        // Filter only logs for current student's bookings
        const myBookingIds = new Set(bookings.map((b) => b.id));
        const filtered = list.filter((log) => myBookingIds.has(log.bookingId));
        setLogs(filtered);
      } catch (e) {
        console.error("Load logs error", e);
      } finally {
        setLogsLoading(false);
      }
    }

    loadLogs();
  }, [roomId, user, bookings]);

  // Build history rows from logs
  const historyRows: HistoryRow[] = useMemo(() => {
    const slotById = new Map(slots.map((s) => [s.id, s]));
    const bookingById = new Map(bookings.map((b) => [b.id, b]));

    return logs.map((log) => {
      const slot = slotById.get(log.slotId);
      const booking = bookingById.get(log.bookingId);
      return {
        id: log.id,
        date: log.date,
        startMin: slot?.startMin ?? 0,
        endMin: slot?.endMin ?? 0,
        subject: booking?.subject || "",
        studentName: booking?.studentName || "",
        status: log.status,
        note: log.note,
        imageUrls: log.imageUrls || [],
      };
    });
  }, [logs, slots, bookings]);

  // Stats calculation
  const stats = useMemo(() => {
    const total = bookings.length;
    const attended = logs.filter((l) => l.status === "completed").length;
    const absent = logs.filter((l) => l.status === "absent").length;
    return { total, attended, absent };
  }, [bookings, logs]);

  // Filter history
  const filteredHistory = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    return historyRows
      .filter((r) => {
        if (historyStatus !== "all" && r.status !== historyStatus) return false;
        if (historySubject !== "all" && r.subject !== historySubject) return false;
        if (q) {
          const hay = `${r.subject} ${r.studentName}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date) || b.startMin - a.startMin);
  }, [historyRows, historySearch, historyStatus, historySubject]);

  const historySubjects = useMemo(() => {
    const set = new Set<string>();
    for (const r of historyRows) {
      if (r.subject) set.add(r.subject);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [historyRows]);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <div className="text-sm font-medium text-zinc-600">Loading...</div>
      </div>
    );
  }

  if (!user) return null;

  // Redirect owner to teacher attendance page
  if (isOwner === true) {
    router.replace(`/rooms/${encodeURIComponent(roomId!)}/attendance`);
    return null;
  }

  return (
    <div className="min-h-dvh bg-zinc-50 md:h-screen md:overflow-hidden">
      <div className="flex min-h-dvh md:h-screen">
        {sidebarOpen ? (
          <div
            className="fixed inset-0 z-[90] bg-black/40 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
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

          <nav className="px-3 pb-5">
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
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4 flex-none text-zinc-500 group-hover:text-zinc-700"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
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
                className="group flex w-full items-center gap-3 rounded-xl bg-blue-50 px-3 py-2.5 text-left text-sm font-semibold text-blue-700"
                onClick={() => setSidebarOpen(false)}
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4 flex-none text-blue-600"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M9 11l3 3L22 4" />
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
                <span className="flex-1">Thống kê điểm danh</span>
              </button>
            </div>
          </nav>
        </aside>

        <aside className="hidden w-64 border-r border-zinc-200 bg-zinc-50/70 md:block">
          <div className="px-4 py-5">
            <div className="flex items-center gap-2 rounded-lg px-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-sm font-semibold text-white">T</div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-zinc-900">Trang chủ</div>
                <div className="truncate text-xs text-zinc-500">Tạo Lịch dạy của bạn</div>
              </div>
            </div>
          </div>

          <nav className="px-3 pb-5">
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
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4 flex-none text-zinc-500 group-hover:text-zinc-700"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
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
                className="group flex w-full items-center gap-3 rounded-xl bg-blue-50 px-3 py-2.5 text-left text-sm font-semibold text-blue-700"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4 flex-none text-blue-600"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M9 11l3 3L22 4" />
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
                <span className="flex-1">Thống kê điểm danh</span>
              </button>
            </div>
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col md:overflow-hidden">
          <header className="border-b border-zinc-200 bg-white shadow-sm">
            <div className="flex items-center justify-between px-4 py-4 sm:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50 md:hidden"
                  onClick={() => setSidebarOpen(true)}
                  aria-label="Open menu"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M4 6h16" />
                    <path d="M4 12h16" />
                    <path d="M4 18h16" />
                  </svg>
                </button>

                <div className="min-w-0">
                  <div className="truncate text-xl font-bold text-zinc-900">Thống kê điểm danh{roomName ? ` - ${roomName}` : ""}</div>
                  {roomId ? <div className="mt-0.5 truncate text-xs text-zinc-500">Room: {roomId}</div> : null}
                </div>
              </div>
              <div className="relative overflow-visible" ref={userMenuRef}>
                <button
                  type="button"
                  onClick={() => setUserMenuOpen((v) => !v)}
                  className="inline-flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-100"
                >
                  {user.photoURL ? (
                    <img
                      src={user.photoURL}
                      alt="Avatar"
                      className="h-7 w-7 rounded object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div className="flex h-7 w-7 items-center justify-center rounded bg-blue-600 text-[11px] font-bold text-white">
                      {initials || "U"}
                    </div>
                  )}
                  <div className="hidden min-w-0 text-left sm:block">
                    <div className="truncate text-sm font-medium text-zinc-700">
                      {user.displayName ?? user.email ?? "User"}
                    </div>
                  </div>
                  <svg
                    viewBox="0 0 20 20"
                    className="h-4 w-4 text-zinc-500"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M5 7l5 6 5-6" />
                  </svg>
                </button>

                {userMenuOpen ? (
                  <div className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg">
                    <div className="px-4 py-3">
                      <div className="truncate text-sm font-semibold text-zinc-900">
                        {user.displayName ?? "(no name)"}
                      </div>
                      <div className="truncate text-xs text-zinc-500">{user.email}</div>
                    </div>
                    <div className="h-px bg-zinc-100" />
                    <button
                      type="button"
                      onClick={() => {
                        setUserMenuOpen(false);
                        const next = roomId
                          ? `/profile?roomId=${encodeURIComponent(roomId)}`
                          : "/profile";
                        router.push(next);
                      }}
                      className="flex w-full items-center px-4 py-2.5 text-left text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                    >
                      Thông tin cá nhân
                    </button>
                    <button
                      type="button"
                      onClick={onLogout}
                      className="flex w-full items-center px-4 py-2.5 text-left text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                    >
                      Đăng xuất
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </header>

          <main className="overflow-visible bg-zinc-50 px-4 py-6 sm:px-6 md:flex-1 md:overflow-auto">
            {/* Stats Cards */}
            <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Tổng số buổi phải học</div>
                    <div className="mt-1 text-2xl font-bold text-zinc-900">{stats.total}</div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Có mặt</div>
                    <div className="mt-1 text-2xl font-bold text-emerald-700">{stats.attended}</div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Vắng mặt</div>
                    <div className="mt-1 text-2xl font-bold text-orange-700">{stats.absent}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* History Table */}
            <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="text-base font-bold text-zinc-900">Lịch sử điểm danh</div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    placeholder="Tìm kiếm..."
                    className="h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 sm:w-56"
                  />

                  <select
                    value={historySubject}
                    onChange={(e) => setHistorySubject(e.target.value)}
                    className="h-9 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  >
                    <option value="all">Tên môn</option>
                    {historySubjects.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>

                  <select
                    value={historyStatus}
                    onChange={(e) => setHistoryStatus(e.target.value as any)}
                    className="h-9 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  >
                    <option value="all">Tình trạng</option>
                    <option value="completed">Có mặt</option>
                    <option value="absent">Vắng</option>
                  </select>
                </div>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-xs font-bold uppercase tracking-wide text-zinc-500">
                      <th className="px-3 py-2">Ngày</th>
                      <th className="px-3 py-2">Thời gian</th>
                      <th className="px-3 py-2">Môn Học</th>
                      <th className="px-3 py-2">Tình trạng</th>
                      <th className="px-3 py-2">Note</th>
                      <th className="px-3 py-2">Ảnh</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logsLoading ? (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-center text-sm font-medium text-zinc-500">
                          Đang tải...
                        </td>
                      </tr>
                    ) : filteredHistory.length ? (
                      filteredHistory.map((r) => (
                        <tr key={r.id} className="border-b border-zinc-100">
                          <td className="px-3 py-2 font-medium text-zinc-900">{r.date}</td>
                          <td className="px-3 py-2 text-zinc-700">
                            {minutesToTime(r.startMin)} - {minutesToTime(r.endMin)}
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-semibold text-zinc-900">{r.subject || "(Môn học)"}</div>
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={
                                r.status === "completed"
                                  ? "inline-flex rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700"
                                  : "inline-flex rounded-full bg-orange-100 px-3 py-1 text-xs font-bold text-orange-700"
                              }
                            >
                              {r.status === "completed" ? "Có mặt" : "Vắng"}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-zinc-700">{r.note || ""}</td>
                          <td className="px-3 py-2">
                            {r.imageUrls.length ? (
                              <button
                                type="button"
                                className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-bold text-zinc-800 hover:bg-zinc-50"
                                onClick={() => {
                                  setImagesUrls(r.imageUrls);
                                  setImagesOpen(true);
                                }}
                              >
                                <svg viewBox="0 0 24 24" className="h-4 w-4 text-zinc-500" fill="none" stroke="currentColor" strokeWidth="1.8">
                                  <path d="M21 15V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9" />
                                  <path d="M3 15l4-4a2 2 0 0 1 3 0l2 2" />
                                  <path d="M14 13l2-2a2 2 0 0 1 3 0l2 2" />
                                  <path d="M3 19h18" />
                                </svg>
                                Xem ảnh
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} className="px-3 py-6 text-center text-sm font-medium text-zinc-500">
                          Không có dữ liệu.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </main>
        </div>
      </div>

      {imagesOpen ? (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-3xl rounded-2xl bg-white p-5 shadow-lg">
            <div className="flex items-start justify-between">
              <div className="text-base font-bold text-zinc-900">Ảnh đã upload</div>
              <button
                type="button"
                className="rounded-lg px-2 py-1 text-zinc-500 hover:bg-zinc-100"
                onClick={() => {
                  setImagesOpen(false);
                  setImagesUrls([]);
                }}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {imagesUrls.map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-zinc-200">
                  <img src={url} alt="uploaded" className="h-40 w-full object-cover" />
                </a>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
