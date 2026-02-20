"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";

import { signOutUser } from "@/lib/auth";
import { useAuth } from "@/app/providers";
import { getFirestoreDb } from "@/lib/firebase";

type DayOfWeek =
  | "Monday"
  | "Tuesday"
  | "Wednesday"
  | "Thursday"
  | "Friday"
  | "Saturday"
  | "Sunday";

type SlotStatus = "available";

type TeachingSlot = {
  id: string;
  tutorId: string;
  roomId: string;
  dayOfWeek: DayOfWeek;
  startMin: number;
  endMin: number;
  status: SlotStatus;
  createdAt?: unknown;
};

function timeToMinutes(value: string) {
  const [h, m] = value.split(":");
  const hh = Number(h);
  const mm = Number(m);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23) return null;
  if (mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function minutesToTime(min: number) {
  const hh = Math.floor(min / 60);
  const mm = min % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && aEnd > bStart;
}

export default function RoomCalendarPage() {
  const router = useRouter();
  const params = useParams();
  const { user, loading } = useAuth();
  const roomId = typeof params?.roomId === "string" ? params.roomId : null;

  const [memberRole, setMemberRole] = useState<"owner" | "student" | null>(null);
  const isOwner = memberRole === "owner";

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  const [selectedDate, setSelectedDate] = useState<Date>(() => new Date());
  const mainCalendarRef = useRef<HTMLDivElement | null>(null);
  const [rangeFlash, setRangeFlash] = useState(false);

  const [miniMonthOffset, setMiniMonthOffset] = useState(0);
  const miniMonthInputRef = useRef<HTMLInputElement | null>(null);

  const [createSlotOpen, setCreateSlotOpen] = useState(false);
  const [slotDay, setSlotDay] = useState<DayOfWeek>("Monday");
  const [slotStart, setSlotStart] = useState("14:00");
  const [slotEnd, setSlotEnd] = useState("15:00");
  const [slotSubmitting, setSlotSubmitting] = useState(false);
  const [slotError, setSlotError] = useState<string | null>(null);

  const [slots, setSlots] = useState<TeachingSlot[]>([]);

  useEffect(() => {
    if (!loading && !user) {
      const next = roomId ? `/rooms/${encodeURIComponent(roomId)}/calendar` : "/rooms";
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    }
  }, [loading, user, router, roomId]);

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

  useEffect(() => {
    setRangeFlash(true);
    const t = window.setTimeout(() => setRangeFlash(false), 450);
    return () => window.clearTimeout(t);
  }, [selectedDate]);

  useEffect(() => {
    async function loadMemberRole() {
      if (!user) return;
      if (!roomId) return;
      try {
        const db = getFirestoreDb();
        const memberRef = doc(db, `rooms/${roomId}/members`, user.uid);
        const snap = await getDoc(memberRef);
        const data = snap.exists() ? (snap.data() as any) : null;
        const role = typeof data?.role === "string" ? data.role : null;
        setMemberRole(role === "owner" ? "owner" : "student");
      } catch (e) {
        console.error("Load member role failed", e);
        setMemberRole(null);
      }
    }

    loadMemberRole();
  }, [user, roomId]);

  useEffect(() => {
    async function loadSlots() {
      if (!user) return;
      if (!roomId) return;

      try {
        const db = getFirestoreDb();
        const q = query(collection(db, "slots"), where("roomId", "==", roomId));
        const snap = await getDocs(q);
        const items = snap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            tutorId: data.tutorId,
            roomId: data.roomId,
            dayOfWeek: data.dayOfWeek,
            startMin: Number(data.startMin),
            endMin: Number(data.endMin),
            status: data.status,
            createdAt: data.createdAt,
          } as TeachingSlot;
        });
        setSlots(items);
      } catch (e) {
        console.error("Load slots failed", e);
      }
    }

    loadSlots();
  }, [user, roomId]);

  async function onCreateSlot() {
    if (!user) return;
    if (!roomId) {
      setSlotError("Bạn chưa chọn phòng. Vui lòng tạo/chọn phòng trước.");
      return;
    }

    if (!isOwner) {
      setSlotError("Chỉ chủ phòng mới có thể tạo slot.");
      return;
    }

    setSlotError(null);

    const startMin = timeToMinutes(slotStart);
    const endMin = timeToMinutes(slotEnd);

    if (!slotDay || startMin == null || endMin == null) {
      setSlotError("Vui lòng nhập đầy đủ Ngày / Start time / End time.");
      return;
    }

    if (startMin >= endMin) {
      setSlotError("Start time phải nhỏ hơn End time.");
      return;
    }

    const sameDay = slots.filter((s) => s.dayOfWeek === slotDay);
    const conflict = sameDay.find((s) => overlaps(startMin, endMin, s.startMin, s.endMin));
    if (conflict) {
      setSlotError(
        `Khung giờ bị trùng với slot hiện có (${minutesToTime(conflict.startMin)}–${minutesToTime(conflict.endMin)}).`
      );
      return;
    }

    setSlotSubmitting(true);
    try {
      const db = getFirestoreDb();
      const ref = await addDoc(collection(db, "slots"), {
        tutorId: user.uid,
        roomId,
        dayOfWeek: slotDay,
        startMin,
        endMin,
        status: "available",
        createdAt: serverTimestamp(),
      });

      setSlots((prev) => [
        ...prev,
        {
          id: ref.id,
          tutorId: user.uid,
          roomId,
          dayOfWeek: slotDay,
          startMin,
          endMin,
          status: "available",
        },
      ]);

      setCreateSlotOpen(false);
    } catch (e) {
      console.error("Create slot failed", e);
      const anyErr = e as any;
      const msg = typeof anyErr?.message === "string" ? anyErr.message : "";
      setSlotError(msg ? `Tạo slot thất bại: ${msg}` : "Tạo slot thất bại. Vui lòng thử lại.");
    } finally {
      setSlotSubmitting(false);
    }
  }

  async function onLogout() {
    await signOutUser();
    router.replace("/login");
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

  const initials = (user.displayName || user.email || "U")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");

  const now = new Date();
  const miniMonthStart = new Date(now.getFullYear(), now.getMonth() + miniMonthOffset, 1);
  const miniMonthEnd = new Date(now.getFullYear(), now.getMonth() + miniMonthOffset + 1, 0);

  const daysInMonth = miniMonthEnd.getDate();
  const monthLabel = miniMonthStart.toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });

  const mondayFirstIndex = (miniMonthStart.getDay() + 6) % 7;
  const monthCells = Array.from({ length: 42 }).map((_, i) => {
    const day = i - mondayFirstIndex + 1;
    return day >= 1 && day <= daysInMonth ? day : null;
  });

  function onMiniCalendarPickDay(day: number) {
    const next = new Date(miniMonthStart.getFullYear(), miniMonthStart.getMonth(), day);
    next.setHours(0, 0, 0, 0);
    setSelectedDate(next);
    requestAnimationFrame(() => {
      mainCalendarRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  const weekdayShort: Record<DayOfWeek, string> = {
    Monday: "Mon",
    Tuesday: "Tue",
    Wednesday: "Wed",
    Thursday: "Thu",
    Friday: "Fri",
    Saturday: "Sat",
    Sunday: "Sun",
  };

  const dayOfWeekFromDate = (d: Date): DayOfWeek => {
    const js = d.getDay();
    const map: DayOfWeek[] = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    return map[js] as DayOfWeek;
  };

  const rangeStart = (() => {
    const d = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
    d.setHours(0, 0, 0, 0);
    return d;
  })();

  const rangeEnd = (() => {
    const d = new Date(rangeStart);
    d.setDate(rangeStart.getDate() + 6);
    return d;
  })();

  const weekDays: { key: DayOfWeek; w: string; d: string; date: Date }[] = Array.from(
    { length: 7 }
  ).map((_, i) => {
    const date = new Date(rangeStart);
    date.setDate(rangeStart.getDate() + i);
    const key = dayOfWeekFromDate(date);
    return {
      key,
      w: weekdayShort[key],
      d: String(date.getDate()),
      date,
    };
  });

  const rangeLabel = (() => {
    const startW = weekDays[0]?.w ?? "";
    const endW = weekDays[6]?.w ?? "";
    const startD = weekDays[0]?.d ?? "";
    const endD = weekDays[6]?.d ?? "";
    const endMonthYear = rangeEnd.toLocaleString(undefined, {
      month: "short",
      year: "numeric",
    });
    return `${startW} ${startD} – ${endW} ${endD} ${endMonthYear}`;
  })();

  function shiftRange(days: number) {
    const next = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
    next.setDate(next.getDate() + days);
    next.setHours(0, 0, 0, 0);
    setSelectedDate(next);
  }

  const rowHeight = 60;
  const pixelsPerMinute = rowHeight / 60;
  const gridStartMin = 0;
  const gridEndMin = 24 * 60;

  const slotsByDayIndex = weekDays.map((d) => {
    const daySlots = slots
      .filter((s) => s.dayOfWeek === d.key)
      .slice()
      .sort((a, b) => a.startMin - b.startMin)
      .map((s) => {
        const top = (s.startMin - gridStartMin) * pixelsPerMinute;
        const height = (s.endMin - s.startMin) * pixelsPerMinute;
        return {
          id: s.id,
          top,
          height,
          startMin: s.startMin,
          endMin: s.endMin,
          status: s.status,
        };
      });
    return { dayKey: d.key, slots: daySlots };
  });

  return (
    <div className="h-screen overflow-hidden bg-zinc-50">
      <div className="flex h-screen">
        <aside className="w-64 border-r border-zinc-200 bg-zinc-50/70">
          <div className="px-4 py-5">
            <div className="flex items-center gap-2 rounded-lg px-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-sm font-semibold text-white">
                T
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-zinc-900">Trang chủ</div>
                <div className="truncate text-xs text-zinc-500">Tạo Lịch dạy của bạn</div>
              </div>
            </div>
          </div>

          <nav className="px-3 pb-5">
            <div className="space-y-2">
              <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
                Tổng quan
              </div>

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
                  <path d="M9 11l3 3L22 4" />
                  <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                </svg>
                <span className="flex-1">Điểm danh</span>
              </button>
            </div>
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="border-b border-zinc-200 bg-white shadow-sm">
            <div className="flex items-center justify-between px-6 py-4">
              <div className="min-w-0">
                <div className="truncate text-xl font-bold text-zinc-900">Lịch Dạy</div>
                {roomId ? (
                  <div className="mt-0.5 flex min-w-0 items-center gap-2">
                    <div className="truncate text-xs text-zinc-500">Room: {roomId}</div>
                    <button
                      type="button"
                      className="shrink-0 rounded-md border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-50"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(roomId);
                        } catch (e) {
                          console.error("Copy roomId failed", e);
                        }
                      }}
                    >
                      Copy
                    </button>
                  </div>
                ) : null}
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

            <div className="border-t border-zinc-200/70" />

            <div className="flex items-center justify-between gap-4 px-6 py-3">
              <div className="flex items-center gap-1.5 rounded-lg bg-zinc-50 px-1.5 py-1">
                <button
                  type="button"
                  onClick={() => shiftRange(-7)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                  aria-label="Previous"
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
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSelectedDate(new Date());
                    setMiniMonthOffset(0);
                  }}
                  className="h-9 rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  Today
                </button>

                <button
                  type="button"
                  onClick={() => shiftRange(7)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                  aria-label="Next"
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
                    <path d="M8 5l5 5-5 5" />
                  </svg>
                </button>

                <div className="ml-2 whitespace-nowrap text-sm font-medium text-zinc-700">{rangeLabel}</div>
              </div>

              <div className="flex items-center gap-3">
                {isOwner ? (
                  <button
                    type="button"
                    className="inline-flex h-10 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
                    onClick={() => {
                      setSlotError(null);
                      setCreateSlotOpen(true);
                    }}
                  >
                    + Tạo slot
                  </button>
                ) : null}
              </div>
            </div>
          </header>

          <main className="min-w-0 flex-1 overflow-hidden px-6 py-6">
            <div className="grid h-full grid-cols-12 gap-4">
              <div className="col-span-12 lg:col-span-3">
                <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => miniMonthInputRef.current?.showPicker?.()}
                        className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-semibold text-zinc-900 hover:bg-zinc-50"
                      >
                        <span>{monthLabel}</span>
                        <svg
                          viewBox="0 0 20 20"
                          className="h-4 w-4 text-zinc-500"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M5 7l5 6 5-6" />
                        </svg>
                      </button>
                      <input
                        ref={miniMonthInputRef}
                        type="month"
                        value={`${miniMonthStart.getFullYear()}-${String(miniMonthStart.getMonth() + 1).padStart(2, "0")}`}
                        onChange={(e) => {
                          const v = e.target.value;
                          const m = /^([0-9]{4})-([0-9]{2})$/.exec(v);
                          if (!m) return;
                          const yy = Number(m[1]);
                          const mm = Number(m[2]) - 1;
                          if (!Number.isFinite(yy) || !Number.isFinite(mm)) return;
                          const offset = (yy - now.getFullYear()) * 12 + (mm - now.getMonth());
                          setMiniMonthOffset(offset);
                        }}
                        className="sr-only"
                      />
                    </div>
                    <div className="text-xs font-medium text-zinc-400">GMT+7</div>
                  </div>

                  <div className="mt-4 grid grid-cols-7 text-center text-[11px] font-semibold text-zinc-500">
                    {["M", "T", "W", "T", "F", "S", "S"].map((d, idx) => (
                      <div key={`${d}-${idx}`} className="py-1">
                        {d}
                      </div>
                    ))}
                  </div>

                  <div className="mt-2 overflow-hidden rounded-xl border border-zinc-200">
                    <div className="grid grid-cols-7">
                      {monthCells.map((day, i) => {
                        const isToday =
                          day != null &&
                          day === now.getDate() &&
                          now.getMonth() === miniMonthStart.getMonth() &&
                          now.getFullYear() === miniMonthStart.getFullYear();

                        return (
                          <button
                            key={i}
                            type="button"
                            className="flex h-9 items-center justify-center border-b border-r border-zinc-100 last:border-r-0"
                            onClick={day != null ? () => onMiniCalendarPickDay(day) : undefined}
                            disabled={day == null}
                          >
                            {day != null ? (
                              <div
                                className={
                                  isToday
                                    ? "flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-[12px] font-semibold text-white"
                                    : "flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-medium text-zinc-700"
                                }
                              >
                                {day}
                              </div>
                            ) : (
                              <div className="h-7 w-7" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-4 flex items-center gap-4 text-xs font-medium text-zinc-600">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-green-500" />
                      <span>Trống</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-yellow-400" />
                      <span>Chờ duyệt</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-zinc-800" />
                      <span>Xác nhận</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="col-span-12 lg:col-span-9 min-h-0">
                <div
                  ref={mainCalendarRef}
                  className={`flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border bg-white shadow-sm transition-[box-shadow,border-color] duration-300 ${
                    rangeFlash
                      ? "border-blue-300 shadow-[0_0_0_3px_rgba(59,130,246,0.18)]"
                      : "border-zinc-200"
                  }`}
                >
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    <div
                      className="sticky top-0 z-20 border-b border-zinc-200 bg-white"
                      style={{
                        display: "grid",
                        gridTemplateColumns: "96px repeat(7, minmax(0, 1fr))",
                      }}
                    >
                      <div className="border-r border-zinc-100 px-4 py-3 text-xs font-semibold text-zinc-500">
                        Time
                      </div>
                      {weekDays.map((x, i) => (
                        <div
                          key={`${x.w}-${x.d}`}
                          className={`box-border px-3 py-2 ${i === 0 ? "" : "border-l border-zinc-100"}`}
                        >
                          <div className="text-[11px] font-semibold text-zinc-500">{x.w}</div>
                          <div className="mt-0.5 text-sm font-semibold text-zinc-900">{x.d}</div>
                        </div>
                      ))}
                    </div>

                    <div
                      className="grid bg-white"
                      style={{
                        gridTemplateColumns: "96px repeat(7, minmax(0, 1fr))",
                        gridTemplateRows: `repeat(24, ${rowHeight}px)`,
                      }}
                    >
                      {Array.from({ length: 24 }).map((_, h) => (
                        <div
                          key={`time-${h}`}
                          className="relative border-r border-zinc-100 border-t border-zinc-200"
                          style={{ gridColumn: 1, gridRow: h + 1 }}
                        >
                          <div className="pointer-events-none absolute inset-0 flex items-start justify-end pr-4">
                            {h === 0 ? null : (
                              <span className="-translate-y-1/2 bg-white px-1 text-xs font-medium leading-none text-zinc-500">
                                {String(h).padStart(2, "0")}:00
                              </span>
                            )}
                          </div>
                        </div>
                      ))}

                      {Array.from({ length: 24 * 7 }).map((_, idx) => {
                        const h = Math.floor(idx / 7);
                        const dayIdx = idx % 7;
                        return (
                          <div
                            key={`cell-${h}-${dayIdx}`}
                            className={`border-t border-zinc-200 ${dayIdx === 0 ? "" : "border-l border-zinc-100"}`}
                            style={{ gridColumn: dayIdx + 2, gridRow: h + 1 }}
                          />
                        );
                      })}

                      {weekDays.map((d, dayIdx) => {
                        const daySlots = slotsByDayIndex[dayIdx]?.slots ?? [];

                        return (
                          <div
                            key={`slots-col-${d.key}`}
                            className="relative z-10 h-full"
                            style={{
                              gridColumn: dayIdx + 2,
                              gridRow: `1 / span 24`,
                            }}
                          >
                            {daySlots.map((s) => (
                              <div
                                key={s.id}
                                className="absolute left-1 right-1 overflow-hidden rounded-lg border border-green-200 bg-green-50 px-2 py-1 text-xs font-semibold text-green-700 shadow-sm"
                                style={{
                                  top: s.top,
                                  height: s.height,
                                }}
                              >
                                <div className="truncate">Trống</div>
                                <div className="mt-0.5 truncate text-[11px] font-medium text-green-700/80">
                                  {minutesToTime(s.startMin)}–{minutesToTime(s.endMin)}
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>

      {createSlotOpen && isOwner ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-lg">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xl font-bold text-zinc-900">Tạo slot</div>
                <div className="mt-1 text-sm text-zinc-500">Chọn thời gian để tạo slot cho học sinh</div>
              </div>
              <button
                type="button"
                className="rounded-lg px-2 py-1 text-zinc-500 hover:bg-zinc-100"
                onClick={() => setCreateSlotOpen(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="mt-5">
              <label className="block text-sm font-semibold text-zinc-700">Ngày</label>
              <select
                value={slotDay}
                onChange={(e) => setSlotDay(e.target.value as DayOfWeek)}
                className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 outline-none focus:border-zinc-400"
              >
                {(
                  [
                    "Monday",
                    "Tuesday",
                    "Wednesday",
                    "Thursday",
                    "Friday",
                    "Saturday",
                    "Sunday",
                  ] as DayOfWeek[]
                ).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-semibold text-zinc-700">Start time</label>
                <input
                  type="time"
                  value={slotStart}
                  onChange={(e) => setSlotStart(e.target.value)}
                  className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 outline-none focus:border-zinc-400"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-zinc-700">End time</label>
                <input
                  type="time"
                  value={slotEnd}
                  onChange={(e) => setSlotEnd(e.target.value)}
                  className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 outline-none focus:border-zinc-400"
                />
              </div>
            </div>

            {slotError ? <div className="mt-4 text-sm font-medium text-red-600">{slotError}</div> : null}

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                className="h-11 rounded-lg border border-zinc-200 bg-white px-5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
                onClick={() => setCreateSlotOpen(false)}
                disabled={slotSubmitting}
              >
                Hủy
              </button>
              <button
                type="button"
                className="h-11 rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                onClick={onCreateSlot}
                disabled={slotSubmitting}
              >
                {slotSubmitting ? "Đang tạo..." : "Tạo slot"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
