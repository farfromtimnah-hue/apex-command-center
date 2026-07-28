// Behavioral check for CLIENT SOURCE — where a client came from, kept for
// their whole lifecycle.
//
//   node scripts/test-client-source.mjs
//
// The rules that matter here:
//
//   1. ATTRIBUTION IS BY RECORD. When source_type='partner', the partner is
//      clients.referred_by_partner_id pointing at a real apex_partners row,
//      resolved by JOIN at read time. The partner's NAME is never stored on the
//      client — not in source_detail, not anywhere. A typed name is not
//      attribution. This is the same rule the gm_leads partner field and the
//      Apex Partner tab already follow.
//
//   2. THE THREE SOURCE COLUMNS MOVE TOGETHER. 'partner' with no partner id is
//      unattributed; a partner id left behind after the type changes to
//      'social' is a lie the Partner tab's counts would still believe. So a
//      source edit always rewrites source_type, source_detail and
//      referred_by_partner_id as a set.
//
//   3. NULL IS A REAL ANSWER. Unknown origin is never backfilled or defaulted
//      to a guess — invented attribution would be reported by the future
//      metrics as if it had been observed.
//
//   4. SOURCE IS NOT LEAD-ONLY. It is set on the lead and survives conversion
//      untouched, so the Overview row renders for leads and active clients
//      alike.
//
// Real handlers are evaled against a recording fake D1.
import { readFileSync } from "fs";

const worker    = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
const client    = readFileSync(new URL("../client.html", import.meta.url), "utf8");
const clients   = readFileSync(new URL("../clients.html", import.meta.url), "utf8");
const migration = readFileSync(new URL("../migrations/client_source.sql", import.meta.url), "utf8");
const schema    = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");

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
let rows = {};
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
const allSql  = () => statements.map(sqlText).join("\n");
// The single statement that writes the source columns, with its bindings.
const sourceWrite = () => statements.find((s) => /SET source_type/.test(sqlText(s)));

// ── Load the real Worker logic ────────────────────────────────────────────
globalThis.jsonOk  = (o) => ({ ok: true, body: o });
globalThis.jsonErr = (m, code) => ({ ok: false, error: m, status: code });

eval(slice(worker, "var CLIENT_SOURCE_TYPES = [", "// Contact-log vocabularies")
  + "\n; globalThis.CLIENT_SOURCE_TYPES = CLIENT_SOURCE_TYPES;");
eval(slice(worker, "async function handleGetClient(id, request, env)", "// ---------------------------------------------------------------------------\n// Route: GET /api/clients/:id/contacts")
  + "\n; globalThis.handleGetClient = handleGetClient;");
eval(slice(worker, "async function handlePatchClient(id, request, env)", "// ---------------------------------------------------------------------------\n// Route: GET /api/clients/:id/digital-presence")
  + "\n; globalThis.handlePatchClient = handlePatchClient;");

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

// ── The vocabulary ────────────────────────────────────────────────────────
t("source types are a constrained set, not free text",
  CLIENT_SOURCE_TYPES,
  ["partner", "referral_client", "direct", "event", "social", "other"]);

// ── GET returns the source fields plus the RESOLVED partner name ──────────
{
  const env = makeEnv({ first: { id: "c1", name: "Lira", source_type: "partner" } });
  const r = await handleGetClient("c1", req({}), env);
  const sql = allSql();
  t("GET client succeeds", r.ok, true);
  t("GET returns source_type",   /c\.source_type/.test(sql), true);
  t("GET returns source_detail", /c\.source_detail/.test(sql), true);
  t("GET returns the partner id", /c\.referred_by_partner_id/.test(sql), true);
  t("GET resolves the partner NAME by join, not from a stored copy",
    /LEFT JOIN apex_partners p ON p\.id = c\.referred_by_partner_id/.test(sql), true);
  t("the resolved name is aliased for the client",
    /p\.name AS referred_by_partner_name/.test(sql), true);
  // A LEFT (not INNER) join: a client with no partner, or whose partner was
  // deleted, must still come back — not vanish from their own detail page.
  t("the join is a LEFT join so a partnerless client is still returned",
    /LEFT JOIN/.test(sql) && !/\bINNER JOIN\b/.test(sql), true);
  t("it extends the existing endpoint rather than adding a new one",
    /SELECT c\.id, c\.name/.test(sql), true);
}

// ── PATCH: the constrained set is enforced ────────────────────────────────
for (const type of CLIENT_SOURCE_TYPES) {
  const body = type === "partner"
    ? { source_type: "partner", referred_by_partner_id: "p1" }
    : { source_type: type };
  const env = makeEnv({ first: { id: "p1" } });
  const r = await handlePatchClient("c1", req(body), env);
  t("PATCH accepts the real source type '" + type + "'", r.ok, true);
}

{
  const r = await handlePatchClient("c1", req({ source_type: "instagram_dm" }), makeEnv({}));
  t("PATCH rejects a source type outside the vocabulary", [r.ok, r.status], [false, 400]);
  t("the rejected type is never written", sourceWrite(), undefined);
}

// ── PATCH: attribution is BY RECORD ───────────────────────────────────────
{
  // 'partner' with no id is unattributed — reject rather than store a type
  // whose partner nobody can name.
  const r = await handlePatchClient("c1", req({ source_type: "partner" }), makeEnv({}));
  t("'partner' with no partner id is rejected", [r.ok, r.status], [false, 400]);
  t("an unattributed 'partner' is never written", sourceWrite(), undefined);
}
{
  // A dangling pointer is worse than no pointer: the Partner tab would count a
  // referral for a partner that does not exist.
  const r = await handlePatchClient("c1", req({ source_type: "partner", referred_by_partner_id: "ghost" }), makeEnv({ first: null }));
  t("'partner' pointing at a non-existent partner is rejected", [r.ok, r.status], [false, 404]);
  t("a dangling partner pointer is never written", sourceWrite(), undefined);
}
{
  const env = makeEnv({ first: { id: "p1" } });
  await handlePatchClient("c1", req({ source_type: "partner", referred_by_partner_id: "p1" }), env);
  t("the partner id is verified against apex_partners before it is stored",
    /SELECT id FROM apex_partners WHERE id = \?/.test(allSql()), true);
  t("a valid partner writes type + id and leaves detail NULL",
    sourceWrite().binds, ["partner", null, "p1", "c1"]);
}
{
  // THE core rule: the partner's name must never be duplicated onto the client.
  // Passing a name alongside must not smuggle it into source_detail.
  const env = makeEnv({ first: { id: "p1" } });
  await handlePatchClient("c1", req({
    source_type: "partner", referred_by_partner_id: "p1", source_detail: "Contador João"
  }), env);
  t("a partner's name is NEVER copied into source_detail",
    sourceWrite().binds[1], null);
}

// ── PATCH: the three columns move together ────────────────────────────────
{
  const env = makeEnv({});
  await handlePatchClient("c1", req({ source_type: "social", source_detail: "Instagram DM" }), env);
  t("a non-partner type stores its free-text detail",
    sourceWrite().binds, ["social", "Instagram DM", null, "c1"]);
}
{
  // Changing away from 'partner' must clear the pointer, or the Partner tab
  // keeps counting a referral the record no longer claims.
  const env = makeEnv({});
  await handlePatchClient("c1", req({ source_type: "event", source_detail: "Apex Club", referred_by_partner_id: "p1" }), env);
  t("switching off 'partner' clears referred_by_partner_id",
    sourceWrite().binds, ["event", "Apex Club", null, "c1"]);
}
{
  const env = makeEnv({});
  await handlePatchClient("c1", req({ source_type: null }), env);
  t("clearing the source nulls all three columns — unknown is a real answer",
    sourceWrite().binds, [null, null, null, "c1"]);
}
{
  const env = makeEnv({});
  await handlePatchClient("c1", req({ source_type: "other", source_detail: "x".repeat(900) }), env);
  t("free-text detail is length-capped", sourceWrite().binds[1].length, 500);
}
{
  // One statement, not three: a partial write could leave type='partner' with
  // no id, which is exactly the unattributed state the validation forbids.
  const env = makeEnv({ first: { id: "p1" } });
  await handlePatchClient("c1", req({ source_type: "partner", referred_by_partner_id: "p1" }), env);
  const writes = statements.filter((s) => /UPDATE clients SET source/.test(sqlText(s)));
  t("the three source columns are written in ONE statement", writes.length, 1);
}

// ── PATCH: unrelated edits never disturb the source ───────────────────────
{
  const env = makeEnv({});
  await handlePatchClient("c1", req({ industry: "Construção" }), env);
  t("editing another Overview field does not touch the source columns",
    sourceWrite(), undefined);
}

// ── PATCH: who may set a source ───────────────────────────────────────────
for (const role of ["alice", "rafa", "developer"]) {
  asUser = ROLES[role];
  const r = await handlePatchClient("c1", req({ source_type: "direct" }), makeEnv({}));
  t("PATCH source allows " + role, r.ok, true);
}
asUser = ROLES.client;
{
  const r = await handlePatchClient("c1", req({ source_type: "direct" }), makeEnv({}));
  t("PATCH source rejects a CLIENT token", [r.ok, r.status], [false, 403]);
}
asUser = ROLES.none;
{
  const r = await handlePatchClient("c1", req({ source_type: "direct" }), makeEnv({}));
  t("PATCH source rejects an unauthenticated request", [r.ok, r.status], [false, 401]);
}
asUser = ROLES.alice;

// ── The public referral flow stamps the source at creation ────────────────
{
  const insert = slice(worker, "async function handlePostApexReferralLead(", "async function handlePostReferralLead(");
  t("a lead from a partner's own link is stamped source_type='partner'",
    /INSERT INTO clients \([^)]*source_type\)[\s\S]*?'partner'\)/.test(insert), true);
  t("that insert still sets referred_by_partner_id — the id stays authoritative",
    /referred_by_partner_id, source_type/.test(insert), true);
}

// ── Migration ─────────────────────────────────────────────────────────────
t("migration adds source_type",   /ALTER TABLE clients ADD COLUMN source_type TEXT;/.test(migration), true);
t("migration adds source_detail", /ALTER TABLE clients ADD COLUMN source_detail TEXT;/.test(migration), true);
t("migration is additive — it never drops or rewrites anything",
  /\bDROP\b/i.test(migration), false);
t("migration only ALTERs by adding columns",
  (migration.match(/ALTER TABLE[^;]*/gi) || []).every((s) => /ADD COLUMN/i.test(s)), true);
t("referred_by_partner_id is left exactly as it was",
  /ALTER TABLE clients[^;]*referred_by_partner_id/i.test(migration), false);
t("migration backfills existing partner referrals",
  /UPDATE clients\s+SET source_type = 'partner'\s+WHERE referred_by_partner_id IS NOT NULL/.test(migration), true);
t("the backfill only touches rows with no source yet",
  /AND source_type IS NULL/.test(migration), true);
// Everything else stays NULL: a guessed default would be indistinguishable
// from an observed one once the metrics land.
t("the backfill never guesses a default for unknown origins",
  /SET source_type = '(?!partner')/.test(migration), false);
t("source_type is indexed — it is what the future metrics group by",
  /CREATE INDEX IF NOT EXISTS idx_clients_source_type ON clients \(source_type\)/.test(migration), true);
t("schema.sql records the new columns alongside the other live ALTERs",
  /source_type and source_detail were added to the live clients table/.test(schema), true);

// ── client.html: the Overview rows ────────────────────────────────────────
t("the Overview card gains a Source row",
  /key: "_sourceType"/.test(client), true);
t("the Overview card gains a Source Detail row",
  /key: "_sourceDetail"/.test(client), true);
t("both source rows are bilingual",
  /labelPt: "Origem",\s*labelEn: "Source"/.test(client), true);
t("both source rows are editable inline",
  /key: "_sourceType",[^}]*editable: true/.test(client) &&
  /key: "_sourceDetail",[^}]*editable: true/.test(client), true);

// Source travels with the record. If the rows were gated on status the whole
// point — that the source survives conversion — would be lost.
{
  const fields = slice(client, "var OVERVIEW_FIELDS = [", "];");
  t("the source rows are NOT gated on lead vs active status",
    /status\s*===\s*['"]lead['"]/.test(fields), false);
}

// The page's vocabulary must match the worker's, or a pick fails on save.
{
  const pageTypes = (slice(client, "var SOURCE_TYPES = [", "];")
    .match(/value: "([a-z_]+)"/g) || []).map((s) => s.replace(/value: "|"/g, ""));
  t("client.html's source vocabulary matches the worker's exactly",
    pageTypes, CLIENT_SOURCE_TYPES);
}

t("the empty state is an em-dash, matching the other Overview fields",
  /valEl\.textContent = label \|\| "—"/.test(client), true);
t("a partner renders as a link through to that partner",
  /clients\.html\?tab=parceiros&partner=/.test(client), true);
t("the partner link uses the id, not the name",
  /partner=" \+ encodeURIComponent\(client\.referred_by_partner_id/.test(client), true);
t("picking 'partner' opens a picker of REAL apex_partners rows",
  /loadApexPartnersForPicker/.test(client) && /apiFetch\("\/api\/apex-partners"\)/.test(client), true);
t("editing the detail of a partner opens the record picker, never a text box",
  /if \(client\.source_type === "partner"\) \{ return startSourcePartnerPick\(client\); \}/.test(client), true);
t("the picker offers no free-text partner fallback",
  /input[^\n]*partnerName|partner_name["']?\s*:/.test(client), false);
t("a save sends all three source fields together",
  /source_type: type \|\| null[\s\S]{0,200}referred_by_partner_id:/.test(client), true);
t("a deleted partner shows a distinct state, not a bare dash",
  /parceiro removido/.test(client), true);

// ── clients.html: the link's destination ──────────────────────────────────
t("clients.html honours the ?tab=parceiros deep link",
  /params\.get\("tab"\) !== "parceiros"/.test(clients), true);
t("the deep link opens the named partner's sheet",
  /openApexPartnerModal\(partnerId\)/.test(clients), true);
t("the deep link is admin-gated — the partner roster API is admin-only",
  /role !== "alice" && role !== "rafa" && role !== "developer"/.test(
    slice(clients, "function applyClientsDeepLink()", "\n    }")), true);
t("a partner deleted since the link was rendered does not open an empty sheet",
  /if \(found\) \{ openApexPartnerModal\(partnerId\); \}/.test(clients), true);

// ── Metrics are deliberately NOT built yet ────────────────────────────────
// The columns exist so attribution CAN be computed later; computing it now was
// explicitly out of scope. A stat tile shipped early would need reworking the
// moment the real definitions are agreed.
t("no source-attribution metric was built",
  /source_type/.test(readFileSync(new URL("../sales.html", import.meta.url), "utf8")), false);
t("no source aggregate query was added to the worker",
  /GROUP BY\s+(c\.)?source_type/i.test(worker), false);

console.log(fails === 0 ? "\nAll checks passed." : "\n" + fails + " FAILED");
process.exit(fails ? 1 : 0);
