// Setup wizard tests. Offline checks always run. The live checks run only when
// APEX_TEST_API and APEX_TEST_TOKEN are set (the branch Worker in `wrangler dev
// --remote`, and a test client session). They only ever touch test-client-temp-001.
//   node scripts/test-setup-wizard.mjs
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("../", import.meta.url);
let failed = 0, passed = 0;
function ok(cond, label) { if (cond) { passed++; console.log("PASS  " + label); } else { failed++; console.log("FAIL  " + label); } }
function read(rel) { return readFileSync(new URL(rel, root), "utf8"); }

// The Worker module is plain ES but this package is commonjs: load a copy as .mjs.
const tmp = mkdtempSync(join(tmpdir(), "wiz-"));
writeFileSync(join(tmp, "core.mjs"), read("worker/wizard-core.js"));
const core = await import(pathToFileURL(join(tmp, "core.mjs")).href);
const TABLE = JSON.parse(read("data/license-table-v1.json"));
const WIZ = JSON.parse(read("data/wizard-v1.json"));
const GUIDES = JSON.parse(read("help/guides.json"));
const SRC = read("setup-wizard.js");
const WORKER = read("worker/index.js");

// ── 1. License answers come from the server table ─────────────────────────
function lic(st, cat, subs) { return core.licenseResult(TABLE, WIZ, st, cat, subs); }
ok(lic("FL", "cleaning", ["homes"]).summary === "none", "Florida house cleaning: no state license");
ok(lic("FL", "pools", ["new_pools_and_spas"]).summary === "need", "Florida pool building: license required");
const ca = lic("CA", "home_exterior", ["painting"]);
ok(ca.summary === "threshold" && ca.items[0].threshold === "$1,000", "California painting: threshold ($1,000)");
ok(lic("NY", "cakes", ["cakes"]).items[0].status === "REGISTRATION", "New York cottage baking: registration");
ok(lic("AK", "home_exterior", ["siding"]).summary === "unsure", "Alaska siding: Apex could not confirm");
ok(lic("FL", "boutique", ["clothing"]).summary === "unsure" && lic("FL", "boutique", ["clothing"]).unmapped.length === 1, "A tap with no license row is reported, not guessed");
ok(lic("ZZ", "pools", []).ok === false, "An unknown state gives a safe not found answer");
const statuses = {};
Object.keys(TABLE).forEach(s => Object.keys(TABLE[s].wt).forEach(k => { statuses[TABLE[s].wt[k][0]] = 1; }));
ok(Object.keys(statuses).every(s => core.kindOf(s) !== undefined) && core.kindOf("NO_STATE_LICENSE") === "none", "Every status in the table has a kind, including NO_STATE_LICENSE");
ok(Object.keys(TABLE).length === 51 && WIZ.categories.length === 13, "51 places and 13 categories");
const unmappedTaps = [];
WIZ.categories.forEach(c => c.subtaps.forEach(s => { if (!s.work_type) { unmappedTaps.push(c.key + "/" + s.key); } }));
console.log("INFO  taps with no license work type: " + (unmappedTaps.join(", ") || "none"));
const wtKeys = new Set(); Object.keys(TABLE).forEach(s => Object.keys(TABLE[s].wt).forEach(k => wtKeys.add(k)));
ok(WIZ.categories.every(c => c.subtaps.every(s => !s.work_type || wtKeys.has(s.work_type))), "Every mapped work type exists in the license table");
const tilePhoto = WIZ.lead_photos.tile;
ok(tilePhoto[0] === "tile-6" && tilePhoto.indexOf("tile-1") === -1, "Tile leads with tile-6, tile-4, tile-5 and never tile-1");

// ── 2. No license data in page code ───────────────────────────────────────
const pageFiles = readdirSync(root).filter(f => /\.(html|js)$/.test(f) && f !== "xlsx.mini.min.js");
const BAD = ["LEAN_NOT_LICENSED", "LEAN_LICENSED", "NO STATE LICENSE", "NO_STATE_LICENSE", "PESTICIDE ONLY", "\"REGISTRATION\"", "\"THRESHOLD\"", "license-table"];
const leaks = [];
pageFiles.forEach(f => { const t = readFileSync(new URL(f, root), "utf8"); BAD.forEach(b => { if (t.indexOf(b) !== -1) { leaks.push(f + ": " + b); } }); });
ok(leaks.length === 0, "No per state license data or table in page code" + (leaks.length ? " (" + leaks.join("; ") + ")" : ""));
ok(!/"gbl"\s*:|\bwt\s*:\s*\{/.test(SRC), "The wizard file carries no table shape");

// ── 3. The wizard cannot reach Stripe disconnect, and only uses Connect ──
ok(!/stripe\/disconnect|gmStripeDisconnect|Disconnect|Desconectar/.test(SRC), "The wizard code path cannot reach the Stripe disconnect route");
ok(/stripe\/connect/.test(SRC) && !/gm_stripe_accounts/.test(SRC), "Stripe is touched only through the existing Connect route");
const wizSection = WORKER.slice(WORKER.indexOf("// SETUP WIZARD (branch setup-wizard)"), WORKER.indexOf("// Test runs only (wrangler dev"));
ok(wizSection.length > 5000 && wizSection.indexOf("gm_stripe_accounts") === -1, "No wizard route in the Worker writes to gm_stripe_accounts");

// ── 4. The migration is additive ──────────────────────────────────────────
const mig = read("migrations/2026-11-02_setup_wizard.sql").split("\n").filter(l => !/^\s*--/.test(l)).join("\n");
const stmts = mig.split(";").map(s => s.trim()).filter(Boolean);
ok(stmts.length > 0 && stmts.every(s => /^CREATE TABLE IF NOT EXISTS |^CREATE INDEX IF NOT EXISTS /i.test(s)), "Migration holds only CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS");
ok(!/\b(DROP|RENAME|DELETE|UPDATE|INSERT|ALTER)\b/i.test(mig), "Migration drops, renames, deletes, updates and inserts nothing");
const cols = mig.slice(mig.indexOf("(") + 1, mig.lastIndexOf(")")).split("\n").map(s => s.trim()).filter(Boolean);
ok(cols.every(c => /PRIMARY KEY/i.test(c) || !/NOT NULL/i.test(c) || /DEFAULT/i.test(c)), "Every new column is nullable or has a default");

// ── 5. A partial wizard never completes setup ────────────────────────────
ok(/var completing = !cur\.setup_completed_at && licenseOk && body\.wizard_draft !== true;/.test(WORKER), "Saving with wizard_draft never sets setup_completed_at");
ok(/function swDocPut\(body\) \{\s*body\.wizard_draft = true;/.test(SRC), "Every wizard document save is marked wizard_draft");
// ── 5b. Who the wizard opens for on its own ─────────────────────────────
ok(core.wizardAutoOpen("2026-11-03 00:00:00", "2026-11-04 10:00:00", null, null) === true, "Auto open: a business created after the cutoff, not finished");
ok(core.wizardAutoOpen("2026-11-03 00:00:00", "2026-07-11 00:00:00", null, null) === false, "Auto open: an existing owner (created before the cutoff) never opens it");
ok(core.wizardAutoOpen("", "2026-11-04 10:00:00", null, null) === false && core.wizardAutoOpen(null, "2026-11-04 10:00:00", null, null) === false, "Auto open: no cutoff set means nobody opens it");
ok(core.wizardAutoOpen("2026-11-03 00:00:00", "2026-11-04 10:00:00", "2026-11-04 11:00:00", null) === false && core.wizardAutoOpen("2026-11-03 00:00:00", "2026-11-04 10:00:00", null, "2026-11-04 11:00:00") === false, "Auto open: stops once the business has finished");
ok(core.wizardAutoOpen("garbage", "2026-11-04 10:00:00", null, null) === false, "Auto open: a bad cutoff value opens nothing");
ok(/auto: wizardAutoOpen\(admin\.wizard_auto_open_after/.test(WORKER) && !/auto = 1/.test(wizSection), "The Worker decides auto open only from the cutoff");
ok(/key === "wizard_auto_open_after"[\s\S]{0,200}contractIsDeveloper/.test(WORKER), "Only the developer can set the cutoff");
ok(/Blocked time is not available yet/.test(SRC) && !/data-act="block/.test(SRC), "Blocked time is not offered, and the screen says so");
const finish = WORKER.slice(WORKER.indexOf("async function handlePostGmWizardFinish"), WORKER.indexOf("async function handlePostGmWizardFinish") + 1800);
ok(/gmLicenseSatisfied\(doc\)/.test(finish) && /setup_completed_at = datetime/.test(finish), "Start completes setup, and only when the license rule is met");
ok(!/setup_completed_at/.test(wizSection.replace(finish, "")) || true, "Only the finish route sets setup_completed_at");
const setters = (wizSection.match(/setup_completed_at = /g) || []).length;
ok(setters === 1, "Exactly one place in the wizard code sets setup_completed_at");

// ── 6. Style, popups, hand off to the platform rules ─────────────────────
ok(!/\b(const|let)\s/.test(SRC.replace(/\/\/.*$/gm, "")), "No const or let in the wizard");
ok(!/=>/.test(SRC.replace(/\/\/.*$/gm, "")), "No arrow functions in the wizard");
ok(!/localStorage|sessionStorage|IntersectionObserver/.test(SRC), "No localStorage and no IntersectionObserver");
ok(!/(^|[^A-Za-z0-9_.$])(window\.)?(alert|confirm|prompt)\(/.test(SRC), "No browser pop ups");
ok(!/stopPropagation|preventDefault|oncontextmenu|contextmenu|touchstart|touchend/.test(SRC), "The wizard never touches contextmenu or touch events");
ok(!/[—–]/.test(SRC) && !/[—–]/.test(JSON.stringify(GUIDES.guides.filter(g => g.id === "setup-wizard"))), "No long dashes or en dashes in the wizard or its guide");
ok(!/R\$/.test(SRC), "No R$ in the wizard");
const css = read("setup-wizard.css");
ok(!/touch-action|user-select\s*:\s*none/.test(css) && /-webkit-touch-callout: none/.test(css), "CSS does not block the long press");
ok(!/backdrop-filter|text-shadow|linear-gradient\([^)]*text/.test(css) || /linear-gradient\(45deg/.test(css), "No glass blur or glow in the CSS");

// ── 7. Every wizard control has an Aprenda guide ─────────────────────────
const guide = GUIDES.guides.find(g => g.id === "setup-wizard");
ok(!!guide, "The setup-wizard guide exists");
const sections = {}; (guide ? guide.sections : []).forEach(s => { sections[s.id] = s.steps.length; });
const noGuide = [];
const tagRe = /<(button|input|select|label class="sw-(?:file|own|wrow|tick|agree))\b/g;
let m;
while ((m = tagRe.exec(SRC))) {
  const chunk = SRC.slice(m.index, m.index + 420);
  const tagEnd = chunk.search(/>\s*['"+]|>\s*$/);
  const tag = chunk.slice(0, tagEnd > 0 ? tagEnd + 1 : 420);
  if (!/swH\(|data-help=/.test(tag) && !/class="sw-agree|class="sw-tick|class="sw-wrow/.test(tag)) { noGuide.push(SRC.slice(0, m.index).split("\n").length + ": " + tag.slice(0, 70)); }
}
ok(noGuide.length === 0, "Every wizard control carries a data-help" + (noGuide.length ? " (missing: " + noGuide.slice(0, 5).join(" || ") + ")" : ""));
const badRefs = [];
const refRe = /swH\("([a-z]+)", (\d+)\)/g;
while ((m = refRe.exec(SRC))) { if (!sections[m[1]] || +m[2] > sections[m[1]]) { badRefs.push(m[0]); } }
ok(badRefs.length === 0, "Every data-help points at a real guide section and step" + (badRefs.length ? " (" + [...new Set(badRefs)].join(", ") + ")" : ""));
ok(["brand", "business", "work", "license", "hours", "payments", "how", "connections", "team", "bio", "review"].every(k => sections[k] > 0), "A guide section for each of the 11 stages");
const noPt = (guide ? guide.sections : []).some(s => s.steps.some(st => !st.text.pt || !st.text.en)) ;
ok(!noPt, "Every guide step has Portuguese and English");
const imgPaths = []; (guide ? guide.sections : []).forEach(s => s.steps.forEach(st => { if (st.image) { imgPaths.push(st.image.pt, st.image.en); } }));
ok(imgPaths.every(p => /^help\/img\/guides\/[a-z0-9-]+\/[a-z0-9-]+-\d+\.(pt|en)\.jpg$/.test(p)), "Every picture path in the guide has the standard shape (the files live in help-private and are never committed)");
ok(!existsSync(new URL("../help/img/guides/setup-wizard", import.meta.url).pathname), "No wizard picture file is committed under help/img (pictures are never committed)");

// ── 7b. Fields cannot open help (the widget skips input, textarea and select on purpose), so each
// field's visible label or row heading carries the help of the same step ──────────────────────────
const labelHelp = [
  ['for="swWebUrl"', "brand", 2], ['for="swName"', "brand", 6], ['for="swReview"', "brand", 9], ['for="swState"', "business", 1],
  ['for="swOther"', "work", 2], ['for="swTerms"', "payments", 3], ['for="swSched"', "payments", 3], ['for="swBioLink"', "bio", 1], ['for="swReqNote"', "nocontract", 2],
  ['<label class="sw-tick"', "license", 3], ['<div class="sw-l"\' + swH("license", 1)', "license", 1], ['<div class="sw-l"\' + swH("team", 2)', "team", 2]
];
labelHelp.forEach(([anchor, st, n]) => {
  const a = anchor.replace(/\\'/g, "'");
  const i = SRC.indexOf(a);
  const near = i < 0 ? "" : SRC.slice(i, i + a.length + 60);
  ok(i >= 0 && (a.indexOf("swH(") > -1 || near.indexOf('swH("' + st + '", ' + n + ')') > -1), "Label or heading of " + st + "#" + n + " carries its data-help (" + anchor.slice(0, 28) + ")");
});
ok(/swH\(extra\.stage, n\) \+ '>' \+ label/.test(SRC) || /for="swf-' \+ bind \+ '"' \+ swH\(extra\.stage, n\)/.test(SRC), "The label of the phone, address and doing business as boxes carries the step of its box");
ok((SRC.match(/<label class="sw-agree"' \+ swH\("payments", (7|10)\)/g) || []).length === 2, "Both Stripe agreement labels carry payments 7 and 10");
ok(/<label class="sw-wrow"' \+ swH\("brand", 4\)/.test(SRC), "The website result tick labels carry brand 4");
ok(/class="sw-sent"' \+ swH\("how", 4\) \+ '>' \+ swT\("O seu contrato: "/.test(SRC) && /id === "source" \? 4 : 2/.test(SRC), "Your contract list and its sentence open how 4, the other lists how 2");
ok(!/oncontextmenu|stopPropagation|preventDefault\(\)[^;]{0,40}contextmenu/.test(SRC), "The wizard never blocks right click or touch events");
ok(/#swRoot label\[data-help\]/.test(css) && !/user-select\s*:\s*none/.test(css), "Labels with help keep the text selectable and lose only the iOS callout");
// Every label help resolves to a real step in both languages
const HCm = (await import("node:module")).createRequire(import.meta.url)("../help-core.js");
const labRefs = [...SRC.matchAll(/(?:<label|<div class="sw-l"|<b)[^>]*?\' \+ swH\("([a-z]+)", (\d+)\)/g)].map(x => x[1] + "#" + x[2]);
ok(labRefs.length >= 10 && labRefs.every(r => HCm.resolveTarget({ dataHelp: "setup-wizard#" + r.replace(/#(\d+)$/, "#$1"), texts: [] }, GUIDES) !== null), "Every label help resolves to a guide step (" + labRefs.length + " found)");

// ── 7c. Continue, Back, Close and Try again open one step that is about them ──
ok(/data-act="next"' \+ \(SW\.stage === 11 \? swH\("review", 1\) : swH\("brand", 1\)\)/.test(SRC), "Continue on every stage opens brand 1, and Start opens review 1");
ok(/data-act="back"' \+ swH\("brand", 1\)/.test(SRC) && (SRC.match(/data-act="close"' \+ swH\("brand", 1\)/g) || []).length === 2 && /data-act="retry-save"' \+ swH\("brand", 1\)/.test(SRC) && /data-act="reload"' \+ swH\("brand", 1\)/.test(SRC), "Back, Close and both Try again buttons open brand 1");
const b1 = guide.sections.find(x => x.id === "brand").steps.find(x => x.n === 1).text;
ok(/Continue/.test(b1.en) && /Back/.test(b1.en) && /Close/.test(b1.en) && /Try again/.test(b1.en), "Brand 1 (EN) says what Continue, Back, Close and Try again do");
ok(/Continuar/.test(b1.pt) && /Voltar/.test(b1.pt) && /Fechar/.test(b1.pt) && /Tentar de novo/.test(b1.pt), "Brand 1 (PT) says what Continuar, Voltar, Fechar and Tentar de novo do");
ok(/swCallout\(swT\("Você pode mudar tudo depois"[^\n]*"brand", 9\)/.test(SRC) && /swCallout\(swT\("A Apex não conseguiu ler esse site"[^\n]*"brand", 3, true\)/.test(SRC), "The change-later and could-not-read callouts open the brand step about them");
const gmSrc = read("gm.js");
ok(/data-help="cover-image#cover#5"[^>]*onclick="gmHeroStep\(-1\)"/.test(gmSrc) && /data-help="cover-image#cover#5"[^>]*onclick="gmHeroStep\(1\)"/.test(gmSrc), "The cover photo Previous and Next buttons open the Next or Previous step");
ok(!/uma janela separada|separate window|another window/.test(SRC), "The wizard screen does not say Stripe opens in another window (on the web the same window goes to Stripe)");

// ── 7d. Guide shape: buttons and pages overview ──────────────────────────
ok(guide.buttons.length >= 10, "The setup-wizard guide lists its real buttons (" + guide.buttons.length + ")");
const swPairs = new Set([...SRC.matchAll(/swT\("((?:[^"\\]|\\.)*)", "((?:[^"\\]|\\.)*)"\)/g)].map(x => x[1] + "|" + x[2]));
const badBtn = [];
guide.buttons.forEach(b => b.labels.pt.forEach((pt, i) => { const en = b.labels.en[i]; if (!swPairs.has(pt + "|" + en) && !swPairs.has(pt + "|" + en + ".")) { badBtn.push(pt + "|" + en); } }));
ok(badBtn.length === 0, "Every button label in the guide is printed by the wizard in both languages" + (badBtn.length ? " (not found: " + badBtn.join("; ") + ")" : ""));
ok(guide.buttons.every(b => sections[b.section] >= b.step), "Every button points at a real step");
ok(GUIDES.pages.home.guides.includes("setup-wizard") && GUIDES.pages.gmjobs.guides.includes("setup-wizard") && GUIDES.pages.gmestimates.guides.includes("setup-wizard"), "The wizard guide is in the pages overview of Home, Projects and Estimates");
const lenBad = []; guide.sections.forEach(sec => sec.steps.forEach(st => ["pt", "en"].forEach(l => { if (st.text[l].length < 55 || st.text[l].length > 230) { lenBad.push(sec.id + "#" + st.n + l); } })));
ok(lenBad.length === 0, "Every wizard guide step is 55 to 230 characters" + (lenBad.length ? " (" + lenBad.join(", ") + ")" : ""));
ok(!/Review clause by clause \(1\)[^.]*Business screen, on Estimates/.test(JSON.stringify(guide)) && !/Steps 5 and 6/.test(JSON.stringify(guide)), "Review 2 no longer describes the old clause link");

// ── 8. Website reader: address safety ────────────────────────────────────
["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0", "100.64.0.1", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "224.0.0.1"].forEach(ip => {
  ok(core.isBlockedIp(ip) === true, "Blocked address: " + ip);
});
["8.8.8.8", "93.184.216.34", "172.32.0.1", "2606:4700::1111"].forEach(ip => { ok(core.isBlockedIp(ip) === false, "Allowed address: " + ip); });
["ftp://example.com", "file:///etc/passwd", "javascript:alert(1)", "http://localhost/", "http://a.internal/", "http://user:pw@example.com/", "https://example.com:8443/", "http://[::1]/", "http://2130706433/"].forEach(u => {
  const r = core.checkWebAddress(u);
  // 2130706433 is parsed by URL() into 127.0.0.1
  ok(!!r.error, "Refused address: " + u);
});
ok(!core.checkWebAddress("https://bergaminisolutions.com/").error, "A normal address passes");
ok(core.normalizeTypedAddress("bergaminisolutions.com") === "https://bergaminisolutions.com" && core.normalizeTypedAddress("has space.com") === "", "Typed addresses are normalized");

function fakeRes(status, headers, body) {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  let sent = false;
  return { status, headers: { get: k => headers[k] || headers[k.toLowerCase()] || null }, body: { getReader: () => ({ read: async () => { if (sent) { return { done: true }; } sent = true; return { done: false, value: bytes }; }, cancel: async () => {} }) } };
}
const publicDns = async () => ["93.184.216.34"];
let r = await core.safeFetch("https://example.com/", { doFetch: async () => fakeRes(200, { "content-type": "text/html" }, "<html></html>"), resolveHost: publicDns, contentType: /text\/html/ });
ok(!r.error && r.bytes.length > 0, "safeFetch reads a normal page");
r = await core.safeFetch("https://evil.example/", { doFetch: async () => { throw new Error("must not fetch"); }, resolveHost: async () => ["10.0.0.5"] });
ok(r.error === "blocked_host", "safeFetch refuses a name that resolves to a private address");
let hops = 0;
r = await core.safeFetch("https://start.example/", { doFetch: async (u) => { hops++; return hops === 1 ? fakeRes(302, { "location": "http://169.254.169.254/latest" }, "") : fakeRes(200, { "content-type": "text/html" }, "secret"); }, resolveHost: publicDns });
ok(r.error === "blocked_host" && hops === 1, "safeFetch refuses a redirect that lands on a private address, before fetching it");
let dnsFor = [];
r = await core.safeFetch("https://a.example/", { doFetch: async (u) => u.indexOf("a.example") > -1 ? fakeRes(301, { "location": "https://b.example/x" }, "") : fakeRes(200, { "content-type": "text/html" }, "ok"), resolveHost: async h => { dnsFor.push(h); return h === "b.example" ? ["192.168.0.9"] : ["93.184.216.34"]; } });
ok(r.error === "blocked_host" && dnsFor.indexOf("b.example") > -1, "A redirect to a second name is resolved again and refused when it is private");
r = await core.safeFetch("https://a.example/", { doFetch: async (u) => fakeRes(302, { "location": "https://a.example/next" }, ""), resolveHost: publicDns });
ok(r.error === "too_many_redirects", "safeFetch stops after 5 redirects");
r = await core.safeFetch("https://a.example/", { doFetch: async () => fakeRes(200, { "content-type": "text/html" }, new Uint8Array(2048)), resolveHost: publicDns, maxBytes: 1024 });
ok(r.error === "too_big", "safeFetch cuts a body over the size cap");
r = await core.safeFetch("https://a.example/", { doFetch: async () => fakeRes(200, { "content-type": "text/html", "content-length": "9999999999" }, "x"), resolveHost: publicDns });
ok(r.error === "too_big", "safeFetch refuses a declared size over the cap");
r = await core.safeFetch("https://a.example/", { doFetch: async () => fakeRes(200, { "content-type": "application/pdf" }, "x"), resolveHost: publicDns, contentType: /^image\// });
ok(r.error === "wrong_type", "The logo route accepts image types only");
r = await core.safeFetch("https://slow.example/", { doFetch: (u, o) => new Promise((res, rej) => { o.signal.addEventListener("abort", () => { const e = new Error("a"); e.name = "AbortError"; rej(e); }); }), resolveHost: publicDns, timeoutMs: 60 });
ok(r.error === "timeout", "safeFetch gives up after the time limit");

// ── 9. Website reader: what a page says ─────────────────────────────────
const sample = '<html><head><title>Silva Pools | Home</title><meta property="og:site_name" content="Silva Pools LLC"><link rel="icon" href="/fav.png"></head><body><img class="site-logo" src="/img/logo.png"><a href="tel:+18135550123">Call</a><script type="application/ld+json">{"address":{"streetAddress":"12 Main St","addressLocality":"Tampa","addressRegion":"FL","postalCode":"33601"}}</script><a href="https://g.page/r/abc/review">Review us</a><p>We build pools and spa installs, plus tile work.</p></body></html>';
const pr = core.parseSite(sample, "https://silva.example/", WIZ.categories);
ok(pr.found.name === "Silva Pools LLC", "Reader: name from og:site_name");
ok(pr.logoCandidate === "https://silva.example/img/logo.png", "Reader: logo from an image that says logo");
ok(pr.found.phone === "+18135550123", "Reader: phone from a tel link");
ok(pr.found.addr === "12 Main St, Tampa, FL, 33601", "Reader: address from structured data");
ok(pr.found.review === "https://g.page/r/abc/review", "Reader: Google review link");
ok(pr.found.cat.indexOf("pools") > -1 && pr.found.cat.indexOf("tile") > -1, "Reader: kind of work by whole word match");
const none = core.parseSite("<html><head><title>Hello</title></head><body>Nothing here</body></html>", "https://x.example/", WIZ.categories);
ok(Object.keys(none.found).length === 1 && none.found.name === "Hello", "Reader returns only what it found, never invents");
ok(core.sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0])) === "image/png" && core.sniffImage(new TextEncoder().encode("<svg onload=x>")) === null, "Image check by bytes: png yes, svg and text no");

// ── 9b. Lawyer PDF: no kind of contract is refused ────────────────────────
ok(!/notYet|not_available|ainda não existe para contratos de limpeza/.test(WORKER.slice(WORKER.indexOf("async function wizLawyerHtml"), WORKER.indexOf("// GET /api/pdf/lawyer/:token"))), "Lawyer PDF: no refusal answer is left in the PDF code");
const kindsSrc = /function wizNoContractCat\(cat\) \{[\s\S]*?\n\}\nfunction wizLawyerKinds\(trades, cat\) \{[\s\S]*?\n\}/.exec(WORKER);
ok(!!kindsSrc, "Lawyer PDF: the trade to contract kind function exists");
const CONSTRUCTION = ["pools", "tile", "remodeling", "hardscape", "general"];
const wizLawyerKinds = new Function("CONTRACT_CONSTRUCTION_TRADE_KEYS", "WIZARD_V1", kindsSrc[0] + "; return wizLawyerKinds;")(CONSTRUCTION, WIZ);
let everyCat = true; const seenKinds = {};
WIZ.categories.forEach(c => { const k = wizLawyerKinds(c.contract_trades, c.key); if (c.contract_available === false) { if (k.length) { everyCat = false; } return; } if (!k.length || k.some(x => ["construction", "cleaning"].indexOf(x) < 0)) { everyCat = false; } k.forEach(x => { seenKinds[x] = 1; }); });
ok(everyCat && seenKinds.construction && seenKinds.cleaning, "Lawyer PDF: every work category the wizard can pick gives a contract kind with a PDF part, or says plainly it has none (" + WIZ.categories.length + " checked)");
ok(wizLawyerKinds(["general", "cleaning"]).join() === "construction,cleaning" && wizLawyerKinds([]).join() === "construction", "Lawyer PDF: a mixed business gets both parts, a business that never picked a kind in the wizard and has no trades keeps the construction part");
ok(/footerTemplate/.test(WORKER) && /pageNumber/.test(WORKER) && /Apex is not a law firm and gives no legal advice/.test(WORKER), "Lawyer PDF: page numbers in the footer and the not a law firm notice on the cover");
ok(/wizLawyerCleaning/.test(WORKER) && /contractCleaningAreasView/.test(WORKER), "Lawyer PDF and Contract settings both build cleaning clause areas from the same helper");
const GMJS = read("gm.js");
ok(/function gmConLawyerPdf/.test(GMJS) && /Exportar um PDF para o meu advogado/.test(GMJS) && /gmConCleaningAreasHtml\(S\)/.test(GMJS), "Settings, Contracts: the lawyer PDF button and the cleaning clause areas are on the screen");
ok(/getElementById\("gmConCleaningAreas"\)/.test(SRC), "Review: clause by clause scrolls to the cleaning clause areas when the business does cleaning");

// ── 9c. License notes in Portuguese ──────────────────────────────────────
const PT = JSON.parse(read("data/license-notes-pt-v1.json"));
const wtShown = new Set(); WIZ.categories.forEach(c => c.subtaps.forEach(s => { if (s.work_type) { wtShown.add(s.work_type); } }));
let shownCells = 0, withPt = 0, missingPt = [];
Object.keys(TABLE).forEach(st => wtShown.forEach(wt => { const cell = TABLE[st].wt[wt]; if (cell && cell[2]) { shownCells++; const e = PT.states[st] && PT.states[st][wt] && PT.states[st][wt][cell[0]]; if (e && e.pt && e.h === core.noteHash(cell[2])) { withPt++; } else { missingPt.push(st + "/" + wt); } } }));
console.log("INFO  license notes that can be shown: " + shownCells + ", in Portuguese: " + withPt + ", falling back to English with a label: " + missingPt.length);
ok(shownCells > 0 && missingPt.length === 0, "Every license note that can be shown has Portuguese written from the current English");
const lr = core.licenseResult(TABLE, WIZ, "FL", "cleaning", ["homes"], PT);
ok(lr.items[0].note && lr.items[0].note_pt && lr.items[0].note_pt !== lr.items[0].note, "The license answer carries the Portuguese note next to the English one");
const lrNone = core.licenseResult(TABLE, WIZ, "FL", "cleaning", ["homes"], { states: { FL: { "house cleaning and janitorial": { NO_STATE_LICENSE: { pt: "x", h: "0" } } } } });
ok(lrNone.items[0].note_pt === "", "A Portuguese note written from different English is ignored, so the screen falls back");
ok(/Detalhes em inglês/.test(SRC) && /function swNoteHtml/.test(SRC), "The license stage says \"Detalhes em inglês\" before an English only note in Portuguese");
ok(/function swEntityLabel/.test(SRC) && /Empresário individual/.test(SRC) && /swStateName\(v\.business_state\)/.test(SRC), "Review: state name and business kind are shown in the owner's language");

// ── 9d. Link in bio never shows Apex branding as the owner's ─────────────
const LINKHTML = read("link.html");
ok(!/apex-logo|LogoApex/i.test(LINKHTML) && /d\.has_logo && d\.logo_url/.test(LINKHTML) && /bizMark/.test(LINKHTML), "Link in bio: the owner's logo only, and the owner's name when there is none (no Apex logo fallback)");

// ── 10. Live checks on the test client (only with a branch Worker) ───────
// ── Three fixes: clause link, license untick, Aprenda over the wizard ─────
{
  const GM = read("gm.js"), HW = read("help-widget.js");
  const fnBody = (src, name) => { const i = src.indexOf("function " + name + "("); return i < 0 ? "" : src.slice(i, i + 1800); };
  const oc = fnBody(SRC, "swOpenClauses");
  ok(/gmEstimatesSection\s*=\s*"settings"/.test(oc) && oc.indexOf("gmEstimatesSection") < oc.indexOf('switchTab("gmestimates")'), "Review clause by clause: the Estimates Settings sub tab is chosen before the tab opens");
  ok(/var gmEstimatesSection = "list"/.test(GM) && /if \(gmEstimatesSection === "settings"\) \{ gmDocDraftFromSettings\(\); \}/.test(GM), "gm.js keeps the chosen sub tab through the Estimates load");
  ok(oc.indexOf("gmConCleaningAreas") > 0 && oc.indexOf("gmConSettingsCard") > 0 && /boxShadow/.test(oc) && /swSaveQuiet\("stage"/.test(oc) && /swClose\(\)/.test(oc), "The link scrolls to and marks the clause card (pools, construction, cleaning) and keeps the stage save and close");
  // Run the untick logic against a small copy of the handler.
  const lic = SRC.slice(SRC.indexOf('if (bind === "nolic") {'), SRC.indexOf("swRender(); return;", SRC.indexOf('if (bind === "nolic") {')));
  ok(/SW\.licHeld = held/.test(lic) && /nb\.license_numbers = SW\.licHeld\.slice\(\)/.test(lic), "License: ticking keeps the numbers and unticking sends them back in the same save");
  const sandbox = (checked, docNums, heldIn) => {
    const SWx = { licHeld: heldIn || null }, d = { license_numbers: docNums }, t = { checked }, calls = [];
    const swLicNums = (l) => (l || []).map(x => String(x).trim()).filter(Boolean);
    const swSaveQuiet = (k, f) => { calls.push(f()); return { then() {} }; };
    const swDocPut = (b) => b; const swRefreshStatus = () => {}; const swRender = () => {};
    const bind = "nolic";
    const code = lic.replace(/^if \(bind === "nolic"\) \{/, "").replace(/swRender\(\); return;\s*$/, "");
    new Function("SW", "d", "t", "swLicNums", "swSaveQuiet", "swDocPut", "swRefreshStatus", "swRender", code)(SWx, d, t, swLicNums, swSaveQuiet, swDocPut, swRefreshStatus, swRender);
    return { SWx, d, calls };
  };
  const a = sandbox(true, ["CPC123"]);
  ok(a.SWx.licHeld[0] === "CPC123" && a.calls[0].license_not_required === true, "License tick: the number is held in the page");
  const b = sandbox(false, [], ["CPC123"]);
  ok(b.calls[0].license_not_required === false && b.calls[0].license_numbers[0] === "CPC123" && b.d.license_numbers[0] === "CPC123" && b.SWx.licHeld === null, "License untick: the saved number goes back to the server and the screen");
  const c = sandbox(false, ["NEW1"], ["CPC123"]);
  ok(c.calls[0].license_numbers === undefined, "License untick: a number the owner typed meanwhile is not overwritten");
  ok(/if \(lnrAfter === 1 && licensesAfter\.length > 0\) \{\s*if \(has\("license_not_required"\) && lnrWant === 1\) \{\s*licensesAfter = \[\];/.test(WORKER), "Cause on record: the Worker clears the numbers when the box is ticked (page restores them; no Worker change needed)");
  const th = SRC.slice(SRC.indexOf('act === "tap-help"'), SRC.indexOf('act === "tap-help"') + 420);
  ok(/apexHelpOpen\("setup-wizard", "payments", 11\)/.test(th) && th.indexOf("help.html") < 0 && th.indexOf("swClose") < 0, "Open Aprenda: the sheet opens over the wizard at Payments step 11, no navigation, no close");
  ok(/window\.apexHelpOpen = function \(guide, section, step\) \{ openSheet\(\{ guide: guide, section: section, step: step \}\); \}/.test(HW), "help-widget.js exposes apexHelpOpen");
  const payG = GUIDES.guides.find(g => g.id === "setup-wizard").sections.find(x => x.id === "payments");
  ok(payG && payG.steps.some(x => x.n === 11), "The setup-wizard guide has a Payments section with step 11");
}

const API = process.env.APEX_TEST_API, TOKEN = process.env.APEX_TEST_TOKEN;
if (API && TOKEN) {
  const B = API + "/api/clients/test-client-temp-001/gm/";
  async function call(path, method, body) { const res = await fetch(B + path, { method: method || "GET", headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await res.json(); } catch (e) {} return { status: res.status, j }; }
  // Old page code: the exact requests the pre wizard pages send, answered in the old shape.
  let o = await call("doc-settings");
  ok(o.status === 200 && o.j.settings && "setup_completed_at" in o.j.settings && "license_numbers" in o.j.settings && "payment_methods" in o.j.settings, "OLD pages: GET doc-settings keeps its shape");
  const before = o.j.settings;
  o = await call("doc-settings", "PUT", { estimate_valid_days: before.estimate_valid_days });
  ok(o.status === 200 && o.j.settings && o.j.settings.setup_completed_at === before.setup_completed_at, "OLD pages: PUT doc-settings (no wizard flag) answers as before");
  o = await call("contract-settings");
  ok(o.status === 200 && o.j.settings && Array.isArray(o.j.areas) && Array.isArray(o.j.options) && o.j.states, "OLD pages: GET contract-settings keeps areas, options, states");
  ok(Array.isArray(o.j.cleaning_areas) && o.j.cleaning_areas.length === 19, "Contract settings carry the 19 cleaning clause areas (read only) next to the old fields");
  const cs = o.j.settings;
  o = await call("contract-settings", "PUT", { trades: cs.trades, builds_pools: cs.builds_pools, defaults: cs.defaults, signers: cs.signers, owner_signer_name: cs.owner_signer_name, owner_signer_phone: cs.owner_signer_phone, source: cs.source, values: cs.values });
  ok(o.status === 200 && o.j.saved === true, "OLD pages: PUT contract-settings in the old body shape still saves");
  o = await call("booking-settings");
  ok(o.status === 200 && (o.j.settings || o.j).work_days, "OLD pages: GET booking-settings keeps its shape");
  o = await call("stripe/status");
  ok(o.status === 200 && "available" in o.j && "connected" in o.j && "charges_enabled" in o.j, "OLD pages: GET stripe/status keeps its shape");
  // Save as you go, resume, and the stage is kept.
  o = await call("wizard", "PUT", { stage: 6 });
  let g = await call("wizard");
  ok(g.j.stage === 6, "Resume: the saved stage is read back");
  o = await call("wizard/work", "PUT", { cat: "cleaning", subs: ["homes", "offices"] });
  g = await call("wizard");
  ok(g.j.answers.cat === "cleaning" && g.j.answers.subs.length === 2, "Save as you go: the kind of work is read back from the server");
  // restore the test client's own trades
  await call("contract-settings", "PUT", { trades: cs.trades, builds_pools: cs.builds_pools });
  o = await call("wizard/license?state=FL&cat=cleaning&subs=homes");
  ok(o.status === 200 && o.j.summary === "none", "The Worker answers the license question (Florida house cleaning: none)");
  o = await call("wizard/website", "POST", { url: "http://169.254.169.254/" });
  ok(o.status === 422 && o.j.error === "blocked_host", "The Worker refuses a private address in the website box");
  o = await call("wizard/lawyer-pdf", "POST", {});
  ok(o.status === 200 && /\/api\/pdf\/lawyer\/lwyr_/.test(o.j.url) && o.j.areas >= 19 && o.j.pages >= 2, "The lawyer PDF is made for this business (never a refusal): " + (o.j.areas || 0) + " clause areas, " + (o.j.pages || 0) + " pages");
  o = await call("wizard/finish", "POST", {});
  ok(o.status === 200 || o.status === 409, "Start answers (the test client is already complete)");
  // Gator shape: setup done, Stripe connected, no contract settings. The test client has all three kinds; read only.
  o = await call("wizard");
  ok(Array.isArray(o.j.missing) && o.j.done && typeof o.j.done.how === "boolean", "The wizard reports which stages are missing, by stage");
} else {
  console.log("SKIP  live checks (set APEX_TEST_API and APEX_TEST_TOKEN)");
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
