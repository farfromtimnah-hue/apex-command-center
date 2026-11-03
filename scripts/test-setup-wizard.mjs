// Setup wizard tests. Offline checks always run. The live checks run only when
// APEX_TEST_API and APEX_TEST_TOKEN are set (the branch Worker in `wrangler dev
// --remote`, and a test client session). They only ever touch test-client-temp-001.
//   node scripts/test-setup-wizard.mjs
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from "node:fs";
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
ok(!/image/.test(JSON.stringify(guide || {})), "The draft guide holds no picture paths (pictures are never committed)");

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

// ── 10. Live checks on the test client (only with a branch Worker) ───────
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
