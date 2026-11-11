// The "Text replies" list on calendar.html (staff) and under the portal calendar (owner): the real
// render code cut from the pages, run with a fake page. Dates MM/DD/YYYY, times 12-hour, read only.
//
//   node scripts/test-text-replies-page.mjs
import fs from "node:fs";
import vm from "node:vm";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };
const cal = fs.readFileSync(new URL("../calendar.html", import.meta.url), "utf8");
const gm = fs.readFileSync(new URL("../gm.js", import.meta.url), "utf8");
const portal = fs.readFileSync(new URL("../portal.html", import.meta.url), "utf8");
const cut = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error("marker " + a); return src.slice(i, j); };

const code = cut(cal, "    function trTwo(", "    function loadTextReplies()") + "\n" + cut(cal, "    function escHtml(str) {", "\n    }\n") + "\n}";
const box = { innerHTML: "" };
const ctx = { document: { getElementById: (id) => (id === "textReplies" ? box : null) }, Date, isNaN };
vm.createContext(ctx);
vm.runInContext(code, ctx);

ok(ctx.trWhen("2026-12-10T19:05:00.000Z") === vm.runInContext('(function(){var d=new Date("2026-12-10T19:05:00.000Z");var h=d.getHours();return ((d.getMonth()+1<10?"0":"")+(d.getMonth()+1))+"/"+(d.getDate()<10?"0":"")+d.getDate()+"/"+d.getFullYear()+" "+(h%12===0?12:h%12)+":"+(d.getMinutes()<10?"0":"")+d.getMinutes()+" "+(h>=12?"PM":"AM");})()', ctx) && /^\d\d\/\d\d\/\d{4} \d{1,2}:\d\d (AM|PM)$/.test(ctx.trWhen("2026-12-10T19:05:00.000Z")), "time received is MM/DD/YYYY h:mm AM/PM");
ctx.renderTextReplies([]);
ok(/Nenhuma resposta ainda/.test(box.innerHTML) && /No replies yet/.test(box.innerHTML), "empty list says so in both languages");
ctx.renderTextReplies([
  { phone: "+1 407-555-0155", text: "Can we do <b>5 PM</b>?", matched: true, confirmed: false, name: "Customer 1", meeting_date: "12/20/2026", meeting_time: "10:00 AM", forwarded: true, received_at: "2026-12-10T19:05:00.000Z" },
  { phone: "+1 555-555-0999", text: "who is this?", matched: false, confirmed: false, name: null, meeting_date: null, meeting_time: null, forwarded: false, received_at: "2026-12-10T18:00:00.000Z" },
  { phone: "+1 407-555-0155", text: "1", matched: true, confirmed: true, name: "Customer 1", meeting_date: "12/20/2026", meeting_time: "10:00 AM", forwarded: true, received_at: "2026-12-09T18:00:00.000Z" }
]);
const h = box.innerHTML;
ok(h.indexOf("+1 407-555-0155") < h.indexOf("+1 555-555-0999") && /Customer 1 · 12\/20\/2026 10:00 AM/.test(h), "phone formatted +1 555-555-5555 and the meeting shown with name, MM/DD/YYYY and 12-hour time");
ok(/Não associada a uma reunião/.test(h) && /Not matched to a meeting/.test(h), "an unmatched reply says not matched (Portuguese with accents, and English)");
ok(/Avisado/.test(h) && /Não avisado/.test(h) && /Forwarded/.test(h) && /Not forwarded/.test(h), "forwarded or not, in both languages");
ok(/&lt;b&gt;5 PM&lt;\/b&gt;/.test(h) && !/<b>5 PM/.test(h), "reply text is escaped, never run as HTML");
ok(/\(confirmou\)/.test(h) && /\(confirmed\)/.test(h), "a confirmation is marked");
ok(!/<button|<input|onclick=/.test(h), "the list is read only");
const pcode = cut(cal, "    function loadTextReplies()", "    function loadRafaNonApex()");
ok(!/\b(confirm|alert|prompt)\s*\(/.test(code + pcode + cut(gm, "function gmTextRepliesWhen", "// Same shape as calendar.html's navPrev")), "no confirm(), alert() or prompt()");
ok(!/=>/.test(code + pcode + cut(gm, "function gmTextRepliesWhen", "// Same shape as calendar.html's navPrev")), "no arrow functions in the browser code");
ok(/id="gmTextReplies"/.test(portal) && /gmLoadTextReplies\(\);\s*\}\)/.test(gm) && /apiFetch\("\/api\/text-replies"\)/.test(cal), "the list is wired: calendar page for staff, the portal calendar tab for the owner");
console.log(fail ? "\nFAILED" : "\nAll checks passed.");
process.exit(fail ? 1 : 0);
