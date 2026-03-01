"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";

import { useAuth } from "@/app/providers";
import { getFirestoreDb } from "@/lib/firebase";

type SlotStatus = "available" | "pending" | "booked";

type DayOfWeek =
  | "Monday"
  | "Tuesday"
  | "Wednesday"
  | "Thursday"
  | "Friday"
  | "Saturday"
  | "Sunday";

type TeachingSlot = {
  id: string;
  roomId: string;
  tutorId: string;
  dayOfWeek: DayOfWeek;
  startMin: number;
  endMin: number;
  status: SlotStatus;
  pendingBookingId: string | null;
  bookedBookingId: string | null;
};

type BookingLite = {
  id: string;
  studentUid: string;
  studentName: string;
  studentEmail: string;
  studentPhone: string;
  subject: string;
  note: string | null;
};

type AttendanceStatus = "completed" | "absent";

type AttendanceLog = {
  id: string;
  roomId: string;
  slotId: string;
  bookingId: string;
  date: string; // YYYY-MM-DD
  status: AttendanceStatus;
  note: string | null;
  imageUrls: string[];
  createdAt: any;
  createdBy: string;
};

type HistoryRow = {
  id: string;
  date: string;
  startMin: number;
  endMin: number;
  subject: string;
  studentName: string;
  status: AttendanceStatus;
  note: string | null;
  imageUrls: string[];
};

function minutesToTime(min: number) {
  const hh = Math.floor(min / 60);
  const mm = min % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function dateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfDay(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setHours(0, 0, 0, 0);
  return x;
}

function dayOfWeekFromDate(date: Date): DayOfWeek {
  const js = date.getDay();
  const map: Record<number, DayOfWeek> = {
    0: "Sunday",
    1: "Monday",
    2: "Tuesday",
    3: "Wednesday",
    4: "Thursday",
    5: "Friday",
    6: "Saturday",
  };
  return map[js];
}

function normalizeDayOfWeek(value: unknown): DayOfWeek | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;

  const direct = raw as DayOfWeek;
  if (
    direct === "Monday" ||
    direct === "Tuesday" ||
    direct === "Wednesday" ||
    direct === "Thursday" ||
    direct === "Friday" ||
    direct === "Saturday" ||
    direct === "Sunday"
  ) {
    return direct;
  }

  const lower = raw.toLowerCase();
  const map: Record<string, DayOfWeek> = {
    mon: "Monday",
    monday: "Monday",
    tue: "Tuesday",
    tues: "Tuesday",
    tuesday: "Tuesday",
    wed: "Wednesday",
    weds: "Wednesday",
    wednesday: "Wednesday",
    thu: "Thursday",
    thur: "Thursday",
    thurs: "Thursday",
    thursday: "Thursday",
    fri: "Friday",
    friday: "Friday",
    sat: "Saturday",
    saturday: "Saturday",
    sun: "Sunday",
    sunday: "Sunday",
  };
  return map[lower] ?? null;
}

async function uploadToCloudinary(file: File) {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || "";
  const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET || "";

  if (!cloudName || !uploadPreset) {
    throw new Error("missing_cloudinary_env");
  }

  const form = new FormData();
  form.append("file", file);
  form.append("upload_preset", uploadPreset);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, {
    method: "POST",
    body: form,
  });

  const data = (await res.json().catch(() => null)) as any;
  if (!res.ok) {
    throw new Error(typeof data?.error?.message === "string" ? data.error.message : `cloudinary_${res.status}`);
  }

  const url = typeof data?.secure_url === "string" ? data.secure_url : "";
  if (!url) throw new Error("cloudinary_no_url");
  return url;
}

export default function RoomAttendancePage() {
  const router = useRouter();
  const params = useParams();
  const { user, loading } = useAuth();

  const roomId = typeof params?.roomId === "string" ? params.roomId : null;

  const [memberRole, setMemberRole] = useState<"owner" | "student" | null>(null);
  const isOwner = memberRole === "owner";

  const [roomName, setRoomName] = useState<string>("");

  const [slots, setSlots] = useState<TeachingSlot[]>([]);
  const [bookingById, setBookingById] = useState<Record<string, BookingLite | null>>({});

  const [logsByKey, setLogsByKey] = useState<Record<string, AttendanceLog>>({});
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [historySearch, setHistorySearch] = useState("");
  const [historyStatus, setHistoryStatus] = useState<"all" | AttendanceStatus>("all");
  const [historySubject, setHistorySubject] = useState<string>("all");

  const [imagesOpen, setImagesOpen] = useState(false);
  const [imagesUrls, setImagesUrls] = useState<string[]>([]);

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  const [sidebarOpen, setSidebarOpen] = useState(false);

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
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }, [user?.displayName]);

  async function onLogout() {
    try {
      const { signOutUser } = await import("@/lib/auth");
      await signOutUser();
      router.replace("/login");
    } catch (e) {
      console.error("Logout failed", e);
    }
  }

  const [tab, setTab] = useState<"upcoming" | "history">("upcoming");

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmStatus, setConfirmStatus] = useState<AttendanceStatus | null>(null);
  const [confirmSlotId, setConfirmSlotId] = useState<string | null>(null);
  const [confirmBookingId, setConfirmBookingId] = useState<string | null>(null);
  const [confirmDate, setConfirmDate] = useState<string | null>(null);

  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState<string>("");
  const [noteImages, setNoteImages] = useState<string[]>([]);
  const [noteUploading, setNoteUploading] = useState(false);
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
      } catch {
        setMemberRole(null);
      }
    }

    loadMemberRole();
  }, [user, roomId]);

  useEffect(() => {
    async function loadRoomName() {
      if (!user) return;
      if (!roomId) return;
      try {
        const db = getFirestoreDb();
        const snap = await getDoc(doc(db, "rooms", roomId));
        const data = snap.exists() ? (snap.data() as any) : null;
        setRoomName(typeof data?.name === "string" ? data.name : "");
      } catch {
        setRoomName("");
      }
    }

    loadRoomName();
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
            dayOfWeek: normalizeDayOfWeek(data.dayOfWeek) ?? "Monday",
            startMin: Number(data.startMin),
            endMin: Number(data.endMin),
            status: (data.status === "pending" || data.status === "booked" ? data.status : "available") as SlotStatus,
            pendingBookingId: typeof data?.pendingBookingId === "string" ? data.pendingBookingId : null,
            bookedBookingId: typeof data?.bookedBookingId === "string" ? data.bookedBookingId : null,
          } satisfies TeachingSlot;
        });
        setSlots(items);
      } catch (e) {
        console.error("Load slots failed", e);
      }
    }

    loadSlots();
  }, [user, roomId]);

  useEffect(() => {
    async function loadBookingsForSlots() {
      if (!user) return;
      if (!roomId) return;
      if (!slots.length) return;

      const db = getFirestoreDb();
      const bookingIds = Array.from(
        new Set(
          slots
            .map((s) => (s.status === "booked" ? s.bookedBookingId : null))
            .filter((x): x is string => typeof x === "string" && !!x)
        )
      ).filter((id) => !(id in bookingById));

      if (!bookingIds.length) return;

      try {
        const results = await Promise.all(
          bookingIds.map(async (id) => {
            try {
              const snap = await getDoc(doc(db, "bookings", id));
              if (!snap.exists()) return [id, null] as const;
              const data = snap.data() as any;
              return [
                id,
                {
                  id,
                  studentUid: typeof data?.studentUid === "string" ? data.studentUid : "",
                  studentName: typeof data?.studentName === "string" ? data.studentName : "",
                  studentEmail: typeof data?.studentEmail === "string" ? data.studentEmail : "",
                  studentPhone: typeof data?.studentPhone === "string" ? data.studentPhone : "",
                  subject: typeof data?.subject === "string" ? data.subject : "",
                  note: typeof data?.note === "string" ? data.note : null,
                } satisfies BookingLite,
              ] as const;
            } catch {
              return [id, null] as const;
            }
          })
        );

        setBookingById((prev) => {
          const next = { ...prev };
          for (const [id, booking] of results) next[id] = booking;
          return next;
        });
      } catch (e) {
        console.error("Load bookings failed", e);
      }
    }

    loadBookingsForSlots();
  }, [user, roomId, slots, bookingById]);

  const days = useMemo(() => {
    const today = startOfDay(new Date());
    const end = startOfDay(new Date(today));
    const js = today.getDay();
    const deltaToSunday = (7 - js) % 7;
    end.setDate(today.getDate() + deltaToSunday);

    const out: { date: Date; key: string; dayKey: DayOfWeek }[] = [];
    const cur = new Date(today);
    while (cur.getTime() <= end.getTime()) {
      out.push({ date: new Date(cur), key: dateKey(cur), dayKey: dayOfWeekFromDate(cur) });
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }, []);

  const todayKey = useMemo(() => dateKey(startOfDay(new Date())), []);

  useEffect(() => {
    async function loadLogs() {
      if (!user) return;
      if (!roomId) return;
      if (!isOwner) return;
      const dates = days.map((d) => d.key);
      if (!dates.length) return;

      try {
        const db = getFirestoreDb();
        const logsRef = collection(db, `rooms/${roomId}/attendanceLogs`);
        const q = query(logsRef, where("date", "in", dates));
        const snap = await getDocs(q);
        const map: Record<string, AttendanceLog> = {};
        for (const d of snap.docs) {
          const data = d.data() as any;
          const slotId = typeof data?.slotId === "string" ? data.slotId : "";
          const bookingId = typeof data?.bookingId === "string" ? data.bookingId : "";
          const date = typeof data?.date === "string" ? data.date : "";
          const status = data?.status === "absent" ? "absent" : "completed";
          if (!slotId || !bookingId || !date) continue;
          map[`${date}_${slotId}_${bookingId}`] = {
            id: d.id,
            roomId,
            slotId,
            bookingId,
            date,
            status,
            note: typeof data?.note === "string" ? data.note : null,
            imageUrls: Array.isArray(data?.imageUrls) ? data.imageUrls.filter((x: any) => typeof x === "string") : [],
            createdAt: data?.createdAt,
            createdBy: typeof data?.createdBy === "string" ? data.createdBy : "",
          };
        }
        setLogsByKey(map);
      } catch (e) {
        console.error("Load attendance logs failed", e);
      }
    }

    loadLogs();
  }, [user, roomId, isOwner, days]);

  useEffect(() => {
    async function loadHistory() {
      if (!user) return;
      if (!roomId) return;
      if (!isOwner) return;
      if (tab !== "history") return;

      setHistoryLoading(true);
      setHistoryError(null);
      try {
        const db = getFirestoreDb();
        const logsRef = collection(db, `rooms/${roomId}/attendanceLogs`);
        const q = query(logsRef, orderBy("createdAt", "desc"), limit(200));
        const snap = await getDocs(q);

        const logs = snap.docs
          .map((d) => {
            const data = d.data() as any;
            const slotId = typeof data?.slotId === "string" ? data.slotId : "";
            const bookingId = typeof data?.bookingId === "string" ? data.bookingId : "";
            const date = typeof data?.date === "string" ? data.date : "";
            const status = data?.status === "absent" ? "absent" : "completed";
            if (!slotId || !bookingId || !date) return null;
            return {
              id: d.id,
              slotId,
              bookingId,
              date,
              status,
              note: typeof data?.note === "string" ? data.note : null,
              imageUrls: Array.isArray(data?.imageUrls) ? data.imageUrls.filter((x: any) => typeof x === "string") : [],
            } as const;
          })
          .filter((x): x is NonNullable<typeof x> => !!x);

        const slotIds = Array.from(new Set(logs.map((l) => l.slotId)));
        const bookingIds = Array.from(new Set(logs.map((l) => l.bookingId)));

        const [slotSnaps, bookingSnaps] = await Promise.all([
          Promise.all(
            slotIds.map(async (id) => {
              try {
                return await getDoc(doc(db, "slots", id));
              } catch {
                return null;
              }
            })
          ),
          Promise.all(
            bookingIds.map(async (id) => {
              try {
                return await getDoc(doc(db, "bookings", id));
              } catch {
                return null;
              }
            })
          ),
        ]);

        const slotById = new Map(
          slotSnaps
            .filter((s): s is NonNullable<typeof s> => !!s && (s as any).exists?.())
            .map((s) => {
              const data = (s as any).data?.() as any;
              return [
                (s as any).id as string,
                {
                  startMin: Number(data?.startMin ?? 0),
                  endMin: Number(data?.endMin ?? 0),
                },
              ] as const;
            })
        );

        const bookingByIdLocal = new Map(
          bookingSnaps
            .filter((b): b is NonNullable<typeof b> => !!b && (b as any).exists?.())
            .map((b) => {
              const data = (b as any).data?.() as any;
              return [
                (b as any).id as string,
                {
                  subject: typeof data?.subject === "string" ? data.subject : "",
                  studentName: typeof data?.studentName === "string" ? data.studentName : "",
                },
              ] as const;
            })
        );

        const rows: HistoryRow[] = logs.map((l) => {
          const slot = slotById.get(l.slotId);
          const booking = bookingByIdLocal.get(l.bookingId);
          return {
            id: l.id,
            date: l.date,
            startMin: slot?.startMin ?? 0,
            endMin: slot?.endMin ?? 0,
            subject: booking?.subject ?? "",
            studentName: booking?.studentName ?? "",
            status: l.status,
            note: l.note,
            imageUrls: l.imageUrls,
          };
        });

        setHistoryRows(rows);
      } catch (e) {
        console.error("Load history failed", e);
        setHistoryError("Không thể tải lịch sử điểm danh.");
      } finally {
        setHistoryLoading(false);
      }
    }

    loadHistory();
  }, [user, roomId, isOwner, tab]);

  async function saveLog(args: {
    slotId: string;
    bookingId: string;
    date: string;
    status: AttendanceStatus;
    note: string | null;
    imageUrls: string[];
  }) {
    if (!user) return;
    if (!roomId) return;
    if (!isOwner) return;

    const db = getFirestoreDb();
    const logsRef = collection(db, `rooms/${roomId}/attendanceLogs`);
    const ref = await addDoc(logsRef, {
      roomId,
      slotId: args.slotId,
      bookingId: args.bookingId,
      date: args.date,
      status: args.status,
      note: args.note,
      imageUrls: args.imageUrls,
      createdAt: serverTimestamp(),
      createdBy: user.uid,
    });

    setLogsByKey((prev) => {
      const key = `${args.date}_${args.slotId}_${args.bookingId}`;
      return {
        ...prev,
        [key]: {
          id: ref.id,
          roomId,
          slotId: args.slotId,
          bookingId: args.bookingId,
          date: args.date,
          status: args.status,
          note: args.note,
          imageUrls: args.imageUrls,
          createdAt: new Date(),
          createdBy: user.uid,
        },
      };
    });
  }

  function openConfirm(slotId: string, bookingId: string, date: string, status: AttendanceStatus) {
    setConfirmSlotId(slotId);
    setConfirmBookingId(bookingId);
    setConfirmDate(date);
    setConfirmStatus(status);
    setConfirmOpen(true);
  }

  async function onConfirmNo() {
    if (!confirmSlotId || !confirmBookingId || !confirmDate || !confirmStatus) return;
    setConfirmOpen(false);
    await saveLog({
      slotId: confirmSlotId,
      bookingId: confirmBookingId,
      date: confirmDate,
      status: confirmStatus,
      note: null,
      imageUrls: [],
    });
    setConfirmSlotId(null);
    setConfirmBookingId(null);
    setConfirmDate(null);
    setConfirmStatus(null);
  }

  function onConfirmYes() {
    setConfirmOpen(false);
    setNoteText("");
    setNoteImages([]);
    setNoteError(null);
    setNoteOpen(true);
  }

  async function onUploadClick() {
    if (noteUploading) return;
    fileInputRef.current?.click();
  }

  async function onFilePicked(file: File | null) {
    if (!file) return;
    setNoteUploading(true);
    setNoteError(null);
    try {
      const url = await uploadToCloudinary(file);
      setNoteImages((prev) => [...prev, url]);
    } catch (e) {
      console.error("Upload failed", e);
      setNoteError(String(e));
    } finally {
      setNoteUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function onSubmitNote() {
    if (!confirmSlotId || !confirmBookingId || !confirmDate || !confirmStatus) return;
    if (noteSubmitting) return;

    setNoteSubmitting(true);
    setNoteError(null);
    try {
      await saveLog({
        slotId: confirmSlotId,
        bookingId: confirmBookingId,
        date: confirmDate,
        status: confirmStatus,
        note: noteText.trim() ? noteText.trim() : null,
        imageUrls: noteImages,
      });

      setNoteOpen(false);
      setConfirmSlotId(null);
      setConfirmBookingId(null);
      setConfirmDate(null);
      setConfirmStatus(null);
    } catch (e) {
      console.error("Save attendance failed", e);
      setNoteError("Không thể lưu điểm danh. Vui lòng thử lại.");
    } finally {
      setNoteSubmitting(false);
    }
  }

  const sessionsByDate = useMemo(() => {
    const by: Record<string, { slot: TeachingSlot; booking: BookingLite | null }[]> = {};
    const todayStart = startOfDay(new Date());

    for (const d of days) {
      const dayStart = startOfDay(d.date);
      const list = slots
        .filter((s) => s.status === "booked" && s.dayOfWeek === d.dayKey && !!s.bookedBookingId)
        .slice()
        .sort((a, b) => a.startMin - b.startMin)
        .filter((s) => {
          const start = new Date(dayStart);
          start.setMinutes(start.getMinutes() + s.startMin);
          const end = new Date(dayStart);
          end.setMinutes(end.getMinutes() + s.endMin);
          void start;
          void end;
          if (tab === "upcoming") return dayStart.getTime() >= todayStart.getTime();
          return dayStart.getTime() < todayStart.getTime();
        })
        .map((s) => ({ slot: s, booking: s.bookedBookingId ? bookingById[s.bookedBookingId] ?? null : null }));
      by[d.key] = list;
    }

    return by;
  }, [days, slots, bookingById, tab]);

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

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <div className="text-sm font-medium text-zinc-600">Loading...</div>
      </div>
    );
  }

  if (!user) return null;

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
                onClick={() => {
                  if (!roomId) return;
                  setSidebarOpen(false);
                  if (!isOwner) {
                    router.push(`/rooms/${encodeURIComponent(roomId)}/attendance-stats`);
                  }
                }}
                className={
                  isOwner
                    ? "group flex w-full items-center gap-3 rounded-xl bg-blue-50 px-3 py-2.5 text-left text-sm font-semibold text-blue-700"
                    : "group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-zinc-700 hover:bg-white hover:text-zinc-900"
                }
              >
                <svg
                  viewBox="0 0 24 24"
                  className={isOwner ? "h-4 w-4 flex-none text-blue-600" : "h-4 w-4 flex-none text-zinc-500 group-hover:text-zinc-700"}
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
                <span className="flex-1">{isOwner ? "Điểm danh" : "Thống kê điểm danh"}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (!roomId) return;
                  setSidebarOpen(false);
                  router.push(`/rooms/${encodeURIComponent(roomId)}/documents`);
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
                  <path d="M4 4h12l4 4v12H4z" />
                  <path d="M16 4v4h4" />
                  <path d="M8 12h8" />
                  <path d="M8 16h8" />
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
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                  <path d="M10 17l5-5-5-5" />
                  <path d="M15 12H3" />
                </svg>
                <span className="flex-1">Thoát</span>
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
                onClick={() => {
                  if (!roomId) return;
                  if (!isOwner) {
                    router.push(`/rooms/${encodeURIComponent(roomId)}/attendance-stats`);
                  }
                }}
                className={
                  isOwner
                    ? "group flex w-full items-center gap-3 rounded-xl bg-blue-50 px-3 py-2.5 text-left text-sm font-semibold text-blue-700"
                    : "group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-zinc-700 hover:bg-white hover:text-zinc-900"
                }
              >
                <svg
                  viewBox="0 0 24 24"
                  className={isOwner ? "h-4 w-4 flex-none text-blue-600" : "h-4 w-4 flex-none text-zinc-500 group-hover:text-zinc-700"}
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
                <span className="flex-1">{isOwner ? "Điểm danh" : "Thống kê điểm danh"}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (!roomId) return;
                  router.push(`/rooms/${encodeURIComponent(roomId)}/documents`);
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
                  <path d="M4 4h12l4 4v12H4z" />
                  <path d="M16 4v4h4" />
                  <path d="M8 12h8" />
                  <path d="M8 16h8" />
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
                  <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                  <path d="M10 17l5-5-5-5" />
                  <path d="M15 12H3" />
                </svg>
                <span className="flex-1">Thoát</span>
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
                  <div className="truncate text-xl font-bold text-zinc-900">Điểm danh{roomName ? ` - ${roomName}` : ""}</div>
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
            {!isOwner ? (
              <div className="rounded-2xl border border-zinc-200 bg-white p-6 text-center">
                <div className="text-sm font-semibold text-zinc-700">Chỉ giáo viên (owner) mới có thể điểm danh.</div>
                <button
                  type="button"
                  onClick={() => {
                    if (!roomId) return;
                    router.push(`/rooms/${encodeURIComponent(roomId)}/attendance-stats`);
                  }}
                  className="mt-4 inline-flex h-10 items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Xem thống kê điểm danh của bạn
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="inline-flex rounded-xl border border-zinc-200 bg-white p-1">
                  <button
                    type="button"
                    onClick={() => setTab("upcoming")}
                    className={
                      tab === "upcoming"
                        ? "h-9 rounded-lg bg-zinc-900 px-4 text-sm font-semibold text-white outline-none focus:outline-none focus:ring-0 focus-visible:outline-none"
                        : "h-9 rounded-lg px-4 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 outline-none focus:outline-none focus:ring-0 focus-visible:outline-none"
                    }
                  >
                    Sắp diễn ra
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab("history")}
                    className={
                      tab === "history"
                        ? "h-9 rounded-lg bg-zinc-900 px-4 text-sm font-semibold text-white outline-none focus:outline-none focus:ring-0 focus-visible:outline-none"
                        : "h-9 rounded-lg px-4 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 outline-none focus:outline-none focus:ring-0 focus-visible:outline-none"
                    }
                  >
                    Lịch sử
                  </button>
                </div>

                {tab === "history" ? (
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

                    {historyError ? <div className="mt-4 text-sm font-semibold text-red-600">{historyError}</div> : null}

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
                          {historyLoading ? (
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
                                  <div className="text-xs text-zinc-500">{r.studentName || ""}</div>
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
                ) : (
                  days.map((d) => {
                    const label = d.date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
                    const sessions = sessionsByDate[d.key] ?? [];
                    const canTakeAttendance = d.key === todayKey;
                    return (
                      <div key={d.key}>
                        <div className="mb-2 flex items-center gap-2 text-sm font-bold text-zinc-900">
                          <svg viewBox="0 0 24 24" className="h-4 w-4 text-zinc-500" fill="none" stroke="currentColor" strokeWidth="1.8">
                            <path d="M8 3v3" />
                            <path d="M16 3v3" />
                            <path d="M4 7h16" />
                            <path d="M6 5h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
                          </svg>
                          <span>{label}</span>
                        </div>

                        {sessions.length ? (
                          <div className="space-y-3">
                            {sessions.map(({ slot, booking }) => {
                              const bookingId = slot.bookedBookingId || "";
                              const k = `${d.key}_${slot.id}_${bookingId}`;
                              const log = logsByKey[k];

                              return (
                                <div
                                  key={slot.id}
                                  className="flex items-center justify-between rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"
                                >
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-4">
                                      <div className="text-sm font-bold text-zinc-900">
                                        {minutesToTime(slot.startMin)} - {minutesToTime(slot.endMin)}
                                      </div>
                                      <div className="min-w-0">
                                        <div className="truncate text-sm font-semibold text-zinc-900">{booking?.subject || "(Môn học)"}</div>
                                        <div className="truncate text-xs text-zinc-500">{booking?.studentName || "(Học sinh)"}</div>
                                      </div>
                                    </div>

                                    {log?.note || (log?.imageUrls?.length ? "has" : "") ? (
                                      <div className="mt-2 text-xs text-zinc-500">
                                        {log?.note ? <span className="font-medium">Note:</span> : null}{log?.note ? ` ${log.note}` : ""}
                                        {log?.imageUrls?.length ? <span className="ml-2 font-medium">• {log.imageUrls.length} ảnh</span> : null}
                                      </div>
                                    ) : null}
                                  </div>

                                  <div className="flex items-center gap-2 pr-2">
                                    {log ? (
                                      <div className="inline-flex items-center gap-2">
                                        <span
                                          className={
                                            log.status === "completed"
                                              ? "text-sm font-semibold text-emerald-600"
                                              : "text-sm font-semibold text-orange-600"
                                          }
                                        >
                                          {log.status === "completed" ? "Có mặt" : "Vắng mặt"}
                                        </span>
                                        <svg viewBox="0 0 24 24" className="h-5 w-5 text-zinc-400" fill="none" stroke="currentColor" strokeWidth="1.8">
                                          <path d="M9 12l2 2 4-4" />
                                          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                                        </svg>
                                      </div>
                                    ) : canTakeAttendance ? (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            if (!bookingId) return;
                                            openConfirm(slot.id, bookingId, d.key, "completed");
                                          }}
                                          className="h-9 rounded-lg bg-emerald-100 px-3 text-xs font-bold text-emerald-700 hover:bg-emerald-200"
                                        >
                                          Điểm Danh
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            if (!bookingId) return;
                                            openConfirm(slot.id, bookingId, d.key, "absent");
                                          }}
                                          className="h-9 rounded-lg bg-red-500 px-3 text-xs font-bold text-white hover:bg-red-600"
                                        >
                                          Vắng
                                        </button>
                                      </>
                                    ) : null}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="rounded-2xl border border-dashed border-zinc-200 bg-white p-4 text-sm font-medium text-zinc-500">
                            Không có ca học.
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
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

      {confirmOpen ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg">
            <div className="text-center">
              <div className="text-base font-semibold text-zinc-900">Bạn có muốn thêm note hay up ảnh không ?</div>
              <div className="mt-2 text-sm text-zinc-500">Hành động này không thể hoàn tác.</div>
            </div>
            <div className="mt-6 flex justify-center gap-3">
              <button
                type="button"
                className="h-11 w-32 rounded-xl border border-zinc-200 bg-white text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
                onClick={() => {
                  void onConfirmNo();
                }}
              >
                Không
              </button>
              <button
                type="button"
                className="h-11 w-32 rounded-xl bg-zinc-900 text-sm font-semibold text-white hover:bg-zinc-800"
                onClick={onConfirmYes}
              >
                Có
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {noteOpen ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-lg">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-lg font-bold text-zinc-900">Điền note và upload ảnh</div>
              </div>
              <button
                type="button"
                className="rounded-lg px-2 py-1 text-zinc-500 hover:bg-zinc-100"
                onClick={() => {
                  if (noteSubmitting || noteUploading) return;
                  setNoteOpen(false);
                }}
                aria-label="Close"
                disabled={noteSubmitting || noteUploading}
              >
                ✕
              </button>
            </div>

            <textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              className="mt-4 h-28 w-full resize-none rounded-xl border border-zinc-200 bg-white p-3 text-sm font-medium text-zinc-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              placeholder="Ghi chú..."
              disabled={noteSubmitting}
            />

            <div className="mt-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  void onFilePicked(f);
                }}
              />
              <button
                type="button"
                className="inline-flex h-11 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
                onClick={onUploadClick}
                disabled={noteUploading || noteSubmitting}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 text-zinc-500" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M10 13a5 5 0 0 1 7 0l1 1" />
                  <path d="M4 13a5 5 0 0 1 7 0l1 1" />
                  <path d="M12 12v9" />
                  <path d="M9 21h6" />
                </svg>
                {noteUploading ? "Đang upload..." : "Upload ảnh"}
              </button>
            </div>

            {noteImages.length ? (
              <div className="mt-4 grid grid-cols-3 gap-2">
                {noteImages.map((url) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl border border-zinc-200">
                    <img src={url} alt="uploaded" className="h-24 w-full object-cover" />
                  </a>
                ))}
              </div>
            ) : null}

            {noteError ? <div className="mt-4 text-sm font-semibold text-red-600">{noteError}</div> : null}

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                className="h-11 rounded-xl border border-zinc-200 bg-white px-5 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
                onClick={() => setNoteOpen(false)}
                disabled={noteSubmitting || noteUploading}
              >
                Hủy
              </button>
              <button
                type="button"
                className="h-11 rounded-xl bg-blue-600 px-6 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                onClick={() => {
                  void onSubmitNote();
                }}
                disabled={noteSubmitting || noteUploading}
              >
                {noteSubmitting ? "Đang lưu..." : "Lưu"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
