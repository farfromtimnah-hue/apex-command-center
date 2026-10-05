// The staff client page: five groups, one group on screen with all of its
// sections, a menu that jumps to a section, a short hero, tasks grouped by
// session. Reads client.html (and its iOS copy) as text, and runs the page's
// own group and task functions against a tiny stand-in page.
// No network, no browser, writes nothing.
//
//   node scripts/test-client-page-groups.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) { fail++; } };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const WANT = {
  overview: ["leadPipeline", "overview", "contacts", "notes", "portalAccess", "sellerLogins"],
  apexwork: ["sessions", "clientTasks", "consultantTasks", "assessments", "resources", "docs"],
  results:  ["growth", "weeklySummary", "dp"],
  business: ["gmcrm", "gmestimates", "gmjobs", "gmpricing", "gmfinance"],
  money:    ["apexContract", "contractStatus", "invoices", "payment", "vendors"]
};
const ORDER_RAFA  = ["overview", "apexwork", "results", "business", "money"];
const ORDER_OTHER = ["overview", "money", "apexwork", "results", "business"];
const MOVED = ["btnHeroLogo", "btnNewSession", "btnScheduleSession", "btnHeaderPdf",
  "btnAttachResource", "btnViewPortal", "btnClientAnalytics"];

function count(hay, needle) { return hay.split(needle).length - 1; }

// The source between two markers that are each on the page exactly once.
function slice(src, from, to) {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  if (a === -1 || b === -1) { throw new Error("marker not found: " + from + " .. " + to); }
  return src.slice(a, b);
}

// A stand-in element: just enough of a DOM node for the group code to move
// cards around.
function makeEl(id) {
  const cls = new Set();
  const attrs = {};
  const el = {
    id: id || "", hidden: false, parentNode: null, children: [], className: "", style: {}, scrolls: [],
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) },
    setAttribute(k, v) { attrs[k] = String(v); }, getAttribute(k) { return k in attrs ? attrs[k] : null; },
    querySelector: () => null,
    removeChild(c) { const i = el.children.indexOf(c); if (i !== -1) { el.children.splice(i, 1); c.parentNode = null; } return c; },
    appendChild(c) { if (c.parentNode) { c.parentNode.removeChild(c); } el.children.push(c); c.parentNode = el; return c; },
    insertBefore(c, ref) {
      if (c.parentNode) { c.parentNode.removeChild(c); }
      const i = ref ? el.children.indexOf(ref) : -1;
      if (i === -1) { el.children.push(c); } else { el.children.splice(i, 0, c); }
      c.parentNode = el; return c;
    },
    scrollIntoView(o) { el.scrolls.push(o); },
    getBoundingClientRect() { return { bottom: 0, left: 0 }; }
  };
  let html = "";
  Object.defineProperty(el, "innerHTML", { get: () => html, set: (v) => { html = v; if (v === "") { el.children.slice().forEach((c) => el.removeChild(c)); } } });
  Object.defineProperty(el, "firstChild", { get: () => el.children[0] || null });
  Object.defineProperty(el, "nextSibling", { get: () => { const sib = el.parentNode ? el.parentNode.children : []; return sib[sib.indexOf(el) + 1] || null; } });
  return el;
}

// A stand-in page: the section cards in the page's own two columns, the
// group bar, the menu and the stage the group on screen is laid out in.
function makePage(src, opts) {
  const els = {};
  const list = els.sectionsList = makeEl("sectionsList");
  const side = makeEl("colSide");
  const endOfList = src.indexOf("<!-- /sectionsList -->");
  [...src.matchAll(/id="(sec-[A-Za-z]+)"([^>]*)>/g)].forEach((m) => {
    const card = els[m[1]] = makeEl(m[1]);
    card.hidden = /\shidden\b/.test(m[2]);
    (m.index < endOfList ? list : side).appendChild(card);
  });
  ["cgBar", "cgSheet", "cgPanel", "cgStage"].forEach((id) => { els[id] = makeEl(id); });
  els.cgBar.hidden = true; els.cgSheet.hidden = true;
  if (opts.prepStrip) { els.prepReturn = makeEl("prepReturn"); els.prepReturn.offsetHeight = opts.prepStrip; }
  const store = Object.assign({}, opts.session || {});
  const calls = [];
  const timers = [];
  const heard = {};
  const win = { addEventListener(type, fn) { (heard[type] = heard[type] || []).push(fn); }, innerWidth: 1200, innerHeight: 800, matchMedia: () => ({ matches: !!opts.phone }) };
  if (opts.track === "ok")    { win.apexTrack = (control, clientId) => { calls.push([control, clientId]); }; }
  if (opts.track === "throw") { win.apexTrack = () => { throw new Error("counter is down"); }; }
  const ctx = {
    window: win, CLIENT_ID: "client-1", DEEP_SECTION: null, encodeURIComponent,
    setTimeout: (fn) => { timers.push(fn); },
    sessionStorage: { getItem: (k) => (k in store ? store[k] : null) },
    document: {
      body: {}, addEventListener() {},
      createElement: () => makeEl(""),
      getElementById: (id) => els[id] || null,
      querySelector: () => ({ classList: { add() {} } })
    }
  };
  vm.createContext(ctx);
  vm.runInContext(slice(src, "    var CG_GROUPS = [", "    // ── Digital Presence"), ctx);
  const cards = () => Object.keys(els).filter((k) => k.indexOf("sec-") === 0);
  const showing = (el) => !el.classList.contains("cg-off") && !el.hidden;
  const name = (el) => el.id.slice(4);
  // The stage, row by row: a name for a full-width section, [left, right] for a row of two columns.
  const layout = () => els.cgStage.children.map((c) => (c.className === "cg-row-two" ? c.children.map((col) => col.children.filter(showing).map(name)) : name(c)));
  // The sections on screen, in reading order: down the stage, left column first.
  const onScreen = () => layout().flat(2);
  const inStage = (el) => { for (let n = el.parentNode; n; n = n.parentNode) { if (n === els.cgStage) { return true; } } return false; };
  // A card that shows without being part of the group on screen.
  const strays = () => cards().filter((k) => showing(els[k]) && !inStage(els[k]));
  const home = () => [list.children.filter((c) => c.id).map((c) => c.id), side.children.filter((c) => c.id).map((c) => c.id)];
  const fire = (type) => (heard[type] || []).forEach((fn) => fn({}));
  const runTimers = () => { timers.splice(0).forEach((fn) => fn()); };
  return { ctx, els, calls, onScreen, layout, strays, home, fire, runTimers, run: (code) => vm.runInContext(code, ctx) };
}

function checkCopy(label, path) {
  const src = readFileSync(new URL(path, root), "utf8");

  // ── The 25 sections and their groups ─────────────────────────────────────
  const onPage = [...src.matchAll(/id="sec-([A-Za-z]+)"/g)].map((m) => m[1]);
  ok(onPage.length === 25 && new Set(onPage).size === 25, label + ": the page has 25 section cards, each id once (" + onPage.length + ")");

  const page = makePage(src, { session: { apex_role: "alice" } });
  const groups = page.run("CG_GROUPS");
  const placed = {};
  groups.forEach((g) => g.sections.forEach((n) => { placed[n] = (placed[n] || []).concat(g.key); }));
  ok(onPage.every((n) => (placed[n] || []).length === 1), label + ": every section card is in exactly one group");
  ok(Object.keys(placed).every((n) => onPage.indexOf(n) !== -1), label + ": no group names a section that is not on the page");
  Object.keys(WANT).forEach((k) => {
    const g = groups.filter((x) => x.key === k)[0];
    ok(!!g && same(Array.from(g.sections), WANT[k]), label + ": group " + k + " lists " + WANT[k].join(", "));
  });
  ok(groups.filter((g) => g.analyticsLink).map((g) => g.key).join() === "results", label + ": the Client Analytics link is in Results only");
  ok(groups.every((g) => g.pt && g.en && g.shortPt && g.shortEn && g.icon), label + ": every group has an icon, a Portuguese and an English name, and a short name for the phone");
  ok(/client-analytics\.html\?client=' \+\s*encodeURIComponent\(CLIENT_ID/.test(src), label + ": the Client Analytics link opens client-analytics.html for this client");

  // ── The rename ───────────────────────────────────────────────────────────
  const biz = groups.filter((x) => x.key === "business")[0];
  ok(biz.en === "Client tools" && biz.pt === "Ferramentas do cliente" && biz.shortEn === "Tools" && biz.shortPt === "Ferram.", label + ": the gm group is Client tools / Ferramentas do cliente (Tools / Ferram. on a phone), still filed as business");
  ok(!/Their business|Neg(ó|\\u00f3)cio do cliente/.test(src), label + ": the old name Their business / Negócio do cliente is nowhere on the page");

  // ── Order of the group buttons, by role ──────────────────────────────────
  const orderFor = (session) => Array.from(makePage(src, { session }).run("cgGroupOrder()"));
  ok(same(orderFor({ apex_role: "rafa" }), ORDER_RAFA), label + ": rafa sees Overview, Apex work, Results, Client tools, Money");
  ok(same(orderFor({ apex_role: "alice" }), ORDER_OTHER), label + ": alice sees Overview, Money, Apex work, Results, Client tools");
  ok(same(orderFor({ apex_role: "developer" }), ORDER_OTHER), label + ": developer sees the same order as alice");
  ok(same(orderFor({ apex_role: "developer", apex_dev_view: "rafa" }), ORDER_RAFA), label + ": developer previewing rafa sees rafa's order");
  ok(same(orderFor({ apex_role: "developer", apex_dev_view: "alice" }), ORDER_OTHER), label + ": developer previewing alice sees alice's order");
  ok(same(orderFor({ apex_role: "rafa", apex_dev_view: "alice" }), ORDER_RAFA), label + ": the role switcher's value is ignored for anyone but the developer");

  // ── A group shows all its sections: an ordinary client ───────────────────
  const homeBefore = page.home();
  page.run("cgInit()");
  const menu = (p, key) => Array.from(p.run("cgGroupSections(cgGroupByKey('" + key + "'))"));
  ok(same(page.onScreen(), ["overview", "contacts", "notes", "portalAccess", "sellerLogins"]) && page.strays().length === 0, label + ": the page opens on Overview: overview, contacts, notes, Client Portal and Salesperson Logins together, nothing else (" + page.onScreen().join(", ") + ")");
  ok(same(page.layout(), [[["overview", "contacts", "notes"], ["portalAccess", "sellerLogins"]]]), label + ": Overview is two columns, read down the left one first");
  ok(page.els.cgBar.hidden === false && count(page.els.cgBar.innerHTML, "cg-tab-long") === 5, label + ": five group buttons are drawn");
  ok(/class="cg-tab active" onclick="cgGroupTap\('overview'/.test(page.els.cgBar.innerHTML) && count(page.els.cgBar.innerHTML, "cg-tab active") === 1, label + ": the group on screen is the one active button");
  ok(same(menu(page, "overview"), WANT.overview.slice(1)), label + ": a client's Overview has no Lead Pipeline");
  let allGroups = true;
  ORDER_RAFA.forEach((k) => {
    page.run("cgShowGroup('" + k + "', true)");
    if (!same(page.onScreen(), menu(page, k)) || page.strays().length || !menu(page, k).length) { allGroups = false; }
  });
  ok(allGroups, label + ": each group shows every one of its visible sections, in the group's order, and no section of another group");
  page.run("cgShowGroup('apexwork', true)");
  ok(same(page.onScreen(), WANT.apexwork) && same(page.layout(), [[WANT.apexwork.slice(0, 3), WANT.apexwork.slice(3)]]), label + ": Apex work shows its six sections, three down each column");
  page.run("cgShowGroup('results', true)");
  ok(same(page.layout(), [[["growth", "weeklySummary"], ["dp"]]]), label + ": Results (three sections) is two columns");
  page.run("cgShowGroup('business', true)");
  ok(same(page.layout(), WANT.business), label + ": the five gm sections each span the full width, in order");
  page.run("cgShowGroup('money', true)");
  ok(same(page.onScreen(), ["invoices", "payment", "vendors"]), label + ": cards the page keeps hidden (APEX Contract, Contract status) are not on screen or in the Money menu");
  page.els["sec-vendors"].hidden = true;
  page.run("cgApply()");
  ok(same(page.layout(), ["invoices", "payment"]), label + ": a group with fewer than three sections on screen stays one column");
  page.els["sec-vendors"].hidden = false;
  page.els["sec-apexContract"].hidden = false;
  page.els["sec-contractStatus"].hidden = false;
  page.run("cgApply()");
  ok(same(page.onScreen(), WANT.money) && same(menu(page, "money"), WANT.money) && page.strays().length === 0, label + ": once shown, APEX Contract and Contract status join Money on screen and in its menu, in order");
  const rowBefore = page.els.cgStage.children[0];
  page.run("cgApply(); cgApply();");
  ok(page.els.cgStage.children[0] === rowBefore && page.els.cgStage.children.length === 1, label + ": drawing the same group again moves nothing");
  ok(page.run("cgShow('nope', true)") === false && page.run("cgShowGroup('nope', true)") === false && page.run("cgGroup") === "money", label + ": a name that is not a section or a group changes nothing");
  page.run("cgShow('gmpricing', false)");
  ok(/class="cg-tab active" onclick="cgGroupTap\('business'/.test(page.els.cgBar.innerHTML) && same(page.onScreen(), WANT.business), label + ": asking for Pricing opens Client tools, all five sections");

  // ── Printing ─────────────────────────────────────────────────────────────
  page.els["sec-apexContract"].hidden = true;
  page.els["sec-contractStatus"].hidden = true;
  page.fire("beforeprint");
  ok(same(page.home(), homeBefore) && page.els.cgStage.children.length === 0, label + ": before printing every card is back in the page's own two columns, in its usual place");
  page.fire("afterprint");
  ok(same(page.onScreen(), WANT.business) && page.strays().length === 0, label + ": after printing the group is on screen again");
  ok(/@media screen \{\s*\.content-card\.cg-off \{ display: none !important; \}/.test(src), label + ": sections are hidden on screen only, so a printed page still shows every section");

  // ── A group button: the group and its menu in one tap ────────────────────
  const tap = makePage(src, { session: { apex_role: "alice" }, track: "ok" });
  tap.run("cgInit()");
  tap.run("cgGroupTap('business', { getBoundingClientRect: function() { return { bottom: 100, left: 1150 }; } })");
  ok(tap.run("cgGroup") === "business" && same(tap.onScreen(), WANT.business) && tap.els.cgSheet.hidden === false && tap.els.cgSheet.getAttribute("data-group") === "business", label + ": one tap on a group button puts the group on screen and opens its menu");
  ok(tap.els.cgBar.scrolls.length === 1 && tap.els.cgBar.scrolls[0].block === "start", label + ": opening a group scrolls to the top of the group");
  ok(tap.els.cgPanel.style.left === "930px" && tap.els.cgPanel.style.top === "106px", label + ": a desktop drop-down near the right edge is pulled back inside the window");
  ok(count(tap.els.cgPanel.innerHTML, "cgSheetGo(") === 5 && count(tap.els.cgPanel.innerHTML, "cg-item active") === 0 && WANT.business.every((n) => tap.els.cgPanel.innerHTML.indexOf("cgSheetGo('" + n + "')") !== -1), label + ": the menu lists the group's five sections, none marked as the only one showing");
  tap.fire("scroll");
  ok(tap.els.cgSheet.hidden === false, label + ": the page settling right after a group opens does not close its menu");
  tap.run("cgGroupTap('business', null)");
  ok(tap.els.cgSheet.hidden === true && tap.run("cgGroup") === "business" && same(tap.onScreen(), WANT.business), label + ": tapping the active group's button again closes the menu and leaves the group");
  tap.run("cgGroupTap('business', null)");
  ok(tap.els.cgSheet.hidden === false && tap.els.cgBar.scrolls.length === 1, label + ": and once more opens it again, without scrolling");
  tap.run("cgSheetOpenedAt = 0");
  tap.els.cgSheet.classList.add("cg-dropdown");
  tap.fire("scroll");
  ok(tap.els.cgSheet.hidden === true, label + ": scrolling the page later closes a drop-down");
  tap.run("cgGroupTap('results', null)");
  ok(count(tap.els.cgPanel.innerHTML, 'id="btnClientAnalytics"') === 1 && count(tap.els.cgPanel.innerHTML, "cgSheetGo(") === 3, label + ": the Results menu lists its three sections and the Client Analytics link");

  // ── A menu item jumps to its section ─────────────────────────────────────
  const dp = tap.els["sec-dp"];
  tap.run("cgSheetGo('dp')");
  ok(tap.els.cgSheet.hidden === true && same(tap.onScreen(), WANT.results), label + ": choosing a section closes the menu and leaves the whole group on screen");
  ok(dp.scrolls.length === 1 && dp.scrolls[0].block === "start" && dp.style.scrollMarginTop === "12px", label + ": the chosen section is scrolled to the top of the screen, its header showing");
  ok(dp.style.backgroundColor === "var(--gold-dim)", label + ": the chosen section flashes");
  tap.runTimers();
  ok(dp.style.backgroundColor === "", label + ": and the flash clears");
  ok(tap.els["sec-growth"].scrolls.length === 0, label + ": no other section is scrolled to");
  tap.run("cgSheetGo('payment')");
  ok(tap.run("cgGroup") === "money" && tap.els["sec-payment"].scrolls.length === 1, label + ": a section of another group opens that group and jumps to it");
  const strip = makePage(src, { session: { apex_role: "rafa" }, prepStrip: 44 });
  strip.run("cgInit(); cgSheetGo('notes');");
  ok(strip.els["sec-notes"].style.scrollMarginTop === "56px", label + ": with the back-to-meeting-prep strip stuck to the top, the section lands below it");
  ok(/function scrollToSection\(elId\) \{[\s\S]{0,400}cgShowForElement\(el\);\s*cgScrollFlash\(el\);/.test(src) && count(src, "function cgScrollFlash(") === 1, label + ": ?section= uses the same scroll and flash as the menu");

  // ── A lead ───────────────────────────────────────────────────────────────
  const LEAD = ["leadPipeline", "apexContract", "overview", "contacts", "notes", "portalAccess", "sellerLogins"];
  const lead = makePage(src, { session: { apex_role: "rafa" } });
  lead.run("cgInit()");
  lead.els["sec-leadPipeline"].hidden = false;
  lead.els["sec-apexContract"].hidden = false;
  lead.run("cgInit()");
  ok(lead.run("cgGroup") === "overview" && same(lead.onScreen(), LEAD) && lead.strays().length === 0, label + ": a lead's Overview is Lead Pipeline, APEX Contract, then overview, contacts, notes, Client Portal, Salesperson Logins (" + lead.onScreen().join(", ") + ")");
  ok(same(lead.layout(), ["leadPipeline", [LEAD.slice(1, 4), LEAD.slice(4)]]), label + ": the Lead Pipeline spans the full width; the rest is two columns");
  ok(same(menu(lead, "overview"), LEAD), label + ": a lead's Overview menu lists the same seven, in that order");
  lead.run("cgGroupTap('overview', null)");
  ok(count(lead.els.cgPanel.innerHTML, "cgSheetGo('leadPipeline')") === 1 && count(lead.els.cgPanel.innerHTML, "cgSheetGo('apexContract')") === 1 && count(lead.els.cgPanel.innerHTML, "cgSheetGo(") === 7, label + ": Lead Pipeline and APEX Contract are two separate menu items");
  ok(menu(lead, "money").indexOf("apexContract") === -1 && same(menu(lead, "money"), ["invoices", "payment", "vendors"]), label + ": a lead's APEX Contract is not in Money");
  lead.run("cgShowGroup('money', true)");
  ok(lead.onScreen().indexOf("apexContract") === -1 && lead.strays().length === 0, label + ": nor on the Money screen");
  lead.run("cgShow('apexContract', false)");
  ok(lead.run("cgGroup") === "overview" && lead.run("cgGroupOfSection('apexContract').key") === "overview", label + ": ?section=apexContract on a lead opens Overview");
  ok(!/cgShow\("leadPipeline"/.test(src) && !/cgCurrent|cgOnScreen|cgNormalize/.test(src), label + ": a lead's page opens on Overview like everyone's (no jump to a Lead Pipeline screen)");

  // ── Phone ────────────────────────────────────────────────────────────────
  const phone = makePage(src, { session: { apex_role: "alice" }, phone: true });
  phone.run("cgInit()");
  phone.run("cgGroupTap('money', { getBoundingClientRect: function() { return { bottom: 300, left: 5 }; } })");
  ok(phone.els.cgSheet.hidden === false && !phone.els.cgPanel.style.top, label + ": on a phone the menu is the pop-up above the dock, not pinned under the button");
  ok(/\.cg-panel \{[^}]*bottom: calc\(58px \+ 10px \+ env\(safe-area-inset-bottom\)\)/.test(src) && /\.cg-panel \{[^}]*left: 10px; right: 10px;/.test(src), label + ": the phone pop-up sits above the 58px dock and inside both screen edges");
  ok(/\.cg-row-two \{ display: flex; gap: 24px; align-items: flex-start; \}/.test(src) && /@media \(max-width: 1099px\) \{[^}]*\.cg-row-two \{ flex-direction: column;/.test(src), label + ": two columns only on a wide screen; below 1100px the right column goes under the left");
  ok(count(src, 'id="cgStage"') === 1 && src.indexOf('id="cgStage"') < src.indexOf('<div class="two-col-layout">') && src.indexOf('id="cgStage"') > src.indexOf('id="cgBar"'), label + ": the stage sits once, between the group buttons and the page's own columns");

  // ── Click counter ────────────────────────────────────────────────────────
  const t = makePage(src, { session: { apex_role: "alice" }, track: "ok" });
  t.run("cgInit(); cgGroupTap('apexwork', null); cgSheetGo('clientTasks');");
  ok(same(t.calls, [["client:group:apexwork", "client-1"], ["client:section:clientTasks", "client-1"]]), label + ": opening a group and choosing a section are counted, with the client's id");
  ok(same(tap.calls.map((c) => c[0]), ["client:group:business", "client:group:business", "client:group:results", "client:section:dp", "client:section:payment"]), label + ": Client tools is still counted as client:group:business; closing a menu is not counted");
  const none = makePage(src, { session: { apex_role: "alice" } });
  none.run("cgInit(); cgGroupTap('apexwork', null); cgSheetGo('clientTasks');");
  const boom = makePage(src, { session: { apex_role: "alice" }, track: "throw" });
  boom.run("cgInit(); cgGroupTap('apexwork', null); cgSheetGo('clientTasks');");
  ok(same(none.onScreen(), WANT.apexwork) && same(boom.onScreen(), WANT.apexwork) && same(t.onScreen(), WANT.apexwork) && boom.els["sec-clientTasks"].scrolls.length === 1 && none.els["sec-clientTasks"].scrolls.length === 1, label + ": with the counter missing or failing the page does exactly the same");
  ok(MOVED.every((id) => src.indexOf('"' + id + '"', src.indexOf("var CG_TRACKED_BUTTONS")) !== -1) && src.indexOf('cgTrack("client:btn:meetingprep")') !== -1, label + ": every moved button and Meeting prep are on the counted list");
  ok(count(src, "apexTrack(") === 1 && /typeof window\.apexTrack === "function"/.test(src), label + ": apexTrack is called in one place, only if it exists");

  // ── The hero ─────────────────────────────────────────────────────────────
  const hero = slice(src, '<div class="profile-header-shell', '<div class="below-hero-section">');
  ok(MOVED.every((id) => hero.indexOf(id) === -1) && hero.indexOf("openNewSessionModal") === -1, label + ": the hero holds none of the moved buttons");
  ok(count(hero, "<button") === 2 && count(hero, "<a ") === 1 && hero.indexOf('id="btnMeetingPrep"') !== -1 && hero.indexOf('id="btnPrevClient"') !== -1 && hero.indexOf('id="btnNextClient"') !== -1, label + ": the hero's only controls are the two arrows and Meeting prep");
  MOVED.forEach((id) => ok(count(src, 'id="' + id + '"') === 1, label + ": " + id + " is on the page exactly once"));
  // The part of a card above its body: its header.
  const inHeader = (name, id) => slice(src, 'id="sec-' + name + '"', 'id="' + name + 'Body"').indexOf('id="' + id + '"') !== -1;
  ok(inHeader("sessions", "btnNewSession") && inHeader("sessions", "btnScheduleSession") && inHeader("sessions", "btnHeaderPdf"), label + ": New Session, Schedule Session and Generate PDF are in the Sessions header");
  ok(inHeader("resources", "btnAttachResource"), label + ": Attach Resource is in the Resources header");
  ok(inHeader("portalAccess", "btnViewPortal"), label + ": View client portal is at the top of the Client Portal card");
  ok(inHeader("overview", "btnHeroLogo"), label + ": Add Logo is in the overview card");
  ok(/id="btnHeaderPdf" hidden onclick="handleHeaderPdf\(\)"/.test(src) && /id="btnViewPortal" href="#" target="_blank" rel="noopener" hidden/.test(src) && /id="btnHeroLogo" onclick="document\.getElementById\('logoFileInput'\)\.click\(\)" style="display:none;"/.test(src), label + ": the moved buttons that start hidden still start hidden, with the same handlers");
  ok(/link\.href = "meeting-prep\.html\?client=" \+ encodeURIComponent\(CLIENT_ID\)/.test(src), label + ": Meeting prep opens meeting-prep.html?client=<id>");
  ok(!/prepLinksTop|prepLinksLower|renderPrepLinks/.test(src), label + ": the two old Meeting prep mounts are gone");
  ok(!/Edit Sections|Editar Secoes|btnEditSections|btnDoneSections|EditSectionsMode|is-edit-sections/.test(src), label + ": no Edit Sections control or reorder mode remains");
  ok(src.indexOf("apex_section_order") === -1 && src.indexOf("sectionOrderKey") === -1, label + ": the saved section order is no longer read (and nothing deletes it)");

  // ── Deep links ───────────────────────────────────────────────────────────
  ok(/function scrollToSection\(elId\) \{[\s\S]{0,400}cgShowForElement\(el\);/.test(src), label + ": ?section= and ?day= put the section's group on screen before scrolling to it");
  ok(/\(DEEP_MODAL === "login" \|\| DEEP_MODAL === "fieldconfig"\) && !DEEP_SECTION\) \{\s*cgShow\("portalAccess", false\);/.test(src), label + ": ?modal=login and ?modal=fieldconfig open over the Client Portal card");

  // ── Tasks grouped by session ─────────────────────────────────────────────
  const tctx = { sessions: [{ id: "s-page", date: "2026-08-03" }] };
  vm.createContext(tctx);
  vm.runInContext(slice(src, "    var TASK_MONTHS_PT = [", "    function loadTasks(type)") +
    slice(src, "    // The session a task came from:", "    // One task row, exactly as it has always been drawn."), tctx);
  tctx.tasks = [
    { id: "t1", status: "pending", session_id: "s-old", session_date: "2026-09-07" },
    { id: "t2", status: "done", session_id: "s-new", session_date: "2026-10-05" },
    { id: "t3", status: "pending", session_id: "s-new", session_date: "2026-10-05" },
    { id: "t4", status: "pending", source: "voice", session_id: null, session_date: null }, { id: "t5", status: "done" },
    { id: "t6", status: "done", session_id: "s-page", session_date: null },
    { id: "t7", status: "pending", session_id: "s-gone", session_date: null }
  ];
  const g = vm.runInContext("buildTaskGroups(tasks).map(function(x) { return { key: x.key, date: x.date, ids: x.tasks.map(function(t) { return t.id; }), open: taskGroupOpenCount(x) }; })", tctx);
  ok(same(g.map((x) => x.key), ["other", "s-new", "s-old", "s-page"]), label + ": task groups are Other first, then sessions newest first");
  ok(same(g[0].ids, ["t4", "t5", "t7"]), label + ": a spoken task, a hand-added task and a task whose session cannot be found all go in Other");
  ok(same(g[1].ids, ["t2", "t3"]) && g[1].open === 1 && g[3].open === 0, label + ": each group counts its own open tasks");
  ok(g[3].date === "2026-08-03", label + ": a session's date comes from the page's own sessions when the task list does not carry it");
  const html = vm.runInContext("taskSessionDateHtml('2026-10-05')", tctx);
  ok(html === '<span class="show-pt">5 de outubro de 2026</span><span class="show-en">October 5, 2026</span>', label + ": a session header reads 5 de outubro de 2026 / October 5, 2026");
  ok(vm.runInContext("taskSessionDateHtml('2026-03-01')", tctx).indexOf("1 de março de 2026") !== -1, label + ": March is written março");
  ok(/startOpen = taskGroupOpenCount\(groups\[gi\]\) > 0;[\s\S]{0,120}startOpen = !newestSeen;/.test(src), label + ": Other starts open only with an open task; of the sessions only the newest starts open");
  ok(!/apiFetch\("\/api\/tasks"\)|taskSessionMap/.test(src), label + ": the page no longer downloads every client's tasks to find a task's session");
  ok(/id="btnAddClientTask" onclick="openAddTaskForm\('client'\)"/.test(src) && /id="btnAddConsultantTask" onclick="openAddTaskForm\('consultant'\)"/.test(src), label + ": both Add task controls are where they were");
}

// ── The Worker route the task sections read ───────────────────────────────
// Its two SELECTs, lifted out of worker/index.js and run on an in-memory
// SQLite: every task comes back with session_id, session_date and source,
// and a task with no session is still returned.
{
  const worker = readFileSync(new URL("worker/index.js", root), "utf8");
  const fn = slice(worker, "async function handleGetClientTasks(", "\n}\n");
  const sqls = [...fn.matchAll(/env\.DB\.prepare\(([\s\S]*?)\)\.bind\(/g)].map((m) => vm.runInNewContext(m[1]));
  ok(sqls.length === 2 && sqls.every((q) => /LEFT JOIN sessions/.test(q) && !/INNER JOIN/i.test(q)), "Worker: both task SELECTs LEFT JOIN sessions");
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, date TEXT, created_at TEXT);" +
    "CREATE TABLE tasks (id TEXT PRIMARY KEY, client_id TEXT, session_id TEXT, type TEXT, description TEXT, due_date TEXT, status TEXT, source TEXT, created_at TEXT);" +
    "INSERT INTO sessions VALUES ('s1', '2026-10-05', '2026-10-05T10:00:00Z');" +
    "INSERT INTO tasks VALUES ('a', 'c1', 's1', 'client', 'from a session', '2026-10-10', 'pending', 'session', '2026-10-05T11:00:00Z');" +
    "INSERT INTO tasks VALUES ('b', 'c1', NULL, 'client', 'spoken', NULL, 'pending', 'voice', '2026-10-05T12:00:00Z');" +
    "INSERT INTO tasks VALUES ('c', 'c1', 's-gone', 'consultant', 'session row missing', NULL, 'done', 'session', '2026-10-05T13:00:00Z');" +
    "INSERT INTO tasks VALUES ('d', 'c2', 's1', 'client', 'another client', NULL, 'pending', 'session', '2026-10-05T14:00:00Z');");
  const byType = db.prepare(sqls[0]).all("c1", "client");
  const all = db.prepare(sqls[1]).all("c1");
  const row = (rows, id) => rows.filter((r) => r.id === id)[0] || {};
  ok(same(byType.map((r) => r.id).sort(), ["a", "b"]) && same(all.map((r) => r.id).sort(), ["a", "b", "c"]), "Worker: the route returns this client's tasks only, with and without ?type=");
  ok(row(all, "a").session_id === "s1" && row(all, "a").session_date === "2026-10-05" && row(byType, "a").session_date === "2026-10-05", "Worker: a task from a session carries session_id and the session's date");
  ok(row(all, "b").session_id === null && row(all, "b").session_date === null && row(all, "b").source === "voice", "Worker: a task with no session is still returned, with its source");
  ok(row(all, "c").session_id === "s-gone" && row(all, "c").session_date === null, "Worker: a task whose session row is missing is still returned, with no date");
  ok(["id", "client_id", "type", "description", "due_date", "status", "created_at"].every((k) => k in row(all, "a")), "Worker: every field the route returned before is still returned");
}

checkCopy("root", "client.html");
checkCopy("iOS", "ios/App/App/public/client.html");

console.log(fail ? "\n" + fail + " FAILED" : "\nall passed");
process.exit(fail ? 1 : 0);
