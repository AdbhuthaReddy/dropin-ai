"use client";

import { useState } from "react";
import Link from "next/link";
import { requestJson } from "@/lib/api";

export default function DatasheetsPage() {
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <main className="mx-auto w-full max-w-4xl space-y-5 p-4 pb-20 sm:p-8">
      <nav className="flex gap-4 text-blue-800 underline"><Link href="/">3D dashboard</Link><Link href="/erp-simulator">ERP simulator</Link></nav>
      <h1 className="text-2xl font-bold">Compare actual PDF datasheets</h1>
      <p>Choose documents you have permission to process. PDFs are extracted locally and not saved by this app.
        Scanned/image-only, encrypted, malformed, oversized, or unreadable documents are rejected.
        Maximum per PDF: 10 MiB, 120 pages, 160,000 extracted characters.</p>
      <p className="rounded border border-amber-300 bg-amber-50 p-3">
        This is evidence-assisted review, not drop-in certification. Pinout, register maps, power-up defaults,
        circuit rails, thermal limits, and mechanical fit require hardware-engineer sign-off.
        Stock research and PDF comparison do not authorize procurement.
      </p>
      <form className="space-y-4 rounded border p-4" onSubmit={async event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        form.set("consent", String(consent));
        setBusy(true); setResult(null); setError(null);
        try {
          setResult(await requestJson("/api/datasheets/compare", { method: "POST", body: form }));
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : "PDF comparison failed.");
        } finally { setBusy(false); }
      }}>
        <label className="block font-semibold">Original datasheet PDF
          <input className="mt-1 block max-w-full font-normal" type="file" accept=".pdf,application/pdf" name="original" required disabled={busy} />
        </label>
        <label className="block font-semibold">Candidate datasheet PDF
          <input className="mt-1 block max-w-full font-normal" type="file" accept=".pdf,application/pdf" name="candidate" required disabled={busy} />
        </label>
        <label className="block font-semibold">Board requirements and constraints
          <textarea className="mt-1 block w-full rounded border p-2 font-normal" name="requirements" maxLength={8000} rows={4}
            placeholder="Required rail voltages, current, package, pinout, interface, firmware constraints, temperature range..." disabled={busy} />
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={busy} />
          <span>I explicitly consent to sending the extracted text of these two documents and my requirements to Google Gemini for this comparison.
            Leave unchecked for local extraction only (no provider request).</span>
        </label>
        <button disabled={busy} className="rounded bg-blue-800 px-4 py-2 text-white disabled:opacity-50">
          {busy ? "Processing documents..." : consent ? "Compare with Gemini (review required)" : "Extract locally only"}
        </button>
      </form>
      {busy && <p role="status">Processing actual documents. No inventory will change.</p>}
      {error && <p role="alert" className="rounded border border-red-400 p-3 text-red-800">{error}</p>}
      {result !== null && <section aria-label="PDF evidence report" className="space-y-3">
        <h2 className="text-xl font-bold">Evidence report - not engineering approval</h2>
        <p>Document SHA-256 hashes identify the files used. Citations use 1-based PDF pages and whitespace-normalized exact excerpts.
          Verified excerpts do not prove the model&apos;s interpretation is correct.</p>
        <button className="rounded border p-2" onClick={() => {
          const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }));
          const link = document.createElement("a"); link.href = url; link.download = "datasheet-evidence.json"; link.click();
          URL.revokeObjectURL(url);
        }}>Download evidence JSON</button>
        <pre className="max-h-[700px] overflow-auto whitespace-pre-wrap break-words rounded bg-neutral-100 p-4 text-xs">{JSON.stringify(result, null, 2)}</pre>
      </section>}
    </main>
  );
}
