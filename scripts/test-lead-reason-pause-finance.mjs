// Lost reason, Paused and Finance status: the Worker rules (2026-11-14).
//
//   node scripts/test-lead-reason-pause-finance.mjs
//
// Runs the REAL handlePutGmLead / handlePostGmLead (and everything they call)
// out of worker/index.js against an in-memory SQLite that has the live columns.
// Only sign in and the response wrappers are stubbed.
//
// Rules proven here:
//   - A move into Perdido needs a valid reason when the request carries the
//     header X-Apex-Reason-UI: 1; without it (the old App Store app) the move is
//     accepted, the reason stays empty and the source is 'missing_old_app'.
//   - out_of_state needs a state code, out_of_scope 1 to 80 characters, other
//     20 to 300 characters and writes gm_lead_other_log.
//   - Editing an already lost lead never asks again; the server never writes a
//     reason, a pause or a finance status on its own.
//   - Paused: dates are checked against the CLIENT's local day (never UTC).
//   - Finance: fixed values; Other needs 3 to 120 characters and writes the log.
//   - Notes (observacao, proxima_acao, gm_notes, contact notes) are never written.
import { makeDb, loadWorker, makeStubs, mkReq, USERS, UI, NY } from "./fixtures/lead-reason-harness.mjs";

let fails = 0;
const t = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { fails++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label + (ok ? "" : "\n        expected " + JSON.stringify(expected) + " got " + JSON.stringify(actual)));
};

const state = { user: USERS.owner };
const database = makeDb();
const W = loadWorker(makeStubs(state));
const env = { DB: database.DB };

// 2026-11-14 02:30 UTC is 9:30 PM on November 13 in New York. UTC is already the next day.
const REAL_NOW = Date.now;
const EVENING_UTC = Date.UTC(2026, 10, 14, 2, 30, 0);
Date.now = () => EVENING_UTC;
const TODAY = "2026-11-13";

const LEAD_COLS = ["lost_reason", "lost_reason_detail", "lost_reason_source", "parsed_from", "paused_until", "paused_at", "paused_reason",
  "finance_status", "finance_status_other", "pause_banner_cleared_at", "pause_banner_cleared_by"];
function seed(id, over) {
  const row = Object.assign({ id, client_id: "c1", cliente: "Maria Souza", estagio: "follow_up", vendedor: "Ana Lima",
    observacao: "Original note kept", proxima_acao: "Call on Tuesday" }, over || {});
  const keys = Object.keys(row);
  database.raw.prepare("INSERT INTO gm_leads (" + keys.join(",") + ") VALUES (" + keys.map(() => "?").join(",") + ")").run(...keys.map((k) => row[k]));
  return id;
}
const lead = (id) => database.q("SELECT * FROM gm_leads WHERE id = ?", id)[0];
const events = (id) => database.q("SELECT * FROM gm_lead_events WHERE lead_id = ? ORDER BY rowid", id);
const otherLog = (id) => database.q("SELECT * FROM gm_lead_other_log WHERE lead_id = ?", id);
const put = async (id, body, headers, user) => {
  state.user = user || USERS.owner;
  const res = await W.handlePutGmLead("c1", id, mkReq(body, Object.assign({}, NY, headers || {})), env);
  return { status: res.status, body: await res.json() };
};
const post = async (body, headers, user) => {
  state.user = user || USERS.owner;
  const res = await W.handlePostGmLead("c1", mkReq(body, Object.assign({}, NY, headers || {}), "https://w.example/api/clients/c1/gm/leads"), env);
  return { status: res.status, body: await res.json() };
};
const only = (row, cols) => cols.reduce((o, c) => { o[c] = row[c]; return o; }, {});
const NEW_NULLS = { lost_reason: null, lost_reason_detail: null, lost_reason_source: null, parsed_from: null, paused_until: null, paused_at: null,
  paused_reason: null, finance_status: null, finance_status_other: null, pause_banner_cleared_at: null, pause_banner_cleared_by: null };

// ── 1. The lists ───────────────────────────────────────────────────────────
const REASONS = ["too_expensive", "others_cheaper", "cant_afford", "need_to_think", "need_to_talk", "getting_quotes",
  "already_have_someone", "dont_need_it", "no_response", "out_of_state", "out_of_scope", "other"];
t("GM_LEAD_LOST_REASONS is the fixed list, in order", W.GM_LEAD_LOST_REASONS, REASONS);
t("GM_US_STATES has 51 codes (50 states and DC)", (W.GM_US_STATES || []).length, 51);
t("GM_US_STATES holds exactly the codes the time zone table knows", (W.GM_US_STATES || []).slice().sort(), Object.keys(W.TZ_STATE_ZONES).sort());
t("GM_FINANCE_STATUSES is the fixed list", W.GM_FINANCE_STATUSES, ["not_needed", "not_applied", "applied_waiting", "approved", "not_approved", "other"]);

// ── 2. A move into Perdido asks (with the header) ─────────────────────────
seed("L1");
let r = await put("L1", { estagio: "perdido" }, UI);
t("into Perdido with the header and no reason is 400", r.status, 400);
t("...and the lead did not move", lead("L1").estagio, "follow_up");
r = await put("L1", { estagio: "perdido", lost_reason: "not_a_reason" }, UI);
t("an unknown reason is 400", r.status, 400);
r = await put("L1", { estagio: "perdido", lost_reason: null }, UI);
t("a null reason is 400", r.status, 400);
r = await put("L1", { estagio: "perdido", lost_reason: 5 }, UI);
t("a number as the reason is 400", r.status, 400);
r = await put("L1", { estagio: "perdido", lost_reason: "too_expensive", lost_reason_detail: "x" }, UI);
t("a detail on a reason that takes none is 400", r.status, 400);
t("...and the lead still did not move", only(lead("L1"), ["estagio", "lost_reason"]), { estagio: "follow_up", lost_reason: null });

r = await put("L1", { estagio: "perdido", lost_reason: "too_expensive", lost_reason_source: "nobody" }, UI);
t("a valid reason moves the lead", r.status, 200);
let row = lead("L1");
t("stored key, no detail, source person (never from the body)", only(row, ["estagio", "lost_reason", "lost_reason_detail", "lost_reason_source"]),
  { estagio: "perdido", lost_reason: "too_expensive", lost_reason_detail: null, lost_reason_source: "person" });
let ev = events("L1");
t("history: the stage change is logged with the actor", ev.filter((e) => e.action === "stage_changed").map((e) => [e.old_value, e.new_value, e.actor]), [["follow_up", "perdido", "Piscinas Sol"]]);
t("history: the reason is logged (old value, new value, actor)", ev.filter((e) => e.field === "lost_reason").map((e) => [e.old_value, e.new_value, e.actor]), [[null, "too_expensive", "Piscinas Sol"]]);

// Every reason in the list is accepted, with the detail it needs.
for (const key of REASONS.filter((k) => k !== "out_of_state" && k !== "out_of_scope" && k !== "other")) {
  seed("A-" + key);
  r = await put("A-" + key, { estagio: "perdido", lost_reason: key }, UI);
  t("reason " + key + " is accepted", [r.status, lead("A-" + key).lost_reason], [200, key]);
}

// ── 3. out_of_state, out_of_scope ──────────────────────────────────────────
seed("S1");
const bad = async (label, body, headers) => { const x = await put("S1", body, headers || UI); t(label, [x.status, lead("S1").estagio], [400, "follow_up"]); };
await bad("out_of_state with no state is 400", { estagio: "perdido", lost_reason: "out_of_state" });
await bad("out_of_state with a made up code is 400", { estagio: "perdido", lost_reason: "out_of_state", lost_reason_detail: "ZZ" });
await bad("out_of_state with a lower case code is 400", { estagio: "perdido", lost_reason: "out_of_state", lost_reason_detail: "fl" });
await bad("out_of_state with a state name is 400", { estagio: "perdido", lost_reason: "out_of_state", lost_reason_detail: "Florida" });
await bad("out_of_scope with no detail is 400", { estagio: "perdido", lost_reason: "out_of_scope" });
await bad("out_of_scope with spaces only is 400", { estagio: "perdido", lost_reason: "out_of_scope", lost_reason_detail: "    " });
await bad("out_of_scope with 81 characters is 400", { estagio: "perdido", lost_reason: "out_of_scope", lost_reason_detail: "x".repeat(81) });
r = await put("S1", { estagio: "perdido", lost_reason: "out_of_state", lost_reason_detail: "DC" }, UI);
t("out_of_state with DC is accepted", [r.status, only(lead("S1"), ["lost_reason", "lost_reason_detail"])], [200, { lost_reason: "out_of_state", lost_reason_detail: "DC" }]);
seed("S2");
r = await put("S2", { estagio: "perdido", lost_reason: "out_of_scope", lost_reason_detail: "  Roof repair  " }, UI);
t("out_of_scope is saved trimmed", [r.status, lead("S2").lost_reason_detail], [200, "Roof repair"]);
seed("S3");
r = await put("S3", { estagio: "perdido", lost_reason: "out_of_scope", lost_reason_detail: "x".repeat(80) }, UI);
t("out_of_scope with exactly 80 characters is accepted", r.status, 200);
seed("S4");
r = await put("S4", { estagio: "perdido", lost_reason: "out_of_scope", lost_reason_detail: "x" }, UI);
t("out_of_scope with 1 character is accepted", r.status, 200);
t("no other log row for the listed reasons", database.q("SELECT * FROM gm_lead_other_log").length, 0);

// ── 4. other: 20 to 300 characters, and the log row ───────────────────────
seed("O1");
const bad2 = async (label, text) => { const x = await put("O1", { estagio: "perdido", lost_reason: "other", lost_reason_detail: text }, UI); t(label, [x.status, lead("O1").estagio, otherLog("O1").length], [400, "follow_up", 0]); };
await bad2("other with no text is 400", undefined);
await bad2("other with 19 characters is 400", "y".repeat(19));
await bad2("other with 301 characters is 400", "y".repeat(301));
await bad2("other with 19 characters plus padding spaces is 400", "   " + "y".repeat(19) + "   ");
const text20 = "The pool was sold already.";
r = await put("O1", { estagio: "perdido", lost_reason: "other", lost_reason_detail: "  " + text20 + "  " }, UI);
t("other with 20 or more characters is accepted", r.status, 200);
t("other: reason and trimmed text are saved on the lead", only(lead("O1"), ["lost_reason", "lost_reason_detail", "lost_reason_source"]), { lost_reason: "other", lost_reason_detail: text20, lost_reason_source: "person" });
let lg = otherLog("O1");
t("other: exactly one log row with field, text, lead, client, actor and status open", lg.map((x) => [x.field, x.text, x.lead_id, x.client_id, x.created_by, x.status]), [["lost_reason", text20, "O1", "c1", "Piscinas Sol", "open"]]);
seed("O2");
r = await put("O2", { estagio: "perdido", lost_reason: "other", lost_reason_detail: "z".repeat(300) }, UI);
t("other with exactly 300 characters is accepted", r.status, 200);

// ── 5. The header rule: the old App Store app ─────────────────────────────
seed("H1");
r = await put("H1", { estagio: "perdido" });
row = lead("H1");
t("without the header a move into Perdido is accepted", r.status, 200);
t("...the reason stays empty and the source is missing_old_app", only(row, ["estagio", "lost_reason", "lost_reason_detail", "lost_reason_source"]),
  { estagio: "perdido", lost_reason: null, lost_reason_detail: null, lost_reason_source: "missing_old_app" });
seed("H2");
r = await put("H2", { estagio: "perdido", lost_reason_source: "person" });
t("a source in the body is ignored (still missing_old_app)", lead("H2").lost_reason_source, "missing_old_app");
seed("H3");
r = await put("H3", { estagio: "perdido" }, { "X-Apex-Reason-UI": "0" });
t("the header must be exactly 1: 0 is the same as missing", [r.status, lead("H3").lost_reason_source], [200, "missing_old_app"]);

// ── 6. Already lost: no question; moving out keeps, moving back asks ─────
seed("P1", { estagio: "perdido", lost_reason: "too_expensive", lost_reason_source: "person" });
r = await put("P1", { cliente: "Maria S. Souza" }, UI);
t("editing another field of a lost lead is 200 with the header and no reason", r.status, 200);
t("...and the reason is unchanged", only(lead("P1"), ["lost_reason", "lost_reason_source"]), { lost_reason: "too_expensive", lost_reason_source: "person" });
r = await put("P1", { estagio: "perdido", observacao: "Changed by a person" }, UI);
t("sending estagio perdido again on a lost lead does not ask", r.status, 200);
r = await put("P1", { estagio: "negociacao" }, UI);
t("moving OUT of Perdido is 200", r.status, 200);
t("...and clears nothing", only(lead("P1"), ["estagio", "lost_reason", "lost_reason_source"]), { estagio: "negociacao", lost_reason: "too_expensive", lost_reason_source: "person" });
r = await put("P1", { estagio: "perdido" }, UI);
t("moving back INTO Perdido asks again (400 without a reason)", [r.status, lead("P1").estagio], [400, "negociacao"]);
r = await put("P1", { estagio: "perdido", lost_reason: "cant_afford" }, UI);
t("...and the new reason replaces the old", [r.status, lead("P1").lost_reason], [200, "cant_afford"]);
seed("P2", { estagio: "negociacao", lost_reason: "too_expensive", lost_reason_source: "person" });
r = await put("P2", { estagio: "perdido" });
t("an old app move back INTO Perdido blanks the old reason and says so", only(lead("P2"), ["lost_reason", "lost_reason_source"]), { lost_reason: null, lost_reason_source: "missing_old_app" });

// A reason sent for a lead that is not lost is refused.
seed("N1");
r = await put("N1", { lost_reason: "too_expensive" }, UI);
t("a reason on a lead that is not lost is 400", [r.status, lead("N1").lost_reason], [400, null]);

// ── 7. The server never writes these on its own ───────────────────────────
seed("Z1");
r = await put("Z1", { cliente: "Renamed", telefone: "407 555 0147" }, UI);
t("an ordinary edit leaves all eleven new columns empty", [r.status, only(lead("Z1"), LEAD_COLS)], [200, NEW_NULLS]);
r = await put("Z1", { estagio: "negociacao" }, UI);
t("a stage move to a live stage leaves them empty", only(lead("Z1"), LEAD_COLS), NEW_NULLS);
r = await put("Z1", { estagio: "fechado" }, UI);
t("closing a lead leaves them empty", only(lead("Z1"), LEAD_COLS), NEW_NULLS);
r = await put("Z1", { parsed_from: "notes", lost_reason_source: "person", paused_at: "2026-01-01", pause_banner_cleared_by: "me", pause_banner_cleared_at: "x", cliente: "Still Z1" }, UI);
t("body keys that only the server may set are ignored", [r.status, only(lead("Z1"), LEAD_COLS)], [200, NEW_NULLS]);

// ── 8. Created already lost ────────────────────────────────────────────────
r = await post({ cliente: "Nova Lead", estagio: "perdido" }, UI);
t("POST as lost with the header and no reason is 400", r.status, 400);
t("...and nothing was created", database.q("SELECT id FROM gm_leads WHERE cliente = 'Nova Lead'").length, 0);
r = await post({ cliente: "Nova Lead", estagio: "perdido", lost_reason: "no_response" }, UI);
t("POST as lost with a reason is 200", r.status, 200);
const created = database.q("SELECT * FROM gm_leads WHERE cliente = 'Nova Lead'")[0];
t("...reason saved, source person", only(created || {}, ["estagio", "lost_reason", "lost_reason_source"]), { estagio: "perdido", lost_reason: "no_response", lost_reason_source: "person" });
t("...and the creation is in the history, with the reason", events(created ? created.id : "none").map((e) => e.field + ":" + e.new_value).sort(), ["estagio:perdido", "lost_reason:no_response"]);
r = await post({ cliente: "Old App Lead", estagio: "perdido" });
const oldApp = database.q("SELECT * FROM gm_leads WHERE cliente = 'Old App Lead'")[0] || {};
t("POST as lost without the header is 200, reason empty, missing_old_app", [r.status, oldApp.lost_reason, oldApp.lost_reason_source], [200, null, "missing_old_app"]);
r = await post({ cliente: "Plain Lead" }, UI);
const plain = database.q("SELECT * FROM gm_leads WHERE cliente = 'Plain Lead'")[0] || {};
t("POST of an ordinary lead leaves the new columns empty", [r.status, only(plain, LEAD_COLS)], [200, NEW_NULLS]);
r = await post({ cliente: "Other Lost", estagio: "perdido", lost_reason: "other", lost_reason_detail: text20 }, UI);
const oth = database.q("SELECT * FROM gm_leads WHERE cliente = 'Other Lost'")[0] || {};
t("POST as lost with Other writes the log row too", otherLog(oth.id).map((x) => [x.field, x.text, x.status]), [["lost_reason", text20, "open"]]);

// ── 9. Paused ──────────────────────────────────────────────────────────────
t("the clock for this test is 9:30 PM on Nov 13 in New York, but already Nov 14 in UTC", [new Date(Date.now()).toISOString().slice(0, 10), TODAY], ["2026-11-14", "2026-11-13"]);
seed("K1");
r = await put("K1", { paused_until: "2026-11-13", paused_reason: "Waiting for the permit" }, UI);
t("pausing until the client's own today is 400", r.status, 400);
r = await put("K1", { paused_until: "2026-11-12", paused_reason: "Waiting for the permit" }, UI);
t("pausing until a past date is 400", r.status, 400);
r = await put("K1", { paused_until: "2026-11-14", paused_reason: "Waiting for the permit" }, UI);
t("pausing until the client's tomorrow is 200 (UTC is already that day)", r.status, 200);
row = lead("K1");
t("paused_at is the client's local today, not the UTC date", row.paused_at, TODAY);
t("the lead keeps its stage and the banner starts uncleared", only(row, ["estagio", "paused_until", "paused_reason", "pause_banner_cleared_at", "pause_banner_cleared_by"]),
  { estagio: "follow_up", paused_until: "2026-11-14", paused_reason: "Waiting for the permit", pause_banner_cleared_at: null, pause_banner_cleared_by: null });
t("history: paused_until and paused_reason are logged with the actor", events("K1").filter((e) => e.field === "paused_until" || e.field === "paused_reason").map((e) => [e.field, e.new_value, e.actor]).sort(),
  [["paused_reason", "Waiting for the permit", "Piscinas Sol"], ["paused_until", "2026-11-14", "Piscinas Sol"]]);

const pbad = async (label, body) => { seed("K-x"); const x = await put("K-x", body, UI); t(label, [x.status, lead("K-x").paused_until], [400, null]); database.raw.exec("DELETE FROM gm_leads WHERE id = 'K-x'"); };
await pbad("no reason is 400", { paused_until: "2026-12-01" });
await pbad("a reason of 2 characters is 400", { paused_until: "2026-12-01", paused_reason: "ab" });
await pbad("a reason of 2 characters plus spaces is 400", { paused_until: "2026-12-01", paused_reason: "  ab  " });
await pbad("a reason of 161 characters is 400", { paused_until: "2026-12-01", paused_reason: "r".repeat(161) });
await pbad("a reason with no date is 400", { paused_reason: "Waiting for the permit" });
await pbad("a date in the wrong shape is 400", { paused_until: "12/01/2026", paused_reason: "Waiting" });
await pbad("a date that does not exist is 400", { paused_until: "2026-02-30", paused_reason: "Waiting" });
await pbad("a date with a time is 400", { paused_until: "2026-12-01T10:00", paused_reason: "Waiting" });
await pbad("a date that is a number is 400", { paused_until: 20261201, paused_reason: "Waiting" });
await pbad("a date 24 months and 1 day ahead is 400", { paused_until: "2028-11-14", paused_reason: "Waiting" });
await pbad("a null date is 400", { paused_until: null, paused_reason: "Waiting" });
seed("K2");
r = await put("K2", { paused_until: "2028-11-13", paused_reason: "r".repeat(160) }, UI);
t("exactly 24 months ahead and a 160 character reason are 200", r.status, 200);
seed("K3", { estagio: "fechado" });
r = await put("K3", { paused_until: "2026-12-01", paused_reason: "Waiting" }, UI);
t("a closed lead cannot be paused", [r.status, lead("K3").paused_until], [400, null]);
seed("K4", { estagio: "perdido" });
r = await put("K4", { paused_until: "2026-12-01", paused_reason: "Waiting" }, UI);
t("a lost lead cannot be paused", [r.status, lead("K4").paused_until], [400, null]);
seed("K5");
r = await put("K5", { estagio: "perdido", lost_reason: "too_expensive", paused_until: "2026-12-01", paused_reason: "Waiting" }, UI);
t("pausing and losing in one request is 400", [r.status, lead("K5").estagio, lead("K5").paused_until], [400, "follow_up", null]);
seed("K6");
r = await put("K6", { estagio: "perdido", paused_until: "2026-12-01", paused_reason: "Waiting" }, UI);
t("moving to Perdido while pausing is 400", [r.status, lead("K6").estagio], [400, "follow_up"]);

// Pausing again brings a fresh banner.
database.raw.prepare("UPDATE gm_leads SET pause_banner_cleared_at = '2026-11-13 10:00:00', pause_banner_cleared_by = 'Ana Lima' WHERE id = 'K1'").run();
r = await put("K1", { paused_until: "2026-12-20", paused_reason: "Customer is travelling" }, UI);
t("pausing again clears the cleared banner note", [r.status, only(lead("K1"), ["paused_until", "paused_reason", "pause_banner_cleared_at", "pause_banner_cleared_by"])],
  [200, { paused_until: "2026-12-20", paused_reason: "Customer is travelling", pause_banner_cleared_at: null, pause_banner_cleared_by: null }]);

// End the pause now: paused_until becomes today, the banner stays.
database.raw.prepare("UPDATE gm_leads SET pause_banner_cleared_at = '2026-11-13 10:00:00', pause_banner_cleared_by = 'Ana Lima' WHERE id = 'K1'").run();
r = await put("K1", { pause_end_now: true }, UI);
t("ending the pause now sets paused_until to the client's today", [r.status, lead("K1").paused_until], [200, TODAY]);
t("...and keeps the banner state as it was", only(lead("K1"), ["paused_reason", "pause_banner_cleared_at", "pause_banner_cleared_by"]),
  { paused_reason: "Customer is travelling", pause_banner_cleared_at: "2026-11-13 10:00:00", pause_banner_cleared_by: "Ana Lima" });
t("history: the early end is logged with the actor", events("K1").filter((e) => e.action === "pause_ended_early").map((e) => [e.field, e.old_value, e.new_value, e.actor]), [["paused_until", "2026-12-20", TODAY, "Piscinas Sol"]]);
r = await put("K1", { pause_end_now: true }, UI);
t("ending a pause that is not running is 400", r.status, 400);
r = await put("K1", { pause_end_now: "yes" }, UI);
t("pause_end_now must be true, not text", r.status, 400);
seed("K7");
r = await put("K7", { pause_end_now: true }, UI);
t("ending a pause on a lead that never paused is 400", [r.status, lead("K7").paused_until], [400, null]);

// ── 10. Finance status ─────────────────────────────────────────────────────
seed("F1");
for (const v of ["not_needed", "not_applied", "applied_waiting", "approved", "not_approved"]) {
  r = await put("F1", { finance_status: v }, UI);
  t("finance " + v + " is accepted", [r.status, lead("F1").finance_status], [200, v]);
}
r = await put("F1", { finance_status: "maybe" }, UI);
t("an unknown finance value is 400", [r.status, lead("F1").finance_status], [400, "not_approved"]);
r = await put("F1", { finance_status: 3 }, UI);
t("a number as finance is 400", r.status, 400);
r = await put("F1", { finance_status: "approved", finance_status_other: "text" }, UI);
t("text with a value other than Other is 400", r.status, 400);
r = await put("F1", { finance_status: "other" }, UI);
t("Other with no text is 400", [r.status, lead("F1").finance_status], [400, "not_approved"]);
r = await put("F1", { finance_status: "other", finance_status_other: "ab" }, UI);
t("Other with 2 characters is 400", r.status, 400);
r = await put("F1", { finance_status: "other", finance_status_other: "x".repeat(121) }, UI);
t("Other with 121 characters is 400", r.status, 400);
r = await put("F1", { finance_status_other: "Credit union review" }, UI);
t("text without a finance value is 400", r.status, 400);
r = await put("F1", { finance_status: "other", finance_status_other: "  Credit union review  " }, UI);
t("Other with 3 to 120 characters is 200", r.status, 200);
t("...saved on the lead, trimmed", only(lead("F1"), ["finance_status", "finance_status_other"]), { finance_status: "other", finance_status_other: "Credit union review" });
t("...and in the other log with field finance_status", otherLog("F1").map((x) => [x.field, x.text, x.created_by, x.status]), [["finance_status", "Credit union review", "Piscinas Sol", "open"]]);
r = await put("F1", { finance_status: "approved" }, UI);
t("a later non Other value clears the text", only(lead("F1"), ["finance_status", "finance_status_other"]), { finance_status: "approved", finance_status_other: null });
r = await put("F1", { finance_status: null }, UI);
t("a person can clear it back to empty", [r.status, lead("F1").finance_status], [200, null]);
t("history: finance changes are logged with the actor", events("F1").filter((e) => e.field === "finance_status").map((e) => [e.old_value, e.new_value, e.actor]).slice(0, 2),
  [[null, "not_needed", "Piscinas Sol"], ["not_needed", "not_applied", "Piscinas Sol"]]);
r = await post({ cliente: "Finance Lead", finance_status: "other", finance_status_other: "Family loan" }, UI);
const fl = database.q("SELECT * FROM gm_leads WHERE cliente = 'Finance Lead'")[0] || {};
t("POST can carry a finance value, and Other writes the log", [r.status, fl.finance_status, otherLog(fl.id).map((x) => x.field)], [200, "other", ["finance_status"]]);
t("the old free text column is untouched by the new field", fl.status_financiamento, null);

// ── 11. Notes are never written ────────────────────────────────────────────
database.writes.length = 0;
seed("T1", { estagio: "follow_up" });
const notesBefore = only(lead("T1"), ["observacao", "proxima_acao"]);
await put("T1", { estagio: "perdido", lost_reason: "need_to_think" }, UI);
await put("T1", { estagio: "negociacao" }, UI);
await put("T1", { paused_until: "2026-12-01", paused_reason: "Waiting for the permit" }, UI);
await put("T1", { pause_end_now: true }, UI);
await put("T1", { finance_status: "other", finance_status_other: "Family loan" }, UI);
const writesSql = database.writes.filter((w) => !/^INSERT INTO gm_leads/.test(w.sql)).map((w) => w.sql).join("\n");
t("observacao and proxima_acao are exactly as they were", only(lead("T1"), ["observacao", "proxima_acao"]), notesBefore);
t("these routes ran statements (the check below is not empty)", database.writes.length > 4, true);
t("no statement from these routes sets observacao or proxima_acao", /(observacao|proxima_acao)\s*=/.test(writesSql), false);
t("no statement writes gm_notes or the contact notes", /(gm_notes|gm_lead_contacts)/.test(writesSql), false);
t("the old free text column status_financiamento is never in a SET", /status_financiamento\s*=/.test(writesSql), false);

// ── 12. A seller: own lead only ────────────────────────────────────────────
seed("M1", { vendedor: "Ana Lima" });
seed("M2", { vendedor: "Bruno" });
r = await put("M1", { estagio: "perdido", lost_reason: "dont_need_it" }, UI, USERS.seller);
t("a seller can lose their own lead with a reason", [r.status, lead("M1").lost_reason], [200, "dont_need_it"]);
t("...and the actor in the history is the seller", events("M1").filter((e) => e.field === "lost_reason").map((e) => e.actor), ["Ana Lima"]);
r = await put("M2", { estagio: "perdido", lost_reason: "dont_need_it" }, UI, USERS.seller);
t("a seller cannot lose someone else's lead (403)", [r.status, lead("M2").estagio], [403, "follow_up"]);
r = await put("M2", { paused_until: "2026-12-01", paused_reason: "Waiting" }, UI, USERS.seller);
t("a seller cannot pause someone else's lead (403)", r.status, 403);
state.user = null;
r = await W.handlePutGmLead("c1", "M1", mkReq({ estagio: "perdido" }, UI), env);
t("not signed in is 401", r.status, 401);
state.user = USERS.otherOwner;
r = await W.handlePutGmLead("c1", "M1", mkReq({ estagio: "perdido" }, UI), env);
t("another client's owner is 403", r.status, 403);

Date.now = REAL_NOW;
console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
process.exit(fails ? 1 : 0);
