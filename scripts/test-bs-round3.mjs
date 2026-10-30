// Business System round 3: phone on the Add New Client form and the one-time
// fill, partner start stage and the public landing fields, the Growth switch
// starting off, the stage on the Add New Client form, and archived-client links.
// Runs the REAL Worker handlers, evaled from worker/index.js, against an
// in-memory SQLite database built from the live schema plus the migrations.
// Nothing here touches the network or a real database.
//
//   node scripts/test-bs-round3.mjs
import { readFileSync } from "node:fs";
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

function makeDb() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schema);
  raw.exec(migPartners);
  raw.exec(migPipeline);
  raw.exec(migStartStage);
  raw.exec("CREATE TABLE client_notes (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, content TEXT NOT NULL, created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))");
  raw.exec("CREATE TABLE gm_partners (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, name TEXT, referral_slug TEXT)");
  raw.exec("CREATE TABLE gm_referral_hits (id TEXT PRIMARY KEY, slug TEXT NOT NULL, ip TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))");
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

globalThis.jsonOk = (o) => ({ ok: true, body: o });
globalThis.jsonErr = (m, code) => ({ ok: false, error: m, status: code });
globalThis.jsonErr2 = (pt, en, code) => ({ ok: false, error: pt + " / " + en, status: code });
let asUser = { role: "alice", display_name: "Alice" };
globalThis.authenticate = async () => asUser;
globalThis.APEX_TIMEZONE = "America/New_York";
// The create handler tries Zoho last; a failure only adds a warning.
globalThis.getZohoAccessToken = async () => { throw new Error("no zoho in tests"); };
globalThis.zohoBankingFetch = async () => ({ ok: false, data: {} });
globalThis.CORS_HEADERS = {};

function load(code) { vm.runInThisContext(code); }
load(slice(worker, "function isAdminRole(user)", "// ---------------------------------------------------------------------------\n// LEAD PIPELINE"));
load(slice(worker, "var LEAD_STAGES = [", "// ---------------------------------------------------------------------------\n// Route: GET /api/role"));
load(slice(worker, "async function sha256Hex(str)", "// Change I: passkeySessionCountryCheck"));
load(slice(worker, "var CLIENT_SWITCH_EXEMPT_ID", "var CLIENT_STATUS = ["));
load(slice(worker, "// The first contact of a clients.contacts value", "// Route: GET /api/clients/:id  — single client"));
load(slice(worker, "async function clientSetSwitchOff(", "// ---- Route: PUT /api/clients/:id/billing-split"));
load(slice(worker, "// BUSINESS SYSTEM LEAD PIPELINE (progress.md", "// Route: GET /api/clients/:id/documents/latest"));
load(slice(worker, "function localDateStrForTZ() {", "\n// Minimal Google Calendar API call"));
load(slice(worker, "function gmStr(v, max)", "function gmFinanceTipo("));
load(slice(worker, "function gmReferralSlugValid(slug)", "async function gmPartnerBySlug("));
load(slice(worker, "async function gmPartnerBySlug(", "// Apex's own palette"));
load(slice(worker, "function gmReferralSlug()", "async function handleGetGmPartners("));
load(slice(worker, "async function gmRunUpdate(", "// ---------------------------------------------------------------------------\n// Route: GET /api/clients/:id/gm/config"));
load(slice(worker, "var APEX_PARTNER_STATUSES = [", "async function handlePostReferralLead("));
load(slice(worker, "async function handlePostReferralLead(", "// PUBLIC link-in-bio page"));

const req = (body, url, ip) => ({
  url: url || "https://apex-api.example/api",
  headers: { get: () => ip || "203.0.113.7" },
  json: async () => body
});
let ipCounter = 10;
const nextIp = () => "203.0.113." + (ipCounter++);

// ══ ITEM 1: phone on the Add New Client form ═════════════════════════════════
{
  const env = makeDb();
  const contacts = JSON.stringify([
    { name: "Ana", role: "Owner", phone: "+1 (813) 555-0100", whatsapp: "+1 (813) 555-0199", email: "ana@example.com" },
    { name: "Second", role: null, phone: "9999999999", whatsapp: null, email: null }
  ]);
  let r = await handlePostClients(req({ name: "Typed by hand", contacts }), env);
  let c = row(env, "SELECT * FROM clients WHERE id = ?", r.body.client_id);
  t("create: the primary contact phone lands in clients.phone, exactly as typed", c.phone, "+1 (813) 555-0100");
  t("create: the primary contact whatsapp lands in clients.whatsapp", c.whatsapp, "+1 (813) 555-0199");
  t("create: clients.email is not touched", c.email, null);
  t("create: contacts JSON still saved as typed", c.contacts, contacts);

  r = await handlePostClients(req({ name: "No whatsapp", contacts: JSON.stringify([{ name: "B", phone: "8135550101", whatsapp: null, email: null }]) }), env);
  c = row(env, "SELECT phone, whatsapp FROM clients WHERE id = ?", r.body.client_id);
  t("create: a contact with no whatsapp leaves clients.whatsapp empty", [c.phone, c.whatsapp], ["8135550101", null]);

  r = await handlePostClients(req({ name: "Explicit", phone: "111", whatsapp: "222", contacts }), env);
  c = row(env, "SELECT phone, whatsapp FROM clients WHERE id = ?", r.body.client_id);
  t("create: a phone and whatsapp sent explicitly win over the contact", [c.phone, c.whatsapp], ["111", "222"]);

  r = await handlePostClients(req({ name: "No contacts" }), env);
  c = row(env, "SELECT phone, whatsapp, contacts FROM clients WHERE id = ?", r.body.client_id);
  t("create: no contacts means no phone (as before)", [c.phone, c.whatsapp, c.contacts], [null, null, null]);

  r = await handlePostClients(req({ name: "Bad json", contacts: "{not json" }), env);
  c = row(env, "SELECT phone FROM clients WHERE id = ?", r.body.client_id);
  t("create: contacts that are not valid JSON do not break creation", [r.ok, c.phone], [true, null]);

  r = await handlePostClients(req({ name: "First has no phone", contacts: JSON.stringify([{ name: "A", phone: null }, { name: "B", phone: "5551234567" }]) }), env);
  c = row(env, "SELECT phone FROM clients WHERE id = ?", r.body.client_id);
  t("create: only the FIRST contact counts as the primary one", c.phone, null);
}

// The one-time fill (the exact statement run on the live database).
{
  const fillSql = readFileSync(here("scripts/fixtures/bs-round3-phone-fill.sql"), "utf8");
  const env = makeDb();
  const add = (id, o) => env.raw.prepare(
    "INSERT INTO clients (id, name, status, archived, phone, whatsapp, email, contacts) VALUES (?, ?, 'active', ?, ?, ?, ?, ?)"
  ).run(id, "N " + id, o.archived || 0, o.phone ?? null, o.whatsapp ?? null, o.email ?? null, o.contacts ?? null);
  const one = (extra) => JSON.stringify([Object.assign({ name: "A", phone: null, whatsapp: null, email: "keep@example.com" }, extra)]);
  add("fill1", { contacts: one({ phone: "8135935495" }) });
  add("fill2", { contacts: one({ phone: "+55 37 8851-8391", whatsapp: "+55 37 8851-8391" }) });
  add("fill3", { contacts: one({ phone: "‪+1 (240) 429‑8724‬" }) });
  add("hasPhone", { phone: "keep-phone", contacts: one({ phone: "1111111111" }) });
  add("hasWa", { whatsapp: "keep-wa", contacts: one({ phone: "2222222222" }) });
  add("noPhone", { contacts: one({ phone: null }) });
  add("blankPhone", { contacts: one({ phone: "   " }) });
  add("noContacts", {});
  add("archived", { archived: 1, contacts: one({ phone: "3333333333" }) });
  add("secondOnly", { contacts: JSON.stringify([{ name: "A", phone: null }, { name: "B", phone: "4444444444" }]) });
  const before = env.raw.prepare("SELECT id, phone, whatsapp, email FROM clients ORDER BY id").all();
  env.raw.exec(fillSql);
  const after = env.raw.prepare("SELECT id, phone, whatsapp, email FROM clients ORDER BY id").all();
  const changed = after.filter((a, i) => JSON.stringify(a) !== JSON.stringify(before[i])).map((a) => a.id);
  t("fill: exactly the eligible clients changed", changed, ["fill1", "fill2", "fill3"]);
  const get = (id) => after.find((x) => x.id === id);
  t("fill: the phone is copied exactly as stored", get("fill1").phone, "8135935495");
  t("fill: invisible characters are copied exactly as stored", get("fill3").phone, "‪+1 (240) 429‑8724‬");
  t("fill: a contact whatsapp fills an empty whatsapp", [get("fill2").phone, get("fill2").whatsapp], ["+55 37 8851-8391", "+55 37 8851-8391"]);
  t("fill: a contact without whatsapp leaves it empty", get("fill1").whatsapp, null);
  t("fill: a non-empty phone is never overwritten", get("hasPhone").phone, "keep-phone");
  t("fill: a non-empty whatsapp is never overwritten (and the phone is not filled)", [get("hasWa").phone, get("hasWa").whatsapp], [null, "keep-wa"]);
  t("fill: an archived client is skipped", get("archived").phone, null);
  t("fill: only the first contact is read", get("secondOnly").phone, null);
  t("fill: email is never filled", [get("fill1").email, get("fill2").email], [null, null]);
  const again = JSON.stringify(env.raw.prepare("SELECT id, phone, whatsapp FROM clients ORDER BY id").all());
  env.raw.exec(fillSql);
  t("fill: running it a second time changes nothing", JSON.stringify(env.raw.prepare("SELECT id, phone, whatsapp FROM clients ORDER BY id").all()), again);
}

// ══ ITEM 3: partner start stage and the public landing ═══════════════════════
{
  const env = makeDb();
  const addPartner = (id, plan, slug, stage) => env.raw.prepare(
    "INSERT INTO apex_partners (id, name, referral_slug, plan, start_stage) VALUES (?, ?, ?, ?, ?)"
  ).run(id, "Partner " + id, slug, plan, stage ?? null);
  addPartner("pbw", "business_system", "bbbbbbbbbbbb", "Lista de espera");
  addPartner("pbl", "business_system", "cccccccccccc", null);
  addPartner("pbx", "business_system", "dddddddddddd", "Stage that does not exist");
  addPartner("pcn", "consulting", "eeeeeeeeeeee", null);

  t("migration: start_stage exists and is NULL for an existing partner", row(env, "SELECT start_stage FROM apex_partners WHERE id = 'pcn'").start_stage, null);

  // (b) validation and defaults
  let r = await handlePostApexPartner(req({ name: "BS new", plan: "business_system" }), env);
  t("partner create: a new Business System partner defaults to Lista de espera", r.body.partner.start_stage, "Lista de espera");
  r = await handlePostApexPartner(req({ name: "BS lead", plan: "business_system", start_stage: "Lead" }), env);
  t("partner create: a chosen stage is stored", r.body.partner.start_stage, "Lead");
  r = await handlePostApexPartner(req({ name: "BS bad", plan: "business_system", start_stage: "Raio X enviado" }), env);
  t("partner create: a consulting-only stage is refused with 400", [r.ok, r.status], [false, 400]);
  r = await handlePostApexPartner(req({ name: "BS junk", plan: "business_system", start_stage: "x'; DROP TABLE clients;--" }), env);
  t("partner create: a junk stage is refused with 400", [r.ok, r.status], [false, 400]);
  r = await handlePostApexPartner(req({ name: "Consulting new", start_stage: "Lista de espera" }), env);
  t("partner create: a consulting partner never stores a start stage", [r.body.partner.plan, r.body.partner.start_stage], ["consulting", null]);
  r = await handlePutApexPartner("pbl", req({ start_stage: "Link enviado" }), env);
  t("partner update: a Business System partner can change its stage", r.body.partner.start_stage, "Link enviado");
  r = await handlePutApexPartner("pbl", req({ start_stage: "Agendamento" }), env);
  t("partner update: an invalid stage is refused with 400", [r.ok, r.status], [false, 400]);
  t("partner update: and the stored value did not change", row(env, "SELECT start_stage FROM apex_partners WHERE id = 'pbl'").start_stage, "Link enviado");
  r = await handlePutApexPartner("pbl", req({ start_stage: "" }), env);
  t("partner update: empty means NULL (the stage Lead)", r.body.partner.start_stage, null);
  r = await handlePutApexPartner("pcn", req({ start_stage: "Lista de espera", name: "Renamed" }), env);
  t("partner update: a consulting partner keeps NULL and the rest still saves", [r.body.partner.start_stage, r.body.partner.name], [null, "Renamed"]);
  const listB = await handleGetApexPartners(req({}, "https://apex-api.example/api/apex-partners?plan=business_system"), env);
  t("partner list: the Business System list carries start_stage", listB.body.partners.every((p) => "start_stage" in p), true);

  // (e, f) the info route
  let info = await handleGetApexReferralInfo("bbbbbbbbbbbb", req({}), env);
  t("info: a Business System link says to show the company fields", info.body.show_company_fields, true);
  info = await handleGetApexReferralInfo("eeeeeeeeeeee", req({}), env);
  t("info: a consulting link does not", info.body.show_company_fields, false);
  t("info: no id and no plan name leave the server", Object.keys(info.body).sort(), ["has_hero", "partner_name", "show_company_fields"]);

  const post = (slug, body) => handlePostApexReferralLead(slug, req(Object.assign({ elapsed_ms: 9000 }, body), "https://apex-api.example/api", nextIp()), env);
  const lastClient = (partnerId) => row(env, "SELECT * FROM clients WHERE referred_by_partner_id = ? ORDER BY rowid DESC LIMIT 1", partnerId);

  // (d, g) Business System link at Lista de espera, with company, sector and note
  r = await post("bbbbbbbbbbbb", {
    nome: "Maria Silva", telefone: "+1 (407) 555-0123", email: "maria@example.com",
    empresa: "  Silva Cleaning LLC ", setor: "Cleaning", nota: "Wants a call\nafter 5 pm"
  });
  t("landing BS: answers created with no data", r, { ok: true, body: { created: true } });
  let c = lastClient("pbw");
  t("landing BS: the lead is created at the partner's start stage, warm, partner source",
    [c.plan, c.status, c.lead_stage, c.lead_temperature, c.source_type], ["business_system", "lead", "Lista de espera", "warm", "partner"]);
  t("landing BS: Lista de espera is stamped like the stage-change route", [!!c.bs_waitlist_at, c.bs_link_sent_at, c.stage_change_source], [true, null, "partner_link"]);
  t("landing BS: the company becomes the client name", c.name, "Silva Cleaning LLC");
  t("landing BS: the person becomes the primary contact with phone and email",
    JSON.parse(c.contacts), [{ name: "Maria Silva", role: null, phone: "+1 (407) 555-0123", whatsapp: null, email: "maria@example.com" }]);
  t("landing BS: the phone is also in clients.phone", c.phone, "+1 (407) 555-0123");
  t("landing BS: the sector goes to industry", c.industry, "Cleaning");
  t("landing BS: both switches start OFF", [c.daily_log_enabled, c.goals_enabled], [0, 0]);
  const notes = env.raw.prepare("SELECT content, created_by FROM client_notes WHERE client_id = ?").all(c.id);
  t("landing BS: the note is saved in the Notes table, signed Partner link", notes, [{ content: "Wants a call\nafter 5 pm", created_by: "Partner link" }]);

  // no company: the person's name is the client name, no contacts, as today
  r = await post("bbbbbbbbbbbb", { nome: "Joao Souza", telefone: "4075550111" });
  c = lastClient("pbw");
  t("landing BS: with no company the person's name is the client name", [c.name, c.contacts, c.industry], ["Joao Souza", null, null]);
  t("landing BS: an empty note creates no note", row(env, "SELECT COUNT(*) AS n FROM client_notes WHERE client_id = ?", c.id).n, 0);
  r = await post("bbbbbbbbbbbb", { nome: "Blank Note", nota: "  \n\t  " });
  c = lastClient("pbw");
  t("landing BS: a blank note creates no note", row(env, "SELECT COUNT(*) AS n FROM client_notes WHERE client_id = ?", c.id).n, 0);

  // start stage NULL and invalid stored value read as Lead, no stamp
  r = await post("cccccccccccc", { nome: "Null Stage", empresa: "Co" });
  c = lastClient("pbl");
  t("landing BS: a partner with no start stage creates at Lead, no waitlist stamp", [c.lead_stage, c.bs_waitlist_at, c.stage_change_source], ["Lead", null, null]);
  r = await post("dddddddddddd", { nome: "Bad Stage" });
  c = lastClient("pbx");
  t("landing BS: a stored value that is not valid reads as Lead", c.lead_stage, "Lead");
  await handlePutApexPartner("pbl", req({ start_stage: "Link enviado" }), env);
  r = await post("cccccccccccc", { nome: "Link Stage" });
  c = lastClient("pbl");
  t("landing BS: Link enviado is stamped with its own column", [c.lead_stage, c.bs_waitlist_at, !!c.bs_link_sent_at], ["Link enviado", null, true]);

  // sanitising and length limits
  const long = "x".repeat(5000);
  r = await post("bbbbbbbbbbbb", { nome: "Limits", empresa: "Co\u0000mpany\u0007 Name" + long, setor: "Sec\u0001tor" + long, nota: "N\u0000ote\u001b with\u0007 text" + long });
  c = lastClient("pbw");
  t("landing BS: control characters are stripped and lengths are limited",
    [c.name.length, /[\u0000-\u001f]/.test(c.name), c.industry.length, /[\u0000-\u001f]/.test(c.industry)], [200, false, 100, false]);
  const nb = row(env, "SELECT content FROM client_notes WHERE client_id = ?", c.id).content;
  t("landing BS: the note keeps its text, loses control characters, is limited to 1000", [nb.length, /[\u0000-\u0009\u000b-\u001f]/.test(nb), nb.indexOf("Note with text") === 0], [1000, false, true]);
  r = await post("bbbbbbbbbbbb", { nome: "Types", empresa: { a: 1 }, setor: 12, nota: ["x"] });
  c = lastClient("pbw");
  t("landing BS: values that are not strings are ignored", [r.ok, c.name, c.industry], [true, "Types", null]);
  t("landing BS: nothing is put in a note for them", row(env, "SELECT COUNT(*) AS n FROM client_notes WHERE client_id = ?", c.id).n, 0);

  // consulting link unchanged
  r = await post("eeeeeeeeeeee", { nome: "Carlos", telefone: "4075550999", email: "c@example.com", empresa: "Ignored Co", setor: "Ignored", nota: "Ignored note" });
  c = lastClient("pcn");
  t("landing consulting: stage Lead, warm, plan consulting",
    [c.plan, c.status, c.lead_stage, c.lead_temperature, c.source_type, c.bs_waitlist_at], ["consulting", "lead", "Lead", "warm", "partner", null]);
  t("landing consulting: company, sector and note are ignored", [c.name, c.industry, c.contacts], ["Carlos", null, null]);
  t("landing consulting: no note is created", row(env, "SELECT COUNT(*) AS n FROM client_notes WHERE client_id = ?", c.id).n, 0);
  t("landing consulting: switches untouched (default on)", [c.daily_log_enabled, c.goals_enabled], [1, 1]);
  t("landing consulting: phone and email saved as today", [c.phone, c.email], ["4075550999", "c@example.com"]);

  // validation as before
  r = await post("bbbbbbbbbbbb", { telefone: "4075550111" });
  t("landing: a missing name is still refused", [r.ok, r.status], [false, 400]);
  r = await post("bbbbbbbbbbbb", { nome: "Bot", website: "http://spam" });
  t("landing: the honeypot still answers a fake success without a lead",
    [r.ok, row(env, "SELECT COUNT(*) AS n FROM clients WHERE name = 'Bot'").n], [true, 0]);
}

// ══ ITEM 4: the Growth switch starts off ════════════════════════════════════
{
  const env = makeDb();
  let r = await handlePostClients(req({ name: "BS by hand", plan: "business_system" }), env);
  let c = row(env, "SELECT daily_log_enabled, goals_enabled, goals_enabled_set_by, goals_before_pause FROM clients WHERE id = ?", r.body.client_id);
  t("create (business_system): both switches off, stamped, no pause memory", [c.daily_log_enabled, c.goals_enabled, c.goals_enabled_set_by, c.goals_before_pause], [0, 0, "Alice", null]);
  r = await handlePostClients(req({ name: "Consulting by hand" }), env);
  c = row(env, "SELECT daily_log_enabled, goals_enabled FROM clients WHERE id = ?", r.body.client_id);
  t("create (consulting): both switches stay on", [c.daily_log_enabled, c.goals_enabled], [1, 1]);

  env.raw.prepare("INSERT INTO clients (id, name, status, plan) VALUES ('grad', 'Graduate', 'active', 'consulting')").run();
  r = await handlePostClientPlan("grad", req({ plan: "business_system" }), env);
  c = row(env, "SELECT plan, daily_log_enabled, goals_enabled, goals_before_pause FROM clients WHERE id = 'grad'");
  t("graduate to Business System: both switches off and pause memory empty", [r.ok, c.plan, c.daily_log_enabled, c.goals_enabled, c.goals_before_pause], [true, "business_system", 0, 0, null]);
  r = await handlePostClientPlan("grad", req({ plan: "consulting" }), env);
  c = row(env, "SELECT plan, daily_log_enabled, goals_enabled FROM clients WHERE id = 'grad'");
  t("moving back to consulting touches nothing else", [c.plan, c.daily_log_enabled, c.goals_enabled], ["consulting", 0, 0]);

  // bsActivateLead leaves both off, even when one was on
  env.raw.prepare("INSERT INTO clients (id, name, status, lead_stage, plan, daily_log_enabled, goals_enabled) VALUES ('act1', 'Activate on', 'lead', 'Link enviado', 'business_system', 1, 1)").run();
  env.raw.prepare("INSERT INTO clients (id, name, status, lead_stage, plan, daily_log_enabled, goals_enabled) VALUES ('act2', 'Activate off', 'lead', 'Link enviado', 'business_system', 0, 0)").run();
  for (const id of ["act1", "act2"]) {
    const a = await bsActivateLead(env, id, { source: "manual", actor: "Alice" });
    c = row(env, "SELECT status, daily_log_enabled, goals_enabled, daily_log_before_pause, goals_before_pause FROM clients WHERE id = ?", id);
    t("bsActivateLead (" + id + "): active, both switches OFF, no pause memory",
      [a.ok, c.status, c.daily_log_enabled, c.goals_enabled, c.daily_log_before_pause, c.goals_before_pause], [true, "active", 0, 0, null, null]);
  }
  // consulting conversion is untouched
  env.raw.prepare("INSERT INTO clients (id, name, status, lead_stage, plan) VALUES ('cons', 'Consulting lead', 'lead', 'Lead', 'consulting')").run();
  r = await handlePostLeadOutcome("cons", req({ outcome: "converted", package: "Sprint" }), env);
  c = row(env, "SELECT status, daily_log_enabled, goals_enabled FROM clients WHERE id = 'cons'");
  t("consulting conversion: switches stay on", [r.ok, c.status, c.daily_log_enabled, c.goals_enabled], [true, "active", 1, 1]);

  // the one-time update uses the same helper's statement
  env.raw.prepare("INSERT INTO clients (id, name, status, plan, goals_enabled, goals_before_pause) VALUES ('one', 'One time', 'lead', 'business_system', 1, 1)").run();
  const changedFirst = await clientSetSwitchOff(env, "one", "goals_enabled", { display_name: "system" });
  const changedAgain = await clientSetSwitchOff(env, "one", "goals_enabled", { display_name: "system" });
  c = row(env, "SELECT goals_enabled, goals_enabled_set_by, goals_before_pause FROM clients WHERE id = 'one'");
  t("helper: turns goals off, stamps it and clears the pause memory", [changedFirst, c.goals_enabled, c.goals_enabled_set_by, c.goals_before_pause], [true, 0, "system", null]);
  t("helper: an already-off switch is left alone", changedAgain, false);
}

// ══ ITEM 5: stage on the Add New Client form, archived links ════════════════
{
  const env = makeDb();
  let r = await handlePostClients(req({ name: "BS waitlist", plan: "business_system", status: "lead", lead_stage: "Lista de espera" }), env);
  let c = row(env, "SELECT * FROM clients WHERE id = ?", r.body.client_id);
  t("create BS lead: the chosen stage is saved and the waitlist stamp is set",
    [c.status, c.lead_stage, !!c.bs_waitlist_at, !!c.stage_changed_at, c.stage_change_source], ["lead", "Lista de espera", true, true, "manual"]);
  r = await handlePostClients(req({ name: "BS link", plan: "business_system", status: "lead", lead_stage: "Link enviado" }), env);
  c = row(env, "SELECT lead_stage, bs_waitlist_at, bs_link_sent_at FROM clients WHERE id = ?", r.body.client_id);
  t("create BS lead: Link enviado stamps its own column", [c.lead_stage, c.bs_waitlist_at, !!c.bs_link_sent_at], ["Link enviado", null, true]);
  r = await handlePostClients(req({ name: "BS none", plan: "business_system", status: "lead" }), env);
  c = row(env, "SELECT lead_stage, bs_waitlist_at FROM clients WHERE id = ?", r.body.client_id);
  t("create BS lead: no stage sent means Lead, no stamp", [c.lead_stage, c.bs_waitlist_at], ["Lead", null]);
  r = await handlePostClients(req({ name: "BS bad", plan: "business_system", status: "lead", lead_stage: "Raio X enviado" }), env);
  t("create BS lead: a stage of the other list is refused with 400", [r.ok, r.status], [false, 400]);
  t("create BS lead: and no client was written for it", row(env, "SELECT COUNT(*) AS n FROM clients WHERE name = 'BS bad'").n, 0);
  r = await handlePostClients(req({ name: "BS active", plan: "business_system", status: "active", lead_stage: "Lista de espera" }), env);
  c = row(env, "SELECT status, lead_stage, bs_waitlist_at FROM clients WHERE id = ?", r.body.client_id);
  t("create BS (status active): the stage is ignored", [c.status, c.lead_stage, c.bs_waitlist_at], ["active", null, null]);
  r = await handlePostClients(req({ name: "Cons lead", status: "lead", lead_stage: "Lista de espera" }), env);
  c = row(env, "SELECT lead_stage, bs_waitlist_at FROM clients WHERE id = ?", r.body.client_id);
  t("create consulting lead: a stage sent is ignored, it starts at Lead", [c.lead_stage, c.bs_waitlist_at], ["Lead", null]);

  // archived links
  env.raw.exec("INSERT INTO clients (id, name, status, archived) VALUES ('live', 'Live client', 'active', 0)");
  env.raw.exec("INSERT INTO clients (id, name, status, archived) VALUES ('gone', 'Archived client', 'active', 1)");
  env.raw.exec("INSERT INTO gm_partners (id, client_id, name, referral_slug) VALUES ('gpl', 'live', 'P live', 'ffffffffffff')");
  env.raw.exec("INSERT INTO gm_partners (id, client_id, name, referral_slug) VALUES ('gpg', 'gone', 'P gone', 'gggggggggggg')");
  const live = await gmPartnerBySlug(env, "ffffffffffff");
  t("link lookup: an active client's link is found, unchanged", [live && live.id, live && live.client_id, live && live.business_name], ["gpl", "live", "Live client"]);
  t("link lookup: an archived client's link is not found", await gmPartnerBySlug(env, "gggggggggggg"), null);
  r = await handlePostReferralLead("gggggggggggg", req({ nome: "Visitor", elapsed_ms: 9000 }), env);
  t("referral POST: an archived client's link answers 404", [r.ok, r.status], [false, 404]);
  t("referral POST: it left no hit and no lead", row(env, "SELECT COUNT(*) AS n FROM gm_referral_hits").n, 0);
  r = await handlePostReferralLead("zzzzzzzzzzzz", req({ nome: "Visitor", elapsed_ms: 9000 }), env);
  t("referral POST: an unknown link answers the same 404", [r.ok, r.status], [false, 404]);
  env.raw.exec("UPDATE clients SET archived = 0 WHERE id = 'gone'");
  t("link lookup: the same link works again when the client is not archived", (await gmPartnerBySlug(env, "gggggggggggg") || {}).id, "gpg");
}

// ══ The pages ════════════════════════════════════════════════════════════════
{
  const clientHtml = readFileSync(here("client.html"), "utf8");
  const clientsHtml = readFileSync(here("clients.html"), "utf8");
  const refHtml = readFileSync(here("apex-referral.html"), "utf8");
  const hidden = clientHtml.match(/var BS_HIDDEN_CARDS = \[([^\]]*)\]/);
  t("client.html: the Business System hidden cards are exactly the nine named",
    hidden ? hidden[1].replace(/\s+/g, " ").match(/"[A-Za-z]+"/g).map((x) => x.replace(/"/g, "")).sort() : null,
    ["apexContract", "assessments", "clientTasks", "consultantTasks", "contractStatus", "docs", "resources", "sessions", "vendors"]);
  t("client.html: Entry Week follows the daily log of a Business System client", clientHtml.indexOf("weekly.hidden = Number(clientData.daily_log_enabled) === 0") > 0, true);
  t("client.html: the checklist wrapper exists and is hidden for Business System", clientHtml.indexOf('id="leadChecklistWrap"') > 0 && clientHtml.indexOf('getElementById("leadChecklistWrap")') > 0, true);
  const keep = ["sec-dp", "sec-growth", "sec-invoices", "sec-payment", "sec-overview", "sec-contacts", "sec-notes", "sec-bsPlan", "sec-portalAccess", "sec-sellerLogins", "sec-loginSecurity"];
  const fn = clientHtml.slice(clientHtml.indexOf("function applyBsProfileCards"), clientHtml.indexOf("function renderBsPlanCard"));
  t("client.html: none of the kept cards is touched by the cleanup", keep.filter((k) => fn.indexOf(k) >= 0), []);
  t("client.html: the cleanup reads the client's own plan, not the side switch", /apexSide/.test(fn) || /apexSide/.test(clientHtml.slice(clientHtml.indexOf("function clientIsBs"), clientHtml.indexOf("function applyBsProfileCards"))), false);
  t("clients.html: the partner Start stage uses the shared stage list", /stageList = leadStagesForSide\(\)/.test(clientsHtml), true);
  t("clients.html: the Add New Client Stage control exists", /id="ncStage"/.test(clientsHtml) && /payload\.lead_stage = ncStageSel\.value/.test(clientsHtml), true);
  t("apex-referral.html: the three labels are exactly Nome da empresa, Setor, Nota",
    [...refHtml.matchAll(/<label for="(fEmpresa|fSetor|fNota)">([^<]*)<\/label>/g)].map((m) => m[2]), ["Nome da empresa", "Setor", "Nota"]);
  t("apex-referral.html: the fields stay hidden unless the info answer says so", /bsBox\.hidden = !d\.show_company_fields/.test(refHtml) && /id="bsFields" hidden/.test(refHtml), true);
  t("apex-referral.html: their values go in the request body, never the address", /payload\.empresa/.test(refHtml) && !/\?[^"']*empresa=/.test(refHtml), true);
}

console.log(fails ? "\n" + fails + " FAILED" : "\nAll passed");
process.exit(fails ? 1 : 0);
