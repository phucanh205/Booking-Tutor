import { type NextRequest } from "next/server";

import { getAdminAuth } from "@/lib/firebaseAdmin";

export async function requireUserUid(req: NextRequest): Promise<string> {
  const authHeader = req.headers.get("authorization") || "";
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = m?.[1];
  if (!token) {
    throw new Error("missing_bearer_token");
  }

  const decoded = await getAdminAuth().verifyIdToken(token);
  if (!decoded?.uid) {
    throw new Error("invalid_token");
  }
  return decoded.uid;
}

export function getOriginFromRequest(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  return host ? `${proto}://${host}` : "";
}
