// Behavioral check for re-activating a client from the status pencil on
// client.html.
//
//   node scripts/test-client-reactivation.mjs
//
// The worker refuses status='active' on a row with no package: a client is
// active because there is a contract behind them, and the contract IS the
// package. That rule is correct and stays. What was broken is that the status
// dropdown offered "Ativo / Active" anyway and fired a PATCH that could only
// come back "Selecione um pacote para ativar" — an error whose one remedy is a
// separate package pencil it never names, and which renders with no lozenge
// beside it precisely when there is no package, so there is barely anything to
// find. Any client whose package was never set could not be activated at all.
//
// The fix mirrors the 'lead' path, which has the same shape of problem
// (status='lead' needs a lead_stage) and already solves it by collecting the
// companion field first. So:
//
//   1. Picking 'active' with no package must NOT fire the doomed PATCH. It
//      routes into the package picker instead, and the header keeps showing
//      the status the record still HAS until something is actually written.
//   2. When the package and its terms save, the parked activation goes through
//      on their heels — one uninterrupted flow, not a second errand.
//   3. Backing out at any point (clicking away from the picker, choosing '—',
//      dismissing the terms modal) writes nothing at all.
//   4. Picking 'active' on a client that ALREADY has a package still saves
//      instantly, exactly as before — this must not add a modal to the common
//      case.
//
// Plus the server rule the whole flow rests on, checked against the real
// handler: no package means no activation, and a package present (whether it
// was already on the row or arrives in the same request) means it goes through.
import { readFileSync } from "fs";

const page   = readFileSync(new URL("../client.html", import.meta.url), "utf8");
const worker = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");

function slice(src, a, b) {
  const i = src.indexOf(a), j = src.indexOf(b, i);
  if (i < 0 || j < 0) { throw new Error("marker not found: " + a); }
  return src.slice(i, j);
}

let fails = 0;
// Named `check`, not `t`: the page's own translation helper IS t(pt, en), and
// the eval'd code calls it. One `t` in scope has to be that one.
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { fails++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label +
    (ok ? "" : "\n        expected " + JSON.stringify(expected) + " got " + JSON.stringify(actual)));
};

// ── Minimal DOM ───────────────────────────────────────────────────────────
// Only what the functions under test touch. Elements record their children so
// the test can read what the header actually SHOWS — the lozenge's data-status
// is the thing the user sees, and the whole point of rule 1 is that it must not
// read 'active' before anything is written.
let doc, patches, opened, alerts;

function makeEl(tag, id) {
  const el = {
    tagName: tag, id: id || "", className: "", textContent: "", value: "",
    hidden: true, disabled: false, selected: false, checked: false,
    style: {}, attrs: {}, children: [], _html: "",
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; if (v === "") { this.children = []; } },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    appendChild(c) { this.children.push(c); return c; },
    focus() { doc.activeElement = this; },
    blur() { doc.activeElement = null; }
  };
  return el;
}

// hasPkgWrap models the package pencil, which the badges render for
// alice/rafa/developer only. A role without it has no way to set a package.
function resetDom(opts) {
  opts = opts || {};
  patches = [];
  opened = [];
  alerts = [];
  const statusWrap = makeEl("span", "statusWrap");
  const pkgWrap    = makeEl("span", "pkgWrap");
  const ptModal    = makeEl("div", "modalPaymentTerms");
  const byId = { statusWrap, modalPaymentTerms: ptModal };
  if (opts.hasPkgWrap !== false) { byId.pkgWrap = pkgWrap; }

  // Unknown ids are auto-vivified: handleSavePaymentTerms reads a dozen form
  // fields whose values are irrelevant here, and listing them all would bury
  // the ones that matter. Ids deliberately ABSENT (pkgWrap for a role without
  // the pencil) are held in `missing` so they keep returning null.
  const missing = opts.hasPkgWrap === false ? { pkgWrap: true } : {};
  doc = {
    activeElement: null,
    getElementById: (id) => {
      if (missing[id]) { return null; }
      if (!byId[id]) { byId[id] = makeEl("div", id); }
      return byId[id];
    },
    createElement: (tag) => makeEl(tag)
  };
  globalThis.document = doc;
  globalThis.els = byId;

  globalThis.CLIENT_ID = "c-tigers";
  globalThis.clientData = {
    id: "c-tigers",
    name: "TIGERS",
    status: opts.status || "paused",
    package: opts.package || null
  };

  // Records every write the page attempts. A test that expects "nothing was
  // written" reads this, so a doomed PATCH cannot hide.
  globalThis.apiFetch = (url, init) => {
    const body = (init && init.body) || {};
    patches.push({ url, method: (init && init.method) || "GET", body });
    const resp = globalThis.__nextResponse || { updated: true };
    globalThis.__nextResponse = null;
    return Promise.resolve({ json: () => Promise.resolve(resp) });
  };

  // openPackageEdit and openLeadStagePrompt live far above the code under test
  // and pull the live package list over the network; spies here keep this test
  // about the activation hand-off rather than about the picker's own rendering.
  // pendingActivation lives in the eval'd page scope and survives a DOM
  // reset, so each block starts from nothing parked.
  if (globalThis.__setPending) { globalThis.__setPending(null); }
  globalThis.ptState = { termsOnly: false };

  globalThis.openPackageEdit = (current) => { opened.push({ picker: "package", current }); };
  globalThis.openLeadStagePrompt = () => { opened.push({ picker: "leadStage" }); };
  globalThis.alert = (m) => { alerts.push(m); };
}

globalThis.t = (pt, en) => pt;
globalThis.leadStagePrompt = null;
globalThis.savedTerms = null;
globalThis.renderPaymentPlan = () => {};

// ── The real page code ────────────────────────────────────────────────────
resetDom();
eval(slice(page, "    function renderStatusLozenge(statusWrap, statusValue) {",
                 "    // State for the lead-stage modal:") +
  "\n; globalThis.renderStatusLozenge = renderStatusLozenge;");
eval(slice(page, "    // ── Activation held back for a package",
                 "    // ── Render: Overview card") +
  "\n; Object.assign(globalThis, { clientHasPackage, beginActivationWithPackage, " +
  "cancelPendingActivation, abandonActivationFromPicker, finishPendingActivation, " +
  "openStatusEdit });" +
  "\n; globalThis.__getPending = () => pendingActivation;" +
  "\n; globalThis.__setPending = (v) => { pendingActivation = v; };");
eval(slice(page, "    function closePaymentTermsModal() {", "    function handleSavePaymentTerms() {") +
  "\n; globalThis.closePaymentTermsModal = closePaymentTermsModal;");
// The real terms-save chain, so the hand-off is exercised end to end rather
// than by calling finishPendingActivation() directly.
eval(slice(page, "    function handleSavePaymentTerms() {",
                 "    // 'paused' is canonical, NOT 'inactive'.") +
  "\n; globalThis.handleSavePaymentTerms = handleSavePaymentTerms;");

// STATUS_OPTIONS is declared below openStatusEdit in the file and is only read
// at call time, so the real list is lifted out rather than re-typed here — a
// status added there must reach this test too.
eval(slice(page, "    var STATUS_OPTIONS = [", "    // Stage ladder for the lead correction path") +
  "\n; globalThis.STATUS_OPTIONS = STATUS_OPTIONS;");

// What the header is currently showing, which is not always what was picked.
const shownStatus = () => {
  const loz = els.statusWrap.children.filter((c) => c.className === "status-client-lozenge")[0];
  return loz ? loz.getAttribute("data-status") : null;
};
// The <select> openStatusEdit put on the page.
const statusSelect = () => els.statusWrap.children.filter((c) => c.tagName === "select")[0];

const pick = (value) => {
  const sel = statusSelect();
  sel.value = value;
  sel.onchange();
  return sel;
};

// ── Rule 1: 'active' with no package does not fire a doomed PATCH ─────────
{
  resetDom({ status: "paused", package: null });
  openStatusEdit("paused");
  check("the status dropdown offers Ativo/Active",
    STATUS_OPTIONS.map((o) => o.value).indexOf("active") >= 0, true);

  pick("active");
  check("no package: picking 'active' writes nothing", patches, []);
  check("no package: picking 'active' opens the package picker",
    opened, [{ picker: "package", current: "" }]);
  check("no package: the header still shows the status the record HAS",
    shownStatus(), "paused");
  check("no package: clientData is untouched", clientData.status, "paused");
  check("no package: an activation is parked", !!__getPending(), true);
  check("no package: the parked activation remembers what to restore",
    __getPending().previousStatus, "paused");
}

// ── Rule 4: 'active' WITH a package still saves instantly ────────────────
{
  resetDom({ status: "paused", package: "Apex Growth" });
  openStatusEdit("paused");
  pick("active");
  check("with a package: 'active' saves straight away",
    patches.map((p) => [p.method, p.body.status]), [["PATCH", "active"]]);
  check("with a package: no package picker is opened", opened, []);
  check("with a package: nothing is parked", __getPending(), null);
}
{
  // Whitespace is not a package. A row holding "  " must take the same route as
  // a NULL one, because the worker's own check would reject it too.
  resetDom({ status: "paused", package: "   " });
  openStatusEdit("paused");
  pick("active");
  check("a whitespace-only package counts as no package", patches, []);
  check("a whitespace-only package routes to the picker", opened.length, 1);
}

// ── The other statuses are untouched ─────────────────────────────────────
{
  resetDom({ status: "active", package: null });
  openStatusEdit("active");
  pick("paused");
  check("'paused' still saves instantly even with no package",
    patches.map((p) => p.body.status), ["paused"]);
}
{
  resetDom({ status: "active", package: null });
  openStatusEdit("active");
  pick("closed");
  check("'closed' still saves instantly even with no package",
    patches.map((p) => p.body.status), ["closed"]);
}
{
  resetDom({ status: "active", package: null });
  openStatusEdit("active");
  pick("lead");
  check("'lead' still goes to its own stage prompt, not the package picker",
    opened, [{ picker: "leadStage" }]);
  check("'lead' still writes nothing up front", patches, []);
}

// ── Rule 2: the package landing finishes the activation ──────────────────
{
  resetDom({ status: "paused", package: null });
  openStatusEdit("paused");
  pick("active");
  // The package + terms have just saved; this is the step handleSavePaymentTerms
  // runs while its modal is still open.
  clientData.package = "Apex Growth";
  await finishPendingActivation();
  check("the parked activation fires once the package is on the row",
    patches.map((p) => [p.method, p.body.status]), [["PATCH", "active"]]);
  check("the activation PATCH goes to this client",
    patches[0].url, "/api/clients/c-tigers");
  check("the header flips to active only now", shownStatus(), "active");
  check("clientData follows the write", clientData.status, "active");
  check("nothing stays parked afterwards", __getPending(), null);
}
{
  // A plain package edit — no activation waiting — must not smuggle a status
  // write into the terms save.
  resetDom({ status: "paused", package: "Apex Growth" });
  await finishPendingActivation();
  check("no parked activation means no status write", patches, []);
}
{
  // The status write can still fail (a race, a permission change). It must
  // reject so handleSavePaymentTerms reports it in the modal the user is
  // looking at, and must not claim the client is active.
  resetDom({ status: "paused", package: null });
  openStatusEdit("paused");
  pick("active");
  clientData.package = "Apex Growth";
  globalThis.__nextResponse = { error: "Selecione um pacote para ativar / Select a package to activate" };
  let rejected = null;
  await finishPendingActivation().catch((e) => { rejected = e.message; });
  check("a failed activation rejects rather than resolving quietly",
    rejected, "Selecione um pacote para ativar / Select a package to activate");
  check("a failed activation leaves the header on the old status", shownStatus(), "paused");
  check("a failed activation does not claim the client is active", clientData.status, "paused");
}

// ── Rule 3: every way of backing out writes nothing ──────────────────────
{
  resetDom({ status: "paused", package: null });
  openStatusEdit("paused");
  pick("active");
  // Clicked away from the package picker without choosing.
  abandonActivationFromPicker();
  check("walking away from the picker drops the activation", __getPending(), null);
  check("walking away from the picker writes nothing", patches, []);
  await finishPendingActivation();
  check("a dropped activation cannot fire later", patches, []);
}
{
  resetDom({ status: "paused", package: null });
  openStatusEdit("paused");
  pick("active");
  // Choosing a real package also blurs that select, on its way INTO the terms
  // modal. That blur must not be read as walking away, or the activation the
  // modal is about to finish would already be gone.
  __getPending().packageChosen = true;
  abandonActivationFromPicker();
  check("blurring on the way into the terms modal keeps the activation",
    !!__getPending(), true);
  clientData.package = "Apex Growth";
  await finishPendingActivation();
  check("and it still completes", patches.map((p) => p.body.status), ["active"]);
}
{
  resetDom({ status: "paused", package: null });
  openStatusEdit("paused");
  pick("active");
  __getPending().packageChosen = true;
  // Dismissing the terms modal abandons the package, so the activation goes
  // with it — even though a package had been chosen.
  closePaymentTermsModal();
  check("dismissing the terms modal drops the activation", __getPending(), null);
  check("dismissing the terms modal writes nothing", patches, []);
}
{
  // closePaymentTermsModal also runs on the SAVE path, after the activation has
  // already fired and cleared. It must not undo anything there.
  resetDom({ status: "paused", package: null });
  openStatusEdit("paused");
  pick("active");
  clientData.package = "Apex Growth";
  await finishPendingActivation();
  closePaymentTermsModal();
  check("closing after a successful save leaves the client active", clientData.status, "active");
  check("closing after a successful save does not re-write", patches.length, 1);
}

// ── The real terms-save chain completes the activation ───────────────────
// Same path the user takes: pick 'active' with no package -> pick a package ->
// fill the plan -> Save. Nothing is written until that Save.
const flush = () => new Promise((r) => setTimeout(r, 0));

{
  resetDom({ status: "paused", package: null });
  openStatusEdit("paused");
  pick("active");
  check("end to end: choosing 'active' has written nothing yet", patches, []);

  // What openPackageEdit's onchange does before handing off to the modal.
  __getPending().packageChosen = true;
  globalThis.ptState = {
    package: { id: "pkg-growth", short_name: "Apex Growth" },
    splitMode: "even", customRows: [], isNewClient: false, termsOnly: false
  };
  handleSavePaymentTerms();
  await flush(); await flush(); await flush();

  const urls = patches.map((p) => p.method + " " + p.url);
  check("end to end: terms are saved first",
    urls[0], "PUT /api/clients/c-tigers/package-terms");
  check("end to end: then the package lands on the client",
    [patches[1].method, patches[1].body.package], ["PATCH", "Apex Growth"]);
  check("end to end: then the parked activation goes through",
    [patches[2].method, patches[2].body.status], ["PATCH", "active"]);
  check("end to end: exactly three writes, no doomed extra", patches.length, 3);
  check("end to end: the client ends up active", clientData.status, "active");
  check("end to end: the header shows it", shownStatus(), "active");
  check("end to end: the modal closes", els.modalPaymentTerms.hidden, true);
  check("end to end: nothing stays parked", __getPending(), null);
}
{
  // An ordinary package change with no activation waiting must still write
  // exactly two things. This is the common case and must not gain a status
  // write it never had.
  resetDom({ status: "active", package: "Apex Start" });
  globalThis.ptState = {
    package: { id: "pkg-growth", short_name: "Apex Growth" },
    splitMode: "even", customRows: [], isNewClient: false, termsOnly: false
  };
  handleSavePaymentTerms();
  await flush(); await flush(); await flush();
  check("an ordinary package change writes terms + package only",
    patches.map((p) => p.method + " " + p.url),
    ["PUT /api/clients/c-tigers/package-terms", "PATCH /api/clients/c-tigers"]);
  check("an ordinary package change writes no status",
    patches.filter((p) => "status" in p.body).length, 0);
}
{
  // A terms-only edit (the Payment Plan card) never touches clients.package, so
  // it can't be what an activation was waiting on. Even with stale intent
  // parked, it must not promote the client.
  resetDom({ status: "paused", package: "Apex Growth" });
  __setPending({ previousStatus: "paused", packageChosen: true });
  globalThis.ptState = {
    package: { id: "pkg-growth", short_name: "Apex Growth" },
    splitMode: "even", customRows: [], isNewClient: false, termsOnly: true
  };
  handleSavePaymentTerms();
  await flush(); await flush(); await flush();
  check("a terms-only edit writes terms and nothing else",
    patches.map((p) => p.method + " " + p.url),
    ["PUT /api/clients/c-tigers/package-terms"]);
  check("a terms-only edit does not promote the client", clientData.status, "paused");
  check("a terms-only edit drops stale activation intent", __getPending(), null);
}

// ── A role with no package pencil is told, not dead-ended ────────────────
{
  resetDom({ status: "paused", package: null, hasPkgWrap: false });
  openStatusEdit("paused");
  pick("active");
  check("no package control: nothing is written", patches, []);
  check("no package control: nothing is parked", __getPending(), null);
  check("no package control: the header stays on the real status", shownStatus(), "paused");
  check("no package control: the reason is stated", alerts.length, 1);
  check("no package control: the message names the package as the blocker",
    /pacote/i.test(alerts[0]), true);
}

// ── The server rule the whole flow rests on ──────────────────────────────
// Checked against the real handler, not assumed: this is what makes step 1
// necessary in the first place, and it must keep holding.
let statements = [];
const makeEnv = (row) => {
  statements = [];
  const state = Object.assign({}, row);
  return {
    DB: {
      prepare(sql) {
        statements.push({ sql, binds: [] });
        const stmt = {
          bind: (...b) => {
            statements[statements.length - 1] = { sql, binds: b };
            // The package write has to be visible to the status check that
            // follows it in the same request — that ordering is the reason a
            // promotion can carry its own package.
            if (/UPDATE clients SET package = \?/.test(sql)) { state.package = b[0]; }
            return stmt;
          },
          first: async () => state,
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
globalThis.authenticate = async () => ({ role: "alice", display_name: "Alice" });

eval(slice(worker, "var LEAD_STAGES = [", "\nvar CLIENT_STATUS = [") +
  "\n; globalThis.LEAD_STAGES = LEAD_STAGES;");
eval(slice(worker, "var CLIENT_STATUS = [", "// ---------------------------------------------------------------------------\n// Route: GET /api/role") +
  "\n; Object.assign(globalThis, { CLIENT_STATUS, CLIENT_SOURCE_TYPES });");
globalThis.APEX_TIMEZONE = "America/New_York";
eval(slice(worker, "function localDateStrForTZ() {", "\n// Minimal Google Calendar API call") +
  "\n; globalThis.localDateStrForTZ = localDateStrForTZ;");
eval(slice(worker, "async function handlePatchClient(id, request, env) {",
                   "// ---------------------------------------------------------------------------\n// Route: GET /api/clients/:id/digital-presence") +
  "\n; globalThis.handlePatchClient = handlePatchClient;");

const req = (body) => ({ json: async () => body });
const statusWrites = () =>
  statements.filter((s) => /UPDATE clients SET status = 'active'/.test(s.sql));

{
  const env = makeEnv({ id: "c-tigers", status: "paused", package: null });
  const r = await handlePatchClient("c-tigers", req({ status: "active" }), env);
  check("server: activating with no package is refused", r.ok, false);
  check("server: the refusal is the message the screenshot shows",
    r.error, "Selecione um pacote para ativar / Select a package to activate");
  check("server: a refused activation writes no status", statusWrites().length, 0);
}
{
  const env = makeEnv({ id: "c-tigers", status: "paused", package: "Apex Growth" });
  const r = await handlePatchClient("c-tigers", req({ status: "active" }), env);
  check("server: activating with a package on the row goes through", r.ok, true);
  check("server: and writes the status once", statusWrites().length, 1);
}
{
  // The path the page now takes is the two-step one (package saved first, then
  // the status), but a promotion carrying its own package in one request must
  // keep working — the package block runs before the status check reads back.
  const env = makeEnv({ id: "c-tigers", status: "paused", package: null });
  const r = await handlePatchClient("c-tigers",
    req({ package: "Apex Growth", status: "active" }), env);
  check("server: a promotion carrying its own package still goes through", r.ok, true);
  check("server: and writes the status once", statusWrites().length, 1);
}
{
  // A whitespace package must not satisfy the server either, or the page's
  // stricter check and the server's would disagree about the same row.
  const env = makeEnv({ id: "c-tigers", status: "paused", package: "   " });
  const r = await handlePatchClient("c-tigers", req({ status: "active" }), env);
  check("server: whitespace is treated as a real package (page is the stricter of the two)",
    r.ok, true);
}

console.log(fails === 0 ? "\nAll checks passed." : "\n" + fails + " check(s) FAILED.");
process.exit(fails === 0 ? 0 : 1);
