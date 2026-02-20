import crypto from "node:crypto";

import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import nodemailer from "nodemailer";

initializeApp();

const db = getFirestore();

const SMTP_GMAIL_USER = defineSecret("SMTP_GMAIL_USER");
const SMTP_GMAIL_APP_PASSWORD = defineSecret("SMTP_GMAIL_APP_PASSWORD");

type SlotStatus = "available" | "pending" | "booked";

type SlotDoc = {
  roomId: string;
  tutorId: string;
  dayOfWeek: string;
  startMin: number;
  endMin: number;
  status: SlotStatus;
  pendingBookingId?: string | null;
  pendingExpiresAt?: FirebaseFirestore.Timestamp | null;
  bookedBookingId?: string | null;
};

type BookingStatus = "requested" | "approved" | "rejected" | "expired";

type BookingDoc = {
  roomId: string;
  slotId: string;
  tutorId: string;
  studentUid: string;
  studentName: string;
  studentEmail: string;
  studentPhone: string;
  subject: string;
  note?: string;
  status: BookingStatus;
  createdAt: FirebaseFirestore.Timestamp;
  expiresAt: FirebaseFirestore.Timestamp;
  approveTokenHash?: string | null;
  rejectTokenHash?: string | null;
  actionTokenExpiresAt?: FirebaseFirestore.Timestamp | null;
};

function sha256Base64Url(input: string) {
  const hash = crypto.createHash("sha256").update(input).digest("base64");
  return hash.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomToken() {
  return crypto.randomBytes(32).toString("hex");
}

function toPlainTextTime(startMin: number, endMin: number) {
  const fmt = (m: number) => {
    const hh = Math.floor(m / 60);
    const mm = m % 60;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  };
  return `${fmt(startMin)}-${fmt(endMin)}`;
}

function htmlPage(title: string, body: string) {
  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${title}</title>
</head>
<body style="font-family:ui-sans-serif,system-ui,Arial; padding:24px;">
<h2>${title}</h2>
<div>${body}</div>
</body>
</html>`;
}

export const requestBooking = onCall(
  {
    secrets: [SMTP_GMAIL_USER, SMTP_GMAIL_APP_PASSWORD],
  },
  async (req) => {
    const auth = req.auth;
    if (!auth?.uid) {
      throw new HttpsError("unauthenticated", "Unauthenticated");
    }

    const roomId = typeof req.data?.roomId === "string" ? req.data.roomId.trim() : "";
    const slotId = typeof req.data?.slotId === "string" ? req.data.slotId.trim() : "";
    const studentName = typeof req.data?.studentName === "string" ? req.data.studentName.trim() : "";
    const studentPhone = typeof req.data?.studentPhone === "string" ? req.data.studentPhone.trim() : "";
    const subject = typeof req.data?.subject === "string" ? req.data.subject.trim() : "";
    const note = typeof req.data?.note === "string" ? req.data.note.trim() : "";

    if (!roomId || !slotId) {
      throw new HttpsError("invalid-argument", "roomId and slotId are required");
    }
    if (!studentName || !studentPhone || !subject) {
      throw new HttpsError("invalid-argument", "studentName, studentPhone, subject are required");
    }

    const studentEmail = (auth.token.email as string | undefined) ?? "";
    if (!studentEmail) {
      throw new HttpsError("failed-precondition", "Student email is required");
    }

    const approveToken = randomToken();
    const rejectToken = randomToken();

    const now = Timestamp.now();
    const expiresAt = Timestamp.fromMillis(now.toMillis() + 24 * 60 * 60 * 1000);

    const bookingRef = db.collection("bookings").doc();
    const slotRef = db.collection("slots").doc(slotId);

    let tutorId = "";
    let slotStartMin = 0;
    let slotEndMin = 0;
    let dayOfWeek = "";

    await db.runTransaction(async (tx) => {
      const slotSnap = await tx.get(slotRef);
      if (!slotSnap.exists) {
        throw new HttpsError("not-found", "Slot not found");
      }

      const slot = slotSnap.data() as SlotDoc;
      if (slot.roomId !== roomId) {
        throw new HttpsError("permission-denied", "Slot does not belong to this room");
      }

      if (slot.status !== "available") {
        throw new HttpsError("failed-precondition", "Slot is not available");
      }

      tutorId = slot.tutorId;
      slotStartMin = slot.startMin;
      slotEndMin = slot.endMin;
      dayOfWeek = slot.dayOfWeek;

      const booking: BookingDoc = {
        roomId,
        slotId,
        tutorId,
        studentUid: auth.uid,
        studentName,
        studentEmail: studentEmail.toLowerCase(),
        studentPhone,
        subject,
        note: note || undefined,
        status: "requested",
        createdAt: now,
        expiresAt,
        approveTokenHash: sha256Base64Url(approveToken),
        rejectTokenHash: sha256Base64Url(rejectToken),
        actionTokenExpiresAt: expiresAt,
      };

      tx.set(bookingRef, booking);
      tx.update(slotRef, {
        status: "pending",
        pendingBookingId: bookingRef.id,
        pendingExpiresAt: expiresAt,
      });
    });

    const roomSnap = await db.collection("rooms").doc(roomId).get();
    const ownerEmail = (roomSnap.exists ? (roomSnap.data() as any)?.ownerEmail : null) as string | null;

    // Derive Functions base URL from the callable request host.
    // This avoids needing FUNCTIONS_BASE_URL or any client-provided origin.
    const rawReq = req.rawRequest;
    const xfHost = rawReq?.headers?.["x-forwarded-host"];
    const hostHeader = (Array.isArray(xfHost) ? xfHost[0] : xfHost) || rawReq?.headers?.host;
    const xfProto = rawReq?.headers?.["x-forwarded-proto"];
    const protoHeader = (Array.isArray(xfProto) ? xfProto[0] : xfProto) || "https";
    const functionsOrigin = hostHeader ? `${protoHeader}://${hostHeader}` : "";

    const approveUrl = functionsOrigin
      ? `${functionsOrigin}/approveBooking?bookingId=${encodeURIComponent(
          bookingRef.id
        )}&token=${encodeURIComponent(approveToken)}`
      : null;

    const rejectUrl = functionsOrigin
      ? `${functionsOrigin}/rejectBooking?bookingId=${encodeURIComponent(
          bookingRef.id
        )}&token=${encodeURIComponent(rejectToken)}`
      : null;

    // Email via Gmail SMTP (App Password). We won't fail booking creation if email cannot be sent.
    if (ownerEmail && approveUrl && rejectUrl) {
      try {
        const smtpUser = SMTP_GMAIL_USER.value();
        const smtpPass = SMTP_GMAIL_APP_PASSWORD.value();

        const transporter = nodemailer.createTransport({
          host: "smtp.gmail.com",
          port: 465,
          secure: true,
          auth: {
            user: smtpUser,
            pass: smtpPass,
          },
        });

        await transporter.sendMail({
          from: `Booking Tutor <${smtpUser}>`,
          to: ownerEmail,
          subject: `Yêu cầu đặt lịch: ${subject} (${toPlainTextTime(slotStartMin, slotEndMin)})`,
          html: `<div style="font-family:ui-sans-serif,system-ui,Arial;">
  <h2>Yêu cầu đặt lịch mới</h2>
  <p><b>Học sinh:</b> ${studentName} (${studentEmail})</p>
  <p><b>SĐT:</b> ${studentPhone}</p>
  <p><b>Môn học:</b> ${subject}</p>
  <p><b>Slot:</b> ${dayOfWeek} ${toPlainTextTime(slotStartMin, slotEndMin)}</p>
  ${note ? `<p><b>Lời nhắn:</b> ${note}</p>` : ""}
  <p>
    <a href="${approveUrl}" style="display:inline-block;padding:10px 14px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px;margin-right:8px;">Duyệt</a>
    <a href="${rejectUrl}" style="display:inline-block;padding:10px 14px;background:#ef4444;color:#fff;text-decoration:none;border-radius:8px;">Từ chối</a>
  </p>
  <p style="color:#6b7280;">Link sẽ hết hạn sau 24h.</p>
</div>`,
        });
      } catch (e) {
        console.error("requestBooking: smtp send failed", e);
      }
    } else if (!ownerEmail) {
      console.warn("requestBooking: room missing ownerEmail - skip email");
    }

    return {
      ok: true,
      bookingId: bookingRef.id,
      expiresAt: expiresAt.toDate().toISOString(),
      approveUrl,
      rejectUrl,
    };
  }
);

async function handleTokenAction(action: "approve" | "reject", bookingId: string, token: string) {
  const bookingRef = db.collection("bookings").doc(bookingId);

  await db.runTransaction(async (tx) => {
    const bookingSnap = await tx.get(bookingRef);
    if (!bookingSnap.exists) {
      throw new HttpsError("not-found", "Booking not found");
    }

    const booking = bookingSnap.data() as BookingDoc;

    if (booking.status !== "requested") {
      return;
    }

    const now = Timestamp.now();
    const tokenExpiresAt = booking.actionTokenExpiresAt;
    if (!tokenExpiresAt || tokenExpiresAt.toMillis() <= now.toMillis()) {
      tx.update(bookingRef, { status: "expired", approveTokenHash: null, rejectTokenHash: null });
      const slotRef = db.collection("slots").doc(booking.slotId);
      const slotSnap = await tx.get(slotRef);
      if (slotSnap.exists) {
        const slot = slotSnap.data() as SlotDoc;
        if (slot.pendingBookingId === bookingId && slot.status === "pending") {
          tx.update(slotRef, {
            status: "available",
            pendingBookingId: null,
            pendingExpiresAt: null,
          });
        }
      }
      return;
    }

    const tokenHash = sha256Base64Url(token);
    const expected = action === "approve" ? booking.approveTokenHash : booking.rejectTokenHash;
    if (!expected || expected !== tokenHash) {
      throw new HttpsError("permission-denied", "Invalid token");
    }

    const slotRef = db.collection("slots").doc(booking.slotId);
    const slotSnap = await tx.get(slotRef);
    if (!slotSnap.exists) {
      throw new HttpsError("not-found", "Slot not found");
    }

    const slot = slotSnap.data() as SlotDoc;

    if (action === "approve") {
      tx.update(bookingRef, {
        status: "approved",
        approveTokenHash: null,
        rejectTokenHash: null,
      });
      tx.update(slotRef, {
        status: "booked",
        bookedBookingId: bookingId,
        pendingBookingId: null,
        pendingExpiresAt: null,
      });
    } else {
      tx.update(bookingRef, {
        status: "rejected",
        approveTokenHash: null,
        rejectTokenHash: null,
      });
      if (slot.pendingBookingId === bookingId && slot.status === "pending") {
        tx.update(slotRef, {
          status: "available",
          pendingBookingId: null,
          pendingExpiresAt: null,
        });
      }
    }
  });
}

export const approveBooking = onRequest(async (req, res) => {
  const bookingId = typeof req.query.bookingId === "string" ? req.query.bookingId : "";
  const token = typeof req.query.token === "string" ? req.query.token : "";

  try {
    if (!bookingId || !token) {
      res.status(400).send(htmlPage("Thiếu thông tin", "Thiếu bookingId hoặc token."));
      return;
    }
    await handleTokenAction("approve", bookingId, token);
    res.status(200).send(htmlPage("Duyệt thành công", "Bạn có thể đóng tab này."));
  } catch (e) {
    console.error("approveBooking failed", e);
    res.status(403).send(htmlPage("Không thể duyệt", "Link không hợp lệ hoặc đã hết hạn."));
  }
});

export const rejectBooking = onRequest(async (req, res) => {
  const bookingId = typeof req.query.bookingId === "string" ? req.query.bookingId : "";
  const token = typeof req.query.token === "string" ? req.query.token : "";

  try {
    if (!bookingId || !token) {
      res.status(400).send(htmlPage("Thiếu thông tin", "Thiếu bookingId hoặc token."));
      return;
    }
    await handleTokenAction("reject", bookingId, token);
    res.status(200).send(htmlPage("Đã từ chối", "Bạn có thể đóng tab này."));
  } catch (e) {
    console.error("rejectBooking failed", e);
    res.status(403).send(htmlPage("Không thể từ chối", "Link không hợp lệ hoặc đã hết hạn."));
  }
});

export const expirePendingBookings = onSchedule("every 5 minutes", async () => {
  const now = Timestamp.now();
  const snap = await db
    .collection("bookings")
    .where("status", "==", "requested")
    .where("expiresAt", "<=", now)
    .limit(50)
    .get();

  if (snap.empty) return;

  for (const docSnap of snap.docs) {
    const bookingId = docSnap.id;
    const booking = docSnap.data() as BookingDoc;
    const bookingRef = db.collection("bookings").doc(bookingId);
    const slotRef = db.collection("slots").doc(booking.slotId);

    await db.runTransaction(async (tx) => {
      const freshBookingSnap = await tx.get(bookingRef);
      if (!freshBookingSnap.exists) return;
      const freshBooking = freshBookingSnap.data() as BookingDoc;
      if (freshBooking.status !== "requested") return;

      tx.update(bookingRef, {
        status: "expired",
        approveTokenHash: null,
        rejectTokenHash: null,
      });

      const slotSnap = await tx.get(slotRef);
      if (!slotSnap.exists) return;
      const slot = slotSnap.data() as SlotDoc;
      if (slot.status === "pending" && slot.pendingBookingId === bookingId) {
        tx.update(slotRef, {
          status: "available",
          pendingBookingId: null,
          pendingExpiresAt: null,
        });
      }
    });
  }
});
