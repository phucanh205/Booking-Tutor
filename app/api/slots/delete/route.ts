import { NextResponse, type NextRequest } from "next/server";

import { getAdminDb } from "@/lib/firebaseAdmin";
import { getOriginFromRequest, requireUserUid } from "@/lib/apiAuth";

type SlotStatus = "available" | "pending" | "booked";

type BookingStatus = "requested" | "approved" | "rejected" | "expired";

function minutesToTime(min: number) {
  const hh = Math.floor(min / 60);
  const mm = min % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export async function POST(req: NextRequest) {
  try {
    const uid = await requireUserUid(req);

    const body = (await req.json()) as any;
    const roomId = typeof body?.roomId === "string" ? body.roomId.trim() : "";
    const slotId = typeof body?.slotId === "string" ? body.slotId.trim() : "";

    if (!roomId || !slotId) {
      return NextResponse.json({ ok: false, error: "missing_fields" }, { status: 400 });
    }

    const db = getAdminDb();

    const slotRef = db.collection("slots").doc(slotId);
    const roomRef = db.collection("rooms").doc(roomId);

    let studentEmail: string | null = null;
    let studentName: string | null = null;
    let slotDayOfWeek: string | null = null;
    let slotStartMin: number | null = null;
    let slotEndMin: number | null = null;

    const action = await db.runTransaction(async (tx) => {
      const roomSnap = await tx.get(roomRef);
      if (!roomSnap.exists) throw new Error("room_not_found");
      const room = roomSnap.data() as any;
      if (String(room?.ownerId || "") !== uid) throw new Error("not_owner");

      const slotSnap = await tx.get(slotRef);
      if (!slotSnap.exists) throw new Error("slot_not_found");
      const slot = slotSnap.data() as any;

      if (String(slot?.roomId || "") !== roomId) throw new Error("slot_room_mismatch");

      const status = String(slot?.status || "available") as SlotStatus;

      slotDayOfWeek = typeof slot?.dayOfWeek === "string" ? slot.dayOfWeek : null;
      slotStartMin = typeof slot?.startMin === "number" ? slot.startMin : null;
      slotEndMin = typeof slot?.endMin === "number" ? slot.endMin : null;

      const bookingId =
        status === "pending"
          ? (typeof slot?.pendingBookingId === "string" ? slot.pendingBookingId : "")
          : status === "booked"
            ? (typeof slot?.bookedBookingId === "string" ? slot.bookedBookingId : "")
            : "";

      if (!bookingId) {
        tx.delete(slotRef);
        return "deleted" as const;
      }

      const bookingRef = db.collection("bookings").doc(bookingId);
      const bookingSnap = await tx.get(bookingRef);
      if (bookingSnap.exists) {
        const booking = bookingSnap.data() as any;
        studentEmail = typeof booking?.studentEmail === "string" ? booking.studentEmail : null;
        studentName = typeof booking?.studentName === "string" ? booking.studentName : null;

        const currentStatus = String(booking?.status || "") as BookingStatus;
        if (currentStatus !== "expired") {
          tx.update(bookingRef, {
            status: "expired" as BookingStatus,
            approveTokenHash: null,
            rejectTokenHash: null,
            cancelledAt: new Date(),
            cancelledBy: uid,
          });
        }
      }

      tx.update(slotRef, {
        status: "available" as SlotStatus,
        pendingBookingId: null,
        pendingExpiresAt: null,
        bookedBookingId: null,
      });

      return "reset" as const;
    });

    let mailSent = false;
    let mailError: string | null = null;

    if (action === "reset" && studentEmail && studentName && slotDayOfWeek && slotStartMin != null && slotEndMin != null) {
      const origin = getOriginFromRequest(req);
      if (origin) {
        const slotText = `${slotDayOfWeek} ${minutesToTime(slotStartMin)} – ${minutesToTime(slotEndMin)}`;
        const subject = `Thông báo thay đổi ca học (${slotText})`;
        const html = `<div style="font-family:ui-sans-serif,system-ui,Arial;line-height:1.6;">
  <p>Xin chào <b>${studentName}</b>,</p>
  <p>Ca học vào <b>${slotText}</b> đã được giáo viên điều chỉnh và hiện không còn hiệu lực.</p>
  <p>Bạn vui lòng liên hệ giáo viên để sắp xếp ca học mới phù hợp.</p>
  <p>Xin cảm ơn.</p>
</div>`;

        try {
          const res = await fetch(`${origin}/api/notify-email`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ to: studentEmail, subject, html }),
          });

          const data = (await res.json().catch(() => null)) as any;
          if (res.ok && data?.ok === true) {
            mailSent = true;
          } else {
            mailError = typeof data?.error === "string" ? data.error : `notify_email_failed_${res.status}`;
          }
        } catch (e) {
          mailError = String(e);
        }
      }
    }

    return NextResponse.json({
      ok: true,
      action,
      mailSent,
      mailError,
    });
  } catch (e) {
    const msg = String(e);
    const status = msg.includes("not_owner") ? 403 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
