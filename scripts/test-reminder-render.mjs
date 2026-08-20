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
t("LIRA (in_person, location NULL) -> blocked, no button",
  [d[0].button, d[0].blocked], [null, "Sem endereço cadastrado"]);
t("JM LUXURY POOLS (in_person, location NULL) -> blocked, no button",
  [d[1].button, d[1].blocked], [null, "Sem endereço cadastrado"]);
t("METZ (online_meet, has Meet link) -> live button",
  [d[2].button, d[2].blocked], ["Enviar Lembrete", null]);
t("Jhony e Katia (in_person, HAS address) -> live button",
  [d[3].button, d[3].blocked], ["Enviar Lembrete", null]);

// The link the button opens must carry no phone number.
const b2 = await (async () => {
  const br = await chromium.launch();
  const p  = await br.newPage();
  let opened = null;
  await p.setContent(HARNESS, { waitUntil: "load" });
  await p.evaluate(() => { window.open = url => { window.__opened = url; return {}; }; });
  await p.evaluate(rows => window.__render(rows), ROWS);
  await p.evaluate(() => document.querySelectorAll("button.btn-join-wa")[0].click());
  opened = await p.evaluate(() => window.__opened);
  await br.close();
  return opened;
})();

t("wa.me link carries NO phone number", b2.startsWith("https://wa.me/?text="), true);
console.log("   opened: " + decodeURIComponent(b2));

console.log("\n" + (fails ? fails + " FAILED" : "all checks passed"));
process.exit(fails ? 1 : 0);
