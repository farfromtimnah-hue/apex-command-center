// Business System: separate partners per plan (item 2) and the lead pipeline
// (item 6). Runs the REAL Worker handlers, evaled from worker/index.js,
// against an in-memory SQLite database built from the live schema plus the two
// migration files. Nothing here touches the network or a real database.
//
//   node scripts/test-bs-pipeline.mjs
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";

const here = (p) => new URL("../" + p, import.meta.url);
const worker = readFileSync(here("worker/index.js"), "utf8");
const schema = readFileSync(here("scripts/fixtures/bs-pipeline-schema.sql"), "utf8");
const migPartners = readFileSync(here("migrations/apex_partners_plan.sql"), "utf8");
const migPipeline = readFileSync(here("migrations/bs_lead_pipeline.sql"), "utf8");
const migStartStage = readFileSync(here("migrations/apex_partners_start_stage.sql"), "utf8");

function slice(src, a, b) {
  const i = src.indexOf(a), j = src.indexOf(b, i);
  if (i < 0 || j < 0) { throw new Error("marker not found: " + (i < 0 ? a : b)); }
  return src.slice(i, j);
}
let fails = 0;
const t = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { fails++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label +
    (ok ? "" : "\n        expected " + JSON.stringify(expected) + "\n        got      " + JSON.stringify(actual)));
};

// ── D1-shaped wrapper over node:sqlite ──────────────────────────────────────
function makeDb() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schema);
  const env = {
    raw,
    DB: {
      prepare(sql) {
        let binds = [];
        const stmt = {
          bind: (...b) => { binds = b; return stmt; },
          first: async () => raw.prepare(sql).get(...binds) || null,
          all: async () => ({ results: raw.prepare(sql).all(...binds) }),
          run: async () => { raw.prepare(sql).run(...binds); return { success: true }; }
        };
        return stmt;
      }
    }
  };
  return env;
}
const row = (env, sql, ...b) => env.raw.prepare(sql).get(...b);

// ── Load the real Worker code ───────────────────────────────────────────────
globalThis.jsonOk = (o) => ({ ok: true, body: o });
globalThis.jsonErr = (m, code) => ({ ok: false, error: m, status: code });
globalThis.jsonErr2 = (pt, en, code) => ({ ok: false, error: pt + " / " + en, status: code });
let asUser = { role: "alice", display_name: "Alice" };
globalThis.authenticate = async () => asUser;
globalThis.APEX_TIMEZONE = "America/New_York";

function load(code) { vm.runInThisContext(code); }
load(slice(worker, "function isAdminRole(user)", "// ---------------------------------------------------------------------------\n// LEAD PIPELINE"));
load(slice(worker, "var LEAD_STAGES = [", "// ---------------------------------------------------------------------------\n// Route: GET /api/role"));
load(slice(worker, "async function sha256Hex(str)", "// Change I: passkeySessionCountryCheck"));
load(slice(worker, "async function handlePatchLeadStage(", "// ---------------------------------------------------------------------------\n// Route: PATCH /api/clients/:id/lead-next-step"));
load(slice(worker, "// BUSINESS SYSTEM LEAD PIPELINE (progress.md", "// Route: GET /api/clients/:id/documents/latest"));
load(slice(worker, "async function handleGetLeadStages(", "// ---------------------------------------------------------------------------\n// Route: GET /api/clients-needing-review"));
load(slice(worker, "function localDateStrForTZ() {", "\n// Minimal Google Calendar API call"));
load(slice(worker, "async function handlePatchClient(id, request, env) {", "// ---------------------------------------------------------------------------\n// Route: GET /api/clients/:id/digital-presence"));
load(slice(worker, "async function clientSetSwitchOff(", "// Writes the plan and its audit stamp"));
load(slice(worker, "function gmStr(v, max)", "function gmFinanceTipo("));
load(slice(worker, "function gmReferralSlugValid(slug)", "async function gmPartnerBySlug("));
load(slice(worker, "function gmReferralSlug()", "async function handleGetGmPartners("));
load(slice(worker, "async function gmRunUpdate(", "// ---------------------------------------------------------------------------\n// Route: GET /api/clients/:id/gm/config"));
load(slice(worker, "var APEX_PARTNER_STATUSES = [", "async function handlePostReferralLead("));

const req = (body, url) => ({
  url: url || "https://apex-api.example/api",
  headers: { get: () => "203.0.113.7" },
  json: async () => body
});

// ── Migrations: dry run on a copy of the live schema, then the real db ──────
{
  const env = makeDb();
  env.raw.exec("INSERT INTO apex_partners (id, name) VALUES ('p-old', 'Old partner')");
  env.raw.exec("INSERT INTO clients (id, name, status, lead_stage) VALUES ('c-old', 'Old client', 'lead', 'Lead')");
  env.raw.exec(migPartners);
  env.raw.exec(migPipeline);
  env.raw.exec(migStartStage);
  t("migration: an existing partner reads consulting", row(env, "SELECT plan FROM apex_partners WHERE id = 'p-old'").plan, "consulting");
  t("migration: the new client columns are NULL for an existing row",
    row(env, "SELECT bs_waitlist_at, bs_link_sent_at, bs_activated_at FROM clients WHERE id = 'c-old'"),
    { bs_waitlist_at: null, bs_link_sent_at: null, bs_activated_at: null });
  t("migration: bs_lead_links starts empty", row(env, "SELECT COUNT(*) AS n FROM bs_lead_links").n, 0);
  t("migration: bs_lead_links has the specified columns",
    env.raw.prepare("PRAGMA table_info(bs_lead_links)").all().map((c) => c.name),
    ["id", "client_id", "token_hash", "created_at", "created_by", "sent_at", "opened_at", "activated_at", "revoked_at"]);
  t("migration: bs_lead_links.token_hash is unique", (() => {
    env.raw.exec("INSERT INTO bs_lead_links (id, client_id, token_hash, created_at) VALUES ('a', 'c', 'h', 'now')");
    try { env.raw.exec("INSERT INTO bs_lead_links (id, client_id, token_hash, created_at) VALUES ('b', 'c', 'h', 'now')"); return "allowed"; }
    catch (e) { return "refused"; }
  })(), "refused");
  t("migration: index on client_id exists",
    env.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'bs_lead_links' AND name NOT LIKE 'sqlite_%'").all().length, 1);
}

// A fresh migrated database for the rest.
function fresh() {
  const env = makeDb();
  env.raw.exec(migPartners);
  env.raw.exec(migPipeline);
  env.raw.exec(migStartStage);
  return env;
}
function addPartner(env, id, plan, slug) {
  env.raw.prepare("INSERT INTO apex_partners (id, name, referral_slug, plan) VALUES (?, ?, ?, ?)").run(id, "Partner " + id, slug, plan);
}
function addClient(env, c) {
  const d = Object.assign({ status: "lead", lead_stage: "Lead", plan: "consulting", daily_log_enabled: 1 }, c);
  env.raw.prepare(
    "INSERT INTO clients (id, name, status, lead_stage, plan, daily_log_enabled, phone, package, referred_by_partner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(d.id, d.name || "Client " + d.id, d.status, d.lead_stage, d.plan, d.daily_log_enabled, d.phone || null, d.package || null, d.referred_by_partner_id || null);
}

// ══ ITEM 2: partners per plan ═══════════════════════════════════════════════
{
  const env = fresh();
  addPartner(env, "pc", "consulting", "consultingslug");
  addPartner(env, "pb", "business_system", "businesssystemslug");

  // (d) the public landing
  const body = { nome: "Maria Silva", telefone: "(305) 555-0100", email: "maria@example.com", elapsed_ms: 9000 };
  let r = await handlePostApexReferralLead("consultingslug", req(body), env);
  t("landing: a consulting partner link answers created", r.ok, true);
  let lead = row(env, "SELECT * FROM clients WHERE referred_by_partner_id = 'pc'");
  t("landing: a consulting partner link makes a CONSULTING lead", [lead.plan, lead.status, lead.lead_stage, lead.source_type], ["consulting", "lead", "Lead", "partner"]);
  t("landing: a consulting lead keeps the daily log ON, as today", lead.daily_log_enabled, 1);

  r = await handlePostApexReferralLead("businesssystemslug", req(Object.assign({}, body, { nome: "Joao Souza" })), env);
  t("landing: a business_system partner link answers created", r.ok, true);
  lead = row(env, "SELECT * FROM clients WHERE referred_by_partner_id = 'pb'");
  t("landing: a business_system partner link makes a BUSINESS SYSTEM lead", [lead.plan, lead.status, lead.lead_stage, lead.source_type], ["business_system", "lead", "Lead", "partner"]);
  t("landing: a business_system lead starts with the daily log OFF", lead.daily_log_enabled, 0);
  t("landing: the BS lead has no waitlist or link stamps", [lead.bs_waitlist_at, lead.bs_link_sent_at, lead.bs_activated_at], [null, null, null]);

  // (b) the list endpoint, (e) counts
  addClient(env, { id: "x1", plan: "consulting", status: "active", lead_stage: null, referred_by_partner_id: "pc" });
  addClient(env, { id: "x2", plan: "business_system", status: "active", lead_stage: null, referred_by_partner_id: "pc" }); // crosses plans (by-hand data)
  addClient(env, { id: "x3", plan: "business_system", status: "active", lead_stage: null, referred_by_partner_id: "pb" });
  addClient(env, { id: "x4", plan: "consulting", status: "active", lead_stage: null, referred_by_partner_id: "pb" });   // crosses plans
  const listC = await handleGetApexPartners(req({}, "https://apex-api.example/api/apex-partners"), env);
  t("list: missing plan means consulting, only consulting partners", listC.body.partners.map((p) => p.id), ["pc"]);
  t("list: consulting partner counts only consulting clients (1 landing lead + x1; 1 active)",
    [listC.body.partners[0].clientes_indicados, listC.body.partners[0].clientes_convertidos], [2, 1]);
  const listB = await handleGetApexPartners(req({}, "https://apex-api.example/api/apex-partners?plan=business_system"), env);
  t("list: plan=business_system returns only business_system partners", listB.body.partners.map((p) => p.id), ["pb"]);
  t("list: business_system partner counts only business_system clients (1 landing lead + x3; 1 active)",
    [listB.body.partners[0].clientes_indicados, listB.body.partners[0].clientes_convertidos], [2, 1]);

  // (c) create stores the plan of the side
  r = await handlePostApexPartner(req({ name: "New BS partner", plan: "business_system" }), env);
  t("create: a partner made on the Business System side is stored business_system", r.body.partner.plan, "business_system");
  r = await handlePostApexPartner(req({ name: "New consulting partner" }), env);
  t("create: with no side it is stored consulting", r.body.partner.plan, "consulting");
  r = await handlePostApexPartner(req({ name: "Odd", plan: "nonsense" }), env);
  t("create: an unknown plan is stored consulting (whitelist)", r.body.partner.plan, "consulting");

  // (f) by hand check
  addClient(env, { id: "h1", plan: "consulting", status: "active", lead_stage: null });
  addClient(env, { id: "h2", plan: "business_system", status: "active", lead_stage: null });
  r = await handlePatchClient("h1", req({ source_type: "partner", referred_by_partner_id: "pb" }), env);
  t("by hand: a consulting client with a business_system partner is rejected 400", [r.ok, r.status], [false, 400]);
  t("by hand: the message is bilingual", /planos diferentes \/ .*different plans/.test(r.error), true);
  t("by hand: nothing was written on the rejected client", row(env, "SELECT referred_by_partner_id FROM clients WHERE id = 'h1'").referred_by_partner_id, null);
  r = await handlePatchClient("h2", req({ source_type: "partner", referred_by_partner_id: "pc" }), env);
  t("by hand: a business_system client with a consulting partner is rejected 400", [r.ok, r.status], [false, 400]);
  r = await handlePatchClient("h1", req({ source_type: "partner", referred_by_partner_id: "pc" }), env);
  t("by hand: matching consulting plans are accepted", r.ok, true);
  t("by hand: and stored", row(env, "SELECT referred_by_partner_id FROM clients WHERE id = 'h1'").referred_by_partner_id, "pc");
  r = await handlePatchClient("h2", req({ source_type: "partner", referred_by_partner_id: "pb" }), env);
  t("by hand: matching business_system plans are accepted", r.ok, true);
}

// ══ ITEM 6: the pipeline ════════════════════════════════════════════════════
t("stages: the consulting list is exactly as before",
  LEAD_STAGES, ["Lead", "Contato inicial", "Raio X enviado", "Raio X recebido", "Agendamento"]);
t("stages: the business_system list", LEAD_STAGES_BS, ["Lead", "Contato inicial", "Lista de espera", "Link enviado"]);
t("stages: leadStagesFor(consulting) is the consulting list", leadStagesFor("consulting"), LEAD_STAGES);
t("stages: leadStagesFor(missing) is the consulting list", leadStagesFor(undefined), LEAD_STAGES);
t("stages: leadStagesFor(business_system)", leadStagesFor("business_system"), LEAD_STAGES_BS);
t("stages: leadStageIndex (consulting) is unchanged", ["Lead", "Raio X recebido", "Agendamento", null, "nope"].map(leadStageIndex), [0, 3, 4, 0, 0]);
{
  const env = fresh();
  let r = await handleGetLeadStages(req({}, "https://apex-api.example/api/lead-stages"), env);
  t("GET lead-stages with no plan is the consulting list", r.body.stages, LEAD_STAGES);
  r = await handleGetLeadStages(req({}, "https://apex-api.example/api/lead-stages?plan=consulting"), env);
  t("GET lead-stages plan=consulting is the consulting list", r.body.stages, LEAD_STAGES);
  r = await handleGetLeadStages(req({}, "https://apex-api.example/api/lead-stages?plan=business_system"), env);
  t("GET lead-stages plan=business_system is the business list", r.body.stages, LEAD_STAGES_BS);
  r = await handleGetLeadStages(req({}, "https://apex-api.example/api/lead-stages?plan=junk"), env);
  t("GET lead-stages with an unknown plan is the consulting list", r.body.stages, LEAD_STAGES);
}

// validation of a stage change uses the client's own plan, and consulting is unchanged
{
  const env = fresh();
  addClient(env, { id: "cc", plan: "consulting" });
  addClient(env, { id: "bb", plan: "business_system", daily_log_enabled: 0 });
  for (const st of LEAD_STAGES) {
    const r = await handlePatchLeadStage("cc", req({ stage: st }), env);
    t("consulting lead accepts '" + st + "'", r.ok, true);
  }
  let r = await handlePatchLeadStage("cc", req({ stage: "Lista de espera" }), env);
  t("consulting lead rejects 'Lista de espera'", [r.ok, r.status, r.error], [false, 400, "Invalid stage"]);
  r = await handlePatchLeadStage("cc", req({ stage: "Bogus" }), env);
  t("consulting lead rejects a made-up stage", [r.ok, r.status], [false, 400]);
  t("consulting leads never get the waitlist or link stamps",
    row(env, "SELECT bs_waitlist_at, bs_link_sent_at FROM clients WHERE id = 'cc'"), { bs_waitlist_at: null, bs_link_sent_at: null });

  r = await handlePatchLeadStage("bb", req({ stage: "Agendamento" }), env);
  t("business lead rejects 'Agendamento'", [r.ok, r.status], [false, 400]);
  r = await handlePatchLeadStage("bb", req({ stage: "Raio X enviado" }), env);
  t("business lead rejects 'Raio X enviado'", [r.ok, r.status], [false, 400]);
  r = await handlePatchLeadStage("bb", req({ stage: "Contato inicial" }), env);
  t("business lead accepts 'Contato inicial' without a stamp",
    [r.ok, row(env, "SELECT bs_waitlist_at, bs_link_sent_at FROM clients WHERE id = 'bb'")], [true, { bs_waitlist_at: null, bs_link_sent_at: null }]);
  r = await handlePatchLeadStage("bb", req({ stage: "Lista de espera" }), env);
  const w1 = row(env, "SELECT bs_waitlist_at, bs_link_sent_at, lead_stage FROM clients WHERE id = 'bb'");
  t("business lead entering 'Lista de espera' stamps bs_waitlist_at", [r.ok, !!w1.bs_waitlist_at, w1.bs_link_sent_at, w1.lead_stage], [true, true, null, "Lista de espera"]);
  env.raw.exec("UPDATE clients SET bs_waitlist_at = '2026-01-02 03:04:05' WHERE id = 'bb'");
  r = await handlePatchLeadStage("bb", req({ stage: "Lista de espera" }), env);
  t("re-picking 'Lista de espera' does not overwrite the date",
    [r.body.unchanged, row(env, "SELECT bs_waitlist_at FROM clients WHERE id = 'bb'").bs_waitlist_at], [true, "2026-01-02 03:04:05"]);
  r = await handlePatchLeadStage("bb", req({ stage: "Link enviado" }), env);
  const w2 = row(env, "SELECT bs_waitlist_at, bs_link_sent_at, lead_stage FROM clients WHERE id = 'bb'");
  t("entering 'Link enviado' stamps bs_link_sent_at and keeps the waitlist date",
    [r.ok, !!w2.bs_link_sent_at, w2.bs_waitlist_at, w2.lead_stage], [true, true, "2026-01-02 03:04:05", "Link enviado"]);
}

// the status editor path (handlePatchClient) and auto-advance
{
  const env = fresh();
  addClient(env, { id: "cc", plan: "consulting", status: "active", lead_stage: null, package: "Premium" });
  addClient(env, { id: "bb", plan: "business_system", status: "active", lead_stage: null, daily_log_enabled: 0, phone: "(305) 555-0199" });
  let r = await handlePatchClient("cc", req({ status: "lead", lead_stage: "Lista de espera" }), env);
  t("status editor: a consulting client cannot go to 'Lista de espera'", [r.ok, r.status], [false, 400]);
  r = await handlePatchClient("cc", req({ status: "lead", lead_stage: "Raio X recebido" }), env);
  t("status editor: a consulting client can go to 'Raio X recebido'",
    [r.ok, row(env, "SELECT status, lead_stage, bs_waitlist_at FROM clients WHERE id = 'cc'")], [true, { status: "lead", lead_stage: "Raio X recebido", bs_waitlist_at: null }]);
  r = await handlePatchClient("bb", req({ status: "lead", lead_stage: "Agendamento" }), env);
  t("status editor: a business client cannot go to 'Agendamento'", [r.ok, r.status], [false, 400]);

  // (f) moving an active business client back to the waiting list
  env.raw.exec("INSERT INTO client_logins (username, client_id, password_hash, role) VALUES ('bbowner', 'bb', 'PASSKEY_ONLY', 'client')");
  const logins = () => env.raw.prepare("SELECT * FROM client_logins WHERE client_id = 'bb'").all();
  const loginsBefore = JSON.stringify(logins());
  const before = row(env, "SELECT name, phone, plan, daily_log_enabled FROM clients WHERE id = 'bb'");
  r = await handlePatchClient("bb", req({ status: "lead", lead_stage: "Lista de espera" }), env);
  const after = row(env, "SELECT name, phone, plan, daily_log_enabled, status, lead_stage, bs_waitlist_at FROM clients WHERE id = 'bb'");
  t("move back: an active business client goes back to a lead on 'Lista de espera'", [r.ok, after.status, after.lead_stage], [true, "lead", "Lista de espera"]);
  t("move back: it keeps its data", [after.name, after.phone, after.plan], [before.name, before.phone, before.plan]);
  t("move back: bs_waitlist_at is stamped", !!after.bs_waitlist_at, true);
  t("move back: its logins are untouched", JSON.stringify(logins()), loginsBefore);
  t("move back: the daily log stays off", after.daily_log_enabled, 0);

  // auto-advance respects the plan
  addClient(env, { id: "b2", plan: "business_system", daily_log_enabled: 0 });
  await advanceLeadStage(env, "b2", "Agendamento", "Alice", "auto:session_scheduled");
  t("auto-advance: a business lead is never moved to 'Agendamento'", row(env, "SELECT lead_stage FROM clients WHERE id = 'b2'").lead_stage, "Lead");
  await advanceLeadStage(env, "b2", "Raio X enviado", "Alice", "auto:xray_assigned");
  t("auto-advance: a business lead is never moved to 'Raio X enviado'", row(env, "SELECT lead_stage FROM clients WHERE id = 'b2'").lead_stage, "Lead");
  await advanceLeadStage(env, "b2", "Contato inicial", "Alice", "auto:contact_logged");
  t("auto-advance: a business lead does move to 'Contato inicial'", row(env, "SELECT lead_stage FROM clients WHERE id = 'b2'").lead_stage, "Contato inicial");
  addClient(env, { id: "c2", plan: "consulting" });
  await advanceLeadStage(env, "c2", "Agendamento", "Alice", "auto:session_scheduled");
  t("auto-advance: a consulting lead still moves to 'Agendamento'", row(env, "SELECT lead_stage FROM clients WHERE id = 'c2'").lead_stage, "Agendamento");
}

// bsActivateLead and the converted outcome
{
  const env = fresh();
  addClient(env, { id: "bb", plan: "business_system", daily_log_enabled: 0, lead_stage: "Link enviado" });
  env.raw.exec("UPDATE clients SET bs_link_sent_at = datetime('now', '-90 minutes') WHERE id = 'bb'");
  env.raw.exec("INSERT INTO client_logins (username, client_id, password_hash, role) VALUES ('bbowner', 'bb', 'X', 'client')");
  const loginsBefore = JSON.stringify(env.raw.prepare("SELECT * FROM client_logins").all());
  const a = await bsActivateLead(env, "bb", { source: "manual", actor: "Alice" });
  const bb = row(env, "SELECT status, lead_stage, package, daily_log_enabled, bs_activated_at, stage_change_source FROM clients WHERE id = 'bb'");
  t("activate: a business lead becomes active with no package", [a.ok, bb.status, bb.lead_stage, bb.package], [true, "active", null, null]);
  t("activate: the daily log is still OFF afterwards", bb.daily_log_enabled, 0);
  t("activate: bs_activated_at is stamped", !!bb.bs_activated_at, true);
  t("activate: the source is recorded", bb.stage_change_source, "bs_activate:manual");
  t("activate: returns whole minutes between link sent and activated", a.minutes, 90);
  t("activate: logins untouched, no credentials made", JSON.stringify(env.raw.prepare("SELECT * FROM client_logins").all()), loginsBefore);
  const again = await bsActivateLead(env, "bb", { source: "manual" });
  t("activate: a second call changes nothing", [again.ok, again.changed], [true, false]);

  addClient(env, { id: "nolink", plan: "business_system", daily_log_enabled: 0 });
  const n = await bsActivateLead(env, "nolink", { source: "manual" });
  t("activate: minutes is null when no link was sent", n.minutes, null);
  addClient(env, { id: "cons", plan: "consulting" });
  const c = await bsActivateLead(env, "cons", { source: "manual" });
  t("activate: refuses a consulting client", [c.ok, c.status], [false, 400]);
  t("activate: the consulting client is untouched", row(env, "SELECT status FROM clients WHERE id = 'cons'").status, "lead");
  const nf = await bsActivateLead(env, "ghost", { source: "manual" });
  t("activate: unknown client is 404", [nf.ok, nf.status], [false, 404]);

  // the pause memory of an old pause must not turn the log back ON
  addClient(env, { id: "pm", plan: "business_system", daily_log_enabled: 0 });
  await bsActivateLead(env, "pm", { source: "manual" });
  t("activate: daily_log_before_pause stays empty", row(env, "SELECT daily_log_before_pause AS m FROM clients WHERE id = 'pm'").m, null);

  // converted outcome
  addClient(env, { id: "o1", plan: "business_system", daily_log_enabled: 0 });
  let r = await handlePostLeadOutcome("o1", req({ outcome: "converted" }), env);
  t("outcome converted: a business client needs no package", [r.ok, r.body.status, r.body.plan], [true, "active", "business_system"]);
  t("outcome converted: the daily log is still off", row(env, "SELECT daily_log_enabled AS d FROM clients WHERE id = 'o1'").d, 0);
  addClient(env, { id: "o2", plan: "consulting", daily_log_enabled: 1 });
  r = await handlePostLeadOutcome("o2", req({ outcome: "converted" }), env);
  t("outcome converted: a consulting client still needs a package", [r.ok, r.status], [false, 400]);
  r = await handlePostLeadOutcome("o2", req({ outcome: "converted", package: "Premium" }), env);
  const o2 = row(env, "SELECT status, package, lead_stage, daily_log_enabled, stage_change_source, bs_activated_at FROM clients WHERE id = 'o2'");
  t("outcome converted: a consulting conversion is unchanged",
    [r.ok, o2.status, o2.package, o2.lead_stage, o2.daily_log_enabled, o2.stage_change_source, o2.bs_activated_at], [true, "active", "Premium", null, 1, "lead_outcome:converted", null]);
  addClient(env, { id: "o3", plan: "business_system" });
  addClient(env, { id: "o4", plan: "consulting" });
  for (const id of ["o3", "o4"]) {
    r = await handlePostLeadOutcome(id, req({ outcome: "dormant" }), env);
    t("outcome dormant is unchanged for " + id, [r.ok, row(env, "SELECT status, lead_stage FROM clients WHERE id = '" + id + "'")], [true, { status: "lead_dormant", lead_stage: null }]);
  }

  // a consulting client paused and reactivated through the same SQL still restores its switch
  addClient(env, { id: "pz", plan: "consulting", status: "paused", daily_log_enabled: 0 });
  env.raw.exec("UPDATE clients SET daily_log_before_pause = 1 WHERE id = 'pz'");
  env.raw.exec("UPDATE clients SET status = 'active'" + clientStatusSwitchSql("active") + " WHERE id = 'pz'");
  t("clientStatusSwitchSql: a paused consulting client reactivated gets its log back ON", row(env, "SELECT daily_log_enabled AS d FROM clients WHERE id = 'pz'").d, 1);
}

// bsMintLeadLink
{
  const env = fresh();
  const logged = [];
  const origLog = console.log, origErr = console.error, origWarn = console.warn;
  console.log = (...a) => { logged.push(a.join(" ")); };
  console.error = console.log; console.warn = console.log;
  const m1 = await bsMintLeadLink(env, "c1", "Alice");
  const m2 = await bsMintLeadLink(env, "c1", "Alice");
  console.log = origLog; console.error = origErr; console.warn = origWarn;
  t("mint: returns the raw token and an id", [typeof m1.token, m1.token.length > 20, typeof m1.id], ["string", true, "string"]);
  t("mint: two links have different tokens", m1.token !== m2.token, true);
  const rows = env.raw.prepare("SELECT * FROM bs_lead_links ORDER BY created_at, id").all();
  t("mint: two rows are stored", rows.length, 2);
  const hashes = rows.map((x) => x.token_hash).sort();
  t("mint: the stored value is the sha256 hash of the token",
    hashes, [createHash("sha256").update(m1.token).digest("hex"), createHash("sha256").update(m2.token).digest("hex")].sort());
  t("mint: the raw token is stored nowhere in the row",
    rows.some((x) => Object.values(x).some((v) => typeof v === "string" && v.indexOf(m1.token) >= 0)), false);
  t("mint: hashes are unique", new Set(hashes).size, 2);
  t("mint: client, actor and time are recorded", [rows[0].client_id, rows[0].created_by, !!rows[0].created_at, rows[0].sent_at, rows[0].revoked_at], ["c1", "Alice", true, null, null]);
  t("mint: the token is never logged", logged.some((l) => l.indexOf(m1.token) >= 0 || l.indexOf(m2.token) >= 0), false);
  t("mint: nothing in the Worker routes uses it yet", (worker.match(/bsMintLeadLink\(/g) || []).length, 1);
}

console.log(fails ? "\n" + fails + " FAILED" : "\nAll passed");
process.exit(fails ? 1 : 0);
