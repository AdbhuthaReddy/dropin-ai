import { getApps, initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";

export const cloudEnabled = process.env.NEXT_PUBLIC_CLOUD_MODE === "true";

export function demoAuth() {
  if (!cloudEnabled) return null;
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  if (!apiKey || !projectId || !authDomain) throw new Error("Firebase browser configuration is incomplete.");
  const app = getApps()[0] || initializeApp({ apiKey, projectId, authDomain });
  return getAuth(app);
}

export async function authorization(): Promise<string | null> {
  const auth = demoAuth();
  if (!auth) return null;
  await auth.authStateReady();
  if (!auth.currentUser) throw new Error("Sign in with Google to edit inventory or run research.");
  return auth.currentUser.getIdToken();
}

export async function login() {
  const auth = demoAuth();
  if (!auth) throw new Error("Cloud sign-in is not enabled.");
  await signInWithPopup(auth, new GoogleAuthProvider());
}

export async function logout() {
  const auth = demoAuth();
  if (auth) await signOut(auth);
}
