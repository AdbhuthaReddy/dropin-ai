"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertOctagon, Building2, CheckCircle2, ChevronRight, Cpu, Download,
  ExternalLink, FileSearch, Info, Layers, Printer, RotateCw, Search,
} from "lucide-react";
import ResearchCard from "@/components/ResearchCard";
import { type InventoryItem, useInventoryStore } from "@/store/useInventoryStore";

function StockEditor({ item, disabled }: { item: InventoryItem; disabled: boolean }) {
  const updateStock = useInventoryStore(state => state.updateStock);
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <form className="flex items-center justify-end gap-1" onSubmit={event => {
      event.preventDefault();
      if (draft === null || draft.trim() === "") return;
      void updateStock(item.id, Number(draft));
      setDraft(null);
    }}>
      <input aria-label={`Stock for ${item.mpn}`} type="number" min="0" max="1000000000" step="1" required
        disabled={disabled} className="w-24 border border-[#b8b8b8] bg-white px-1.5 py-1 text-right font-mono text-[11px] outline-none focus:border-[#0a6ed1] disabled:bg-[#f2f2f2]"
        value={draft ?? String(item.stock)} onChange={event => setDraft(event.target.value)} />
      <button disabled={disabled || draft === null} className="border border-[#b8b8b8] bg-white px-2 py-1 text-[10px] text-[#0854a0] hover:bg-[#eaf3fc] disabled:opacity-40">Save</button>
    </form>
  );
}

export default function ERPSimulatorPage() {
  const { items, selectedPartId, setSelectedPartId, simulateShortage, resetAll, updateStock, loaded, syncError, writing } = useInventoryStore();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("ALL");
  const active = items.find(item => item.id === selectedPartId) || items.find(item => item.stock < item.safetyStock)
    || items.find(item => item.id === "pmic") || items[0];
  const critical = items.filter(item => item.stock < item.safetyStock);
  const disabled = !loaded || !!syncError || writing;
  const lineDown = items.filter(item => item.stock === 0).length;
  const researching = items.filter(item => item.isProcessing).length;
  const recorded = items.filter(item => item.aiVerdict || item.workflow?.stage === "completed").length;
  const filtered = items.filter(item =>
    (filter !== "EXCEPTIONS" || item.stock < item.safetyStock)
    && (filter !== "LINE_DOWN" || item.stock === 0)
    && (filter !== "NORMAL" || item.stock >= item.safetyStock)
    && `${item.mpn} ${item.name} ${item.vendor}`.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <main className="flex min-h-screen flex-col bg-[#f4f4f4] text-[#333333]" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
      <header className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-b border-[#0854a0] bg-[#0a6ed1] px-4 py-2 text-white shadow-sm">
        <div className="flex items-center gap-3">
          <span className="border border-[#1b7cdb] bg-[#0854a0] px-2 py-0.5 text-[11px] font-bold tracking-wider">SAP</span>
          <span className="h-4 w-px bg-white/25" />
          <h1 className="text-[13px] font-semibold">
            SAP S/4HANA <span className="mx-2 text-white/50">|</span>
            <span className="font-normal">Materials Management <span className="hidden sm:inline">- Plant HYD-01</span></span>
          </h1>
        </div>
        <nav aria-label="Workspace navigation" className="flex flex-wrap items-center gap-3 text-[11px]">
          <span className="hidden border border-white/15 bg-[#0854a0] px-2.5 py-1 text-white/90 xl:block">
            Client: 100 <span className="mx-2 text-white/40">|</span> Sys: DEMO
            <span className="mx-2 text-white/40">|</span> Plant: HYD-01
          </span>
          <Link href="/datasheets" className="flex items-center gap-1.5 border border-white/40 px-2.5 py-1 hover:bg-[#0854a0]">
            <FileSearch className="size-3.5" /> PDF comparison
          </Link>
          <Link href="/" className="flex items-center gap-1.5 bg-white px-3 py-1 font-bold text-[#0a6ed1] hover:bg-[#eaf3fc]">
            <Cpu className="size-3.5" /> DropIn.ai 3D Twin
            {loaded && critical.length > 0 && <span className="rounded-full bg-[#bb0000] px-1.5 text-[10px] text-white">{critical.length}</span>}
            <ExternalLink className="size-3" />
          </Link>
        </nav>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#cccccc] bg-white px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="mb-1 flex flex-wrap items-center gap-1 text-[11px] text-[#666666]">
            <Link href="/" className="hover:text-[#0a6ed1]">Home</Link><ChevronRight className="size-3" />
            <span>Manufacturing Logistics</span><ChevronRight className="size-3" />
            <span>Plant HYD-01</span><ChevronRight className="size-3" />
            <span className="font-semibold text-[#333333]">Stock Monitor</span>
          </nav>
          <h2 className="text-[16px] font-bold text-[#222222]">Stock Overview &amp; Safety Threshold Monitor</h2>
          <p className="mt-0.5 text-[11px] text-[#666666]">Pixel Buds Pro 2 (GRVCC) / Bill of Materials / Shared demo inventory</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] [&_button]:disabled:cursor-not-allowed [&_button]:disabled:opacity-40">
          <span className="font-semibold text-[#666666]">Quick Test:</span>
          {[
            ["pmic", "Drop PMIC"], ["battery", "Drop Battery"], ["tensor-a1", "Drop Tensor A1"],
          ].map(([id, label]) => <button key={id} disabled={disabled}
            className="border border-[#ffb74d] bg-[#fff3e0] px-2 py-1 font-semibold text-[#b71c1c] hover:bg-[#ffe0b2]"
            onClick={() => void simulateShortage(id)}>{label}</button>)}
          <button disabled={disabled} className="flex items-center gap-1 border border-[#cccccc] bg-white px-2.5 py-1 hover:bg-[#f2f2f2]"
            onClick={() => void resetAll()}><RotateCw className="size-3" /> Reset All</button>
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-4 p-3 pb-24 sm:p-6">
        <div className="flex items-start gap-2 border border-[#b8d8f3] bg-[#edf5fc] px-3 py-2 text-[11px] text-[#264966]">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <p><strong>SAP-style simulation - no SAP connection.</strong> On-hand stock is shared between dashboards.
            Only explicit stock edits change inventory; research is not a receipt, purchase order or engineering approval.</p>
        </div>
        <section aria-label="Inventory overview" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: "BOM components", value: items.length, detail: "Plant HYD-01", icon: Layers, color: "text-[#0a6ed1]" },
            { label: "Below safety stock", value: critical.length, detail: `${lineDown} line-down component(s)`, icon: AlertOctagon, color: "text-[#bb0000]" },
            { label: "Stock in spec", value: items.length - critical.length, detail: "At or above safety threshold", icon: CheckCircle2, color: "text-[#107e3e]" },
            { label: "Research recorded", value: recorded, detail: `${researching} running / not engineering approval`, icon: FileSearch, color: "text-[#0a6ed1]" },
          ].map(metric => <div key={metric.label} className="border border-[#cccccc] bg-white px-4 py-3 shadow-xs">
            <div className="flex items-center justify-between gap-2 text-[11px] text-[#666666]">
              <span>{metric.label}</span><metric.icon className={`size-4 ${metric.color}`} />
            </div>
            <p className={`my-1 text-[26px] leading-tight ${metric.color}`}>{loaded && !syncError ? metric.value : "--"}</p>
            <p className="text-[10px] text-[#777777]">{metric.detail}</p>
          </div>)}
        </section>
        {loaded && critical.map(item => <section key={item.id} aria-label={`Stock exception for ${item.mpn}`}
          className="border border-l-4 border-[#d32f2f] bg-white p-4 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <span className="border border-[#ffcdd2] bg-[#ffebee] p-2"><AlertOctagon className="size-5 text-[#bb0000]" /></span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[12px] font-bold uppercase tracking-wide text-[#b71c1c]">Exceptions Log: Safety Stock Breach Detected</h3>
                  <span className="bg-[#bb0000] px-1.5 py-0.5 text-[9px] font-bold text-white">{item.stock === 0 ? "LINE DOWN" : "STOCK EXCEPTION"}</span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed">
                  <strong>{item.mpn}</strong> ({item.name}): <strong className="text-[#bb0000]">{item.stock.toLocaleString()} EA</strong>
                  {" / "}safety stock {item.safetyStock.toLocaleString()} EA. Research does not clear this exception.
                </p>
                <p className="mt-1 text-[10px] text-[#666666]">
                  {item.isProcessing ? `Research running${item.workflow ? `: ${item.workflow.stage.replaceAll("_", " ")}` : ""}.`
                    : item.researchError ? "Last research request failed. Review details before retrying."
                    : item.aiVerdict || item.workflow?.stage === "completed" ? "Research recorded. Human engineering review required."
                    : "No research recorded for this stock condition."}
                </p>
              </div>
            </div>
            <a href="#component-research" onClick={() => setSelectedPartId(item.id)}
              className="flex items-center gap-1.5 border border-[#0854a0] bg-[#0a6ed1] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#0854a0]">
              <FileSearch className="size-3.5" /> Review research <ChevronRight className="size-3" />
            </a>
          </div>
        </section>)}
        <section aria-label="BOM materials" className="border border-[#cccccc] bg-white shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#cccccc] bg-[#f2f2f2] px-4 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[12px] font-bold">BOM Line Items:</h3>
              <div className="flex flex-wrap border border-[#cccccc] bg-white text-[11px]">
              {[
                ["ALL", `All (${items.length})`], ["EXCEPTIONS", `Below Safety (${critical.length})`],
                ["LINE_DOWN", `Line Down (${lineDown})`],
                ["NORMAL", `In Spec (${items.length - critical.length})`],
              ].map(([value, label]) => (
                <button key={value} aria-pressed={filter === value} className={`px-2.5 py-1 ${filter === value ? "bg-[#0a6ed1] font-bold text-white" : "text-[#555555] hover:bg-[#e9e9e9]"}`}
                  onClick={() => setFilter(value)}>{label}</button>
              ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="relative">
                <span className="sr-only">Filter materials</span>
                <Search className="pointer-events-none absolute left-2 top-1.5 size-3.5 text-[#888888]" />
                <input className="w-48 border border-[#b8b8b8] bg-white py-1 pr-2 pl-7 text-[11px] outline-none focus:border-[#0a6ed1]"
                  placeholder="Filter materials..." value={query} onChange={event => setQuery(event.target.value)} />
              </label>
              <div className="flex items-center gap-3 border-l border-[#cccccc] pl-3 text-[11px]">
                <button aria-label="Export inventory CSV" title="Export filtered inventory to CSV" disabled={disabled}
                  className="flex items-center gap-1 text-[#555555] hover:text-[#0a6ed1] disabled:opacity-40" onClick={() => {
                    const rows = [["MPN", "Name", "Vendor", "On-hand EA", "Safety EA"], ...filtered.map(item =>
                      [item.mpn, item.name, item.vendor, String(item.stock), String(item.safetyStock)])];
                    const csv = rows.map(row => row.map(value => `"${value.replace(/"/g, '""')}"`).join(",")).join("\r\n");
                    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
                    const link = document.createElement("a"); link.href = url; link.download = "demo-inventory.csv"; link.click();
                    URL.revokeObjectURL(url);
                  }}><Download className="size-3.5" /> Export</button>
                <button className="flex items-center gap-1 text-[#555555] hover:text-[#0a6ed1]" onClick={() => window.print()}><Printer className="size-3.5" /> Print</button>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-[11px]" style={{ fontVariantNumeric: "tabular-nums" }}>
              <caption className="sr-only">Demo BOM inventory and separate research status</caption>
              <thead><tr className="border-b border-[#cccccc] bg-[#e9e9e9] text-[10px] uppercase tracking-wide text-[#444444]">
                {["Layer", "Material Number", "Description", "Vendor", "Storage Loc", "Unrestricted Stock (Editable)", "Safety Stock", "Lead Time", "Inventory Status", "Research Status", "Actions"].map(label =>
                <th key={label} scope="col" className="whitespace-nowrap border-r border-[#cccccc] px-3 py-2.5 last:border-r-0">{label}</th>)}</tr></thead>
              <tbody>{filtered.map(item => (
                <tr key={item.id} className={`border-b border-[#dddddd] [&>td]:border-r [&>td]:border-[#e5e5e5] [&>td]:px-3 [&>td]:py-2 ${selectedPartId === item.id ? "bg-[#e5f0fa]" : item.stock < item.safetyStock ? "bg-[#fff5f5]" : "even:bg-[#fafafa] hover:bg-[#edf5fc]"}`}>
                  <td className="text-center font-mono text-[#777777]">L{String(item.layerIndex).padStart(2, "0")}</td>
                  <th scope="row" className="whitespace-nowrap border-r border-[#e5e5e5] px-3 py-2 text-left font-mono font-semibold text-[#0a6ed1]">
                    <button onClick={() => setSelectedPartId(item.id)} title={`Review ${item.mpn}`} className="text-left hover:underline">
                      {item.materialNumber}
                      {item.materialNumber !== item.mpn && <span className="block text-[10px] font-normal text-[#666666]">{item.mpn}</span>}
                    </button>
                  </th>
                  <td className="min-w-40">{item.name}</td>
                  <td className="min-w-32 text-[#555555]">{item.vendor}</td>
                  <td className="whitespace-nowrap font-mono text-[#555555]">{item.storageLocation}</td>
                  <td><StockEditor key={`${item.id}-${item.revision}`} item={item} disabled={disabled} /></td>
                  <td className="whitespace-nowrap text-right font-mono">{item.safetyStock.toLocaleString()} <span className="text-[#888888]">EA</span></td>
                  <td className="whitespace-nowrap text-[#555555]">{item.leadTime}</td>
                  <td className="whitespace-nowrap">
                    <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold ${item.stock < item.safetyStock ? "text-[#bb0000]" : "text-[#107e3e]"}`}>
                      <span className={`size-1.5 rounded-full ${item.stock < item.safetyStock ? "bg-[#bb0000]" : "bg-[#107e3e]"}`} />
                      {item.stock === 0 ? "LINE DOWN" : item.stock < item.safetyStock ? "BELOW SAFETY STOCK" : "IN SPEC"}
                    </span>
                  </td>
                  <td className="min-w-32 text-[10px] text-[#555555]">{item.isProcessing ? "RESEARCH RUNNING" : item.researchError ? "REQUEST FAILED - RETRY"
                    : item.aiVerdict || item.workflow?.stage === "completed" ? "RESEARCH RECORDED - NOT APPROVED" : "NOT REQUESTED"}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      <a href="#component-research" aria-label={`Review ${item.mpn}`} className="border border-[#b8b8b8] bg-white px-2 py-1 text-[#0a6ed1] hover:bg-[#eaf3fc]"
                        onClick={() => setSelectedPartId(item.id)}>Review</a>
                      <button disabled={disabled} className="border border-[#cccccc] bg-white px-2 py-1 text-[#bb0000] hover:bg-[#fff1f1] disabled:opacity-40"
                        title={`Set ${item.mpn} to zero stock`} onClick={() => void updateStock(item.id, 0)}>Zero</button>
                    </div>
                  </td>
                </tr>
              ))}{filtered.length === 0 && <tr><td colSpan={11} className="p-8 text-center text-[#666666]">No materials match the current filters.</td></tr>}</tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#cccccc] bg-[#f9f9f9] px-4 py-2 text-[10px] text-[#666666]">
            <p>Showing {filtered.length} of {items.length} BOM components. Research never clears a stock exception.</p>
            <span className="flex items-center gap-1"><Building2 className="size-3" /> Plant HYD-01 / Stock unit: EA</span>
          </div>
        </section>
        {active && <section id="component-research" aria-label="Component research workspace" className="scroll-mt-4 border border-[#cccccc] bg-white shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#cccccc] bg-[#f2f2f2] px-4 py-2">
            <h3 className="flex items-center gap-2 text-[12px] font-bold"><FileSearch className="size-4 text-[#0a6ed1]" /> Component Research &amp; Engineering Evidence</h3>
            <span className="text-[10px] text-[#666666]">Human review required / no ERP writeback</span>
          </div>
          <div className="[&>section]:rounded-none [&>section]:border-0 [&>section]:text-[12px] [&_button]:rounded-none">
            <ResearchCard item={active} />
          </div>
        </section>}
        <footer className="flex flex-wrap justify-between gap-2 text-[10px] text-[#777777]">
          <span>DropIn.ai / SAP-inspired Materials Management / Demo environment</span>
          <span>Inventory and research are separate records. No live SAP connection.</span>
        </footer>
      </div>
    </main>
  );
}
