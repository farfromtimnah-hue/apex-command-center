// Email buttons on the customer send screens (Open my email app / Copy).
// Runs the REAL helpers cut out of gm.js (root and iOS copy) and out of
// worker/index.js with stubbed page pieces. No network, no database, and
// nothing is sent.
//   node scripts/test-email-send-buttons.mjs
import { readFileSync } from "node:fs";
import { build, baseStubs, req } from "./fixtures/d1-shim.mjs";

const root = new URL("../", import.meta.url);
let failed = 0, passed = 0;
function ok(cond, label) { if (cond) { passed++; console.log("PASS  " + label); } else { failed++; console.log("FAIL  " + label); } }

function fnSource(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start === -1) { return null; }
  let i = src.indexOf("{", start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") { depth++; } else if (src[i] === "}") { depth--; if (depth === 0) { return src.slice(start, i + 1); } }
  }
  return null;
}

const HELPERS = ["gmEmailAddr", "gmBizDisplay", "gmEmailSubject", "gmEmailMailto", "gmEmailCopyText", "gmEmailButtonsHtml", "gmEmailPress", "gmEmailAdd", "gmEmailResolve", "gmEmailLeadId"];
const SENDERS = ["gmDocSendSheetRender", "gmReviewSheetRender"];

function escHtml(s) {
  return String(s === null || s === undefined ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Builds the real functions in a sandbox. lang is "pt" or "en".
function load(src, names, lang, extra) {
  const missing = names.filter((n) => fnSource(src, n) === null);
  if (missing.length) { return { missing }; }
  const log = { sheet: null, toasts: [], copied: [], marks: [], asks: [] };
  const stubs = Object.assign({
    gmT: (pt, en) => (lang === "pt" ? pt : en),
    escHtml,
    gmIcon: (n) => "<i>" + n + "</i>",
    gmToast: (m) => { log.toasts.push(m); },
    gmSheetOpen: (t, b) => { log.sheet = { title: t, body: b }; },
    gmWaDigits: (t) => String(t || "").replace(/\D/g, ""),
    gmDocSendPhoneNote: () => "",
    gmDocMsgEditorOpen: () => {},
    gmReviewTitle: () => "Ask for a Google review",
    gmReviewCopyCard: (t) => { log.asks.push(t); },
    gmReviewPress: (ch) => { log.marks.push(ch); },
    gmLeadById: () => null,
    gmJobsData: { jobs: [] },
    gmReviewSend: null,
    document: { getElementById: () => null },
    navigator: Object.assign({ userAgent: "Chrome", clipboard: { writeText: (t) => { log.copied.push(t); return Promise.resolve(); } } }, (extra && extra.navigator) || {})
  }, (extra && extra.stubs) || {});
  const code = "var gmEmailCtx = null; var gmDocSendMark = null; var gmEmailSaved = {};\n" + names.map((n) => fnSource(src, n)).join("\n") + "\nreturn { " + names.join(", ") + ", setReview: function(v) { gmReviewSend = v; } };";
  const keys = Object.keys(stubs);
  const lib = new Function(...keys, code)(...keys.map((k) => stubs[k]));
  return { lib, log };
}

const MSG = "Hi Ana, it's Luis from Golden Home.\nHere is your estimate & terms: https://doc.example/e/a?b=1&c=2\n\nThank you!";
const EQ15 = "===============";

for (const rel of ["gm.js", "ios/App/App/public/gm.js"]) {
  const src = readFileSync(new URL(rel, root), "utf8");
  const tag = rel + ": ";
  const en = load(src, HELPERS, "en");
  const pt = load(src, HELPERS, "pt");
  ok(!en.missing, tag + "gm.js defines every email helper" + (en.missing ? " (missing: " + en.missing.join(", ") + ")" : ""));
  if (en.missing) { continue; }
  const L = en.lib, P = pt.lib;

  // (a) mailto builder
  const m = L.gmEmailMailto("ana@example.com", "Estimate EST-1 from Golden Home Improvement", MSG);
  ok(m.indexOf("mailto:ana@example.com?subject=") === 0, tag + "(a) mailto:address?subject=...");
  ok(m.indexOf("&body=") > 0, tag + "(a) then &body=");
  ok(m.indexOf("%0D%0A") !== -1 && m.indexOf("%0A") === m.indexOf("%0D%0A") + 3 && !/%0A/.test(m.replace(/%0D%0A/g, "")), tag + "(a) every line break is CRLF (%0D%0A), no bare %0A");
  ok(m.indexOf("%26") !== -1 && m.indexOf("%3F") !== -1 && m.indexOf("%3D") !== -1, tag + "(a) special characters are encoded (&, ?, =)");
  const bodyPart = m.slice(m.indexOf("&body=") + 6);
  ok(decodeURIComponent(bodyPart) === MSG.replace(/\n/g, "\r\n"), tag + "(a) the body decodes to the message with CRLF line breaks");
  ok(decodeURIComponent(m.slice(m.indexOf("?subject=") + 9, m.indexOf("&body="))) === "Estimate EST-1 from Golden Home Improvement", tag + "(a) the subject decodes back exactly");
  ok(L.gmEmailMailto("  ana@example.com  ", "S", "b").indexOf("mailto:ana@example.com?") === 0, tag + "(a) the address is trimmed");
  // (b) empty address
  ok(L.gmEmailMailto("", "S", "b") === "mailto:?subject=S&body=b", tag + "(b) empty address: mailto with no recipient");
  ok(L.gmEmailMailto(null, "S", "b").indexOf("mailto:?subject=") === 0, tag + "(b) null address: mailto with no recipient");
  // address safety
  ok(L.gmEmailAddr("javascript:alert(1)") === "" && L.gmEmailAddr("a@b.com?bcc=x@y.com") === "" && L.gmEmailAddr("x y@z.com") === "" && L.gmEmailAddr("not an address") === "", tag + "anything that is not a plain address becomes empty");
  ok(L.gmEmailMailto("javascript:alert(1)", "S", "b") === "mailto:?subject=S&body=b", tag + "a script-looking address never reaches the link");
  ok(L.gmEmailAddr(" Ana.Silva+job@Example.co ") === "Ana.Silva+job@Example.co", tag + "a normal address with a plus sign passes, trimmed");

  // (c) copy text order and byte-for-byte message
  const t = L.gmEmailCopyText("ana@example.com", "Estimate EST-1 from Golden Home Improvement", MSG);
  const iHow = t.indexOf("HOW TO SEND THIS EMAIL. Read these 3 steps, then delete them."), i1 = t.indexOf("\n1. Copy the email address on the To line"), i2 = t.indexOf("\n2. Copy the subject on the Subject line"), i3 = t.indexOf("\n3. Delete everything from the top of this text down to and including the line of equals signs. What is left is your message. Then press Send."), iTo = t.indexOf("\nTo: ana@example.com\n"), iSub = t.indexOf("\nSubject: Estimate EST-1 from Golden Home Improvement\n"), iDel = t.indexOf("\n" + EQ15 + " DELETE EVERYTHING ABOVE THIS LINE " + EQ15 + "\n");
  ok(iHow === 0 && i1 > iHow && i2 > i1 && i3 > i2 && iTo > i3 && iSub > iTo && iDel > iSub, tag + "(c) instructions, then To, then Subject, then the delete line, in that order");
  const afterLine = t.slice(iDel + ("\n" + EQ15 + " DELETE EVERYTHING ABOVE THIS LINE " + EQ15 + "\n").length);
  ok(afterLine === MSG, tag + "(c) the message after the line is byte for byte the message passed in");
  const edited = "Edited text\r\nwith trailing space \n";
  ok(L.gmEmailCopyText("a@b.com", "S", edited).endsWith("\n" + EQ15 + " DELETE EVERYTHING ABOVE THIS LINE " + EQ15 + "\n" + edited), tag + "(c) an edited message (CRLF, trailing newline) is carried untouched");
  // (d) no email
  ok(L.gmEmailCopyText("", "S", "m").indexOf("\nTo: (type your customer's email here)\n") !== -1, tag + "(d) no email: the To line asks to type the customer's email");
  ok(L.gmEmailCopyText(null, "S", "m").indexOf("To: (type your customer's email here)") !== -1, tag + "(d) null email: same wording");
  ok(P.gmEmailCopyText("", "S", "m").indexOf("To: (") !== -1 && P.gmEmailCopyText("", "S", "m").indexOf("(type your customer's email here)") === -1, tag + "(d) Portuguese asks in Portuguese");
  // (e) both languages produce the delete line
  const tp = P.gmEmailCopyText("a@b.com", "S", "m");
  ok(tp.indexOf("\n" + EQ15 + " APAGUE TUDO ACIMA DESTA LINHA " + EQ15 + "\n") !== -1, tag + "(e) Portuguese delete line");
  ok(tp.indexOf("COMO ENVIAR ESTE EMAIL.") === 0 && /\n1\. /.test(tp) && /\n2\. /.test(tp) && /\n3\. /.test(tp) && tp.indexOf("HOW TO SEND") === -1, tag + "(e) Portuguese instructions with 3 steps, no English");
  ok(t.indexOf(EQ15 + " DELETE EVERYTHING ABOVE THIS LINE " + EQ15) !== -1 && (t.match(/={15}/g) || []).length === 2, tag + "(e) English delete line has exactly 15 equals signs on each side");

  // (g) business name display
  ok(L.gmBizDisplay("GOLDEN HOME IMPROVEMENT") === "Golden Home Improvement", tag + "(g) GOLDEN HOME IMPROVEMENT -> Golden Home Improvement");
  ok(L.gmBizDisplay("JM LUXURY POOLS") === "JM Luxury Pools", tag + "(g) JM LUXURY POOLS -> JM Luxury Pools");
  ok(L.gmBizDisplay("Golden Home Improvement LLC") === "Golden Home Improvement LLC", tag + "(g) a name with lowercase is left exactly as stored");
  ok(L.gmBizDisplay("") === "" && L.gmBizDisplay(null) === "" && L.gmBizDisplay(undefined) === "", tag + "(g) empty name gives an empty result");
  ok(L.gmBizDisplay("ABC ROOFING AND PAINT") === "ABC Roofing AND Paint", tag + "(g) words of 3 letters or fewer stay as they are, 4 or more are converted");
  ok(L.gmBizDisplay("Apex pools") === "Apex pools" && L.gmBizDisplay("iPool") === "iPool", tag + "(g) mixed case names are not touched");

  // (h) subject builders, two different businesses plus empty
  const A = "GOLDEN HOME IMPROVEMENT", B = "JM LUXURY POOLS";
  const subj = (k, n, biz) => L.gmEmailSubject(k, n, biz);
  const cases = [
    ["estimate", "EST-1", "Estimate EST-1 from ", "Estimate EST-1"],
    ["contract", "CON-2", "Contract CON-2 from ", "Contract CON-2"],
    ["signed", "CON-2", "Signed copy of CON-2, ", "Signed copy of CON-2"],
    ["change_order", "CO-3", "Change order CO-3 from ", "Change order CO-3"],
    ["invoice", "INV-4", "Invoice INV-4 from ", "Invoice INV-4"],
    ["receipt", "INV-4", "Receipt for INV-4, ", "Receipt for INV-4"]
  ];
  cases.forEach((c) => {
    ok(subj(c[0], c[1], A) === c[2] + "Golden Home Improvement", tag + "(h) " + c[0] + " subject with business A");
    ok(subj(c[0], c[1], B) === c[2] + "JM Luxury Pools", tag + "(h) " + c[0] + " subject with a different business B");
    const e = subj(c[0], c[1], "");
    ok(e === c[3] && !/,|\bfrom\b|\s$/.test(e), tag + "(h) " + c[0] + " subject with no business is clean: \"" + e + "\"");
  });
  ok(subj("route", "CON-2", A) === "Contract CON-2 is waiting for your signature" && subj("route", "CON-2", "") === "Contract CON-2 is waiting for your signature", tag + "(h) route notice subject, same with or without a business");
  ok(subj("review", "", A) === "Feedback on your recent job with Golden Home Improvement" && subj("review", "", B) === "Feedback on your recent job with JM Luxury Pools", tag + "(h) review subject names each business");
  ok(subj("review", "", "") === "Feedback on your recent job", tag + "(h) review subject with no business");
  ok(subj("estimate", "", A) === "Estimate from Golden Home Improvement" && subj("estimate", "", "") === "Estimate", tag + "(h) no number in scope: the number is dropped cleanly");
  const all = ["estimate", "contract", "signed", "change_order", "invoice", "receipt", "route", "review"].map((k) => subj(k, "N-1", A)).join(" ");
  ok(!/!|[\u{1F300}-\u{1FAFF}]/u.test(all), tag + "(h) subjects have no exclamation marks or emoji");

  // Buttons html + copy action
  const html = L.gmEmailButtonsHtml({ to: "ana@example.com", subject: "S one", text: MSG, mark: (ch) => en.log.marks.push(ch) });
  ok(/class="gm-contact-btn gm-email"/.test(html) && html.indexOf('href="mailto:ana@example.com?subject=S%20one&amp;body=') !== -1, tag + "buttons: the mailto link is in the page, escaped for the attribute");
  ok(html.indexOf("Open my email app") !== -1 && html.indexOf("Copy to send from a web email") !== -1 && html.indexOf("Use Gmail or Outlook in a browser? Tap Copy.") !== -1, tag + "buttons: English labels and hint");
  const htmlPt = P.gmEmailButtonsHtml({ to: "ana@example.com", subject: "S", text: "m", mark: () => {} });
  ok(htmlPt.indexOf("Abrir meu email") !== -1 && htmlPt.indexOf("Copiar para enviar pelo navegador") !== -1 && htmlPt.indexOf("Usa Gmail ou Outlook no navegador? Toque em Copiar.") !== -1, tag + "buttons: Portuguese labels and hint");
  const evil = L.gmEmailButtonsHtml({ to: 'x"><script>alert(1)</script>@a.com', subject: '"><img src=x onerror=alert(1)>', text: "<b>m</b>", mark: () => {} });
  ok(evil.indexOf("<script>") === -1 && evil.indexOf("<img") === -1 && evil.indexOf("<b>") === -1, tag + "buttons: nothing user-typed lands in the page unescaped");

  L.gmEmailButtonsHtml({ to: "ana@example.com", subject: "S one", text: MSG, mark: (ch) => en.log.marks.push(ch) });
  L.gmEmailPress("email_copy");
  ok(en.log.marks.indexOf("email_copy") !== -1, tag + "copy press calls the mark-as-sent hook with email_copy");
  await Promise.resolve(); await Promise.resolve();
  ok(en.log.copied.length === 1 && en.log.copied[0] === L.gmEmailCopyText("ana@example.com", "S one", MSG), tag + "copy press puts the one block on the clipboard");
  ok(en.log.toasts.indexOf("Copied. Paste it into your email.") !== -1, tag + "copy press shows the short toast");
  L.gmEmailPress("email");
  ok(en.log.marks.indexOf("email") !== -1, tag + "open press calls the mark-as-sent hook with email");
  const noClip = load(src, HELPERS, "en", { navigator: { clipboard: undefined } });
  noClip.lib.gmEmailButtonsHtml({ to: "ana@example.com", subject: "S", text: "m", mark: () => {} });
  noClip.lib.gmEmailPress("email_copy");
  ok(noClip.log.asks.length === 1 && noClip.log.asks[0].indexOf("To: ana@example.com") !== -1, tag + "no clipboard: the same read-only copy card as the review copy is used");
  ok(noClip.log.toasts.length === 0, tag + "no clipboard: no false 'Copied' toast");

  // (i) the two send sheets
  const doc = load(src, HELPERS.concat(SENDERS), "en");
  ok(!doc.missing, tag + "send sheets load" + (doc.missing ? " (missing: " + doc.missing.join(", ") + ")" : ""));
  if (!doc.missing) {
    const D = doc.lib;
    D.gmDocSendSheetRender("Send contact card", "5551234567", "card text", null, null, function() {}, function() {});
    ok(doc.log.sheet.body.indexOf("gm-email") === -1 && doc.log.sheet.body.indexOf("mailto:") === -1, tag + "(i) email argument undefined (contact card): NO email buttons");
    D.gmDocSendSheetRender("Send estimate", "5551234567", MSG, "k", function() {}, function() {}, function() {}, null, "GOLDEN HOME IMPROVEMENT", "estimate", "EST-1");
    ok(doc.log.sheet.body.indexOf("gm-email") !== -1 && doc.log.sheet.body.indexOf("mailto:") === -1, tag + "(i) email null: the email buttons are shown, greyed, with no mailto");
    D.gmDocSendSheetRender("Send estimate", "5551234567", MSG, "k", function() {}, function() {}, function() {}, "ana@example.com", "GOLDEN HOME IMPROVEMENT", "estimate", "EST-1");
    ok(doc.log.sheet.body.indexOf('href="mailto:ana@example.com?subject=Estimate%20EST-1%20from%20Golden%20Home%20Improvement&amp;body=') !== -1, tag + "(i) a real address: subject from the business name");
    D.gmDocSendSheetRender("Send invoice", "", MSG, "k", function() {}, function() {}, function() {}, "", "JM LUXURY POOLS", "invoice", "INV-9");
    ok(doc.log.sheet.body.indexOf("gm-email") !== -1 && doc.log.sheet.body.indexOf("mailto:") === -1, tag + "(i) email \"\": the email buttons are shown, greyed, with no mailto");
    D.gmDocSendSheetRender("Send invoice", "", MSG, "k", function() {}, function() {}, function() {}, "ana@example.com", "JM LUXURY POOLS", "invoice", "INV-9");
    ok(doc.log.sheet.body.indexOf("mailto:ana@example.com?subject=Invoice%20INV-9%20from%20JM%20Luxury%20Pools") !== -1, tag + "(i) a real address: another business name used");
    D.gmDocSendSheetRender("Send invoice", "", MSG, "k", function() {}, function() {}, function() {}, "ana@example.com", "", "invoice", "INV-9");
    ok(doc.log.sheet.body.indexOf("mailto:ana@example.com?subject=Invoice%20INV-9&amp;body=") !== -1, tag + "(i) a real address and no business name: the subject drops the company part");
    ok(doc.log.sheet.body.indexOf("gm-sms") !== -1 && doc.log.sheet.body.indexOf("gm-wa") !== -1, tag + "(i) Text message and WhatsApp are still there");
    // mark hook
    let marked = 0;
    D.gmDocSendSheetRender("Send invoice", "", MSG, "k", function() { marked++; }, function() {}, function() {}, "a@b.com", "X Co", "invoice", "INV-9");
    D.gmEmailPress("email");
    ok(marked === 1, tag + "tapping the email button runs the sheet's own mark-as-sent hook");

    // review sheet
    D.setReview({ jobId: "j1", d: { message: MSG, phone: "5551234567", email: "ana@example.com", business_name: "GOLDEN HOME IMPROVEMENT" } });
    D.gmReviewSheetRender();
    ok(doc.log.sheet.body.indexOf("mailto:ana@example.com?subject=Feedback%20on%20your%20recent%20job%20with%20Golden%20Home%20Improvement&amp;body=") !== -1, tag + "review sheet shows the buttons with the review subject");
    D.setReview({ jobId: "j1", d: { message: MSG, phone: "", email: "ana@example.com", business_name: "" } });
    D.gmReviewSheetRender();
    ok(doc.log.sheet.body.indexOf("mailto:ana@example.com?subject=Feedback%20on%20your%20recent%20job&amp;body=") !== -1, tag + "review sheet with an address and no business is clean");
    D.gmEmailPress("email_copy");
    ok(doc.log.marks.indexOf("email_copy") !== -1, tag + "review sheet: the copy press logs channel email_copy");
    D.gmEmailPress("email");
    ok(doc.log.marks.indexOf("email") !== -1, tag + "review sheet: the open press logs channel email");
  }

  // Every document caller passes the new arguments; only the contact card does not.
  const calls = src.split("gmDocSendSheetRender(").slice(1).map((s) => s.slice(0, 1100)).filter((s) => !/^title, phone/.test(s));
  const withBiz = calls.filter((s) => s.slice(0, s.search(/\n\s*\}\)\.catch|\n\}\n|\n\s*\}\n/) > 0 ? s.search(/\n\s*\}\)\.catch|\n\}\n|\n\s*\}\n/) : 1100).indexOf("business_name") !== -1);
  ok(calls.length === 8 && withBiz.length === 7, tag + "7 document send screens pass the business name; 1 caller (contact card) does not (" + withBiz.length + " of " + calls.length + ")");
}


// ---- Add an email right on the send screen ----
const ADD_NAMES = ["gmEmailAddr", "gmEmailSubject", "gmBizDisplay", "gmEmailMailto", "gmEmailCopyText", "gmEmailButtonsHtml", "gmEmailPress", "gmEmailAdd", "gmEmailResolve", "gmEmailLeadId", "gmDocSendSheetRender", "gmReviewSheetRender"];
function withAdd(src, lang, over) {
  const leads = { l1: { id: "l1", email: "" } };
  const saves = [], editors = [];
  const r = load(src, ADD_NAMES, lang, { stubs: Object.assign({
    gmLeadById: (id) => leads[id] || null,
    gmSaveLeadField: (key, value, after, reason, lead) => { saves.push({ key, value, after, reason, lead }); },
    gmOpenFieldEditor: (label, type, value, options, onSave, note, onCancel, req) => { editors.push({ label, type, onSave, req }); },
    gmJobsData: { jobs: [{ id: "j1", lead_id: "l1" }, { id: "j2", lead_id: null }] }
  }, over || {}) });
  r.leads = leads; r.saves = saves; r.editors = editors;
  return r;
}
const emailRow = (body) => { const i = body.indexOf("gm-email-row"); return body.slice(i, body.indexOf("</div>", i)); };

for (const rel of ["gm.js", "ios/App/App/public/gm.js"]) {
  const src = readFileSync(new URL(rel, root), "utf8");
  const tag = rel + " (add email): ";
  const en = withAdd(src, "en");
  ok(!en.missing, tag + "helpers load" + (en.missing ? " (missing: " + en.missing.join(", ") + ")" : ""));
  if (en.missing) { continue; }
  const D = en.lib, log = en.log;
  const render = (email, extra) => { D.gmDocSendSheetRender("Send invoice", "4075550142", MSG, "k", function() { log.marks.push("hook"); }, function() {}, function() {}, email, "GOLDEN HOME IMPROVEMENT", "invoice", "INV-9", extra && extra.leadId, extra && extra.noAddReason); return log.sheet.body; };

  // (a) with an address: live, as before
  let b = render("ana@example.com", { leadId: "l1" });
  ok(b.indexOf('href="mailto:ana@example.com?subject=Invoice%20INV-9%20from%20Golden%20Home%20Improvement&amp;body=') !== -1 && emailRow(b).indexOf("aria-disabled") === -1 && emailRow(b).indexOf("gm-reason") === -1, tag + "(a) an address: both buttons live, mailto present, nothing greyed");
  ok(b.indexOf("Use Gmail or Outlook in a browser? Tap Copy.") !== -1 && b.indexOf("No email on file. Tap to add.") === -1, tag + "(a) the normal hint stays");
  D.gmEmailPress("email_copy"); await Promise.resolve(); await Promise.resolve();
  ok(log.copied.length === 1 && log.copied[0].indexOf("To: ana@example.com") !== -1 && log.marks.indexOf("hook") !== -1, tag + "(a) copy still copies the block and marks as sent");

  // (b) null and "": greyed
  [null, ""].forEach((v) => {
    const g = render(v, { leadId: "l1" });
    const row = emailRow(g);
    ok((row.match(/aria-disabled="true"/g) || []).length === 2 && (row.match(/gm-reason/g) || []).length === 2 && row.indexOf("mailto:") === -1 && g.indexOf("mailto:") === -1, tag + "(b) email " + JSON.stringify(v) + ": both buttons greyed, no mailto anywhere");
    ok(/<button[^>]*gm-email[^>]*>/.test(row) && !/<a [^>]*gm-email/.test(row), tag + "(b) email " + JSON.stringify(v) + ": the greyed controls are button elements, not links");
    ok(g.indexOf("No email on file. Tap to add.") !== -1 && g.indexOf("Use Gmail or Outlook") === -1, tag + "(b) email " + JSON.stringify(v) + ": hint is the add prompt (English)");
  });
  const ptSheet = withAdd(src, "pt");
  ptSheet.lib.gmDocSendSheetRender("Enviar fatura", "", MSG, "k", null, function() {}, function() {}, null, "X", "invoice", "INV-9", "l1");
  ok(ptSheet.log.sheet.body.indexOf("Sem email cadastrado. Toque para adicionar.") !== -1 && ptSheet.log.sheet.body.indexOf("Usa Gmail") === -1, tag + "(b) hint is the add prompt (Portuguese)");

  // (c) a greyed tap opens the editor only
  b = render(null, { leadId: "l1" });
  ok(/onclick="gmEmailAdd\(\)"/.test(emailRow(b)) && emailRow(b).indexOf("gmEmailPress") === -1, tag + "(c) a greyed button runs the add flow, not the send press");
  log.marks.length = 0; log.copied.length = 0; log.toasts.length = 0; en.editors.length = 0;
  D.gmEmailAdd();
  D.gmEmailPress("email"); D.gmEmailPress("email_copy"); await Promise.resolve(); await Promise.resolve();
  ok(log.marks.length === 0 && log.copied.length === 0 && log.toasts.indexOf("Copied. Paste it into your email.") === -1, tag + "(c) no mark-as-sent, no clipboard write, even if a press is forced");
  ok(en.editors.length === 1 && en.editors[0].label === "Email" && en.editors[0].type === "email", tag + "(c) the field editor opens with an email field labelled Email");
  ok(en.editors[0].req && en.editors[0].req[0] && en.editors[0].req[1], tag + "(c) an empty value is refused with a message in both languages");

  // (d) save goes through the existing lead save, then redraws live
  en.saves.length = 0;
  en.editors[0].onSave("ana@example.com");
  ok(en.saves.length === 1 && en.saves[0].key === "email" && en.saves[0].value === "ana@example.com" && en.saves[0].lead && en.saves[0].lead.id === "l1" && typeof en.saves[0].after === "function", tag + "(d) the existing gmSaveLeadField is called with the lead id and the email");
  ok(log.marks.length === 0, tag + "(d) saving does not mark as sent");
  en.saves[0].after();
  ok(log.sheet.body.indexOf('href="mailto:ana@example.com?subject=Invoice%20INV-9%20from%20Golden%20Home%20Improvement&amp;body=') !== -1 && emailRow(log.sheet.body).indexOf("aria-disabled") === -1, tag + "(d) after the save the same sheet redraws with live buttons and the new address in the mailto");
  ok(log.toasts.indexOf("Email saved") !== -1 && en.leads.l1.email === "ana@example.com", tag + "(d) toast Email saved, and the in-memory lead has the address");
  ok(render(null, { leadId: "l1" }).indexOf("mailto:ana@example.com") !== -1, tag + "(d) the next open of a sheet that still carries no address shows the saved one");
  en.leads.l1.email = ""; 

  // (f) route notice
  const rn = render("", { leadId: "", noAddReason: "No email on file for this person" });
  ok(emailRow(rn).indexOf("aria-disabled=\"true\"") !== -1 && emailRow(rn).indexOf("gmEmailAdd") === -1 && emailRow(rn).indexOf("onclick") === -1 && rn.indexOf("No email on file for this person") !== -1 && rn.indexOf("Tap to add") === -1, tag + "(f) route notice with no email: greyed, its own reason, no add flow");
  en.editors.length = 0; D.gmEmailAdd();
  ok(en.editors.length === 0, tag + "(f) forcing the add flow on the route notice opens nothing");
  // (g) no lead id
  [undefined, "", null].forEach((id) => {
    const ng = render(null, { leadId: id });
    ok(ng.indexOf("No customer record to save an email on") !== -1 && emailRow(ng).indexOf("gmEmailAdd") === -1 && emailRow(ng).indexOf("aria-disabled=\"true\"") !== -1 && ng.indexOf("Tap to add") === -1, tag + "(g) lead id " + JSON.stringify(id) + ": the no-customer-record reason, no add flow");
  });
  en.editors.length = 0; render(null, { leadId: "" }); D.gmEmailAdd();
  ok(en.editors.length === 0, tag + "(g) forcing the add flow with no lead opens nothing");
  const ptNo = withAdd(src, "pt"); ptNo.lib.gmDocSendSheetRender("t", "", MSG, null, null, function() {}, function() {}, null, "", "invoice", "1", "");
  ok(ptNo.log.sheet.body.indexOf("Sem registro do cliente para salvar o email") !== -1, tag + "(g) Portuguese reason");
  const ptRn = withAdd(src, "pt"); ptRn.lib.gmDocSendSheetRender("t", "", MSG, null, null, function() {}, function() {}, "", "", "route", "1", "", "Sem email cadastrado para esta pessoa");
  ok(ptRn.log.sheet.body.indexOf("Sem email cadastrado para esta pessoa") !== -1, tag + "(f) Portuguese route reason");
  // (h) contact card
  D.gmDocSendSheetRender("Send contact card", "5551234567", "card", null, null, function() {}, function() {});
  ok(log.sheet.body.indexOf("gm-email") === -1, tag + "(h) the contact card still shows no email buttons");

  // review sheet: greyed with no email, lead id from the project row
  const rv = withAdd(src, "en"); const RD = rv.lib;
  RD.setReview({ jobId: "j1", d: { message: MSG, phone: "", email: null, business_name: "X" } });
  RD.gmReviewSheetRender();
  ok(emailRow(rv.log.sheet.body).indexOf('aria-disabled="true"') !== -1 && /onclick="gmEmailAdd\(\)"/.test(emailRow(rv.log.sheet.body)), tag + "review sheet with no email: greyed, add flow on (lead id from the project)");
  RD.setReview({ jobId: "j2", d: { message: MSG, phone: "", email: null, business_name: "X" } });
  RD.gmReviewSheetRender();
  ok(rv.log.sheet.body.indexOf("No customer record to save an email on") !== -1, tag + "review sheet on a project with no lead: the no-customer-record reason");
  // lead id lookup
  ok(D.gmEmailLeadId({ lead_id: "l7" }) === "l7" && D.gmEmailLeadId({ job_id: "j1" }) === "l1" && D.gmEmailLeadId({ job_id: "j2" }) === "" && D.gmEmailLeadId(null) === "" && D.gmEmailLeadId({}) === "", tag + "lead id: the document's own, else its project's lead, else empty");

  // (e) bad addresses never reach the save
  const cm = load(src, ["gmEmailAddr", "gmEditorCommit"], "en", { stubs: {
    gmParseMoney: () => null, gmLooksLikePhone: () => true, GM_PHONE_INVALID: ["x", "y"], gmSheetClose: () => {} } });
  ok(!cm.missing, tag + "gmEditorCommit loads");
  if (!cm.missing) {
    const bad = ["ana.example.com", "a b@c.com", "x@y", "a@b@c.com", "javascript:alert(1)", "<a@b.com>", "", "a".repeat(250) + "@b.com", "ana@example.com?bcc=x@y.com"];
    bad.forEach((v) => {
      const msg = { textContent: "", hidden: true }; let saved = 0;
      const prelude = "var gmEditorSave = null, gmEditorRequired = null, gmEditorMultiValue = [], gmEditorChoiceValue = null, gmSheetOnUserClose = null;\n";
      const fn = new Function("document", "gmT", "gmEmailAddr_unused", "gmParseMoney", "gmLooksLikePhone", "GM_PHONE_INVALID", "gmSheetClose", "gmToast", "onSave",
        prelude + fnSource(src, "gmEmailAddr") + "\n" + fnSource(src, "gmEditorCommit") + "\ngmEditorSave = onSave; gmEditorRequired = [\"Digite um email\", \"Enter an email\"]; gmEditorCommit(\"email\");")(
        { getElementById: (id) => (id === "gmEditorInput" ? { value: v, focus() {} } : id === "gmEditorMsg" ? msg : null) },
        (pt, e) => e, null, () => null, () => true, ["x", "y"], () => {}, () => {}, () => { saved++; });
      ok(saved === 0 && msg.hidden === false && msg.textContent.length > 0, tag + "(e) refused on the client with an inline message, save never called: " + JSON.stringify(v.length > 40 ? v.slice(0, 12) + "...(" + v.length + ")" : v));
    });
    ["ana@example.com", "  ana@example.com  ", "Ana.S+job@Example.co"].forEach((v) => {
      const msg = { textContent: "", hidden: true }; let got = null;
      new Function("document", "gmT", "gmParseMoney", "gmLooksLikePhone", "GM_PHONE_INVALID", "gmSheetClose", "onSave",
        "var gmEditorSave = null, gmEditorRequired = null, gmEditorMultiValue = [], gmEditorChoiceValue = null, gmSheetOnUserClose = null;\n" + fnSource(src, "gmEmailAddr") + "\n" + fnSource(src, "gmEditorCommit") + "\ngmEditorSave = onSave; gmEditorCommit(\"email\");")(
        { getElementById: (id) => (id === "gmEditorInput" ? { value: v, focus() {} } : id === "gmEditorMsg" ? msg : null) },
        (pt, e) => e, () => null, () => true, ["x", "y"], () => {}, (x) => { got = x; });
      ok(got === v.trim() && msg.hidden === true, tag + "(e) a good address is handed to the save trimmed: " + JSON.stringify(v));
    });
    const ptMsg = { textContent: "", hidden: true };
    new Function("document", "gmT", "gmParseMoney", "gmLooksLikePhone", "GM_PHONE_INVALID", "gmSheetClose", "onSave",
      "var gmEditorSave = null, gmEditorRequired = null, gmEditorMultiValue = [], gmEditorChoiceValue = null, gmSheetOnUserClose = null;\n" + fnSource(src, "gmEmailAddr") + "\n" + fnSource(src, "gmEditorCommit") + "\ngmEditorSave = onSave; gmEditorCommit(\"email\");")(
      { getElementById: (id) => (id === "gmEditorInput" ? { value: "nope", focus() {} } : id === "gmEditorMsg" ? ptMsg : null) },
      (pt, e) => pt, () => null, () => true, ["x", "y"], () => {}, () => {});
    ok(/[a-z]/i.test(ptMsg.textContent) && ptMsg.textContent !== new Function("return 0")(), tag + "(e) the inline message is also written in Portuguese");
  }
}

// ---- Worker ----
const w = readFileSync(new URL("worker/index.js", root), "utf8");
const emailSrc = fnSource(w, "gmDocSendEmail");
ok(!!emailSrc, "(f) worker defines gmDocSendEmail");
if (emailSrc) {
  const f = new Function(emailSrc + "; return gmDocSendEmail;")();
  ok(f({ email: "lead@x.com" }, "doc@x.com") === "lead@x.com", "(f) the lead email wins");
  ok(f({ email: "" }, "doc@x.com") === "doc@x.com" && f(null, "doc@x.com") === "doc@x.com", "(f) then the document email");
  ok(f({}, "") === null && f(null, null) === null && f({ email: null }, undefined) === null, "(f) then null");
}
const ch = w.match(/var GM_SEND_CHANNELS = (\[[^\]]*\]);/);
const chans = ch ? JSON.parse(ch[1]) : [];
ok(chans.indexOf("email") !== -1 && chans.indexOf("email_copy") !== -1 && chans.indexOf("whatsapp") !== -1 && chans.indexOf("sms") !== -1 && chans.indexOf("copy") !== -1, "review-request allows email and email_copy and keeps the old channels");
ok(chans.length === 5, "review-request channel list has no surprise entries");

// (j) guard: every phone return also returns the email and the business name
const lines = w.split("\n");
let phoneCalls = 0, withEmail = 0, withBiz = 0;
lines.forEach((ln, idx) => {
  if (ln.indexOf("gmDocSendPhone(") === -1 || ln.indexOf("function gmDocSendPhone") !== -1) { return; }
  phoneCalls++;
  const win = lines.slice(idx, idx + 3).join("\n");
  if (win.indexOf("gmDocSendEmail(") !== -1) { withEmail++; }
  if (/(send_)?business_name:|\.business_name =|send_business_name/.test(win)) { withBiz++; }
});
ok(phoneCalls >= 12, "(j) found the phone returns (" + phoneCalls + ")");
ok(withEmail === phoneCalls, "(j) every gmDocSendPhone return also returns the email (" + withEmail + " of " + phoneCalls + ")");
ok(withBiz === phoneCalls, "(j) every gmDocSendPhone return also returns the business name (" + withBiz + " of " + phoneCalls + ")");
ok(!/console\.(log|error)\([^)]*(email|\.message)/i.test(w.slice(w.indexOf("function gmDocSendEmail"), w.indexOf("function gmDocSendEmail") + 300)), "the email helper logs nothing");


// (i) the lead save route validates an email on the server
const okSrc = fnSource(w, "gmLeadEmailOk");
ok(!!okSrc, "(i) worker defines gmLeadEmailOk");
if (okSrc) {
  const f = new Function(okSrc + "; return gmLeadEmailOk;")();
  ok(f("ana@example.com") && f("Ana.S+job@Example.co") && f("a@b-c.io"), "(i) plain addresses pass");
  ok(!f("ana.example.com") && !f("a b@c.com") && !f("x@y") && !f("a@b@c.com") && !f("javascript:alert(1)") && !f("a".repeat(250) + "@b.com") && !f(42) && !f({}) && !f(["a@b.com"]), "(i) bad shapes, a long value and non-strings are refused");
}
{
  const calls = { prepare: 0, batch: 0, run: 0 };
  const DB = { prepare() { calls.prepare++; return { bind() { return this; }, run() { calls.run++; return {}; }, first() { return null; } }; }, batch() { calls.batch++; return []; } };
  const FNS = ["handlePutGmLead", "gmLeadFields", "gmLeadEmailOk", "gmStr", "gmNum"];
  const VARS = ["GM_LEAD_COST_FIELDS"];
  const stubs = Object.assign({}, baseStubs, {
    authenticate: async () => ({ role: "client", client_id: "c1", display_name: "ZETA" }),
    requireClientAccess: () => true,
    gmOwnedRow: async () => ({ id: "l1", client_id: "c1", email: null, estagio: "novo_lead" }),
    sessionSellerName: () => null, sellerCanActOnLead: () => true, gmGetConfig: async () => ({})
  });
  const F = build(FNS, VARS, stubs);
  const put = (body) => F.handlePutGmLead("c1", "l1", req(body), { DB });
  for (const bad of ["ana.example.com", "a b@c.com", "javascript:alert(1)", "x@y", "a".repeat(250) + "@b.com", 42, ["a@b.com"]]) {
    const r = await put({ email: bad });
    ok(r.status === 400 && calls.batch === 0 && calls.run === 0, "(i) PUT lead with email " + JSON.stringify(typeof bad === "string" && bad.length > 40 ? "(long)" : bad) + ": 400 and nothing written");
  }
  ok(calls.prepare === 0, "(i) no database statement was even prepared for a refused email");
  const fields = await F.gmLeadFields({ email: "  ana@example.com " }, {}, true, null, "c1");
  ok(!fields.error && fields.fields.email === "ana@example.com", "(i) a good email is accepted and trimmed");
  const clear = await F.gmLeadFields({ email: null }, {}, true, null, "c1");
  ok(!clear.error && clear.fields.email === null, "(i) null still clears the email");
  const blank = await F.gmLeadFields({ email: "   " }, {}, true, null, "c1");
  ok(!blank.error && blank.fields.email === null, "(i) a blank email still clears it");
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
