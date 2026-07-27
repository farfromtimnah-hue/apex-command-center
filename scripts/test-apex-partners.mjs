// Behavioral check for APEX's OWN referral partners (apex_partners).
//
//   node scripts/test-apex-partners.mjs
//
// The rule that matters most here is access. apex_partners holds Apex's own
// commercial relationships — who sends coaching clients to Apex — and has no
// client_id at all, so there is no client scope to grant. Every authenticated
// route must be isAdminRole-only, and a client-role token must never reach any
// of them, through the route table OR through a handler called directly.
//
// The second rule: a referral through an Apex partner's link must land in the
// APEX-INTERNAL pipeline (clients.status='lead', the Task-1 ladder) and NEVER
// in a client's gm_leads — the two tiers share the word "lead" and nothing else.
//
// Real handlers are evaled against a recording fake D1.
import { readFileSync } from "fs";

const worker  = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
const clients = readFileSync(new URL("../clients.html", import.meta.url), "utf8");
const page    = readFileSync(new URL("../apex-referral.html", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/apex_partners.sql", import.meta.url), "utf8");

function slice(src, a, b) {
  const i = src.indexOf(a), j = src.indexOf(b, i);
  if (i < 0 || j < 0) { throw new Error("marker not found: " + a); }
  return src.slice(i, j);
}

let fails = 0;
const t = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { fails++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label +
    (ok ? "" : "\n        expected " + JSON.stringify(expected) + " got " + JSON.stringify(actual)));
};

// ── Fake D1 ───────────────────────────────────────────────────────────────
let statements = [];
let rows = {};        // { first: <row>, all: [<rows>] }
const makeEnv = (cfg = {}) => {
  statements = [];
  rows = cfg;
  return {
    DB: {
      prepare(sql) {
        statements.push(sql);
        const stmt = {
          bind: (...b) => { statements[statements.length - 1] = { sql, binds: b }; return stmt; },
          first: async () => (typeof rows.first === "function" ? rows.first(sql) : rows.first ?? null),
          all:   async () => ({ results: rows.all || [] }),
          run:   async () => ({ success: true })
        };
        return stmt;
      }
    }
  };
};
const sqlText = (s) => (typeof s === "string" ? s : s.sql);
const allSql = () => statements.map(sqlText).join("\n");

// ── Load the real Worker logic ────────────────────────────────────────────
globalThis.jsonOk  = (o) => ({ ok: true, body: o });
globalThis.jsonErr = (m, code) => ({ ok: false, error: m, status: code });

eval(slice(worker, "function isAdminRole(user)", "// ---------------------------------------------------------------------------\n// LEAD PIPELINE") +
  "\n; globalThis.isAdminRole = isAdminRole;");
eval(slice(worker, "function gmStr(v, max)", "function gmFinanceTipo(") +
  "\n; Object.assign(globalThis, { gmStr, gmNum });");
eval(slice(worker, "async function gmRunUpdate(", "// ---------------------------------------------------------------------------\n// Route: GET /api/clients/:id/gm/config") +
  "\n; globalThis.gmRunUpdate = gmRunUpdate;");
eval(slice(worker, "function gmReferralSlugValid(slug)", "async function gmPartnerBySlug(") +
  "\n; globalThis.gmReferralSlugValid = gmReferralSlugValid;");
eval(slice(worker, "function gmReferralSlug()", "async function handleGetGmPartners(") +
  "\n; globalThis.gmReferralSlug = gmReferralSlug;");
eval(slice(worker, "var APEX_PARTNER_STATUSES = [", "async function handlePostReferralLead(") +
  "\n; Object.assign(globalThis, { APEX_PARTNER_STATUSES, apexPartnerFields," +
  " handleGetApexPartners, handlePostApexPartner, handlePutApexPartner, handleDeleteApexPartner," +
  " apexPartnerBySlug, handleGetApexReferralInfo, handlePostApexReferralLead });");

const req = (body) => ({
  url: "https://apex-api.example/api",
  headers: { get: () => "203.0.113.7" },
  json: async () => body
});

const ROLES = {
  alice:     { role: "alice" },
  rafa:      { role: "rafa" },
  developer: { role: "developer" },
  client:    { role: "client", client_id: "c1" },
  none:      null
};
let asUser = ROLES.alice;
globalThis.authenticate = async () => asUser;

// ── Admin-only guards on every authenticated route ────────────────────────
const authedRoutes = [
  ["GET  /api/apex-partners",      () => handleGetApexPartners(req({}), makeEnv({ all: [] }))],
  ["POST /api/apex-partners",      () => handlePostApexPartner(req({ name: "X" }), makeEnv({ first: { id: "p1" } }))],
  ["PUT  /api/apex-partners/:id",  () => handlePutApexPartner("p1", req({ name: "X" }), makeEnv({ first: { id: "p1" } }))],
  ["DEL  /api/apex-partners/:id",  () => handleDeleteApexPartner("p1", req({}), makeEnv({ first: { id: "p1" } }))]
];

for (const [label, call] of authedRoutes) {
  asUser = ROLES.client;
  let r = await call();
  t(label + " rejects a CLIENT token", [r.ok, r.status], [false, 403]);

  asUser = ROLES.none;
  r = await call();
  t(label + " rejects an unauthenticated request", [r.ok, r.status], [false, 401]);

  for (const role of ["alice", "rafa", "developer"]) {
    asUser = ROLES[role];
    r = await call();
    t(label + " allows " + role, r.ok, true);
  }
}
asUser = ROLES.alice;

// The route table itself must not whitelist these for client tokens. A client
// token is confined to /api/clients/<their own id>/... — /api/apex-partners is
// outside that prefix entirely, so it can never be reached.
eval(slice(worker, "function clientRequestAllowed(path, method, clientId)", "async function enforceClientRoleGate(")
  + "\n; globalThis.clientRequestAllowed = clientRequestAllowed;");
["/api/apex-partners", "/api/apex-partners/p1"].forEach((p) => {
  ["GET", "POST", "PUT", "DELETE"].forEach((m) => {
    t("client allowlist denies " + m + " " + p, clientRequestAllowed(p, m, "c1"), false);
  });
});
t("a client cannot reach apex-partners by forging their own id in the path",
  clientRequestAllowed("/api/clients/c1/../apex-partners", "GET", "c1"), false);

// ── Field validation ──────────────────────────────────────────────────────
t("name is required on create", apexPartnerFields({}, false).error !== undefined, true);
t("name may be omitted on a partial update", apexPartnerFields({ status: "Ativo" }, true).error, undefined);
t("an unknown status is rejected", apexPartnerFields({ name: "X", status: "Bogus" }, false).error !== undefined, true);
t("the three real statuses are accepted",
  APEX_PARTNER_STATUSES.map((s) => apexPartnerFields({ name: "X", status: s }, false).error), [undefined, undefined, undefined]);
t("tipo is free text here (no per-client list to validate against)",
  apexPartnerFields({ name: "X", tipo: "Contador" }, false).fields.tipo, "Contador");
t("blank name is rejected, not silently stored", apexPartnerFields({ name: "   " }, false).error !== undefined, true);

// ── Referral counts are DERIVED, never stored ─────────────────────────────
{
  asUser = ROLES.alice;
  const env = makeEnv({ all: [] });
  await handleGetApexPartners(req({}), env);
  const sql = allSql();
  t("clientes_indicados is computed from clients at read time",
    /SELECT COUNT\(\*\) FROM clients c WHERE c\.referred_by_partner_id = p\.id\) AS clientes_indicados/.test(sql), true);
  t("converted counts only clients that actually became active",
    /referred_by_partner_id = p\.id AND c\.status = 'active'\) AS clientes_convertidos/.test(sql), true);
  t("no stored counter column is read", /p\.clientes_indicados/.test(sql), false);
}

// Creating a partner mints a slug immediately.
{
  const env = makeEnv({ first: { id: "p1" } });
  await handlePostApexPartner(req({ name: "Contador João" }), env);
  const insert = statements.map(sqlText).find((s) => /^INSERT INTO apex_partners/.test(s));
  t("create writes a referral_slug", /referral_slug/.test(insert), true);
  t("create defaults status to Prospectando",
    statements.find((s) => /^INSERT INTO apex_partners/.test(sqlText(s))).binds.includes("Prospectando"), true);
}

// Deleting a partner must not delete the real people they referred.
{
  const env = makeEnv({ first: { id: "p1" } });
  await handleDeleteApexPartner("p1", req({}), env);
  const sql = allSql();
  t("delete clears attribution on referred leads",
    /UPDATE clients SET referred_by_partner_id = NULL WHERE referred_by_partner_id = \?/.test(sql), true);
  t("delete removes only the partner row", /DELETE FROM apex_partners WHERE id = \?/.test(sql), true);
  t("delete never removes client rows", /DELETE FROM clients/.test(sql), false);
}

// ── Public referral form ──────────────────────────────────────────────────
// The public routes take no user at all; make sure they do not depend on one.
asUser = ROLES.none;
{
  const env = makeEnv({ first: { id: "p1", name: "Maria Souza" } });
  const r = await handleGetApexReferralInfo("abcdefghij", req({}), env);
  t("public info route works with no session", r.ok, true);
  t("only the partner's FIRST name is exposed", r.body.partner_name, "Maria");
  t("no partner id leaks to the public page", r.body.id, undefined);
  t("no contact details leak to the public page", r.body.contato, undefined);
}
{
  const r = await handleGetApexReferralInfo("nope", req({}), makeEnv({ first: null }));
  t("an invalid slug 404s", r.status, 404);
}

// A real submission lands in the APEX-INTERNAL pipeline, not gm_leads.
{
  const env = makeEnv({ first: (sql) => /FROM apex_partners/.test(sql) ? { id: "p1", name: "Maria" } : { c: 0 } });
  const r = await handlePostApexReferralLead("abcdefghij",
    req({ nome: "Novo Prospect", telefone: "(505) 555-0100", email: "a@b.com", elapsed_ms: 30000 }), env);
  const sql = allSql();
  t("submission succeeds", r.ok, true);
  t("a lead is created in the clients table", /INSERT INTO clients/.test(sql), true);
  t("it NEVER writes a gm_leads row", /INSERT INTO gm_leads/.test(sql), false);
  t("the lead enters the Apex pipeline at status='lead'", /status[^)]*'lead'/.test(sql) || /'lead'/.test(sql), true);
  t("stage_changed_at is stamped so Task 1's day count starts at arrival",
    /stage_changed_at/.test(sql) && /datetime\('now'\)/.test(sql), true);
  t("attribution is by record, not by name", /referred_by_partner_id/.test(sql), true);
  t("the public response leaks no id", r.body.lead_id, undefined);
}

// Abuse controls, mirroring the gm form.
{
  const env = makeEnv({ first: (sql) => /FROM apex_partners/.test(sql) ? { id: "p1", name: "M" } : { c: 0 } });
  const r = await handlePostApexReferralLead("abcdefghij",
    req({ nome: "Bot", website: "spam.example", elapsed_ms: 30000 }), env);
  t("a honeypot hit gets a FAKE success (bots must not learn)", r.ok, true);
  t("a honeypot hit creates nothing", /INSERT INTO clients/.test(allSql()), false);
}
{
  const env = makeEnv({ first: (sql) => /FROM apex_partners/.test(sql) ? { id: "p1", name: "M" } : { c: 0 } });
  const r = await handlePostApexReferralLead("abcdefghij", req({ nome: "Fast", elapsed_ms: 900 }), env);
  t("an impossibly fast submit gets a fake success too", r.ok, true);
  t("an impossibly fast submit creates nothing", /INSERT INTO clients/.test(allSql()), false);
}
{
  const env = makeEnv({ first: (sql) => /FROM apex_partners/.test(sql) ? { id: "p1", name: "M" } : { c: 99 } });
  const r = await handlePostApexReferralLead("abcdefghij", req({ nome: "X", elapsed_ms: 30000 }), env);
  t("over the rate limit returns 429", r.status, 429);
  t("rate limiting uses its OWN ledger, not the gm one",
    /apex_referral_hits/.test(allSql()) && !/gm_referral_hits/.test(allSql()), true);
}
{
  const env = makeEnv({ first: (sql) => /FROM apex_partners/.test(sql) ? { id: "p1", name: "M" } : { c: 0 } });
  const r = await handlePostApexReferralLead("abcdefghij", req({ nome: "", elapsed_ms: 30000 }), env);
  t("a missing name is rejected", r.status, 400);
}
{
  const env = makeEnv({ first: (sql) => /FROM apex_partners/.test(sql) ? { id: "p1", name: "M" } : { c: 0 } });
  const r = await handlePostApexReferralLead("abcdefghij",
    req({ nome: "X", email: "not-an-email", elapsed_ms: 30000 }), env);
  t("a malformed email is rejected", r.status, 400);
}

// ── Migration is additive and keeps the tiers apart ───────────────────────
t("migration never drops anything", /\bDROP\b/i.test(migration), false);
t("migration only ALTERs by adding columns",
  (migration.match(/ALTER TABLE[^;]*/gi) || []).every((s) => /ADD COLUMN/i.test(s)), true);
t("apex_partners has NO client_id (it belongs to no client)",
  /client_id/.test(slice(migration, "CREATE TABLE IF NOT EXISTS apex_partners", "CREATE UNIQUE INDEX")), false);

// ── Frontend wiring ───────────────────────────────────────────────────────
t("clients.html adds a Parceiros sub-tab", /subtabClientsParceiros/.test(clients), true);
t("the partner tab hides the '+ Novo Cliente' button (wrong record type)",
  /addBtn\.hidden = \(tab === "parceiros"\)/.test(clients), true);
t("clients.html uses real inline SVG icons", /AP_ICONS/.test(clients) && /<svg viewBox="0 0 24 24"/.test(clients), true);
t("the partner cards reuse the Task-2 stat treatment", /ap-stat-value/.test(clients), true);
t("the public Apex page is PT-only (no language toggle)", /toggleLang/.test(page), false);
t("the public Apex page has no color picker", /input type="color"/.test(page), false);
t("the public Apex page reuses Apex's existing logo asset",
  page.includes("apexbusiness.pro/wp-content/uploads/2025/12/LogoApex.png"), true);
t("the public Apex page is dependency-free", /<script[^>]+src=/.test(page), false);
t("the public Apex page keeps the honeypot", /hp-field/.test(page), true);
t("the public Apex page posts to its OWN endpoint",
  /\/api\/apex-referral\//.test(page) && !/\/api\/referral\//.test(page), true);

console.log(fails ? "\n" + fails + " FAILED" : "\nAll checks passed.");
process.exit(fails ? 1 : 0);
