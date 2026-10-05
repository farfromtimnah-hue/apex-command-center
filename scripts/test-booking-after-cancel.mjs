// book.html general link: after a cancel the link shows the empty form again.
// Runs the page's REAL inline script in a vm with a tiny fake page and a fake fetch. No network.
//
//   node scripts/test-booking-after-cancel.mjs
import fs from "node:fs";
import vm from "node:vm";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };
const html = fs.readFileSync(new URL("../book.html", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const code = scripts[scripts.length - 1];
ok(html.includes("DOC_PAGE_LINK"), "DOC_PAGE_LINK is still in the page");
ok(!/\b(window\.)?(confirm|alert|prompt)\s*\(/.test(code), "no browser pop-up call in the inline script");

const SLUG = "abcdefghij";
const TOK = "b".repeat(48);
const flat = (s) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const tick = () => new Promise((r) => setTimeout(r, 5));
const BIZ = { name: "Biz", phone: "5555550123" };
const FORM = { active: true, kind: "general", tz: "America/New_York", slots: [], business: BIZ, customer: {}, questions: [], language: "en" };
const BOOKED = { active: true, kind: "lead", status: "booked", tz: "America/New_York", slots: [], business: BIZ, customer: {}, questions: [], language: "en", booking: { slot_date: "2026-10-14", slot_time: "14:00", address: "1 Main St" } };

// routes: { site: fn->{status,body}, lead: fn->{status,body} }
function boot(opts) {
  const els = {};
  const mk = (id) => els[id] || (els[id] = { id, innerHTML: "", textContent: "", value: "", disabled: false, focus() {}, classList: { toggle() {}, contains() { return false; } }, querySelectorAll() { return []; }, style: {} });
  const store = opts.store || {};
  const urls = [];
  const bar = { search: opts.search || "", pathname: "/book.html" };
  const ctx = {
    console: { log() {}, error() {} }, Date, Intl, Math, JSON, String, Number, Object, Array, RegExp, encodeURIComponent, setTimeout, Promise, Error,
    window: { location: bar, scrollTo() {}, DOC_PAGE_LINK: opts.doc || undefined, sessionStorage: { getItem(k) { return k in store ? store[k] : null; }, setItem(k, v) { store[k] = String(v); }, removeItem(k) { delete store[k]; } } },
    document: { documentElement: { style: { setProperty() {} } }, getElementById: mk },
    history: { replaceState(a, b, u) { bar.search = u.slice(u.indexOf("?")); } },
    fetch: (url, o) => {
      urls.push(url);
      const r = url.indexOf("/lead/") >= 0 ? opts.lead : opts.site;
      const x = r ? r(url, o) : { status: 404, body: {} };
      return Promise.resolve({ ok: x.status === 200, status: x.status, json: () => Promise.resolve(x.body) });
    }
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return { ctx, els, store, urls, bar, run: (s) => vm.runInContext(s, ctx), start: async () => { ctx.window.onload(); await tick(); } };
}
const doc = { kind: "booking-site", token: SLUG };
const text = (p, id) => flat(p.els[id].innerHTML);

// 1. book from the general link (readable address), cancel, reload -> the form
{
  // book from the general link, cancel, reload
  let cancelled = false;
  const p = boot({ doc, site: () => ({ status: 200, body: FORM }), lead: () => (cancelled ? { status: 404, body: {} } : { status: 200, body: BOOKED }) });
  await p.start();
  p.run('afterBooked({ token: "' + TOK + '", booking: {} })'); await tick();
  p.ctx.postJson = function() { cancelled = true; return Promise.resolve({ status: 200 }); };
  p.run("doCancel()"); await tick();
  const c = text(p, "stepDone");
  ok(c.includes("Your visit is cancelled."), "right after cancel: today's cancelled message");
  ok(c.includes("Book a new visit") && p.els.btnBookNew, "right after cancel: Book a new visit button (general link)");
  ok(!("bk_token_" + SLUG in p.store), "cancel drops the saved token");
  p.run("lang = 'pt'; ");
  // reload in the same tab (same storage) -> the form, not 'no longer active'
  const q = boot({ doc, store: p.store, site: () => ({ status: 200, body: FORM }), lead: () => ({ status: 404, body: {} }) });
  await q.start();
  ok(q.urls.length === 1 && q.urls[0].endsWith("/site/" + SLUG), "reload asks for the general link: " + q.urls.join(","));
  ok(!text(q, "stepInactive").includes("no longer active"), "reload does not say no longer active");
  // the button opens the form
  p.els.btnBookNew.onclick(); await tick();
  ok(p.run("leadToken") === null && p.run("D.kind") === "general", "button loads the general form");
}

// 2. old address ?b=slug: book, cancel, reload -> the form
{
  let cancelled = false;
  const store = {};
  const p = boot({ search: "?b=" + SLUG, store, site: () => ({ status: 200, body: FORM }), lead: () => (cancelled ? { status: 404, body: {} } : { status: 200, body: BOOKED }) });
  await p.start();
  p.run('afterBooked({ token: "' + TOK + '", booking: {} })'); await tick();
  ok(p.bar.search === "?t=" + TOK, "old address keeps the token in the bar after booking");
  // refresh with the live booking
  const live = boot({ search: p.bar.search, store, lead: () => ({ status: 200, body: BOOKED }) });
  await live.start();
  ok(text(live, "stepDone").includes("Your visit is booked!"), "old address refresh with a live booking shows the booking");
  p.ctx.postJson = function() { cancelled = true; return Promise.resolve({ status: 200 }); };
  p.run("doCancel()"); await tick();
  ok(p.bar.search === "?b=" + SLUG, "cancel puts the general address back in the bar");
  ok(text(p, "stepDone").includes("Book a new visit"), "button shown on the old address too");
  const q = boot({ search: p.bar.search, store, site: () => ({ status: 200, body: FORM }), lead: () => ({ status: 404, body: {} }) });
  await q.start();
  ok(q.urls.length === 1 && q.urls[0].endsWith("/site/" + SLUG), "old address reload asks for the general link");
  // a stale ?t= from the same tab (back button) falls back to the form
  const st = boot({ search: "?t=" + TOK, store: { ["bk_site_" + TOK]: SLUG }, site: () => ({ status: 200, body: FORM }), lead: () => ({ status: 404, body: {} }) });
  await st.start();
  ok(st.urls.length === 2 && st.urls[1].endsWith("/site/" + SLUG), "stale token of a general booking falls back to the form");
}

// 3. saved token answers 404 -> the form; inactive -> the form; live -> the booking
{
  const p = boot({ doc, store: { ["bk_token_" + SLUG]: TOK }, site: () => ({ status: 200, body: FORM }), lead: () => ({ status: 404, body: {} }) });
  await p.start();
  ok(p.urls.length === 2 && p.urls[1].endsWith("/site/" + SLUG) && !("bk_token_" + SLUG in p.store), "saved token 404: dropped, general form loaded");
  ok(p.run("D.kind") === "general", "form is on screen state");
  const i = boot({ doc, store: { ["bk_token_" + SLUG]: TOK }, site: () => ({ status: 200, body: FORM }), lead: () => ({ status: 200, body: { active: false, business: BIZ } }) });
  await i.start();
  ok(i.run("D.active") === true && i.run("D.kind") === "general", "saved token answering inactive: general form");
  const l = boot({ doc, store: { ["bk_token_" + SLUG]: TOK }, site: () => ({ status: 200, body: FORM }), lead: () => ({ status: 200, body: BOOKED }) });
  await l.start();
  ok(text(l, "stepDone").includes("Your visit is booked!") && l.urls.length === 1, "saved token with a live booking shows the booking");
}

// 4. lead link (?t=) with a cancelled request: today's inactive screen, no button, no fallback
{
  const p = boot({ search: "?t=" + TOK, lead: () => ({ status: 200, body: { active: false, business: BIZ } }) });
  await p.start();
  ok(text(p, "stepInactive").includes("This link is no longer active."), "lead link cancelled: inactive screen");
  ok(p.urls.length === 1, "lead link: no fallback request");
  const d = boot({ doc: { kind: "booking", token: TOK }, lead: () => ({ status: 404, body: {} }) });
  await d.start();
  ok(text(d, "stepInactive").includes("This link is no longer active.") && d.urls.length === 1, "kind booking, 404: inactive screen, no fallback");
  const b = boot({ doc: { kind: "booking", token: TOK }, lead: () => ({ status: 200, body: BOOKED }) });
  await b.start();
  b.ctx.postJson = function() { return Promise.resolve({ status: 200 }); };
  b.run("doCancel()"); await tick();
  ok(text(b, "stepDone").includes("Your visit is cancelled.") && !text(b, "stepDone").includes("Book a new visit"), "lead link cancel: no Book a new visit button");
}

// 5. truly inactive general link
{
  const p = boot({ doc, site: () => ({ status: 200, body: { active: false, business: BIZ } }) });
  await p.start();
  ok(text(p, "stepInactive").includes("This link is no longer active."), "inactive general link: no longer active");
  const n = boot({ doc, site: () => ({ status: 404, body: {} }) });
  await n.start();
  ok(text(n, "stepInactive").includes("This link is no longer active."), "unknown general link: no longer active");
}

console.log(fail ? "\n" + fail + " FAILED" : "\nall passed");
process.exit(fail ? 1 : 0);
