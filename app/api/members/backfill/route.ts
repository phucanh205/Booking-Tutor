import { NextResponse, type NextRequest } from "next/server";

import { getAdminAuth, getAdminDb } from "@/lib/firebaseAdmin";
import { requireUserUid } from "@/lib/apiAuth";

export async function POST(req: NextRequest) {
  try {
    const uid = await requireUserUid(req);

    const body = (await req.json()) as any;
    const roomId = typeof body?.roomId === "string" ? body.roomId.trim() : "";
    if (!roomId) {
      return NextResponse.json({ ok: false, error: "missing_roomId" }, { status: 400 });
    }

    const db = getAdminDb();
    const roomRef = db.collection("rooms").doc(roomId);

    const roomSnap = await roomRef.get();
    if (!roomSnap.exists) {
      return NextResponse.json({ ok: false, error: "room_not_found" }, { status: 404 });
    }

    const room = roomSnap.data() as any;
    if (String(room?.ownerId || "") !== uid) {
      return NextResponse.json({ ok: false, error: "not_owner" }, { status: 403 });
    }

    const membersSnap = await roomRef.collection("members").get();

    const adminAuth = getAdminAuth();

    const results = await Promise.all(
      membersSnap.docs.map(async (d) => {
        const data = d.data() as any;
        const curName = typeof data?.displayName === "string" ? data.displayName.trim() : "";
        const curEmail = typeof data?.email === "string" ? data.email.trim() : "";
        const curPhoto = typeof data?.photoURL === "string" ? data.photoURL.trim() : "";
        if (curName && curEmail && curPhoto) return "skipped" as const;

        try {
          const u = await adminAuth.getUser(d.id);
          const displayName = (u.displayName || "").trim();
          const email = (u.email || "").toLowerCase().trim();
          const photoURL = (u.photoURL || "").trim();

          if (!displayName && !email && !photoURL) return "skipped" as const;

          await d.ref.set(
            {
              displayName: displayName || null,
              email: email || null,
              photoURL: photoURL || null,
            },
            { merge: true }
          );
          return "updated" as const;
        } catch {
          return "error" as const;
        }
      })
    );

    const updated = results.filter((r) => r === "updated").length;
    const skipped = results.filter((r) => r === "skipped").length;
    const errors = results.filter((r) => r === "error").length;

    return NextResponse.json({ ok: true, updated, skipped, errors, total: membersSnap.size });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
