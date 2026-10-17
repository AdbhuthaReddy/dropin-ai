import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadStore() {
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    const mod = { exports: {} };
    const localRequire = createRequire(filename);
    new Function("require", "module", "exports", "process", code)(
      name => {
        const resolved = name.startsWith(".") ? path.resolve(path.dirname(filename), name) : name;
        return typeof resolved === "string" && fs.existsSync(resolved + ".ts") ? load(resolved + ".ts") : localRequire(name);
      }, mod, mod.exports, { env: { NEXT_PUBLIC_API_BASE_URL: "http://test.invalid" } },
    );
    cache.set(filename, mod.exports);
    return mod.exports;
  }
  return load(path.resolve(__dirname, "..", "src", "store", "useInventoryStore.ts"));
}

function snapshot(module, revision = 0) {
  return { revision, items: module.INITIAL_BOM.map(item => ({ ...item, revision })) };
}
function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function result(mpn) {
  return {
    original_mpn: mpn, candidate_mpn: "TEST-ALT", workflow_route: "ALTERNATIVE_ENGINEERED",
    action_buy_url: "", aml_authorization: false, confidence_score: 0.2,
    procurement_status: "HOLD_FOR_ENGINEERING_REVIEW", purchase_order_id: null,
    search_reasoning: "Fixture", message: "Human review required", engineering_flags: [],
    critical_differences: [], distributor_quote: { distributor: "Not verified", stock_available: 10000, unit_price_usd: 1, lead_time_days: 2 },
    provenance: { model: "fixture", grounding_status: "no_search_evidence", elapsed_ms: 100, stock_verified: false, datasheets_verified: false, sources: [] },
    timestamp: "2026-10-17T00:00:00Z",
  };
}

test("server snapshot is validated and loaded", async t => {
  const mod = loadStore();
  t.mock.method(globalThis, "fetch", async () => response(snapshot(mod)));
  await mod.useInventoryStore.getState().refresh();
  assert.equal(mod.useInventoryStore.getState().loaded, true);
  assert.equal(mod.useInventoryStore.getState().items.length, 10);
});

test("cloud workflow metadata is retained and invalid job IDs are rejected", () => {
  const mod = loadStore();
  const value = snapshot(mod);
  value.items[0].workflow = { job_id: "a".repeat(32), stage: "datasheet_comparison" };
  assert.equal(mod.parseSnapshot(value).items[0].workflow.stage, "datasheet_comparison");
  value.items[0].workflow.job_id = "../../private";
  assert.throws(() => mod.parseSnapshot(value), /workflow/);
});

test("nonfinite, negative, fractional or oversized stock is rejected explicitly", async t => {
  const mod = loadStore();
  const fetch = t.mock.method(globalThis, "fetch", async () => response(snapshot(mod)));
  await mod.useInventoryStore.getState().refresh();
  for (const value of [NaN, Infinity, -1, 1.1, 1_000_000_001]) {
    await mod.useInventoryStore.getState().updateStock("pmic", value);
    assert.match(mod.useInventoryStore.getState().actionError, /whole number/);
  }
  assert.equal(fetch.mock.callCount(), 1);
});

test("slow snapshots cannot roll back newer state", async t => {
  const mod = loadStore();
  let next = snapshot(mod, 2);
  next.items.find(item => item.id === "pmic").stock = 0;
  t.mock.method(globalThis, "fetch", async () => response(next));
  await mod.useInventoryStore.getState().refresh();
  next = snapshot(mod, 1);
  await mod.useInventoryStore.getState().refresh();
  assert.equal(mod.useInventoryStore.getState().items.find(item => item.id === "pmic").stock, 0);
});

test("held research records evidence without adding stock or changing vendor", async t => {
  const mod = loadStore();
  let next = snapshot(mod);
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (options.method === "POST") {
      const body = JSON.parse(options.body);
      assert.equal(body.search_mode, "alternative");
      assert.equal(body.expected_revision, 0);
      assert.match(body.request_id, /^[a-f0-9-]{36}$/);
      next = snapshot(mod, 2);
      const item = next.items.find(item => item.id === "pmic");
      item.aiVerdict = result(item.mpn);
    }
    return response(next);
  });
  await mod.useInventoryStore.getState().refresh();
  const before = mod.useInventoryStore.getState().items.find(item => item.id === "pmic");
  await mod.useInventoryStore.getState().research("pmic", "alternative");
  const after = mod.useInventoryStore.getState().items.find(item => item.id === "pmic");
  assert.equal(after.stock, before.stock);
  assert.equal(after.vendor, before.vendor);
  assert.equal(after.aiVerdict.procurement_status, "HOLD_FOR_ENGINEERING_REVIEW");
});

test("server conflict is surfaced and current state refreshed", async t => {
  const mod = loadStore();
  const current = snapshot(mod, 2);
  current.items.find(item => item.id === "pmic").stock = 0;
  t.mock.method(globalThis, "fetch", async (url, options) =>
    options.method === "POST" ? response({ detail: "Inventory changed; review and retry." }, 409) : response(current));
  await mod.useInventoryStore.getState().refresh();
  await mod.useInventoryStore.getState().updateStock("pmic", 8000);
  assert.match(mod.useInventoryStore.getState().actionError, /Inventory changed/);
  assert.equal(mod.useInventoryStore.getState().items.find(item => item.id === "pmic").stock, 0);
});

test("invalid/mismatched result is not accepted", () => {
  const mod = loadStore();
  const data = snapshot(mod);
  data.items[0].aiVerdict = result("WRONG");
  assert.throws(() => mod.parseSnapshot(data), /mismatched/);
  data.items[0].aiVerdict = null;
  data.items[0].stock = NaN;
  assert.throws(() => mod.parseSnapshot(data), /invalid state/);
});

test("upstream failure does not resolve item and clears local busy state", async t => {
  const mod = loadStore();
  t.mock.method(globalThis, "fetch", async (url, options) => options.method === "POST"
    ? response({ detail: "Provider unavailable. Reference: fixture" }, 503) : response(snapshot(mod)));
  await mod.useInventoryStore.getState().refresh();
  await mod.useInventoryStore.getState().research("pmic", "exact");
  const state = mod.useInventoryStore.getState();
  assert.match(state.actionError, /Provider unavailable/);
  assert.equal(state.submittingIds.length, 0);
  assert.equal(state.items.find(item => item.id === "pmic").aiVerdict, null);
});

test("selection does not write shared inventory or start hidden research", t => {
  const mod = loadStore();
  const fetch = t.mock.method(globalThis, "fetch", async () => response(snapshot(mod)));
  mod.useInventoryStore.getState().setSelectedPartId("pmic");
  assert.equal(fetch.mock.callCount(), 0);
});

test("late research snapshot cannot undo a reset", async t => {
  const mod = loadStore();
  let release;
  t.mock.method(globalThis, "fetch", async url => {
    if (url.endsWith("/research")) return await new Promise(resolve => { release = resolve; });
    if (url.endsWith("/reset")) return response(snapshot(mod, 3));
    return response(snapshot(mod));
  });
  await mod.useInventoryStore.getState().refresh();
  const pending = mod.useInventoryStore.getState().research("pmic", "exact");
  await mod.useInventoryStore.getState().resetAll();
  const late = snapshot(mod, 2);
  const item = late.items.find(item => item.id === "pmic");
  item.aiVerdict = result(item.mpn);
  release(response(late));
  await pending;
  assert.equal(mod.useInventoryStore.getState().revision, 3);
  assert.equal(mod.useInventoryStore.getState().items.find(item => item.id === "pmic").aiVerdict, null);
});

test("research cannot race an unfinished stock edit", async t => {
  const mod = loadStore();
  let release;
  const fetch = t.mock.method(globalThis, "fetch", async url => {
    if (url.endsWith("/stock")) return await new Promise(resolve => { release = resolve; });
    return response(snapshot(mod));
  });
  await mod.useInventoryStore.getState().refresh();
  const pending = mod.useInventoryStore.getState().updateStock("pmic", 0);
  assert.equal(mod.useInventoryStore.getState().writing, true);
  await mod.useInventoryStore.getState().research("pmic", "alternative");
  assert.match(mod.useInventoryStore.getState().actionError, /stock edit/);
  release(response(snapshot(mod, 1)));
  await pending;
  assert.equal(mod.useInventoryStore.getState().writing, false);
  assert.equal(fetch.mock.callCount(), 2);
});
