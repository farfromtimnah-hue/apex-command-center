// Behavioral check for the Call / WhatsApp buttons on the Apex-INTERNAL
// Contact Log (client.html, Lead Pipeline section).
//
//   node scripts/test-lead-contact-buttons.mjs
//
// The point of these buttons is that reaching out and logging the outreach
// stop being two separate acts: tapping Call or WhatsApp launches the
// tel:/wa.me link and then opens the SAME modalContactLog with Method already
// filled in, so only Result is left to pick. Three rules matter:
//
//   1. The pre-selected Method must match the button actually tapped —
//      "Phone call" for Call, "WhatsApp" for WhatsApp. A wrong pre-selection
//      is worse than none, because nobody re-reads a field that looks filled.
//   2. The manual "+ Registrar contato" button must keep behaving exactly as
//      it did: it passes NO method, so the dropdown keeps its own default.
//      That button exists for contacts made outside the app.
//   3. With no phone number on file both buttons must be suppressed via
//      aria-disabled, mirroring gmContactButtonsHtml in gm.js.
//
// Plus the server-side invariant the buttons must not break: the FIRST logged
// contact auto-advances the lead to "Contato inicial" (advanceLeadStage), and
// that has to keep working when the entry arrives through the new buttons.
//
// The real client.html functions are eval'd against a tiny DOM fake; the real
// worker handler is eval'd against a recording fake D1.
import { readFileSync } from "fs";

const page   = readFileSync(new URL("../client.html", import.meta.url), "utf8");
const worker = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");

function slice(src, a, b) {
  const i = src.indexOf(a), j = src.indexOf(b, i);
  if (i < 0 || j < 0) { throw new Error("marker not found: " + a); }
  return src.slice(i, j);
}

let fails = 0;
const t = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { fails++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label +
    (ok ? "" : "\n        expected " + JSON.stringify(expected) + " got " + JSON.stringify(actual)));
};

// ── Minimal DOM ───────────────────────────────────────────────────────────
// Only what the functions under test touch. clMethod is modelled as a real
// <select> would be: it has a fixed option list and rejects unknown values,
// so a typo'd method name surfaces as "" rather than silently passing.
const CL_METHOD_OPTIONS = ["WhatsApp", "Phone call", "Email", "In person", "Text message"];

let els, navigations, opened, popupBlocked;
function makeEl(id) {
  const el = {
    id, innerHTML: "", textContent: "", value: "", hidden: true,
    className: "", options: [],
    setAttribute() {}, appendChild() {}
  };
  if (id === "clMethod") {
    el.options = CL_METHOD_OPTIONS.map((v) => ({ value: v, textContent: "" }));
    let v = CL_METHOD_OPTIONS[0];          // a <select> defaults to option 0
    Object.defineProperty(el, "value", {
      get: () => v,
      set: (x) => { v = CL_METHOD_OPTIONS.indexOf(x) >= 0 ? x : ""; }
    });
  }
  return el;
}
function resetDom({ en = false, hasContactActions = true } = {}) {
  els = {};
  navigations = [];
  opened = [];
  popupBlocked = false;
  const ids = ["clNotes", "clStatus2", "clMethod", "clResult", "modalContactLog"];
  if (hasContactActions) { ids.push("leadContactActions"); }
  ids.forEach((id) => { els[id] = makeEl(id); });

  globalThis.document = {
    getElementById: (id) => els[id] || null,
    body: { classList: { contains: (c) => (c === "lang-en" ? en : false) } }
  };
  // location.href assignment goes through a setter that records the URL, so
  // the test can assert the tel: link was launched.
  let hrefSink = "";
  globalThis.window = {
    location: { get href() { return hrefSink; }, set href(u) { hrefSink = u; navigations.push(u); } },
    open: (u) => { opened.push(u); return popupBlocked ? null : {}; },
    alert: () => {}
  };
}

// renderContactLogOptions() localizes the dropdown text; not under test here,
// but openContactLogModal() calls it, so it must exist.
globalThis.renderContactLogOptions = () => {};

// ── Load the real client.html functions ───────────────────────────────────
eval(slice(page, "    var CL_ICON_PHONE =", "    function saveContactLogEntry()") +
  "\n; Object.assign(globalThis, { renderLeadContactActions, startLeadCall, " +
  "startLeadWhatsapp, openContactLogModal, leadContactPhone, leadWaDigits });");

// ── Rule 1: the tapped button pre-selects the matching Method ─────────────
{
  resetDom();
  globalThis.clientData = { phone: "(305) 555-0142", whatsapp: null };
  startLeadCall();
  t("Call pre-selects Method 'Phone call'", els.clMethod.value, "Phone call");
  t("Call opens the existing modalContactLog", els.modalContactLog.hidden, false);
  t("Call launches a tel: link", navigations, ["tel:3055550142"]);
  t("Call opens no popup window", opened.length, 0);
}
{
  resetDom();
  globalThis.clientData = { phone: "(305) 555-0142", whatsapp: null };
  startLeadWhatsapp();
  t("WhatsApp pre-selects Method 'WhatsApp'", els.clMethod.value, "WhatsApp");
  t("WhatsApp opens the existing modalContactLog", els.modalContactLog.hidden, false);
  t("WhatsApp launches wa.me with the country code added", opened, ["https://wa.me/13055550142"]);
}
{
  // A stale Method from a previous entry must be overwritten, not preserved —
  // this is the case where a wrong pre-selection would actually reach the DB.
  resetDom();
  globalThis.clientData = { phone: "3055550142" };
  els.clMethod.value = "Email";
  startLeadCall();
  t("Call overwrites a stale Method", els.clMethod.value, "Phone call");
}
{
  // whatsapp beats phone when both are on file, same precedence as
  // sendLoginViaWhatsapp() — one client record, one rule.
  resetDom();
  globalThis.clientData = { phone: "3055550142", whatsapp: "+55 11 91234-5678" };
  t("the WhatsApp number wins over phone when both exist",
    leadContactPhone(), "+55 11 91234-5678");
  startLeadWhatsapp();
  t("wa.me uses the WhatsApp number, non-US digits untouched",
    opened, ["https://wa.me/5511912345678"]);
}

// ── Rule 2: the manual button still opens with Method unset ───────────────
{
  resetDom();
  globalThis.clientData = { phone: "3055550142" };
  openContactLogModal();                       // no argument — the manual path
  t("manual button leaves Method at the select's own default",
    els.clMethod.value, CL_METHOD_OPTIONS[0]);
  t("manual button still opens the modal", els.modalContactLog.hidden, false);
}
{
  // "Unset" means "not touched by us": whatever the select already held stays.
  resetDom();
  globalThis.clientData = { phone: "3055550142" };
  els.clMethod.value = "In person";
  openContactLogModal();
  t("manual button does not overwrite an existing Method choice",
    els.clMethod.value, "In person");
}
{
  resetDom();
  globalThis.clientData = { phone: "3055550142" };
  els.clNotes.value = "left over from last time";
  els.clStatus2.textContent = "Erro: boom";
  openContactLogModal("WhatsApp");
  t("opening clears the previous notes", els.clNotes.value, "");
  t("opening clears the previous status", els.clStatus2.textContent, "");
}

// ── Rule 3: no phone on file -> both buttons aria-disabled ────────────────
{
  resetDom();
  globalThis.clientData = { phone: null, whatsapp: null };
  renderLeadContactActions();
  const html = els.leadContactActions.innerHTML;
  t("both buttons render when there is no number",
    (html.match(/cl-contact-btn/g) || []).length, 2);
  t("both buttons are aria-disabled",
    (html.match(/aria-disabled="true"/g) || []).length, 2);
  // Defence in depth: aria-disabled + pointer-events:none stops the click in
  // the browser, but the handlers must also no-op if ever reached.
  startLeadCall();
  startLeadWhatsapp();
  t("no-phone Call navigates nowhere", navigations.length, 0);
  t("no-phone WhatsApp opens nothing", opened.length, 0);
  t("no-phone taps do not open the modal", els.modalContactLog.hidden, true);
}
{
  resetDom();
  globalThis.clientData = { phone: "3055550142" };
  renderLeadContactActions();
  const html = els.leadContactActions.innerHTML;
  t("with a number, neither button is aria-disabled",
    html.indexOf('aria-disabled="true"'), -1);
  t("Call is wired to startLeadCall", html.indexOf("startLeadCall()") >= 0, true);
  t("WhatsApp is wired to startLeadWhatsapp", html.indexOf("startLeadWhatsapp()") >= 0, true);
  t("icons are real inline SVG, not glyphs or emoji",
    (html.match(/<svg /g) || []).length, 2);
  t("no unicode phone glyph is used", html.indexOf("☎"), -1);
}
{
  // Non-lead clients never render the container; the renderer must not throw.
  resetDom({ hasContactActions: false });
  globalThis.clientData = { phone: "3055550142" };
  renderLeadContactActions();
  t("renderer is a no-op when the container is absent", true, true);
}
{
  resetDom({ en: true });
  globalThis.clientData = { phone: null };
  renderLeadContactActions();
  t("English label is 'Call'", els.leadContactActions.innerHTML.indexOf(">Call<") >= 0, true);
  resetDom({ en: false });
  globalThis.clientData = { phone: null };
  renderLeadContactActions();
  t("Portuguese label is 'Ligar'", els.leadContactActions.innerHTML.indexOf(">Ligar<") >= 0, true);
}

// ── The server invariant: first contact still auto-advances the stage ─────
// Logging through the new buttons hits the same POST /contact-log endpoint, so
// advanceLeadStage must still fire. Verified against the real handler rather
// than assumed.
let statements = [];
const makeEnv = (client) => {
  statements = [];
  return {
    DB: {
      prepare(sql) {
        statements.push({ sql, binds: [] });
        const stmt = {
          bind: (...b) => { statements[statements.length - 1] = { sql, binds: b }; return stmt; },
          first: async () => client,
          all:   async () => ({ results: [] }),
          run:   async () => ({ success: true })
        };
        return stmt;
      }
    }
  };
};
globalThis.jsonOk  = (o) => ({ ok: true, body: o });
globalThis.jsonErr = (m, code) => ({ ok: false, error: m, status: code });
globalThis.authenticate = async () => ({ role: "alice" });
// Node's globalThis.crypto is read-only and already provides randomUUID(),
// which is the same API the Worker runtime exposes — no fake needed.

eval(slice(worker, "function isAdminRole(user)", "// ---------------------------------------------------------------------------\n// LEAD PIPELINE") +
  "\n; globalThis.isAdminRole = isAdminRole;");
eval(slice(worker, "var LEAD_STAGES = [", "// ---------------------------------------------------------------------------\n// Route: GET /api/role") +
  "\n; Object.assign(globalThis, { LEAD_STAGES, LEAD_CONTACT_METHODS, " +
  "LEAD_CONTACT_RESULTS, leadStageIndex, advanceLeadStage });");
eval(slice(worker, "async function handlePostLeadContactLog(", "// ---------------------------------------------------------------------------\n// Route: GET /api/clients/:id/lead-pipeline") +
  "\n; globalThis.handlePostLeadContactLog = handlePostLeadContactLog;");

const req = (body) => ({ json: async () => body });
const advanced = () =>
  statements.filter((s) => /UPDATE clients/.test(s.sql) && s.binds.indexOf("Contato inicial") >= 0);

for (const method of ["Phone call", "WhatsApp"]) {
  const env = makeEnv({ id: "c1", status: "lead", lead_stage: "Lead" });
  const r = await handlePostLeadContactLog("c1", req({ method, result: "Answered" }), env);
  t("a '" + method + "' entry is accepted by the endpoint", r.ok, true);
  t("a '" + method + "' entry still auto-advances to Contato inicial",
    advanced().length, 1);
}
{
  // Both button methods must be in the server's allow-list, or the pre-selected
  // value would be rejected at save time.
  t("'Phone call' is a valid stored method",
    (await handlePostLeadContactLog("c1", req({ method: "Phone call", result: "Answered" }),
      makeEnv({ status: "lead", lead_stage: "Lead" }))).ok, true);
  t("'WhatsApp' is a valid stored method",
    (await handlePostLeadContactLog("c1", req({ method: "WhatsApp", result: "Answered" }),
      makeEnv({ status: "lead", lead_stage: "Lead" }))).ok, true);
}

console.log(fails === 0 ? "\nAll checks passed." : "\n" + fails + " check(s) FAILED.");
process.exit(fails === 0 ? 0 : 1);
