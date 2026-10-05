// Online booking: the REAL bk* functions cut from worker/index.js, run against an
// in-memory SQLite with the real tables. No network, no live data.
//
//   node scripts/test-booking.mjs
import { makeDb, build, baseStubs, workerSrc, fnSrc } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };

const MIG = [
  "migrations/gm_growth_management.sql", "migrations/gm_events.sql", "migrations/gm_config_event_types.sql", "migrations/gm_event_types_keys.sql",
  "migrations/gm_lead_events.sql", "migrations/gm_leads_address.sql", "migrations/gm_leads_servico_desc_financiamento.sql",
  "migrations/gm_leads_costs_commission.sql", "migrations/gm_leads_stage_keys.sql", "migrations/customer_referrals.sql",
  "migrations/gm_lead_contacts.sql", "migrations/gm_lead_events.sql",
  "migrations/client_estimates_invoices_p1.sql", "migrations/client_estimates_invoices_p1b.sql", "migrations/hero_gallery_doc_settings.sql",
  "migrations/hero_flip.sql", "migrations/gm_booking.sql"
];

// every top-level bk* function in the block, plus the helpers it reuses
const blockStart = workerSrc.indexOf("// \"Agendamento online\"");
const blockEnd = workerSrc.indexOf("// \"Enviar horarios\"");
if (blockStart < 0 || blockEnd < 0) { console.log("FAIL  booking block not found"); process.exit(1); }
const block = workerSrc.slice(blockStart, blockEnd);
const names = [...block.matchAll(/^(?:async )?function ((?:bk|handle\w*Booking)\w*)\(/gm)].map((m) => m[1]);
const helpers = ["schedMinutes", "schedHHMM", "schedAddDays", "schedDayOfWeek", "fmtTime12", "tzOffsetMs", "tzShortLabel", "gmStr", "gmNum", "gmDateStr", "gmTimeStr",
  "gmReferralSlug", "gmEstNewToken", "gmNyNowParts", "gmOwnedRow", "gmInsertLead", "gmLogLeadEvents", "gmGetConfig", "gmParseJsonList", "gmParseJsonListNonEmpty", "gmDocSettingsOwnerOnly", "sessionSellerName", "sellerCanActOnLead", "logoVersionParam"];
const vars = ["BK_STEP_MIN", "BK_ACTOR", "BK_QTYPES", "BK_PRESETS", "BK_INACTIVE", "BRAZIL_TZ_LABELS", "GM_LEAD_COST_FIELDS", "GM_LEAD_LOGGED_FIELDS", "GM_MONTH_NAMES_PT", "GM_DEFAULT_FINANCE_CATEGORIES", "GM_DEFAULT_VIEW_THRESHOLD", "APEX_TIMEZONE", "DEFAULT_ORIGIN"];

function world() {
  const d = makeDb(MIG);
  // gm_leads.imposto is live but has no migration file in the repo
  try { d.raw.exec("ALTER TABLE gm_leads ADD COLUMN imposto REAL"); } catch (e) { /* already there */ }
  d.raw.exec("INSERT INTO clients (id, name, phone, language, timezone) VALUES ('c1', 'Shine Cleaning', '555-0100', 'en', 'America/New_York')");
  d.raw.exec("INSERT INTO clients (id, name, phone, language, timezone) VALUES ('c2', 'Other Co', '555-0200', 'pt', 'America/New_York')");
  d.raw.exec("INSERT INTO gm_config (client_id, event_types_json, cycle_months_json) VALUES ('c1', '[{\"key\":\"reuniao\",\"pt\":\"Reuniao\",\"en\":\"Meeting\"},{\"key\":\"visita_tecnica\",\"pt\":\"Visita\",\"en\":\"Visit\"}]', '[]')");
  const pushes = [];
  const stubs = Object.assign({}, baseStubs, {
    jsonErr2: (pt, en, status, extra) => Object.assign({ status: status, error: en, error_pt: pt, error_en: en }, extra || {}),
    gmDocSettingsRow: async () => ({ legal_name: null, phone: null, brand_primary: "#112233", brand_accent: null }),
    gmDocHero: () => ({ url: null, hero: null }),
    gmClientPushTargets: async (env, cid, who) => ["owner@x.test"].concat(who && who.seller_name ? ["login:" + who.seller_name] : []),
    pushToUsers: async (env, emails, p) => { pushes.push({ emails, p }); },
    requireClientAccess: () => true,
    publicWriteRateLimit: async () => null, publicReadRateLimited: () => false,
    PUBLIC_LIMIT_MESSAGE: "limit", gmDocHexColor: (x) => x
  });
  const F = build(names.concat(helpers), vars, stubs);
  return { d, env: { DB: d.DB }, F, pushes };
}

const TZ = "America/New_York";
// Monday 10/05/2026 8:00 AM Eastern (EDT = UTC-4)
const NOW = Date.UTC(2026, 9, 5, 12, 0, 0);
const S = { work_days: [1, 2, 3, 4, 5], day_start: "09:00", day_end: "17:00", duration_min: 60, min_notice_hours: 24, daily_cap: 4, window_days: 14 };
const inst = (F, date, hhmm) => F.bkTzInstant(date, hhmm, TZ);

// ---- the slot function ----
{
  const { F } = world();
  const slots = F.bkComputeSlots(S, { blocks: [], perDay: {} }, NOW, TZ);
  const dates = slots.map((x) => x.date);
  ok(!dates.includes("2026-10-10") && !dates.includes("2026-10-11"), "slots: Saturday and Sunday are not offered");
  ok(!dates.includes("2026-10-05"), "slots: nothing today (24 hour notice from 8:00 AM Monday)");
  ok(dates[0] === "2026-10-06" && slots[0].times[0] === "09:00" && slots[0].times[slots[0].times.length - 1] === "16:00", "slots: first day is Tuesday 09:00 to 16:00 (last start fits the 60 minute visit before 5:00 PM)");
  ok(slots[0].times.length === 15, "slots: 30 minute steps (15 starts between 9:00 and 4:00)");
  ok(dates[dates.length - 1] === "2026-10-19", "slots: the window ends 14 days ahead (10/19)");
  const notice = F.bkComputeSlots(Object.assign({}, S, { min_notice_hours: 26 }), { blocks: [], perDay: {} }, NOW, TZ);
  ok(notice[0].date === "2026-10-06" && notice[0].times[0] === "10:00", "slots: notice of 26 hours pushes Tuesday's first start to 10:00");
  const ev = [{ start: inst(F, "2026-10-06", "10:00"), end: inst(F, "2026-10-06", "11:00") }];
  const blocked = F.bkComputeSlots(S, { blocks: ev, perDay: {} }, NOW, TZ);
  const t = blocked[0].times;
  ok(!t.includes("09:30") && !t.includes("10:00") && !t.includes("10:30") && t.includes("09:00") && t.includes("11:00"), "slots: a timed block 10-11 removes every 60 minute start that overlaps it (9:30, 10:00, 10:30)");
  const capped = F.bkComputeSlots(S, { blocks: [], perDay: { "2026-10-06": 4 } }, NOW, TZ);
  ok(capped[0].date === "2026-10-07", "slots: a day already holding daily_cap booked visits is not offered");
}

// ---- the busy picture from the database ----
{
  const { d, env, F } = world();
  d.raw.exec("INSERT INTO gm_events (id, client_id, event_type, title, event_date, start_time, end_time, all_day) VALUES ('e1','c1','reuniao','Timed','2026-10-06','10:00','11:00',0)");
  d.raw.exec("INSERT INTO gm_events (id, client_id, event_type, title, event_date, all_day) VALUES ('e2','c1','outro','All day','2026-10-07',1)");
  d.raw.exec("INSERT INTO gm_events (id, client_id, event_type, title, event_date, start_time, end_time, all_day) VALUES ('e3','c2','reuniao','Other business','2026-10-08','10:00','11:00',0)");
  d.raw.exec("INSERT INTO gm_leads (id, client_id, cliente, data_estimate, estagio) VALUES ('lv','c1','Visit Lead','2026-10-08T14:00','visita_agendada')");
  d.raw.exec("INSERT INTO gm_jobs (id, client_id, obra, inicio) VALUES ('j1','c1','Job','2026-10-09')");
  const s = F.bkNormSettings({ enabled: 1 });
  const slots = await F.bkOpenSlots(env, "c1", s, TZ, {}, NOW);
  const by = (dt) => (slots.find((x) => x.date === dt) || { times: [] }).times;
  ok(!by("2026-10-06").includes("10:00") && by("2026-10-06").includes("11:00"), "busy: a timed gm_events row of this business blocks its time");
  ok(by("2026-10-07").length === 15, "busy: an all-day event does not block");
  ok(by("2026-10-08").includes("10:00"), "busy: another business's event does not block");
  ok(!by("2026-10-08").includes("14:00") && !by("2026-10-08").includes("13:30") && by("2026-10-08").includes("15:00"), "busy: a lead's data_estimate visit blocks duration_min from its start");
  ok(by("2026-10-09").length === 15, "busy: a job date does not block");
}

// ---- helpers for a booking world ----
async function leadWorld(opts) {
  const w = world();
  w.d.raw.exec("INSERT INTO gm_booking_settings (client_id, enabled, public_slug, questions_json) VALUES ('c1', 1, 'abcdefghij2345', '" +
    JSON.stringify({ preset: "cleaning", items: w.F.bkPresetItems("cleaning").concat(w.F.bkPresetItems("general")) }).replace(/'/g, "''") + "')");
  w.d.raw.exec("INSERT INTO gm_leads (id, client_id, cliente, telefone, address, origem, estagio, observacao, valor, vendedor, servico) " +
    "VALUES ('L1','c1','MARIA SILVA','(555) 111-2222','12 Oak St','Site','novo_lead','PRIVATE NOTE', 5000, 'Ana', 'Cleaning')");
  const tok = "a".repeat(48);
  w.d.raw.exec("INSERT INTO gm_booking_requests (id, token, client_id, lead_id, kind, status) VALUES ('R1','" + tok + "','c1','L1','lead','waiting')");
  w.tok = tok;
  w.ctx = async (kind, key) => w.F.bkResolve(w.env, kind || "lead", key || tok);
  return w;
}
const body = (over) => Object.assign({ slot_date: "2026-10-06", slot_time: "10:00", customer: { name: "Maria Silva", phone: "(555) 999-0000", email: "maria@x.test", address: "12 Oak St", city: "Tampa" },
  answers: { bedrooms: 3, bathrooms: "2", sqft: 1800, clean_type: "deep", pets: "yes", need_done: "Kitchen and floors" } }, over || {});

// ---- a lead booking end to end ----
{
  const w = await leadWorld();
  const r = await w.F.bkConfirm(w.env, await w.ctx(), body(), NOW);
  ok(r.status === 200 && r.data.booked === true, "lead booking: confirm succeeds");
  const req = w.d.q("SELECT * FROM gm_booking_requests WHERE id = 'R1'")[0];
  ok(req.status === "booked" && req.slot_date === "2026-10-06" && req.slot_time === "10:00" && req.end_time === "11:00", "lead booking: request is booked with the slot and end time");
  const answers = JSON.parse(req.answers_json);
  ok(answers.length === 6 && answers.some((a) => a.key === "bedrooms" && a.value === "3") && answers.some((a) => a.key === "clean_type" && a.value === "deep"), "lead booking: answers stored on the request");
  const ev = w.d.q("SELECT * FROM gm_events WHERE client_id = 'c1' AND lead_id = 'L1'");
  ok(ev.length === 1 && ev[0].id === req.event_id, "lead booking: exactly one calendar entry, its id stored on the request");
  ok(ev[0].event_type === "visita_tecnica" && ev[0].title === "Maria Silva" && ev[0].event_date === "2026-10-06" && ev[0].start_time === "10:00" && ev[0].end_time === "11:00" && ev[0].location === "12 Oak St", "calendar entry: type falls back to visita_tecnica, title is the customer, date and times, location is the address");
  ok(/Bedrooms: 3/.test(ev[0].description) && /Type of cleaning: Deep clean/.test(ev[0].description) && /Pets at home: Yes/.test(ev[0].description), "calendar entry: description is Question: answer lines");
  const lead = w.d.q("SELECT * FROM gm_leads WHERE id = 'L1'")[0];
  ok(lead.data_estimate === "2026-10-06T10:00", "lead: data_estimate set to the chosen date and time");
  ok(lead.estagio === "visita_agendada", "lead: stage moved from novo_lead to visita_agendada");
  ok(lead.email === "maria@x.test" && lead.city === "Tampa" && lead.servico_desc === "Kitchen and floors", "lead: empty email, city and servico_desc filled in");
  ok(lead.telefone === "(555) 111-2222" && lead.address === "12 Oak St", "lead: the business's phone is NOT overwritten by the customer's changed phone");
  ok(lead.observacao === "PRIVATE NOTE", "lead: observacao untouched");
  ok(req.customer_phone === "(555) 999-0000", "request keeps the customer's version of the phone");
  const upd = w.F.bkCustomerUpdates(req, lead);
  ok(upd.length === 1 && upd[0].field === "phone" && upd[0].customer_value === "(555) 999-0000", "customer updated: the changed phone is reported, nothing else");
  const evs = w.d.q("SELECT field, actor FROM gm_lead_events WHERE lead_id = 'L1'");
  ok(evs.some((e) => e.field === "data_estimate" && e.actor === "customer (booking link)") && evs.some((e) => e.field === "estagio") && evs.some((e) => e.field === "email"), "lead history: every change logged with actor 'customer (booking link)'");
  ok(w.pushes.length === 1 && w.pushes[0].p.title === "Visit booked" && w.pushes[0].p.body === "Maria Silva · 10/06/2026 10:00 AM" && w.pushes[0].p.url === "/portal.html?tab=gmcalendar" && w.pushes[0].emails.includes("login:Ana"), "push: owner and the lead's seller get 'Visit booked' with name, MM/DD/YYYY and 12-hour time");
  // the slot is now busy for others
  const open = await w.F.bkOpenSlots(w.env, "c1", (await w.ctx()).settings, TZ, {}, NOW);
  ok(!(open.find((x) => x.date === "2026-10-06") || { times: [] }).times.includes("10:00"), "after booking: the time is no longer offered to anyone else");

  // change time
  const ch = await w.F.bkChange(w.env, await w.ctx(), { slot_date: "2026-10-07", slot_time: "13:00" }, NOW);
  ok(ch.status === 200, "change: succeeds");
  const ev2 = w.d.q("SELECT * FROM gm_events WHERE lead_id = 'L1'");
  ok(ev2.length === 1 && ev2[0].event_date === "2026-10-07" && ev2[0].start_time === "13:00" && ev2[0].end_time === "14:00", "change: the same calendar row moves");
  ok(w.d.q("SELECT data_estimate FROM gm_leads WHERE id='L1'")[0].data_estimate === "2026-10-07T13:00", "change: data_estimate moves");
  const open2 = await w.F.bkOpenSlots(w.env, "c1", (await w.ctx()).settings, TZ, {}, NOW);
  ok((open2.find((x) => x.date === "2026-10-06") || { times: [] }).times.includes("10:00"), "change: the old time is released");

  // cancel
  const ca = await w.F.bkCancel(w.env, await w.ctx());
  ok(ca.status === 200, "cancel: succeeds");
  ok(w.d.q("SELECT * FROM gm_events WHERE lead_id = 'L1'").length === 0, "cancel: the calendar row is deleted");
  const l2 = w.d.q("SELECT data_estimate, estagio FROM gm_leads WHERE id='L1'")[0];
  ok(l2.data_estimate === null && l2.estagio === "visita_agendada", "cancel: data_estimate cleared (it still equalled the booked time), stage not moved back");
  ok(w.d.q("SELECT status FROM gm_booking_requests WHERE id='R1'")[0].status === "cancelled" && w.pushes[w.pushes.length - 1].p.title === "Visit cancelled", "cancel: status cancelled and a 'Visit cancelled' push");
  const view = await w.F.bkPublicView(w.env, await w.ctx(), "https://x.test", NOW);
  ok(view.active === false, "a cancelled link is inactive");
}

// cancel does not clear a visit date the business changed by hand
{
  const w = await leadWorld();
  await w.F.bkConfirm(w.env, await w.ctx(), body(), NOW);
  w.d.raw.exec("UPDATE gm_leads SET data_estimate = '2026-10-12T09:00' WHERE id = 'L1'");
  w.d.raw.exec("DELETE FROM gm_events WHERE lead_id = 'L1'");
  const ca = await w.F.bkCancel(w.env, await w.ctx());
  ok(ca.status === 200 && w.d.q("SELECT data_estimate FROM gm_leads WHERE id='L1'")[0].data_estimate === "2026-10-12T09:00", "cancel: a hand-changed visit date stays, and a deleted calendar entry breaks nothing");
}

// ---- the race ----
{
  const w = await leadWorld();
  w.d.raw.exec("INSERT INTO gm_leads (id, client_id, cliente, telefone, estagio) VALUES ('L2','c1','JOHN DOE','555','novo_lead')");
  w.d.raw.exec("INSERT INTO gm_booking_requests (id, token, client_id, lead_id, kind, status) VALUES ('R2','" + "b".repeat(48) + "','c1','L2','lead','waiting')");
  const c1 = await w.ctx("lead", w.tok), c2 = await w.ctx("lead", "b".repeat(48));
  const b = body({ answers: {} });
  const ra = await w.F.bkConfirm(w.env, c1, b, NOW);
  const rb = await w.F.bkConfirm(w.env, c2, b, NOW);
  ok(ra.status === 200 && rb.status === 409 && rb.extra.taken === true && rb.extra.error === "taken" && Array.isArray(rb.extra.slots) && rb.extra.slots.length > 0, "race: the same slot twice gives one success and one 409 {error:'taken', taken:true} with fresh choices");
  ok(!rb.extra.slots.some((s) => s.date === "2026-10-06" && s.times.includes("10:00")), "race: the fresh choices no longer include the lost time");
  // the unique index itself, past the pre-check
  let threw = false;
  try { w.d.raw.exec("UPDATE gm_booking_requests SET status='booked', slot_date='2026-10-06', slot_time='10:00' WHERE id='R2'"); } catch (e) { threw = true; }
  ok(threw, "race: the unique index refuses a second booked request on the same start time");
  ok(w.d.q("SELECT * FROM gm_events WHERE lead_id = 'L2'").length === 0 && w.d.q("SELECT estagio FROM gm_leads WHERE id='L2'")[0].estagio === "novo_lead", "race: the loser changed nothing on its lead or the calendar");
}

// ---- general link ----
{
  const w = await leadWorld();
  const g = await w.F.bkResolve(w.env, "site", "abcdefghij2345");
  const before = w.d.q("SELECT COUNT(*) AS c FROM gm_leads")[0].c;
  const r = await w.F.bkConfirm(w.env, g, { slot_date: "2026-10-06", slot_time: "11:00", customer: { name: "New Person", phone: "555-123-4567", address: "9 Pine Ave", city: "Miami" },
    answers: { need_done: "Windows" }, website: "", elapsed_ms: 30000 }, NOW);
  ok(r.status === 200 && r.data.booked === true && r.data.token && /^[a-f0-9]{48}$/.test(r.data.token), "general: booking succeeds and gives a token for changing it later");
  const leads = w.d.q("SELECT * FROM gm_leads WHERE cliente = 'New Person'");
  ok(w.d.q("SELECT COUNT(*) AS c FROM gm_leads")[0].c === before + 1 && leads.length === 1, "general: exactly one new lead");
  ok(leads[0].origem === "Site" && leads[0].estagio === "visita_agendada" && leads[0].data_estimate === "2026-10-06T11:00" && leads[0].servico_desc === "Windows" && leads[0].address === "9 Pine Ave", "general: lead has origem 'Site', visit date, address and description (stage moves on from novo_lead as for any booking)");
  const rq = w.d.q("SELECT * FROM gm_booking_requests WHERE kind = 'general'")[0];
  ok(rq.lead_id === leads[0].id && rq.status === "booked", "general: the request points at the new lead");
  ok(w.d.q("SELECT * FROM gm_events WHERE lead_id = ?", leads[0].id).length === 1, "general: one calendar entry");
  // same phone as an existing lead: still a new lead, and nothing in the answer reveals the match
  const r2 = await w.F.bkConfirm(w.env, g, { slot_date: "2026-10-06", slot_time: "14:00", customer: { name: "Maria Again", phone: "(555) 111-2222", address: "1 A St" }, answers: {}, website: "", elapsed_ms: 30000 }, NOW);
  ok(r2.status === 200 && JSON.stringify(r2.data).indexOf("L1") === -1 && w.d.q("SELECT COUNT(*) AS c FROM gm_leads WHERE cliente = 'Maria Again'")[0].c === 1, "general: a known phone number is not matched to the existing lead and nothing is revealed");

  // honeypot and too-fast
  const n0 = w.d.q("SELECT COUNT(*) AS c FROM gm_leads")[0].c, r0 = w.d.q("SELECT COUNT(*) AS c FROM gm_booking_requests")[0].c;
  const hp = await w.F.bkConfirm(w.env, g, { slot_date: "2026-10-07", slot_time: "10:00", customer: { name: "Bot", phone: "555-000-1111", address: "x" }, website: "http://spam", elapsed_ms: 30000 }, NOW);
  const fast = await w.F.bkConfirm(w.env, g, { slot_date: "2026-10-07", slot_time: "11:00", customer: { name: "Bot2", phone: "555-000-1111", address: "x" }, website: "", elapsed_ms: 800 }, NOW);
  ok(hp.status === 200 && fast.status === 200 && w.d.q("SELECT COUNT(*) AS c FROM gm_leads")[0].c === n0 && w.d.q("SELECT COUNT(*) AS c FROM gm_booking_requests")[0].c === r0, "spam: the honeypot and a too-fast fill look like success but create nothing");
  const noPhone = await w.F.bkConfirm(w.env, g, { slot_date: "2026-10-07", slot_time: "12:00", customer: { name: "No Phone", address: "x" }, elapsed_ms: 30000 }, NOW);
  ok(noPhone.status === 400, "general: name and phone are required");
}

// ---- the public payload ----
{
  const w = await leadWorld();
  const v = await w.F.bkPublicView(w.env, await w.ctx(), "https://x.test", NOW);
  const json = JSON.stringify(v);
  ok(!/"(observacao|valor|vendedor|estagio|comissao)"/.test(json) && json.indexOf("PRIVATE NOTE") === -1 && json.indexOf("Ana") === -1, "payload: none of observacao, valor, vendedor, estagio, comissao (nor their values)");
  ok(v.active && v.kind === "lead" && v.customer.first_name === "Maria" && v.customer.address === "12 Oak St" && v.service === "Cleaning" && v.tz_label === "EDT" && v.business.name === "Shine Cleaning" && v.business.phone === "555-0100", "payload: first name, what the business knows, zone label, business name and phone");
  ok(JSON.stringify(Object.keys(v).sort()) === JSON.stringify(["active", "booking", "business", "customer", "duration_min", "kind", "language", "questions", "service", "slots", "status", "tz", "tz_label"]), "payload: the exact key list");
  ok(v.questions.length === 7 && v.questions.filter((q) => q.key === "need_done")[0].value === "", "payload: the questions from the settings");
  w.d.raw.exec("UPDATE gm_leads SET servico_desc = 'Move out clean' WHERE id = 'L1'");
  const v2 = await w.F.bkPublicView(w.env, await w.ctx(), "https://x.test", NOW);
  ok(v2.questions.filter((q) => q.key === "need_done")[0].value === "Move out clean", "payload: 'What do you need done?' is shown filled in when the lead has servico_desc");
}

// ---- booking off ----
{
  const w = await leadWorld();
  w.d.raw.exec("UPDATE gm_booking_settings SET enabled = 0 WHERE client_id = 'c1'");
  const c = await w.ctx();
  const v = await w.F.bkPublicView(w.env, c, "https://x.test", NOW);
  ok(v.active === false && !v.slots && v.business.phone === "555-0100", "off: the public view says inactive (with the business phone), no times");
  const r = await w.F.bkConfirm(w.env, c, body(), NOW);
  const g = await w.F.bkResolve(w.env, "site", "abcdefghij2345");
  const r2 = await w.F.bkConfirm(w.env, g, { slot_date: "2026-10-06", slot_time: "10:00", customer: { name: "A", phone: "555-111-2222", address: "x" }, elapsed_ms: 30000 }, NOW);
  ok(r.status === 410 && r2.status === 410 && w.d.q("SELECT status FROM gm_booking_requests WHERE id='R1'")[0].status === "waiting", "off: public booking is refused and nothing changes");
}

// ---- portal routes ----
{
  const w = await leadWorld();
  const user = { role: "client", display_name: "Owner" };
  const seller = { role: "client", login_role: "seller", seller_name: "Bob", display_name: "Bob" };
  const mk = (u, b) => ({ url: "https://x.test/", headers: { get: () => null }, json: async () => b || {} });
  // swap the authenticate stub per call
  const run = async (u, fn, ...args) => { const w2 = w; w2.F.__user = u; return fn(...args); };
  void run;
  const F2 = build(names.concat(helpers), vars, Object.assign({}, baseStubs, {
    authenticate: async () => w.__user, requireClientAccess: () => true,
    jsonErr2: (pt, en, status, extra) => Object.assign({ status: status, error: en }, extra || {}),
    gmDocSettingsRow: async () => ({}), gmDocHero: () => ({}), gmClientPushTargets: async () => [], pushToUsers: async () => {},
    publicWriteRateLimit: async () => null, publicReadRateLimited: () => false, PUBLIC_LIMIT_MESSAGE: "x", gmDocHexColor: (x) => x
  }));
  w.__user = seller;
  const e = { DB: w.d.DB };
  ok((await F2.handleGetGmBookingSettings("c1", mk(), e)).status === 403, "portal: a seller cannot read the booking settings");
  ok((await F2.handlePutGmBookingSettings("c1", mk(seller, { enabled: false }), e)).status === 403, "portal: a seller cannot change the booking settings");
  ok((await F2.handlePostGmLeadBookingLink("c1", "L1", mk(), e)).status === 403, "portal: a seller cannot send a link for a lead that is not theirs");
  w.d.raw.exec("UPDATE gm_leads SET vendedor = 'Bob' WHERE id = 'L1'");
  const linkRes = await F2.handlePostGmLeadBookingLink("c1", "L1", mk(), e);
  ok(linkRes.status === 200 && linkRes.data.url === "https://apex.resonateai.online/book.html?t=" + w.tok && w.d.q("SELECT COUNT(*) AS c FROM gm_booking_requests WHERE lead_id='L1'")[0].c === 1, "portal: a seller sends the link for their own lead; the still-waiting request is reused");
  ok((await F2.handlePostGmLeadBookingLink("c1", "L1", mk(), { DB: w.d.DB })).data.request.id === "R1", "portal: asking again returns the same request");
  ok((await F2.handlePostGmLeadBookingLink("c2", "L1", mk(), e)).status === 404, "portal: another business's lead is not found");
  const sent = await F2.handlePostGmLeadBookingSent("c1", "L1", mk(), e);
  ok(sent.status === 200 && w.d.q("SELECT sent_at FROM gm_booking_requests WHERE id='R1'")[0].sent_at, "portal: sending marks sent_at");
  w.__user = user;
  const put = await F2.handlePutGmBookingSettings("c1", mk(user, { enabled: true, work_days: [1, 2, 3], day_start: "08:00", day_end: "16:00", duration_min: 90, questions: { preset: "general", items: F2.bkPresetItems("general").concat([{ key: "gate", label_pt: "Codigo", label_en: "Gate code", type: "text", enabled: true }]) } }), e);
  const row = w.d.q("SELECT * FROM gm_booking_settings WHERE client_id='c1'")[0];
  ok(put.status === 200 && row.work_days === "1,2,3" && row.day_start === "08:00" && row.duration_min === 90 && row.enabled === 1 && row.public_slug === "abcdefghij2345", "portal: the owner saves the settings; the general link slug stays the same");
  ok(JSON.parse(row.questions_json).items.length === 2, "portal: custom questions are saved");
  const bad = await F2.handlePutGmBookingSettings("c1", mk(user, { day_start: "16:00", day_end: "09:00" }), e);
  ok(bad.status === 400, "portal: an end time before the start time is refused");
  const fresh = await F2.handleGetGmBookingSettings("c2", mk(), e);
  ok(fresh.status === 200 && fresh.data.settings.enabled === false, "portal: a business with no row reads as OFF");
}

// ---- wiring in the Worker source ----
{
  const src = workerSrc;
  ok(/public\\\/\(estimates\|[^)]*\|booking\)/.test(src), "worker: PUBLIC_DOC_PATH_RE covers /api/public/booking/");
  ok(/gmRest === "booking-settings"/.test(src) && /booking-\(link\|sent\)/.test(src), "worker: portal routes are in clientRequestAllowed");
  ok(/gm\\\/leads\\\/\[A-Za-z0-9-\]\+\\\/booking\$/.test(src) && !/rest === "gm\/booking-settings"/.test(src), "worker: sellers get the lead booking routes only, never the settings");
  ok(/segs\[6\] === "booking-link"/.test(src) && /handlePublicBooking\(pubBook/.test(src), "worker: routes are dispatched");
}

console.log(fail ? "\n" + fail + " FAILED" : "\nAll checks passed.");
process.exit(fail ? 1 : 0);
