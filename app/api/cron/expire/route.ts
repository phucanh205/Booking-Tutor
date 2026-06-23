import { NextResponse, type NextRequest } from "next/server";

import { getAdminDb } from "@/lib/firebaseAdmin";

type SlotStatus = "available" | "pending" | "booked";

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || "";
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = m?.[1] || "";
  const secret = process.env.CRON_SECRET || "";

  if (!secret || !token || token !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const db = getAdminDb();
    const now = new Date();

    const snap = await db
      .collection("bookings")
      .where("status", "==", "requested")
      .where("expiresAt", "<=", now)
      .limit(50)
      .get();

    if (snap.empty) {
      return NextResponse.json({ ok: true, expired: 0 });
    }

    let expired = 0;

    for (const docSnap of snap.docs) {
      const bookingId = docSnap.id;
      const booking = docSnap.data() as any;
      const bookingRef = db.collection("bookings").doc(bookingId);
      const slotRef = db.collection("slots").doc(String(booking?.slotId || ""));

      await db.runTransaction(async (tx) => {
        const freshBookingSnap = await tx.get(bookingRef);
        if (!freshBookingSnap.exists) return;
        const freshBooking = freshBookingSnap.data() as any;
        if (freshBooking?.status !== "requested") return;

        tx.update(bookingRef, {
          status: "expired",
          approveTokenHash: null,
          rejectTokenHash: null,
        });

        const slotSnap = await tx.get(slotRef);
        if (!slotSnap.exists) return;
        const slot = slotSnap.data() as any;
        if (slot?.status === "pending" && slot?.pendingBookingId === bookingId) {
          tx.update(slotRef, {
            status: "available" as SlotStatus,
            pendingBookingId: null,
            pendingExpiresAt: null,
          });
        }
      });

      expired += 1;
    }

    return NextResponse.json({ ok: true, expired });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
