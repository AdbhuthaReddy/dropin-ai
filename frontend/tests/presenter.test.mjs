import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function modules() {
  const cache = new Map();
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative);
    const source = fs.readFileSync(path.join(root, "src", "lib", `${relative}.ts`), "utf8");
    const code = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const mod = { exports: {} };
    new Function("require", "module", "exports", "process", code)(
      name => {
        if (name === "./auth-client") return load("auth-client");
        throw new Error(`Unexpected import ${name}`);
      },
      mod, mod.exports,
      { env: { NEXT_PUBLIC_CLOUD_MODE: "true", NEXT_PUBLIC_API_BASE_URL: "/" } },
    );
    cache.set(relative, mod.exports);
    return mod.exports;
  }
  return { auth: load("auth-client"), api: load("api") };
}

test("presenter mode is same-origin and needs no Firebase configuration", async () => {
  const { auth, api } = modules();
  assert.equal(api.API_BASE, "");
  await assert.rejects(auth.authorization(), /Unlock presenter access/);
  auth.setPresenterCode("fixture-presenter-code");
  assert.equal(await auth.authorization(), "fixture-presenter-code");
  auth.setPresenterCode(null);
  await assert.rejects(auth.authorization(), /Unlock presenter access/);
});

test("anonymous writes stop before fetch; unlocked writes carry a header and allow long workflow requests", async t => {
  const { auth, api } = modules();
  const seen = [];
  const timeout = t.mock.method(AbortSignal, "timeout", milliseconds => {
    seen.push(milliseconds);
    return new AbortController().signal;
  });
  const fetch = t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "/api/access");
    assert.equal(options.headers.get("Authorization"), "Bearer fixture-presenter-code");
    return new Response('{"authorized":true}', { status: 200 });
  });
  await assert.rejects(api.requestJson("/api/access", { method: "POST", body: "{}" }), /Unlock/);
  assert.equal(fetch.mock.callCount(), 0);
  auth.setPresenterCode("fixture-presenter-code");
  assert.deepEqual(await api.requestJson("/api/access", { method: "POST", body: "{}" }), { authorized: true });
  assert.equal(timeout.mock.callCount(), 1);
  assert.deepEqual(seen, [420000]);
});

test("public reads send no presenter credential and retain a short timeout", async t => {
  const { auth, api } = modules();
  auth.setPresenterCode("fixture-presenter-code");
  t.mock.method(AbortSignal, "timeout", milliseconds => {
    assert.equal(milliseconds, 60000);
    return new AbortController().signal;
  });
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    assert.equal(options.headers.has("Authorization"), false);
    return new Response('{"revision":0}', { status: 200 });
  });
  await api.requestJson("/api/inventory");
});
