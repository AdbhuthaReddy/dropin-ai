"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { cloudEnabled, demoAuth, login, logout } from "@/lib/auth-client";

export default function DemoIdentity() {
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    try {
      const auth = demoAuth();
      if (auth) return onAuthStateChanged(auth, user => setEmail(user?.email ?? null));
    } catch (failure) {
      queueMicrotask(() => setError(failure instanceof Error ? failure.message : "Sign-in configuration failed."));
    }
  }, []);
  if (!cloudEnabled) return null;
  return <section aria-label="Demo access" className="flex flex-wrap items-center justify-between gap-2 border-b bg-blue-50 p-3 text-sm text-neutral-900">
    <p>{email ? `Signed in: ${email}` : "Public demo: viewing is open. Google sign-in is required for changes and research."}
      {" "}Shared inventory; daily per-user/global research limits apply. Public document findings are visible to everyone.</p>
    <button className="rounded border bg-white px-3 py-2 disabled:opacity-50" disabled={busy} onClick={async () => {
      setBusy(true); setError(null);
      try { if (email) await logout(); else await login(); }
      catch (failure) { setError(failure instanceof Error ? failure.message : "Sign-in failed."); }
      finally { setBusy(false); }
    }}>{email ? "Sign out" : "Sign in with Google"}</button>
    {error && <p role="alert" className="text-red-800">{error}</p>}
  </section>;
}
