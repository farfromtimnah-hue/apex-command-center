// Apex Club registration and payments, against the REAL Worker functions on an
// in-memory SQLite (see scripts/fixtures/d1-shim.mjs). No network.
//
//   node scripts/test-apex-club.mjs
import { readFileSync } from "node:fs";
import { makeDb, build, baseStubs, req, hasFn, workerSrc } from "./fixtures/d1-shim.mjs";

const root = new URL("../", import.meta.url);
const MIGS = ["migrations/apex_club_company.sql", "migrations/apex_invoice_public.sql", "migrations/apex_club_pay.sql"];
let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) { fail++; } };
const stubs = Object.assign({}, baseStubs, { crypto: globalThis.crypto });

function seedEvent(d, id, extra) {
  const e = Object.assign({ single: 5000, couple: 7500, open: 1 }, extra || {});
  d.raw.prepare("INSERT INTO apex_club_events (id, name, event_date, window_start, window_end, price_single_cents, price_couple_cents, registration_open) VALUES (?, ?, '2026-10-20', '2026-10-06', '2026-10-27', ?, ?, ?)")
    .run(id, "Apex Club " + id, e.single, e.couple, e.open);
}

// ── Phase 1: the business name on the registration ─────────────────────────
{
  const d = makeDb(MIGS); const env = { DB: d.DB };
  const names = ["normalizeUsPhone", "handlePostClubRegister"].concat(hasFn("gmEstNewToken") ? ["gmEstNewToken"] : []);
  const F = build(names, [], stubs);
  seedEvent(d, "ev1");
  const reg = (body) => F.handlePostClubRegister("ev1", req(body), env);
  const row = (phone) => d.q("SELECT name, company, plus_one, rsvp_state, source FROM apex_club_registrations WHERE phone = ?", phone)[0];

  let r = await reg({ name: "Maria Silva", phone: "(813) 555-0100", plus_one: false, company: "  Silva Flooring LLC  " });
  ok(r.status === 200 && r.data.registered === true && row("18135550100").company === "Silva Flooring LLC", "a registration with a company stores it, trimmed");
  r = await reg({ name: "Maria Silva", phone: "8135550100", plus_one: true, company: "" });
  ok(r.status === 200 && row("18135550100").company === "Silva Flooring LLC" && row("18135550100").plus_one === 1, "re-registering with a blank company keeps the stored one (and still updates the plus one)");
  r = await reg({ name: "Maria Silva", phone: "8135550100", plus_one: true, company: "   " });
  ok(row("18135550100").company === "Silva Flooring LLC", "a whitespace-only company never erases the stored one");
  r = await reg({ name: "Maria S.", phone: "8135550100", company: "Silva Tile Inc" });
  ok(row("18135550100").company === "Silva Tile Inc" && row("18135550100").name === "Maria S.", "re-registering with a new company replaces it");
  r = await reg({ name: "Carlos Souza", phone: "8135550101", plus_one: false });
  ok(r.status === 200 && r.data.registered === true && row("18135550101").company === null, "a registration posted WITHOUT a company key still succeeds, company NULL");
  r = await reg({ name: "Ana Lima", phone: "8135550102", company: "x".repeat(300) });
  ok(row("18135550102").company.length === 120, "company is capped at 120 characters");
  d.raw.prepare("UPDATE apex_club_registrations SET rsvp_state = 'next_time' WHERE phone = '18135550101'").run();
  r = await reg({ name: "Carlos Souza", phone: "8135550101" });
  ok(row("18135550101").rsvp_state === "going" && row("18135550101").source === "public", "re-registering still resets next_time to going");
  ok((await reg({ name: "A", phone: "8135550103", company: "Co" })).status === 400, "the name rule is unchanged (400)");
  ok((await reg({ name: "Ana", phone: "123", company: "Co" })).status === 400, "the phone rule is unchanged (400)");
  ok(d.q("SELECT COUNT(*) AS n FROM apex_club_registrations")[0].n === 3, "one row per phone (idempotent)");
  d.raw.prepare("UPDATE apex_club_events SET registration_open = 0 WHERE id = 'ev1'").run();
  ok((await reg({ name: "Late", phone: "8135550104", company: "Co" })).status === 403, "a closed event still refuses (403)");
  ok((await F.handlePostClubRegister("nope", req({ name: "Late", phone: "8135550104" }), env)).status === 404, "an unknown event is still 404");
}

// The client-portal Club invite never gains a column; the calendar view gains
// company and nothing about money.
{
  const inv = workerSrc.slice(workerSrc.indexOf("async function gmClubInviteEvents("), workerSrc.indexOf("\n}", workerSrc.indexOf("async function gmClubInviteEvents(")));
  ok(/"SELECT id, name, event_date, start_time, venue, speakers, flyer_r2_key " \+\s*"FROM apex_club_events/.test(inv) && !/company|price|paid|pay_token|zelle/i.test(inv.replace(/\/\/[^\n]*/g, "")),
    "gmClubInviteEvents still selects its seven explicit columns, nothing about company, price or payment");
  const by = workerSrc.slice(workerSrc.indexOf("async function handleGetClubBySession("), workerSrc.indexOf("\n}", workerSrc.indexOf("async function handleGetClubBySession(")));
  const regSel = (by.match(/"SELECT id, name, phone[^"]*"/) || [""])[0];
  ok(/company/.test(regSel) && !/paid|pay_token|zelle|cents/.test(regSel), "by-session guest SELECT has company and no paid or payment column: " + regSel);
}

// club.html: the form contract iOS AutoFill needs.
{
  const html = readFileSync(new URL("club.html", root), "utf8");
  ok(/<label for="empresa">Empresa<\/label>\s*<input id="empresa" name="empresa" type="text"\s+autocomplete="organization" autocapitalize="words"\s+placeholder="Nome da sua empresa" required>/.test(html), "club.html has the Empresa field with a real label and the organization token");
  ok(html.indexOf('<label for="nome">') < html.indexOf('<label for="empresa">') && html.indexOf('<label for="empresa">') < html.indexOf('<label for="tel">'), "Empresa sits right after Nome, before WhatsApp");
  ok(/autocomplete="name"/.test(html) && /type="tel"\s+autocomplete="tel"/.test(html) && /<form id="regForm" novalidate>/.test(html) && /<button type="submit"/.test(html), "name and tel tokens, the real form and the submit are intact");
  ok(html.indexOf("Escreva o nome da empresa.") > 0 && /company: empresa/.test(html), "client validation message and company in the POST body");
}

// ════════════════════════════════════════════════════════════════════════
// Phase 5: prices, pay screen, card
// ════════════════════════════════════════════════════════════════════════
const TOK = (ch) => ch.repeat(48);
function fakeStripe() {
  const calls = []; const alerts = []; let n = 0;
  return { calls, alerts,
    apxStripePost: async (env, path, params) => { calls.push({ path, params: Object.fromEntries(params) }); n++;
      if (path === "prices") { return { id: "price_" + n }; }
      if (path === "payment_links") { return { id: "plink_" + n, url: "https://buy.stripe.com/test_" + n }; }
      return { id: path.split("/")[1], active: false }; },
    notifyNicoleTelegram: async (env, msg) => { alerts.push(msg); } };
}
const clubFns = ["normalizeUsPhone", "gmEstNewToken", "apexClubMemoHit", "addInterval", "apxInvSwitches", "apxInvNoIndex", "apxUsd", "apxPayLockTake", "apxPayLockRelease",
  "clubCardPriceFromZelle", "clubPriceFor", "parseClubPrices", "parseClubCardPrices", "clubRegByToken", "clubPayPayload", "clubPayGuard", "clubRetirePayLinks", "clubCardTotals",
  "handlePostClubRegister", "handleGetClubPay", "handlePostClubPayCard", "applyStripeChargesToClubRegistrations", "buildApexClubEventPL",
  "handlePostFinanceNewClubEvent", "handlePutFinanceNewClubEvent", "handlePostClubRegPayLink", "handlePostClubRegMarkPaid"]
  .concat(["clubZelleNormalize", "clubZellePayerTokens", "clubZelleNameTokens", "clubZelleNamesOverlap", "clubZelleEvaluate", "clubZelleCandidates", "clubZelleApply", "matchClubZelleConf", "clubZelleRetry",
    "handlePostClubPayZelleConf", "handlePostClubRegZelleDecision", "confNumber"].filter(hasFn));
const clubVars = ["APEX_CLUB_PRICE_SINGLE", "APEX_CLUB_PRICE_COUPLE"];
function clubWorld(extraStubs) {
  const d = makeDb(MIGS); const st = fakeStripe();
  d.raw.exec("INSERT INTO business_settings (id, zelle_handle, zelle_qr_r2_key, club_pay_enabled) VALUES (1, 'pay@apex.test', 'business/zelle-qr.png', 1)");
  d.raw.exec("INSERT INTO accounts (id, purpose) VALUES ('acct_biz', 'business'), ('acct_personal', 'personal')");
  const F = build(clubFns, clubVars, Object.assign({}, baseStubs, { crypto: globalThis.crypto, DEFAULT_ORIGIN: "https://apex.test", APX_CLUB_CARD_AVAILABLE: true,
    gmEstPublicRateLimit: async () => null, REQUEST_CTX: new WeakMap(), apxStripePost: st.apxStripePost, notifyNicoleTelegram: st.notifyNicoleTelegram,
    apxStripeRefreshCharges: async () => 0 }, extraStubs || {}));
  return { d, env: { DB: d.DB }, st, F };
}
const setCard = (d, id, single, couple) => d.raw.prepare("UPDATE apex_club_events SET price_card_single_cents = ?, price_card_couple_cents = ? WHERE id = ?").run(single, couple, id);

{
  const { d, env, st, F } = clubWorld();
  ok(F.clubCardPriceFromZelle(5000) === 5200 && F.clubCardPriceFromZelle(7500) === 7800 && F.clubCardPriceFromZelle(100) === 200 && F.clubCardPriceFromZelle(8000) === 8300, "clubCardPriceFromZelle: 5000 gives 5200, 7500 gives 7800, 100 gives 200 (rounded UP to a whole dollar)");
  const E = (o) => Object.assign({ price_single_cents: 5000, price_couple_cents: 7500, price_card_single_cents: null, price_card_couple_cents: null }, o);
  ok(JSON.stringify(F.clubPriceFor(E({}), false)) === JSON.stringify({ seats: 1, zelle_cents: 5000, card_cents: null, discount_cents: 0 }), "clubPriceFor single, no card: Zelle 5000, card null");
  ok(F.clubPriceFor(E({}), true).zelle_cents === 7500 && F.clubPriceFor(E({ price_couple_cents: null }), true).zelle_cents === 10000, "couple: the couple rate when there is one, else twice the single price");
  let p = F.clubPriceFor(E({ price_card_single_cents: 5200, price_card_couple_cents: 7800 }), false);
  ok(p.card_cents === 5200 && p.discount_cents === 200, "card single 5200, Zelle discount 200");
  p = F.clubPriceFor(E({ price_card_single_cents: 5200, price_card_couple_cents: 7800 }), true);
  ok(p.card_cents === 7800 && p.zelle_cents === 7500 && p.discount_cents === 300 && p.seats === 2, "card couple 7800 against Zelle 7500");
  ok(F.clubPriceFor(E({ price_card_single_cents: 5200 }), true).card_cents === 10400, "only a single card price: a couple pays twice it by card");

  // The three copies of the card-price formula are the same function.
  const mirror = (file) => { const src = readFileSync(new URL(file, root), "utf8"); const i = src.indexOf("function clubCardPriceFromZelle("); return src.slice(i, src.indexOf("}", src.indexOf("return Math.ceil", i)) + 1).replace(/\s+/g, " "); };
  const w = workerSrc.slice(workerSrc.indexOf("function clubCardPriceFromZelle("), workerSrc.indexOf("\n}", workerSrc.indexOf("function clubCardPriceFromZelle(")) + 2).replace(/\s+/g, " ");
  ok(mirror("finance-new.html") === w && mirror("calendar.html") === w, "the event forms mirror the Worker's clubCardPriceFromZelle exactly");

  // For an event with no card price, the page's own Zelle computation and clubPriceFor agree.
  const pageZelle = (ev, plusOne) => (plusOne && ev.price_couple_cents) ? ev.price_couple_cents : (plusOne ? ev.price_single_cents * 2 : ev.price_single_cents);   // club.html done()
  let agree = true;
  for (const ev of [E({}), E({ price_couple_cents: null }), E({ price_single_cents: 8000, price_couple_cents: 15000 })]) { for (const po of [false, true]) { if (pageZelle(ev, po) !== F.clubPriceFor(ev, po).zelle_cents) { agree = false; } } }
  const html = readFileSync(new URL("club.html", root), "utf8");
  ok(agree && /if \(plusOne && EV\.price_couple_cents\) \{\s*\$\("payPrice"\)\.textContent = money\(EV\.price_couple_cents\);[\s\S]*?else if \(plusOne\) \{[\s\S]*?money\(EV\.price_single_cents \* 2\)/.test(html), "events with no card price: club.html done() and clubPriceFor compute the same Zelle amount (single, couple rate, no couple rate)");

  // Event form: card prices saved, NULLed, validated; registration_open preserved.
  let r = await F.handlePostFinanceNewClubEvent(req({ name: "Jantar", event_date: "2026-11-20", price_single_cents: 5000, price_couple_cents: 7500, price_card_single_cents: 5200, price_card_couple_cents: 7800 }), env);
  const evId = r.data.event.id;
  const evRow = () => d.q("SELECT price_single_cents, price_couple_cents, price_card_single_cents, price_card_couple_cents, registration_open FROM apex_club_events WHERE id = ?", evId)[0];
  ok(r.status === 200 && evRow().price_card_single_cents === 5200 && evRow().price_card_couple_cents === 7800, "creating an event saves the card prices");
  r = await F.handlePostFinanceNewClubEvent(req({ name: "Sem cartão", event_date: "2026-11-21" }), env);
  ok(r.data.event.price_card_single_cents === null && r.data.event.price_card_couple_cents === null && r.data.event.price_single_cents === 5000, "an event created without card fields has card NULL (not offered)");
  r = await F.handlePutFinanceNewClubEvent(evId, req({ name: "Jantar", event_date: "2026-11-20", price_single_cents: 5000, price_couple_cents: 7500, price_card_single_cents: 4900 }), env);
  ok(r.status === 400 && /cartão precisa ser igual ou maior/.test(r.error) && evRow().price_card_single_cents === 5200, "a card price below the Zelle price is refused with a clear 400");
  r = await F.handlePutFinanceNewClubEvent(evId, req({ name: "Jantar", event_date: "2026-11-20", price_single_cents: 5000, price_couple_cents: 7500, price_card_single_cents: 5200, price_card_couple_cents: 7000 }), env);
  ok(r.status === 400, "a couple card price below the couple Zelle price is refused");
  r = await F.handlePutFinanceNewClubEvent(evId, req({ name: "Jantar", event_date: "2026-11-20", price_single_cents: 5000, price_couple_cents: 7500, price_card_single_cents: -5 }), env);
  ok(r.status === 400, "a negative card price is refused");
  r = await F.handlePutFinanceNewClubEvent(evId, req({ name: "Jantar 2", event_date: "2026-11-20", price_single_cents: 5000, price_couple_cents: 7500 }), env);
  ok(r.status === 200 && evRow().price_card_single_cents === 5200, "an edit that does not mention card prices (an older cached form) keeps them");
  d.raw.prepare("UPDATE apex_club_events SET registration_open = 0 WHERE id = ?").run(evId);
  r = await F.handlePutFinanceNewClubEvent(evId, req({ name: "Jantar 3", event_date: "2026-11-20", price_single_cents: 5000, price_couple_cents: 7500, price_card_single_cents: null, price_card_couple_cents: null }), env);
  ok(evRow().registration_open === 0, "BUG FIX: editing a closed event no longer re-opens its registration");
  ok(evRow().price_card_single_cents === null && evRow().price_card_couple_cents === null, "unticking card saves both card prices as NULL");
  r = await F.handlePutFinanceNewClubEvent(evId, req({ name: "Jantar 3", event_date: "2026-11-20", registration_open: true, price_single_cents: 5000, price_couple_cents: 7500, price_card_single_cents: 5200, price_card_couple_cents: 7800 }), env);
  ok(evRow().registration_open === 1, "an explicit registration_open is still honoured");

  // Registration: token minted, kept, pay block only when switched on with a card price.
  const reg = (body, ev) => F.handlePostClubRegister(ev || evId, req(body), env);
  r = await reg({ name: "Maria Silva", phone: "8135550100", company: "Silva Flooring LLC" });
  const tok1 = d.q("SELECT pay_token FROM apex_club_registrations WHERE phone = '18135550100'")[0].pay_token;
  ok(/^[a-f0-9]{48}$/.test(tok1) && r.data.pay_token === tok1 && JSON.stringify(r.data.pay) === JSON.stringify({ zelle_cents: 5000, card_cents: 5200, discount_cents: 200 }), "registering mints a 48-hex pay token and answers the prices (switch on, card price set)");
  r = await reg({ name: "Maria Silva", phone: "8135550100", plus_one: true });
  ok(d.q("SELECT pay_token FROM apex_club_registrations WHERE phone = '18135550100'")[0].pay_token === tok1 && r.data.pay.card_cents === 7800 && r.data.pay.zelle_cents === 7500, "re-registering KEEPS the token and answers the couple prices");
  d.raw.exec("UPDATE business_settings SET club_pay_enabled = 0");
  r = await reg({ name: "Carlos Souza", phone: "8135550101" });
  ok(r.status === 200 && r.data.registered === true && r.data.pay === null && r.data.pay_token === null, "switch OFF: the registration answers no pay block (the thank-you screen stays as it was)");
  ok((await F.handleGetClubPay(tok1, req({}), env)).status === 404, "switch OFF: GET /api/club/pay/<token> is 404");
  ok((await F.handlePostClubPayCard(tok1, req({}), env)).status === 404 && st.calls.length === 0, "switch OFF: the card route is 404 and nothing is created in Stripe");
  d.raw.exec("UPDATE business_settings SET club_pay_enabled = 1");
  const noCard = d.q("SELECT id FROM apex_club_events WHERE name = 'Sem cartão'")[0].id;
  r = await reg({ name: "Ana Lima", phone: "8135550102" }, noCard);
  ok(r.data.pay === null, "switch ON but no card price on the event: no pay block either");

  // Public pay screen payload.
  r = await F.handleGetClubPay(tok1, req({}), env);
  ok(r.status === 200 && r.data.name === "Maria Silva" && r.data.seats === 2 && r.data.zelle_cents === 7500 && r.data.card_cents === 7800 && r.data.discount_cents === 300 && r.data.paid === false && r.data.zelle_handle === "pay@apex.test" && r.data.has_qr === true && r.data.event.id === evId,
    "GET pay: name, event, seats, both prices, discount, not paid, Zelle handle");
  ok(!/phone|8135550100|token|company/i.test(JSON.stringify(r.data)), "the pay payload carries no phone, token or company");
  ok((await F.handleGetClubPay(TOK("f"), req({}), env)).status === 404 && (await F.handleGetClubPay("zz", req({}), env)).status === 404, "unknown and malformed tokens are 404");

  // Card link.
  r = await F.handlePostClubPayCard(tok1, req({}), env);
  const price = st.calls.find(c => c.path === "prices"), link = st.calls.find(c => c.path === "payment_links");
  const regId = d.q("SELECT id FROM apex_club_registrations WHERE phone = '18135550100'")[0].id;
  ok(r.status === 200 && /^https:\/\/buy\.stripe\.com\//.test(r.data.url) && price.params.unit_amount === "7800" && price.params["product_data[name]"] === "Apex Club: Jantar 3", "the card link is for the guest's CURRENT card price, product named after the event");
  ok(link.params["payment_method_types[0]"] === "card" && link.params["line_items[0][quantity]"] === "1" && link.params["metadata[apex_club_registration_id]"] === regId && link.params["payment_intent_data[metadata][apex_club_registration_id]"] === regId &&
     link.params["payment_intent_data[metadata][apex_club_event_id]"] === evId && link.params["payment_intent_data[metadata][apex_club_seats]"] === "2" && !("payment_intent_data[metadata][client_id]" in link.params),
     "card only, quantity 1, registration, event and seats in the metadata (and no client_id, so contract progress never sees it)");
  ok(link.params["after_completion[redirect][url]"] === "https://apex.test/club.html?e=" + evId + "&p=" + tok1 + "&paid=1", "Stripe returns to the guest's pay screen with paid=1");
  let n = st.calls.length;
  r = await F.handlePostClubPayCard(tok1, req({}), env);
  ok(st.calls.length === n && r.status === 200, "asking again returns the same active link (nothing new in Stripe)");
  d.raw.exec("UPDATE apex_club_registrations SET plus_one = 0 WHERE phone = '18135550100'");
  r = await F.handlePostClubPayCard(tok1, req({}), env);
  const later = st.calls.slice(n);
  ok(later.filter(c => c.path === "prices")[0].params.unit_amount === "5200" && later.findIndex(c => /^payment_links\/plink_/.test(c.path)) > later.findIndex(c => c.path === "payment_links") &&
     d.q("SELECT COUNT(*) AS n FROM apex_club_pay_links WHERE registration_id = ? AND active = 1", regId)[0].n === 1, "the seat count changed: a new link for the new amount is made first, then the old one is deactivated");
  ok((await F.handlePostClubPayCard(d.q("SELECT pay_token FROM apex_club_registrations WHERE phone = '18135550102'")[0].pay_token, req({}), env)).status === 409, "409 when the event has no card price");

  // Applier.
  const charge = (id, cents, regI, extra) => { const e = Object.assign({ status: "succeeded", refunded: 0, fee: 181 }, extra || {});
    d.raw.prepare("INSERT INTO stripe_charges (id, amount_cents, amount_refunded_cents, fee_cents, status, created_at, metadata_club_reg_id, pm_type) VALUES (?,?,?,?,?,?,?,'card')").run(id, cents, e.refunded, e.fee, e.status, "2026-11-01 12:00:00", regI); };
  const regRow = (id) => d.q("SELECT paid_at IS NOT NULL AS paid, paid_cents, paid_method, paid_ref FROM apex_club_registrations WHERE id = ?", id)[0];
  d.raw.exec("UPDATE apex_club_registrations SET plus_one = 1 WHERE phone = '18135550100'");
  charge("ch_low", 5200, regId);
  await F.applyStripeChargesToClubRegistrations(env, null);
  ok(regRow(regId).paid === 0 && st.alerts.length === 1 && /valor diferente do esperado/.test(st.alerts[0]) && /Maria Silva/.test(st.alerts[0]) && /\$52\.00/.test(st.alerts[0]) && /\$78\.00/.test(st.alerts[0]),
    "a charge below the current card price (stale link) does NOT mark paid and alerts with the guest and both amounts");
  charge("ch_pending", 7800, regId, { status: "pending" });
  await F.applyStripeChargesToClubRegistrations(env, null);
  ok(regRow(regId).paid === 0, "a pending charge is never applied");
  charge("ch_ok", 7800, regId, { fee: 256 });
  let s1 = await F.applyStripeChargesToClubRegistrations(env, null);
  ok(s1.paid === 1 && regRow(regId).paid === 1 && regRow(regId).paid_cents === 7800 && regRow(regId).paid_method === "card" && regRow(regId).paid_ref === "ch_ok", "a succeeded charge for the card price marks the registration paid by card");
  n = st.alerts.length;
  s1 = await F.applyStripeChargesToClubRegistrations(env, null);
  ok(s1.paid === 0 && st.alerts.length === n && d.q("SELECT COUNT(*) AS n FROM apex_club_stripe_applied")[0].n === 2, "a second run applies nothing and alerts nothing");
  d.raw.exec("UPDATE stripe_charges SET amount_refunded_cents = 7800 WHERE id = 'ch_ok'");
  await F.applyStripeChargesToClubRegistrations(env, null); await F.applyStripeChargesToClubRegistrations(env, null);
  ok(regRow(regId).paid === 1 && st.alerts.length === n + 1 && /reembolso/.test(st.alerts[n]), "a refund changes nothing automatically and alerts once");
  // Put the charge back as it was (un-refunded) for the P&L checks below.
  d.raw.exec("UPDATE stripe_charges SET amount_refunded_cents = 0 WHERE id = 'ch_ok'"); d.raw.exec("UPDATE apex_club_stripe_applied SET applied_cents = 7800 WHERE charge_id = 'ch_ok'");
  charge("ch_ghost", 5200, "no-such-registration");
  n = st.alerts.length;
  await F.applyStripeChargesToClubRegistrations(env, null); await F.applyStripeChargesToClubRegistrations(env, null);
  ok(st.alerts.length === n + 1 && /não existe/.test(st.alerts[n]), "a charge for an unknown registration is alerted once, not applied");
  ok((await F.handlePostClubPayCard(tok1, req({}), env)).status === 409, "409 on the card route once the registration is paid");
  r = await F.handleGetClubPay(tok1, req({}), env);
  ok(r.data.paid === true && r.data.paid_method === "card" && r.data.paid_cents === 7800, "the pay screen then reads paid by card, $78.00");

  // P&L: card lines, fee as an expense, RSVP untouched.
  const ev = d.q("SELECT * FROM apex_club_events WHERE id = ?", evId)[0];
  const pl = await F.buildApexClubEventPL(env, ev);
  ok(pl.card_received_cents === 7800 && pl.card_fee_cents === 256 && pl.card_count === 1 && pl.confirmed.income_cents === 7800 && pl.confirmed.expense_cents === 256 && pl.confirmed.net_cents === 7544, "P&L: card receipts counted as received, the Stripe fee as an expense, each reported on its own line");
  ok(pl.rsvp.going === 3 && pl.rsvp.going_rows === 2, "paying changes nothing in the RSVP seat counts");
  const plNo = await F.buildApexClubEventPL(env, d.q("SELECT * FROM apex_club_events WHERE id = ?", noCard)[0]);
  ok(plNo.card_received_cents === 0 && plNo.card_fee_cents === 0 && plNo.card_count === 0 && plNo.confirmed.income_cents === 0 && plNo.confirmed.expense_cents === 0, "an event with no card payments: every figure as before (the regression script proves the full P&L byte for byte)");

  // The suggester never offers a Stripe payout lump.
  d.raw.exec("INSERT INTO transactions (id, account_id, amount_cents, date, description) VALUES ('tp1','acct_biz',5000,'2026-11-18','Transfer STRIPE ; APEX BUSINESS'), ('tp2','acct_biz',5000,'2026-11-18','Zelle payment from JOAO Conf# abc123def')");
  let sug = (await F.buildApexClubEventPL(env, ev)).suggestions.map(x => x.transaction_id);
  ok(sug.includes("tp1") && sug.includes("tp2"), "before the payout is linked, a $50 deposit is a price-point suggestion like any other");
  d.raw.exec("INSERT INTO stripe_payouts (id, amount_cents, status, bank_transaction_id) VALUES ('po_1', 5000, 'paid', 'tp1')");
  sug = (await F.buildApexClubEventPL(env, ev)).suggestions.map(x => x.transaction_id);
  ok(!sug.includes("tp1") && sug.includes("tp2"), "a transaction a Stripe payout points to is excluded from the suggestions; the Zelle deposit stays");

  // Admin: pay link (lazy token) and mark paid.
  d.raw.exec("INSERT INTO apex_club_registrations (id, event_id, name, phone, plus_one) VALUES ('old1', '" + evId + "', 'Antigo Sem Token', '18135550105', 0)");
  r = await F.handlePostClubRegPayLink("old1", req({}), env);
  const oldTok = d.q("SELECT pay_token FROM apex_club_registrations WHERE id = 'old1'")[0].pay_token;
  ok(r.status === 200 && /^[a-f0-9]{48}$/.test(oldTok) && r.data.url === "https://apex.test/club.html?e=" + evId + "&p=" + oldTok, "pay-link mints the token for an older registration and returns club.html?e=...&p=...");
  ok((await F.handlePostClubRegPayLink("old1", req({}), env)).data.url === r.data.url, "and returns the same link the next time");
  r = await F.handlePostClubRegMarkPaid("old1", req({ paid: true }), env);
  ok(r.status === 200 && regRow("old1").paid === 1 && regRow("old1").paid_cents === 5000 && regRow("old1").paid_method === "manual", "mark-paid sets paid, manual, at the Zelle price for the seats");
  ok((await F.handlePostClubRegMarkPaid("old1", req({ paid: true }), env)).status === 409, "marking twice is refused (guarded UPDATE)");
  r = await F.handlePostClubRegMarkPaid("old1", req({ paid: false }), env);
  ok(r.status === 200 && regRow("old1").paid === 0 && regRow("old1").paid_method === null, "paid:false clears a manual mark");
  ok((await F.handlePostClubRegMarkPaid(regId, req({ paid: false }), env)).status === 409 && regRow(regId).paid === 1, "a card payment cannot be cleared from here");
}

// The staff bilingual pairs are on the pages exactly as specified.
{
  const fin = readFileSync(new URL("finance-new.html", root), "utf8").replace(/&atilde;/g, "ã").replace(/&ccedil;/g, "ç").replace(/&eacute;/g, "é").replace(/&uacute;/g, "ú");
  const cal = readFileSync(new URL("calendar.html", root), "utf8");
  const pairs = [["Aceitar cartão neste evento", "Accept card at this event"], ["Preço no cartão (individual)", "Card price (single)"], ["Preço no cartão (casal)", "Card price (couple)"],
    ["Preço no Zelle (individual)", "Zelle price (single)"], ["Preço no Zelle (casal)", "Zelle price (couple)"],
    ["O preço do cartão é o preço divulgado. O flyer e todo anúncio devem mostrar o preço do cartão, e o Zelle é um desconto. Nunca divulgue o preço do Zelle como preço normal.", "The card price is the posted price. The flyer and every announcement must show the card price, and Zelle is a discount. Never advertise the Zelle price as the regular price."]];
  ok(pairs.every(p => fin.includes(p[0]) && fin.includes(p[1])), "finance-new.html event form: every card label pair, PT and EN");
  ok(pairs.every(p => cal.includes(p[0]) && cal.includes(p[1])), "calendar.html Apex Club group: every card label pair, PT and EN");
  const guest = [["Pago cartão", "Paid by card"], ["Pago Zelle", "Paid by Zelle"], ["Pago manual", "Paid manually"], ["Aguardando banco", "Waiting for bank"], ["Conferir Zelle", "Check Zelle"], ["Valor diferente", "Different amount"],
    ["Confirmação não encontrada", "Confirmation not found"], ["Copiar link de pagamento", "Copy payment link"], ["Marcar como pago", "Mark as paid"], ["Cartão (Stripe)", "Card (Stripe)"], ["Taxa do Stripe", "Stripe fee"]];
  const missing = guest.filter(p => !(fin.includes('"' + p[0] + '", "' + p[1] + '"')));
  ok(missing.length === 0, "finance-new.html guest list and P&L: every badge and button pair through t(pt, en)" + (missing.length ? " MISSING " + JSON.stringify(missing) : ""));
  const club = readFileSync(new URL("club.html", root), "utf8");
  ok(["Pagar com cartão: ", "Cartão ou Apple Pay. O preço do cartão já inclui a taxa de processamento.", "Pagando com Zelle: ", "(desconto de ", "Pagamento recebido. Obrigado!", "Estamos confirmando seu pagamento.", "Pago: "].every(x => club.includes(x)), "club.html: the pay box strings");
  ok(!/\bN[ãa]o vou\b|\bRecusar\b|\bCancelar presen|\bdecline\b/i.test(club.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\/[^\n]*/g, "")), "club.html offers no decline or 'no' option anywhere");
}
console.log(fail ? "\n" + fail + " FAILED" : "\nALL PASS");
process.exit(fail ? 1 : 0);
