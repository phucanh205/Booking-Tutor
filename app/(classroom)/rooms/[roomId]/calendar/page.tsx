"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
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

type SlotStatus = "available" | "pending" | "booked";

 type BookingLite = {
  id: string;
  studentUid: string;
  studentName: string;
  studentPhone: string;
  subject: string;
 };

type TeachingSlot = {
  id: string;
  tutorId: string;
  roomId: string;
  dayOfWeek: DayOfWeek;
  startMin: number;
  endMin: number;
  status: SlotStatus;
  pendingBookingId?: string | null;
  pendingExpiresAt?: unknown;
  bookedBookingId?: string | null;
  createdAt?: unknown;
};

type RoomMember = {
  id: string;
  userId: string;
  role: "owner" | "student";
  displayName?: string | null;
  email?: string | null;
  photoURL?: string | null;
  joinedAt?: any;
};

function splitTime(value: string) {
  const m = /^([0-9]{1,2}):([0-9]{2})$/.exec(value.trim());
  if (!m) return { hh: "00", mm: "00" };
  const hh = String(Math.min(23, Math.max(0, Number(m[1]) || 0))).padStart(2, "0");
  const mm = String(Math.min(59, Math.max(0, Number(m[2]) || 0))).padStart(2, "0");
  return { hh, mm };
}

function joinTime(hh: string, mm: string) {
  const h = String(Math.min(23, Math.max(0, Number(hh) || 0))).padStart(2, "0");
  const m = String(Math.min(59, Math.max(0, Number(mm) || 0))).padStart(2, "0");
  return `${h}:${m}`;
}

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

  const [requestOpen, setRequestOpen] = useState(false);
  const [requestSlot, setRequestSlot] = useState<TeachingSlot | null>(null);
  const [requestName, setRequestName] = useState("");
  const [requestPhone, setRequestPhone] = useState("");
  const [requestSubject, setRequestSubject] = useState("");
  const [requestNote, setRequestNote] = useState("");
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);

  const requestPhoneRef = useRef<HTMLInputElement | null>(null);

  const [slots, setSlots] = useState<TeachingSlot[]>([]);
  const [bookingById, setBookingById] = useState<Record<string, BookingLite | null>>({});

  const [roomName, setRoomName] = useState<string>("");
  const [copyToast, setCopyToast] = useState<string | null>(null);

  const [slotDetailOpen, setSlotDetailOpen] = useState(false);
  const [slotDetailSlotId, setSlotDetailSlotId] = useState<string | null>(null);
  const [slotDetailDay, setSlotDetailDay] = useState<DayOfWeek>("Monday");
  const [slotDetailStart, setSlotDetailStart] = useState("14:00");
  const [slotDetailEnd, setSlotDetailEnd] = useState("15:00");
  const [slotDetailSubmitting, setSlotDetailSubmitting] = useState(false);
  const [slotDetailError, setSlotDetailError] = useState<string | null>(null);
  const slotDetailDayRef = useRef<HTMLSelectElement | null>(null);

  const [confirmDeleteSlotOpen, setConfirmDeleteSlotOpen] = useState(false);
  const [confirmDeleteSlotId, setConfirmDeleteSlotId] = useState<string | null>(null);

  const [membersOpen, setMembersOpen] = useState(false);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [membersSyncing, setMembersSyncing] = useState(false);
  const [membersSyncMsg, setMembersSyncMsg] = useState<string | null>(null);
  const membersTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mobileMembersTriggerRef = useRef<HTMLButtonElement | null>(null);
  const membersPopoverRef = useRef<HTMLDivElement | null>(null);
  const [membersPopoverPos, setMembersPopoverPos] = useState<{ top: number; left: number } | null>(null);

  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const mobileActionsWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      const forcedNext = typeof window !== "undefined" ? window.sessionStorage.getItem("postLogoutNext") : null;
      if (forcedNext) {
        try {
          window.sessionStorage.removeItem("postLogoutNext");
        } catch {
          // ignore
        }
      }
      const next = forcedNext || (roomId ? `/rooms/${encodeURIComponent(roomId)}/calendar` : "/rooms");
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
            status: (data.status === "pending" || data.status === "booked" ? data.status : "available") as SlotStatus,
            pendingBookingId: (typeof data?.pendingBookingId === "string" ? data.pendingBookingId : null) as
              | string
              | null,
            pendingExpiresAt: data?.pendingExpiresAt,
            bookedBookingId: (typeof data?.bookedBookingId === "string" ? data.bookedBookingId : null) as
              | string
              | null,
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

  useEffect(() => {
    async function loadMembers() {
      if (!user) return;
      if (!roomId) return;
      if (!isOwner) return;
      if (!membersOpen && membersLoaded) return;

      setMembersLoading(true);
      setMembersError(null);
      try {
        const db = getFirestoreDb();
        const snap = await getDocs(collection(db, `rooms/${roomId}/members`));
        const items = snap.docs
          .map((d) => {
            const data = d.data() as any;
            const role = data?.role === "owner" ? "owner" : "student";
            const userId = typeof data?.userId === "string" ? data.userId : d.id;
            const displayName = typeof data?.displayName === "string" ? data.displayName : null;
            const email = typeof data?.email === "string" ? data.email : null;
            const photoURL = typeof data?.photoURL === "string" ? data.photoURL : null;
            return {
              id: d.id,
              userId,
              role,
              displayName,
              email,
              photoURL,
              joinedAt: data?.joinedAt,
            } satisfies RoomMember;
          })
          .sort((a, b) => {
            if (a.role !== b.role) return a.role === "owner" ? -1 : 1;
            const aName = a.displayName || a.email || a.id;
            const bName = b.displayName || b.email || b.id;
            return aName.localeCompare(bName);
          });
        setMembers(items);
        setMembersLoaded(true);
      } catch (e) {
        console.error("Load members failed", e);
        setMembersError("Không thể tải danh sách thành viên.");
      } finally {
        setMembersLoading(false);
      }
    }

    loadMembers();
  }, [user, roomId, isOwner, membersOpen, membersLoaded]);

  useEffect(() => {
    async function loadRoomName() {
      if (!user) return;
      if (!roomId) return;
      try {
        const db = getFirestoreDb();
        const snap = await getDoc(doc(db, "rooms", roomId));
        const data = snap.exists() ? (snap.data() as any) : null;
        const name = typeof data?.name === "string" ? data.name : "";
        setRoomName(name);
      } catch (e) {
        console.error("Load room failed", e);
        setRoomName("");
      }
    }

    loadRoomName();
  }, [user, roomId]);

  useEffect(() => {
    if (!copyToast) return;
    const t = window.setTimeout(() => setCopyToast(null), 300);
    return () => window.clearTimeout(t);
  }, [copyToast]);

  useEffect(() => {
    if (!membersSyncMsg) return;
    const t = window.setTimeout(() => setMembersSyncMsg(null), 1200);
    return () => window.clearTimeout(t);
  }, [membersSyncMsg]);

  useEffect(() => {
    if (!membersOpen) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMembersOpen(false);
    }

    function onMouseDown(e: MouseEvent) {
      const trigger = membersTriggerRef.current;
      const mobileTrigger = mobileMembersTriggerRef.current;
      const popover = membersPopoverRef.current;
      const target = e.target as Node;
      if (trigger && trigger.contains(target)) return;
      if (mobileTrigger && mobileTrigger.contains(target)) return;
      if (popover && popover.contains(target)) return;
      setMembersOpen(false);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [membersOpen]);

  useEffect(() => {
    if (!mobileActionsOpen) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileActionsOpen(false);
    }

    function onMouseDown(e: MouseEvent) {
      const wrap = mobileActionsWrapRef.current;
      if (!wrap) return;
      const target = e.target as Node;
      if (wrap.contains(target)) return;
      setMobileActionsOpen(false);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [mobileActionsOpen]);

  useEffect(() => {
    if (!membersOpen) {
      setMembersPopoverPos(null);
      return;
    }

    function updatePos() {
      const btn = membersTriggerRef.current || mobileMembersTriggerRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();

      const desiredLeft = rect.left;
      const top = rect.bottom + 8;

      const panelWidth = 360;
      const padding = 8;
      const maxLeft = window.innerWidth - panelWidth - padding;
      const left = Math.max(padding, Math.min(desiredLeft, maxLeft));

      setMembersPopoverPos({ top, left });
    }

    updatePos();
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, true);
    return () => {
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
    };
  }, [membersOpen]);

  async function onSyncMembers() {
    if (!user) return;
    if (!roomId) return;
    if (!isOwner) return;

    setMembersSyncing(true);
    setMembersError(null);
    try {
      const { getFirebaseAuth } = await import("@/lib/firebase");
      const token = await getFirebaseAuth().currentUser?.getIdToken();
      if (!token) {
        setMembersError("Bạn cần đăng nhập lại để tiếp tục.");
        return;
      }

      const res = await fetch("/api/members/backfill", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ roomId }),
      });

      const data = (await res.json()) as any;
      if (!res.ok || !data?.ok) {
        setMembersError(typeof data?.error === "string" ? data.error : "Đồng bộ thất bại.");
        return;
      }

      const updated = Number(data?.updated ?? 0);
      const skipped = Number(data?.skipped ?? 0);
      const errors = Number(data?.errors ?? 0);

      setMembersLoaded(false);
      setMembersSyncMsg(`Đã đồng bộ: ${updated} | Bỏ qua: ${skipped} | Lỗi: ${errors}`);
    } catch (e) {
      console.error("Members sync failed", e);
      setMembersError("Đồng bộ thất bại. Vui lòng thử lại.");
    } finally {
      setMembersSyncing(false);
    }
  }

  useEffect(() => {
    async function loadBookingsForSlots() {
      if (!user) return;
      if (!roomId) return;
      if (!slots.length) return;

      const bookingIds = Array.from(
        new Set(
          slots
            .map((s) => (s.status === "pending" ? s.pendingBookingId : s.status === "booked" ? s.bookedBookingId : null))
            .filter((x): x is string => typeof x === "string" && !!x)
        )
      ).filter((id) => !(id in bookingById));

      if (!bookingIds.length) return;

      try {
        const db = getFirestoreDb();
        const results = await Promise.all(
          bookingIds.map(async (id) => {
            try {
              const snap = await getDoc(doc(db, "bookings", id));
              if (!snap.exists()) return [id, null] as const;
              const data = snap.data() as any;
              const studentUid = typeof data?.studentUid === "string" ? data.studentUid : "";
              const studentName = typeof data?.studentName === "string" ? data.studentName : "";
              const studentPhone = typeof data?.studentPhone === "string" ? data.studentPhone : "";
              const subject = typeof data?.subject === "string" ? data.subject : "";
              if (!studentUid || !studentName || !subject) return [id, null] as const;
              return [
                id,
                { id, studentUid, studentName, studentPhone, subject } satisfies BookingLite,
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

  function openSlotDetail(slotId: string) {
    if (!isOwner) return;
    const slot = slots.find((s) => s.id === slotId);
    if (!slot) return;
    setSlotDetailSlotId(slotId);
    setSlotDetailDay(slot.dayOfWeek);
    setSlotDetailStart(minutesToTime(slot.startMin));
    setSlotDetailEnd(minutesToTime(slot.endMin));
    setSlotDetailError(null);
    setSlotDetailOpen(true);
  }

  async function onSaveSlotDetail() {
    if (!user) return;
    if (!roomId) return;
    if (!isOwner) return;
    const slotId = slotDetailSlotId;
    if (!slotId) return;

    const slot = slots.find((s) => s.id === slotId);
    if (!slot) return;

    setSlotDetailError(null);
    const startMin = timeToMinutes(slotDetailStart);
    const endMin = timeToMinutes(slotDetailEnd);
    if (startMin == null || endMin == null) {
      setSlotDetailError("Giờ không hợp lệ.");
      return;
    }
    if (startMin >= endMin) {
      setSlotDetailError("Start time phải nhỏ hơn End time.");
      return;
    }

    const sameDay = slots.filter((s) => s.dayOfWeek === slotDetailDay && s.id !== slotId);
    const conflict = sameDay.find((s) => overlaps(startMin, endMin, s.startMin, s.endMin));
    if (conflict) {
      setSlotDetailError(
        `Khung giờ bị trùng với slot hiện có (${minutesToTime(conflict.startMin)}–${minutesToTime(conflict.endMin)}).`
      );
      return;
    }

    setSlotDetailSubmitting(true);
    try {
      const db = getFirestoreDb();
      await updateDoc(doc(db, "slots", slotId), {
        dayOfWeek: slotDetailDay,
        startMin,
        endMin,
      });

      if (slot.status === "pending") {
        const { getFirebaseAuth } = await import("@/lib/firebase");
        const token = await getFirebaseAuth().currentUser?.getIdToken();
        if (!token) {
          setSlotDetailError("Bạn cần đăng nhập lại để tiếp tục.");
          return;
        }

        const res = await fetch("/api/bookings/approve-owner", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ roomId, slotId }),
        });

        const data = (await res.json().catch(() => null)) as any;
        if (!res.ok || !data?.ok) {
          setSlotDetailError(typeof data?.error === "string" ? data.error : "Duyệt thất bại.");
          return;
        }
      }

      setSlots((prev) =>
        prev.map((s) =>
          s.id === slotId
            ? {
                ...s,
                dayOfWeek: slotDetailDay,
                startMin,
                endMin,
                status: slot.status === "pending" ? "booked" : s.status,
                bookedBookingId: slot.status === "pending" ? slot.pendingBookingId ?? null : s.bookedBookingId,
                pendingBookingId: slot.status === "pending" ? null : s.pendingBookingId,
                pendingExpiresAt: slot.status === "pending" ? null : s.pendingExpiresAt,
              }
            : s
        )
      );

      setSlotDetailOpen(false);
      setSlotDetailSlotId(null);
    } catch (e) {
      console.error("Update slot failed", e);
      setSlotDetailError("Cập nhật ca học thất bại. Vui lòng thử lại.");
    } finally {
      setSlotDetailSubmitting(false);
    }
  }

  async function onDeleteSlotDetail() {
    if (!user) return;
    if (!isOwner) return;
    const slotId = slotDetailSlotId;
    if (!slotId) return;
    setConfirmDeleteSlotId(slotId);
    setConfirmDeleteSlotOpen(true);
  }

  async function onApprovePendingSlot() {
    if (!user) return;
    if (!roomId) return;
    if (!isOwner) return;
    const slotId = slotDetailSlotId;
    if (!slotId) return;

    const slot = slots.find((s) => s.id === slotId);
    if (!slot || slot.status !== "pending") return;

    setSlotDetailSubmitting(true);
    setSlotDetailError(null);
    try {
      const { getFirebaseAuth } = await import("@/lib/firebase");
      const token = await getFirebaseAuth().currentUser?.getIdToken();
      if (!token) {
        setSlotDetailError("Bạn cần đăng nhập lại để tiếp tục.");
        return;
      }

      const res = await fetch("/api/bookings/approve-owner", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ roomId, slotId }),
      });

      const data = (await res.json().catch(() => null)) as any;
      if (!res.ok || !data?.ok) {
        setSlotDetailError(typeof data?.error === "string" ? data.error : "Duyệt thất bại.");
        return;
      }

      setSlots((prev) =>
        prev.map((s) =>
          s.id === slotId
            ? {
                ...s,
                status: "booked",
                bookedBookingId: slot.pendingBookingId ?? null,
                pendingBookingId: null,
                pendingExpiresAt: null,
              }
            : s
        )
      );

      setSlotDetailOpen(false);
      setSlotDetailSlotId(null);
    } catch (e) {
      console.error("Approve pending slot failed", e);
      setSlotDetailError("Duyệt thất bại. Vui lòng thử lại.");
    } finally {
      setSlotDetailSubmitting(false);
    }
  }

  async function onRejectPendingSlot() {
    if (!user) return;
    if (!roomId) return;
    if (!isOwner) return;
    const slotId = slotDetailSlotId;
    if (!slotId) return;

    const slot = slots.find((s) => s.id === slotId);
    if (!slot || slot.status !== "pending") return;

    setSlotDetailSubmitting(true);
    setSlotDetailError(null);
    try {
      const { getFirebaseAuth } = await import("@/lib/firebase");
      const token = await getFirebaseAuth().currentUser?.getIdToken();
      if (!token) {
        setSlotDetailError("Bạn cần đăng nhập lại để tiếp tục.");
        return;
      }

      const res = await fetch("/api/bookings/reject-owner", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ roomId, slotId }),
      });

      const data = (await res.json().catch(() => null)) as any;
      if (!res.ok || !data?.ok) {
        setSlotDetailError(typeof data?.error === "string" ? data.error : "Từ chối thất bại.");
        return;
      }

      setSlots((prev) =>
        prev.map((s) =>
          s.id === slotId
            ? {
                ...s,
                status: "available",
                pendingBookingId: null,
                pendingExpiresAt: null,
                bookedBookingId: null,
              }
            : s
        )
      );

      setSlotDetailOpen(false);
      setSlotDetailSlotId(null);
    } catch (e) {
      console.error("Reject pending slot failed", e);
      setSlotDetailError("Từ chối thất bại. Vui lòng thử lại.");
    } finally {
      setSlotDetailSubmitting(false);
    }
  }

  async function onConfirmDeleteSlot() {
    if (!user) return;
    if (!roomId) return;
    if (!isOwner) return;
    const slotId = confirmDeleteSlotId;
    if (!slotId) return;

    setSlotDetailSubmitting(true);
    setSlotDetailError(null);
    try {
      const { getFirebaseAuth } = await import("@/lib/firebase");
      const token = await getFirebaseAuth().currentUser?.getIdToken();
      if (!token) {
        setSlotDetailError("Bạn cần đăng nhập lại để tiếp tục.");
        return;
      }

      const res = await fetch("/api/slots/delete", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ roomId, slotId }),
      });

      const data = (await res.json()) as any;
      if (!res.ok || !data?.ok) {
        setSlotDetailError(typeof data?.error === "string" ? data.error : "Xóa ca học thất bại.");
        return;
      }

      const action = data?.action;
      if (action === "deleted") {
        setSlots((prev) => prev.filter((s) => s.id !== slotId));
      } else {
        setSlots((prev) =>
          prev.map((s) =>
            s.id === slotId
              ? {
                  ...s,
                  status: "available",
                  pendingBookingId: null,
                  pendingExpiresAt: null,
                  bookedBookingId: null,
                }
              : s
          )
        );
      }

      setConfirmDeleteSlotOpen(false);
      setConfirmDeleteSlotId(null);
      setSlotDetailOpen(false);
      setSlotDetailSlotId(null);
    } catch (e) {
      console.error("Delete slot failed", e);
      setSlotDetailError("Xóa ca học thất bại. Vui lòng thử lại.");
    } finally {
      setSlotDetailSubmitting(false);
    }
  }

  async function onRequestBookingSubmit() {
    if (!user) return;
    if (!roomId) return;
    if (!requestSlot) return;
    setRequestError(null);

    const studentName = requestName.trim() || (user.displayName ?? "").trim();
    const studentPhone = requestPhone.trim();
    const subject = requestSubject.trim();
    const note = requestNote.trim();

    if (!studentName || !studentPhone || !subject) {
      setRequestError("Vui lòng nhập đầy đủ Họ tên / SĐT / Môn học.");
      return;
    }

    const phoneDigitsOnly = /^[0-9]+$/.test(studentPhone);
    if (!phoneDigitsOnly) {
      setRequestError("SĐT chỉ được nhập số.");
      requestPhoneRef.current?.focus();
      return;
    }

    setRequestSubmitting(true);
    try {
      const { getFirebaseAuth } = await import("@/lib/firebase");
      const token = await getFirebaseAuth().currentUser?.getIdToken();
      if (!token) {
        setRequestError("Bạn cần đăng nhập lại để tiếp tục.");
        return;
      }

      const res = await fetch("/api/bookings/request", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          roomId,
          slotId: requestSlot.id,
          studentName,
          studentPhone,
          subject,
          note,
        }),
      });

      const data = (await res.json()) as any;
      if (!res.ok || !data?.ok) {
        setRequestError(
          typeof data?.error === "string"
            ? `Gửi yêu cầu thất bại: ${data.error}`
            : "Gửi yêu cầu thất bại."
        );
        return;
      }

      setSlots((prev) =>
        prev.map((s) =>
          s.id === requestSlot.id
            ? {
                ...s,
                status: "pending",
                pendingBookingId: typeof data?.bookingId === "string" ? data.bookingId : s.pendingBookingId,
              }
            : s
        )
      );

      setRequestOpen(false);
      setRequestSlot(null);
      setRequestNote("");
      setRequestSubject("");
    } catch (e) {
      console.error("Request booking failed", e);
      setRequestError("Gửi yêu cầu thất bại. Vui lòng thử lại.");
    } finally {
      setRequestSubmitting(false);
    }
  }

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
    try {
      window.sessionStorage.setItem("postLogoutNext", "/rooms");
    } catch {
      // ignore
    }
    await signOutUser();
    router.replace(`/login?next=${encodeURIComponent("/rooms")}`);
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

  const approvedStudentUids = useMemo(() => {
    const uids = new Set<string>();
    for (const s of slots) {
      if (s.status !== "booked") continue;
      const bookingId = typeof s.bookedBookingId === "string" ? s.bookedBookingId : null;
      if (!bookingId) continue;
      const booking = bookingById[bookingId];
      const uid = booking && typeof booking.studentUid === "string" ? booking.studentUid : null;
      if (uid) uids.add(uid);
    }
    return uids;
  }, [slots, bookingById]);

  const visibleMembers = useMemo(() => {
    return members.filter((m) => {
      if (m.role === "owner") return true;
      return approvedStudentUids.has(m.userId);
    });
  }, [members, approvedStudentUids]);

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

  const studentCount = visibleMembers.filter((m) => m.role === "student").length;

  const [sidebarOpen, setSidebarOpen] = useState(false);

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
                onClick={() => {
                  if (!roomId) return;
                  setSidebarOpen(false);
                  if (isOwner) {
                    router.push(`/rooms/${encodeURIComponent(roomId)}/attendance`);
                  } else {
                    router.push(`/rooms/${encodeURIComponent(roomId)}/attendance-stats`);
                  }
                }}
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
                <span className="flex-1">{isOwner ? "Điểm danh" : "Thống kê điểm danh"}</span>
              </button>

              <button
                type="button"
                className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-zinc-700 hover:bg-white hover:text-zinc-900"
                onClick={() => {
                  if (!roomId) return;
                  setSidebarOpen(false);
                  router.push(`/rooms/${encodeURIComponent(roomId)}/documents`);
                }}
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
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-sm font-semibold text-white">
                T
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-zinc-900">Trang chủ</div>
                <div className="truncate text-xs text-zinc-500">Tạo Lịch dạy của bạn</div>
              </div>
            </div>
          </div>

          <nav className="flex h-[calc(100vh-96px)] flex-col px-3 pb-5">
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
                onClick={() => {
                  if (!roomId) return;
                  if (isOwner) {
                    router.push(`/rooms/${encodeURIComponent(roomId)}/attendance`);
                  } else {
                    router.push(`/rooms/${encodeURIComponent(roomId)}/attendance-stats`);
                  }
                }}
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
                <span className="flex-1">{isOwner ? "Điểm danh" : "Thống kê điểm danh"}</span>
              </button>

              <button
                type="button"
                className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-zinc-700 hover:bg-white hover:text-zinc-900"
                onClick={() => {
                  if (!roomId) return;
                  router.push(`/rooms/${encodeURIComponent(roomId)}/documents`);
                }}
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
                  <div className="truncate text-xl font-bold text-zinc-900">
                    Lịch Dạy{roomName ? ` - ${roomName}` : ""}
                  </div>
                  {roomId ? (
                    <div className="mt-0.5 flex min-w-0 items-center gap-2">
                      <div className="truncate text-xs text-zinc-500">Room: {roomId}</div>
                      <button
                        type="button"
                        className="shrink-0 rounded-md border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-50"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(roomId);
                            setCopyToast("Đã copy mã phòng");
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

              <div className="flex items-center gap-3 mr-0 sm:mr-8">
                {isOwner ? (
                  <>
                    <div className="hidden items-center gap-3 md:flex">
                      <button
                        ref={membersTriggerRef}
                        type="button"
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-50 px-4 text-sm font-semibold text-blue-700 shadow-sm hover:bg-blue-100"
                        onClick={() => {
                          setMembersError(null);
                          setMembersOpen((v) => !v);
                        }}
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
                          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                          <circle cx="8.5" cy="7" r="4" />
                          <path d="M20 8v6" />
                          <path d="M23 11h-6" />
                        </svg>
                        <span>{studentCount || 0} Học sinh</span>
                      </button>

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
                    </div>

                    <div className="relative md:hidden" ref={mobileActionsWrapRef}>
                      <button
                        type="button"
                        className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-700 shadow-sm hover:bg-zinc-50"
                        onClick={() => setMobileActionsOpen((v) => !v)}
                        aria-label="More actions"
                      >
                        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <path d="M5 12h.01" />
                          <path d="M12 12h.01" />
                          <path d="M19 12h.01" />
                        </svg>
                      </button>

                      {mobileActionsOpen ? (
                        <div className="absolute right-0 z-[85] mt-2 w-56 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg">
                          <button
                            ref={mobileMembersTriggerRef}
                            type="button"
                            className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
                            onClick={() => {
                              setMembersError(null);
                              setMobileActionsOpen(false);
                              setMembersOpen(true);
                            }}
                          >
                            <svg
                              viewBox="0 0 24 24"
                              className="h-5 w-5 text-zinc-500"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                            >
                              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                              <circle cx="8.5" cy="7" r="4" />
                              <path d="M20 8v6" />
                              <path d="M23 11h-6" />
                            </svg>
                            <span>Học sinh ({studentCount || 0})</span>
                          </button>

                          <button
                            type="button"
                            className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-zinc-800 hover:bg-zinc-50"
                            onClick={() => {
                              setSlotError(null);
                              setMobileActionsOpen(false);
                              setCreateSlotOpen(true);
                            }}
                          >
                            <span className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-blue-600 text-xs font-bold text-white">+</span>
                            <span>Tạo slot</span>
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </header>

          {membersOpen && isOwner && membersPopoverPos ? (
            <div
              ref={membersPopoverRef}
              className="fixed z-[80] max-w-[420px] overflow-auto rounded-2xl border border-zinc-200 bg-white p-4 shadow-lg w-[360px] max-h-[70vh]"
              style={{ top: membersPopoverPos.top, left: membersPopoverPos.left }}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-lg font-bold text-zinc-900">Danh sách thành viên</div>
                  <div className="mt-0.5 text-xs font-semibold text-zinc-500">Các thành viên đã được duyệt</div>
                </div>
                <button
                  type="button"
                  className="rounded-lg px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100"
                  onClick={() => setMembersOpen(false)}
                  aria-label="Close"
                  disabled={membersLoading || membersSyncing}
                >
                  ✕
                </button>
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <button
                  type="button"
                  className="h-9 rounded-xl border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
                  onClick={onSyncMembers}
                  disabled={membersLoading || membersSyncing}
                >
                  {membersSyncing ? "Đang đồng bộ..." : "Đồng bộ"}
                </button>
                {membersSyncMsg ? <div className="text-xs font-semibold text-zinc-600">{membersSyncMsg}</div> : null}
              </div>

              {membersError ? <div className="mt-3 text-sm font-semibold text-red-600">{membersError}</div> : null}

              <div className="mt-4 space-y-2">
                {membersLoading ? (
                  <div className="text-sm font-medium text-zinc-600">Loading...</div>
                ) : visibleMembers.length ? (
                  visibleMembers.map((m) => {
                    const name = m.displayName || (m.email ? m.email.split("@")[0] : "") || m.id;
                    return (
                      <div
                        key={m.id}
                        className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2 shadow-sm"
                      >
                        {m.photoURL ? (
                          <img
                            src={m.photoURL}
                            alt="Avatar"
                            className="h-10 w-10 rounded-lg object-cover"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-sm font-bold text-amber-700">
                            User
                          </div>
                        )}

                        <div className="min-w-0 flex-1 whitespace-normal break-words text-sm font-semibold leading-snug text-zinc-900">
                          {name}
                        </div>

                        <div
                          className={`ml-auto shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-semibold text-white ${
                            m.role === "owner" ? "bg-red-600" : "bg-zinc-700"
                          }`}
                        >
                          {m.role === "owner" ? "Giáo viên" : "Học sinh"}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-sm font-medium text-zinc-600">Chưa có thành viên.</div>
                )}
              </div>
            </div>
          ) : null}

          <main className="min-w-0 overflow-visible px-4 py-6 sm:px-6 md:flex-1 md:overflow-hidden">
            <div className="grid grid-cols-12 gap-4 md:h-full">
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
                  <div className="flex-1 min-h-0 overflow-x-auto overflow-visible md:overflow-y-auto">
                    <div
                      className="sticky top-0 z-20 min-w-[900px] border-b border-zinc-200 bg-white"
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
                      className="grid min-w-[900px] bg-white"
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
                              <button
                                key={s.id}
                                type="button"
                                className={`absolute left-1 right-1 overflow-hidden rounded-lg border px-2 py-1 text-left text-xs font-semibold shadow-sm transition-colors ${
                                  s.status === "available"
                                    ? "border-green-200 bg-green-50 text-green-700 hover:bg-green-100"
                                    : s.status === "pending"
                                      ? "border-amber-200 bg-amber-50 text-amber-800"
                                      : "border-zinc-200 bg-zinc-50 text-zinc-700"
                                }`}
                                style={{
                                  top: s.top,
                                  height: s.height,
                                }}
                                onClick={() => {
                                  if (isOwner) {
                                    openSlotDetail(s.id);
                                    return;
                                  }
                                  if (s.status !== "available") return;
                                  const full = slots.find((x) => x.id === s.id) ?? null;
                                  if (!full) return;
                                  setRequestSlot(full);
                                  setRequestName((user?.displayName ?? "").trim());
                                  setRequestPhone("");
                                  setRequestSubject("");
                                  setRequestNote("");
                                  setRequestError(null);
                                  setRequestOpen(true);
                                }}
                                disabled={!isOwner && s.status !== "available"}
                              >
                                {(() => {
                                  const full = slots.find((x) => x.id === s.id) ?? null;
                                  const bookingId =
                                    full?.status === "pending"
                                      ? full.pendingBookingId
                                      : full?.status === "booked"
                                        ? full.bookedBookingId
                                        : null;
                                  const booking = bookingId ? bookingById[bookingId] ?? null : null;
                                  const canSeeDetails =
                                    !!booking && (isOwner || (typeof booking.studentUid === "string" && booking.studentUid === user.uid));

                                  return (
                                    <div className="truncate">
                                      {s.status === "available"
                                        ? "Trống"
                                        : s.status === "pending"
                                          ? "Chờ duyệt"
                                          : canSeeDetails
                                            ? `${booking!.studentName} • ${booking!.subject}`
                                            : "Đã đặt"}
                                    </div>
                                  );
                                })()}
                                <div
                                  className={`mt-0.5 truncate text-[11px] font-medium ${
                                    s.status === "available"
                                      ? "text-green-700/80"
                                      : s.status === "pending"
                                        ? "text-amber-800/70"
                                        : "text-zinc-700/70"
                                  }`}
                                >
                                  {minutesToTime(s.startMin)}–{minutesToTime(s.endMin)}
                                </div>
                              </button>
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

      {slotDetailOpen && isOwner ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-lg">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xl font-bold text-zinc-900">Thông tin ca học</div>
                <div className="mt-1 text-sm text-zinc-500">Form chỉnh sửa thông tin</div>
              </div>
              <button
                type="button"
                className="rounded-lg px-2 py-1 text-zinc-500 hover:bg-zinc-100"
                onClick={() => {
                  if (slotDetailSubmitting) return;
                  setSlotDetailOpen(false);
                  setSlotDetailSlotId(null);
                }}
                aria-label="Close"
                disabled={slotDetailSubmitting}
              >
                ✕
              </button>
            </div>

            <div className="mt-5">
              <label className="block text-sm font-semibold text-zinc-700">Ngày</label>
              <div className="relative mt-2">
                <select
                  ref={slotDetailDayRef}
                  value={slotDetailDay}
                  onChange={(e) => setSlotDetailDay(e.target.value as DayOfWeek)}
                  className="h-11 w-full appearance-none rounded-lg border border-zinc-200 bg-white pl-3 pr-11 text-sm font-medium text-zinc-900 outline-none hover:border-zinc-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-zinc-50 disabled:text-zinc-500"
                  disabled={slotDetailSubmitting}
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

                <div className="pointer-events-none absolute right-1.5 top-1.5 inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500">
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
                    <path
                      fillRule="evenodd"
                      d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.24 4.5a.75.75 0 0 1-1.08 0l-4.24-4.5a.75.75 0 0 1 .02-1.06Z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-zinc-700">Start time</label>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <select
                    value={splitTime(slotDetailStart).hh}
                    onChange={(e) => {
                      const { mm } = splitTime(slotDetailStart);
                      setSlotDetailStart(joinTime(e.target.value, mm));
                    }}
                    className="h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 outline-none hover:border-zinc-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-zinc-50 disabled:text-zinc-500"
                    disabled={slotDetailSubmitting}
                  >
                    {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")).map((hh) => (
                      <option key={hh} value={hh}>
                        {hh}
                      </option>
                    ))}
                  </select>
                  <select
                    value={splitTime(slotDetailStart).mm}
                    onChange={(e) => {
                      const { hh } = splitTime(slotDetailStart);
                      setSlotDetailStart(joinTime(hh, e.target.value));
                    }}
                    className="h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 outline-none hover:border-zinc-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-zinc-50 disabled:text-zinc-500"
                    disabled={slotDetailSubmitting}
                  >
                    {Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0")).map((mm) => (
                      <option key={mm} value={mm}>
                        {mm}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-zinc-700">End time</label>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <select
                    value={splitTime(slotDetailEnd).hh}
                    onChange={(e) => {
                      const { mm } = splitTime(slotDetailEnd);
                      setSlotDetailEnd(joinTime(e.target.value, mm));
                    }}
                    className="h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 outline-none hover:border-zinc-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-zinc-50 disabled:text-zinc-500"
                    disabled={slotDetailSubmitting}
                  >
                    {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")).map((hh) => (
                      <option key={hh} value={hh}>
                        {hh}
                      </option>
                    ))}
                  </select>
                  <select
                    value={splitTime(slotDetailEnd).mm}
                    onChange={(e) => {
                      const { hh } = splitTime(slotDetailEnd);
                      setSlotDetailEnd(joinTime(hh, e.target.value));
                    }}
                    className="h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 outline-none hover:border-zinc-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-zinc-50 disabled:text-zinc-500"
                    disabled={slotDetailSubmitting}
                  >
                    {Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0")).map((mm) => (
                      <option key={mm} value={mm}>
                        {mm}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {(() => {
              const slotId = slotDetailSlotId;
              const slot = slotId ? slots.find((s) => s.id === slotId) ?? null : null;
              const bookingId =
                slot?.status === "pending"
                  ? slot.pendingBookingId
                  : slot?.status === "booked"
                    ? slot.bookedBookingId
                    : null;
              const booking = bookingId ? bookingById[bookingId] ?? null : null;

              if (!booking) return null;

              return (
                <div className="mt-6">
                  <div className="text-sm font-bold text-zinc-900">Thông tin học sinh</div>

                  <div className="mt-3">
                    <label className="block text-sm font-semibold text-zinc-700">Name</label>
                    <input
                      value={booking.studentName}
                      readOnly
                      className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm font-medium text-zinc-900 outline-none"
                    />
                  </div>

                  <div className="mt-3">
                    <label className="block text-sm font-semibold text-zinc-700">Số điện thoại</label>
                    <input
                      value={booking.studentPhone}
                      readOnly
                      className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm font-medium text-zinc-900 outline-none"
                    />
                  </div>

                  <div className="mt-3">
                    <label className="block text-sm font-semibold text-zinc-700">Môn học</label>
                    <input
                      value={booking.subject}
                      readOnly
                      className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm font-medium text-zinc-900 outline-none"
                    />
                  </div>
                </div>
              );
            })()}

            {slotDetailError ? <div className="mt-4 text-sm font-semibold text-red-600">{slotDetailError}</div> : null}

            {(() => {
              const slotId = slotDetailSlotId;
              const slot = slotId ? slots.find((s) => s.id === slotId) ?? null : null;
              const isPending = slot?.status === "pending";

              if (isPending) {
                return (
                  <div className="mt-6 flex items-center justify-end gap-3">
                    <button
                      type="button"
                      className="h-11 rounded-xl border border-zinc-200 bg-white px-5 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
                      onClick={onRejectPendingSlot}
                      disabled={slotDetailSubmitting}
                    >
                      {slotDetailSubmitting ? "Đang xử lý..." : "Từ chối"}
                    </button>
                    <button
                      type="button"
                      className="h-11 rounded-xl bg-blue-600 px-6 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                      onClick={onApprovePendingSlot}
                      disabled={slotDetailSubmitting}
                    >
                      {slotDetailSubmitting ? "Đang xử lý..." : "Duyệt"}
                    </button>
                  </div>
                );
              }

              return (
                <div className="mt-6 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    className="h-11 rounded-xl border border-zinc-200 bg-white px-5 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
                    onClick={onDeleteSlotDetail}
                    disabled={slotDetailSubmitting}
                  >
                    Xóa
                  </button>
                  <button
                    type="button"
                    className="h-11 rounded-xl bg-blue-600 px-6 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                    onClick={onSaveSlotDetail}
                    disabled={slotDetailSubmitting}
                  >
                    {slotDetailSubmitting ? "Đang lưu..." : "Lưu"}
                  </button>
                </div>
              );
            })()}
          </div>
        </div>
      ) : null}

      {confirmDeleteSlotOpen && isOwner ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg">
            {(() => {
              const slotId = confirmDeleteSlotId;
              const slot = slotId ? slots.find((s) => s.id === slotId) ?? null : null;
              const hasStudent = slot ? slot.status !== "available" : false;
              return (
                <>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-lg font-bold text-zinc-900">Xác nhận xóa ca học</div>
                      <div className="mt-1 text-sm text-zinc-500">Hành động này có thể ảnh hưởng đến học sinh.</div>
                    </div>
                    <button
                      type="button"
                      className="rounded-lg px-2 py-1 text-zinc-500 hover:bg-zinc-100"
                      onClick={() => {
                        if (slotDetailSubmitting) return;
                        setConfirmDeleteSlotOpen(false);
                        setConfirmDeleteSlotId(null);
                      }}
                      aria-label="Close"
                      disabled={slotDetailSubmitting}
                    >
                      ✕
                    </button>
                  </div>

                  <div className="mt-4 text-sm font-semibold text-zinc-700">
                    {slot ? `${slot.dayOfWeek} ${minutesToTime(slot.startMin)}–${minutesToTime(slot.endMin)}` : ""}
                  </div>

                  {hasStudent ? (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
                      Ca học này đang có học sinh. Khi xác nhận, ca học sẽ được reset về Trống và hệ thống sẽ gửi email thông báo cho học sinh.
                    </div>
                  ) : (
                    <div className="mt-3 text-sm font-semibold text-zinc-600">
                      Ca học chưa có học sinh. Khi xác nhận, ca học sẽ bị xóa khỏi lịch.
                    </div>
                  )}

                  <div className="mt-6 flex justify-end gap-3">
                    <button
                      type="button"
                      className="h-11 rounded-xl border border-zinc-200 bg-white px-5 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
                      onClick={() => {
                        setConfirmDeleteSlotOpen(false);
                        setConfirmDeleteSlotId(null);
                      }}
                      disabled={slotDetailSubmitting}
                    >
                      Hủy
                    </button>
                    <button
                      type="button"
                      className="h-11 rounded-xl bg-red-600 px-6 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                      onClick={onConfirmDeleteSlot}
                      disabled={slotDetailSubmitting}
                    >
                      {slotDetailSubmitting ? "Đang xóa..." : "Xác nhận"}
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      ) : null}

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
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <select
                    value={splitTime(slotStart).hh}
                    onChange={(e) => {
                      const { mm } = splitTime(slotStart);
                      setSlotStart(joinTime(e.target.value, mm));
                    }}
                    className="h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 outline-none focus:border-zinc-400"
                  >
                    {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")).map((hh) => (
                      <option key={hh} value={hh}>
                        {hh}
                      </option>
                    ))}
                  </select>
                  <select
                    value={splitTime(slotStart).mm}
                    onChange={(e) => {
                      const { hh } = splitTime(slotStart);
                      setSlotStart(joinTime(hh, e.target.value));
                    }}
                    className="h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 outline-none focus:border-zinc-400"
                  >
                    {Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0")).map((mm) => (
                      <option key={mm} value={mm}>
                        {mm}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-zinc-700">End time</label>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <select
                    value={splitTime(slotEnd).hh}
                    onChange={(e) => {
                      const { mm } = splitTime(slotEnd);
                      setSlotEnd(joinTime(e.target.value, mm));
                    }}
                    className="h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 outline-none focus:border-zinc-400"
                  >
                    {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")).map((hh) => (
                      <option key={hh} value={hh}>
                        {hh}
                      </option>
                    ))}
                  </select>
                  <select
                    value={splitTime(slotEnd).mm}
                    onChange={(e) => {
                      const { hh } = splitTime(slotEnd);
                      setSlotEnd(joinTime(hh, e.target.value));
                    }}
                    className="h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 outline-none focus:border-zinc-400"
                  >
                    {Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0")).map((mm) => (
                      <option key={mm} value={mm}>
                        {mm}
                      </option>
                    ))}
                  </select>
                </div>
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

      {copyToast ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20 px-4">
          <div className="rounded-2xl bg-zinc-900 px-5 py-3 text-sm font-semibold text-white shadow-xl">
            {copyToast}
          </div>
        </div>
      ) : null}

      {requestOpen && !isOwner ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-lg">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xl font-bold text-zinc-900">Yêu cầu đặt lịch</div>
                <div className="mt-1 text-sm text-zinc-500">
                  {requestSlot
                    ? `${requestSlot.dayOfWeek} ${minutesToTime(requestSlot.startMin)}–${minutesToTime(
                        requestSlot.endMin
                      )}`
                    : ""}
                </div>
              </div>
              <button
                type="button"
                className="rounded-lg px-2 py-1 text-zinc-500 hover:bg-zinc-100"
                onClick={() => {
                  setRequestOpen(false);
                  setRequestSlot(null);
                }}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-semibold text-zinc-700">Họ tên</label>
                <input
                  value={requestName}
                  onChange={(e) => setRequestName(e.target.value)}
                  placeholder="Nhập họ tên"
                  className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 outline-none focus:border-zinc-400"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold text-zinc-700">SĐT</label>
                <input
                  ref={requestPhoneRef}
                  value={requestPhone}
                  onChange={(e) => {
                    const next = e.target.value;
                    setRequestPhone(next.replace(/[^0-9]/g, ""));
                  }}
                  placeholder="Nhập số điện thoại"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 outline-none focus:border-zinc-400"
                />
              </div>
            </div>

            <div className="mt-4">
              <label className="block text-sm font-semibold text-zinc-700">Môn học</label>
              <input
                value={requestSubject}
                onChange={(e) => setRequestSubject(e.target.value)}
                placeholder="Ví dụ: Toán"
                className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-900 outline-none focus:border-zinc-400"
              />
            </div>

            <div className="mt-4">
              <label className="block text-sm font-semibold text-zinc-700">Lời nhắn (tuỳ chọn)</label>
              <textarea
                value={requestNote}
                onChange={(e) => setRequestNote(e.target.value)}
                placeholder="Nhập lời nhắn"
                className="mt-2 min-h-[90px] w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-900 outline-none focus:border-zinc-400"
              />
            </div>

            {requestError ? (
              <div className="mt-4 text-sm font-medium text-red-600">{requestError}</div>
            ) : null}

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                className="h-11 rounded-lg border border-zinc-200 bg-white px-5 text-sm font-semibold text-zinc-700 hover:bg-zinc-50"
                onClick={() => {
                  setRequestOpen(false);
                  setRequestSlot(null);
                }}
                disabled={requestSubmitting}
              >
                Hủy
              </button>
              <button
                type="button"
                className="h-11 rounded-lg bg-blue-600 px-5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                onClick={onRequestBookingSubmit}
                disabled={requestSubmitting || !requestSlot}
              >
                {requestSubmitting ? "Đang gửi..." : "Gửi yêu cầu"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
