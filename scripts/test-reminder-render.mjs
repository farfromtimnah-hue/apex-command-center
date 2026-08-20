// Renders the dashboard.html Meeting Reminders card in a REAL browser, at a
// desktop width and at an installed-PWA phone width, against the rows that are
// actually in D1 — and asserts that the two viewports produce the SAME markup.
//
//   node scripts/test-reminder-render.mjs
//
// WHY THIS EXISTS
// On 2026-08-20 the card showed "Sem endereco cadastrado" instead of a Send
// Reminder button on the phone, and the report was that the PWA behaved
// differently from desktop. The card's real inputs are session_type and
// location, which come from one API for both — so "different on PWA" is a
// claim that has to be measured, not assumed. This harness measures it: same
// page, same CSS, same rows, two viewports, diff the output.
//
// The real functions are sliced out of dashboard.html and the real <style>
// block is injected, so nothing here re-implements page behavior.
import { readFileSync } from "fs";
import { execSync } from "child_process";

// Playwright may be installed locally or only globally (it is global on the
// build box). Resolve both, and unwrap the CJS default export.
const pw = await (async () => {
  for (const spec of ["playwright", execSync("npm root -g").toString().trim() + "/playwright/index.js"]) {
    try { const m = await import(spec); return m.chromium ? m : m.default; } catch (e) { /* try next */ }
  }
  throw new Error("playwright not found (npm i -D playwright, or install it globally)");
})();
const chromium = pw.chromium;

const page = readFileSync(new URL("../dashboard.html", import.meta.url), "utf8");
const dt   = readFileSync(new URL("../datetime.js", import.meta.url), "utf8");

function slice(src, a, b) {
  const i = src.indexOf(a), j = src.indexOf(b, i);
  if (i < 0 || j < 0) { throw new Error("marker not found: " + a); }
  return src.slice(i, j);
}

const styleBlock = slice(page, "<style>", "</style>").replace("<style>", "");
// Everything from the reminder helpers through the sent-state block.
const reminderJs = slice(page,
  "    function reminderAddDays(",
  "    // ── Scheduling queue");

// The exact rows in D1 for today / tomorrow, read live on 2026-08-20.
const ROWS = [
  { id: "ad6e3e90", client_id: "46ba18b5", client_name: "LIRA OUTDOOR LIVING",
    date: "2026-08-20", time: "13:30", end_time: "15:00",
    session_type: "in_person", meeting_category: "client",
    location: null, google_meet_link: null, reminder_sent_at: null },
  { id: "6a780272", client_id: "cc1b026c", client_name: "JM LUXURY POOLS",
    date: "2026-08-20", time: "16:30", end_time: "19:30",
    session_type: "in_person", meeting_category: "client",
    location: null, google_meet_link: null, reminder_sent_at: null },
  // A control row: same card, an online meeting that HAS its Meet link. If
  // this one renders a button and the two above do not, the differentiator is
  // the data, not the device.
  { id: "control1", client_id: "b4dff5c5", client_name: "METZ (control: online)",
    date: "2026-08-20", time: "20:00", end_time: "21:00",
    session_type: "online_meet", meeting_category: "client",
    location: null, google_meet_link: "https://meet.google.com/gvm-azoo-gyh",
    reminder_sent_at: null },
  // A second control: an in-person row that DOES have an address on file.
  { id: "control2", client_id: null, client_name: "Jhony e Katia (control: address)",
    date: "2026-08-20", time: "10:00", end_time: "11:00",
    session_type: "in_person", meeting_category: "event",
    location: "Starbucks Epperson", google_meet_link: null, reminder_sent_at: null }
];

const HARNESS = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${styleBlock}</style>
<style>.show-en{display:none}</style>
</head><body>
<div class="content-card"><div id="list"></div></div>
<script>${dt}</script>
<script>
function padZ(n) { return n < 10 ? "0" + n : "" + n; }
var dashMessageTemplates = null;
var aliceReminderRows = [];
function attachReminderEditors() {}
function apiFetch() { return Promise.resolve({ ok: true, json: function(){ return {}; } }); }
${reminderJs}
window.__render = function (rows) {
  buildReminderRows(document.getElementById("list"), rows, "hoje");
};
</script></body></html>`;

const VIEWPORTS = [
  { label: "desktop  (1440x900)",         width: 1440, height: 900, dpr: 1, mobile: false },
  { label: "PWA phone (390x844, iPhone)", width: 390,  height: 844, dpr: 3, mobile: true  }
];

let fails = 0;
const t = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { fails++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label +
    (ok ? "" : "\n        expected " + JSON.stringify(expected) + "\n        got      " + JSON.stringify(actual)));
};

const browser = await chromium.launch();
const snapshots = [];

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.dpr,
    isMobile: vp.mobile,
    hasTouch: vp.mobile
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", e => errors.push(String(e)));
  await p.setContent(HARNESS, { waitUntil: "load" });
  await p.evaluate(rows => window.__render(rows), ROWS);

  // What the eye actually sees: per row, is there a live button, and what
  // visible text sits where the button would be.
  const seen = await p.evaluate(() => {
    return Array.from(document.querySelectorAll(".list-row")).map(row => {
      const btn = row.querySelector("button.btn-join-wa");
      const why = row.querySelector(".reminder-blocked");
      const visible = el => {
        if (!el) { return false; }
        const cs = getComputedStyle(el);
        return cs.display !== "none" && cs.visibility !== "hidden" &&
               el.getBoundingClientRect().width > 0;
      };
      return {
        client: row.querySelector(".list-row-main").textContent,
        button: visible(btn) ? btn.innerText.trim() : null,
        blocked: visible(why) ? why.innerText.trim() : null
      };
    });
  });

  console.log("\n--- " + vp.label + " ---");
  for (const r of seen) {
    console.log("   " + r.client.padEnd(34) +
      (r.button ? "[BUTTON: " + r.button + "]" : "[no button]") +
      (r.blocked ? "  msg: " + r.blocked : ""));
  }
  t(vp.label + ": no JS errors", errors, []);
  snapshots.push({ vp: vp.label, seen });
  await ctx.close();
}

await browser.close();

console.log("");
t("desktop and PWA render identically",
  JSON.stringify(snapshots[1].seen), JSON.stringify(snapshots[0].seen));

const d = snapshots[0].seen;
// An in-person meeting with no address is no longer a dead row: it gets a
// live button and is asked for the address on click.
t("LIRA (in_person, location NULL) -> live button",
  [d[0].button, d[0].blocked], ["Enviar Lembrete", null]);
t("JM LUXURY POOLS (in_person, location NULL) -> live button",
  [d[1].button, d[1].blocked], ["Enviar Lembrete", null]);
t("METZ (online_meet, has Meet link) -> live button",
  [d[2].button, d[2].blocked], ["Enviar Lembrete", null]);
t("Jhony e Katia (in_person, HAS address) -> live button",
  [d[3].button, d[3].blocked], ["Enviar Lembrete", null]);

// The one case that still legitimately blocks: Google never returned the Meet
// link, and no amount of typing can supply it.
const pendingRow = await (async () => {
  const br = await chromium.launch();
  const p  = await br.newPage();
  await p.setContent(HARNESS, { waitUntil: "load" });
  await p.evaluate(() => window.__render([{
    id: "pending", client_id: "x", client_name: "PENDING", date: "2026-08-20",
    time: "09:00", end_time: null, session_type: "online_meet",
    meeting_category: "client", location: null,
    google_meet_link: "[PENDING_GOOGLE_API]", reminder_sent_at: null
  }]));
  const r = await p.evaluate(() => {
    const row = document.querySelector(".list-row");
    return {
      button: row.querySelector("button.btn-join-wa") ? "yes" : null,
      blocked: row.querySelector(".reminder-blocked")?.innerText.trim() ?? null
    };
  });
  await br.close();
  return r;
})();
t("[PENDING_GOOGLE_API] still blocks, with the reason",
  pendingRow, { button: null, blocked: "Sem link do Meet ainda" });

// ── Clicking ──────────────────────────────────────────────────────────────
// Drives a real click on one row with window.prompt stubbed to a scripted
// answer, and reports what the tap actually produced: the opened URL, the
// PATCH (if any), and the resulting sent-state.
async function click({ rowIndex, promptAnswer }) {
  const br  = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p   = await ctx.newPage();
  const errors = [];
  p.on("pageerror", e => errors.push(String(e)));
  await p.setContent(HARNESS, { waitUntil: "load" });
  await p.evaluate(ans => {
    window.__opened = null;
    window.__patches = [];
    window.__promptShown = null;
    window.open   = url => { window.__opened = url; return {}; };
    window.prompt = msg => { window.__promptShown = msg; return ans; };
    window.alert  = () => {};
    window.apiFetch = (path, opts) => {
      window.__patches.push({ path, method: (opts || {}).method, body: (opts || {}).body });
      return Promise.resolve({ ok: true, json: () => ({}) });
    };
  }, promptAnswer);
  await p.evaluate(rows => window.__render(rows), ROWS);
  await p.evaluate(i => document.querySelectorAll(".list-row")[i].querySelector("button.btn-join-wa").click(), rowIndex);
  const out = await p.evaluate(i => {
    const btn = document.querySelectorAll(".list-row")[i].querySelector("button.btn-join-wa");
    const calls = window.__patches;
    return {
      opened: window.__opened,
      // Split by intent: the address write, versus the reminder-sent stamp
      // that every successful send makes regardless.
      saves: calls.filter(c => c.method === "PATCH"),
      stamps: calls.filter(c => /\/reminder-sent$/.test(c.path)),
      promptShown: window.__promptShown,
      tplKey: btn.getAttribute("data-tpl-key"),
      sentLook: btn.classList.contains("is-sent")
    };
  }, rowIndex);
  await br.close();
  out.errors = errors;
  return out;
}

console.log("\n--- clicking LIRA (in_person, no address) ---");

const cancelled = await click({ rowIndex: 0, promptAnswer: null });
t("Cancel: nothing opens",        cancelled.opened, null);
t("Cancel: nothing is saved",     cancelled.saves, []);
t("Cancel: nothing is stamped",   cancelled.stamps, []);
t("Cancel: not stamped as sent",  cancelled.sentLook, false);
t("Cancel: no JS errors",         cancelled.errors, []);
console.log("   prompt asked: " + JSON.stringify(cancelled.promptShown));

const bypassed = await click({ rowIndex: 0, promptAnswer: "" });
t("Blank: sends anyway",          bypassed.opened !== null, true);
t("Blank: saves no address",      bypassed.saves, []);
t("Blank: still stamps the send", bypassed.stamps.length, 1);
t("Blank: stamped as sent",       bypassed.sentLook, true);
t("Blank: message has no address sentence and no stray token",
  /endereco|endereço|\{/i.test(decodeURIComponent(bypassed.opened)), false);
console.log("   opened: " + decodeURIComponent(bypassed.opened));

const typed = await click({ rowIndex: 0, promptAnswer: "  1234 Bruce B Downs Blvd, Tampa FL  " });
t("Typed: address is in the message",
  decodeURIComponent(typed.opened).indexOf("1234 Bruce B Downs Blvd, Tampa FL") >= 0, true);
t("Typed: no stray {token} shipped", /\{\w+\}/.test(decodeURIComponent(typed.opened)), false);
// The NARROW route. The calendar's full PATCH /api/sessions/:id refuses
// google_external and manual rows, which is most of this card.
t("Typed: saved, trimmed, to the session's location",
  typed.saves, [{ path: "/api/sessions/ad6e3e90/location", method: "PATCH",
                  body: { location: "1234 Bruce B Downs Blvd, Tampa FL" } }]);
t("Typed: stamps the send exactly once", typed.stamps.length, 1);
t("Typed: pencil follows to the with-address template",
  typed.tplKey, "reminder_in_person");
t("Typed: stamped as sent", typed.sentLook, true);
console.log("   opened: " + decodeURIComponent(typed.opened));

// The online row must not have gained a prompt it never needed.
const online = await click({ rowIndex: 2, promptAnswer: null });
t("Online meeting is never asked for an address", online.promptShown, null);
t("Online meeting still sends on one tap", online.opened !== null, true);

// Every link, on every path, stays a bare wa.me with no phone number.
for (const [label, res] of [["blank", bypassed], ["typed", typed], ["online", online]]) {
  t("wa.me link carries NO phone number (" + label + ")",
    res.opened.startsWith("https://wa.me/?text="), true);
}

// ── The route the address is saved through ────────────────────────────────
// The real handler, eval'd against a recording fake D1. The point of the
// route is that it accepts the rows the calendar's full edit route refuses,
// so those providers are what is actually asserted here.
console.log("\n--- PATCH /api/sessions/:id/location ---");
{
  const worker = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
  const src = slice(worker, "async function handlePatchSessionLocation", "\n// ---");

  let writes;
  const fakeDb = row => ({
    prepare(sql) {
      return {
        bind(...binds) {
          return {
            first: async () => (/SELECT id FROM sessions/.test(sql) ? row : null),
            run:   async () => { writes.push({ sql: sql.replace(/\s+/g, " "), binds }); return {}; }
          };
        }
      };
    }
  });

  const sandbox = {
    authenticate: async () => ({ role: "alice" }),
    jsonErr: (msg, status) => ({ __err: msg, status }),
    jsonOk:  obj => ({ __ok: obj, status: 200 })
  };
  const handler = new Function(
    "authenticate", "jsonErr", "jsonOk",
    src + "; return handlePatchSessionLocation;"
  )(sandbox.authenticate, sandbox.jsonErr, sandbox.jsonOk);

  const call = async (body, row) => {
    writes = [];
    const res = await handler("sess-1", { json: async () => body }, { DB: fakeDb(row) });
    return { res, writes };
  };

  // Every provider the reminder card can show. The full edit route rejects
  // the last two outright; this one must not.
  for (const provider of ["apex", "google_external", "manual"]) {
    const { res, writes: w } = await call({ location: "  55 Main St, Tampa FL  " }, { id: "sess-1", calendar_provider: provider });
    t("saves on calendar_provider=" + provider, res.__ok, { location: "55 Main St, Tampa FL" });
    t("  writes location once (" + provider + ")",
      w, [{ sql: "UPDATE sessions SET location = ? WHERE id = ?", binds: ["55 Main St, Tampa FL", "sess-1"] }]);
  }

  const blank = await call({ location: "   " }, { id: "sess-1" });
  t("blank is refused, not treated as a clear", blank.res.status, 400);
  t("  and writes nothing", blank.writes, []);

  const wrongType = await call({ location: 42 }, { id: "sess-1" });
  t("non-string is refused", wrongType.res.status, 400);

  const missing = await call({ location: "55 Main St" }, null);
  t("unknown session is a 404", missing.res.status, 404);
  t("  and writes nothing", missing.writes, []);

  const long = await call({ location: "x".repeat(2000) }, { id: "sess-1" });
  t("over-long address is truncated, not rejected", long.res.__ok.location.length, 1024);
}

console.log("\n" + (fails ? fails + " FAILED" : "all checks passed"));
process.exit(fails ? 1 : 0);
