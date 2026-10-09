// Apex Club: no default price. An event with no price is not charged by Apex,
// and nothing asks a guest to pay. The REAL Worker functions on an in-memory
// SQLite (scripts/fixtures/d1-shim.mjs) and the pure functions cut out of
// club.html, finance-new.html and calendar.html (root and iOS copy).
// No network.
//
//   node scripts/test-club-no-price.mjs
import { readFileSync } from "node:fs";
import { makeDb, build, baseStubs, req, workerSrc } from "./fixtures/d1-shim.mjs";

const root = new URL("../", import.meta.url);
const MIGS = ["migrations/apex_club_company.sql", "migrations/apex_invoice_public.sql", "migrations/apex_club_pay.sql"];
let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) { fail++; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const read = (f) => readFileSync(new URL(f, root), "utf8");
const PAGES = ["club.html", "finance-new.html", "calendar.html"];
const COPIES = PAGES.concat(PAGES.map((f) => "ios/App/App/public/" + f));

// ── 1. Source: the default is gone ──────────────────────────────────────
{
  ok(workerSrc.indexOf("APEX_CLUB_PRICE_SINGLE") === -1 && workerSrc.indexOf("APEX_CLUB_PRICE_COUPLE") === -1, "worker: APEX_CLUB_PRICE_SINGLE and APEX_CLUB_PRICE_COUPLE are gone (constants and fallbacks)");
  ok(!/price_single_cents\s*\|\|/.test(workerSrc) && !/price_couple_cents\s*\|\|/.test(workerSrc), "worker: no \"price_..._cents || <something>\" fallback is left");
  for (const f of COPIES) {
    const src = read(f);
    ok(src.indexOf("APEX_CLUB_PRICE") === -1, f + ": no APEX_CLUB_PRICE name");
    ok(!/placeholder="(50|75|52|78)\.00"/.test(src) && !/value="(50|75|52|78)\.00"/.test(src), f + ": no placeholder or value of 50.00 / 75.00 / 52.00 / 78.00");
    ok(!/price_single_cents\s*\|\|\s*\d/.test(src) && !/:\s*"(50|75)\.00"/.test(src), f + ": no \"price_single_cents || 5000\" and no \"50.00\" / \"75.00\" start value in the script");
  }
  for (const f of ["finance-new.html", "calendar.html"]) {
    const src = read(f), ios = read("ios/App/App/public/" + f);
    ok(src.indexOf("Deixe vazio quando a Apex n&atilde;o cobra por este evento.") > 0 && src.indexOf("Leave empty when Apex is not charging for this event.") > 0, f + ": the muted line under the price per person, in both languages");
    ok(src === ios, f + ": root and iOS copy are the same text");
  }
  ok(read("club.html") === read("ios/App/App/public/club.html"), "club.html: root and iOS copy are the same text");
  const cal = read("calendar.html");
  ok(cal.indexOf("muda em Financeiro") === -1 && cal.indexOf("is changed in Finance") === -1, "calendar.html: the \"name is changed in Finance\" line is removed");
  ok((cal.match(/Observa&ccedil;&otilde;es \(aparecem na p&aacute;gina de inscri&ccedil;&atilde;o\)/g) || []).length === 2 && (cal.match(/Notes \(shown on the registration page\)/g) || []).length === 2, "calendar.html: the one notes label on the create block and on the edit block");
  ok(read("finance-new.html").indexOf('t("Sem cobran&ccedil;a pela Apex", "Not charged by Apex")') > 0, "finance-new.html: the event card says Sem cobranca pela Apex / Not charged by Apex");
}

// ── 2. Worker ───────────────────────────────────────────────────────────
const TOK = (ch) => ch.repeat(48);
const FNS = ["normalizeUsPhone", "gmEstNewToken", "apexClubMemoHit", "addInterval", "apxInvSwitches", "apxInvNoIndex", "apxUsd", "apxPayLockTake", "apxPayLockRelease",
  "clubCardPriceFromZelle", "clubEventHasPrice", "clubPriceFor", "parseClubPrices", "parseClubCardPrices", "clubRegByToken", "clubPayPayload", "clubPayGuard", "clubRetirePayLinks", "clubCardTotals",
  "handleGetClubRegisterInfo", "handlePostClubRegister", "handleGetClubPay", "handlePostClubPayCard", "handlePostClubPayRefresh", "applyStripeChargesToClubRegistrations", "buildApexClubEventPL",
  "handlePostFinanceNewClubEvent", "handlePutFinanceNewClubEvent", "handlePostClubRegPayLink", "handlePostClubRegMarkPaid",
  "clubZelleNormalize", "clubZelleTokens", "clubZellePayerName", "clubZelleCandidateFor", "clubZellePayerTokens", "clubZelleNameTokens", "clubZelleNamesOverlap", "clubZelleEvaluate", "clubZelleCandidates", "clubZelleApply", "matchClubZelleConf", "clubZelleRetry",
  "handlePostClubPayZelleConf", "handlePostClubRegZelleDecision", "confNumber"];
const VARS = ["CLUB_NO_CHARGE_MESSAGE", "CLUB_NOT_CHARGED_STAFF", "CLUB_ZELLE_NOISE", "CLUB_ZELLE_MESSAGES"];
function world() {
  const d = makeDb(MIGS); const stripe = []; const alerts = []; const refreshes = [];
  d.raw.exec("INSERT INTO business_settings (id, zelle_handle, zelle_qr_r2_key, club_pay_enabled) VALUES (1, 'pay@apex.test', 'business/zelle-qr.png', 1)");
  d.raw.exec("INSERT INTO accounts (id, purpose) VALUES ('acct_biz', 'business')");
  const F = build(FNS, VARS, Object.assign({}, baseStubs, { crypto: globalThis.crypto, DEFAULT_ORIGIN: "https://apex.test", APX_CLUB_CARD_AVAILABLE: true,
    gmEstPublicRateLimit: async () => null, REQUEST_CTX: new WeakMap(),
    apxStripePost: async (env, path, params) => { stripe.push(path); return { id: "x", url: "https://buy.stripe.com/test" }; },
    notifyNicoleTelegram: async (env, msg) => { alerts.push(msg); },
    apxStripeRefreshCharges: async () => { refreshes.push(1); return 0; } }));
  return { d, env: { DB: d.DB }, F, stripe, alerts, refreshes };
}

// parseClubPrices and clubPriceFor (pure).
{
  const { F } = world();
  const NONE = { single: 0, couple: null };
  ok(same(F.parseClubPrices({}), NONE), "parseClubPrices: a MISSING price per person is no price (0), couple null");
  ok(same(F.parseClubPrices({ price_single_cents: "" }), NONE) && same(F.parseClubPrices({ price_single_cents: null }), NONE), "parseClubPrices: an EMPTY or null price per person is no price");
  ok(same(F.parseClubPrices({ price_single_cents: 0 }), NONE) && same(F.parseClubPrices({ price_single_cents: "0" }), NONE), "parseClubPrices: 0 is no price (never refused, never a default)");
  ok(same(F.parseClubPrices({ price_single_cents: 5000, price_couple_cents: 7500 }), { single: 5000, couple: 7500 }) && same(F.parseClubPrices({ price_single_cents: "8000", price_couple_cents: "" }), { single: 8000, couple: null }), "parseClubPrices: a positive price as today (5000/7500; \"8000\" with a blank couple)");
  ok(/positive number of cents/.test(F.parseClubPrices({ price_single_cents: -5 }).error || "") && !!F.parseClubPrices({ price_single_cents: "abc" }).error && !!F.parseClubPrices({ price_single_cents: 50.5 }).error, "parseClubPrices: a negative, non-numeric or fractional price is refused");
  ok(!!F.parseClubPrices({ price_single_cents: 5000, price_couple_cents: -1 }).error, "parseClubPrices: a bad couple price is refused as today");
  const r = F.parseClubPrices({ price_couple_cents: 7500 });
  ok(/valor por casal precisa do valor por pessoa/i.test(r.error || "") && / \/ A price per couple needs a price per person/.test(r.error || ""), "parseClubPrices: a couple price WITHOUT a price per person is REFUSED (both languages)");
  ok(!!F.parseClubPrices({ price_single_cents: 0, price_couple_cents: 7500 }).error, "parseClubPrices: the same with an explicit 0");

  const noPrice = { single: 0, couple: null };
  ok(same(F.parseClubCardPrices({ price_card_single_cents: null, price_card_couple_cents: null }, noPrice, null), { single: null, couple: null }), "parseClubCardPrices: no price, no card prices: both NULL");
  ok(/cart.o precisa do valor por pessoa/.test(F.parseClubCardPrices({ price_card_single_cents: 5200 }, noPrice, null).error || ""), "parseClubCardPrices: a card price WITHOUT a price per person is REFUSED");
  ok(same(F.parseClubCardPrices({}, noPrice, { price_card_single_cents: 5200, price_card_couple_cents: 7800 }), { single: null, couple: null }), "parseClubCardPrices: clearing the price clears card prices already stored (an edit that does not mention them)");

  for (const ev of [{ price_single_cents: 0 }, { price_single_cents: null }, {}, { price_single_cents: 0, price_couple_cents: 7500, price_card_single_cents: 5200, price_card_couple_cents: 7800 }]) {
    for (const po of [false, true]) {
      const p = F.clubPriceFor(ev, po);
      ok(p.charged === false && p.zelle_cents === null && p.card_cents === null && p.discount_cents === 0 && p.seats === (po ? 2 : 1), "clubPriceFor " + JSON.stringify(ev) + (po ? " +1" : "") + ": not charged, no amounts");
    }
  }
  ok(same(F.clubPriceFor({ price_single_cents: 5000, price_couple_cents: 7500, price_card_single_cents: null, price_card_couple_cents: null }, false), { seats: 1, zelle_cents: 5000, card_cents: null, discount_cents: 0 }), "clubPriceFor with a price answers exactly what it did before");
  ok(F.clubEventHasPrice({ price_single_cents: 1 }) === true && F.clubEventHasPrice({ price_single_cents: 0 }) === false && F.clubEventHasPrice(null) === false, "clubEventHasPrice: a positive price only");
}

// Create and edit; the public page data; registration; pay routes; staff routes; P&L.
{
  const { d, env, F, stripe, alerts, refreshes } = world();
  const evRow = (id) => d.q("SELECT price_single_cents, price_couple_cents, price_card_single_cents, price_card_couple_cents, name, notes FROM apex_club_events WHERE id = ?", id)[0];

  let r = await F.handlePostFinanceNewClubEvent(req({ name: "CONECTA BUSINESS | DINNER", event_date: "2026-10-20", notes: "Cada um paga sua conta no restaurante." }), env);
  const free = r.data.event.id;
  ok(r.status === 200 && same(evRow(free), { price_single_cents: 0, price_couple_cents: null, price_card_single_cents: null, price_card_couple_cents: null, name: "CONECTA BUSINESS | DINNER", notes: "Cada um paga sua conta no restaurante." }),
    "creating an event with NO price saves 0 with couple and card NULL (not $50.00)");
  ok(r.data.charged === false, "the event's answer says charged: false");
  r = await F.handlePostFinanceNewClubEvent(req({ name: "Zero", event_date: "2026-10-21", price_single_cents: 0, price_couple_cents: null, price_card_single_cents: null, price_card_couple_cents: null }), env);
  ok(r.status === 200 && evRow(r.data.event.id).price_single_cents === 0 && evRow(r.data.event.id).price_card_single_cents === null, "creating with an explicit 0 saves no price too");
  r = await F.handlePostFinanceNewClubEvent(req({ name: "Casal", event_date: "2026-10-22", price_couple_cents: 7500 }), env);
  ok(r.status === 400 && d.q("SELECT COUNT(*) AS n FROM apex_club_events WHERE name = 'Casal'")[0].n === 0, "a couple price with no price per person is refused (400) and nothing is saved");
  r = await F.handlePostFinanceNewClubEvent(req({ name: "Cartao", event_date: "2026-10-22", price_card_single_cents: 5200 }), env);
  ok(r.status === 400 && d.q("SELECT COUNT(*) AS n FROM apex_club_events WHERE name = 'Cartao'")[0].n === 0, "a card price with no price per person is refused (400) and nothing is saved");

  r = await F.handlePostFinanceNewClubEvent(req({ name: "Jantar pago", event_date: "2026-10-23", price_single_cents: 5000, price_couple_cents: 7500, price_card_single_cents: 5200, price_card_couple_cents: 7800 }), env);
  const paid = r.data.event.id;
  ok(r.status === 200 && r.data.charged === true && evRow(paid).price_single_cents === 5000 && evRow(paid).price_card_couple_cents === 7800, "an event WITH a price saves as today");
  // An edit that clears the price (an older cached form does not mention the card keys).
  r = await F.handlePostFinanceNewClubEvent(req({ name: "Vai ficar sem preco", event_date: "2026-10-24", price_single_cents: 5000, price_couple_cents: 7500, price_card_single_cents: 5200, price_card_couple_cents: 7800 }), env);
  const cleared = r.data.event.id;
  r = await F.handlePutFinanceNewClubEvent(cleared, req({ name: "Ficou sem preco", event_date: "2026-10-24", price_single_cents: "" }), env);
  ok(r.status === 200 && same([evRow(cleared).price_single_cents, evRow(cleared).price_couple_cents, evRow(cleared).price_card_single_cents, evRow(cleared).price_card_couple_cents], [0, null, null, null]) && evRow(cleared).name === "Ficou sem preco",
    "editing an event to an empty price saves 0 and clears the couple and card prices; the name follows the edit");
  r = await F.handlePutFinanceNewClubEvent(cleared, req({ name: "Voltou", event_date: "2026-10-24", price_single_cents: 6000, notes: "nota nova" }), env);
  ok(r.status === 200 && evRow(cleared).price_single_cents === 6000 && evRow(cleared).notes === "nota nova", "and a price (and notes) can be put back by an edit");

  // Public event data.
  r = await F.handleGetClubRegisterInfo(free, req({}), env);
  ok(r.status === 200 && r.data.charged === false && r.data.price_single_cents === null && r.data.price_couple_cents === null && r.data.zelle_handle === null, "public event data, no price: charged false, no amounts, no Zelle contact");
  ok(r.data.name === "CONECTA BUSINESS | DINNER" && r.data.notes === "Cada um paga sua conta no restaurante." && r.data.event_date === "2026-10-20" && !/\d{3,}00\b|pay@apex/.test(JSON.stringify(Object.assign({}, r.data, { id: "", event_date: "" }))), "it still carries the name, date and notes, and no number that could be shown as money");
  r = await F.handleGetClubRegisterInfo(paid, req({}), env);
  ok(r.data.charged === true && r.data.price_single_cents === 5000 && r.data.price_couple_cents === 7500 && r.data.zelle_handle === "pay@apex.test", "public event data WITH a price: as today");

  // Registration answer. A stale card price left on a no-price row must not bring a pay block back.
  d.raw.prepare("UPDATE apex_club_events SET price_card_single_cents = 5200, price_couple_cents = 7500 WHERE id = ?").run(free);
  r = await F.handlePostClubRegister(free, req({ name: "Maria Silva", phone: "8135550100", plus_one: true, company: "Silva LLC" }), env);
  ok(r.status === 200 && r.data.registered === true && r.data.pay === null && r.data.pay_token === null, "registering for a no-price event (payments switch ON, even with stale card and couple prices on the row): registered, NO pay block, no pay token");
  ok(!/cents|5200|7500|5000/.test(JSON.stringify(r.data)), "the registration answer carries no amount at all");
  const regFree = d.q("SELECT id, pay_token FROM apex_club_registrations WHERE phone = '18135550100'")[0];
  r = await F.handlePostClubRegister(paid, req({ name: "Carlos Souza", phone: "8135550101", company: "Souza Inc" }), env);
  ok(same(r.data.pay, { zelle_cents: 5000, card_cents: 5200, discount_cents: 200 }) && /^[a-f0-9]{48}$/.test(r.data.pay_token), "registering for an event WITH a price: the pay block as today");

  // Pay routes for a no-price event.
  const tok = regFree.pay_token;
  r = await F.handleGetClubPay(tok, req({}), env);
  ok(r.status === 200 && r.data.charged === false && r.data.name === "Maria Silva" && r.data.zelle_cents === null && r.data.card_cents === null && r.data.paid_cents === null && r.data.zelle_handle === null && r.data.has_qr === false && r.data.paid === false,
    "GET pay, no price: 200, charged false, the guest's name, no amounts, no Zelle contact, no QR");
  ok(r.data.event.name === "CONECTA BUSINESS | DINNER" && r.data.seats === 2, "GET pay still names the event and the seats");
  r = await F.handlePostClubPayCard(tok, req({}), env);
  ok(r.status === 200 && r.data.charged === false && r.data.url === null && /nada a pagar/.test(r.data.message) && stripe.length === 0, "POST card, no price: 200, no url, and NOTHING is created in Stripe");
  ok(d.q("SELECT COUNT(*) AS n FROM apex_club_pay_links")[0].n === 0, "no pay link row is written");
  r = await F.handlePostClubPayZelleConf(tok, req({ conf: "abc123def" }), env);
  ok(r.status === 200 && r.data.charged === false && r.data.state === "none" && /nada a pagar/.test(r.data.message), "POST zelle-conf, no price: 200, state none (the number is not accepted)");
  ok(d.q("SELECT zelle_conf, zelle_state FROM apex_club_registrations WHERE id = ?", regFree.id)[0].zelle_conf === null, "the Zelle number is NOT stored on the registration");
  r = await F.handlePostClubPayRefresh(tok, req({}), env);
  ok(r.status === 200 && r.data.charged === false && refreshes.length === 0, "POST refresh, no price: the plain answer, and Stripe is not asked");
  ok(alerts.length === 0, "none of this sent an alert");

  // Staff routes.
  r = await F.handlePostClubRegMarkPaid(regFree.id, req({ paid: true }), env);
  ok(r.status === 409 && /Not charged by Apex|not charged by Apex/.test(r.error) && d.q("SELECT paid_at FROM apex_club_registrations WHERE id = ?", regFree.id)[0].paid_at === null, "mark-paid on a no-price event is refused (409) and nothing is marked");
  r = await F.handlePostClubRegPayLink(regFree.id, req({}), env);
  ok(r.status === 409, "copy-payment-link on a no-price event is refused (409)");
  d.raw.prepare("UPDATE apex_club_registrations SET zelle_conf = 'abc123def', zelle_state = 'review' WHERE id = ?").run(regFree.id);
  d.raw.exec("INSERT INTO transactions (id, account_id, amount_cents, date, description) VALUES ('z1','acct_biz',5000,'2026-10-19','Zelle payment from MARIA SILVA Conf# abc123def')");
  r = await F.handlePostClubRegZelleDecision(regFree.id, "confirm-zelle", req({}), env);
  ok(r.status === 409 && d.q("SELECT COUNT(*) AS n FROM apex_club_event_txns")[0].n === 0, "confirm-zelle on a no-price event is refused (409) and no deposit is filed");
  d.raw.prepare("UPDATE apex_club_registrations SET zelle_state = NULL WHERE id = ?").run(regFree.id);
  ok((await F.clubZelleRetry(env, null)) === 0 && d.q("SELECT paid_at FROM apex_club_registrations WHERE id = ?", regFree.id)[0].paid_at === null, "the retry after a bank sync never matches a deposit to a no-price event");

  // P&L and deposit matching.
  d.raw.exec("INSERT INTO transactions (id, account_id, amount_cents, date, description, memo) VALUES " +
    "('t50','acct_biz',5000,'2026-10-18','Zelle payment from PEDRO', NULL), " +
    "('tmemo','acct_biz',6000,'2026-10-18','Zelle payment from JOAO', 'Apex Club jantar'), " +
    "('tfood','acct_biz',-31250,'2026-10-20','Zelle payment to CHEF', 'Apex club comida')");
  let pl = await F.buildApexClubEventPL(env, d.q("SELECT * FROM apex_club_events WHERE id = ?", free)[0]);
  ok(pl.charged === false && same(pl.suggestions.map((x) => [x.transaction_id, x.side]), [["tfood", "expense"]]), "P&L, no price: no guest payment is looked for (no price-point match, no memo match on deposits); the expense is still offered");
  ok(pl.registrations.length === 1 && pl.registrations[0].zelle_candidate === undefined && pl.rsvp.going === 2, "the guest list and the food count are still there; no Zelle deposit is looked up for a guest");
  await d.DB.prepare("INSERT INTO apex_club_event_txns (event_id, transaction_id, side, people, confirmed_by) VALUES (?, 'tfood', 'expense', 0, 'test')").bind(free).run();
  pl = await F.buildApexClubEventPL(env, d.q("SELECT * FROM apex_club_events WHERE id = ?", free)[0]);
  ok(pl.confirmed.expense_cents === 31250 && pl.confirmed.income_cents === 0 && pl.confirmed.net_cents === -31250, "P&L, no price: a confirmed expense still counts (-$312.50)");
  d.raw.prepare("UPDATE apex_club_events SET window_start = '2026-10-06', window_end = '2026-10-30' WHERE id = ?").run(paid);
  pl = await F.buildApexClubEventPL(env, d.q("SELECT * FROM apex_club_events WHERE id = ?", paid)[0]);
  ok(pl.charged === true && pl.suggestions.some((x) => x.transaction_id === "t50" && x.why === "price_point") && pl.suggestions.some((x) => x.transaction_id === "tmemo" && x.why === "memo"), "P&L WITH a price: the $50.00 deposit and the memo deposit are suggested as today");
}

// ── 3. Pages: the pure functions, cut from each copy ─────────────────────
function cutFn(src, name, indent) {
  const i = src.indexOf("\n" + indent + "function " + name + "(");
  if (i < 0) { throw new Error("not found: " + name); }
  const j = src.indexOf("\n" + indent + "}", i + 1);
  return src.slice(i + 1, j + indent.length + 2);
}

// finance-new.html: buildClubWhatsAppText.
for (const file of ["finance-new.html", "ios/App/App/public/finance-new.html"]) {
  const html = read(file); const tag = "[" + file + "] ";
  const names = ["fmtCents", "fmtDate", "clubEventCharged", "clubDropPaymentLines", "buildClubWhatsAppText", "clubSinglePriceCents"];
  const make = (settings) => new Function("BUSINESS_SETTINGS", names.map((n) => cutFn(html, n, "    ")).join("\n") + "\nreturn { " + names.join(", ") + " };")(settings);
  const TPL = "Oi {nome}! Confirmando sua presença no {evento}.\n📅 {data} às {hora}\n📍 {local}\n\n💵 Valor: {valor}\nPagamento por Zelle: pay@apex.test\nColoque seu nome no memo do Zelle.\n\nNos vemos lá!";
  const F = make({ club_confirm_template: TPL });
  const evPaid = { name: "Apex Club Outubro", event_date: "2026-10-01", start_time: "7:00 PM", venue: "123 Main St", price_single_cents: 5000, price_couple_cents: 7500 };
  const evFree = Object.assign({}, evPaid, { name: "CONECTA BUSINESS | DINNER", price_single_cents: 0, price_couple_cents: null });
  const g1 = { name: "Maria Silva", plus_one: 0 }, g2 = { name: "Carlos Souza", plus_one: 1 };

  ok(F.buildClubWhatsAppText(evPaid, g1) === "Oi Maria! Confirmando sua presença no Apex Club Outubro.\n📅 10/01/2026 às 7:00 PM\n📍 123 Main St\n\n💵 Valor: $50.00\nPagamento por Zelle: pay@apex.test\nColoque seu nome no memo do Zelle.\n\nNos vemos lá!",
    tag + "WITH a price: every line as before, the date month first (10/01/2026), $50.00");
  ok(/Valor: \$75\.00/.test(F.buildClubWhatsAppText(evPaid, g2)), tag + "WITH a price, a guest with a plus one gets the couple price ($75.00)");
  const free = F.buildClubWhatsAppText(evFree, g1);
  ok(free === "Oi Maria! Confirmando sua presença no CONECTA BUSINESS | DINNER.\n📅 10/01/2026 às 7:00 PM\n📍 123 Main St\n\nNos vemos lá!",
    tag + "NO price: the price, Zelle and payment lines are left out; every other line is exactly as written");
  ok(!/\$|valor|zelle|pagamento|\{/i.test(free), tag + "NO price: no dollar sign, no Valor, no Zelle, no payment word, no unfilled placeholder");
  for (const ev of [Object.assign({}, evFree, { price_single_cents: null }), Object.assign({}, evFree, { price_single_cents: undefined }), Object.assign({}, evFree, { price_couple_cents: 7500 })]) {
    ok(!/\$|50|75/.test(F.buildClubWhatsAppText(ev, g2).replace("10/01/2026", "").replace("7:00 PM", "")), tag + "NO price (" + JSON.stringify(ev.price_single_cents) + ", couple " + JSON.stringify(ev.price_couple_cents) + "): never an amount, never $50.00");
  }
  const plain = make(null);
  ok(plain.buildClubWhatsAppText(evFree, g1) === "Oi Maria! Confirmando sua presença no CONECTA BUSINESS | DINNER, dia 10/01/2026 às 7:00 PM, em 123 Main St." && plain.buildClubWhatsAppText(evPaid, g1) === "Oi Maria! Confirmando sua presença no Apex Club Outubro, dia 10/01/2026 às 7:00 PM, em 123 Main St.",
    tag + "with no template saved, the plain message is the same with and without a price");
  ok(F.clubSinglePriceCents("") === 0 && F.clubSinglePriceCents("0") === 0 && F.clubSinglePriceCents("0,00") === 0 && F.clubSinglePriceCents("50,00") === 5000 && F.clubSinglePriceCents("$80") === 8000, tag + "price box: blank and 0 are no price (0); 50,00 is 5000; $80 is 8000");
  ok(F.clubEventCharged({ price_single_cents: 5000 }) && !F.clubEventCharged({ price_single_cents: 0 }) && !F.clubEventCharged({}) && !F.clubEventCharged(null), tag + "clubEventCharged: a positive price only");
}

// club.html: the facts never show a price row for a no-price event.
for (const file of ["club.html", "ios/App/App/public/club.html"]) {
  const html = read(file); const tag = "[" + file + "] ";
  const meses = /var MESES = \[[\s\S]*?\];/.exec(html)[0];
  const names = ["money", "ptDate", "esc", "factsHtml", "notesHtml"];
  const F = new Function(meses + "\n" + names.map((n) => cutFn(html, n, "  ")).join("\n") + "\nreturn { " + names.join(", ") + " };")();
  const base = { event_date: "2026-10-20", start_time: "7:00 PM", venue: "123 Main St", speakers: "Ana", notes: "Cada um paga sua conta.\nEstacionamento nos fundos." };
  for (const price of [null, 0, undefined]) {
    const h = F.factsHtml(Object.assign({}, base, { price_single_cents: price, price_couple_cents: null }), { withPrice: true });
    ok(!/Valor|\$|por pessoa|casal/.test(h) && /Data/.test(h) && /Local/.test(h) && /Convidados/.test(h) && /Observações/.test(h) && /Cada um paga sua conta\.<br>Estacionamento/.test(h),
      tag + "thank-you facts, price " + JSON.stringify(price) + ": no Valor row, no dollar sign; date, place, speakers and notes stay");
  }
  const hp = F.factsHtml(Object.assign({}, base, { price_single_cents: 5000, price_couple_cents: 7500 }), { withPrice: true });
  ok(/Valor<\/span>\$50 por pessoa · \$75 o casal/.test(hp), tag + "thank-you facts WITH a price: the Valor row as today");
  ok(/if \(!evCharged\(\)\) \{\s*hide\("payBox"\);\s*show\("screenDone"\);\s*window\.scrollTo\(0, 0\);\s*return;\s*\}/.test(html), tag + "done(): a no-price event hides the payment box and stops before any amount, Zelle contact or QR is set");
  ok(/if \(evCharged\(\) && res\.d\.pay && res\.d\.pay_token\)/.test(html), tag + "the new payment box is only ever built for an event with a price");
  const noCharge = html.slice(html.indexOf('<div id="payNoCharge"'), html.indexOf("</div>\n      </div>", html.indexOf('<div id="payNoCharge"')));
  ok(/N&atilde;o h&aacute; nada a pagar &agrave; Apex por este evento\./.test(noCharge) && /id="btnSharePay">Compartilhar convite</.test(noCharge) && /id="btnCalPay"/.test(noCharge) && !/zelle|cart|input|\$/i.test(noCharge),
    tag + "pay screen, no price: the plain line, Compartilhar convite and Adicionar ao calendario, and no Zelle, card, field or amount");
  ok(/u\.searchParams\.delete\("p"\);/.test(html), tag + "the shared link never carries a guest's pay token");
  ok(/id="factsNotes"/.test(html) && /function notesHtml\(ev\)/.test(html) && /factsHtml\(EV, \{ notesBelow: true \}\)/.test(html), tag + "the notes still sit under the sign-up form");
  ok(!/\b(confirm|alert|prompt)\(/.test(html.replace(/\/\/[^\n]*/g, "")), tag + "no browser pop-up");
}

// calendar.html: notes and name travel to the event; no price is no price.
for (const file of ["calendar.html", "ios/App/App/public/calendar.html"]) {
  const html = read(file); const tag = "[" + file + "] ";
  const names = ["clubMoneyToCents", "clubStartTimeText", "clubSinglePriceCents", "clubPricesFromBoxes", "clubNotesForBox", "buildClubEventUpdateBody", "buildClubEventCreateBody"];
  const F = new Function(read("datetime.js") + "\n" + names.map((n) => cutFn(html, n, "    ")).join("\n") + "\nreturn { " + names.join(", ") + " };")();
  const NOTE = "Venha conhecer empresários da região.\nCada um paga sua conta no restaurante.";
  const form = { eventName: "CONECTA BUSINESS | DINNER", date: "2026-10-20", time: "19:00", location: " 123 Main St, Tampa ", sessionId: "sess1",
    speakers: " Ana ", notes: NOTE, priceSingle: "", priceCouple: "", cardOn: false, cardSingle: "", cardCouple: "" };

  let b = F.buildClubEventCreateBody(form).body;
  ok(b.name === "CONECTA BUSINESS | DINNER" && b.notes === NOTE && b.session_id === "sess1", tag + "create: the calendar entry's NAME and NOTES travel to the event, linked to the session");
  ok(b.event_date === "2026-10-20" && b.start_time === "7:00 PM" && b.venue === "123 Main St, Tampa" && b.speakers === "Ana", tag + "create: date, time (7:00 PM), place and speakers travel too");
  ok(b.price_single_cents === 0 && b.price_couple_cents === null && b.price_card_single_cents === null && b.price_card_couple_cents === null, tag + "create with the price boxes EMPTY: no price (0), couple and card null. No $50.00.");
  b = F.buildClubEventCreateBody(Object.assign({}, form, { priceSingle: "0", priceCouple: "75.00", cardOn: true, cardSingle: "52.00" })).body;
  ok(b.price_single_cents === 0 && b.price_couple_cents === null && b.price_card_single_cents === null, tag + "create with 0: no price, and a couple or card box left filled is not sent");
  b = F.buildClubEventCreateBody(Object.assign({}, form, { priceSingle: "50,00", priceCouple: "75.00", cardOn: true, cardSingle: "52.00", cardCouple: "78.00" })).body;
  ok(b.price_single_cents === 5000 && b.price_couple_cents === 7500 && b.price_card_single_cents === 5200 && b.price_card_couple_cents === 7800, tag + "create WITH a price: all four prices as typed");
  ok(F.buildClubEventCreateBody(Object.assign({}, form, { priceSingle: "50", priceCouple: "0" })).error === "couple" && F.buildClubEventCreateBody(Object.assign({}, form, { priceSingle: "50", cardOn: true })).error === "cardSingle", tag + "create: a zero couple price, or card ticked with no card price, is still refused");
  ok(F.buildClubEventCreateBody(Object.assign({}, form, { eventName: "  " })).body.name === "Apex Club", tag + "create: a blank name still falls back to Apex Club (a name, not a price)");

  const edit = Object.assign({}, form, { existingDate: "2026-10-20", windowStart: "2026-10-06", windowEnd: "2026-10-27", eventName: "CONECTA BUSINESS | DINNER", time: "18:30", notes: NOTE + "\nNovo endereço." });
  b = F.buildClubEventUpdateBody(edit).body;
  ok(b.name === "CONECTA BUSINESS | DINNER" && b.notes === NOTE + "\nNovo endereço." && b.start_time === "6:30 PM" && b.venue === "123 Main St, Tampa", tag + "edit: name, notes, time and place of the calendar entry travel to the event");
  ok(b.price_single_cents === 0 && b.price_couple_cents === null && b.price_card_single_cents === null && b.price_card_couple_cents === null, tag + "edit with the price box empty: no price, never refused");

  ok(F.clubNotesForBox("do evento", "") === "do evento" && F.clubNotesForBox("", "da agenda") === "da agenda" && F.clubNotesForBox(null, null) === "", tag + "edit notes box: the event's notes, or the calendar entry's when the event has none");
  ok(F.clubNotesForBox("igual", "igual") === "igual" && F.clubNotesForBox("texto longo com parte", "parte") === "texto longo com parte", tag + "edit notes box: the same text is not repeated");
  ok(F.clubNotesForBox("do evento", "da agenda") === "do evento\n\nda agenda", tag + "edit notes box: two different texts are both kept (nothing typed is dropped)");

  // The edit screen saves the SAME notes text on the calendar entry and on the event.
  ok(/var clubNotes = clubVal\("edClubNotes"\)\.trim\(\) \|\| null;\s*if \(session\.status === "scheduled" && clubNotes !== \(session\.notes \|\| null\)\) \{ body\.notes = clubNotes; \}/.test(html)
     && /notes: clubVal\("edClubNotes"\)/.test(html), tag + "edit: the one notes box feeds the calendar entry's notes and the event's notes");
  ok(/if \(NS_IS_APEX_CLUB && isEvent\) \{ notes = clubVal\("nsClubNotes"\)\.trim\(\); \}/.test(html) && /notes: clubVal\("nsClubNotes"\)/.test(html), tag + "create: the one notes box feeds the calendar entry's notes and the event's notes");
  ok(/eventName: eventName \|\| EDIT_CLUB\.name,/.test(html), tag + "edit: the event is sent the name typed on the calendar entry");
  ok(/id="nsNotesGroup"/.test(html) && /if \(g\) \{ g\.hidden = !!NS_IS_APEX_CLUB; \}/.test(html) && /var ng = document\.getElementById\("edNotesGroup"\);\s*if \(ng\) \{ ng\.hidden = true; \}/.test(html), tag + "the general notes box is hidden for an Apex Club entry (create and edit)");
  ok(!/\b(confirm|alert|prompt)\(/.test(html.replace(/\/\/[^\n]*/g, "").replace(/<!--[\s\S]*?-->/g, "")), tag + "no browser pop-up");
}

console.log(fail ? "\n" + fail + " FAILED" : "\nall passed");
process.exit(fail ? 1 : 0);
