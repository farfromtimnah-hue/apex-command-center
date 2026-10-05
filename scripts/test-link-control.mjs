// Customer link control: the REAL Worker functions on an in-memory SQLite.
// No network, no production database.
//
//   node scripts/test-link-control.mjs
import { makeDb, build, baseStubs, req, workerSrc } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };
const FNS = ["gmEstNewToken", "gmDateAddDays", "gmEstLinkDead", "linkControlTokenDead", "linkControlApply", "docLinkTarget", "handlePostGmDocLinkControl", "handlePostApexDocLinkControl", "apxInvByToken", "apxByToken", "gmEstByToken", "dAckByToken"];
const VARS = ["LINK_CONTROL", "EST_LINK_EXPIRY_DAYS", "DOC_LINK_PAGES"];
let TODAY = "2026-10-04";
let user = { role: "developer" };
function world() {
  const d = makeDb(["migrations/apex_invoice_public.sql", "migrations/public_link_revocation.sql"]);
  d.raw.exec("CREATE TABLE gm_estimates (id TEXT PRIMARY KEY, client_id TEXT, status TEXT, valid_until TEXT, public_token TEXT, link_disabled_at TEXT, link_enabled_at TEXT)");
  d.raw.exec("CREATE TABLE gm_job_acks (id TEXT PRIMARY KEY, client_id TEXT, status TEXT, public_token TEXT, link_disabled_at TEXT)");
  d.raw.exec("CREATE TABLE gm_invoice_payments (id TEXT PRIMARY KEY, client_id TEXT, receipt_number TEXT, receipt_token TEXT, link_disabled_at TEXT)");
  const stubs = Object.assign({}, baseStubs, {
    authenticate: async () => user, gmEasternToday: () => TODAY, gmEstAttach: async (env, e) => e,
    requireClientAccess: (u, id) => !!u && (u.role === "developer" || u.role === "alice" || u.role === "rafa" || (u.role === "client" && u.client_id === id)),
    sessionSellerName: (u) => (u && u.seller_name) || null,
    DEFAULT_ORIGIN: "https://apex.test", DOC_LINK_ORIGIN: "https://doc.test"
  });
  const F = build(FNS, VARS, stubs);
  d.raw.prepare("INSERT INTO clients (id, name) VALUES ('c1', 'ZETA POOLS'), ('c2', 'OMEGA ROOFING')").run();
  return { d, env: { DB: d.DB }, F };
}
const T = (ch) => ch.repeat(48);

// ── estimates: disable rotates, enable restores, the readable link follows
{
  const w = world();
  w.d.raw.prepare("INSERT INTO gm_estimates (id, client_id, status, valid_until, public_token) VALUES ('e1', 'c1', 'sent', '2026-10-26', ?)").run(T("a"));
  w.d.raw.prepare("INSERT INTO doc_links (slug, kind, public_token, client_id, title) VALUES ('zeta/est-1-abc', 'estimate', ?, 'c1', 'Zeta')").run(T("a"));
  ok((await w.F.gmEstByToken(w.env, T("a"))) !== null, "an enabled estimate opens by its token");
  const r = await w.F.handlePostGmDocLinkControl("c1", "estimate", "e1", "disable", req({}), w.env);
  const row = w.d.q("SELECT * FROM gm_estimates WHERE id = 'e1'")[0];
  ok(r.status === 200 && r.data.link_disabled === true && !!row.link_disabled_at, "disable-link sets link_disabled_at");
  ok(/^[a-f0-9]{48}$/.test(row.public_token) && row.public_token !== T("a"), "disable-link ROTATES the token");
  ok((await w.F.gmEstByToken(w.env, T("a"))) === null, "the old token is dead (reads as unknown)");
  ok((await w.F.gmEstByToken(w.env, row.public_token)) === null, "the new token does not open while disabled");
  ok(w.d.q("SELECT public_token FROM doc_links WHERE slug = 'zeta/est-1-abc'")[0].public_token === row.public_token, "the readable link row follows to the new token");
  ok((await w.F.linkControlTokenDead(w.env, "estimate", row.public_token)) === true, "the readable link stops resolving while disabled");
  const again = await w.F.handlePostGmDocLinkControl("c1", "estimate", "e1", "disable", req({}), w.env);
  ok(again.status === 200 && w.d.q("SELECT public_token FROM gm_estimates WHERE id = 'e1'")[0].public_token === row.public_token, "a second disable changes nothing (no second rotation)");
  const en = await w.F.handlePostGmDocLinkControl("c1", "estimate", "e1", "enable", req({}), w.env);
  ok(en.status === 200 && en.data.link_disabled === false && en.data.direct_url === "https://apex.test/estimate-view?t=" + row.public_token && en.data.link === "https://doc.test/zeta/est-1-abc", "enable-link clears it and staff are handed the NEW token and the readable link");
  ok((await w.F.gmEstByToken(w.env, row.public_token)) !== null && (await w.F.gmEstByToken(w.env, T("a"))) === null, "after enabling, the new token opens and the old one stays dead");
  ok((await w.F.linkControlTokenDead(w.env, "estimate", row.public_token)) === false, "and the readable link resolves again, to the new token");
}
// ── two racing disables rotate once
{
  const w = world();
  w.d.raw.prepare("INSERT INTO gm_estimates (id, client_id, status, valid_until, public_token) VALUES ('e1', 'c1', 'sent', '2026-10-26', ?)").run(T("a"));
  const both = await Promise.all([w.F.linkControlApply(w.env, "estimate", "e1", "c1", "disable"), w.F.linkControlApply(w.env, "estimate", "e1", "c1", "disable")]);
  const rotations = w.d.writes.filter((x) => /^UPDATE gm_estimates SET link_disabled_at/.test(x[0])).length;
  ok(both[0].direct_url === both[1].direct_url && both[0].link_disabled && rotations >= 1 && w.d.q("SELECT COUNT(*) AS n FROM gm_estimates WHERE link_disabled_at IS NOT NULL")[0].n === 1, "two racing disables end on one token (the write is guarded by the old token)");
}
// ── who may
{
  const w = world();
  w.d.raw.prepare("INSERT INTO gm_estimates (id, client_id, status, valid_until, public_token) VALUES ('e1', 'c1', 'sent', '2026-10-26', ?)").run(T("a"));
  const call = async (u, cid) => { user = u; const r = await w.F.handlePostGmDocLinkControl(cid || "c1", "estimate", "e1", "disable", req({}), w.env); user = { role: "developer" }; return r.status; };
  ok((await call(null)) === 401, "gm link control: no session is 401");
  ok((await call({ role: "client", client_id: "c2" })) === 403, "gm link control: another business's owner is 403");
  ok((await call({ role: "client", client_id: "c1", seller_name: "Sam" })) === 403, "gm link control: a salesperson is 403");
  ok(w.d.writes.length === 0, "gm link control: a refused call writes nothing");
  ok((await call({ role: "client", client_id: "c2" }, "c2")) === 404, "gm link control: a document of another business is not found through one's own business");
  ok((await call({ role: "client", client_id: "c1" })) === 200, "gm link control: the business owner is allowed");
  user = null; ok((await w.F.handlePostApexDocLinkControl("apex-invoice", "x", null, "disable", req({}), w.env)).status === 401, "Apex link control: no session is 401");
  user = { role: "client", client_id: "c1" }; ok((await w.F.handlePostApexDocLinkControl("apex-invoice", "x", null, "disable", req({}), w.env)).status === 403, "Apex link control: a client owner is 403");
  user = { role: "developer" };
}
// ── estimate expiry: 90 days after valid_until
{
  const w = world(); const dead = (e, today) => w.F.gmEstLinkDead(e, today);
  const e = { status: "sent", valid_until: "2026-06-01" };
  ok(dead(e, "2026-08-30") === false, "an estimate link works on day 90 after valid_until");
  ok(dead(e, "2026-08-31") === true, "and stops on day 91");
  ok(dead({ status: "accepted", valid_until: "2020-01-01" }, "2026-10-04") === false, "an accepted (signed) estimate never expires");
  ok(dead({ status: "sent", valid_until: null }, "2026-10-04") === false, "an estimate with no valid_until does not expire");
  ok(dead({ status: "sent", valid_until: "2026-06-01", link_enabled_at: "2026-10-01 14:00:00" }, "2026-10-04") === false, "an expired estimate that staff enabled works again");
  ok(dead({ status: "sent", valid_until: "2026-06-01", link_enabled_at: "2026-01-01 14:00:00" }, "2026-10-04") === true, "and expires again 90 days after it was enabled");
  ok(dead({ status: "sent", valid_until: "2026-12-01", link_disabled_at: "2026-10-01 00:00:00" }, "2026-10-04") === true, "a disabled link is dead whatever the dates say");
  w.d.raw.prepare("INSERT INTO gm_estimates (id, client_id, status, valid_until, public_token) VALUES ('old', 'c1', 'sent', '2026-06-01', ?)").run(T("b"));
  ok((await w.F.gmEstByToken(w.env, T("b"))) === null && (await w.F.linkControlTokenDead(w.env, "estimate", T("b"))) === true, "an expired estimate reads as unknown, by token and by readable link");
  const en = await w.F.handlePostGmDocLinkControl("c1", "estimate", "old", "enable", req({}), w.env);
  ok(en.status === 200 && en.data.link_expired === false && (await w.F.gmEstByToken(w.env, T("b"))) !== null, "enable-link restores an expired estimate (same token: it was never disabled)");
}
// ── receipts, acknowledgments, Apex invoices, Apex contracts
{
  const w = world();
  w.d.raw.prepare("INSERT INTO gm_invoice_payments (id, client_id, receipt_number, receipt_token) VALUES ('p1', 'c1', 'RCT-1', ?)").run(T("c"));
  w.d.raw.prepare("INSERT INTO gm_job_acks (id, client_id, status, public_token) VALUES ('k1', 'c1', 'sent', ?)").run(T("d"));
  w.d.raw.prepare("INSERT INTO invoices (id, client_id, number, amount_cents, status, public_token) VALUES ('ai1', 'c1', 'INV-1', 10000, 'sent', ?)").run(T("e"));
  const rc = await w.F.handlePostGmDocLinkControl("c1", "receipt", "p1", "disable", req({}), w.env);
  ok(rc.status === 200 && w.d.q("SELECT receipt_token AS t FROM gm_invoice_payments")[0].t !== T("c") && /receipt-view\?t=/.test(rc.data.direct_url), "a receipt link is disabled through receipt_token");
  await w.F.handlePostGmDocLinkControl("c1", "ack", "k1", "disable", req({}), w.env);
  ok((await w.F.dAckByToken(w.env, T("d"))) === null && (await w.F.dAckByToken(w.env, w.d.q("SELECT public_token AS t FROM gm_job_acks")[0].t)) === null, "a disabled acknowledgment opens by neither token");
  await w.F.handlePostGmDocLinkControl("c1", "ack", "k1", "enable", req({}), w.env);
  ok((await w.F.dAckByToken(w.env, w.d.q("SELECT public_token AS t FROM gm_job_acks")[0].t)) !== null, "and opens by the new token once enabled");
  ok((await w.F.apxInvByToken(w.env, T("e"))) !== null, "an Apex invoice opens by its token");
  const ai = await w.F.handlePostApexDocLinkControl("apex-invoice", "ai1", null, "disable", req({}), w.env);
  const nt = w.d.q("SELECT public_token AS t FROM invoices WHERE id = 'ai1'")[0].t;
  ok(ai.status === 200 && nt !== T("e") && (await w.F.apxInvByToken(w.env, T("e"))) === null && (await w.F.apxInvByToken(w.env, nt)) === null, "a disabled Apex invoice opens by neither token");
  const inv = w.d.q("SELECT status, amount_cents, paid_at FROM invoices WHERE id = 'ai1'")[0];
  ok(inv.status === "sent" && inv.amount_cents === 10000 && inv.paid_at === null, "disabling a link changes nothing else on the invoice");
  await w.F.handlePostApexDocLinkControl("apex-invoice", "ai1", null, "enable", req({}), w.env);
  ok((await w.F.apxInvByToken(w.env, nt)) !== null, "and opens by the new token once enabled");
  ok((await w.F.handlePostApexDocLinkControl("apex-invoice", "nope", null, "disable", req({}), w.env)).status === 404, "an unknown document is 404");
  w.d.raw.prepare("INSERT INTO invoices (id, client_id, number, amount_cents, status) VALUES ('ai2', 'c1', 'INV-2', 10000, 'sent')").run();
  ok((await w.F.handlePostApexDocLinkControl("apex-invoice", "ai2", null, "disable", req({}), w.env)).status === 409, "a document with no link yet answers 409, and no token is minted");
}
// ── every public lookup honours the column
{
  const has = (re) => re.test(workerSrc);
  ok(has(/FROM gm_contracts WHERE public_token = \? AND link_disabled_at IS NULL"\)\.bind\(token\)\.first\(\);\n    return row \? gmContractLoad/), "contractByToken refuses a disabled link");
  ok(has(/FROM gm_change_orders WHERE public_token = \? AND link_disabled_at IS NULL"\)\.bind\(token\)\.first\(\);\n    return row \? gmChangeOrderLoad/), "coByToken refuses a disabled link");
  const i = workerSrc.indexOf("\nasync function docPdfByToken("); const pdf = workerSrc.slice(i, workerSrc.indexOf("\n}", i + 1));
  ok((pdf.match(/_token = \?[^"]*AND link_disabled_at IS NULL"/g) || []).length === 5 && /gmEstLinkDead\(r\)/.test(pdf), "docPdfByToken refuses a disabled link for all six kinds (estimate through gmEstLinkDead)");
  ok(has(/rowInv\.link_disabled_at\) \{ return jsonErr\("Not found", 404\)/) && has(/row\.link_disabled_at\) \{ return jsonErr\("Not found", 404\)/) && has(/if \(!p \|\| p\.link_disabled_at\) \{ return jsonErr\("Not found", 404\)/), "the invoice, invoice pay and receipt routes answer 404 for a disabled link");
  ok(has(/await linkControlTokenDead\(env, row\.kind, row\.public_token\)\) \{ row = null; \}/), "the readable link resolver treats a disabled target as a link that never existed");
}
console.log(fail ? `\n❌ ${fail} FAILED` : "\n✅ ALL PASS");
process.exit(fail ? 1 : 0);
