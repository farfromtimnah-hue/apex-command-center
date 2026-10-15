// The invoice send logic moved out of finance-new.html into the shared file
// apex-invoice-send.js (2026-10-04). This proves the move changed nothing a
// client or a staff member can see: the SAME sample invoices are sent through
// the code as it was before the move and through the code as it is now, and
// everything each one did is compared, in order: the question asked, the
// window opened, every request (path and method), the WhatsApp address (which
// carries the message, character for character), the toast, the list reload.
//
//   node scripts/test-apex-invoice-send.mjs
//
// No network, nothing written. The "before" code is the four functions cut
// from finance-new.html at commit f0a9948 (the commit this work started from),
// kept in scripts/fixtures/finance-new-send-before.js; when that commit is in
// the local git history the fixture is checked against it too.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const BASE = "f0a9948";
const OLD_NAMES = ["invoiceLinkFor", "apxClientLinkForSend", "sendInvoiceWhatsApp", "markInvoiceSentOnly"];
let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) { fail++; } };

// Cut one top-level `function name(...) { ... }` out of a page's source.
// Braces inside strings and comments are skipped.
function cut(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start < 0) { throw new Error("function not found: " + name); }
  let i = src.indexOf("{", start), depth = 0;
  for (; i < src.length; i++) {
    const ch = src[i], two = src.substr(i, 2);
    if (two === "//") { i = src.indexOf("\n", i); continue; }
    if (two === "/*") { i = src.indexOf("*/", i) + 1; continue; }
    if (ch === '"' || ch === "'" || ch === "`") {
      for (i++; src[i] !== ch; i++) { if (src[i] === "\\") { i++; } }
      continue;
    }
    if (ch === "{") { depth++; }
    if (ch === "}") { depth--; if (depth === 0) { return src.slice(start, i + 1); } }
  }
  throw new Error("unbalanced braces in " + name);
}
const cutAll = (src, names) => names.map(n => cut(src, n)).join("\n\n") + "\n";

const page = readFileSync(new URL("finance-new.html", root), "utf8");
const shared = readFileSync(new URL("apex-invoice-send.js", root), "utf8");
const OLD = readFileSync(new URL("scripts/fixtures/finance-new-send-before.js", root), "utf8");
const NEW = shared + "\n" + cutAll(page, OLD_NAMES.concat(["apxSendDeps"]));
const fmtCents = cut(page, "fmtCents");

// The fixture really is the code from before the move.
try {
  const before = execFileSync("git", ["show", BASE + ":finance-new.html"], { cwd: root, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }).toString();
  ok(cutAll(before, OLD_NAMES) === OLD, "the 'before' fixture is exactly the four functions in finance-new.html at " + BASE);
} catch (e) {
  console.log("SKIP  commit " + BASE + " is not in this git history; the fixture could not be checked against it");
}

// The page no longer holds its own copy.
{
  const now = cutAll(page, OLD_NAMES);
  ok(!/wa\.me|split\("\{invoiceLink\}"\)|apex-invoice-template-DRAFT|mark-sent|client-link/.test(now), "finance-new.html's four functions no longer build the message, the link or the requests themselves");
  ok(/<script src="apex-invoice-send\.js\?v=\d+"><\/script>/.test(page), "finance-new.html loads apex-invoice-send.js with a ?v= marker");
  const ios = readFileSync(new URL("ios/App/App/public/finance-new.html", root), "utf8");
  ok(cutAll(ios, OLD_NAMES.concat(["apxSendDeps"])) === cutAll(page, OLD_NAMES.concat(["apxSendDeps"])) && /<script src="apex-invoice-send\.js\?v=\d+"><\/script>/.test(ios), "the iOS copy of finance-new.html carries the same edit");
  ok(!/\blet\s|\bconst\s|=>/.test(shared) && !/[^\x00-\x7F]/.test(shared), "apex-invoice-send.js: var and function() only, plain ASCII");
}


// A tiny page for the "old cached page, new script" case: no pageDialog and no
// deps.ask, so the script must draw its own card. Records what is on screen.
function fakeDocument(trace) {
  const listeners = {};
  const mk = (tag) => {
    const el = { tag, children: [], parentNode: null, style: {}, ls: {}, textContent: "", value: "", focused: false,
      setAttribute() {}, addEventListener(t, f) { (el.ls[t] = el.ls[t] || []).push(f); },
      appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
      removeChild(c) { el.children = el.children.filter(x => x !== c); c.parentNode = null; },
      focus() { el.focused = true; } };
    return el;
  };
  const body = mk("body");
  return { body, createElement: mk,
    addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
    removeEventListener(t, f) { listeners[t] = (listeners[t] || []).filter(x => x !== f); },
    key(k) { (listeners.keydown || []).slice().forEach(f => f({ key: k, preventDefault() {}, stopPropagation() {} })); },
    buttons() { const out = []; (function w(n) { if (n.tag === "button") { out.push(n); } n.children.forEach(w); })(body); return out; },
    click(el) { (el.ls.click || []).forEach(f => f({ target: el, stopPropagation() {} })); } };
}

// One run of one call in a fresh world. Returns everything that happened.
async function run(code, call, sc) {
  const trace = [];
  const win = {
    confirm: (text) => { trace.push(["confirm", text]); return sc.confirm !== false; },
    open: (url, target) => {
      trace.push(["open", url, target]);
      if (sc.popupBlocked) { return null; }
      const loc = {};
      Object.defineProperty(loc, "href", { set: (v) => { trace.push(["navigate", v]); } });
      return { location: loc, close: () => { trace.push(["close"]); } };
    }
  };
  const answer = (path) => {
    const which = /\/mark-sent$/.test(path) ? sc.markSent : /\/client-link$/.test(path) ? sc.clientLink : undefined;
    if (which === "reject") { return Promise.reject(new Error("Failed to fetch")); }
    if (which === "badjson") { return Promise.resolve({ json: () => Promise.reject(new Error("not json")) }); }
    return Promise.resolve({ json: () => Promise.resolve(which === undefined ? {} : which) });
  };
  const box = {
    window: win, Promise, Error, String, encodeURIComponent, console, Number,
    INVOICES: sc.invoices,
    MESSAGE_TEMPLATES: sc.templates === undefined ? { invoice_send: "Ola! Segue a fatura:\n{invoiceLink}\nObrigada." } : sc.templates,
    APX_SWITCHES: { client_invoice_link_enabled: sc.switchOn === true, club_pay_enabled: false, role: "alice" },
    // The in-page question (pageDialog on the real pages): answered at once,
    // inside the same call, the way a tap on the Yes / Keep button is. It is
    // traced as "confirm" so the old browser box and the card compare equal.
    pageDialog: sc.fallback ? undefined : (o) => { trace.push(["confirm", o.message]); if (sc.confirm !== false) { o.onYes(); } return true; },
    isEn: () => sc.en === true,
    toast: (msg) => { trace.push(["toast", msg]); },
    loadInvoices: () => { trace.push(["loadInvoices"]); },
    apiFetch: (path, opts) => { trace.push(["apiFetch", path, opts && opts.method, opts && opts.body]); return answer(path); },
    out: (v) => { trace.push(["result", v]); }
  };
  if (sc.fallback) { box.document = fakeDocument(trace); box.out2 = box.document; }
  vm.createContext(box);
  vm.runInContext(fmtCents + "\n" + code + "\n" + call, box);
  for (let i = 0; i < 20; i++) { await new Promise(r => setImmediate(r)); }
  return trace;
}
const messageOf = (trace) => {
  const nav = trace.filter(t => t[0] === "navigate" || (t[0] === "open" && t[1])).pop();
  return nav ? decodeURIComponent(nav[1].split("?text=")[1]) : null;
};

const SAMPLE = { id: "inv_7f3a", number: "INV-000042", amount_cents: 838200, client_name: "ALPHA BUILDERS LLC", client_whatsapp: "+1 (813) 555-0199", status: "draft" };
const CLIENT_LINK = "https://doc.resonateai.online/apex/inv-000042-alpha-builders-llc-a1b2c3d4";
const linkOk = { link: CLIENT_LINK, link_enabled: true, direct_url: "https://apex.resonateai.online/apex-invoice-view.html?t=" + "a".repeat(48) };

const SEND = [
  ["switch OFF, saved template, Portuguese", { }],
  ["switch OFF, saved template, English", { en: true }],
  ["switch OFF, no templates loaded (the built-in fallback text)", { templates: null }],
  ["switch OFF, templates loaded but no invoice_send key", { templates: { other: "x" } }],
  ["switch ON, the client's link comes back", { switchOn: true, clientLink: linkOk }],
  ["mark-sent answers an error", { markSent: { error: "Invoice is voided" } }],
  ["mark-sent answers an error, English", { markSent: { error: "Invoice is voided" }, en: true }],
  ["mark-sent fails on the network", { markSent: "reject" }],
  ["mark-sent answer is not JSON", { markSent: "badjson", switchOn: true, clientLink: linkOk }],
  ["the question is answered No", { confirm: false }],
  ["the popup is blocked", { popupBlocked: true }],
  ["the popup is blocked and mark-sent fails", { popupBlocked: true, markSent: "reject" }],
  ["a client with no WhatsApp number", { invoices: [Object.assign({}, SAMPLE, { client_whatsapp: null })] }],
  ["a client with no name", { invoices: [Object.assign({}, SAMPLE, { client_name: null })], en: true }],
  ["an id that needs encoding", { invoices: [Object.assign({}, SAMPLE, { id: "inv 7/3&a=b" })], id: "inv 7/3&a=b" }],
  ["a template with accents, an emoji, two links and symbols", { templates: { invoice_send: "Olá! 😊 Segue a fatura (100% & pronta):\n{invoiceLink}\n\nDe novo: {invoiceLink} #apex" }, switchOn: true, clientLink: linkOk }],
  ["a template with no link in it", { templates: { invoice_send: "Ola, sua fatura esta pronta." } }],
  ["an invoice id that is not in the list", { id: "nope" }],
  ["the same id twice in the list (the last one wins)", { invoices: [SAMPLE, Object.assign({}, SAMPLE, { client_whatsapp: "5511999990000", client_name: "SECOND" })] }]
];
const fill = (sc) => Object.assign({ invoices: [SAMPLE] }, sc);

let sampleShown = false;
for (const [name, raw] of SEND) {
  const sc = fill(raw), id = JSON.stringify(sc.id || SAMPLE.id);
  const a = await run(OLD, "sendInvoiceWhatsApp(" + id + ");", sc);
  const b = await run(NEW, "sendInvoiceWhatsApp(" + id + ");", sc);
  const same = JSON.stringify(a) === JSON.stringify(b);
  ok(same, "send: " + name + " (" + a.length + " steps, message " + (messageOf(a) === null ? "none" : messageOf(a).length + " characters") + ")");
  if (!same) { console.log("  before: " + JSON.stringify(a) + "\n  now:    " + JSON.stringify(b)); }
  if (!sampleShown && messageOf(a)) { sampleShown = true; console.log("      sample message, before: " + JSON.stringify(messageOf(a)) + "\n      sample message, now:    " + JSON.stringify(messageOf(b))); }
}

// THE CLIENT MUST NEVER RECEIVE THE STAFF LINK WHILE THE SWITCH IS ON.
// 2026-10-15: these four scenarios used to fall through to staffLink() and
// send anyway. Now: WhatsApp never opens, mark-draft is called, and the
// person is told in-page. No OLD/NEW comparison here -- the whole point is
// that behavior changed.
const REVERT = [
  ["the Worker says the link is not enabled", { switchOn: true, clientLink: { link: CLIENT_LINK, link_enabled: false } }],
  ["the link request answers an error", { switchOn: true, clientLink: { error: "Invoice is voided" } }],
  ["the link request fails", { switchOn: true, clientLink: "reject" }],
  ["the link answer is not JSON", { switchOn: true, clientLink: "badjson" }],
];
for (const [name, raw] of REVERT) {
  const sc = fill(raw);
  const t = await run(NEW, "sendInvoiceWhatsApp(" + JSON.stringify(SAMPLE.id) + ");", sc);
  const opened = t.some(x => x[0] === "open" && x[1] && x[1] !== "");
  const navigated = t.some(x => x[0] === "navigate");
  const closed = t.some(x => x[0] === "close");
  const draftCall = t.find(x => x[0] === "apiFetch" && /\/mark-draft$/.test(x[1]));
  const toasted = t.find(x => x[0] === "toast");
  ok(!navigated && !opened, "revert to draft (" + name + "): WhatsApp never opens with a message");
  ok(closed, "revert to draft (" + name + "): the blank WhatsApp window is closed");
  ok(!!draftCall && draftCall[2] === "POST" && draftCall[3] && draftCall[3].reason, "revert to draft (" + name + "): mark-draft is called with a reason");
  ok(!!toasted && toasted[1] === "Nao foi possivel criar o link do cliente. A fatura nao foi enviada. Tente de novo.",
    "revert to draft (" + name + "): the Portuguese in-page message, no browser pop-up");
  const en = await run(NEW, "sendInvoiceWhatsApp(" + JSON.stringify(SAMPLE.id) + ");", Object.assign({}, sc, { en: true }));
  const toastedEn = en.find(x => x[0] === "toast");
  ok(!!toastedEn && toastedEn[1] === "Could not create the client link. The invoice was not sent. Try again.",
    "revert to draft (" + name + "), English: the English in-page message");
}
{
  // Switch OFF: the old link (now fixed by the template redirect) still goes
  // out exactly as before -- nothing about this path changes when OFF.
  const sc = fill({});
  const t = await run(NEW, "sendInvoiceWhatsApp(" + JSON.stringify(SAMPLE.id) + ");", sc);
  ok(t.some(x => x[0] === "navigate") && !t.some(x => x[0] === "apiFetch" && /\/mark-draft$/.test(x[1])),
    "switch OFF: WhatsApp still opens and mark-draft is never called");
}

const MARK = [
  ["Portuguese", { }], ["English", { en: true }], ["answered No", { confirm: false }],
  ["mark-sent answers an error", { markSent: { error: "Invoice is voided" } }], ["mark-sent fails, English", { markSent: "reject", en: true }],
  ["mark-sent answer is not JSON", { markSent: "badjson" }], ["an id that is not in the list", { id: "nope" }], ["an empty list", { invoices: [], en: true }]
];
for (const [name, raw] of MARK) {
  const sc = fill(raw), id = JSON.stringify(sc.id || SAMPLE.id);
  const a = await run(OLD, "markInvoiceSentOnly(" + id + ");", sc);
  const b = await run(NEW, "markInvoiceSentOnly(" + id + ");", sc);
  const same = JSON.stringify(a) === JSON.stringify(b);
  ok(same, "mark sent: " + name + " (" + a.length + " steps)");
  if (!same) { console.log("  before: " + JSON.stringify(a) + "\n  now:    " + JSON.stringify(b)); }
}

const LINK = [["switch OFF", { }], ["switch ON, link", { switchOn: true, clientLink: linkOk }], ["switch ON, not enabled", { switchOn: true, clientLink: { link: CLIENT_LINK, link_enabled: false } }],
  ["switch ON, no link field", { switchOn: true, clientLink: { link_enabled: true } }], ["switch ON, request fails", { switchOn: true, clientLink: "reject" }]];
for (const [name, raw] of LINK) {
  const sc = fill(raw), call = "apxClientLinkForSend(" + JSON.stringify(SAMPLE.id) + ").then(out);";
  const a = await run(OLD, call, sc), b = await run(NEW, call, sc);
  ok(JSON.stringify(a) === JSON.stringify(b) && a.some(t => t[0] === "result"), "link choice: " + name + " -> " + JSON.stringify(a[a.length - 1][1]));
}
{
  const call = "out(invoiceLinkFor(INVOICES[0]));";
  const a = await run(OLD, call, fill({})), b = await run(NEW, call, fill({}));
  ok(JSON.stringify(a) === JSON.stringify(b), "the staff link is the same: " + a[0][1]);
}

// The review page's two variations on the same shared code.
const deps = "var D = apxSendDeps(); D.confirm = false; ";
for (const [name, raw] of [["switch OFF", { }], ["switch ON", { switchOn: true, clientLink: linkOk }], ["no WhatsApp number", { invoices: [Object.assign({}, SAMPLE, { client_whatsapp: "" })] }]]) {
  const sc = fill(raw);
  const real = await run(OLD, "sendInvoiceWhatsApp(" + JSON.stringify(SAMPLE.id) + ");", sc);
  const oneClick = await run(NEW, deps + "window.ApexInvoiceSend.sendWhatsApp(INVOICES[0], D);", sc);
  ok(JSON.stringify(real.filter(t => t[0] !== "confirm")) === JSON.stringify(oneClick) && !oneClick.some(t => t[0] === "confirm"),
    "review page send (" + name + "): the same steps as the Finance row, minus the question");
  const iMark = oneClick.findIndex(t => t[0] === "apiFetch" && /\/mark-sent$/.test(t[1])), iNav = oneClick.findIndex(t => t[0] === "navigate");
  ok(iMark >= 0 && iNav > iMark, "review page send (" + name + "): the invoice is asked to be marked sent before WhatsApp is given the message");
}
// The test send is gone: nothing in the shared file, on the review page or on
// the Finance page can open WhatsApp with the message and record nothing.
{
  const sendSrc = readFileSync(new URL("apex-invoice-send.js", root), "utf8");
  const viewSrc = readFileSync(new URL("apex-invoice-view.html", root), "utf8");
  const finSrc = readFileSync(new URL("finance-new.html", root), "utf8");
  const t = await run(NEW, "out([typeof window.ApexInvoiceSend.testSend, Object.keys(window.ApexInvoiceSend).sort().join(',')]);", fill({}));
  const got = (t.find(x => x[0] === "result") || [])[1] || [];
  ok(got[0] === "undefined" && got[1] === "FALLBACK_TEMPLATE,buildMessage,clientLinkForSend,markSentOnly,sendWhatsApp,staffLink,templateFor,waUrlFor",
    "the shared file has no testSend; it offers the real send, mark sent, and their helpers only");
  ok(!/testSend|test send|envio de teste/i.test(sendSrc) && !/testSend|reviewTest|btnReviewTest|Test send|Envio de teste/i.test(viewSrc) && !/testSend/.test(finSrc),
    "no test-send function, control or label is left in the shared file, the review page or the Finance page");
  const code = sendSrc.split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n");
  ok((code.match(/window\.open\(/g) || []).length === 2 && code.indexOf("window.open(") > code.indexOf("function sendWhatsApp(") && code.lastIndexOf("window.open(") < code.indexOf("function markSentOnly("),
    "the only code that opens a window is inside sendWhatsApp, the send that marks the invoice sent");
}
{
  const sc = fill({ markSent: "reject" });
  const t = await run(NEW, deps + "D.onMarkFailed = function(e) { out(e.message); }; window.ApexInvoiceSend.sendWhatsApp(INVOICES[0], D);", sc);
  ok(t.some(x => x[0] === "navigate") && t.some(x => x[0] === "result" && x[1] === "Failed to fetch") && !t.some(x => x[0] === "toast" || x[0] === "loadInvoices"),
    "review page send, mark-sent fails: WhatsApp still opens and the page is told why");
}

// No pageDialog and no deps.ask on the page: the script draws its own card.
// Run in a world where the test can tap the card, so it needs its own runner.
async function fallbackRun(call, action, sc) {
  const trace = [];
  const doc = fakeDocument(trace);
  const win = { open: (url, target) => { trace.push(["open", url, target, "buttonsOnScreen=" + doc.buttons().length]); return { location: { set href(v) { trace.push(["navigate", v]); } }, close() {} }; } };
  const box = {
    window: win, document: doc, Promise, Error, String, encodeURIComponent, console, Number, INVOICES: [SAMPLE],
    MESSAGE_TEMPLATES: { invoice_send: "Ola! Segue a fatura:\n{invoiceLink}\nObrigada." },
    APX_SWITCHES: { client_invoice_link_enabled: false, club_pay_enabled: false, role: "alice" },
    isEn: () => sc.en === true, toast: (m) => trace.push(["toast", m]), loadInvoices: () => {},
    apiFetch: (path, opts) => { trace.push(["apiFetch", path, opts && opts.method]); return Promise.resolve({ json: () => Promise.resolve({}) }); }
  };
  vm.createContext(box);
  vm.runInContext(fmtCents + "\n" + NEW + "\n" + call, box);
  const shown = doc.buttons().map(b => b.textContent);
  const focusedKeep = doc.buttons().length > 0 && doc.buttons()[doc.buttons().length - 1].focused;
  const sentBefore = trace.length;
  action(doc);
  for (let i = 0; i < 20; i++) { await new Promise(r => setImmediate(r)); }
  return { trace, shown, focusedKeep, sentBefore, left: doc.body.children.length };
}
for (const en of [false, true]) {
  const label = en ? "English" : "Portuguese";
  const call = "sendInvoiceWhatsApp(" + JSON.stringify(SAMPLE.id) + ");";
  let r = await fallbackRun(call, (d) => { const b = d.buttons(); d.click(b[0]); d.click(b[0]); }, { en });
  ok(r.shown.length === 2 && !/^(ok|cancel)$/i.test(r.shown[0]) && r.sentBefore === 0 && r.focusedKeep, "no page helper (" + label + "): Send shows the script's own card with two labelled buttons, Keep focused, nothing sent yet: " + r.shown.join(" / "));
  ok(r.trace.filter(t => t[0] === "open").length === 1 && r.trace.filter(t => t[0] === "apiFetch" && /mark-sent$/.test(t[1])).length === 1 && r.left === 0, "no page helper (" + label + "): Yes sends exactly once, even tapped twice, and the card closes");
  ok(r.trace.find(t => t[0] === "open")[3] === "buttonsOnScreen=0" && r.trace[0][0] === "open", "no page helper (" + label + "): window.open runs inside the Yes tap (card already gone, first thing that happens)");
  r = await fallbackRun(call, (d) => { d.click(d.buttons()[1]); }, { en });
  ok(r.trace.length === 0 && r.left === 0, "no page helper (" + label + "): Keep sends nothing and closes the card");
  r = await fallbackRun(call, (d) => { d.key("Escape"); }, { en });
  ok(r.trace.length === 0 && r.left === 0, "no page helper (" + label + "): Escape means Keep");
  r = await fallbackRun(call, (d) => { d.click(d.body.children[0]); }, { en });
  ok(r.trace.length === 0 && r.left === 0, "no page helper (" + label + "): a tap outside means Keep");
}

// SOURCE CHECK: no client-facing message can carry a templates/ or
// finance-new.html address while the master switch is ON. Built 2026-10-15
// alongside the revert-to-draft fix above -- this guards the SHAPE of the
// code (the openWhatsApp call that sends the message must sit behind the
// switch-ON-and-no-client-link return, never in front of it), not just one
// run's behavior, so a later edit that reorders the function trips it too.
{
  const src = readFileSync(new URL("apex-invoice-send.js", root), "utf8");
  const fn = cut(src, "runSend");
  const iGuardReturn = fn.indexOf("clientLinkEnabled() === true && !clientLink)");
  const iOpenWhatsApp = fn.indexOf("openWhatsApp();", fn.indexOf(".then(function(clientLink)"));
  ok(iGuardReturn > 0 && iOpenWhatsApp > 0 && iGuardReturn < iOpenWhatsApp,
    "runSend: the switch-ON-with-no-client-link guard (and its early return) sits BEFORE the openWhatsApp() call that actually sends the message");
  const guardBlock = fn.slice(iGuardReturn, fn.indexOf("return;", iGuardReturn) + 10);
  ok(/\breturn;/.test(guardBlock) && !/openWhatsApp\(\)/.test(guardBlock),
    "the guard block returns without ever calling openWhatsApp() -- a client-link failure with the switch ON cannot fall through to a send");
  ok(!/templates\/apex-invoice-template-DRAFT|finance-new\.html/.test(cut(src, "clientLinkForSend")) && !/templates\/apex-invoice-template-DRAFT|finance-new\.html/.test(cut(src, "buildMessage")),
    "neither clientLinkForSend nor buildMessage ever names a templates/ or finance-new.html address directly");
  // Dynamic companion to the static check: actually run the ON+no-link path
  // and confirm the built message (if any ever reached a window) never
  // carries the staff address.
  const sc = fill({ switchOn: true, clientLink: "reject" });
  const t = await run(NEW, "sendInvoiceWhatsApp(" + JSON.stringify(SAMPLE.id) + ");", sc);
  const anyNav = t.find(x => x[0] === "navigate");
  ok(!anyNav, "switch ON, client link fails: no navigate ever happens, so no message (staff or otherwise) reaches WhatsApp");
}

console.log(fail ? "\n" + fail + " FAILED" : "\nALL PASS");
process.exit(fail ? 1 : 0);
