// book.html cancel: an in-page confirmation, never a browser pop-up. Runs the
// page's REAL inline script in a vm with a tiny fake page and a fake fetch. No network.
//
//   node scripts/test-booking-cancel-inpage.mjs
import fs from "node:fs";
import vm from "node:vm";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };

const html = fs.readFileSync(new URL("../book.html", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const code = scripts[scripts.length - 1];
ok(html.includes("DOC_PAGE_LINK"), "DOC_PAGE_LINK is still in the page");
ok(!/\b(window\.)?(confirm|alert|prompt)\s*\(/.test(code), "no call to confirm/alert/prompt in the inline script");
ok(!/\b(confirm|alert|prompt)\s*\(/.test(html.replace(/<script>[\s\S]*?<\/script>/g, "")), "none in the markup either");

function boot(respond) {
  const els = {};
  const mk = (id) => els[id] || (els[id] = { id, innerHTML: "", textContent: "", value: "", disabled: false, focused: 0, focus() { this.focused++; }, classList: { toggle() {}, contains() { return false; } }, querySelectorAll() { return []; }, style: {} });
  const posted = [];
  const pending = [];
  const ctx = {
    console, Date, Intl, Math, JSON, String, Number, Object, Array, RegExp, encodeURIComponent, setTimeout, Promise,
    window: { location: { search: "", pathname: "/book.html" }, scrollTo() {}, sessionStorage: { getItem() { return null; }, setItem() {} } },
    document: { documentElement: { style: { setProperty() {} } }, getElementById: mk },
    history: { replaceState() {} },
    fetch: (url, opt) => { posted.push({ url, body: JSON.parse(opt.body) }); return new Promise((res, rej) => { pending.push(function() { respond(res, rej); }); }); }
  };
  vm.createContext(ctx);
  vm.runInContext(code.replace(/window\.onload\s*=\s*function\(\)\s*\{[\s\S]*?\n    \};\s*$/, ""), ctx);
  ctx.deviceTz = () => "America/Chicago";
  ctx.D = { active: true, tz: "America/New_York", tz_label: "EDT", slots: [], business: { name: "Biz", phone: "5555550123" } };
  vm.runInContext('lang = "en"; leadToken = "' + "a".repeat(48) + '"', ctx);
  return { ctx, els, posted, pending, run: (s) => vm.runInContext(s, ctx) };
}
const flat = (s) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const tick = () => new Promise((r) => setTimeout(r, 5));
const BK = '{ slot_date: "2026-10-14", slot_time: "14:00", address: "1 Main St" }';
const okRes = (res) => res({ status: 200, json: () => Promise.resolve({}) });
const failRes = (res) => res({ status: 500, json: () => Promise.resolve({ error_en: "Boom" }) });

// 1. tapping Cancel shows the in-page confirmation; Keep goes back, nothing sent
{
  const p = boot(okRes);
  p.run("renderDone(" + BK + ")");
  p.els.btnCancel.onclick();
  const c = flat(p.els.stepDone.innerHTML);
  ok(c.includes("Yes, cancel my visit") && c.includes("Keep my visit"), "confirmation has the two clear buttons");
  ok(c.includes("10/14/2026") && c.includes("1:00 PM CDT"), "confirmation repeats the day and time on the visitor's clock (" + c + ")");
  ok(p.els.cancelBox.focused === 1, "focus moved to the confirmation");
  ok(p.posted.length === 0, "nothing sent yet");
  p.els.btnCancelKeep.onclick();
  const s = flat(p.els.stepDone.innerHTML);
  ok(s.includes("Your visit is booked!") && s.includes("Cancel the visit") && p.posted.length === 0, "Keep: back to the booked summary, no request");
  // Escape = Keep
  p.els.btnCancel.onclick();
  p.els.cancelBox.onkeydown({ key: "Escape" });
  ok(flat(p.els.stepDone.innerHTML).includes("Your visit is booked!") && p.posted.length === 0, "Escape: back to the summary, no request");
  p.els.btnCancel.onclick();
  p.els.cancelBox.onkeydown({ key: "a" });
  ok(flat(p.els.stepDone.innerHTML).includes("Yes, cancel my visit"), "other keys do nothing");
}

// 2. Yes pressed twice sends exactly one request, then the cancelled message
{
  const p = boot(okRes);
  p.run("renderDone(" + BK + ")");
  p.els.btnCancel.onclick();
  p.els.btnCancelYes.onclick();
  p.els.btnCancelYes.onclick();
  ok(p.els.btnCancelYes.disabled && p.els.btnCancelKeep.disabled, "both buttons disabled while in flight");
  p.els.btnCancelKeep.onclick();
  ok(flat(p.els.stepDone.innerHTML).includes("Yes, cancel my visit"), "Keep does nothing while in flight");
  p.pending.forEach((f) => f());
  await tick();
  ok(p.posted.length === 1 && p.posted[0].url.endsWith("/cancel"), "exactly one cancel request: " + p.posted.length);
  ok(flat(p.els.stepDone.innerHTML).includes("Your visit is cancelled."), "shows today's cancelled message");
}

// 3. failed request: booking stays, error shows inside the confirmation, buttons come back
{
  const p = boot(failRes);
  p.run("renderDone(" + BK + ")");
  p.els.btnCancel.onclick();
  p.els.btnCancelYes.onclick();
  p.pending.forEach((f) => f());
  await tick();
  ok(p.els.doneErr.textContent === "Boom", "error text shown: " + p.els.doneErr.textContent);
  ok(!p.els.btnCancelYes.disabled && !p.els.btnCancelKeep.disabled, "buttons usable again");
  ok(p.run("doneBk.slot_time") === "14:00" && !flat(p.els.stepDone.innerHTML).includes("cancelled"), "visit still booked");
  p.els.btnCancelKeep.onclick();
  ok(flat(p.els.stepDone.innerHTML).includes("Your visit is booked!"), "Keep after a failure returns to the summary");
}
// 3b. no connection
{
  const p = boot((res, rej) => rej(new Error("x")));
  p.run("renderDone(" + BK + ")");
  p.els.btnCancel.onclick(); p.els.btnCancelYes.onclick(); p.pending.forEach((f) => f());
  await tick();
  ok(p.els.doneErr.textContent === "No connection. Please try again." && !p.els.btnCancelYes.disabled, "no connection: today's text, buttons back");
}

// 4. Portuguese labels
{
  const p = boot(okRes);
  p.run('lang = "pt"; renderDone(' + BK + ")");
  p.els.btnCancel.onclick();
  const c = flat(p.els.stepDone.innerHTML);
  ok(c.includes("Sim, cancelar minha visita") && c.includes("Manter minha visita") && c.includes("10/14/2026"), "Portuguese labels and date");
}

console.log(fail ? "\n" + fail + " FAILED" : "\nall passed");
process.exit(fail ? 1 : 0);
