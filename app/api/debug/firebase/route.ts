import { NextResponse } from "next/server";

function normalize(raw: string | undefined) {
  if (!raw) return null;
  const trimmed = raw.trim();
  const unquoted = trimmed.replace(/^\"(.*)\"$/, "$1").replace(/^'(.*)'$/, "$1");
  return unquoted;
}

export function GET() {
  const keys = Object.keys(process.env);
  const firebaseKeys = keys
    .filter((k) => k.toLowerCase().includes("firebase"))
    .sort();

  const apiKey = normalize(process.env.NEXT_PUBLIC_FIREBASE_API_KEY);
  const apiKeyWithBom = normalize(process.env["\uFEFFNEXT_PUBLIC_FIREBASE_API_KEY"]);
  const apiKeyWithCr = normalize(process.env["NEXT_PUBLIC_FIREBASE_API_KEY\r"]);

  const authDomain = normalize(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN);
  const projectId = normalize(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID);

  return NextResponse.json({
    projectId,
    authDomain,
    apiKeyPrefix: apiKey ? apiKey.slice(0, 8) : null,
    apiKeyPrefix_bomKey: apiKeyWithBom ? apiKeyWithBom.slice(0, 8) : null,
    apiKeyPrefix_crKey: apiKeyWithCr ? apiKeyWithCr.slice(0, 8) : null,
    firebaseKeys,
  });
}
