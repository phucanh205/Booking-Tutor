import { NextResponse, type NextRequest } from "next/server";

import { getAdminDb } from "@/lib/firebaseAdmin";
import { htmlPage, sha256Base64Url } from "@/lib/bookingTokens";
import { getOriginFromRequest } from "@/lib/apiAuth";

type SlotStatus = "available" | "pending" | "booked";

export async function GET(req: NextRequest) {
  const bookingId = req.nextUrl.searchParams.get("bookingId") || "";
  const token = req.nextUrl.searchParams.get("token") || "";

  if (!bookingId || !token) {
    return new NextResponse(htmlPage("Thiếu thông tin", "Thiếu bookingId hoặc token."), {
      status: 400,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  try {
    const db = getAdminDb();
    const bookingRef = db.collection("bookings").doc(bookingId);

    let studentEmail: string | null = null;
    let subject: string | null = null;

    await db.runTransaction(async (tx) => {
      const bookingSnap = await tx.get(bookingRef);
      if (!bookingSnap.exists) throw new Error("not_found");

      const booking = bookingSnap.data() as any;
      if (booking?.status !== "requested") return;

      const now = Date.now();
      const expiresAt = booking?.actionTokenExpiresAt?.toDate?.()?.getTime?.() ?? null;
      if (!expiresAt || expiresAt <= now) {
        tx.update(bookingRef, { status: "expired", approveTokenHash: null, rejectTokenHash: null });
        const slotRef = db.collection("slots").doc(String(booking?.slotId || ""));
        const slotSnap = await tx.get(slotRef);
        if (slotSnap.exists) {
          const slot = slotSnap.data() as any;
          if (slot?.status === "pending" && slot?.pendingBookingId === bookingId) {
            tx.update(slotRef, { status: "available" as SlotStatus, pendingBookingId: null, pendingExpiresAt: null });
          }
        }
        return;
      }

      const expected = String(booking?.rejectTokenHash || "");
      const got = sha256Base64Url(token);
      if (!expected || expected !== got) throw new Error("invalid_token");

      const slotRef = db.collection("slots").doc(String(booking?.slotId || ""));
      const slotSnap = await tx.get(slotRef);
      if (!slotSnap.exists) throw new Error("slot_not_found");

      tx.update(bookingRef, { status: "rejected", approveTokenHash: null, rejectTokenHash: null });
      const slot = slotSnap.data() as any;
      if (slot?.status === "pending" && slot?.pendingBookingId === bookingId) {
        tx.update(slotRef, { status: "available" as SlotStatus, pendingBookingId: null, pendingExpiresAt: null });
      }

      studentEmail = typeof booking?.studentEmail === "string" ? booking.studentEmail : null;
      subject = typeof booking?.subject === "string" ? booking.subject : null;
    });

    // Best-effort student email
    if (studentEmail) {
      const origin = getOriginFromRequest(req);
      if (origin) {
        await fetch(`${origin}/api/notify-email`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            to: studentEmail,
            subject: `Đặt lịch bị từ chối${subject ? `: ${subject}` : ""}`,
            html: `<div style="font-family:ui-sans-serif,system-ui,Arial;">
  <h2>Đặt lịch bị từ chối</h2>
  <p>Yêu cầu đặt lịch của bạn đã bị giáo viên từ chối.</p>
</div>`,
          }),
        }).catch(() => null);
      }
    }

    return new NextResponse(htmlPage("Đã từ chối", "Bạn có thể đóng tab này."), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  } catch (e) {
    return new NextResponse(htmlPage("Không thể từ chối", "Link không hợp lệ hoặc đã hết hạn."), {
      status: 403,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
}
