import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";

function normalizeEnv(raw: string | undefined) {
  if (!raw) return null;
  const trimmed = raw.trim();
  const unquoted = trimmed.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  return unquoted;
}

function requiredEnv(name: string, raw: string | undefined) {
  const v = normalizeEnv(raw);
  if (!v) {
    throw new Error(
      `Missing env var: ${name}. Check .env.local is loaded and formatted as ${name}=... then restart \"npm run dev\".`
    );
  }
  return v;
}

let cachedApp: FirebaseApp | null = null;
let cachedAuth: Auth | null = null;
let cachedDb: Firestore | null = null;
let cachedStorage: FirebaseStorage | null = null;

export function getFirebaseApp() {
  if (cachedApp) return cachedApp;

  const env = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };

  const firebaseConfig = {
    apiKey: requiredEnv("NEXT_PUBLIC_FIREBASE_API_KEY", env.apiKey),
    authDomain: requiredEnv("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", env.authDomain),
    projectId: requiredEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", env.projectId),
    storageBucket: requiredEnv(
      "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
      env.storageBucket
    ),
    messagingSenderId: requiredEnv(
      "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
      env.messagingSenderId
    ),
    appId: requiredEnv("NEXT_PUBLIC_FIREBASE_APP_ID", env.appId),
  };

  cachedApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  return cachedApp;
}

export function getFirebaseAuth() {
  if (cachedAuth) return cachedAuth;
  cachedAuth = getAuth(getFirebaseApp());
  return cachedAuth;
}

export function getFirestoreDb() {
  if (cachedDb) return cachedDb;
  cachedDb = getFirestore(getFirebaseApp());
  return cachedDb;
}

export function getFirebaseStorage() {
  if (cachedStorage) return cachedStorage;
  cachedStorage = getStorage(getFirebaseApp());
  return cachedStorage;
}
