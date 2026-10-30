// clients.html apiFetch must forward its options (method, body, headers).
// It used to take only the path, so toggleArchive's PUT went out as a GET and
// answered 404. Loads the page's real apiFetch text and runs it against a
// recording fetch. No network, no browser, writes nothing.
//
//   node scripts/test-apifetch-options.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) { fail++; } };

for (const file of ["clients.html", "ios/App/App/public/clients.html"]) {
  const src = readFileSync(new URL("../" + file, import.meta.url), "utf8");
  const i = src.indexOf("function apiFetch(path, opts) {");
  ok(i >= 0, file + ": apiFetch takes (path, opts)");
  if (i < 0) { continue; }
  const j = src.indexOf("\n    }\n", i) + 7;
  const text = src.slice(i, j);

  const calls = [];
  const ctx = {
    WORKER_URL: "https://w.test",
    getToken: () => Promise.resolve("tok123"),
    window: { apexSidePath: (p, o) => (o && o.method && o.method !== "GET") ? p : p + "#side" },
    fetch: (url, init) => { calls.push({ url, init }); return Promise.resolve({ ok: true }); },
    Object
  };
  vm.createContext(ctx);
  vm.runInContext(text, ctx);

  await vm.runInContext('apiFetch("/api/clients/c1/archive", { method: "PUT", body: JSON.stringify({ archived: true }) })', ctx);
  let c = calls[0];
  ok(c.init.method === "PUT", file + ": PUT is sent as PUT");
  ok(c.init.body === '{"archived":true}', file + ": the body is sent");
  ok(c.init.headers.Authorization === "Bearer tok123", file + ": Authorization header kept");
  ok(c.init.headers["Content-Type"] === "application/json", file + ": JSON Content-Type added for a string body");
  ok(c.url === "https://w.test/api/clients/c1/archive", file + ": a write path is not given a side");

  await vm.runInContext('apiFetch("/api/clients")', ctx);
  c = calls[1];
  ok(c.init.method === undefined, file + ": one argument sends a plain GET (no method set)");
  ok(c.init.body === undefined, file + ": one argument sends no body");
  ok(c.init.headers.Authorization === "Bearer tok123", file + ": GET keeps Authorization");
  ok(c.init.headers["Content-Type"] === undefined, file + ": GET adds no Content-Type");
  ok(c.url === "https://w.test/api/clients#side", file + ": GET still goes through apexSidePath");

  await vm.runInContext('apiFetch("/x", { method: "POST", body: "a", headers: { "content-type": "text/plain", "Authorization": "Bearer evil" } })', ctx);
  c = calls[2];
  ok(c.init.headers["content-type"] === "text/plain" && c.init.headers["Content-Type"] === undefined, file + ": a caller Content-Type is respected");
  ok(c.init.headers.Authorization === "Bearer tok123", file + ": Authorization cannot be overridden");
}

console.log(fail ? "\n" + fail + " FAILED" : "\nAll passed");
process.exit(fail ? 1 : 0);
