// Staff phone dock (job K, 10/04/2026): no "Mais". Five spots for every staff
// role: Home, Clients, Agenda, one direct link, Business. A spot is a direct
// link or a group whose tools pop up above the dock. Settings sits behind a
// gear in the page header.
//
// This file pins the layout per role, that nothing is listed twice, that every
// page exists, and that the dock nav.js actually renders has no "Mais" in it.
// Runs with node, no network: nav.js is evaluated against a small fake page.
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const src = readFileSync(new URL("nav.js", root), "utf8");

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };
const eq = (got, want, m) =>
  ok(JSON.stringify(got) === JSON.stringify(want),
     m + (JSON.stringify(got) === JSON.stringify(want) ? "" :
       `\n        want ${JSON.stringify(want)}\n        got  ${JSON.stringify(got)}`));

// ---- a fake page: just enough DOM for initNav() ----
function fakeEl(id) {
  const attrs = {};
  const classes = new Set();
  return {
    id: id || "", innerHTML: "", textContent: "", href: "", style: {}, children: [], parentNode: null,
    get className() { return [...classes].join(" "); },
    set className(v) { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => classes.add(c)); },
    classList: {
      add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c)
    },
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return k in attrs ? attrs[k] : null; },
    removeAttribute(k) { delete attrs[k]; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    insertBefore(c, ref) { c.parentNode = this; this.children.splice(this.children.indexOf(ref), 0, c); return c; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {}
  };
}
let els, keyHandlers, page;
const session = {};
function freshPage(file) {
  page = file;
  els = {};
  ["navSidebar", "mobile-tab-bar", "mobile-more-menu", "appHeader"].forEach(id => { els[id] = fakeEl(id); });
  // The header as every staff page has it: .header-right holding the EN/PT button.
  const right = fakeEl(), lang = fakeEl();
  right.appendChild(lang);
  right.querySelector = sel => (sel === ".lang-btn" ? lang : null);
  els.appHeader.querySelector = sel => (sel === ".header-right" ? right : null);
  els.headerRight = right;
  // The pop-up's panel, which nav.js looks up inside #mobile-more-menu.
  const panel = fakeEl();
  els["mobile-more-menu"].querySelector = sel => (sel === ".mg-panel" ? panel : null);
  els.panel = panel;
}
keyHandlers = [];
globalThis.sessionStorage = {
  getItem: k => (k in session ? session[k] : null),
  setItem: (k, v) => { session[k] = String(v); },
  removeItem: k => { delete session[k]; }
};
globalThis.document = {
  body: fakeEl("body"), head: fakeEl("head"),
  getElementById: id => {
    if (id === "apexNavGear") { return els.headerRight.children.find(c => c.id === "apexNavGear") || null; }
    return els[id] || null;
  },
  createElement: () => fakeEl(),
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: (type, fn) => { if (type === "keydown") { keyHandlers.push(fn); } }
};
globalThis.window = globalThis;
globalThis.location = { get pathname() { return "/" + page; }, href: "" };
const store = {};
let storeBroken = false;
globalThis.localStorage = {
  getItem: k => { if (storeBroken) { throw new Error("no storage"); } return k in store ? store[k] : null; },
  setItem: (k, v) => { if (storeBroken) { throw new Error("no storage"); } store[k] = String(v); }
};
freshPage("dashboard.html");
(0, eval)(src);

const cfgFor = (role, review) => window.apexStaffDockConfig(role, { contractReview: review });
const shape = cfg => cfg.spots.map(s => (s.group ? [s.key, s.items.map(i => i.href)] : s.href));
const pages = cfg => cfg.spots.flatMap(s => (s.group ? s.items : [s]));
const signIn = (role, view, released) => {
  for (const k of Object.keys(session)) { delete session[k]; }
  session.apex_role = role;
  if (view) { session.apex_dev_view = view; }
  if (released) { session.apex_contract_review_released = "1"; }
};

// ---- the layout, per role (contract review switched on) ----
const WANT = {
  alice: [
    "dashboard.html",
    ["clients", ["clients.html", "client-analytics.html", "contract-review.html"]],
    ["agenda", ["calendar.html", "sessions.html", "tasks.html"]],
    "finance-new.html",
    ["business", ["sales.html", "documents.html"]]
  ],
  rafa: [
    "dashboard.html",
    ["clients", ["clients.html", "client-analytics.html", "contract-review.html"]],
    ["agenda", ["sessions.html", "calendar.html"]],
    "tasks.html",
    ["business", ["sales.html", "finance-new.html", "documents.html"]]
  ],
  developer: [
    "dashboard.html",
    ["clients", ["clients.html", "client-analytics.html", "contract-review.html", "add-user.html"]],
    ["agenda", ["calendar.html", "sessions.html", "tasks.html"]],
    "finance-new.html",
    ["business", ["sales.html", "documents.html"]]
  ]
};

for (const role of ["alice", "rafa", "developer"]) {
  const cfg = cfgFor(role, true);
  eq(cfg.spots.length, 5, role + ": exactly five spots");
  eq(shape(cfg), WANT[role], role + ": Home, Clients, Agenda, the fifth spot, Business, each group in its fixed order");
  eq(cfg.spots.map(s => !!s.group), [false, true, true, false, true], role + ": spots 2, 3 and 5 are groups, 1 and 4 are direct links");
  const hrefs = pages(cfg).map(p => p.href);
  eq(hrefs.length, new Set(hrefs).size, role + ": no destination appears twice");
  ok(!("more" in cfg) && !cfg.spots.some(s => s.key === "more" || s.icon === "more" || /Mais|More/.test(s.labelPt + s.labelEn)),
     role + ": no More spot and no more list in the config");
  const missing = hrefs.concat(cfg.gear.href).filter(h => !existsSync(new URL(h, root)));
  eq(missing, [], role + ": every destination's page file exists");
  ok(!hrefs.includes("settings.html"), role + ": Settings is not on the dock");
  eq(cfg.gear.href, "settings.html", role + ": Settings is behind the gear");
  ok(cfg.spots.concat(pages(cfg)).every(s => s.labelPt && s.labelEn && s.icon), role + ": every spot and tool has PT + EN labels and an icon");
  ok(cfg.spots.concat(pages(cfg)).every(s => !/[^\x00-\x7F]/.test(s.labelPt + s.labelEn)), role + ": labels are plain ASCII (entities for accents)");
}
const groupsOf = cfg => cfg.spots.filter(s => s.group).map(s => [s.labelPt, s.labelEn, s.icon]);
eq(groupsOf(cfgFor("alice", true)),
   [["Clientes", "Clients", "users"], ["Agenda", "Agenda", "calendar"], ["Neg&oacute;cio", "Business", "briefcase"]],
   "group labels and icons: Clientes/Clients, Agenda/Agenda, Negocio/Business");
eq(shape(cfgFor("alice", false))[1], ["clients", ["clients.html", "client-analytics.html"]],
   "contract review switched off: the Clients group simply has no such item");
eq(shape(cfgFor("something-else", true)), WANT.alice, "an unknown role falls back to the alice layout, as before");

// ---- what nav.js really puts on the page ----
const dock = () => els["mobile-tab-bar"].innerHTML;
const tabs = () => dock().match(/class="m-tab[ "]/g) || [];
for (const [role, view] of [["alice"], ["rafa"], ["developer"], ["developer", "alice"], ["developer", "rafa"]]) {
  const who = role + (view ? " previewing " + view : "");
  signIn(role, view, true);
  freshPage("dashboard.html");
  window.initNav();
  eq(tabs().length, 5, who + ": the rendered dock has five tabs");
  ok(!/Mais|More|mTabMais|apexMoreToggle/.test(dock() + els["mobile-more-menu"].innerHTML), who + ": no More button or More menu rendered");
  ok(!/settings\.html/.test(dock()), who + ": no Settings tab rendered");
  eq((dock().match(/data-dock-group="[a-z]+"/g) || []), ['data-dock-group="clients"', 'data-dock-group="agenda"', 'data-dock-group="business"'], who + ": three group buttons, in order");
  const gear = document.getElementById("apexNavGear");
  ok(!!gear && gear.href === "settings.html" && gear.parentNode === els.headerRight && els.headerRight.children.indexOf(gear) === 0,
     who + ": the gear to settings.html is inside the header, before the language button");
  ok(document.body.children.every(c => c.id !== "apexNavGear"), who + ": nothing was appended to <body>");
}
ok(typeof window.apexMoreToggle === "undefined", "apexMoreToggle is gone");

// ---- contract review follows the desktop side menu's gate ----
const hasReview = () => { window.apexDockGroupToggle("clients"); return /contract-review\.html/.test(els.panel.innerHTML); };
const sideHasReview = () => /contract-review\.html/.test(els.navSidebar.innerHTML);
for (const [role, view, released, want] of [
  ["alice", null, true, false], ["rafa", null, false, false], ["rafa", null, true, true],
  ["developer", null, false, true], ["developer", "alice", true, false], ["developer", "rafa", false, false]
]) {
  signIn(role, view, released);
  freshPage("dashboard.html");
  window.initNav();
  const got = hasReview();
  ok(got === want && got === sideHasReview(),
     role + (view ? " previewing " + view : "") + (released ? " (released)" : " (not released)") +
     ": contract review " + (want ? "listed" : "not listed") + " on the phone, same as the side menu");
}

// ---- the pop-up ----
signIn("rafa", null, true);
freshPage("sessions.html");
window.initNav();
const menu = els["mobile-more-menu"];
ok(/class="m-tab m-tab-active" data-dock-group="agenda"/.test(dock()), "a group is active when the page is one of its tools");
eq((dock().match(/m-tab-active/g) || []).length, 1, "…and only that spot is active");
ok(!menu.classList.contains("mg-open"), "no menu is open until a group is tapped");
window.apexDockGroupToggle("agenda");
ok(menu.classList.contains("mg-open") && menu.getAttribute("data-group") === "agenda", "tapping a group opens its menu");
eq((els.panel.innerHTML.match(/href="[^"]+"/g) || []), ['href="sessions.html"', 'href="calendar.html"'], "the menu lists the group's tools in the fixed order");
ok(/class="mg-item mg-item-active" role="menuitem" href="sessions.html"/.test(els.panel.innerHTML) &&
   (els.panel.innerHTML.match(/mg-item-active/g) || []).length === 1, "the item for the page you are on is highlighted");
ok(!/mg-switcher/.test(els.panel.innerHTML), "no DEV switcher for rafa");
window.apexDockGroupToggle("business");
ok(menu.classList.contains("mg-open") && menu.getAttribute("data-group") === "business" &&
   /sales\.html/.test(els.panel.innerHTML) && !/sessions\.html/.test(els.panel.innerHTML), "tapping another group swaps the one menu");
window.apexDockGroupToggle("business");
ok(!menu.classList.contains("mg-open"), "tapping the same group again closes it");
window.apexDockGroupToggle("clients");
ok(/onclick="apexDockGroupClose\(\)"/.test(menu.innerHTML), "the backdrop closes the menu (tap outside)");
eq(keyHandlers.length, 1, "one Escape listener, however many times the nav is rebuilt");
keyHandlers[0]({ key: "Escape" });
ok(!menu.classList.contains("mg-open"), "Escape closes it");

signIn("developer", "rafa", false);
freshPage("dashboard.html");
window.initNav();
window.apexDockGroupToggle("business");
eq((els.panel.innerHTML.match(/apexNavSetView\('[a-z]+'\)/g) || []),
   ["apexNavSetView('alice')", "apexNavSetView('rafa')", "apexNavSetView('dev')", "apexNavSetView('client')", "apexNavSetView('seller')"],
   "a developer keeps the DEV switcher on the phone, even while previewing rafa");

// ---- the tool used last, same rule as the client portal ----
// The portal: a group with several tools always pops its menu; a group opens
// on its own only when it has one tool or the pop-up cannot be shown, and then
// it lands on the tool used last (first tool if none).
for (const k of Object.keys(store)) { delete store[k]; }
const visit = (role, file, view) => { signIn(role, view, true); freshPage(file); window.initNav(); };
const tapWithoutPopup = group => {
  els["mobile-more-menu"].querySelector = () => null;
  location.href = "";
  window.apexDockGroupToggle(group);
  return location.href;
};
visit("rafa", "dashboard.html");
eq(store, {}, "a page outside every group remembers nothing");
eq(tapWithoutPopup("business"), "sales.html", "a group opens its first tool the first time");
visit("rafa", "finance-new.html");
eq(store, { apex_staff_nav_last_rafa_business: "financenew" }, "opening a tool remembers it for its group, per role");
visit("rafa", "dashboard.html");
location.href = "";
window.apexDockGroupToggle("business");
ok(menu !== els["mobile-more-menu"] && els["mobile-more-menu"].classList.contains("mg-open") && location.href === "",
   "with a tool remembered, tapping the group still pops the menu and does not navigate (as the portal does)");
eq((els.panel.innerHTML.match(/href="[^"]+"/g) || []), ['href="sales.html"', 'href="finance-new.html"', 'href="documents.html"'],
   "…and the menu order does not move");
eq(tapWithoutPopup("business"), "finance-new.html", "…and the tool used last is where the group lands when it opens on its own");
eq(tapWithoutPopup("agenda"), "sessions.html", "one group's memory does not touch another group");
visit("alice", "tasks.html");
eq(store, { apex_staff_nav_last_rafa_business: "financenew", apex_staff_nav_last_alice_agenda: "tasks" }, "each role keeps its own memory");
visit("alice", "finance-new.html");
eq(Object.keys(store).length, 2, "a direct spot (alice's Financial) is not a group and remembers nothing");
visit("developer", "calendar.html", "rafa");
eq(store.apex_staff_nav_last_rafa_agenda, "calendar", "a developer previewing rafa writes to rafa's memory, not the developer's");
store.apex_staff_nav_last_alice_agenda = "financenew";
visit("alice", "dashboard.html");
eq(tapWithoutPopup("agenda"), "calendar.html", "a remembered tool that is not in the group falls back to the first tool");
storeBroken = true;
visit("rafa", "finance-new.html");
eq(tapWithoutPopup("business"), "sales.html", "storage unavailable: nothing breaks, the group opens its first tool");
storeBroken = false;

console.log(fail ? `\n❌ ${fail} FAILED` : "\n✅ STAFF DOCK CONSISTENT");
process.exit(fail ? 1 : 0);
