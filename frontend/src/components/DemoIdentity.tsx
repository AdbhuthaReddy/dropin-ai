"use client";

import { useState } from "react";
import { cloudEnabled, setPresenterCode } from "@/lib/auth-client";
import { requestJson } from "@/lib/api";

function PresenterAccess() {
  const [code, setCode] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <section aria-label="Presenter access" className="flex flex-wrap items-center justify-between gap-2 border-b bg-blue-50 p-3 text-sm text-neutral-900">
    <p>Public viewing. Presenter passcode required for changes and AI research. Shared daily limits apply.
      Research reports are public; keep private documents out of public research.</p>
    {unlocked ? <button className="rounded border bg-white px-3 py-2" onClick={() => {
      setPresenterCode(null); setUnlocked(false);
    }}>Lock presenter access</button> : <form className="flex flex-wrap gap-2" onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError(null); setPresenterCode(code);
      try {
        await requestJson("/api/access", { method: "POST", body: "{}" });
        setUnlocked(true); setCode("");
      } catch (failure) {
        setPresenterCode(null);
        setError(failure instanceof Error ? failure.message : "Could not unlock presenter access.");
      } finally { setBusy(false); }
    }}>
      <label className="flex items-center gap-2">Presenter passcode
        <input type="password" autoComplete="off" required disabled={busy} value={code}
          onChange={event => setCode(event.target.value)} className="w-48 rounded border bg-white p-2" />
      </label>
      <button disabled={busy} className="rounded border bg-white px-3 py-2 disabled:opacity-50">{busy ? "Checking..." : "Unlock"}</button>
    </form>}
    {error && <p role="alert" className="text-red-800">{error}</p>}
  </section>;
}

export default function DemoIdentity() {
  return cloudEnabled ? <PresenterAccess /> : null;
}
