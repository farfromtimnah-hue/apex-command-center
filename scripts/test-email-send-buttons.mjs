// Email buttons on the customer send screens (Open my email app / Copy).
// Runs the REAL helpers cut out of gm.js (root and iOS copy) and out of
// worker/index.js with stubbed page pieces. No network, no database, and
// nothing is sent.
//   node scripts/test-email-send-buttons.mjs
import { readFileSync } from "node:fs";

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

const HELPERS = ["gmEmailAddr", "gmBizDisplay", "gmEmailSubject", "gmEmailMailto", "gmEmailCopyText", "gmEmailButtonsHtml", "gmEmailPress"];
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
  const code = "var gmEmailCtx = null; var gmDocSendMark = null;\n" + names.map((n) => fnSource(src, n)).join("\n") + "\nreturn { " + names.join(", ") + ", setReview: function(v) { gmReviewSend = v; } };";
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
  const htmlPt = P.gmEmailButtonsHtml({ to: "", subject: "S", text: "m", mark: () => {} });
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
  noClip.lib.gmEmailButtonsHtml({ to: "", subject: "S", text: "m", mark: () => {} });
  noClip.lib.gmEmailPress("email_copy");
  ok(noClip.log.asks.length === 1 && noClip.log.asks[0].indexOf("(type your customer's email here)") !== -1, tag + "no clipboard: the same read-only copy card as the review copy is used");
  ok(noClip.log.toasts.length === 0, tag + "no clipboard: no false 'Copied' toast");

  // (i) the two send sheets
  const doc = load(src, HELPERS.concat(SENDERS), "en");
  ok(!doc.missing, tag + "send sheets load" + (doc.missing ? " (missing: " + doc.missing.join(", ") + ")" : ""));
  if (!doc.missing) {
    const D = doc.lib;
    D.gmDocSendSheetRender("Send contact card", "5551234567", "card text", null, null, function() {}, function() {});
    ok(doc.log.sheet.body.indexOf("gm-email") === -1 && doc.log.sheet.body.indexOf("mailto:") === -1, tag + "(i) email argument undefined (contact card): NO email buttons");
    D.gmDocSendSheetRender("Send estimate", "5551234567", MSG, "k", function() {}, function() {}, function() {}, null, "GOLDEN HOME IMPROVEMENT", "estimate", "EST-1");
    ok(doc.log.sheet.body.indexOf('href="mailto:?subject=Estimate%20EST-1%20from%20Golden%20Home%20Improvement&amp;body=') !== -1, tag + "(i) email null: buttons shown, empty To, subject from the business name");
    D.gmDocSendSheetRender("Send invoice", "", MSG, "k", function() {}, function() {}, function() {}, "", "JM LUXURY POOLS", "invoice", "INV-9");
    ok(doc.log.sheet.body.indexOf("mailto:?subject=Invoice%20INV-9%20from%20JM%20Luxury%20Pools") !== -1, tag + "(i) email \"\": buttons shown, another business name used");
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
    D.setReview({ jobId: "j1", d: { message: MSG, phone: "", email: null, business_name: "" } });
    D.gmReviewSheetRender();
    ok(doc.log.sheet.body.indexOf("mailto:?subject=Feedback%20on%20your%20recent%20job&amp;body=") !== -1, tag + "review sheet with no email and no business is clean");
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

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
