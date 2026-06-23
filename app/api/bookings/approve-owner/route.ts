import { NextResponse, type NextRequest } from "next/server";

import { getAdminDb } from "@/lib/firebaseAdmin";
import { getOriginFromRequest, requireUserUid } from "@/lib/apiAuth";

type SlotStatus = "available" | "pending" | "booked";
type BookingStatus = "requested" | "approved" | "rejected" | "expired";

export async function POST(req: NextRequest) {
  try {
    const uid = await requireUserUid(req);

    const body = (await req.json()) as any;
    const roomId = typeof body?.roomId === "string" ? body.roomId.trim() : "";
    const slotId = typeof body?.slotId === "string" ? body.slotId.trim() : "";

    if (!roomId || !slotId) {
      return NextResponse.json({ ok: false, error: "missing_room_slot" }, { status: 400 });
    }

    const db = getAdminDb();
    const roomRef = db.collection("rooms").doc(roomId);
    const slotRef = db.collection("slots").doc(slotId);

    let studentEmail: string | null = null;
    let subject: string | null = null;

    await db.runTransaction(async (tx) => {
      const roomSnap = await tx.get(roomRef);
      if (!roomSnap.exists) throw new Error("room_not_found");
      const room = roomSnap.data() as any;
      if (String(room?.ownerId || "") !== uid) throw new Error("not_owner");

      const slotSnap = await tx.get(slotRef);
      if (!slotSnap.exists) throw new Error("slot_not_found");
      const slot = slotSnap.data() as any;
      if (String(slot?.roomId || "") !== roomId) throw new Error("slot_room_mismatch");

      if (String(slot?.status || "") !== "pending") throw new Error("slot_not_pending");

      const bookingId = typeof slot?.pendingBookingId === "string" ? slot.pendingBookingId : "";
      if (!bookingId) throw new Error("missing_pending_booking");

      const bookingRef = db.collection("bookings").doc(bookingId);
      const bookingSnap = await tx.get(bookingRef);
      if (!bookingSnap.exists) throw new Error("booking_not_found");
      const booking = bookingSnap.data() as any;

      const bookingStatus = String(booking?.status || "") as BookingStatus;
      if (bookingStatus !== "requested") throw new Error("booking_not_requested");
      if (String(booking?.roomId || "") !== roomId) throw new Error("booking_room_mismatch");
      if (String(booking?.slotId || "") !== slotId) throw new Error("booking_slot_mismatch");

      tx.update(bookingRef, { status: "approved" as BookingStatus, approveTokenHash: null, rejectTokenHash: null });
      tx.update(slotRef, {
        status: "booked" as SlotStatus,
        bookedBookingId: bookingId,
        pendingBookingId: null,
        pendingExpiresAt: null,
      });

      studentEmail = typeof booking?.studentEmail === "string" ? booking.studentEmail : null;
      subject = typeof booking?.subject === "string" ? booking.subject : null;
    });

    if (studentEmail) {
      const origin = getOriginFromRequest(req);
      if (origin) {
        await fetch(`${origin}/api/notify-email`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            to: studentEmail,
            subject: `Đặt lịch đã được duyệt${subject ? `: ${subject}` : ""}`,
            html: `<div style="font-family:ui-sans-serif,system-ui,Arial;">
  <h2>Đặt lịch đã được duyệt</h2>
  <p>Yêu cầu đặt lịch của bạn đã được giáo viên duyệt.</p>
</div>`,
          }),
        }).catch(() => null);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = String(e);
    const status = msg.includes("not_owner") ? 403 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
