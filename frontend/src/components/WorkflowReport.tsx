"use client";

import { useEffect, useState } from "react";
import { requestJson } from "@/lib/api";
import { useInventoryStore, type InventoryItem } from "@/store/useInventoryStore";

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const entries = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter(record) : [];
const text = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "Not established";

function EvidenceSummary({ report }: { report: unknown }) {
  if (!record(report) || !record(report.result)) return null;
  const result = report.result;
  return <div className="space-y-4">
    <h3 className="font-semibold">{text(result.status).replaceAll("_", " ")}</h3>
    {entries(result.exact_offers).map((offer, index) => <div key={index} className="rounded border p-2">
      <p>Exact MPN: {text(offer.mpn_quote)} / {text(offer.manufacturer_quote)}</p>
      <p>Reported availability: {text(offer.quantity)} units. Not API-verified or reserved.</p>
      <p className="break-all">Source: {text(offer.source_url)}</p>
    </div>)}
    {entries(result.alternatives).map((candidate, index) => {
      const similarity = record(candidate.similarity) ? candidate.similarity : {};
      const comparison = record(candidate.comparison) ? candidate.comparison : {};
      return <article key={index} className="space-y-2 rounded border p-3">
        <h4 className="font-bold">{text(candidate.mpn)} / {text(candidate.manufacturer)}</h4>
        <p>{text(candidate.rationale)}</p>
        <p>Evidence match: {text(similarity.evidence_match_percent)}% of {text(similarity.evaluated_parameters)} reported parameters.
          {" "}Matches: {text(similarity.match)}; differences: {text(similarity.difference)}; unknowns: {text(similarity.unknown)}.</p>
        <p>Substitution potential: {text(similarity.substitution_potential).replaceAll("_", " ")}. Engineering hold.</p>
        <h5 className="font-semibold">Software, firmware and hardware considerations</h5>
        <ul className="list-disc space-y-1 pl-5">{entries(candidate.required_changes).map((change, changeIndex) =>
          <li key={changeIndex}><strong>{text(change.area)}: {text(change.status).replaceAll("_", " ")}</strong>
            {" - "}{text(change.explanation)}</li>)}</ul>
        <h5 className="font-semibold">Parameter comparison</h5>
        <ul className="list-disc space-y-2 pl-5">{entries(comparison.comparisons).map((finding, findingIndex) => {
          const original = record(finding.original) ? finding.original : {};
          const alternative = record(finding.candidate) ? finding.candidate : {};
          return <li key={findingIndex}><strong>{text(finding.parameter)}: {text(finding.finding)}</strong>
            <p>{text(finding.explanation)}</p>
            <blockquote>Original p.{text(original.page)}: {text(original.quote)}</blockquote>
            <blockquote>Candidate p.{text(alternative.page)}: {text(alternative.quote)}</blockquote>
          </li>;
        })}</ul>
      </article>;
    })}
    {Array.isArray(result.limitations) && <ul className="list-disc pl-5">{result.limitations.map((value, index) =>
      <li key={index}>{text(value)}</li>)}</ul>}
  </div>;
}

export default function WorkflowReport({ item }: { item: InventoryItem }) {
  const [report, setReport] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useInventoryStore(state => state.refresh);
  const workflow = item.workflow;
  const jobId = workflow?.job_id;
  const stage = workflow?.stage;
  useEffect(() => {
    let active = true;
    if (jobId) {
      requestJson(`/api/jobs/${jobId}`).then(value => {
        if (active) { setReport(value); setError(null); }
      }).catch(failure => {
        if (active) setError(failure instanceof Error ? failure.message : "Report could not be loaded.");
      });
    }
    return () => { active = false; };
  }, [jobId, stage]);
  return <section aria-label="Automatic sourcing evidence" className="space-y-3 border-t pt-3">
    <p>Automatic flow: exact manufacturer/MPN with sufficient reported stock, then original datasheet,
      alternative discovery, candidate datasheets and cited comparison. Results never change on-hand stock.</p>
    <p>Public datasheet text is sent to Gemini under the operator&apos;s deployment opt-in.
      No private upload is used automatically. Software, firmware and hardware changes remain subject to engineering review.</p>
    <p>Keep this page open while research runs (up to six minutes). After an interrupted request,
      use Resume once the eight-minute worker lease expires. Inventory and saved reports survive restarts.</p>
    <button disabled={busy} className="rounded bg-blue-800 p-2 text-white disabled:opacity-50" onClick={async () => {
      setBusy(true); setError(null);
      try {
        await requestJson(`/api/inventory/${item.id}/workflow`, {
          method: "POST", body: JSON.stringify({ expected_revision: item.revision }),
        });
        await refresh();
      } catch (failure) { setError(failure instanceof Error ? failure.message : "Workflow could not be queued."); }
      finally { setBusy(false); }
    }}>{busy ? "Research request running" : item.isProcessing
        ? "Resume interrupted research"
        : "Run exact-to-alternative workflow"}</button>
    {workflow && <p role="status">Research stage: {workflow.stage.replaceAll("_", " ")}</p>}
    {error && <p role="alert" className="text-red-800">{error}</p>}
    {report !== null && <details open={workflow?.stage === "completed"}>
      <summary className="cursor-pointer font-semibold">Evidence, similarity and required changes (not approval)</summary>
      <p className="my-2">Similarity is an unweighted fraction of reported matching parameters, not a probability of safe substitution.
        Missing evidence is unknown. All candidates require engineering review.</p>
      <EvidenceSummary report={report} />
      <button className="my-2 rounded border p-2" onClick={() => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
        const link = document.createElement("a"); link.href = url; link.download = `${item.mpn}-research.json`; link.click();
        URL.revokeObjectURL(url);
      }}>Download research evidence</button>
      <details><summary>Full provenance, hashes and evidence JSON</summary>
        <pre className="max-h-[650px] overflow-auto whitespace-pre-wrap break-words rounded bg-neutral-100 p-3 text-xs">{JSON.stringify(report, null, 2)}</pre>
      </details>
    </details>}
  </section>;
}
