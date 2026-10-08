// Staff manage: the read-only preview gate in worker/index.js, against the REAL
// functions cut out of the Worker, on an in-memory SQLite. No network.
//
//   node scripts/test-staff-manage-gate.mjs
import { readFileSync } from "node:fs";
import { makeDb, build, baseStubs, workerSrc } from "./fixtures/d1-shim.mjs";

const root = new URL("../", import.meta.url);
let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) { fail++; } };

const MIG = readFileSync(new URL("migrations/2026-10-07_clients_staff_manage.sql", root), "utf8");
ok(MIG.trim() === "ALTER TABLE clients ADD COLUMN staff_manage INTEGER NOT NULL DEFAULT 0;", "migration file is exactly the one ALTER statement");

const d = makeDb([]);
d.raw.exec(MIG);
d.raw.exec("CREATE TABLE IF NOT EXISTS message_templates (template_key TEXT PRIMARY KEY, template_text TEXT)");
const ins = d.raw.prepare("INSERT INTO clients (id, name, status, archived, staff_manage) VALUES (?,?,?,?,?)");
ins.run("c-flag", "FLAGGED CO", "active", 0, 1);
ins.run("c-plain", "PLAIN CO", "active", 0, 0);

const F = build(["staffManageBlockedRest", "previewWriteGate", "previewClientId", "isAdminRole", "handleGetPortalMe"],
  ["PREVIEW_READONLY_MSG", "STAFF_MANAGE_BLOCKED_MSG"],
  Object.assign({}, baseStubs, {
    URL: globalThis.URL,
    DEFAULT_WHATSAPP_TEMPLATES: { portal_help_request: "x" },
    authenticate: async (r) => r.user
  }));

const u = (path, q) => "https://x.test" + path + "?" + q;
const rq = (path, q, user) => ({ url: u(path, q), user: user });
const env = { DB: d.DB };
const OLD_BODY = "Modo preview é somente leitura / Preview mode is read-only";

async function main() {
  // The OLD message, byte for byte, as it stood in fetch() before this change.
  ok(OLD_BODY === "Modo preview é somente leitura / Preview mode is read-only", "read-only message text is unchanged");

  // 1. flag 0: same 403 body as today
  let r = await F.previewWriteGate(rq("/api/clients/c-plain/gm/leads", "previewAs=c-plain"), env, "/api/clients/c-plain/gm/leads");
  ok(r && r.status === 403 && r.error === OLD_BODY, "staff_manage 0 + POST: 403, same body as before");

  // 2. flag 1: reaches the route
  r = await F.previewWriteGate(rq("/api/clients/c-flag/gm/leads", "previewAs=c-flag"), env, "/api/clients/c-flag/gm/leads");
  ok(r === null, "staff_manage 1 + POST on its own gm route: reaches the route");
  r = await F.previewWriteGate(rq("/api/clients/c-flag/documents", "previewAs=c-flag"), env, "/api/clients/c-flag/documents");
  ok(r === null, "staff_manage 1 + POST documents: reaches the route");

  // 3. blocked legal-act routes on a flagged client
  const blocked = ["gm/stripe/connect", "gm/stripe/reaccept", "gm/stripe/disconnect", "gm/contracts/abc-1/company-sign", "gm/change-orders/abc-1/company-sign", "login"];
  for (const b of blocked) {
    const p = "/api/clients/c-flag/" + b;
    r = await F.previewWriteGate(rq(p, "previewAs=c-flag"), env, p);
    ok(r && r.status === 403 && /Only the client/.test(r.error) && /próprio cliente/.test(r.error), "flagged client, blocked: " + b);
  }
  // blocked routes on a NON-flagged client still give the plain read-only 403
  r = await F.previewWriteGate(rq("/api/clients/c-plain/gm/stripe/connect", "previewAs=c-plain"), env, "/api/clients/c-plain/gm/stripe/connect");
  ok(r && r.error === OLD_BODY, "non-flagged client, stripe connect: plain read-only 403");

  // 4. previewAs naming no client; lookup throws
  r = await F.previewWriteGate(rq("/api/clients/ghost/gm/leads", "previewAs=ghost"), env, "/api/clients/ghost/gm/leads");
  ok(r && r.status === 403 && r.error === OLD_BODY, "previewAs names no client: rejected");
  const boom = { DB: { prepare: () => { throw new Error("db down"); } } };
  r = await F.previewWriteGate(rq("/api/clients/c-flag/gm/leads", "previewAs=c-flag"), boom, "/api/clients/c-flag/gm/leads");
  ok(r && r.status === 403 && r.error === OLD_BODY, "lookup throws (prepare): rejected");
  const boom2 = { DB: { prepare: () => ({ bind: () => ({ first: async () => { throw new Error("db down"); } }) }) } };
  r = await F.previewWriteGate(rq("/api/clients/c-flag/gm/leads", "previewAs=c-flag"), boom2, "/api/clients/c-flag/gm/leads");
  ok(r && r.status === 403 && r.error === OLD_BODY, "lookup throws (first): rejected");

  // 5. previewSeller present, even on a flagged client
  r = await F.previewWriteGate(rq("/api/clients/c-flag/gm/leads", "previewAs=c-flag&previewSeller=Ana"), env, "/api/clients/c-flag/gm/leads");
  ok(r && r.status === 403 && r.error === OLD_BODY, "previewSeller present on flagged client: rejected");

  // 6. flagged previewAs cannot write to ANOTHER client or to a non-client route
  r = await F.previewWriteGate(rq("/api/clients/c-plain/gm/leads", "previewAs=c-flag"), env, "/api/clients/c-plain/gm/leads");
  ok(r && r.error === OLD_BODY, "previewAs=flagged but path names another client: rejected");
  r = await F.previewWriteGate(rq("/api/tasks", "previewAs=c-flag"), env, "/api/tasks");
  ok(r && r.error === OLD_BODY, "previewAs=flagged but path is not a client route: rejected");
  r = await F.previewWriteGate(rq("/api/auth/client-change-password", "previewAs=c-flag"), env, "/api/auth/client-change-password");
  ok(r && r.error === OLD_BODY, "client-change-password with previewAs: rejected");

  // 7. real client session unaffected: no previewAs => previewClientId null; portal/me has staff_manage false
  const client = { role: "client", client_id: "c-flag", username: "x", auth_method: "password" };
  ok(F.previewClientId(client, { url: "https://x.test/api/portal/me" }) === null, "real client, no previewAs: previewClientId is null");
  ok(F.previewClientId(client, { url: "https://x.test/api/portal/me?previewAs=c-plain" }) === null, "real client with a stray previewAs: ignored");
  let me = await F.handleGetPortalMe({ url: "https://x.test/api/portal/me", user: client }, env);
  ok(me.status === 200 && me.data.staff_manage === false && me.data.client_id === "c-flag", "real client on a flagged client: portal/me staff_manage is false");
  const alice = { role: "alice", display_name: "A" };
  me = await F.handleGetPortalMe({ url: "https://x.test/api/portal/me?previewAs=c-flag", user: alice }, env);
  ok(me.status === 200 && me.data.staff_manage === true, "admin previewing flagged client: portal/me staff_manage true");
  me = await F.handleGetPortalMe({ url: "https://x.test/api/portal/me?previewAs=c-plain", user: alice }, env);
  ok(me.status === 200 && me.data.staff_manage === false, "admin previewing plain client: portal/me staff_manage false");

  // 8. fetch() wiring: gate only runs for a non-GET with previewAs from an admin role
  const m = /if \(method !== "GET" && url\.searchParams\.get\("previewAs"\)\) \{[\s\S]*?\n        \}\n/.exec(workerSrc);
  ok(!!m && /isAdminRole\(previewUser\)/.test(m[0]) && /previewWriteGate\(request, env, path\)/.test(m[0]), "fetch(): gate still sits behind non-GET + previewAs + admin role");
  ok(!!m && /previewUser = null/.test(m[0]), "fetch(): failed authenticate still leaves previewUser null (unchanged path)");

  // roles: all three admin roles
  ok(["alice", "rafa", "developer"].every((x) => F.isAdminRole({ role: x })) && !F.isAdminRole({ role: "client" }), "alice, rafa, developer are admin roles; client is not");

  console.log(fail ? "\n" + fail + " FAILED" : "\nALL PASSED");
  process.exit(fail ? 1 : 0);
}
main();
