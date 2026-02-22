import { NextResponse, type NextRequest } from "next/server";

import { getAdminDb } from "@/lib/firebaseAdmin";
import { getOriginFromRequest, requireUserUid } from "@/lib/apiAuth";
import { randomToken, sha256Base64Url } from "@/lib/bookingTokens";

type SlotStatus = "available" | "pending" | "booked";

type BookingStatus = "requested" | "approved" | "rejected" | "expired";

export async function POST(req: NextRequest) {
  try {
    const uid = await requireUserUid(req);

    const body = (await req.json()) as any;
    const roomId = typeof body?.roomId === "string" ? body.roomId.trim() : "";
    const slotId = typeof body?.slotId === "string" ? body.slotId.trim() : "";
    const studentName = typeof body?.studentName === "string" ? body.studentName.trim() : "";
    const studentPhone = typeof body?.studentPhone === "string" ? body.studentPhone.trim() : "";
    const subject = typeof body?.subject === "string" ? body.subject.trim() : "";
    const note = typeof body?.note === "string" ? body.note.trim() : "";

    if (!roomId || !slotId) {
      return NextResponse.json({ ok: false, error: "missing_room_slot" }, { status: 400 });
    }
    if (!studentName || !studentPhone || !subject) {
      return NextResponse.json({ ok: false, error: "missing_student_fields" }, { status: 400 });
    }

    const db = getAdminDb();

    const userRecord = await (async () => {
      try {
        // importing admin auth here avoids circular deps if any
        const { getAdminAuth } = await import("@/lib/firebaseAdmin");
        return await getAdminAuth().getUser(uid);
      } catch {
        return null;
      }
    })();

    const studentEmail = (userRecord?.email || "").toLowerCase();
    if (!studentEmail) {
      return NextResponse.json({ ok: false, error: "missing_student_email" }, { status: 400 });
    }

    const approveToken = randomToken();
    const rejectToken = randomToken();

    const now = Date.now();
    const expiresAtMs = now + 24 * 60 * 60 * 1000;

    const bookingRef = db.collection("bookings").doc();
    const slotRef = db.collection("slots").doc(slotId);

    let ownerEmail: string | null = null;
    let ownerUid: string | null = null;
    let slotDayOfWeek: string | null = null;
    let slotStartMin: number | null = null;
    let slotEndMin: number | null = null;

    await db.runTransaction(async (tx) => {
      const slotSnap = await tx.get(slotRef);
      if (!slotSnap.exists) {
        throw new Error("slot_not_found");
      }

      const slot = slotSnap.data() as any;
      if (slot?.roomId !== roomId) {
        throw new Error("slot_room_mismatch");
      }

      const status = String(slot?.status || "available") as SlotStatus;
      if (status !== "available") {
        throw new Error("slot_not_available");
      }

      slotDayOfWeek = typeof slot?.dayOfWeek === "string" ? slot.dayOfWeek : null;
      slotStartMin = typeof slot?.startMin === "number" ? slot.startMin : null;
      slotEndMin = typeof slot?.endMin === "number" ? slot.endMin : null;

      const roomSnap = await tx.get(db.collection("rooms").doc(roomId));
      if (!roomSnap.exists) {
        throw new Error("room_not_found");
      }
      const room = roomSnap.data() as any;
      ownerEmail = typeof room?.ownerEmail === "string" ? room.ownerEmail : null;
      ownerUid = typeof room?.ownerId === "string" ? room.ownerId : null;

      const booking = {
        roomId,
        slotId,
        tutorId: typeof slot?.tutorId === "string" ? slot.tutorId : "",
        studentUid: uid,
        studentName,
        studentEmail,
        studentPhone,
        subject,
        note: note || null,
        status: "requested" as BookingStatus,
        createdAt: new Date(now),
        expiresAt: new Date(expiresAtMs),
        approveTokenHash: sha256Base64Url(approveToken),
        rejectTokenHash: sha256Base64Url(rejectToken),
        actionTokenExpiresAt: new Date(expiresAtMs),
      };

      tx.set(bookingRef, booking);
      tx.update(slotRef, {
        status: "pending" as SlotStatus,
        pendingBookingId: bookingRef.id,
        pendingExpiresAt: new Date(expiresAtMs),
      });
    });

    const origin = getOriginFromRequest(req);
    const approveUrl = origin
      ? `${origin}/api/bookings/approve?bookingId=${encodeURIComponent(
          bookingRef.id
        )}&token=${encodeURIComponent(approveToken)}`
      : null;

    const rejectUrl = origin
      ? `${origin}/api/bookings/reject?bookingId=${encodeURIComponent(
          bookingRef.id
        )}&token=${encodeURIComponent(rejectToken)}`
      : null;

    if (!ownerEmail && ownerUid) {
      try {
        const { getAdminAuth } = await import("@/lib/firebaseAdmin");
        const ownerRecord = await getAdminAuth().getUser(ownerUid);
        ownerEmail = (ownerRecord?.email || "").toLowerCase() || null;
      } catch {
        // ignore
      }
    }

    let mailSent = false;
    let mailError: string | null = null;

    if (ownerEmail && approveUrl && rejectUrl) {
      const slotText =
        slotDayOfWeek && slotStartMin != null && slotEndMin != null
          ? `${slotDayOfWeek} ${String(Math.floor(slotStartMin / 60)).padStart(2, "0")}:${String(
              slotStartMin % 60
            ).padStart(2, "0")}-${String(Math.floor(slotEndMin / 60)).padStart(2, "0")}:${String(
              slotEndMin % 60
            ).padStart(2, "0")}`
          : "";

      const subjectLine = `Yêu cầu đặt lịch: ${subject}${slotText ? ` (${slotText})` : ""}`;

      try {
        const res = await fetch(`${origin}/api/notify-email`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            to: ownerEmail,
            subject: subjectLine,
            html: `<div style="font-family:ui-sans-serif,system-ui,Arial;">
  <h2>Yêu cầu đặt lịch mới</h2>
  <p><b>Học sinh:</b> ${studentName} (${studentEmail})</p>
  <p><b>SĐT:</b> ${studentPhone}</p>
  <p><b>Môn học:</b> ${subject}</p>
  ${slotText ? `<p><b>Slot:</b> ${slotText}</p>` : ""}
  ${note ? `<p><b>Lời nhắn:</b> ${note}</p>` : ""}
  <p>
    <a href="${approveUrl}" style="display:inline-block;padding:10px 14px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;margin-right:8px;">Duyệt</a>
    <a href="${rejectUrl}" style="display:inline-block;padding:10px 14px;background:#ef4444;color:#fff;text-decoration:none;border-radius:8px;">Từ chối</a>
  </p>
  <p style="color:#6b7280;">Link sẽ hết hạn sau 24h.</p>
</div>`,
          }),
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

    return NextResponse.json({
      ok: true,
      bookingId: bookingRef.id,
      expiresAt: new Date(expiresAtMs).toISOString(),
      approveUrl,
      rejectUrl,
      mailSent,
      mailError,
      ownerEmail: ownerEmail ? ownerEmail : null,
    });
  } catch (e) {
    const msg = String(e);
    const status = msg.includes("permission") ? 403 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
