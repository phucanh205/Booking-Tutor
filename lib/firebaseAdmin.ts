import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function parseServiceAccountJson() {
  const raw = requireEnv("FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON");
  // Support both raw JSON and base64 JSON.
  const trimmed = raw.trim();
  const jsonText = trimmed.startsWith("{") ? trimmed : Buffer.from(trimmed, "base64").toString("utf8");
  const obj = JSON.parse(jsonText) as {
    project_id: string;
    client_email: string;
    private_key: string;
  };

  if (!obj.project_id || !obj.client_email || !obj.private_key) {
    throw new Error("Invalid FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON: missing keys");
  }

  return {
    projectId: obj.project_id,
    clientEmail: obj.client_email,
    privateKey: obj.private_key,
  };
}

export function getAdminApp() {
  if (getApps().length) return getApps()[0]!;
  const sa = parseServiceAccountJson();
  return initializeApp({
    credential: cert({
      projectId: sa.projectId,
      clientEmail: sa.clientEmail,
      privateKey: sa.privateKey,
    }),
  });
}

export function getAdminAuth() {
  getAdminApp();
  return getAuth();
}

export function getAdminDb() {
  getAdminApp();
  return getFirestore();
}
