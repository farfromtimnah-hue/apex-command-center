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

// ---------------------------------------------------------------- (v) video shapes and videoFor
function withVideo(v) { const d = clone(FIXTURE); d.guides[1].video = v; return d; }
const VID = "https://example.com/v.mp4", POS = "https://example.com/p.jpg";
ok(core.validateGuides(withVideo(null)).length === 0, "(v) validator accepts video null");
ok(core.validateGuides(withVideo({ pt: { src: VID, poster: POS }, en: null })).length === 0, "(v) validator accepts the object shape for pt with en null");
ok(core.validateGuides(withVideo({ pt: { src: VID, poster: POS }, en: { src: VID } })).length === 0, "(v) validator accepts the object shape for both languages (poster optional)");
ok(core.validateGuides(withVideo({ pt: VID, en: VID })).length === 0, "(v) validator accepts the plain https string shape");
ok(core.validateGuides(withVideo({ pt: { src: VID } })).length === 0, "(v) a missing language is allowed (no video for it)");
ok(core.validateGuides(withVideo({ pt: { src: "http://example.com/v.mp4" }, en: null })).length > 0, "(v) validator rejects a src with http://");
ok(core.validateGuides(withVideo({ pt: { src: "javascript:alert(1)" }, en: null })).length > 0, "(v) validator rejects a src with javascript:");
ok(core.validateGuides(withVideo({ pt: { src: VID, poster: "http://example.com/p.jpg" }, en: null })).length > 0, "(v) validator rejects a poster with http://");
ok(core.validateGuides(withVideo({ pt: { src: VID, poster: 5 }, en: null })).length > 0, "(v) validator rejects a poster that is not a string");
ok(core.validateGuides(withVideo({ pt: 5, en: null })).length > 0, "(v) validator rejects a language value that is a number");
ok(core.validateGuides(withVideo({ pt: { poster: POS }, en: null })).length > 0, "(v) validator rejects an object without src");
ok(core.validateGuides(withVideo({ pt: "http://example.com/v.mp4", en: null })).length > 0, "(v) validator rejects a plain string that is not https");
ok(core.validateGuides(withVideo({ pt: [VID], en: null })).length > 0 && core.validateGuides(withVideo({ pt: true, en: null })).length > 0, "(v) validator rejects an array or a boolean as a language value");
ok(core.validateGuides(withVideo("https://example.com/v.mp4")).length > 0, "(v) validator rejects a video that is a bare string");

ok(typeof core.videoFor === "function", "(v) help-core exports videoFor");
if (typeof core.videoFor === "function") {
  const vf = core.videoFor;
  const both = { video: { pt: { src: VID, poster: POS }, en: { src: VID + "?en" } } };
  const r1 = vf(both, "pt");
  ok(r1 && r1.src === VID && r1.poster === POS, "(v) videoFor returns {src, poster} for a language that has a video");
  const r2 = vf(both, "en");
  ok(r2 && r2.src === VID + "?en" && !r2.poster, "(v) videoFor returns no poster when the object has none");
  ok(vf({ video: { pt: { src: VID }, en: null } }, "en") === null, "(v) videoFor returns null for a language that is null");
  ok(vf({ video: { pt: { src: VID } } }, "en") === null, "(v) videoFor returns null for a missing language");
  ok(vf({ video: null }, "pt") === null && vf({}, "pt") === null && vf(null, "pt") === null, "(v) videoFor returns null for video null, no video, or no guide");
  const r3 = vf({ video: { pt: VID, en: null } }, "pt");
  ok(r3 && r3.src === VID && !r3.poster, "(v) videoFor treats a plain string as {src} with no poster");
  ok(vf({ video: { pt: "http://example.com/v.mp4" } }, "pt") === null, "(v) videoFor returns null for an http string");
  ok(vf({ video: { pt: { src: "http://example.com/v.mp4" } } }, "pt") === null, "(v) videoFor returns null for an http src");
  ok(vf({ video: { pt: { src: "javascript:alert(1)" } } }, "pt") === null, "(v) videoFor returns null for a javascript: src");
  ok(vf({ video: { pt: { src: VID, poster: "http://example.com/p.jpg" } } }, "pt") === null, "(v) videoFor returns null when the poster is not https");
  ok(vf({ video: { pt: 5 } }, "pt") === null && vf({ video: { pt: { poster: POS } } }, "pt") === null && vf({ video: { pt: [VID] } }, "pt") === null, "(v) videoFor returns null for a number, an object without src, or an array");
  ok(vf(both, "fr") === null && vf(both, "__proto__") === null, "(v) videoFor returns null for a language other than pt or en");
}

// ---------------------------------------------------------------- (aud) audience rules in help-core
function withAud(v, present) { const d = clone(FIXTURE); if (present) { d.guides[0].audience = v; } else { delete d.guides[0].audience; } return d; }
ok(core.validateGuides(withAud("admin", true)).length === 0, "(aud) validator accepts audience admin");
ok(core.validateGuides(withAud("client", true)).length === 0, "(aud) validator accepts audience client");
ok(core.validateGuides(withAud(undefined, false)).length === 0, "(aud) validator accepts no audience field");
ok(core.validateGuides(withAud("staff", true)).length > 0, "(aud) validator rejects audience staff");
ok(core.validateGuides(withAud("ADMIN", true)).length > 0, "(aud) validator rejects audience ADMIN");
ok(core.validateGuides(withAud(5, true)).length > 0, "(aud) validator rejects a number as audience");
ok(core.validateGuides(withAud(null, true)).length > 0, "(aud) validator rejects null as a present audience");
ok(core.validateGuides(FIXTURE).length === 0, "(aud) the fixture with both sides is valid");
ok(typeof core.guideAudience === "function" && typeof core.filterByAudience === "function" && typeof core.defaultAudienceForPage === "function" && typeof core.effectiveAudience === "function" && typeof core.isStaffRole === "function", "(aud) help-core exports the side functions");
if (typeof core.guideAudience === "function") {
  ok(core.guideAudience({ id: "x" }) === "client" && core.guideAudience({ audience: "client" }) === "client" && core.guideAudience({ audience: "admin" }) === "admin", "(aud) guideAudience defaults to client");
  ok(core.guideAudience({ audience: "staff" }) === null && core.guideAudience({ audience: "ADMIN" }) === null && core.guideAudience(null) === null, "(aud) guideAudience gives null for a bad value, so it is shown to nobody");
  const mixed = FIXTURE.guides;
  ok(core.filterByAudience(mixed, "admin").map((g) => g.id).join() === "admin-invoice,admin-users", "(aud) filterByAudience admin keeps only admin guides");
  ok(core.filterByAudience(mixed, "client").map((g) => g.id).join() === "estimate,invoice,receipt,contract", "(aud) filterByAudience client keeps guides with no field and client guides");
  ok(core.filterByAudience(null, "admin").length === 0 && core.filterByAudience(mixed, "nope").length === 0, "(aud) filterByAudience of nothing or of an unknown side is empty");
  const bad = [{ id: "a", audience: "staff" }, { id: "b" }];
  ok(core.filterByAudience(bad, "client").map((g) => g.id).join() === "b" && core.filterByAudience(bad, "admin").length === 0, "(aud) a guide with a bad audience shows on neither side");
  ok(core.defaultAudienceForPage("portal") === "client" && core.defaultAudienceForPage("portal.html") === "client", "(aud) the portal page defaults to client");
  ["dashboard", "clients", "calendar", "client", "tasks", "finance", "sessions", "settings", "help", "", null, undefined].forEach((pg) => {
    ok(core.defaultAudienceForPage(pg) === "admin", "(aud) page " + JSON.stringify(pg) + " defaults to admin");
  });
  ok(core.effectiveAudience(false, "admin") === "client" && core.effectiveAudience(false, "client") === "client" && core.effectiveAudience(false, undefined) === "client" && core.effectiveAudience(false, "x") === "client", "(aud) a person who is not staff always gets client");
  ok(core.effectiveAudience(true, "admin") === "admin" && core.effectiveAudience(true, "client") === "client", "(aud) staff get the side they asked for");
  ok(core.effectiveAudience(true, undefined) === "admin" && core.effectiveAudience(true, "staff") === "admin" && core.effectiveAudience(true, null) === "admin", "(aud) staff with no or a bad request get admin");
  ["alice", "rafa", "developer", "seller"].forEach((r) => ok(core.isStaffRole(r) === true, "(aud) isStaffRole " + r));
  ["client", "owner", "partner", "staff", "staff_finance", "", null, undefined, "Alice"].forEach((r) => ok(core.isStaffRole(r) === false, "(aud) isStaffRole " + JSON.stringify(r) + " is false"));
}
{ // validateReply and other_side in help-core
  const cIdx = { ids: { estimate: { sections: { send: true } } }, other: { ids: { "admin-invoice": {}, "admin-users": {}, "admin-x": {} } } };
  const r1 = core.validateReply(JSON.stringify({ guide_ids: [], best: null, reply: "", other_side: ["admin-invoice", "ghost", "admin-users", "admin-x"] }), cIdx);
  ok(r1.found === false && Array.isArray(r1.other_side) && r1.other_side.join() === "admin-invoice,admin-users", "(aud) core: other_side keeps only ids from the other list, at most 2");
  const r2 = core.validateReply(JSON.stringify({ guide_ids: ["estimate"], best: null, reply: "ok", other_side: ["admin-invoice"] }), cIdx);
  ok(r2.found === true && r2.other_side.length === 0, "(aud) core: other_side is dropped when guide_ids is not empty");
  const r3 = core.validateReply(JSON.stringify({ guide_ids: [], best: null, reply: "", other_side: ["admin-invoice"] }), { ids: cIdx.ids });
  ok(r3.other_side.length === 0, "(aud) core: with no other list, other_side is always empty");
  const r4 = core.validateReply(JSON.stringify({ guide_ids: ["estimate"], best: null, reply: "ok" }), cIdx);
  ok(Array.isArray(r4.other_side) && r4.other_side.length === 0, "(aud) core: other_side is always present as a list");
  const r5 = core.validateReply(JSON.stringify({ guide_ids: [], best: null, reply: "", other_side: "admin-invoice" }), cIdx);
  ok(r5.other_side.length === 0, "(aud) core: other_side that is not a list is ignored");
}

ok(core.parseDeepLink("?audience=admin").audience === "admin" && core.parseDeepLink("?audience=client").audience === "client", "(aud) deep link reads audience admin or client");
ok(core.parseDeepLink("?audience=staff").audience === null && core.parseDeepLink("?audience=ADMIN").audience === null && core.parseDeepLink("").audience === null && core.parseDeepLink("?audience=").audience === null, "(aud) any other audience value is ignored");
// ---------------------------------------------------------------- Worker pieces
const workerSrc = read("worker/index.js");
const WORKER_FNS = ["handlePostHelpAsk", "validateHelpReply", "helpBuildIndex", "helpBuildOtherList", "helpGuideAudience", "supportStaffAuthed", "helpSystemText", "helpPageKey", "publicReadRateLimited"];
const WORKER_VARS = ["HELP_AI_MODEL", "HELP_INDEXES", "HELP_OTHERS", "PUBLIC_READ_HITS", "PUBLIC_READ_HITS_SWEPT"];
const STAFF = { role: "alice", email: "a@x.test", display_name: "A" };
const CLIENT = { role: "client", client_id: "c1", username: "loja1", login_role: "client" };

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
    authenticate: async () => (o.user === undefined ? CLIENT : o.user),
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
const INDEX = idxW.helpBuildIndex(FIXTURE, "client");
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
  { const { w } = mkWorker({ user: STAFF, fetchImpl: async () => claudeOk({ guide_ids: [], best: null, reply: "" }) }); const { env, inserts } = mkEnv();
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

  // ------------------------------------------------------------ (aud) the route and the two sides
  const sysOf = (calls) => JSON.parse(calls[0].init.body).system[0].text;
  const indexPart = (txt) => txt.split("OTHER SIDE GUIDES")[0];
  const askAs = async (user, body, fetchImpl) => { const m = mkWorker({ user, fetchImpl }); const e = mkEnv(); const r = await m.w.handlePostHelpAsk(askReq(Object.assign({ question: "como emito uma fatura?", language: "pt" }, body)), e.env); return { r, calls: m.calls, inserts: e.inserts, errors: m.errors }; };
  const hit = (ids, extra) => async () => claudeOk(Object.assign({ guide_ids: ids, best: null, reply: "Veja." }, extra || {}));

  { // a person who is not staff is always answered from the client index
    const a = await askAs(CLIENT, { audience: "admin" }, hit(["estimate"]));
    const txt = sysOf(a.calls);
    ok(a.r.status === 200 && a.r.data.audience === "client", "(aud) route: a client asking audience admin gets audience client in the response");
    ok(txt.indexOf("id=estimate") !== -1 && txt.indexOf("id=invoice") !== -1, "(aud) route: a client request carries the client guide lines");
    ok(txt.indexOf("admin-invoice") === -1 && txt.indexOf("admin-users") === -1 && txt.indexOf("Emitir a fatura") === -1 && txt.indexOf("Issue a customer invoice") === -1, "(aud) route: a client request carries no admin guide line");
    ok(txt.indexOf("OTHER SIDE") === -1 && txt.indexOf("other_side") === -1, "(aud) route: a client request carries no other side list and no mention of one");
    const b = await askAs(CLIENT, { audience: "admin" }, hit([], { other_side: ["admin-invoice", "admin-users"] }));
    ok(b.r.data.found === false && b.r.data.other_side.length === 0 && b.r.data.audience === "client", "(aud) route: a client never receives other_side even if the model returns it");
    const c = await askAs(CLIENT, { audience: "admin" }, hit(["admin-invoice", "invoice"]));
    ok(c.r.data.guide_ids.join() === "invoice", "(aud) route: an admin id named by the model for a client is stripped");
    const d = await askAs(CLIENT, { audience: "admin" }, hit(["admin-invoice"]));
    ok(d.r.data.found === false && d.r.data.guide_ids.length === 0 && d.inserts.length === 1 && d.inserts[0].args.indexOf("client") !== -1, "(aud) route: a client who only gets an admin id is not found, and the gap is stored as client");
    const e2 = await askAs(CLIENT, {}, hit(["estimate"]));
    ok(e2.r.data.audience === "client" && e2.r.data.found === true, "(aud) route: a client with no audience in the body gets client");
    const e3 = await askAs({ role: "owner", client_id: "c2", login_role: "client" }, { audience: "admin" }, hit(["estimate"]));
    ok(e3.r.data.audience === "client", "(aud) route: other portal roles (owner) are not staff");
  }
  { // staff get the side they ask for
    const a = await askAs(STAFF, { audience: "admin" }, hit(["admin-invoice"]));
    const txt = sysOf(a.calls), idx = indexPart(txt);
    ok(a.r.data.audience === "admin" && a.r.data.found === true && a.r.data.guide_ids.join() === "admin-invoice", "(aud) route: staff asking admin get the admin guide");
    ok(idx.indexOf("id=admin-invoice") !== -1 && idx.indexOf("id=admin-users") !== -1 && idx.indexOf("id=estimate") === -1 && idx.indexOf("id=invoice ") === -1, "(aud) route: staff asking admin get the admin index only");
    const b = await askAs(STAFF, { audience: "client" }, hit(["invoice"]));
    const idx2 = indexPart(sysOf(b.calls));
    ok(b.r.data.audience === "client" && b.r.data.guide_ids.join() === "invoice", "(aud) route: staff asking client get the client guide");
    ok(idx2.indexOf("id=estimate") !== -1 && idx2.indexOf("id=admin-invoice") === -1 && idx2.indexOf("id=admin-users") === -1, "(aud) route: staff asking client get the client index only");
    const c = await askAs(STAFF, { audience: "admin" }, hit(["estimate", "admin-users"]));
    ok(c.r.data.guide_ids.join() === "admin-users", "(aud) route: a model id from the wrong side is stripped for staff too");
    const d = await askAs(STAFF, {}, hit(["admin-invoice"]));
    ok(d.r.data.audience === "admin", "(aud) route: staff with no audience get admin");
    const e = await askAs(STAFF, { audience: "staff" }, hit(["admin-invoice"]));
    ok(e.r.data.audience === "admin", "(aud) route: staff with a bad audience get admin");
    for (const role of ["rafa", "developer", "seller"]) {
      const x = await askAs({ role, email: role + "@x.test" }, { audience: "client" }, hit(["invoice"]));
      ok(x.r.data.audience === "client", "(aud) route: role " + role + " counts as staff");
    }
    const f = await askAs({ role: "Alice" }, { audience: "admin" }, hit(["admin-invoice"]));
    ok(f.r.data.audience === "client", "(aud) route: the role must match exactly (Alice is not alice)");
  }
  { // other_side
    const a = await askAs(STAFF, { audience: "admin" }, hit([], { other_side: ["estimate", "ghost", "invoice", "contract"] }));
    ok(a.r.data.found === false && a.r.data.other_side.join() === "estimate,invoice", "(aud) route: other_side keeps only real other side ids, at most 2");
    ok(a.inserts.length === 1 && a.r.data.logged === true, "(aud) route: a staff miss with other_side ids is still not found and is logged");
    const b = await askAs(STAFF, { audience: "admin" }, hit([], { other_side: ["admin-invoice"] }));
    ok(b.r.data.other_side.length === 0, "(aud) route: other_side cannot name an id from the requested side");
    const c = await askAs(STAFF, { audience: "admin" }, hit(["admin-invoice"], { other_side: ["estimate"] }));
    ok(c.r.data.found === true && c.r.data.other_side.length === 0, "(aud) route: other_side is dropped when a guide on the requested side fits");
    const d = await askAs(STAFF, { audience: "client" }, hit([], { other_side: ["admin-invoice", "admin-users", "estimate"] }));
    ok(d.r.data.other_side.join() === "admin-invoice,admin-users", "(aud) route: a staff client search can point at admin guides only");
    const txt = sysOf(d.calls);
    ok(txt.indexOf("OTHER SIDE GUIDES") !== -1 && txt.split("OTHER SIDE GUIDES")[1].indexOf("id=admin-invoice") !== -1 && txt.split("OTHER SIDE GUIDES")[1].indexOf("Step by step") === -1 && txt.split("OTHER SIDE GUIDES")[1].indexOf("keywords") === -1, "(aud) route: staff get the other side list with id, titles and summary only");
    const e = await askAs(STAFF, { audience: "admin" }, hit([], { other_side: "estimate" }));
    ok(e.r.data.other_side.length === 0, "(aud) route: other_side that is not a list is ignored");
  }
  { // the insert and the response shape
    const a = await askAs(STAFF, { audience: "client" }, hit([]));
    const ins = a.inserts[0];
    ok(/INSERT INTO help_gaps/i.test(ins.sql) && /audience/.test(ins.sql) && (ins.sql.match(/\?/g) || []).length === ins.args.length, "(aud) route: the insert names audience and stays parameterized");
    ok(ins.args[ins.args.length - 1] === "client", "(aud) route: the audience actually used is bound as the last value");
    const b = await askAs(STAFF, { audience: "admin" }, hit([]));
    ok(b.inserts[0].args[b.inserts[0].args.length - 1] === "admin", "(aud) route: an admin miss stores admin");
    const keys = Object.keys(b.r.data).sort().join();
    ok(keys === "audience,best,found,guide_ids,logged,other_side,reply", "(aud) route: the response is {found, guide_ids, best, reply, logged, audience, other_side}");
    const m = mkWorker({ user: STAFF, fetchImpl: hit([]) }); const e = mkEnv({ failInsert: true });
    const r = await m.w.handlePostHelpAsk(askReq({ question: "sem a coluna nova", audience: "admin" }), e.env);
    ok(r.status === 200 && r.data.logged === false && r.data.audience === "admin", "(aud) route: if the column is missing the insert fails and the route still returns 200 with logged false");
    const c = await askAs(STAFF, { audience: "admin", question: "x".repeat(5) }, hit(["admin-invoice"]));
    ok(c.errors.every((x) => x.indexOf("xxxxx") === -1), "(aud) route: nothing logs the question");
  }
  { // separate libraries: one side empty
    const onlyClient = { version: 1, guides: FIXTURE.guides.filter((g) => !g.audience), pages: {} };
    const m = mkWorker({ user: STAFF, guides: onlyClient, fetchImpl: hit(["estimate"]) }); const e = mkEnv();
    const r = await m.w.handlePostHelpAsk(askReq({ question: "como emito uma fatura?", audience: "admin" }), e.env);
    ok(r.status === 200 && r.data.found === false && r.data.audience === "admin" && m.calls.length === 0 && e.inserts.length === 1, "(aud) route: an empty admin side does not call the model and logs the gap as admin");
  }
  ok(workerSrc.indexOf("function helpGuideAudience(") !== -1 && /supportStaffAuthed\(user\)/.test(workerSrc.slice(workerSrc.indexOf("async function handlePostHelpAsk("), workerSrc.indexOf("async function handlePostHelpAsk(") + 3500)), "(aud) route: the side is decided with supportStaffAuthed(user) inside handlePostHelpAsk");
  ok(!/body\.role|body\.is_staff|body\.staff/.test(workerSrc.slice(workerSrc.indexOf("async function handlePostHelpAsk("), workerSrc.indexOf("async function handlePostHelpAsk(") + 3500)), "(aud) route: the body never carries a role");
  ok(existsSync(new URL("migrations/help_gaps_audience.sql", root)) && /ALTER TABLE help_gaps ADD COLUMN audience TEXT NOT NULL DEFAULT ''/.test(read("migrations/help_gaps_audience.sql")), "(aud) migration: help_gaps_audience.sql adds the audience column");

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

  // ------------------------------------------------------------ (d2) the play card and the player, in a fake page
  function mkNode(tag, rec) {
    const n = { tag, nodeType: 1, children: [], attrs: {}, listeners: {}, style: {}, parentNode: null, className: "", _text: "", hidden: false, calls: [] };
    n.classList = {
      add(c) { if (!n.className.split(" ").includes(c)) { n.className = (n.className + " " + c).trim(); } },
      remove(c) { n.className = n.className.split(" ").filter((x) => x && x !== c).join(" "); },
      contains(c) { return n.className.split(" ").includes(c); }
    };
    Object.defineProperty(n, "firstChild", { get() { return n.children[0] || null; } });
    Object.defineProperty(n, "lastChild", { get() { return n.children[n.children.length - 1] || null; } });
    Object.defineProperty(n, "textContent", {
      get() { return n._text + n.children.map((c) => c.textContent).join(""); },
      set(v) { n._text = String(v); n.children.forEach((c) => { c.parentNode = null; }); n.children = []; }
    });
    n.setAttribute = (k, v) => { n.attrs[k] = String(v); };
    n.getAttribute = (k) => (n.attrs[k] === undefined ? null : n.attrs[k]);
    n.removeAttribute = (k) => { delete n.attrs[k]; };
    n.hasAttribute = (k) => n.attrs[k] !== undefined;
    n.appendChild = (c) => { if (c.parentNode) { c.parentNode.removeChild(c); } c.parentNode = n; n.children.push(c); return c; };
    n.insertBefore = (c, ref) => { if (c.parentNode) { c.parentNode.removeChild(c); } c.parentNode = n; const i = ref ? n.children.indexOf(ref) : -1; if (i < 0) { n.children.push(c); } else { n.children.splice(i, 0, c); } return c; };
    n.replaceChild = (c, old) => { const i = n.children.indexOf(old); if (i < 0) { return old; } if (c.parentNode) { c.parentNode.removeChild(c); } n.children[i] = c; c.parentNode = n; old.parentNode = null; return old; };
    n.removeChild = (c) => { const i = n.children.indexOf(c); if (i >= 0) { n.children.splice(i, 1); c.parentNode = null; } return c; };
    n.contains = (c) => { for (let x = c; x; x = x.parentNode) { if (x === n) { return true; } } return false; };
    n.addEventListener = (t, fn) => { (n.listeners[t] = n.listeners[t] || []).push(fn); };
    n.fire = (t, ev) => { (n.listeners[t] || []).slice().forEach((fn) => fn(Object.assign({ target: n, preventDefault() {}, stopPropagation() {} }, ev || {}))); };
    n.closest = () => null;
    n.focus = () => {};
    n.querySelector = () => null;
    n.querySelectorAll = () => [];
    n.pause = () => { n.calls.push("pause"); };
    n.load = () => { n.calls.push("load"); };
    n.play = () => { n.calls.push("play"); return Promise.resolve(); };
    return n;
  }
  function walk(node, out) { out = out || []; out.push(node); node.children.forEach((c) => { if (c.nodeType === 1) { walk(c, out); } }); return out; }
  function textOf(n) { return n.textContent; }

  async function learnPage(startLang, opts) {
    opts = opts || {};
    const asks = [];
    const state = { en: startLang === "en" };
    const body = mkNode("body"), head = mkNode("head");
    const host = mkNode("div");
    const docL = {};
    const doc = {
      readyState: "complete", body, head, activeElement: null,
      addEventListener(t, fn) { (docL[t] = docL[t] || []).push(fn); }, removeEventListener() {},
      createElement: (tag) => mkNode(tag),
      createTextNode: (s) => ({ nodeType: 3, textContent: String(s), parentNode: null }),
      getElementById() { return null; },
      querySelector(sel) { return sel === "#appHeader .header-right" ? host : null; },
      querySelectorAll() { return []; }
    };
    body.classList = { contains() { return false; }, add() {}, remove() {} };
    const win = {
      APEX_HELP: { enabled: true, base: "https://apex.resonateai.online/" }, HelpCore: core,
      isEn() { return state.en; },
      addEventListener() {}, removeEventListener() {},
      location: { pathname: opts.path || "/gmestimates.html", search: "", origin: "https://apex.resonateai.online" },
      setTimeout() { return 1; }, clearTimeout() {},
      getToken() { return Promise.resolve("tok"); },
      fetch(url, init) {
        if (/\/api\/help\/ask$/.test(url)) { asks.push(JSON.parse(init.body)); return Promise.resolve({ ok: true, json: () => Promise.resolve(opts.askResp || { found: false, guide_ids: [], best: null, reply: "", logged: true, audience: "x", other_side: [] }) }); }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(clone(opts.guides || FIXTURE)) });
      },
      matchMedia() { return { matches: true }; }
    };
    win.window = win; win.document = doc;
    const ctx = vm.createContext({ window: win, document: doc, console, setTimeout: win.setTimeout, clearTimeout: win.clearTimeout, fetch: win.fetch, Promise, JSON, Date, Math, Object, Array, String, Number, RegExp, encodeURIComponent, decodeURIComponent, URL, sessionStorage: { getItem(k) { return k === "apex_role" ? (opts.role || null) : null; } } });
    vm.runInContext(widgetSrc, ctx);
    const tick = async () => { for (let i = 0; i < 8; i++) { await new Promise((r) => setImmediate(r)); } };
    const page = {
      body, state, tick, asks,
      all: () => walk(body),
      cards: () => page.all().filter((n) => n.className.split(" ").includes("aph-vcard")),
      videos: () => page.all().filter((n) => n.tag === "video"),
      byText: (tag, txt) => page.all().filter((n) => n.tag === tag && textOf(n).indexOf(txt) !== -1),
      docFire(t) { (docL[t] || []).forEach((fn) => fn({})); },
      async openSheet() { host.children[0].fire("click"); await tick(); },
      async openGuide(title) { page.byText("button", title)[0].fire("click"); await tick(); },
      async setLang(l) { state.en = l === "en"; page.docFire("apex:langchange"); await tick(); },
      closeSheet() { page.byText("button", "").filter((b) => b.getAttribute("aria-label") === (state.en ? "Close" : "Fechar"))[0].fire("click"); },
      sideBtn: () => page.all().filter((n) => n.tag === "button" && /^(Ver guias do cliente|Voltar aos guias do administrador|See client guides|Back to admin guides)$/.test(textOf(n))),
      libHref: () => { const a = page.all().filter((n) => n.tag === "a"); return a.length ? a[0].href : ""; },
      allText: () => walk(body).map((n) => n._text).join(" | "),
      async ask(q) { const input = page.all().filter((n) => n.tag === "input")[0]; input.value = q; page.all().filter((n) => n.tag === "form")[0].fire("submit"); await tick(); }
    };
    await tick();
    return page;
  }
  const attrOrProp = (n, k) => (n.getAttribute(k) !== null ? n.getAttribute(k) : (n[k] === undefined ? null : n[k]));

  { const p = await learnPage("pt");
    await p.openSheet();
    // (f) the list tag
    const tags = (title) => p.byText("button", title)[0].children.filter((c) => c.className.indexOf("aph-vtag") !== -1);
    ok(tags("Enviar um recibo").length === 1 && textOf(tags("Enviar um recibo")[0]) === "Vídeo", "(f) pt list: a guide with a pt video shows the tag Vídeo");
    ok(tags("Enviar um contrato").length === 1, "(f) pt list: the plain string shape shows the tag too");
    ok(tags("Receber uma fatura").length === 0, "(f) pt list: a guide with video null shows no tag");

    await p.openGuide("Enviar um recibo");
    ok(p.cards().length === 1 && p.videos().length === 0, "(d) opening a guide with a video in the language shows one play card and no video element");
    const card = p.cards()[0];
    ok(card.tag === "button" && (card.type === "button" || card.attrs.type === "button"), "(d) the play card is a real button");
    ok(textOf(card).indexOf("Assistir ao vídeo") !== -1, "(d) the play card says Assistir ao vídeo");
    ok(p.all().some((n) => textOf(n) === "Ou siga os passos abaixo."), "(d) the line Ou siga os passos abaixo. sits under the card");
    ok(p.all().some((n) => n.className.indexOf("aph-step") !== -1), "(d) the steps are on the page with the card");
    const posterImg = p.all().filter((n) => n.tag === "img" && n.className.indexOf("aph-vposter") !== -1);
    ok(posterImg.length === 1 && attrOrProp(posterImg[0], "src") === "https://example.com/receipt-pt.jpg", "(d) the card shows the poster picture");

    card.fire("click");
    await p.tick();
    ok(p.cards().length === 0 && p.videos().length === 1, "(d) activating the card replaces it with exactly one video element");
    const v = p.videos()[0];
    ok(v.hasAttribute("playsinline") && v.hasAttribute("controls"), "(d) the video has playsinline and controls");
    ok(v.getAttribute("preload") === "none", "(d) the video has preload none");
    ok(attrOrProp(v, "src") === "https://example.com/receipt-pt.mp4" && attrOrProp(v, "poster") === "https://example.com/receipt-pt.jpg", "(d) the video has the right src and poster");
    ok(!v.hasAttribute("autoplay") && v.calls.indexOf("play") !== -1, "(d) play is started by the tap, not by an autoplay attribute");
    ok(p.all().some((n) => n.className.indexOf("aph-step") !== -1), "(d) the steps stay on the page under the player");

    // language switch to one with no video
    await p.setLang("en");
    ok(p.videos().length === 0 && p.cards().length === 0, "(d) switching to a language with no video removes the card and the player");
    ok(v.getAttribute("src") === null && v.calls.indexOf("pause") !== -1 && v.calls.indexOf("load") !== -1, "(d) the player is stopped on a language switch (paused, src removed, load called)");
    // and back to one with a video: a fresh card, not a player
    await p.setLang("pt");
    ok(p.cards().length === 1 && p.videos().length === 0, "(d) switching back to a language with a video shows a fresh card");

    // Back to the list stops it
    p.cards()[0].fire("click"); await p.tick();
    const v2 = p.videos()[0];
    ok(!!v2, "(d) a second tap makes a new player");
    p.byText("button", "Voltar")[0].fire("click"); await p.tick();
    ok(p.videos().length === 0 && v2.getAttribute("src") === null && v2.calls.indexOf("pause") !== -1, "(d) Back to the list stops and removes the player");

    // opening another guide stops it
    await p.openGuide("Enviar um recibo");
    p.cards()[0].fire("click"); await p.tick();
    const v3 = p.videos()[0];
    p.byText("button", "Voltar")[0].fire("click"); await p.tick();
    await p.openGuide("Enviar um contrato");
    ok(v3.getAttribute("src") === null && p.videos().length === 0 && p.cards().length === 1, "(d) opening another guide stops the old player and shows the new card");

    // the load error state
    p.cards()[0].fire("click"); await p.tick();
    const v4 = p.videos()[0];
    ok(attrOrProp(v4, "src") === "https://example.com/contract-pt.mp4" && !attrOrProp(v4, "poster"), "(d) the plain string shape plays with no poster");
    v4.fire("error");
    ok(p.videos().length === 0 && p.all().some((n) => textOf(n) === "Não foi possível carregar o vídeo agora. Siga os passos abaixo."), "(d) a video error shows the message in place of the player");
    ok(v4.getAttribute("src") === null && p.all().some((n) => n.className.indexOf("aph-step") !== -1), "(d) after an error the player is stopped and the steps stay");

    // closing the sheet stops it
    p.byText("button", "Voltar")[0].fire("click"); await p.tick();
    await p.openGuide("Enviar um recibo");
    p.cards()[0].fire("click"); await p.tick();
    const v5 = p.videos()[0];
    p.byText("button", "").filter((b) => b.getAttribute("aria-label") === "Fechar")[0].fire("click");
    ok(p.videos().length === 0 && v5.getAttribute("src") === null && v5.calls.indexOf("pause") !== -1, "(d) closing the sheet removes the player and clears its src");
  }
  { const p = await learnPage("en");
    await p.openSheet();
    const tags = (title) => p.byText("button", title)[0].children.filter((c) => c.className.indexOf("aph-vtag") !== -1);
    ok(tags("Send a receipt").length === 0 && tags("Send a contract").length === 0 && tags("Collect an invoice").length === 0, "(f) en list: no tag for guides whose English video is null or missing");
    ok(tags("Send an estimate").length === 1 && textOf(tags("Send an estimate")[0]) === "Video", "(f) en list: the guide with an English video shows the tag Video");
    await p.openGuide("Send a receipt");
    ok(p.cards().length === 0 && p.videos().length === 0, "(d) in English the receipt guide has no play card");
  }
  { const p = await learnPage("en");
    await p.openSheet();
    await p.openGuide("Send an estimate");
    ok(p.cards().length === 1 && textOf(p.cards()[0]).indexOf("Watch the video") !== -1 && p.all().some((n) => textOf(n) === "Or follow the steps below."), "(d) in English the card and the line are in English");
  }

  // ------------------------------------------------------------ (aud) the sheet and the two sides
  { // staff on an admin screen
    const p = await learnPage("pt", { role: "alice", path: "/dashboard.html" });
    await p.openSheet();
    ok(p.sideBtn().length === 1 && p.sideBtn()[0].tag === "button", "(aud) sheet: staff see exactly one side button, and it is a real button");
    ok(textOf(p.sideBtn()[0]) === "Ver guias do cliente", "(aud) sheet: on the admin side the button reads Ver guias do cliente");
    ok((p.sideBtn()[0].type === "button" || p.sideBtn()[0].attrs.type === "button"), "(aud) sheet: the side button is type button");
    const bodyNode = p.all().filter((n) => n.className.split(" ").includes("aphelp-body"))[0];
    ok(bodyNode.children[0] && walk(bodyNode.children[0]).indexOf(p.sideBtn()[0]) !== -1 && bodyNode.children.findIndex((c) => c.tag === "div" && walk(c).some((n) => n.tag === "form")) > 0, "(aud) sheet: the button sits above the search box");
    ok(p.byText("button", "Emitir a fatura de um cliente").length === 1 && p.byText("button", "Receber uma fatura").length === 0, "(aud) sheet: the overview of this screen lists only admin guides");
    const tagOf = (title) => p.byText("button", title)[0].children.filter((c) => c.className.indexOf("aph-stag") !== -1).map(textOf);
    ok(tagOf("Emitir a fatura de um cliente").join() === "Lado administrador", "(aud) sheet: staff see the tag Lado administrador on a guide");
    ok(/audience=admin/.test(p.libHref()), "(aud) sheet: the full library link carries audience=admin");
    p.sideBtn()[0].fire("click"); await p.tick();
    ok(textOf(p.sideBtn()[0]) === "Voltar aos guias do administrador", "(aud) sheet: on the client side the button reads Voltar aos guias do administrador");
    ok(p.byText("button", "Receber uma fatura").length === 1 && p.byText("button", "Emitir a fatura de um cliente").length === 0, "(aud) sheet: pressing it flips the guide list to the client side");
    ok(p.byText("button", "Receber uma fatura")[0].children.some((c) => textOf(c) === "Lado cliente"), "(aud) sheet: staff see the tag Lado cliente on a client guide");
    ok(/audience=client/.test(p.libHref()), "(aud) sheet: the full library link now carries audience=client");
    p.closeSheet();
    await p.openSheet();
    ok(textOf(p.sideBtn()[0]) === "Ver guias do cliente" && p.byText("button", "Emitir a fatura de um cliente").length === 1, "(aud) sheet: open, press, close, open again is back to the page default (admin)");
    await p.ask("como emito uma fatura?");
    ok(p.asks.length === 1 && p.asks[0].audience === "admin", "(aud) sheet: the search sends the current side (admin)");
    p.sideBtn()[0].fire("click"); await p.tick();
    await p.ask("como recebo uma fatura?");
    ok(p.asks[1].audience === "client", "(aud) sheet: after the flip the search sends client");
  }
  { // staff in English
    const p = await learnPage("en", { role: "rafa", path: "/dashboard.html" });
    await p.openSheet();
    ok(textOf(p.sideBtn()[0]) === "See client guides", "(aud) sheet: English label on the admin side is See client guides");
    ok(p.byText("button", "Issue a customer invoice")[0].children.some((c) => textOf(c) === "Admin side"), "(aud) sheet: English tag Admin side");
    p.sideBtn()[0].fire("click"); await p.tick();
    ok(textOf(p.sideBtn()[0]) === "Back to admin guides", "(aud) sheet: English label on the client side is Back to admin guides");
    ok(p.byText("button", "Collect an invoice")[0].children.some((c) => textOf(c) === "Client side"), "(aud) sheet: English tag Client side");
  }
  { // staff previewing the portal
    const p = await learnPage("pt", { role: "developer", path: "/portal.html" });
    await p.openSheet();
    ok(textOf(p.sideBtn()[0]) === "Voltar aos guias do administrador" && /audience=client/.test(p.libHref()), "(aud) sheet: staff on portal.html start on the client side");
    p.sideBtn()[0].fire("click"); await p.tick();
    ok(textOf(p.sideBtn()[0]) === "Ver guias do cliente" && /audience=admin/.test(p.libHref()), "(aud) sheet: from the portal, staff can flip to the admin side");
  }
  { // a client: no button, no tag, no word about sides
    const p = await learnPage("pt", { path: "/dashboard.html" });
    await p.openSheet();
    ok(p.sideBtn().length === 0, "(aud) sheet: a client sees no side button");
    ok(p.byText("button", "Receber uma fatura").length === 1 && p.byText("button", "Emitir a fatura de um cliente").length === 0, "(aud) sheet: a client sees only client guides, even on a screen that lists an admin guide");
    ok(!/Lado|lado|administrador|Admin|equipe/.test(p.allText()), "(aud) sheet: a client sees no word about sides in the sheet" + (/Lado|lado|administrador|Admin|equipe/.test(p.allText()) ? " :: " + p.allText() : ""));
    await p.openGuide("Receber uma fatura");
    ok(!/Lado|lado|administrador|Admin/.test(p.allText()), "(aud) sheet: a client sees no tag in a guide");
    ok(/audience=client/.test((function () { p.byText("button", "Voltar")[0].fire("click"); return p.libHref(); })()), "(aud) sheet: a client library link carries audience=client");
    await p.ask("como faco?");
    ok(p.asks[0].audience === "client", "(aud) sheet: a client search sends client");
  }
  { // a client whose role is something other than staff, trying a staff-looking value
    const p = await learnPage("pt", { role: "owner", path: "/dashboard.html" });
    await p.openSheet();
    ok(p.sideBtn().length === 0, "(aud) sheet: a portal owner role does not get the button");
    const q = await learnPage("pt", { role: "Alice", path: "/dashboard.html" });
    await q.openSheet();
    ok(q.sideBtn().length === 0, "(aud) sheet: a role that is not exactly a staff role does not get the button");
  }
  { // search results: a miss that has a guide on the other side
    const resp = { found: false, guide_ids: [], best: null, reply: "", logged: true, audience: "admin", other_side: ["estimate"] };
    const p = await learnPage("pt", { role: "alice", path: "/dashboard.html", askResp: resp });
    await p.openSheet();
    await p.ask("como envio um orcamento?");
    ok(p.allText().indexOf("Ainda não temos um guia deste lado.") !== -1 && p.allText().indexOf("Ainda não temos um guia para isso") === -1, "(aud) sheet: a staff miss with an other side guide says there is no guide for this side");
    ok(p.byText("button", "Ver o guia do cliente").length === 1 && p.allText().indexOf("Enviar um orçamento") !== -1, "(aud) sheet: it offers a card with Ver o guia do cliente");
    p.byText("button", "Ver o guia do cliente")[0].fire("click"); await p.tick();
    ok(p.allText().indexOf("Toque em Salvar e enviar") !== -1 || p.allText().indexOf("Salvar e enviar") !== -1, "(aud) sheet: that button opens the client guide");
    p.byText("button", "Voltar")[0].fire("click"); await p.tick();
    ok(textOf(p.sideBtn()[0]) === "Voltar aos guias do administrador", "(aud) sheet: and it flipped the side to client");
    const r2 = { found: false, guide_ids: [], best: null, reply: "", logged: true, audience: "client", other_side: ["admin-invoice"] };
    const q = await learnPage("pt", { role: "alice", path: "/portal.html", askResp: r2 });
    await q.openSheet();
    await q.ask("como emito uma fatura?");
    ok(q.byText("button", "Ver o guia do administrador").length === 1, "(aud) sheet: from the client side the button is Ver o guia do administrador");
    const r3 = { found: false, guide_ids: [], best: null, reply: "", logged: true, audience: "admin", other_side: [] };
    const z = await learnPage("pt", { role: "alice", path: "/dashboard.html", askResp: r3 });
    await z.openSheet();
    await z.ask("como faco um foguete?");
    ok(z.allText().indexOf("Ainda não temos um guia para isso. Sua pergunta foi anotada.") !== -1, "(aud) sheet: with no other side id the old message stays exactly, with the noted part when logged");
    const r4 = { found: false, guide_ids: [], best: null, reply: "", logged: false, audience: "admin", other_side: [] };
    const y = await learnPage("en", { role: "alice", path: "/dashboard.html", askResp: r4 });
    await y.openSheet();
    await y.ask("how do I build a rocket?");
    ok(y.allText().indexOf("We do not have a guide for that yet.") !== -1 && y.allText().indexOf("noted") === -1, "(aud) sheet: English miss message, no noted part when logged is false");
    // a client is never shown another side card, even if the answer carried one
    const c = await learnPage("pt", { path: "/dashboard.html", askResp: { found: false, guide_ids: [], best: null, reply: "", logged: true, audience: "client", other_side: ["admin-invoice"] } });
    await c.openSheet();
    await c.ask("como emito uma fatura?");
    ok(c.allText().indexOf("Emitir a fatura") === -1 && c.byText("button", "Ver o guia").length === 0 && c.allText().indexOf("Ainda não temos um guia para isso.") !== -1, "(aud) sheet: a client never gets an other side card");
    // a found answer shows an id only if it belongs to the side asked
    const f = await learnPage("pt", { path: "/dashboard.html", askResp: { found: true, guide_ids: ["admin-invoice", "invoice"], best: null, reply: "Veja.", logged: false, audience: "client", other_side: [] } });
    await f.openSheet();
    await f.ask("fatura");
    ok(f.allText().indexOf("Emitir a fatura") === -1 && f.allText().indexOf("Receber uma fatura") !== -1, "(aud) sheet: for a client an admin id in an answer is not shown");
  }
  { // empty sides
    const onlyClient = clone(FIXTURE); onlyClient.guides = onlyClient.guides.filter((g) => !g.audience);
    const onlyAdmin = clone(FIXTURE); onlyAdmin.guides = onlyAdmin.guides.filter((g) => g.audience === "admin");
    const p = await learnPage("pt", { role: "alice", path: "/dashboard.html", guides: onlyClient });
    await p.openSheet();
    ok(p.allText().indexOf("Os guias deste lado estão sendo preparados.") !== -1, "(aud) sheet: staff on an empty side see Os guias deste lado estão sendo preparados.");
    const e = await learnPage("en", { role: "alice", path: "/dashboard.html", guides: onlyClient });
    await e.openSheet();
    ok(e.allText().indexOf("The guides for this side are being prepared.") !== -1, "(aud) sheet: English empty side message for staff");
    const c = await learnPage("pt", { path: "/dashboard.html", guides: onlyAdmin });
    await c.openSheet();
    ok(c.allText().indexOf("Os guias estão sendo preparados.") !== -1 && !/lado|Lado/.test(c.allText()), "(aud) sheet: a client on an empty side sees Os guias estão sendo preparados. with no word about sides");
    const ce = await learnPage("en", { guides: onlyAdmin, path: "/dashboard.html" });
    await ce.openSheet();
    ok(ce.allText().indexOf("The guides are being prepared.") !== -1 && !/side/i.test(ce.allText()), "(aud) sheet: English empty message for a client has no word about sides");
    const a = await learnPage("pt", { path: "/adminonly.html" });
    await a.openSheet();
    ok(a.allText().indexOf("Só equipe") === -1 && a.allText().indexOf("Tela só da equipe") === -1, "(aud) sheet: an overview whose guides are all on the other side is simply absent");
  }
  { // a guide the label resolver finds on the other side is not opened for a client
    const p = await learnPage("pt", { path: "/dashboard.html" });
    await p.openSheet();
    ok(p.all().filter((n) => n.tag === "button" && n.attrs["aria-label"] === "Fechar").length === 1, "(aud) sheet: sanity, one close button");
  }

  // ------------------------------------------------------------ (aud) help.html, run in a fake page
  const helpSrc = read("help.html");
  const helpScript = helpSrc.slice(helpSrc.lastIndexOf("<script>") + 8, helpSrc.lastIndexOf("</script>"));
  const helpIds = Array.from(helpSrc.matchAll(/\sid="([A-Za-z0-9_-]+)"/g)).map((m) => m[1]);
  async function helpPage(opts) {
    opts = opts || {};
    const asks = [];
    const byIdMap = {};
    helpIds.forEach((id) => { byIdMap[id] = mkNode("div"); });
    const body = mkNode("body");
    body.className = "lang-pt";
    const docL = {};
    const doc = {
      body, documentElement: { lang: "pt" }, title: "",
      getElementById(id) { return byIdMap[id] || null; },
      createElement: (tag) => mkNode(tag), createTextNode: (x) => ({ nodeType: 3, textContent: String(x), parentNode: null }),
      addEventListener(t, fn) { (docL[t] = docL[t] || []).push(fn); }, querySelector() { return null; }, querySelectorAll() { return []; }
    };
    const fbUser = opts.firebaseUser ? { getIdToken: () => Promise.resolve("fbtok") } : null;
    const win = {
      APEX_HELP: { enabled: true, base: "https://apex.resonateai.online/" }, HelpCore: core,
      location: { hostname: "localhost", search: "?fixture=1" + (opts.query || ""), origin: "http://localhost:8000", pathname: "/help.html" },
      scrollTo() {}, history: { replaceState() {} },
      firebase: fbUser ? { apps: [], initializeApp() {}, auth: () => ({ onAuthStateChanged(cb) { Promise.resolve().then(() => cb(fbUser)); } }) } : undefined
    };
    win.window = win; win.document = doc;
    const ctx = vm.createContext({ window: win, document: doc, console, setTimeout, clearTimeout, Promise, JSON, Date, Math, Object, Array, String, Number, RegExp, encodeURIComponent, decodeURIComponent, URL, URLSearchParams,
      fetch(url, init) {
        if (/\/api\/help\/ask$/.test(url)) { asks.push(JSON.parse(init.body)); return Promise.resolve({ ok: true, json: () => Promise.resolve(opts.askResp || { found: false, guide_ids: [], best: null, reply: "", logged: true, audience: "x", other_side: [] }) }); }
        return Promise.resolve({ ok: true, json: () => Promise.resolve(clone(opts.guides || FIXTURE)) });
      },
      localStorage: { getItem(k) { return k === "apex_help_lang" ? (opts.lang || null) : (k === "apex_client_token" && !opts.firebaseUser ? "tok" : null); }, setItem() {} },
      sessionStorage: { getItem(k) { return k === "apex_role" ? (opts.role || null) : null; } },
      navigator: {} });
    vm.runInContext(helpScript, ctx);
    const tick = async () => { for (let i = 0; i < 10; i++) { await new Promise((r) => setImmediate(r)); } };
    await tick();
    const pg = {
      asks, tick, node: (id) => byIdMap[id],
      all: () => walk(body).concat(Object.keys(byIdMap).map((k) => byIdMap[k]).reduce((acc, n) => acc.concat(walk(n)), [])),
      list: () => byIdMap.guideList,
      cardTitles: () => byIdMap.guideList.children.filter((c) => c.tag === "button").map((c) => c.children[0].textContent),
      sideBtn: () => walk(byIdMap.sideRow).filter((n) => n.tag === "button"),
      text: () => pg.all().map((n) => n._text).join(" | "),
      listText: () => walk(byIdMap.libraryView || byIdMap.guideList).map((n) => n._text).join(" | "),
      async ask(q) { byIdMap.askInput.value = q; byIdMap.askForm.fire("submit"); await tick(); }
    };
    return pg;
  }
  { // staff
    const p = await helpPage({ role: "alice" });
    ok(p.cardTitles().join() === "Emitir a fatura de um cliente,Adicionar um usuário da equipe", "(aud) help.html: staff start on admin and the list shows only admin guides");
    ok(p.sideBtn().length === 1 && textOf(p.sideBtn()[0]) === "Ver guias do cliente" && p.sideBtn()[0].tag === "button", "(aud) help.html: staff see the one button, Ver guias do cliente");
    ok(p.list().children[0].children.some((c) => textOf(c) === "Lado administrador"), "(aud) help.html: staff see the tag Lado administrador on each guide");
    p.sideBtn()[0].fire("click"); await p.tick();
    ok(p.cardTitles().join() === "Enviar um orçamento,Receber uma fatura,Enviar um recibo,Enviar um contrato", "(aud) help.html: pressing the button shows the client guides");
    ok(textOf(p.sideBtn()[0]) === "Voltar aos guias do administrador" && p.list().children[0].children.some((c) => textOf(c) === "Lado cliente"), "(aud) help.html: the label and the tag follow the side");
    await p.ask("fatura");
    ok(p.asks[0].audience === "client", "(aud) help.html: after the flip the search sends client");
    p.sideBtn()[0].fire("click"); await p.tick();
    ok(textOf(p.sideBtn()[0]) === "Ver guias do cliente" && p.node("answer").children.length === 0, "(aud) help.html: flipping back clears the old answer");
    await p.ask("fatura");
    ok(p.asks[1].audience === "admin", "(aud) help.html: and the search sends admin again");
  }
  { const p = await helpPage({ role: "alice", query: "&audience=client" });
    ok(p.cardTitles().length === 4 && textOf(p.sideBtn()[0]) === "Voltar aos guias do administrador", "(aud) help.html: audience=client sets a staff person's starting side");
    const q = await helpPage({ role: "alice", query: "&audience=staff" });
    ok(q.cardTitles().length === 2, "(aud) help.html: an audience value that is not admin or client is ignored");
    const r = await helpPage({ role: "rafa", lang: "en" });
    ok(textOf(r.sideBtn()[0]) === "See client guides" && r.list().children[0].children.some((c) => textOf(c) === "Admin side"), "(aud) help.html: English button and tag");
    r.sideBtn()[0].fire("click"); await r.tick();
    ok(textOf(r.sideBtn()[0]) === "Back to admin guides", "(aud) help.html: English label on the client side"); }
  { // a client
    const p = await helpPage({ query: "&audience=admin" });
    ok(p.cardTitles().length === 4 && p.cardTitles().indexOf("Emitir a fatura de um cliente") === -1, "(aud) help.html: a client who types audience=admin still sees only client guides");
    ok(p.sideBtn().length === 0, "(aud) help.html: a client sees no button");
    ok(!/Lado|lado|administrador|Admin/.test(p.text()), "(aud) help.html: a client sees no tag and no word about sides" + (/Lado|lado|administrador|Admin/.test(p.text()) ? " :: " + p.text() : ""));
    await p.ask("fatura");
    ok(p.asks[0].audience === "client", "(aud) help.html: a client search sends client");
    const o = await helpPage({ role: "owner", query: "&audience=admin" });
    ok(o.cardTitles().length === 4 && o.sideBtn().length === 0, "(aud) help.html: a portal owner role is not staff");
    const c = await helpPage({ query: "&guide=admin-invoice&audience=admin" });
    ok(!c.node("guideView").hidden && c.node("guideView").textContent.indexOf("Emitir a fatura de um cliente") !== -1 && !/Lado|lado/.test(c.node("guideView").textContent), "(aud) help.html: a guide link opens the guide, with no tag, for a client");
    ok(c.cardTitles().length === 4, "(aud) help.html: and the client list stays client only"); }
  { // deep links for staff
    const a = await helpPage({ role: "alice", query: "&guide=invoice" });
    ok(!a.node("guideView").hidden && a.cardTitles().length === 4, "(aud) help.html: a deep link to a client guide sets a staff person's side to client");
    const b = await helpPage({ role: "alice", query: "&guide=admin-users&audience=client" });
    ok(!b.node("guideView").hidden && b.cardTitles().length === 2, "(aud) help.html: the guide's own side wins over the audience parameter");
    const c = await helpPage({ role: "alice", query: "&guide=ghost" });
    ok(c.cardTitles().length === 2 && c.node("guideView").textContent.indexOf("Não encontramos esse guia.") !== -1, "(aud) help.html: an unknown guide id says so and keeps the default side"); }
  { // a staff person known only through the sign in
    const p = await helpPage({ firebaseUser: true });
    ok(p.sideBtn().length === 1 && p.cardTitles().length === 2, "(aud) help.html: a person signed in with the staff sign in (no tab role) is shown the button"); }
  { // search answers
    const resp = { found: false, guide_ids: [], best: null, reply: "", logged: true, audience: "admin", other_side: ["estimate"] };
    const p = await helpPage({ role: "alice", askResp: resp });
    await p.ask("orcamento");
    ok(p.text().indexOf("Ainda não temos um guia deste lado.") !== -1 && p.node("answer").children.some((c) => walk(c).some((n) => n.tag === "button" && textOf(n) === "Ver o guia do cliente")), "(aud) help.html: a staff miss with an other side guide offers Ver o guia do cliente");
    walk(p.node("answer")).filter((n) => n.tag === "button" && textOf(n) === "Ver o guia do cliente")[0].fire("click"); await p.tick();
    ok(!p.node("guideView").hidden && p.node("guideView").textContent.indexOf("Enviar um orçamento") !== -1, "(aud) help.html: that button opens the other side guide");
    walk(p.node("guideView")).filter((n) => n.tag === "button" && textOf(n).indexOf("Voltar") !== -1)[0].fire("click"); await p.tick();
    ok(textOf(p.sideBtn()[0]) === "Voltar aos guias do administrador", "(aud) help.html: and it flipped the side to client");
    const c = await helpPage({ askResp: { found: false, guide_ids: [], best: null, reply: "", logged: true, audience: "client", other_side: ["admin-invoice"] } });
    await c.ask("fatura");
    ok(c.text().indexOf("Emitir a fatura") === -1 && c.text().indexOf("Ainda não temos um guia para isso. Sua pergunta foi anotada.") !== -1, "(aud) help.html: a client never gets an other side card");
    const f = await helpPage({ askResp: { found: true, guide_ids: ["admin-invoice", "invoice"], best: null, reply: "Veja.", logged: false, audience: "client", other_side: [] } });
    await f.ask("fatura");
    ok(walk(f.node("answer")).map((n) => n._text).join(" ").indexOf("Emitir a fatura") === -1 && walk(f.node("answer")).map((n) => n._text).join(" ").indexOf("Receber uma fatura") !== -1, "(aud) help.html: an admin id in an answer is not shown to a client"); }
  { // empty sides
    const onlyClient = clone(FIXTURE); onlyClient.guides = onlyClient.guides.filter((g) => !g.audience);
    const onlyAdmin = clone(FIXTURE); onlyAdmin.guides = onlyAdmin.guides.filter((g) => g.audience === "admin");
    const a = await helpPage({ role: "alice", guides: onlyClient });
    ok(a.list().textContent.indexOf("Os guias deste lado estão sendo preparados.") !== -1, "(aud) help.html: staff on an empty side see Os guias deste lado estão sendo preparados.");
    const b = await helpPage({ role: "alice", guides: onlyClient, lang: "en" });
    ok(b.list().textContent.indexOf("The guides for this side are being prepared.") !== -1, "(aud) help.html: English empty side message for staff");
    const c = await helpPage({ guides: onlyAdmin });
    ok(c.list().textContent === "Os guias estão sendo preparados.", "(aud) help.html: a client on an empty side sees Os guias estão sendo preparados. and nothing about sides");
    const d = await helpPage({ guides: onlyAdmin, lang: "en" });
    ok(d.list().textContent === "The guides are being prepared.", "(aud) help.html: English empty message for a client"); }

  // ------------------------------------------------------------ (e) video source guards
  [["help-widget.js", widgetSrc], ["help.html", read("help.html")]].forEach(function (pair) {
    const name = pair[0], src = pair[1];
    ok(!/\.innerHTML\s*\+?=[^;\n]*(src|poster|video)/i.test(src), "(e) " + name + " never builds markup from a video or poster value");
    ok(!/(^|[^A-Za-z0-9_.$])(window\.)?(alert|confirm|prompt)\(/m.test(src), "(e) " + name + " has no alert(, confirm( or prompt(");
    ok(!/autoplay/i.test(src), "(e) " + name + " has no autoplay attribute");
    ok(src.indexOf("videoFor") !== -1, "(e) " + name + " decides what to show with HelpCore.videoFor");
    ok(src.indexOf("playsinline") !== -1 && src.indexOf('"none"') !== -1, "(e) " + name + " sets playsinline and preload none");
  });

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
  ok(/HELP_BASE\s*=\s*"https:\/\/apex\.resonateai\.online\/"/.test(cfgSrc), "(flag) help-config.js uses the live origin as HELP_BASE");
  function runCfg(storage) { const win = { localStorage: storage }; vm.runInNewContext(cfgSrc, { window: win }); return win.APEX_HELP; }
  ok(runCfg({ getItem: function () { return null; } }).enabled === false, "(flag) with no preview setting the feature is OFF for everyone");
  ok(runCfg({ getItem: function () { return "yes"; } }).enabled === false && runCfg({ getItem: function () { return "ON"; } }).enabled === false, "(flag) only the exact value on turns the preview on");
  ok(runCfg({ getItem: function (k) { return k === "aprenda-preview" ? "on" : null; } }).enabled === true, "(flag) aprenda-preview = on turns it on in that browser only");
  ok(runCfg({ getItem: function () { throw new Error("blocked"); } }).enabled === false, "(flag) storage that throws leaves the feature OFF");
  ok(runCfg(undefined).enabled === false, "(flag) no storage at all leaves the feature OFF");
  ok(read("help-config.js") === read("ios/App/App/public/help-config.js"), "(flag) the iPhone copy of help-config.js is identical");
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
