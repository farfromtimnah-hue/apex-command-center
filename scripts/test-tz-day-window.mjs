// Day windows in the viewer's own time zone, and the daily-log suggestions built on them.
// The REAL Worker functions are cut out of worker/index.js and run against an
// in-memory SQLite (the real migrations for gm_leads, gm_lead_events, gm_jobs,
// gm_finance). No network, no live database.
//
//   node scripts/test-tz-day-window.mjs
import { readFileSync } from "node:fs";
import { makeDb, build, baseStubs } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) { fail++; } };
const eq = (a, b, m) => ok(a === b, m + (a === b ? "" : "  (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"));

const d = makeDb(["migrations/gm_growth_management.sql", "migrations/gm_lead_events.sql"]);
try { d.raw.exec("ALTER TABLE clients ADD COLUMN location_state TEXT"); } catch (e) { /* the shared schema may already have it */ }
d.raw.exec("INSERT INTO clients (id, name, status, archived) VALUES ('c1','C ONE','active',0)");
d.raw.exec("INSERT INTO clients (id, name, status, archived) VALUES ('c2','C TWO','active',0)");

let F;
try {
  F = build(
    ["tzIsValid", "tzParts", "tzPad2", "tzSqlUtc", "tzMidnightUtcMs", "tzOffsetMinutes", "tzDayWindowUtc", "tzZoneForState", "resolveRequestZone", "tzLocalNowStamp",
     "handleGetEntrySuggestions", "gmInsertLead", "requireClientAccess", "isValidDateStr", "num0", "cents"],
    ["TZ_STATE_ZONES", "TZ_STATE_NAMES", "GM_LEAD_COST_FIELDS"],
    Object.assign({}, baseStubs, {
      URL: globalThis.URL, Intl: globalThis.Intl, Date: Date, Math: Math, Number: Number, Object: Object, crypto: globalThis.crypto,
      authenticate: async (r) => r.user,
      gmLeadGeocodeIfNeeded: async () => {},
      gmLogLeadEvents: async () => {}
    }));
} catch (e) {
  ok(false, "the Worker has the time zone helpers: " + e.message);
  console.log("\n" + fail + " failing");
  process.exit(1);
}

const T = (tz, day) => F.tzDayWindowUtc(day, tz);

// ---- tzIsValid ----
ok(F.tzIsValid("America/New_York") === true, "tzIsValid accepts America/New_York");
ok(F.tzIsValid("Pacific/Honolulu") === true, "tzIsValid accepts Pacific/Honolulu");
ok(F.tzIsValid("garbage") === false, "tzIsValid rejects garbage");
ok(F.tzIsValid("") === false && F.tzIsValid(null) === false && F.tzIsValid(undefined) === false, "tzIsValid rejects empty, null, undefined");
ok(F.tzIsValid("America/New_York; DROP TABLE x") === false, "tzIsValid rejects an injection string");

// ---- windows, ordinary day ----
let w = T("America/New_York", "2026-10-27");
eq(w.start + " | " + w.end, "2026-10-27 04:00:00 | 2026-10-28 04:00:00", "New York ordinary day (EDT, UTC-4)");
w = T("America/Chicago", "2026-10-27");
eq(w.start + " | " + w.end, "2026-10-27 05:00:00 | 2026-10-28 05:00:00", "Chicago ordinary day (CDT, UTC-5)");
w = T("America/Los_Angeles", "2026-10-27");
eq(w.start + " | " + w.end, "2026-10-27 07:00:00 | 2026-10-28 07:00:00", "Los Angeles ordinary day (PDT, UTC-7)");
w = T("Pacific/Honolulu", "2026-10-27");
eq(w.start + " | " + w.end, "2026-10-27 10:00:00 | 2026-10-28 10:00:00", "Honolulu ordinary day (HST, UTC-10)");

// ---- daylight saving ----
w = T("America/New_York", "2026-03-08");
eq(w.start + " | " + w.end, "2026-03-08 05:00:00 | 2026-03-09 04:00:00", "New York spring forward day: 23 hours");
w = T("America/New_York", "2026-11-01");
eq(w.start + " | " + w.end, "2026-11-01 04:00:00 | 2026-11-02 05:00:00", "New York fall back day: 25 hours");
w = T("America/Phoenix", "2026-03-08");
eq(w.start + " | " + w.end, "2026-03-08 07:00:00 | 2026-03-09 07:00:00", "Phoenix has no daylight saving: 24 hours");

// ---- state map ----
eq(F.resolveRequestZone.length, 3, "resolveRequestZone takes (request, env, clientId)");
eq(F.tzZoneForState("FL"), "America/New_York", "FL is New York");
eq(F.tzZoneForState("WA"), "America/Los_Angeles", "WA is Los Angeles");
eq(F.tzZoneForState("TX"), "America/Chicago", "TX is Chicago");
eq(F.tzZoneForState("IL"), "America/Chicago", "IL is Chicago");
eq(F.tzZoneForState("AZ"), "America/Phoenix", "AZ is Phoenix");
eq(F.tzZoneForState("Florida"), "America/New_York", "full name Florida");
eq(F.tzZoneForState("  florida "), "America/New_York", "full name, lower case, spaces");
eq(F.tzZoneForState("fl"), "America/New_York", "code, lower case");
eq(F.tzZoneForState("District of Columbia"), "America/New_York", "District of Columbia");
eq(F.tzZoneForState("Atlantis"), null, "unknown state has no zone");
{
  // all 50 states + DC are covered and every zone is a real IANA name
  const codes = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
  eq(codes.length, 51, "fixture lists 51 codes");
  ok(codes.every((c) => F.tzIsValid(F.tzZoneForState(c))), "all 50 states and DC map to a valid zone");
}

// ---- resolveRequestZone ----
const rq = (tz, user) => ({ headers: { get: (k) => (k.toLowerCase() === "x-client-tz" ? tz : null) }, user: user, url: "https://x.test/api/clients/c1/entry-suggestions?date=2026-10-27" });
const env = { DB: d.DB };
async function main() {
  eq(await F.resolveRequestZone(rq("America/Los_Angeles"), env, "c1"), "America/Los_Angeles", "header wins");
  d.raw.exec("UPDATE clients SET location_state = 'WA' WHERE id = 'c1'");
  eq(await F.resolveRequestZone(rq(null), env, "c1"), "America/Los_Angeles", "no header: the client's state");
  eq(await F.resolveRequestZone(rq("not/a_zone"), env, "c1"), "America/Los_Angeles", "bad header ignored, state used");
  eq(await F.resolveRequestZone(rq(null), env, "c2"), "America/New_York", "no header, no state: New York last");
  d.raw.exec("UPDATE clients SET location_state = 'Narnia' WHERE id = 'c2'");
  eq(await F.resolveRequestZone(rq(null), env, "c2"), "America/New_York", "unknown state value: New York last");
  const readsBefore = d.log.length;
  await F.resolveRequestZone(rq("America/Chicago"), env, "c1");
  eq(d.log.length, readsBefore, "header present: no database read");

  // tzLocalNowStamp: 2026-10-28 01:30 UTC is 9:30 PM Oct 27 in New York
  const instant = Date.UTC(2026, 9, 28, 1, 30, 0);
  eq(F.tzLocalNowStamp("America/New_York", instant), "2026-10-27T21:30", "local stamp, New York");
  eq(F.tzLocalNowStamp("America/Los_Angeles", instant), "2026-10-27T18:30", "local stamp, Los Angeles");
  ok(/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(F.tzLocalNowStamp("America/New_York")), "local stamp shape without a clock argument");

  // ---- suggestions against real SQL ----
  const ins = (id, cid, data_lead, created_at, extra) => {
    extra = extra || {};
    d.raw.prepare("INSERT INTO gm_leads (id, client_id, cliente, data_lead, data_contato, data_estimate, estagio, valor, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(id, cid, "Lead " + id, data_lead, extra.contato || null, extra.estimate || null, "novo_lead", extra.valor || null, created_at);
  };
  const ev = (cid, lead, newv, at) => d.raw.prepare("INSERT INTO gm_lead_events (id, lead_id, client_id, action, field, new_value, created_at) VALUES (?,?,?,?,?,?,?)")
    .run("e" + Math.random(), lead, cid, "stage_changed", "estagio", newv, at);
  const staff = { role: "developer", display_name: "t" };
  const get = (cid, tz, date, user) => F.handleGetEntrySuggestions(cid, rq(tz, user === undefined ? staff : user), env);
  const call = (cid, tz, date, user) => {
    const r = rq(tz, user === undefined ? staff : user);
    r.url = "https://x.test/api/clients/" + cid + "/entry-suggestions?date=" + date;
    return F.handleGetEntrySuggestions(cid, r, env);
  };

  // nothing yet: null, not 0
  let r = await call("c1", "America/New_York", "2026-10-27");
  eq(r.status, 200, "route answers 200");
  eq(r.data.suggestions.leads_gerados, null, "no lead rows at all: leads_gerados is null");
  eq(r.data.suggestions.entregas_realizadas, null, "no jobs rows: entregas_realizadas is null");
  eq(r.data.suggestions.velocidade_resposta, null, "no leads: velocidade_resposta is null");
  eq(r.data.lead_names.length, 0, "no leads: lead_names is empty");

  // 9 PM Eastern lead with no data_lead: created_at is the next UTC day
  ins("a", "c1", null, "2026-10-28 01:00:00");
  // 11:30 PM Eastern lead with no data_lead
  ins("b", "c1", "", "2026-10-28 03:30:00");
  // has a local wall clock stamp: counts on that day for any zone, even though created_at is Oct 28 UTC
  ins("c", "c1", "2026-10-27T20:35", "2026-10-28 00:35:00", { contato: "2026-10-27T20:50" });
  // another day
  ins("x", "c1", "2026-10-26T10:00", "2026-10-26 14:00:00");
  // another client, same day: must never leak
  ins("z", "c2", "2026-10-27T09:00", "2026-10-27 13:00:00");

  r = await call("c1", "America/New_York", "2026-10-27");
  eq(r.data.suggestions.leads_gerados, 3, "NY Oct 27: undated 9 PM, undated 11:30 PM and 20:35 stamped lead all count");
  eq(r.data.lead_names.length, 3, "lead_names agrees with leads_gerados (3)");
  eq(r.data.lead_names_more, 0, "lead_names_more is 0");
  ok(r.data.lead_names.every((n) => n.id && n.cliente && Object.keys(n).length === 2), "lead_names items are {id, cliente} only");
  ok(r.data.lead_names.every((n) => n.id !== "z"), "other client's lead is not listed");
  r = await call("c1", "America/New_York", "2026-10-28");
  eq(r.data.suggestions.leads_gerados, 0, "NY Oct 28: the 11:30 PM lead is NOT on the next day (0 is a real answer)");
  eq(r.data.lead_names.length, 0, "Oct 28 has no names");

  r = await call("c1", "America/Los_Angeles", "2026-10-27");
  eq(r.data.suggestions.leads_gerados, 3, "LA Oct 27: same three leads");
  r = await call("c1", "Pacific/Honolulu", "2026-10-27");
  eq(r.data.suggestions.leads_gerados, 3, "Honolulu Oct 27: same three leads");

  // the same instant lands on different days for different viewers
  ins("e", "c1", null, "2026-10-28 05:30:00");   // 1:30 AM EDT Oct 28 = 10:30 PM PDT Oct 27
  r = await call("c1", "America/New_York", "2026-10-28");
  eq(r.data.suggestions.leads_gerados, 1, "same instant counts on Oct 28 for a New York viewer");
  r = await call("c1", "America/Los_Angeles", "2026-10-28");
  eq(r.data.suggestions.leads_gerados, 0, "same instant does not count on Oct 28 for a Los Angeles viewer");
  r = await call("c1", "America/Los_Angeles", "2026-10-27");
  eq(r.data.suggestions.leads_gerados, 4, "same instant counts on Oct 27 for a Los Angeles viewer");

  // closed sales use the window
  ev("c1", "c", "fechado", "2026-10-28 02:00:00");     // 10 PM EDT Oct 27
  ev("c1", "c", "fechado", "2026-10-27 12:00:00");     // 8 AM EDT Oct 27
  ev("c1", "c", "negociacao", "2026-10-27 15:00:00");  // not a close
  ev("c2", "z", "fechado", "2026-10-27 15:00:00");     // other client
  r = await call("c1", "America/New_York", "2026-10-27");
  eq(r.data.suggestions.vendas_fechadas, 2, "closed sales: both Oct 27 NY closes (one is Oct 28 in UTC)");
  r = await call("c1", "America/New_York", "2026-10-28");
  eq(r.data.suggestions.vendas_fechadas, 0, "closed sales: none on Oct 28 NY");

  // envio_propostas keeps its meaning
  d.raw.exec("UPDATE gm_leads SET data_estimate = '2026-10-27T11:00' WHERE id = 'c'");
  r = await call("c1", "America/New_York", "2026-10-27");
  eq(r.data.suggestions.envio_propostas, 1, "envio_propostas still counts date(data_estimate)");

  // velocidade_resposta: 20:35 -> 20:50 is 0.25 hours
  eq(r.data.suggestions.velocidade_resposta, 0.25, "velocidade_resposta is the average hours, 2 decimals");
  ins("f", "c1", "2026-10-27T10:00", "2026-10-27 14:00:00", { contato: "2026-10-27T11:10" });
  r = await call("c1", "America/New_York", "2026-10-27");
  eq(r.data.suggestions.velocidade_resposta, 0.71, "average of 0.25 h and 1.1667 h = 0.71");

  // entregas_realizadas: null without jobs, a count with them, 0 is a real answer
  d.raw.exec("INSERT INTO gm_jobs (id, client_id, obra, entrega_real) VALUES ('j1','c1','Job 1','2026-10-27')");
  d.raw.exec("INSERT INTO gm_jobs (id, client_id, obra, entrega_real) VALUES ('j2','c1','Job 2','2026-10-26')");
  d.raw.exec("INSERT INTO gm_jobs (id, client_id, obra, entrega_real) VALUES ('j3','c2','Job 3','2026-10-27')");
  r = await call("c1", "America/New_York", "2026-10-27");
  eq(r.data.suggestions.entregas_realizadas, 1, "entregas_realizadas counts this client's jobs delivered that day");
  r = await call("c1", "America/New_York", "2026-10-20");
  eq(r.data.suggestions.entregas_realizadas, 0, "jobs exist, none that day: 0 (a real answer, not null)");

  // lead_names cap
  for (let i = 0; i < 25; i++) { ins("m" + i, "c2", "2026-09-01T10:" + String(i).padStart(2, "0"), "2026-09-01 14:00:00"); }
  r = await call("c2", "America/New_York", "2026-09-01");
  eq(r.data.suggestions.leads_gerados, 25, "25 leads counted");
  eq(r.data.lead_names.length, 20, "lead_names capped at 20");
  eq(r.data.lead_names_more, 5, "lead_names_more says 5 were left out");

  // security: 401, 403, bad date, bad header not echoed
  r = await call("c1", "America/New_York", "2026-10-27", null);
  eq(r.status, 401, "not signed in: 401");
  r = await call("c1", "America/New_York", "2026-10-27", { role: "client", client_id: "c2" });
  eq(r.status, 403, "client of another business: 403");
  r = await call("c1", "America/New_York", "2026-10-27", { role: "client", client_id: "c1" });
  eq(r.status, 200, "the client's own login: 200");
  r = await call("c1", "America/New_York", "not-a-date");
  eq(r.status, 400, "bad date: 400");
  r = await call("c1", "<script>zone</script>", "2026-10-27");
  ok(r.status === 200 && JSON.stringify(r).indexOf("script") < 0, "bad zone header ignored and never echoed");
  const sqlSeen = d.log.join("\n");
  ok(sqlSeen.indexOf("America/") < 0, "no zone name is ever concatenated into SQL");

  // ---- gmInsertLead ----
  const captured = [];
  const stubEnv = { DB: { prepare: (sql) => ({ bind: (...a) => ({ run: async () => { captured.push({ sql, a }); } }) }) } };
  await F.gmInsertLead(stubEnv, "c1", { cliente: "No date", estagio: "novo_lead" }, "tester", "America/Los_Angeles");
  const sql0 = captured[0].sql;
  const cols = sql0.slice(sql0.indexOf("(") + 1, sql0.indexOf(")")).split(",").map((s) => s.trim());
  const at = (i) => captured[i].a[cols.indexOf("data_lead")];
  ok(/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(at(0)), "gmInsertLead stamps a missing data_lead: " + at(0));
  await F.gmInsertLead(stubEnv, "c1", { cliente: "Blank", estagio: "novo_lead", data_lead: "   " }, "tester", "America/New_York");
  ok(/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(at(1)), "gmInsertLead stamps a blank data_lead: " + at(1));
  await F.gmInsertLead(stubEnv, "c1", { cliente: "Given", estagio: "novo_lead", data_lead: "2026-10-27T20:35" }, "tester", "America/New_York");
  eq(at(2), "2026-10-27T20:35", "gmInsertLead keeps a given data_lead untouched");
  await F.gmInsertLead(stubEnv, "c1", { cliente: "Null", estagio: "novo_lead", data_lead: null }, "tester");
  ok(/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(at(3)), "gmInsertLead stamps null data_lead even with no zone argument (New York last)");

  // ---- portal: the real functions from portal.html on a small fake page ----
  const portalSrc = readFileSync(new URL("../portal.html", import.meta.url), "utf8");
  const pfn = (name) => {
    const i = portalSrc.indexOf("\n    function " + name + "(");
    if (i < 0) { throw new Error("portal.html has no function " + name); }
    const j = portalSrc.indexOf("\n    }\n", i);
    return portalSrc.slice(i + 1, j + 7);
  };
  const tiles = {};
  const mkTile = (key, val) => {
    const tile = { html: "", parts: [], insertAdjacentHTML: function (w, h) { this.html += h; }, querySelector: function (sel) { return this.html.indexOf(sel.slice(1)) >= 0 ? { remove: () => { this.html = this.html.replace(/<div class="tile-leadnames">.*?<\/div>/, ""); } } : null; } };
    tile.input = { id: "field_" + key, value: val, parentNode: tile };
    tiles[key] = tile;
  };
  mkTile("leads_gerados", "");
  mkTile("envio_propostas", "");
  mkTile("vendas_fechadas", "7");     // typed by the person, field has focus
  mkTile("pipeline_ativo", "0");      // a saved zero
  const fakeDoc = { activeElement: tiles.vendas_fechadas.input, getElementById: (id) => { const k = id.replace("field_", ""); return tiles[k] ? tiles[k].input : null; } };
  let rendered = 0;
  const P = new Function("document", "escHtml", "isEn", "formSections", "currentSectionIdx", "currentEntryDate", "apiFetch", "clientId",
    "indicatorsForSection", "renderFormSection",
    "var entrySuggestions = {}; var entryLeadNames = []; var entryLeadNamesMore = 0;\n" +
    ["suggestChipHtml", "noSuggestHtml", "injectSuggestionChips", "injectLeadNames", "loadEntrySuggestions"].map(pfn).join("\n") +
    "\nreturn { run: loadEntrySuggestions, state: function() { return entrySuggestions; } };");
  const esc = (x) => String(x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const payload = { suggestions: { leads_gerados: 3, envio_propostas: null, vendas_fechadas: 2, pipeline_ativo: 0 },
                    lead_names: [{ id: "1", cliente: "Ana <b>X</b>" }, { id: "2", cliente: "Bob" }], lead_names_more: 4 };
  const run = (en) => {
    for (const k in tiles) { tiles[k].html = ""; }
    const pg = P(fakeDoc, esc, () => en, ["clientes_mercado"], 0, "2026-10-27",
      async () => ({ ok: true, json: async () => payload }), "c1",
      () => Object.keys(tiles).map((k) => ({ key: k, type: "count" })), () => { rendered++; });
    pg.run("2026-10-27");
    return new Promise((res) => setTimeout(res, 30));   // the portal does not return its promise
  };
  await run(false);
  ok(tiles.leads_gerados.html.indexOf("O pipeline indica 3") >= 0, "portal (PT): chip drawn on the empty tile while another field has focus");
  ok(tiles.envio_propostas.html.indexOf("Nada no sistema") >= 0, "portal (PT): null suggestion says Nada no sistema");
  ok(tiles.vendas_fechadas.html === "" && tiles.vendas_fechadas.input.value === "7", "portal: the focused field with typed text gets no chip and keeps its text");
  ok(tiles.pipeline_ativo.html === "" && tiles.pipeline_ativo.input.value === "0", "portal: a saved 0 gets no chip and stays 0");
  ok(tiles.leads_gerados.html.indexOf("Leads de hoje no pipeline: Ana &lt;b&gt;X&lt;/b&gt;, Bob e mais 4") >= 0, "portal (PT): names line, escaped, with 'e mais 4'");
  eq(rendered, 0, "portal: arriving suggestions never call renderFormSection");
  await run(true);
  ok(tiles.leads_gerados.html.indexOf("Pipeline says 3") >= 0 && tiles.leads_gerados.html.indexOf("Today's leads in the pipeline: Ana &lt;b&gt;X&lt;/b&gt;, Bob and 4 more") >= 0, "portal (EN): chip and names line");
  ok(tiles.envio_propostas.html.indexOf("Nothing in the system") >= 0, "portal (EN): Nothing in the system");

  console.log("\n" + (fail ? fail + " failing" : "all passing"));
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.log("FAIL  test crashed: " + e.stack); process.exit(1); });
