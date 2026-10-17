import { create } from "zustand";
import bom from "../../../shared/bom.json";
import { requestJson } from "../lib/api";

export interface ResearchResult {
  original_mpn: string;
  candidate_mpn: string;
  workflow_route: string;
  action_buy_url: string;
  aml_authorization: boolean;
  confidence_score: number;
  procurement_status: string;
  purchase_order_id: null;
  search_reasoning: string;
  message: string;
  engineering_flags: string[];
  critical_differences: string[];
  distributor_quote: {
    distributor: string;
    stock_available: number;
    unit_price_usd: number;
    lead_time_days: number;
  };
  provenance: {
    model: string;
    grounding_status: string;
    elapsed_ms: number;
    stock_verified: boolean;
    datasheets_verified: boolean;
    sources: { title: string; url: string }[];
  };
  timestamp: string;
}

export type SearchMode = "exact" | "alternative";
export interface InventoryItem {
  id: string;
  mpn: string;
  materialNumber: string;
  name: string;
  description: string;
  vendor: string;
  storageLocation: string;
  stock: number;
  safetyStock: number;
  leadTime: string;
  normalMaterial: string;
  meshType: string;
  layerIndex: number;
  revision: number;
  isProcessing: boolean;
  researchMode: SearchMode | null;
  aiVerdict: ResearchResult | null;
  researchError: string | null;
  workflow?: { job_id: string; stage: string } | null;
}

export interface InventorySnapshot { revision: number; items: InventoryItem[] }
export const INITIAL_BOM: InventoryItem[] = bom.map(item => ({
  ...item, revision: 0, isProcessing: false, researchMode: null, aiVerdict: null, researchError: null,
}));
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const nonnegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const integer = (value: unknown): value is number => nonnegative(value) && Number.isSafeInteger(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(v => typeof v === "string");

function parseWorkflow(value: unknown): InventoryItem["workflow"] {
  if (value == null) return null;
  if (!record(value) || typeof value.job_id !== "string" || !/^[0-9a-f]{32}$/.test(value.job_id)
    || typeof value.stage !== "string") throw new Error("Backend returned invalid workflow state.");
  return { job_id: value.job_id, stage: value.stage };
}

export function isResearchResult(value: unknown): value is ResearchResult {
  if (!record(value) || !record(value.distributor_quote) || !record(value.provenance)) return false;
  const quote = value.distributor_quote;
  const provenance = value.provenance;
  return ["original_mpn", "candidate_mpn", "workflow_route", "action_buy_url", "procurement_status",
    "search_reasoning", "message", "timestamp"].every(key => typeof value[key] === "string")
    && typeof value.aml_authorization === "boolean"
    && value.purchase_order_id === null
    && nonnegative(value.confidence_score) && value.confidence_score <= 1
    && strings(value.engineering_flags) && strings(value.critical_differences)
    && typeof quote.distributor === "string" && integer(quote.stock_available)
    && nonnegative(quote.unit_price_usd) && integer(quote.lead_time_days)
    && typeof provenance.model === "string" && typeof provenance.grounding_status === "string"
    && integer(provenance.elapsed_ms)
    && typeof provenance.stock_verified === "boolean" && typeof provenance.datasheets_verified === "boolean"
    && Array.isArray(provenance.sources) && provenance.sources.every(source =>
      record(source) && typeof source.title === "string" && typeof source.url === "string");
}

export function parseSnapshot(value: unknown): InventorySnapshot {
  if (!record(value) || !integer(value.revision) || !Array.isArray(value.items) || value.items.length !== bom.length) {
    throw new Error("Backend returned an invalid inventory snapshot.");
  }
  const entries: unknown[] = value.items;
  const items: InventoryItem[] = INITIAL_BOM.map(base => {
    const entry: unknown = entries.find((item: unknown) => record(item) && item.id === base.id);
    if (!record(entry) || !integer(entry.stock) || entry.stock > 1_000_000_000 || !integer(entry.revision)
      || typeof entry.isProcessing !== "boolean"
      || !(entry.researchMode === null || entry.researchMode === "exact" || entry.researchMode === "alternative")
      || !(entry.aiVerdict === null || isResearchResult(entry.aiVerdict))
      || !(entry.researchError === null || typeof entry.researchError === "string")) {
      throw new Error(`Backend returned invalid state for ${base.mpn}.`);
    }
    const workflow = parseWorkflow(entry.workflow);
    if (entry.aiVerdict && entry.aiVerdict.original_mpn !== base.mpn) {
      throw new Error(`Backend returned a mismatched research result for ${base.mpn}.`);
    }
    const mode: SearchMode | null = entry.researchMode === "exact" || entry.researchMode === "alternative" ? entry.researchMode : null;
    return {
      ...base, stock: entry.stock, revision: entry.revision, isProcessing: entry.isProcessing,
      researchMode: mode, aiVerdict: entry.aiVerdict, researchError: entry.researchError,
      workflow,
    };
  });
  return { revision: value.revision, items };
}

export interface InventoryStoreState {
  items: InventoryItem[];
  revision: number;
  loaded: boolean;
  selectedPartId: string | null;
  syncError: string | null;
  actionError: string | null;
  submittingIds: string[];
  writing: boolean;
  refresh: () => Promise<void>;
  updateStock: (id: string, stock: number) => Promise<void>;
  simulateShortage: (id: string) => Promise<void>;
  resetAll: () => Promise<void>;
  research: (id: string, mode: SearchMode) => Promise<void>;
  setSelectedPartId: (id: string | null) => void;
  clearError: () => void;
}

const message = (error: unknown) => error instanceof Error ? error.message : "Unexpected inventory request failure.";

export const useInventoryStore = create<InventoryStoreState>()((set, get) => {
  function apply(snapshot: InventorySnapshot) {
    // A slow poll must not replace a newer mutation response.
    if (snapshot.revision >= get().revision) set({ ...snapshot, loaded: true, syncError: null });
  }
  async function mutate(path: string, body: object) {
    set({ actionError: null });
    try {
      if (!get().loaded) throw new Error("Wait for shared inventory to load before editing.");
      apply(parseSnapshot(await requestJson(path, { method: "POST", body: JSON.stringify(body) })));
    } catch (error) {
      set({ actionError: message(error) });
      await get().refresh();
    }
  }
  return {
    items: INITIAL_BOM.map(item => ({ ...item })), revision: -1, loaded: false,
    selectedPartId: null, syncError: null, actionError: null, submittingIds: [], writing: false,
    clearError: () => set({ actionError: null }),
    setSelectedPartId: id => set({ selectedPartId: id }),
    refresh: async () => {
      try {
        apply(parseSnapshot(await requestJson("/api/inventory")));
      } catch (error) {
        set({ syncError: message(error) });
      }
    },
    updateStock: async (id, stock) => {
      if (get().writing) { set({ actionError: "Wait for the current stock edit to finish." }); return; }
      const item = get().items.find(item => item.id === id);
      if (!item || !integer(stock) || stock > 1_000_000_000) {
        set({ actionError: "Stock must be a whole number between 0 and 1,000,000,000." });
        return;
      }
      set({ writing: true });
      try {
        await mutate(`/api/inventory/${encodeURIComponent(id)}/stock`, { stock, expected_revision: item.revision });
      } finally { set({ writing: false }); }
    },
    simulateShortage: async id => {
      const item = get().items.find(item => item.id === id);
      if (!item) { set({ actionError: "Unknown BOM component." }); return; }
      set({ selectedPartId: id });
      await get().updateStock(id, Math.floor(item.safetyStock * 0.4));
    },
    resetAll: async () => {
      if (get().writing) { set({ actionError: "Wait for the current stock edit to finish." }); return; }
      set({ writing: true });
      try {
        await mutate("/api/inventory/reset", { expected_revision: get().revision });
        set({ selectedPartId: null });
      } finally { set({ writing: false }); }
    },
    research: async (id, mode) => {
      if (get().writing) { set({ actionError: "Wait for the current stock edit to finish." }); return; }
      const item = get().items.find(item => item.id === id);
      if (!item || item.isProcessing || get().submittingIds.includes(id)) {
        set({ actionError: "Research is already running or the component is unknown." });
        return;
      }
      set(state => ({ submittingIds: [...state.submittingIds, id] }));
      try {
        await mutate(`/api/inventory/${encodeURIComponent(id)}/research`, {
          search_mode: mode, expected_revision: item.revision, request_id: crypto.randomUUID(),
        });
      } finally {
        set(state => ({ submittingIds: state.submittingIds.filter(key => key !== id) }));
      }
    },
  };
});
