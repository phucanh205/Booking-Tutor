import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";

import { getFirebaseAuth, getFirestoreDb } from "@/lib/firebase";

export function listenToAuthChanges(onChange: (user: User | null) => void) {
  return onAuthStateChanged(getFirebaseAuth(), onChange);
}

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  const cred = await signInWithPopup(getFirebaseAuth(), provider);

  const user = cred.user;

  const tutorRef = doc(getFirestoreDb(), "tutors", user.uid);
  const existing = await getDoc(tutorRef);

  await setDoc(
    tutorRef,
    {
      tutorId: user.uid,
      email: user.email ?? null,
      displayName: user.displayName ?? null,
      photoURL: user.photoURL ?? null,
      updatedAt: serverTimestamp(),
      ...(existing.exists() ? {} : { createdAt: serverTimestamp() }),
    },
    { merge: true }
  );

  return user;
}

export async function signOutUser() {
  await signOut(getFirebaseAuth());
}
