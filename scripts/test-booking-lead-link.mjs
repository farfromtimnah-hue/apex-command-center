// A lead's booking link (book.html, kind "lead"): the customer is never asked for what the
// system already knows. Runs the page's REAL inline script in a vm with a tiny fake page and a
// fake fetch. No network. The server side of the same rules is in test-sms-consent.mjs.
//
//   node scripts/test-booking-lead-link.mjs
import fs from "node:fs";
import vm from "node:vm";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };
const html = fs.readFileSync(new URL("../book.html", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const code = scripts[scripts.length - 1];

function boot() {
  const els = {};
  const mk = (id) => els[id] || (els[id] = { id, innerHTML: "", textContent: "", value: "", checked: false, disabled: false, focus() {}, classList: { toggle() {}, contains() { return false; } }, querySelectorAll() { return []; }, style: {} });
  const posted = [];
  const ctx = {
    console, Date, Intl, Math, JSON, String, Number, Object, Array, RegExp, encodeURIComponent, setTimeout, Promise,
    window: { location: { search: "", pathname: "/book.html" }, scrollTo() {}, sessionStorage: { getItem() { return null; }, setItem() {} } },
    document: { documentElement: { style: { setProperty() {} } }, getElementById: mk },
    history: { replaceState() {} },
    fetch: (url, opt) => { posted.push({ url, body: JSON.parse(opt.body) }); return Promise.resolve({ status: 200, json: () => Promise.resolve({ booked: false }) }); }
  };
  vm.createContext(ctx);
  vm.runInContext(code.replace(/window\.onload\s*=\s*function\(\)\s*\{[\s\S]*?\n    \};\s*$/, ""), ctx);
  ctx.deviceTz = () => "America/New_York";
  const run = (s) => vm.runInContext(s, ctx);
  const load = (kind, customer, service) => {
    ctx.__d = { active: true, kind, tz: "America/New_York", tz_label: "EST", business: { name: "Shine Cleaning" }, questions: [], slots: [{ date: "2026-12-14", times: ["10:00"] }],
      customer: Object.assign({ name: "", first_name: "", phone: "", email: "", address: "", city: "" }, customer), service: service || "" };
    run('lang = "en"; D = __d; ' + (kind === "lead" ? 'leadToken = "' + "a".repeat(48) + '";' : 'siteSlug = "abcdefghij";') + " seed(); renderInfo();");
  };
  return { ctx, els, mk, posted, run, load, info: () => els.stepInfo.innerHTML };
}
const FULL = { name: "Maria Silva", first_name: "Maria", phone: "407-555-0123", email: "maria@x.test", address: "12 Oak St", city: "Tampa" };
const count = (s, re) => (s.match(re) || []).length;

// 1. a lead that has every field
{
  const p = boot(); p.load("lead", FULL, "Deep clean");
  const h = p.info();
  ok(count(h, /class="known"/g) === 6, "every field the lead has is a known row (5 fields and the service)");
  ok(!/data-field=/.test(h), "no empty input for a field the lead already has");
  ok(/Hi Maria,/.test(h), "the greeting uses the lead's first name");
  ok(/Deep clean/.test(h) && />Service</.test(h), "the service shown is the lead's service");
  ok(/\(407\) 555-0123/.test(h), "the phone is shown formatted");
  ok(/id="f_sms"/.test(h) && !/id="f_sms" checked/.test(h) && !/id="f_sms"[^>]*required/.test(h), "the text consent box is on the page, unchecked, not required, though the phone is known");
  ok(count(h, /data-edit=/g) === 5, "each known field has an Edit button");
  ok(p.run("missingText()") === "", "nothing is missing, so the customer goes straight on");
}
// 2. a lead that is missing some fields
{
  const p = boot(); p.load("lead", { name: "Maria Silva", first_name: "Maria", phone: "407-555-0123" }, "");
  const h = p.info();
  ok(/id="f_email"/.test(h) && /id="f_address"/.test(h) && /id="f_city"/.test(h), "a field the lead lacks (email, address, city) is an input");
  ok(!/id="f_name"/.test(h) && !/id="f_phone"/.test(h), "the fields the lead has (name, phone) are not inputs");
  ok(/Address for the visit <span class="req">\*/.test(h) && !/Email <span class="req">/.test(h) && !/City <span class="req">/.test(h), "address is required (marked) only because the lead has none; email and city are optional");
  ok(!/>Service</.test(h), "no service row when the lead has none");
  ok(/can't|Please enter the address/.test(p.run("missingText()")), "the page asks for the address before going on");
  ok(/id="f_sms"/.test(h), "the consent box is still there");
  const q = boot(); q.load("lead", Object.assign({}, FULL, { address: "", email: "" }));
  ok(/id="f_address"/.test(q.info()) && /id="f_email"/.test(q.info()) && !/id="f_phone"/.test(q.info()), "a lead with everything except address and email: only those two are asked");
}
// 3. formatting differences cannot turn a known field into an empty input
{
  const p = boot(); p.load("lead", { name: "Maria Silva ", first_name: "Maria", phone: " (407) 555-0123 ", email: " maria@x.test", address: "12 Oak St  ", city: "Tampa" });
  ok(count(p.info(), /class="known"/g) === 5 && !/data-field=/.test(p.info()), "a phone with brackets or spaces, a name or address with stray spaces: still known rows");
  const w = boot(); w.load("lead", { name: "Ana", first_name: "Ana", phone: "   ", email: "", address: "1 A St", city: "" });
  ok(/id="f_phone"/.test(w.info()) && !/>Phone<\/div>\s*<\/div>/.test(w.info()), "a phone that is only spaces counts as missing and is asked");
  const e = boot(); e.load("lead", FULL);
  e.run('editing.phone = true; renderInfo();');
  ok(/id="f_phone"[^>]*value="407-555-0123"/.test(e.info()), "Edit opens the field with the saved value");
}
// 4. the consent is saved as agreed only when ticked, declined otherwise
async function book(tick, cust) {
  const p = boot(); p.load("lead", cust || FULL);
  p.run('var vs = viewSlots(); chosenDate = vs[0].date; chosenTime = vs[0].times[0];');
  p.mk("f_sms").checked = tick;
  p.run("readInputs()");
  p.run("submit()");
  await new Promise((r) => setTimeout(r, 5));
  return p.posted[0];
}
{
  const a = await book(true);
  ok(a && a.url.endsWith("/book") && a.body.sms_consent_status === "agreed", "ticked: the booking says agreed");
  ok(a.body.customer.phone === "407-555-0123", "...recorded with the lead's phone");
  const d = await book(false);
  ok(d.body.sms_consent_status === "declined", "left unticked: the booking says declined");
  const p = boot(); p.load("lead", { name: "Ana", first_name: "Ana", phone: "", address: "1 A St" });
  p.mk("f_sms").checked = true; p.run("readInputs()");
  ok(/phone number/.test(p.run("missingText()")), "ticked with no phone anywhere: the page asks for a phone (or to untick), it never books a consent with nowhere to send");
  p.mk("f_sms").checked = false; p.run("readInputs()");
  ok(p.run("missingText()") === "", "unticked with no phone: fine, the box is never required");
}
// 5. the general link in the same tab shows nothing of a lead
{
  const p = boot(); p.load("lead", FULL, "Deep clean");
  p.mk("f_sms").checked = true; p.run("readInputs(); editing.email = true;");
  p.load("general", {});
  const h = p.info();
  ok(!/class="known"/.test(h) && /id="f_name"/.test(h) && /id="f_phone"/.test(h) && /id="f_address"/.test(h), "general link: every field is an input, no known rows");
  ok(!/Maria|407|12 Oak|maria@|Deep clean/.test(h) && /Book your visit/.test(h), "general link: none of the lead's data on the page");
  ok(p.run("smsConsent") === false && !/id="f_sms" checked/.test(h), "general link: the consent box starts unchecked, not carried over");
  ok(p.run("JSON.stringify(cust)") === '{"name":"","phone":"","email":"","address":"","city":""}' && p.run("JSON.stringify(editing)") === "{}", "general link: nothing typed or opened before carries over");
}
console.log(fail ? "\nFAILED" : "\nAll checks passed.");
process.exit(fail ? 1 : 0);
