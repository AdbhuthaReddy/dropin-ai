"use client";

import { useInventoryStore, type InventoryItem } from "@/store/useInventoryStore";
import { cloudEnabled } from "@/lib/auth-client";
import WorkflowReport from "./WorkflowReport";

function safeHttps(value: string): boolean {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

export default function ResearchCard({ item }: { item: InventoryItem }) {
  const { research, submittingIds, loaded, syncError, writing } = useInventoryStore();
  const busy = item.isProcessing || submittingIds.includes(item.id);
  const result = item.aiVerdict;
  return (
    <section aria-label={`Research for ${item.mpn}`} className="space-y-4 rounded-xl border border-neutral-200 bg-white p-4 text-sm">
      <div>
        <h2 className="font-bold">{item.name}</h2>
        <p className="break-all font-mono text-xs">{item.mpn}</p>
        <p className={item.stock < item.safetyStock ? "text-red-700" : "text-emerald-700"}>
          {item.stock === 0 ? "Line down" : item.stock < item.safetyStock ? "Below safety stock" : "Stock in spec"}:
          {" "}{item.stock.toLocaleString()} EA / safety {item.safetyStock.toLocaleString()} EA
        </p>
      </div>
      <p className="rounded bg-amber-50 p-2 text-xs text-amber-950">
        Research does not resolve a shortage, approve a replacement, receive stock, contact an OEM, or place an order.
        SAP and live distributor integrations are not configured.
      </p>
      {cloudEnabled ? <WorkflowReport key={`${item.id}-${item.workflow?.job_id ?? "none"}`} item={item} /> : <div className="flex flex-wrap gap-2">
        <button disabled={!loaded || !!syncError || busy || writing} onClick={() => void research(item.id, "exact")}
          className="rounded border border-blue-700 px-3 py-2 text-blue-800 disabled:opacity-50">
          Research exact part
        </button>
        <button disabled={!loaded || !!syncError || busy || writing} onClick={() => void research(item.id, "alternative")}
          className="rounded bg-blue-700 px-3 py-2 text-white disabled:opacity-50">
          Research alternatives
        </button>
      </div>}
      {busy && !cloudEnabled && <p role="status">Research request running. Stage progress is not available; stock remains unchanged.</p>}
      {item.researchError && <p role="alert" className="text-red-800">{item.researchError}{" "}
        {cloudEnabled ? "Use the workflow button to retry." : "Use either research button to retry."}</p>}
      {result && (
        <div className="space-y-3 border-t pt-3">
          <p className="font-bold text-amber-900">
            {result.procurement_status === "EXACT_ORIGINAL_UNAVAILABLE" ? "Model reports exact part unavailable"
              : result.procurement_status === "OEM_CUSTOM_ESCALATION" ? "OEM review suggested (not transmitted)"
              : "Hold for engineering review"}
          </p>
          <p className="break-all"><strong>Candidate:</strong> {result.candidate_mpn}</p>
          <p className="whitespace-pre-wrap">{result.search_reasoning}</p>
          <p>{result.message}</p>
          <ul className="list-disc space-y-1 pl-5">
            {[...new Set([...result.engineering_flags, ...result.critical_differences])].map((flag, index) => <li key={index}>{flag}</li>)}
          </ul>
          <div className="rounded bg-neutral-50 p-3 text-xs">
            <p><strong>Model:</strong> {result.provenance.model}</p>
            <p><strong>Grounding:</strong> {result.provenance.grounding_status === "search_evidence_returned"
              ? "Search sources returned; claims still require verification" : "No search evidence returned - unverified research only"}</p>
            <p><strong>Model self-confidence (uncalibrated):</strong> {(result.confidence_score * 100).toFixed(1)}%</p>
            <p><strong>Provider elapsed:</strong> {(result.provenance.elapsed_ms / 1000).toFixed(2)} s</p>
            <p><strong>Stock / datasheet compatibility independently verified:</strong> No</p>
            <p><strong>Result timestamp:</strong> {result.timestamp}</p>
          </div>
          <p className="text-xs">
            Model-reported, unverified quote: {result.distributor_quote.distributor};
            {" "}{result.distributor_quote.stock_available.toLocaleString()} units;
            {" "}${result.distributor_quote.unit_price_usd.toFixed(2)};
            {" "}{result.distributor_quote.lead_time_days > 0 ? `${result.distributor_quote.lead_time_days} days` : "lead time not reported"}.
            Zero may mean not reported, not confirmed absence.
          </p>
          {safeHttps(result.action_buy_url) && (
            <a className="inline-block break-all text-blue-800 underline" href={result.action_buy_url} target="_blank" rel="noopener noreferrer">
              Open catalog search (not a verified offer)
            </a>
          )}
          <ul className="space-y-1 text-xs">
            {result.provenance.sources.filter(source => safeHttps(source.url)).map(source => (
              <li key={source.url}><a className="break-all text-blue-800 underline" href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a></li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
