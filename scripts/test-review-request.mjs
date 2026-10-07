// Job 37: ask for a Google review from the project.
// The REAL Worker functions (cut out of worker/index.js) on an in-memory
// SQLite, plus the page's own copy of the link rule from gm.js.
// No network, no production database.
//
//   node scripts/test-review-request.mjs
import { readFileSync } from "node:fs";
import { makeDb, build, baseStubs, req, fnSrc, workerSrc } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };
const root = new URL("../", import.meta.url);
const gmSrc = readFileSync(new URL("gm.js", root), "utf8");
const migration = readFileSync(new URL("migrations/google_review_link.sql", root), "utf8");

const FNS = ["gmReviewLinkParse", "gmReviewMessage", "gmReviewLinkColumnReady", "gmReviewLinkRead", "gmReviewLast", "gmReviewJobFor", "gmReviewPayload",
  "handleGetGmJobReviewRequest", "handlePostGmJobReviewRequest", "gmOwnedRow", "gmInvSellerGuardJob", "gmSellerLeadGuard", "sellerCanActOnLead", "sessionSellerName",
  "gmStr", "gmNum", "gmRunUpdate", "gmDocHexColor", "gmDocParseLicenses", "gmDocParsePaymentMethods", "gmDocParseLateFeePct", "gmDocParseSchedulePresets", "gmDocScheduleStepsError",
  "gmDocSettingsOwnerOnly", "handlePutGmDocSettings", "clientRequestAllowed", "sellerRequestAllowed",
  // Job 40: the settings save also reads the license-not-required columns.
  "gmLicenseNotRequiredColumnReady", "gmLicenseNotRequiredRead"];
const VARS = ["GM_REVIEW_LINK_HOSTS", "GM_REVIEW_LINK_BAD_PT", "GM_REVIEW_LINK_BAD_EN", "GM_SEND_CHANNELS", "GM_DOC_SETTINGS_FIELDS", "GM_DOC_PAYMENT_METHODS", "GM_DOC_LATE_FEE_MAX_PCT", "GM_DOC_LATE_FEE_CAP_MESSAGE", "GM_LICENSE_NEEDED_PT", "GM_LICENSE_NEEDED_EN"];

const OWNER = { role: "client", client_id: "c1", login_role: "client", display_name: "ZETA POOLS", username: "zeta" };
const MARIA = { role: "client", client_id: "c1", login_role: "seller", seller_name: "Maria Silva", display_name: "Maria Silva", username: "maria" };
const OTHER = { role: "client", client_id: "c1", login_role: "seller", seller_name: "Joao Costa", display_name: "Joao Costa", username: "joao" };
const RIVAL = { role: "client", client_id: "c2", login_role: "client", display_name: "OMEGA ROOFING", username: "omega" };
let user = OWNER;

// migrated: run the real migration file. dropLog: the table is not there.
function world(opts) {
  opts = opts || {};
  const d = makeDb();
  d.raw.exec("CREATE TABLE gm_doc_settings (client_id TEXT PRIMARY KEY, brand_primary TEXT, brand_accent TEXT, legal_name TEXT, address TEXT, phone TEXT, email TEXT, license_numbers TEXT, estimate_valid_days INTEGER, default_terms_days INTEGER, payment_methods_json TEXT, late_fee_annual_pct REAL, late_fee_grace_days INTEGER, schedule_presets_json TEXT, estimate_message TEXT, invoice_message TEXT, receipt_message TEXT, contract_message TEXT, setup_completed_at TEXT, updated_at TEXT, updated_by TEXT)");
  d.raw.exec("CREATE TABLE gm_doc_settings_history (id TEXT PRIMARY KEY, client_id TEXT, field TEXT, old_value TEXT, new_value TEXT, actor TEXT, created_at TEXT DEFAULT (datetime('now')))");
  d.raw.exec("CREATE TABLE gm_config (client_id TEXT PRIMARY KEY, target_margin REAL)");
  d.raw.exec("CREATE TABLE gm_leads (id TEXT PRIMARY KEY, client_id TEXT, cliente TEXT, telefone TEXT, vendedor TEXT, vendedor_secundario TEXT)");
  d.raw.exec("CREATE TABLE gm_jobs (id TEXT PRIMARY KEY, client_id TEXT, obra TEXT, lead_id TEXT)");
  if (opts.migrated !== false) {
    migration.replace(/^\s*--[^\n]*$/gm, "").split(";").forEach((stmt) => { if (stmt.trim()) { d.raw.exec(stmt); } });
  }
  if (opts.dropLog) { d.raw.exec("DROP TABLE IF EXISTS gm_send_log"); }
  d.raw.prepare("INSERT INTO clients (id, name, language) VALUES ('c1', 'Zeta Pools', ?), ('c2', 'Omega Roofing', 'en')").run(opts.language || "en");
  d.raw.prepare("INSERT INTO gm_leads (id, client_id, cliente, telefone, vendedor) VALUES ('l1', 'c1', 'Ana Souza', '4075550142', 'Maria Silva'), ('l2', 'c1', '', '', NULL), ('l9', 'c2', 'Rival Customer', '3055550100', NULL)").run();
  d.raw.prepare("INSERT INTO gm_jobs (id, client_id, obra, lead_id) VALUES ('j1', 'c1', 'Ana pool', 'l1'), ('j2', 'c1', 'No name', 'l2'), ('j3', 'c1', 'Hand made', NULL), ('j9', 'c2', 'Rival job', 'l9')").run();
  if (opts.link !== undefined) {
    d.raw.prepare("INSERT INTO gm_doc_settings (client_id, legal_name, license_numbers, setup_completed_at) VALUES ('c1', 'Zeta Pools LLC', '[\"CPC123\"]', '2026-09-01 10:00:00')").run();
    if (opts.migrated !== false) { d.raw.prepare("UPDATE gm_doc_settings SET google_review_link = ? WHERE client_id = 'c1'").run(opts.link); }
  }
  const stubs = Object.assign({}, baseStubs, {
    authenticate: async () => user,
    requireClientAccess: (u, id) => !!u && (u.role === "developer" || (u.role === "client" && u.client_id === id)),
    jsonErr2: (pt, en, status) => ({ status: status || 400, error: en, error_pt: pt, error_en: en }),
    gmFirstName: (s) => String(s || "").trim().split(/\s+/)[0] || "",
    gmDocSettingsRow: async (env, id) => { const r = d.q("SELECT legal_name FROM gm_doc_settings WHERE client_id = ?", id)[0]; return { legal_name: (r && r.legal_name) || null }; },
    gmDocParseJsonObject: (v, fb) => fb
  });
  const F = build(FNS, VARS, stubs);
  return { d, env: { DB: d.DB }, F };
}
const base = world();
const P = (v) => base.F.gmReviewLinkParse(v);
// The page's copy of the rule, cut out of gm.js.
const pageOk = new Function("GM_REVIEW_LINK_HOSTS", fnSrc("gmReviewLinkOk", gmSrc) + "\nreturn gmReviewLinkOk;")(["google.com", "g.page", "goo.gl"]);

// ── the link rule: accepted
[
  ["https://g.page/r/CabcDEF123/review", "g.page"],
  ["https://business.g.page/r/XXXX/review", "a subdomain of g.page"],
  ["https://google.com/maps/place/x", "google.com"],
  ["https://search.google.com/local/writereview?placeid=ChIJxxxx", "search.google.com (a subdomain of google.com)"],
  ["https://www.google.com/search?q=zeta#lrd=0x1:0x2,3", "www.google.com"],
  ["https://goo.gl/maps/AbCd", "goo.gl"],
  ["https://maps.app.goo.gl/AbCdEf", "maps.app.goo.gl (a subdomain of goo.gl)"],
  ["  https://g.page/r/XXXX/review  ", "spaces around a good link are trimmed"]
].forEach(function (c) {
  const r = P(c[0]);
  ok(!r.error && typeof r.value === "string" && r.value.indexOf("https://") === 0 && pageOk(c[0]) === true, "accepted: " + c[1]);
});
ok(P("").value === null && !P("").error && P("   ").value === null && P(null).value === null && pageOk("") === true, "empty is allowed and clears the link");

// ── the link rule: refused
[
  ["http://g.page/r/XXXX/review", "http (not https)"],
  ["https://google.com.evil.com/review", "a look-alike host (google.com.evil.com)"],
  ["javascript:alert(1)", "javascript:"],
  ["https://evilgoogle.com/review", "a host that only ends in the letters google.com"],
  ["https://notg.page/r/x", "a host that only ends in the letters g.page"],
  ["https://google.com@evil.com/review", "a name before @ hiding the real host"],
  ["https://evil.com/?u=https://g.page/r/x/review", "a Google link inside another site's address"],
  ["https://evil.com/g.page/r/x", "a Google host name in the path only"],
  ["g.page/r/XXXX/review", "no https:// at all"],
  ["data:text/html,<script>1</script>", "data:"],
  ["https://google.com:8443/x", "a port"],
  ["https://yelp.com/biz/zeta", "another review site"],
  ["https://g.page/r/x y", "a space inside"],
  ["https://g.page\\@evil.com/x", "a backslash"],
  ["just some words", "plain text"]
].forEach(function (c) {
  ok(P(c[0]).error === true && pageOk(c[0]) === false, "refused: " + c[1]);
});
ok(P(12345).error === true && P({}).error === true, "refused: a value that is not text");

// ── the message
const M = base.F.gmReviewMessage;
const L = "https://g.page/r/XXXX/review";
ok(M("en", "Ana", "Zeta Pools LLC", L) === "Hi Ana, thank you for choosing Zeta Pools LLC. Would you share your experience in a Google review? It takes about a minute: https://g.page/r/XXXX/review", "English with a first name");
ok(M("en", "", "Zeta Pools LLC", L) === "Hi, thank you for choosing Zeta Pools LLC. Would you share your experience in a Google review? It takes about a minute: https://g.page/r/XXXX/review", "English with no first name: the name and its comma go cleanly");
ok(M("pt", "Ana", "Zeta Pools LLC", L) === "Ol\u00e1 Ana, obrigado por escolher a Zeta Pools LLC. Voc\u00ea pode contar como foi a sua experi\u00eancia em uma avalia\u00e7\u00e3o no Google? Leva cerca de um minuto: https://g.page/r/XXXX/review", "Portuguese with a first name");
ok(M("pt", null, "Zeta Pools LLC", L) === "Ol\u00e1, obrigado por escolher a Zeta Pools LLC. Voc\u00ea pode contar como foi a sua experi\u00eancia em uma avalia\u00e7\u00e3o no Google? Leva cerca de um minuto: https://g.page/r/XXXX/review", "Portuguese with no first name");
ok(M("en", "   ", "Zeta", L).indexOf("Hi, thank") === 0, "a first name of only spaces counts as none");
["en", "pt"].forEach(function (lang) {
  const t = M(lang, "Ana", "Zeta", L).toLowerCase();
  ok(!/happy|satisf|feliz|5 star|five star|cinco estrelas|5 estrelas|\u2605/.test(t), "the " + lang + " wording is neutral (no \"happy\", no stars)");
});

// ── GET: the owner with a saved link
{
  user = OWNER;
  const w = world({ link: L });
  const r = await w.F.handleGetGmJobReviewRequest("c1", "j1", req(), w.env);
  ok(r.status === 200 && r.data.has_link === true && r.data.link === L, "owner: the saved link is returned");
  ok(r.data.message === M("en", "Ana", "Zeta Pools LLC", L) && r.data.phone === "4075550142", "the message has the customer's first name, the business's legal name and the link; the phone is the lead's");
  ok(r.data.last === null, "no press yet: no \"Review requested\" line");
  const r2 = await w.F.handleGetGmJobReviewRequest("c1", "j2", req(), w.env);
  ok(r2.status === 200 && r2.data.message.indexOf("Hi, thank you for choosing Zeta Pools LLC.") === 0, "a lead with no name: \"Hi, thank you ...\"");
  const r3 = await w.F.handleGetGmJobReviewRequest("c1", "j3", req(), w.env);
  ok(r3.status === 200 && r3.data.has_link === true && r3.data.phone === null && r3.data.message.indexOf("Hi, thank") === 0, "owner: a project with no lead still gets the message (no name, no phone)");
}
{
  user = OWNER;
  const w = world({ link: L, language: "pt" });
  const r = await w.F.handleGetGmJobReviewRequest("c1", "j1", req(), w.env);
  ok(r.data.language === "pt" && r.data.message === M("pt", "Ana", "Zeta Pools LLC", L), "a business whose customer language is pt gets the Portuguese message (the contact card's rule)");
}

// ── who may
{
  const w = world({ link: L });
  user = MARIA;
  const mine = await w.F.handleGetGmJobReviewRequest("c1", "j1", req(), w.env);
  ok(mine.status === 200 && mine.data.link === L, "a salesperson on the project's lead gets the link");
  user = OTHER;
  const notMine = await w.F.handleGetGmJobReviewRequest("c1", "j1", req(), w.env);
  const notMinePost = await w.F.handlePostGmJobReviewRequest("c1", "j1", req({ channel: "whatsapp" }), w.env);
  ok(notMine.status === 403 && !notMine.data && notMinePost.status === 403, "a salesperson who is NOT on the lead is refused (no link, no row)");
  user = MARIA;
  const noLead = await w.F.handlePostGmJobReviewRequest("c1", "j3", req({ channel: "whatsapp" }), w.env);
  ok(noLead.status === 403, "a salesperson is refused on a project with no lead (the owner's own)");
  user = RIVAL;
  const cross = await w.F.handleGetGmJobReviewRequest("c1", "j1", req(), w.env);
  const crossPost = await w.F.handlePostGmJobReviewRequest("c1", "j1", req({ channel: "copy" }), w.env);
  ok(cross.status === 403 && crossPost.status === 403, "another business's login is refused");
  user = OWNER;
  const foreign = await w.F.handleGetGmJobReviewRequest("c1", "j9", req(), w.env);
  const foreignPost = await w.F.handlePostGmJobReviewRequest("c1", "j9", req({ channel: "copy" }), w.env);
  ok(foreign.status === 404 && foreignPost.status === 404, "a project of another business is not found");
  user = null;
  ok((await w.F.handleGetGmJobReviewRequest("c1", "j1", req(), w.env)).status === 401, "no session: refused");
  ok(w.d.q("SELECT COUNT(*) AS n FROM gm_send_log")[0].n === 0, "none of the refusals wrote a row");
}

// ── every press is one row; the last one is shown
{
  user = OWNER;
  const w = world({ link: L });
  const bad = await w.F.handlePostGmJobReviewRequest("c1", "j1", req({ channel: "email" }), w.env);
  const none = await w.F.handlePostGmJobReviewRequest("c1", "j1", req({}), w.env);
  ok(bad.status === 400 && none.status === 400 && w.d.q("SELECT COUNT(*) AS n FROM gm_send_log")[0].n === 0, "a channel that is not whatsapp / sms / copy is refused and writes nothing");
  const a = await w.F.handlePostGmJobReviewRequest("c1", "j1", req({ channel: "whatsapp" }), w.env);
  const row = w.d.q("SELECT * FROM gm_send_log")[0];
  ok(a.status === 200 && a.data.logged === true && row.kind === "review_request" && row.channel === "whatsapp" && row.client_id === "c1" && row.project_id === "j1" && row.lead_id === "l1", "a WhatsApp press writes one review_request row for the project and its lead");
  ok(row.actor_user_id === "zeta" && row.actor_name === "ZETA POOLS" && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(row.created_at), "the row says who pressed and when");
  ok(a.data.last && a.data.last.requested_by === "ZETA POOLS" && a.data.last.requested_at === row.created_at && a.data.last.channel === "whatsapp", "the answer carries the line: when and by whom");
  w.d.raw.prepare("UPDATE gm_send_log SET created_at = '2026-10-01 15:00:00'").run();
  user = MARIA;
  const b = await w.F.handlePostGmJobReviewRequest("c1", "j1", req({ channel: "sms", actor_name: "Somebody Else", client_id: "c2" }), w.env);
  ok(b.data.logged === true && w.d.q("SELECT COUNT(*) AS n FROM gm_send_log")[0].n === 2, "a second press is allowed and is a second row");
  ok(b.data.last.requested_by === "Maria Silva" && b.data.last.channel === "sms", "the line follows the most recent press, with the salesperson's real name (never a name from the request)");
  const c = await w.F.handlePostGmJobReviewRequest("c1", "j1", req({ channel: "copy" }), w.env);
  ok(c.data.logged === true && w.d.q("SELECT channel FROM gm_send_log ORDER BY rowid DESC LIMIT 1")[0].channel === "copy", "copy is a press too");
  user = OWNER;
  const g = await w.F.handleGetGmJobReviewRequest("c1", "j1", req(), w.env);
  ok(g.data.last.requested_by === "Maria Silva" && g.data.last.channel === "copy", "opening the project again shows the most recent press");
  const other = await w.F.handleGetGmJobReviewRequest("c1", "j2", req(), w.env);
  ok(other.data.last === null, "another project of the same business shows no line");
  ok(Object.keys(row).indexOf("reviewed") === -1 && !/review(ed)?_at|reviewed|status/i.test(Object.keys(row).join(",")), "the table has no \"reviewed\" status");
}

// ── no link saved: nothing is sent, nothing is recorded
{
  user = OWNER;
  const w = world({ link: null });
  const g = await w.F.handleGetGmJobReviewRequest("c1", "j1", req(), w.env);
  ok(g.status === 200 && g.data.has_link === false && g.data.link === null && g.data.message === null, "no link saved: the answer says so, with no message");
  const p = await w.F.handlePostGmJobReviewRequest("c1", "j1", req({ channel: "whatsapp" }), w.env);
  ok(p.status === 200 && p.data.logged === false && w.d.q("SELECT COUNT(*) AS n FROM gm_send_log")[0].n === 0, "a press with no link writes no row");
  const w0 = world();
  const g0 = await w0.F.handleGetGmJobReviewRequest("c1", "j1", req(), w0.env);
  ok(g0.status === 200 && g0.data.has_link === false, "a business that never saved any settings: no link, no error");
  const wBad = world({ link: "https://google.com.evil.com/x" });
  const gBad = await wBad.F.handleGetGmJobReviewRequest("c1", "j1", req(), wBad.env);
  ok(gBad.data.has_link === false && gBad.data.link === null, "a stored value that does not pass the rule is never handed out");
}

// ── deploy order: the Worker before the migration
{
  user = OWNER;
  const w = world({ link: L, migrated: false });
  ok((await w.F.gmReviewLinkColumnReady(w.env)) === false && (await w.F.gmReviewLinkRead(w.env, "c1")) === null, "missing column: read as \"no link\", no throw");
  const g = await w.F.handleGetGmJobReviewRequest("c1", "j1", req(), w.env);
  ok(g.status === 200 && g.data.has_link === false && g.data.last === null, "missing column AND missing table: the project still answers 200");
  const p = await w.F.handlePostGmJobReviewRequest("c1", "j1", req({ channel: "sms" }), w.env);
  ok(p.status === 200 && p.data.logged === false, "and a press answers 200 with nothing recorded");
}

// ── a failed log write never stops the link
{
  user = OWNER;
  const w = world({ link: L, dropLog: true });
  const g = await w.F.handleGetGmJobReviewRequest("c1", "j1", req(), w.env);
  ok(g.status === 200 && g.data.link === L && g.data.message.indexOf(L) > 0 && g.data.last === null, "missing gm_send_log table: the link and the message are still returned");
  const p = await w.F.handlePostGmJobReviewRequest("c1", "j1", req({ channel: "whatsapp" }), w.env);
  ok(p.status === 200 && p.data.logged === false && p.data.link === L && p.data.message.indexOf(L) > 0, "missing gm_send_log table: the press answers 200, logged:false, link still there");
  const w2 = world({ link: L });
  const realPrepare = w2.env.DB.prepare;
  w2.env.DB.prepare = function (sql) { if (/^INSERT INTO gm_send_log/.test(sql)) { throw new Error("D1 is down"); } return realPrepare(sql); };
  const p2 = await w2.F.handlePostGmJobReviewRequest("c1", "j1", req({ channel: "copy" }), w2.env);
  ok(p2.status === 200 && p2.data.logged === false && p2.data.link === L && p2.data.has_link === true, "a write that throws: still 200 with the link");
}

// ── saving the link (the document settings save)
{
  const w = world({ link: null });
  const put = (body) => w.F.handlePutGmDocSettings("c1", req(body), w.env);
  const saved = () => w.d.q("SELECT google_review_link FROM gm_doc_settings WHERE client_id = 'c1'")[0].google_review_link;
  user = MARIA;
  const s = await put({ google_review_link: L });
  ok(s.status === 403 && saved() === null, "a salesperson's attempt to save the link is refused by the Worker");
  user = OWNER;
  for (const badLink of ["http://g.page/r/x/review", "https://google.com.evil.com/x", "javascript:alert(1)"]) {
    const r = await put({ legal_name: "Changed Name", google_review_link: badLink });
    ok(r.status === 400 && !!r.error_pt && !!r.error_en && saved() === null && w.d.q("SELECT legal_name FROM gm_doc_settings")[0].legal_name === "Zeta Pools LLC", "refused, in both languages, and NOTHING is saved (not even the other fields): " + badLink);
  }
  const good = await put({ google_review_link: "  " + L + " " });
  ok(good.status === 200 && saved() === L && good.data.settings.google_review_link === L, "the owner saves a good link (trimmed)");
  ok(w.d.q("SELECT field, old_value, new_value, actor FROM gm_doc_settings_history").some((h) => h.field === "google_review_link" && h.old_value === null && h.new_value === L && h.actor === "ZETA POOLS"), "the change is in the settings history");
  const untouched = await put({ legal_name: "Zeta Pools LLC" });
  ok(untouched.status === 200 && saved() === L, "a save that does not mention the link leaves it alone");
  const cleared = await put({ google_review_link: "" });
  ok(cleared.status === 200 && saved() === null && cleared.data.settings.google_review_link === null, "empty clears it");
}
{
  // Before the migration: the settings screen still saves; only a real link is refused.
  user = OWNER;
  const w = world({ link: null, migrated: false });
  const a = await w.F.handlePutGmDocSettings("c1", req({ legal_name: "New Legal Name", google_review_link: null }), w.env);
  ok(a.status === 200 && w.d.q("SELECT legal_name FROM gm_doc_settings")[0].legal_name === "New Legal Name", "missing column: the settings screen still saves the other fields");
  const b = await w.F.handlePutGmDocSettings("c1", req({ legal_name: "Third Name", google_review_link: L }), w.env);
  ok(b.status === 503 && !!b.error_pt && w.d.q("SELECT legal_name FROM gm_doc_settings")[0].legal_name === "New Legal Name", "missing column: a real link is refused with a plain message and nothing is saved");
}

// ── the route lists
{
  const F = base.F;
  ok(F.sellerRequestAllowed("/api/clients/c1/gm/jobs/j1/review-request", "GET", "c1") === true && F.sellerRequestAllowed("/api/clients/c1/gm/jobs/j1/review-request", "POST", "c1") === true, "a salesperson may call the review request routes (the handler then checks the project)");
  ok(F.sellerRequestAllowed("/api/clients/c1/gm/doc-settings", "PUT", "c1") !== true && F.sellerRequestAllowed("/api/clients/c1/gm/doc-settings", "GET", "c1") !== true, "a salesperson may not read or save the document settings");
  ok(F.clientRequestAllowed("/api/clients/c1/gm/jobs/j1/review-request", "GET", "c1") === true && F.clientRequestAllowed("/api/clients/c1/gm/jobs/j1/review-request", "POST", "c1") === true, "the owner may call the review request routes");
  ok(F.sellerRequestAllowed("/api/clients/c2/gm/jobs/j1/review-request", "GET", "c1") !== true, "never on another business's address");
}

// ── the page and the Worker carry the same texts; the migration only adds
{
  const jsStr = (src, name) => new Function("return " + new RegExp("var " + name + " = (\"[^\\n]*\");").exec(src)[1])();
  ok(jsStr(gmSrc, "GM_REVIEW_LINK_BAD_PT") === jsStr(workerSrc, "GM_REVIEW_LINK_BAD_PT") && jsStr(gmSrc, "GM_REVIEW_LINK_BAD_EN") === jsStr(workerSrc, "GM_REVIEW_LINK_BAD_EN"), "the refusal message is the same on the page and in the Worker");
  ok(gmSrc.indexOf("https://support.google.com/business/answer/3474122") !== -1, "the \"How to find it\" link is Google's help page");
  const sql = migration.replace(/^\s*--[^\n]*$/gm, "");
  ok(/ALTER TABLE gm_doc_settings ADD COLUMN google_review_link TEXT;/.test(sql) && /CREATE TABLE IF NOT EXISTS gm_send_log/.test(sql), "the migration adds the column (nullable, no default) and the table");
  ok(!/\b(DROP|DELETE|UPDATE|INSERT)\b/i.test(sql), "the migration only adds: no DROP, DELETE, UPDATE or INSERT");
  const added = /\/\/ ── Ask for a Google review \(job 37\)[\s\S]*?\n\/\/ I2: a salesperson photo/.exec(gmSrc)[0];
  ok(!/[^\x00-\x7F]/.test(added.replace(/^\s*\/\/.*$/gm, "")), "the new gm.js code is plain ASCII outside comments");
  ok(!/\b(const|let)\s|=>/.test(added.replace(/^\s*\/\/.*$/gm, "")), "the new gm.js code uses var and regular functions");
}

console.log(fail ? "\n" + fail + " FAILED" : "\nall passed");
process.exit(fail ? 1 : 0);
