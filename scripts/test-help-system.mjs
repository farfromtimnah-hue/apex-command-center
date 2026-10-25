// Learn / Aprenda self-serve help system.
// Runs the REAL help-core.js, the REAL help-widget.js (in a fake page), and the
// REAL Worker route /api/help/ask cut out of worker/index.js with fetch and the
// database stubbed. No network, no database, nothing is sent.
//   node scripts/test-help-system.mjs
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { build, req } from "./fixtures/d1-shim.mjs";

const require = createRequire(import.meta.url);
const root = new URL("../", import.meta.url);
let failed = 0, passed = 0;
function ok(cond, label) { if (cond) { passed++; console.log("PASS  " + label); } else { failed++; console.log("FAIL  " + label); } }
function read(rel) { return readFileSync(new URL(rel, root), "utf8"); }

const core = require("../help-core.js");
const FIXTURE = JSON.parse(read("scripts/fixtures/help-guides-fixture.json"));
const REAL = JSON.parse(read("help/guides.json"));
const EMPTY = { version: 1, guides: [], pages: {} };
function clone(o) { return JSON.parse(JSON.stringify(o)); }

// ---------------------------------------------------------------- (a) normalizer
ok(core.normalize("  Orçamento   NOVO ") === "orcamento novo", "(a) normalize lowercases, strips accents, collapses spaces, trims");
ok(core.normalize("Orçamento") === core.normalize("orcamento"), "(a) Orçamento and orcamento match");
ok(core.normalize(null) === "" && core.normalize(undefined) === "", "(a) normalize of null is an empty string");

// ---------------------------------------------------------------- (b) resolver
const send = core.resolveTarget({ dataHelp: null, texts: ["  Salvar   e ENVIAR ", ""] }, FIXTURE);
ok(send && send.guide === "estimate" && send.section === "send" && send.step === 2, "(b) Portuguese label resolves guide, section, step");
const sendEn = core.resolveTarget({ dataHelp: null, texts: ["", "Save and send"] }, FIXTURE);
ok(sendEn && sendEn.guide === "estimate" && sendEn.step === 2, "(b) English aria-label resolves too");
const accentless = core.resolveTarget({ dataHelp: null, texts: ["novo orcamento"] }, FIXTURE);
ok(accentless && accentless.section === "create" && accentless.step === 1, "(b) accent-less text matches an accented label");
const pref = core.resolveTarget({ dataHelp: "invoice#paid#1", texts: ["Salvar e enviar"] }, FIXTURE);
ok(pref && pref.guide === "invoice" && pref.section === "paid" && pref.step === 1, "(b) data-help wins over a text match");
const noStep = core.resolveTarget({ dataHelp: "invoice#create", texts: [] }, FIXTURE);
ok(noStep && noStep.guide === "invoice" && noStep.section === "create" && noStep.step === null, "(b) data-help without a step is allowed");
ok(core.resolveTarget({ dataHelp: null, texts: ["Botão desconhecido"] }, FIXTURE) === null, "(b) unknown label resolves to nothing");
ok(core.resolveTarget({ dataHelp: "nope#x#1", texts: [] }, FIXTURE) === null, "(b) data-help naming a guide that does not exist resolves to nothing");
ok(core.resolveTarget({ dataHelp: "../x#y", texts: [] }, FIXTURE) === null, "(b) data-help that is not plain ids resolves to nothing");
ok(core.resolveTarget({ dataHelp: null, texts: ["Salvar e enviar"] }, EMPTY) === null, "(b) an empty library resolves nothing");
ok(core.resolveTarget({ dataHelp: null, texts: ["Salvar e enviar"] }, null) === null, "(b) guides not loaded yet resolves nothing");

// ---------------------------------------------------------------- (c) deep links
const dl = core.parseDeepLink("?guide=estimate&section=send&step=3&lang=en");
ok(dl.guide === "estimate" && dl.section === "send" && dl.step === 3 && dl.lang === "en", "(c) deep link reads guide, section, step and lang");
ok(core.parseDeepLink("?guide=a%20b").guide === null, "(c) a space in an id is rejected");
ok(core.parseDeepLink("?guide=../../etc").guide === null, "(c) a path in an id is rejected");
ok(core.parseDeepLink("?guide=%3Cscript%3E").guide === null, "(c) markup in an id is rejected");
ok(core.parseDeepLink("?guide=ok_id-1&section=bad!").section === null, "(c) a bad section is rejected, a good guide kept");
ok(core.parseDeepLink("?guide=a&step=abc").step === null && core.parseDeepLink("?guide=a&step=-2").step === null && core.parseDeepLink("?guide=a&step=0").step === null, "(c) a step that is not a positive whole number is rejected");
ok(core.parseDeepLink("?lang=fr").lang === null, "(c) a language other than pt or en is rejected");
ok(core.parseDeepLink("").guide === null && core.parseDeepLink(undefined).guide === null, "(c) empty input gives all nulls");

// ---------------------------------------------------------------- (e) long press timing
const D = { type: "down", x: 100, y: 100, t: 0 };
ok(core.LONG_PRESS_MS === 550 && core.MOVE_PX === 10, "(e) constants are 550 ms and 10 px");
ok(core.longPressOutcome([D], 550).fired === true && core.longPressOutcome([D], 550).at === 550, "(e) fires at 550 ms");
ok(core.longPressOutcome([D], 549).fired === false, "(e) not fired at 549 ms");
ok(core.longPressOutcome([D, { type: "move", x: 111, y: 100, t: 100 }], 900).fired === false, "(e) cancels on a move over 10 px");
ok(core.longPressOutcome([D, { type: "move", x: 110, y: 100, t: 100 }], 900).fired === true, "(e) a move of exactly 10 px does not cancel");
ok(core.longPressOutcome([D, { type: "move", x: 107, y: 108, t: 100 }], 900).fired === false, "(e) diagonal distance counts (about 10.6 px cancels)");
ok(core.longPressOutcome([D, { type: "up", x: 100, y: 100, t: 300 }], 900).fired === false, "(e) cancels on pointerup before 550 ms");
ok(core.longPressOutcome([D, { type: "up", x: 100, y: 100, t: 700 }], 900).fired === true, "(e) pointerup after 550 ms is too late to cancel");
ok(core.longPressOutcome([D, { type: "cancel", x: 100, y: 100, t: 200 }], 900).fired === false, "(e) cancels on pointercancel");
ok(core.longPressOutcome([D, { type: "scroll", x: 100, y: 100, t: 200 }], 900).fired === false, "(e) cancels on scroll");

// ---------------------------------------------------------------- (f) guides validator
ok(core.validateGuides(REAL).length === 0, "(f) the real shipped help/guides.json is valid (empty is valid)");
ok(REAL.version === 1 && REAL.guides.length >= 1, "(f) the shipped file has guides");
{ const seen = {}; let dup = 0; REAL.guides.forEach((g) => g.buttons.forEach((b) => b.labels.pt.concat(b.labels.en).forEach((l) => { const k = core.normalize(l); if (seen[k] && seen[k] !== g.id) { dup++; } seen[k] = g.id; })));
  ok(dup === 0, "(f) no button label points at two different guides"); }
{ let missing = 0; REAL.guides.forEach((g) => g.sections.forEach((sec) => sec.steps.forEach((st) => { if (st.image) { ["pt", "en"].forEach((l) => { if (!existsSync(new URL(st.image[l], root))) { missing++; } }); } })));
  ok(missing === 0, "(f) every picture named in the shipped guides exists on disk"); }
ok(!/[\u2013\u2014]/.test(JSON.stringify(REAL)), "(f) the shipped guides contain no long dash or en dash");
const fixErrs = core.validateGuides(FIXTURE);
ok(fixErrs.length === 0, "(f) the two-guide fixture is valid" + (fixErrs.length ? " :: " + fixErrs.join(" | ") : ""));
let bad = clone(FIXTURE); delete bad.guides[0].sections[0].steps[0].text.en;
ok(core.validateGuides(bad).length > 0, "(f) a step missing its English text is caught");
bad = clone(FIXTURE); bad.guides[1].id = "estimate";
ok(core.validateGuides(bad).length > 0, "(f) duplicate guide ids are caught");
bad = clone(FIXTURE); bad.guides[0].sections[1].id = "create";
ok(core.validateGuides(bad).length > 0, "(f) duplicate section ids inside a guide are caught");
bad = clone(FIXTURE); bad.guides[0].buttons[1].section = "ghost";
ok(core.validateGuides(bad).length > 0, "(f) a button pointing at a missing section is caught");
bad = clone(FIXTURE); bad.guides[0].buttons[1].step = 9;
ok(core.validateGuides(bad).length > 0, "(f) a button pointing at a missing step is caught");
bad = clone(FIXTURE); bad.guides[0].title.pt = "";
ok(core.validateGuides(bad).length > 0, "(f) an empty guide title is caught");
bad = clone(FIXTURE); bad.guides[0].summary.en = "Send — fast";
ok(core.validateGuides(bad).length > 0, "(f) a long dash in visible text is caught");
bad = clone(FIXTURE); bad.pages.gmestimates.guides = ["ghost"];
ok(core.validateGuides(bad).length > 0, "(f) a page listing an unknown guide is caught");
bad = clone(FIXTURE); bad.guides[0].id = "has space";
ok(core.validateGuides(bad).length > 0, "(f) an id that is not plain is caught");
ok(core.validateGuides(null).length > 0 && core.validateGuides({ version: 2, guides: [], pages: {} }).length > 0, "(f) wrong version or no data is caught");

// ---------------------------------------------------------------- Worker pieces
const workerSrc = read("worker/index.js");
const WORKER_FNS = ["handlePostHelpAsk", "validateHelpReply", "helpBuildIndex", "helpSystemText", "helpPageKey", "publicReadRateLimited"];
const WORKER_VARS = ["HELP_AI_MODEL", "HELP_INDEX", "PUBLIC_READ_HITS", "PUBLIC_READ_HITS_SWEPT"];

function claudeOk(obj) {
  return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj) }] }) };
}
function mkEnv(opts) {
  opts = opts || {};
  const inserts = [];
  return {
    inserts,
    env: {
      CLAUDE_API_KEY: "test-key",
      DB: {
        prepare(sql) {
          return {
            bind(...a) {
              return { run: async () => { inserts.push({ sql, args: a }); if (opts.failInsert) { throw new Error("no such table: help_gaps"); } return { meta: { changes: 1 } }; } };
            }
          };
        }
      }
    }
  };
}
function mkWorker(o) {
  o = o || {};
  const calls = [];
  const errors = [];
  const logs = [];
  const stubs = {
    authenticate: async () => (o.user === undefined ? { role: "alice", email: "a@x.test", display_name: "A" } : o.user),
    jsonOk: (d) => ({ status: 200, data: d }),
    jsonErr: (m, s) => ({ status: s || 400, error: m }),
    CLAUDE_API_URL: "https://api.anthropic.com/v1/messages",
    HELP_GUIDES_V1: o.guides || FIXTURE,
    fetch: async (url, init) => { calls.push({ url, init }); return o.fetchImpl ? o.fetchImpl(url, init) : claudeOk({ guide_ids: ["estimate"], best: { guide: "estimate", section: "send" }, reply: "Veja o guia de orçamento." }); },
    console: { error: (...a) => errors.push(a.join(" ")), log: (...a) => logs.push(a.join(" ")), warn: () => {} }
  };
  const w = build(WORKER_FNS, WORKER_VARS, stubs);
  return { w, calls, errors, logs };
}
const askReq = (body) => req(body);

// ---------------------------------------------------------------- (d) validateHelpReply and core copy
const idxW = mkWorker().w;
const INDEX = idxW.helpBuildIndex(FIXTURE);
ok(typeof INDEX.text === "string" && INDEX.ids.estimate && INDEX.ids.estimate.sections.send === true, "(d) index has text and an id map with sections");
const CASES = [
  { name: "drops unknown guide ids", text: JSON.stringify({ guide_ids: ["estimate", "ghost", "invoice"], best: null, reply: "ok" }), check: (r) => r.found && r.guide_ids.join() === "estimate,invoice" },
  { name: "caps at 3", text: JSON.stringify({ guide_ids: ["estimate", "invoice", "estimate", "invoice"], best: null, reply: "ok" }), check: (r) => r.guide_ids.length <= 3 && r.guide_ids.join() === "estimate,invoice" },
  { name: "nulls a best that does not exist (guide)", text: JSON.stringify({ guide_ids: ["estimate"], best: { guide: "ghost", section: "send" }, reply: "ok" }), check: (r) => r.best === null },
  { name: "nulls a best that does not exist (section)", text: JSON.stringify({ guide_ids: ["estimate"], best: { guide: "estimate", section: "ghost" }, reply: "ok" }), check: (r) => r.best === null },
  { name: "keeps a real best", text: JSON.stringify({ guide_ids: ["estimate"], best: { guide: "estimate", section: "send" }, reply: "ok" }), check: (r) => r.best && r.best.guide === "estimate" && r.best.section === "send" },
  { name: "caps the reply at 400 characters", text: JSON.stringify({ guide_ids: ["estimate"], best: null, reply: "a".repeat(900) }), check: (r) => r.reply.length === 400 },
  { name: "strips control characters", text: JSON.stringify({ guide_ids: ["estimate"], best: null, reply: "oi\u0000\u0007 mundo\u001b[0m\u007f" }), check: (r) => !/[\u0000-\u001f\u007f-\u009f]/.test(r.reply) && r.reply.indexOf("oi") === 0 },
  { name: "non-JSON is not found", text: "Claro! O guia certo é o de orçamento.", check: (r) => r.found === false && r.guide_ids.length === 0 && r.best === null && r.reply === "" },
  { name: "an array is not found", text: JSON.stringify([{ guide_ids: ["estimate"] }]), check: (r) => r.found === false },
  { name: "an empty string is not found", text: "", check: (r) => r.found === false },
  { name: "null is not found", text: "null", check: (r) => r.found === false },
  { name: "guide_ids that is not an array is tolerated", text: JSON.stringify({ guide_ids: "estimate", best: null, reply: "x" }), check: (r) => r.found === false && r.guide_ids.length === 0 },
  { name: "reply that is not a string becomes empty", text: JSON.stringify({ guide_ids: ["estimate"], best: null, reply: { a: 1 } }), check: (r) => r.reply === "" && r.found === true },
  { name: "a code fence around the object is tolerated", text: "```json\n" + JSON.stringify({ guide_ids: ["invoice"], best: null, reply: "ok" }) + "\n```", check: (r) => r.found && r.guide_ids[0] === "invoice" },
  { name: "all ids unknown is not found", text: JSON.stringify({ guide_ids: ["ghost"], best: null, reply: "invented" }), check: (r) => r.found === false && r.reply === "" }
];
CASES.forEach(function (c) {
  ok(c.check(idxW.validateHelpReply(c.text, INDEX)), "(d) worker validateHelpReply " + c.name);
  ok(c.check(core.validateReply(c.text, INDEX)), "(d) help-core validateReply " + c.name);
});

// ---------------------------------------------------------------- index size
function bigFixture(n) {
  const g = clone(FIXTURE);
  const base = g.guides[0];
  g.guides = [];
  g.pages = {};
  const topics = ["estimate", "invoice", "contract", "receipt", "change order", "calendar", "client list", "lead", "photo", "route", "referral", "review request", "price list", "expense", "bank sync", "goal", "daily log", "document", "login", "language"];
  for (let i = 0; i < n; i++) {
    const t = topics[i % topics.length] + " " + (Math.floor(i / topics.length) + 1);
    const c = clone(base);
    c.id = "guide-" + i;
    c.title = { pt: "Como usar: " + t, en: "How to use: " + t };
    c.summary = { pt: "Passo a passo para " + t + " sem erro, do começo ao fim, com as telas.", en: "Step by step for " + t + " with no mistakes, from start to finish, with screens." };
    c.keywords = { pt: [t, "enviar", "criar", "corrigir", "cliente", "pagamento", "mensagem"], en: [t, "send", "create", "fix", "customer", "payment", "message"] };
    g.guides.push(c);
  }
  return g;
}
const big = bigFixture(40);
ok(core.validateGuides(big).length === 0, "(index) the 40 guide fixture is itself valid");
const bigIndex = idxW.helpBuildIndex(big);
console.log("INFO  index size for a 40 guide fixture: " + bigIndex.text.length + " characters");
ok(bigIndex.text.length < 30000, "(index) the 40 guide index stays under 30,000 characters (" + bigIndex.text.length + ")");
ok(bigIndex.text.indexOf("Toque em Salvar e enviar") === -1 && bigIndex.text.indexOf(".jpg") === -1, "(index) the index has no step text and no image paths");
ok(idxW.helpBuildIndex(EMPTY).text === "" && Object.keys(idxW.helpBuildIndex(EMPTY).ids).length === 0, "(index) the empty library gives an empty index");

// ---------------------------------------------------------------- (g) the route
(async function () {
  const good = { question: "como envio um orçamento?", language: "pt", page_key: "gmestimates" };

  // 401
  { const { w, calls } = mkWorker({ user: null }); const { env } = mkEnv();
    const r = await w.handlePostHelpAsk(askReq(good), env);
    ok(r.status === 401 && calls.length === 0, "(g) not signed in gives 401 and calls nothing"); }

  // 400s
  { const { w, calls } = mkWorker(); const { env } = mkEnv();
    const bads = [{}, { question: 5 }, { question: "ab" }, { question: "  a  " }, { question: "x".repeat(301) }, null];
    let all400 = true;
    for (const b of bads) { const r = await w.handlePostHelpAsk(askReq(b), env); if (r.status !== 400) { all400 = false; console.log("  got " + r.status + " for " + JSON.stringify(b)); } }
    ok(all400 && calls.length === 0, "(g) a bad body gives 400 and calls nothing");
    const r2 = await w.handlePostHelpAsk({ url: "https://x.test/", headers: { get: () => null }, json: async () => { throw new Error("bad json"); } }, env);
    ok(r2.status === 400, "(g) a body that is not JSON gives 400");
    const r3 = await w.handlePostHelpAsk(askReq({ question: "x".repeat(300) }), env);
    ok(r3.status === 200, "(g) exactly 300 characters is accepted"); }

  // happy path and request shape
  { const { w, calls } = mkWorker(); const { env, inserts } = mkEnv();
    const r = await w.handlePostHelpAsk(askReq({ question: "  como envio um orçamento?  ", language: "en", page_key: "gmestimates" }), env);
    ok(r.status === 200 && r.data.found === true && r.data.guide_ids[0] === "estimate" && r.data.best.section === "send", "(g) a good question returns found with the ids");
    ok(inserts.length === 0, "(g) found true writes nothing to the database");
    const sent = JSON.parse(calls[0].init.body);
    ok(calls.length === 1 && calls[0].url === "https://api.anthropic.com/v1/messages", "(g) one call to the Messages API");
    ok(sent.model === "claude-haiku-5-5" && sent.max_tokens === 400, "(g) model claude-haiku-5-5 and max_tokens 400");
    ok(Array.isArray(sent.system) && sent.system.length === 1 && sent.system[0].type === "text" && sent.system[0].cache_control && sent.system[0].cache_control.type === "ephemeral", "(g) system is ONE text block with cache_control ephemeral");
    ok(sent.messages.length === 1 && sent.messages[0].role === "user" && sent.messages[0].content === "como envio um orçamento?", "(g) the trimmed question is the only user message");
    ok(sent.system[0].text.indexOf("UNTRUSTED") !== -1 && sent.system[0].text.indexOf("estimate") !== -1, "(g) system text warns the question is untrusted and carries the index");
    ok(sent.system[0].text.indexOf("como envio") === -1, "(g) the question is not copied into the system text");
    ok(calls[0].init.headers["x-api-key"] === "test-key" && calls[0].init.headers["anthropic-version"] === "2023-06-01", "(g) same headers as the support route");
    const sentPt = (await (async function () { const m = mkWorker(); await m.w.handlePostHelpAsk(askReq({ question: "como envio?", language: "pt" }), mkEnv().env); return JSON.parse(m.calls[0].init.body); })());
    ok(sentPt.system[0].text !== sent.system[0].text, "(g) the language changes the system text"); }

  // 429 on the 16th call
  { const { w } = mkWorker(); const { env } = mkEnv();
    let last = null, firstFifteenOk = true;
    for (let i = 1; i <= 16; i++) { last = await w.handlePostHelpAsk(askReq(good), env); if (i <= 15 && last.status !== 200) { firstFifteenOk = false; } }
    ok(firstFifteenOk && last.status === 429, "(g) the 16th call inside the window gives 429, the first 15 pass");
    ok(typeof last.error === "string" && last.error.length > 0 && last.error.indexOf("Error") !== 0, "(g) the 429 carries a friendly message"); }

  // strip an id that is not in the index
  { const { w } = mkWorker({ fetchImpl: async () => claudeOk({ guide_ids: ["ghost", "invoice"], best: { guide: "ghost", section: "x" }, reply: "Veja o guia." }) }); const { env } = mkEnv();
    const r = await w.handlePostHelpAsk(askReq(good), env);
    ok(r.status === 200 && r.data.guide_ids.join() === "invoice" && r.data.best === null, "(g) a model id that is not in the index is stripped"); }

  // Claude failure -> 502
  { const { w, errors } = mkWorker({ fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({ error: "secret detail" }) }) }); const { env } = mkEnv();
    const r = await w.handlePostHelpAsk(askReq({ question: "pergunta secreta sobre orçamento", language: "pt" }), env);
    ok(r.status === 502 && typeof r.error === "string" && r.error.indexOf("500") === -1 && r.error.indexOf("secret") === -1, "(g) a Claude failure gives 502 with a generic body");
    ok(errors.length >= 1 && errors.every((e) => e.indexOf("pergunta secreta") === -1), "(g) the failure is logged and the log never has the question"); }
  { const { w } = mkWorker({ fetchImpl: async () => { throw new Error("network down"); } }); const { env } = mkEnv();
    const r = await w.handlePostHelpAsk(askReq(good), env);
    ok(r.status === 502 && r.error.indexOf("network") === -1, "(g) a thrown fetch also gives a generic 502"); }

  // found false -> one insert, bound
  { const { w } = mkWorker({ fetchImpl: async () => claudeOk({ guide_ids: [], best: null, reply: "" }) }); const { env, inserts } = mkEnv();
    const q = "como faço um foguete? '); DROP TABLE users;--";
    const r = await w.handlePostHelpAsk(askReq({ question: q, language: "en", page_key: "gm-crm_1" }), env);
    ok(r.status === 200 && r.data.found === false && r.data.logged === true, "(g) not found logs the gap and says logged true");
    ok(inserts.length === 1, "(g) found false calls the insert exactly once");
    const ins = inserts[0];
    ok(/INSERT INTO help_gaps/i.test(ins.sql) && (ins.sql.match(/\?/g) || []).length === ins.args.length, "(g) the insert is parameterized (one ? per bound value)");
    ok(ins.sql.indexOf("DROP") === -1 && ins.sql.indexOf(q) === -1, "(g) the question text is never in the SQL");
    ok(ins.args.indexOf(q) !== -1 && ins.args.indexOf("en") !== -1 && ins.args.indexOf("gm-crm_1") !== -1 && ins.args.indexOf("alice") !== -1, "(g) bound: question, language, page_key, role");
    ok(ins.args.every((a) => String(a).indexOf("a@x.test") === -1), "(g) no email or name is stored"); }

  // question cut to 300 on store, page_key rule
  { const { w } = mkWorker({ fetchImpl: async () => claudeOk("not json") }); const { env, inserts } = mkEnv();
    await w.handlePostHelpAsk(askReq({ question: "y".repeat(300), language: "xx", page_key: "bad key!" }), env);
    ok(inserts.length === 1 && inserts[0].args.some((a) => a === "y".repeat(300)), "(g) the stored question is at most 300 characters");
    ok(inserts[0].args.indexOf("pt") !== -1, "(g) an unknown language defaults to pt");
    ok(inserts[0].args.indexOf("bad key!") === -1 && inserts[0].args.indexOf("") !== -1, "(g) a bad page_key is stored as empty");
    ok(w.helpPageKey("a".repeat(61)) === "" && w.helpPageKey("a".repeat(60)) === "a".repeat(60) && w.helpPageKey("ok-1_x") === "ok-1_x" && w.helpPageKey(5) === "", "(g) page_key: 60 chars max, letters digits dash underscore"); }

  // failing insert -> 200 logged false
  { const { w, errors } = mkWorker({ fetchImpl: async () => claudeOk({ guide_ids: [], best: null, reply: "" }) }); const { env } = mkEnv({ failInsert: true });
    const r = await w.handlePostHelpAsk(askReq({ question: "pergunta confidencial sem guia" }), env);
    ok(r.status === 200 && r.data.found === false && r.data.logged === false, "(g) a failing insert still returns 200 with logged false");
    ok(errors.length >= 1 && errors.every((e) => e.indexOf("pergunta confidencial") === -1), "(g) the insert failure is logged without the question"); }

  // empty library: no model call, gap logged
  { const { w, calls } = mkWorker({ guides: EMPTY }); const { env, inserts } = mkEnv();
    const r = await w.handlePostHelpAsk(askReq(good), env);
    ok(r.status === 200 && r.data.found === false && calls.length === 0 && inserts.length === 1, "(g) with an empty library the model is not called and the gap is logged"); }

  // client portal users pass (role client, no email)
  { const { w } = mkWorker({ user: { role: "client", client_id: "c1", username: "loja1", login_role: "client" } }); const { env } = mkEnv();
    const r = await w.handlePostHelpAsk(askReq(good), env);
    ok(r.status === 200, "(g) a portal client user (no email) is accepted"); }

  // ------------------------------------------------------------ (g2) gates in the Worker source
  ok(/path === "\/api\/help\/ask" && method === "POST"/.test(workerSrc.replace(/\s+/g, " ")), "(g) the route is registered for POST /api/help/ask");
  const crSrc = workerSrc.slice(workerSrc.indexOf("function clientRequestAllowed("), workerSrc.indexOf("function clientRequestAllowed(") + 6000);
  ok(crSrc.indexOf("/api/help/ask") !== -1, "(g) portal client users are allowed through clientRequestAllowed");
  const srSrc = workerSrc.slice(workerSrc.indexOf("function sellerRequestAllowed("), workerSrc.indexOf("function sellerRequestAllowed(") + 2500);
  ok(srSrc.indexOf("/api/help/ask") !== -1, "(g) salespeople are allowed through sellerRequestAllowed");
  ok(/var HELP_AI_MODEL = "claude-haiku-5-5";/.test(workerSrc) && workerSrc.indexOf("var HELP_AI_MODEL") - workerSrc.indexOf("var SUPPORT_AI_MODEL") < 400, "(g) HELP_AI_MODEL is one line next to SUPPORT_AI_MODEL");
  ok(/var CLAUDE_API_URL\s*=\s*"https:\/\/api\.anthropic\.com\/v1\/messages";/.test(workerSrc), "(g) the stubbed API address is the real constant");
  ok(/import HELP_GUIDES_V1 from "\.\.\/help\/guides\.json";/.test(workerSrc), "(g) the guide file is imported like the other JSON files");
  ok(!/help_gaps[^;]*\+\s*(q|question)/.test(workerSrc), "(g) no SQL for help_gaps is built by joining strings");

  // ------------------------------------------------------------ (h) the flag guard
  function fakePage(flag) {
    const rec = { docListeners: [], winListeners: [], created: [], appended: 0, fetches: 0, timers: 0 };
    const mkEl = (tag) => { const e = { tag, style: {}, children: [], attrs: {}, classList: { add() {}, remove() {}, contains() { return false; } }, setAttribute(k, v) { e.attrs[k] = v; }, getAttribute(k) { return e.attrs[k] === undefined ? null : e.attrs[k]; }, appendChild(c) { rec.appended++; e.children.push(c); return c; }, addEventListener() {}, insertBefore(c) { rec.appended++; return c; }, querySelector() { return null; }, querySelectorAll() { return []; } }; rec.created.push(tag); return e; };
    const doc = {
      readyState: "complete", body: mkEl("body"), head: mkEl("head"),
      addEventListener(t) { rec.docListeners.push(t); }, removeEventListener() {},
      createElement: mkEl, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; }
    };
    doc.body.classList = { contains() { return false; }, add() {}, remove() {} };
    rec.created.length = 0;   // the page's own body and head do not count
    const win = {
      APEX_HELP: flag, HelpCore: core,
      addEventListener(t) { rec.winListeners.push(t); }, removeEventListener() {},
      location: { pathname: "/dashboard.html", search: "", origin: "https://apex.resonateai.online" },
      setTimeout: function () { rec.timers++; return 1; }, clearTimeout() {},
      fetch: function () { rec.fetches++; return Promise.reject(new Error("no network in tests")); },
      matchMedia: function () { return { matches: false }; }
    };
    win.window = win; win.document = doc;
    const ctx = vm.createContext({ window: win, document: doc, console, setTimeout: win.setTimeout, clearTimeout: win.clearTimeout, fetch: win.fetch, Promise, JSON, Date, Math, Object, Array, String, Number, RegExp, encodeURIComponent, decodeURIComponent, URL });
    return { ctx, rec, win };
  }
  const widgetSrc = read("help-widget.js");
  { const p = fakePage({ enabled: false, base: "https://apex.resonateai.online/" });
    vm.runInContext(widgetSrc, p.ctx);
    ok(p.rec.docListeners.length === 0 && p.rec.winListeners.length === 0, "(h) flag off: the widget registers no handler");
    ok(p.rec.created.length === 0 && p.rec.appended === 0, "(h) flag off: the widget adds no button and no element");
    ok(p.rec.fetches === 0 && p.rec.timers === 0, "(h) flag off: the widget makes no network call and starts no timer"); }
  { const p = fakePage(undefined);
    vm.runInContext(widgetSrc, p.ctx);
    ok(p.rec.docListeners.length === 0 && p.rec.fetches === 0, "(h) no config object at all behaves like off"); }
  { const p = fakePage({ enabled: "true", base: "x" });
    vm.runInContext(widgetSrc, p.ctx);
    ok(p.rec.docListeners.length === 0, "(h) only the boolean true turns it on (the string \"true\" does not)"); }
  ok(core.isEnabled({ APEX_HELP: { enabled: false } }) === false && core.isEnabled({ APEX_HELP: { enabled: true } }) === true && core.isEnabled({}) === false && core.isEnabled(null) === false, "(h) the guard function: only enabled === true");
  { const p = fakePage({ enabled: true, base: "https://apex.resonateai.online/" });
    vm.runInContext(widgetSrc, p.ctx);
    ok(p.rec.docListeners.indexOf("pointerdown") !== -1 && p.rec.docListeners.indexOf("contextmenu") !== -1, "(h) flag on: the widget registers its press and right click handlers (proves the guard is the only thing holding it back)"); }

  // ------------------------------------------------------------ (i) and (j) source guards
  const helpHtml = read("help.html");
  const cfgSrc = read("help-config.js");
  [["help-widget.js", widgetSrc], ["help.html", helpHtml]].forEach(function (pair) {
    const name = pair[0], src = pair[1];
    ok(!/(^|[^A-Za-z0-9_.$])(window\.)?(alert|confirm|prompt)\(/m.test(src), "(i) " + name + " has no alert(, confirm( or prompt(");
    ok(src.indexOf("IntersectionObserver") === -1, "(i) " + name + " has no IntersectionObserver");
    const assigns = src.match(/\.innerHTML\s*\+?=\s*[^;\n]*/g) || [];
    const badAssign = assigns.filter(function (a) { return !/^\.innerHTML\s*=\s*(""|ICON_[A-Z_]+)\s*$/.test(a.trim()); });
    ok(badAssign.length === 0, "(i) " + name + " assigns innerHTML only from empty text or its own icon constants" + (badAssign.length ? " :: " + badAssign.join(" | ") : ""));
    ok(!/insertAdjacentHTML|document\.write\(|outerHTML\s*=|eval\(|new Function\(/.test(src), "(i) " + name + " has no other markup-from-string path");
    ok(!/Ajuda/i.test(src) && !/\bHelp\b/.test(src), "(j) " + name + " never shows Ajuda or Help");
    ok(src.indexOf("Aprenda") !== -1 && src.indexOf("Learn") !== -1, "(j) " + name + " shows Aprenda and Learn");
    ok(src.indexOf("–") === -1 && src.indexOf("—") === -1, "(j) " + name + " has no long dash or en dash");
  });
  [["help-widget.js", widgetSrc], ["help-core.js", read("help-core.js")], ["help-config.js", cfgSrc]].forEach(function (pair) {
    const src = pair[1];
    ok(!/\b(const|let)\s+[A-Za-z_$]/.test(src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/"(?:[^"\\\n]|\\.)*"/g, '""').replace(/'(?:[^'\\\n]|\\.)*'/g, "''")), "(rules) " + pair[0] + " uses var, not const or let");
    ok(!/=>/.test(src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/"(?:[^"\\\n]|\\.)*"/g, '""')), "(rules) " + pair[0] + " has no arrow functions");
  });
  ok(/HELP_BASE\s*=\s*"https:\/\/apex\.resonateai\.online\/"/.test(cfgSrc) && /enabled:\s*false/.test(cfgSrc), "(flag) help-config.js ships enabled false with the live origin as HELP_BASE");
  ok(read("CNAME").trim() === "apex.resonateai.online", "(flag) HELP_BASE matches the CNAME file");
  ok(widgetSrc.indexOf("navigator.vibrate") === -1 && widgetSrc.indexOf("Haptics") === -1, "(rules) no vibration or haptics code");

  // ------------------------------------------------------------ plumbing: headers, service worker, pages
  const headers = read("_headers");
  ok(/\/help\/\*[\s\S]{0,200}Access-Control-Allow-Origin: \*/.test(headers), "(plumbing) _headers sends Access-Control-Allow-Origin: * for /help/");
  const sw = read("sw.js");
  ok(/\/help\//.test(sw.slice(sw.indexOf("function isStaticAsset("), sw.indexOf("self.addEventListener(\"install\""))), "(plumbing) sw.js never treats /help/ files as cache-first static assets");
  const PAGES = ["portal", "add-user", "calendar", "clients", "client-analytics", "client", "documents", "dashboard", "finance-new", "finance", "login-activity", "seller-diagnostics", "settings", "sales", "sessions", "tasks", "vendors"];
  const NOT = ["estimate-view", "contract-view", "apex-invoice-view", "invoice-view", "receipt-view", "apex-receipt-view", "change-order-view", "contract-review", "ack-view", "book", "agendar", "apex-referral", "referral", "apex-club", "club", "link", "card", "index", "privacy", "terms", "invite-login", "help"];
  PAGES.forEach(function (p) {
    const src = read(p + ".html");
    const cfgAt = src.indexOf('src="help-config.js'), wAt = src.indexOf('src="help-widget.js'), coreAt = src.indexOf('src="help-core.js');
    ok(cfgAt !== -1 && coreAt !== -1 && wAt !== -1 && cfgAt < coreAt && coreAt < wAt, "(pages) " + p + ".html loads help-config.js, help-core.js, then help-widget.js");
    let ios = "";
    try { ios = read("ios/App/App/public/" + p + ".html"); } catch (e) { ios = ""; }
    ok(ios.indexOf('src="help-widget.js') !== -1, "(pages) the iOS copy of " + p + ".html loads it too");
  });
  NOT.forEach(function (p) {
    let src = "";
    try { src = read(p + ".html"); } catch (e) { return; }
    ok(src.indexOf("help-widget.js") === -1, "(pages) " + p + ".html does NOT load the widget");
  });
  ok(read("migrations/help_gaps.sql").indexOf("CREATE TABLE IF NOT EXISTS help_gaps") !== -1, "(plumbing) migrations/help_gaps.sql creates help_gaps");

  console.log("\n" + passed + " passed, " + failed + " failed");
  process.exit(failed ? 1 : 0);
})();
