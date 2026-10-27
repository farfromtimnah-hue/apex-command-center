// Security phase B: the Learn (Aprenda) guides and their media are private.
// The REAL functions are cut out of worker/index.js and run against the REAL
// help/guides.json, a fake R2 bucket and a fake clock. No network, no database.
//
//   node scripts/test-help-private.mjs
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { build, workerSrc } from "./fixtures/d1-shim.mjs";

const require = createRequire(import.meta.url);
const root = new URL("../", import.meta.url);
const core = require("../help-core.js");
const REAL = JSON.parse(readFileSync(new URL("help/guides.json", root), "utf8"));

let fail = 0, pass = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (c) { pass++; } else { fail++; } };

// ---- fake clock
let NOW = Date.parse("2026-10-26T15:00:00Z");
class FakeDate extends Date { constructor(...a) { if (a.length) { super(...a); } else { super(NOW); } } static now() { return NOW; } }

// ---- the real functions
const FNS = ["helpGuideAudience", "helpViewerRoleToken", "helpGuideVisibleTo", "helpFilterGuides", "helpViewerRole", "helpIndexFor", "helpBuildIndex",
  "helpBuildOtherList", "helpClampResult", "helpGuideMap", "helpFileGuideMap", "helpFileOwner", "helpFileOwners", "helpB64hex", "helpLinkSig", "helpSameText", "helpMintLink", "helpPickLang",
  "helpUrlPath", "helpBuildPayload", "helpNoStoreJson", "helpNotFound", "helpParseRange", "handleGetHelpFile", "handleGetHelpGuides", "handleGetHelpPublic",
  "publicReadRateLimited", "handlePostHelpAsk", "validateHelpReply", "supportStaffAuthed", "helpSystemText", "helpPageKey", "supportFeatureGuideFor", "supportPageIsPortal"];
const VARS = ["HELP_ADMIN_TOKENS", "HELP_CLIENT_TOKENS", "HELP_ROLE_SET", "HELP_DEFAULT_WHO", "HELP_LINK_TTL_SEC", "HELP_FILE_IP_LIMIT", "HELP_LINK_KEY_CACHE",
  "HELP_TYPES", "HELP_ROLE_INDEXES", "HELP_GUIDE_BY_ID", "HELP_FILE_GUIDES", "HELP_INDEXES", "HELP_OTHERS", "PUBLIC_READ_HITS", "PUBLIC_READ_HITS_SWEPT", "HELP_AI_MODEL",
  "SUPPORT_FEATURE_GUIDE_STAFF_PT", "SUPPORT_FEATURE_GUIDE_STAFF_EN", "SUPPORT_FEATURE_GUIDE_PORTAL_PT", "SUPPORT_FEATURE_GUIDE_PORTAL_EN"];

let currentUser = null;
let claudeCalls = [];
let claudeAnswer = null;
const jsonOk = (d) => ({ status: 200, data: d });
const jsonErr = (m, s) => ({ status: s || 400, error: m });
function stubsFor(clientStatus) {
  return {
    HELP_GUIDES_V1: REAL,
    Date: FakeDate,
    CORS_HEADERS: { "Access-Control-Allow-Origin": "https://apex.resonateai.online", "Vary": "Origin" },
    authenticate: async () => currentUser,
    jsonOk, jsonErr,
    claudeBudgetGate: async () => null,
    claudeBudgetMissAllowed: async () => false,
    CLAUDE_API_URL: "https://api.anthropic.com/v1/messages",
    fetch: async (url, init) => { claudeCalls.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify(claudeAnswer) }] }) }; },
    console: { error: () => {}, log: () => {}, warn: () => {} },
    clientStatus: () => clientStatus
  };
}
const W = build(FNS, VARS, stubsFor(null));

// ---- fake R2: bytes by key
const bytesOf = (key) => { const b = new Uint8Array(100 + (key.length % 7)); for (let i = 0; i < b.length; i++) { b[i] = (key.charCodeAt(i % key.length) + i) & 255; } return b; };
function fakeAssets(extra) {
  const objs = new Map();
  const add = (k) => objs.set(k, bytesOf(k));
  // every picture, poster and video the guides name
  REAL.guides.forEach((g) => {
    g.sections.forEach((s) => s.steps.forEach((st) => { if (st.image) { add(st.image.pt); add(st.image.en); } }));
    if (g.video) { ["pt", "en"].forEach((l) => { const v = g.video[l]; if (v) { add(new URL(v.src).pathname.slice(1)); if (v.poster) { add(new URL(v.poster).pathname.slice(1)); } } }); }
  });
  (extra || []).forEach(add);
  const log = { heads: 0, gets: 0 };
  return {
    log, objs,
    head: async (k) => { log.heads++; return objs.has(k) ? { size: objs.get(k).length } : null; },
    get: async (k, opts) => {
      log.gets++;
      if (!objs.has(k)) { return null; }
      let b = objs.get(k);
      if (opts && opts.range) { b = b.slice(opts.range.offset, opts.range.offset + opts.range.length); }
      return { size: objs.get(k).length, body: new Response(b).body };
    }
  };
}
const dbEnv = (status) => ({ prepare: () => ({ bind: () => ({ first: async () => (status === undefined ? null : { status }), run: async () => { throw new Error("D1 write in a help route"); } }) }) });
const mkEnv = (status, secret) => ({ HELP_LINK_SECRET: secret === undefined ? "test-secret-not-real" : secret, ASSETS: fakeAssets(), DB: dbEnv(status) });
const ORIGIN = "https://apex-api.test";
const getReq = (path, headers, method) => new Request(ORIGIN + path, { method: method || "GET", headers: Object.assign({ "CF-Connecting-IP": "1.2.3.4" }, headers || {}) });

const USERS = {
  owner: { role: "client", client_id: "c1", username: "owner1", login_role: "client" },
  partner: { role: "client", client_id: "c1", username: "p1", login_role: "partner" },
  staff_finance: { role: "client", client_id: "c1", username: "sf1", login_role: "staff_finance" },
  staff: { role: "client", client_id: "c1", username: "s1", login_role: "staff" },
  seller: { role: "client", client_id: "c1", username: "sel1", login_role: "seller", seller_name: "Sel" },
  lead: { role: "client", client_id: "c1", username: "lead1", login_role: "client", status: "lead" },
  alice: { role: "alice", email: "a@x.test" },
  rafa: { role: "rafa", email: "r@x.test" },
  developer: { role: "developer", email: "d@x.test" }
};
const TOKENS = ["owner", "partner", "staff_finance", "staff", "seller", "lead", "alice", "rafa", "developer", null];
const allIds = REAL.guides.map((g) => g.id);
const idsFor = (role) => allIds.filter((id) => W.helpGuideVisibleTo(REAL.guides.find((g) => g.id === id), REAL.groups, role));
const publicIds = REAL.guides.filter((g) => (g.who || []).includes("public")).map((g) => g.id);

// ================================================================ A. every role against every guide
{
  const counts = { owner: 81, partner: 81, staff_finance: 64, staff: 55, seller: 38, lead: 14, alice: 126, rafa: 126, developer: 126, none: 2 };
  TOKENS.forEach((r) => {
    const got = idsFor(r);
    const core2 = allIds.filter((id) => core.guideVisibleTo(REAL.guides.find((g) => g.id === id), REAL.groups, r));
    ok(JSON.stringify(got) === JSON.stringify(core2), "parity: the Worker and HelpCore agree on all " + allIds.length + " guides for " + (r || "signed out"));
    ok(got.length === counts[r || "none"], (r || "signed out") + " sees " + counts[r || "none"] + " guides (got " + got.length + ")");
  });
  ["alice", "rafa", "developer"].forEach((r) => ok(idsFor(r).length === allIds.length, r + " sees every guide on both sides"));
  ok(JSON.stringify(idsFor(null)) === JSON.stringify(publicIds) && publicIds.join() === "sign-in-screens,invited-person-sign-in", "signed out sees only the two public guides");
  const admins = REAL.guides.filter((g) => g.audience === "admin").map((g) => g.id);
  ["owner", "partner", "staff_finance", "staff", "seller", "lead", null].forEach((r) => ok(idsFor(r).every((id) => !admins.includes(id)), (r || "signed out") + " never gets an admin guide"));
  const sellerSees = idsFor("seller"), staffSees = idsFor("staff");
  ["card-payments-setup", "finances", "analytics", "daily-log", "people-and-access", "business-setup", "salespeople-and-lists", "pricing-setup", "home-alerts"].forEach((id) => ok(!sellerSees.includes(id), "a seller cannot get the owner side guide " + id));
  ["finances", "analytics", "daily-log", "monthly-goals", "invoice", "receipt", "invoices-and-payments", "card-payments-setup", "people-and-access"].forEach((id) => ok(!staffSees.includes(id), "staff without finance cannot get " + id));
  ["estimate", "contract", "pricing-setup", "projects", "pipeline"].forEach((id) => ok(staffSees.includes(id), "staff without finance can get " + id + " (cost and profit are part of their view)"));
  ok(idsFor("staff_finance").includes("finances") && !idsFor("staff_finance").includes("card-payments-setup"), "staff with finance gets Finances but not the Settings guides");
  ok(["invoice", "receipt", "reported-payments", "estimate"].every((id) => sellerSees.includes(id)), "a seller gets the invoice, receipt, reported payment and estimate guides");
  ok(idsFor("lead").join() === "documents,my-devices,use-learn-and-language,assigned-tools,business-xray,other-assessments,sign-in-screens,invited-person-sign-in,delete-my-account,management-xray,leadership-xray,permissiveness-xray,failures-xray,growth-pillars", "a lead sees only Assigned, Documents, language, sign in and account guides");
  ok(idsFor("apex_seller").join() === publicIds.join(), "the reserved apex_seller token sees only the public guides");
}

// ================================================================ B. unknown values fail closed
{
  const g = REAL.guides.find((x) => x.id === "estimate");
  const bad = Object.assign({}, g, { who: ["typo-group"] });
  ok(["owner", "seller", "lead", null, "alice"].every((r) => (r === "alice") === W.helpGuideVisibleTo(bad, REAL.groups, r)), "an unknown who entry hides the guide from everyone except the admins");
  ok(W.helpGuideVisibleTo(g, REAL.groups, "wizard") === false && W.helpGuideVisibleTo(g, REAL.groups, 7) === false, "an unknown role token sees nothing");
  ok(W.helpGuideVisibleTo(g, null, "owner") === false, "with no groups object a group name hides the guide");
  ok(W.helpGuideVisibleTo(Object.assign({}, g, { who: [] }), REAL.groups, "owner") === false, "an empty who list hides the guide");
  ok(W.helpGuideVisibleTo(Object.assign({}, g, { audience: "bogus" }), REAL.groups, "owner") === false, "a bad audience hides the guide from a client");
  ok(W.helpGuideVisibleTo(Object.assign({}, g, { who: ["all"] }), { all: ["owner", "lead"] }, "lead") === false, "lead inside a group is ignored");
  ok(W.helpGuideVisibleTo(Object.assign({}, g, { who: ["owner", "lead"] }), REAL.groups, "lead") === true, "lead named directly in who is allowed");
  ok(W.helpViewerRoleToken({ role: "client", login_role: "unknown" }) === null && W.helpViewerRoleToken({ role: "vault-service" }) === null && W.helpViewerRoleToken(undefined) === null, "an unknown login kind has no role token");
  const infos = [{ role: "client" }, { role: "client", login_role: "client" }, { role: "client", login_role: "partner" }, { role: "client", login_role: "seller", client_status: "lead" }, { role: "client", login_role: "staff", client_status: "active" },
    { role: "alice" }, { role: "developer", login_role: "staff" }, { role: "client", login_role: "owner" }, null];
  ok(infos.every((i) => W.helpViewerRoleToken(i) === core.viewerRoleToken(i)), "parity: viewerRoleToken agrees between the Worker and HelpCore");
}

// ================================================================ C. filterGuides and the guide list route
{
  const f = W.helpFilterGuides(REAL, "seller", "admin");
  ok(f.guides.length === 38 && !("groups" in f) && f.guides.every((g) => !("who" in g)), "filterGuides for a seller: 38 guides, no groups, no who lists");
  ok(Object.keys(f.pages).every((k) => f.pages[k].guides.every((id) => f.guides.some((g) => g.id === id))), "the screen overviews list only visible guides");
  ok(W.helpFilterGuides(REAL, "alice", "client").guides.length === 84 && W.helpFilterGuides(REAL, "alice", "admin").guides.length === 42, "staff pick a side: 84 client guides or 42 admin guides");
  ok(JSON.stringify(W.helpFilterGuides(REAL, "staff", "x").guides.map((g) => g.id)) === JSON.stringify(core.filterGuides(REAL, "staff", "x").guides.map((g) => g.id)), "parity: filterGuides agrees between the Worker and HelpCore");
}

async function guidesFor(key, query, extraHeaders, status, secret) {
  currentUser = key === null ? null : (typeof key === "string" ? USERS[key] : key);
  const env = mkEnv(status !== undefined ? status : (key === "lead" ? "lead" : "active"), secret);
  const w = build(FNS, VARS, stubsFor());
  const r = await w.handleGetHelpGuides(getReq("/api/help/guides" + (query || ""), extraHeaders), env);
  return { r, env, w };
}
{
  const anon = await guidesFor(null);
  ok(anon.r.status === 401, "the guide list needs a login: signed out is 401");
  const unk = await guidesFor({ role: "client", client_id: "c1", username: "u", login_role: "unknown" });
  ok(unk.r.status === 403, "a login kind the Worker does not know gets 403");
}
// the route returns a Response; read it
async function payload(key, query, extraHeaders, status, secret) {
  const g = await guidesFor(key, query, extraHeaders, status, secret);
  return { res: g.r, json: g.r.status === 200 ? await g.r.json() : null, env: g.env, w: g.w };
}
{
  const o = await payload("owner", "?lang=pt");
  ok(o.res.headers.get("Cache-Control") === "private, no-store", "guide list: Cache-Control is private, no-store");
  ok(!o.res.headers.get("Set-Cookie"), "guide list: no Set-Cookie");
  ok(o.json.guides.length === 81 && o.json.audience === "client" && o.json.lang === "pt", "an owner gets 81 client guides in Portuguese");
  const text = JSON.stringify(o.json);
  ok(!/"who"|"groups"/.test(text), "the answer carries no who list and no groups object");
  ok(!/apex\.resonateai\.online\/help\//.test(text) && !/"help\/img\//.test(text), "no public static address of any picture or video is in the answer");
  ok(o.json.guides.every((g) => g.title && g.title.pt && g.title.en === undefined && g.summary.en === undefined), "only the asked language is sent (titles and summaries)");
  const imgs = [];
  o.json.guides.forEach((g) => g.sections.forEach((s) => s.steps.forEach((st) => { if (st.image) { imgs.push(st.image.pt); } })));
  ok(imgs.length > 300 && imgs.every((u) => typeof u === "string" && u.startsWith(ORIGIN + "/api/help/file/help/img/guides/") && /[?&]e=\d+&g=owner&s=[a-f0-9]{64}$/.test(u)), "every picture is a signed link on the Worker (" + imgs.length + " links)");
  const vids = o.json.guides.filter((g) => g.video && g.video.pt).map((g) => g.video.pt);
  ok(vids.length === 7 && vids.every((v) => v.src.startsWith(ORIGIN + "/api/help/file/help/video/") && v.poster.startsWith(ORIGIN + "/api/help/file/help/video/")), "the seven videos and posters are signed links");
  ok(o.json.guides.every((g) => g.buttons === undefined || g.buttons.every((b) => b.labels.pt && b.labels.en)), "button labels keep both languages (they match words on the page)");
  const en = await payload("owner", "?lang=en");
  ok(en.json.lang === "en" && en.json.guides.every((g) => g.title.en && g.title.pt === undefined), "English comes back as English only");
  const nosecret = await payload("owner", "?lang=pt", undefined, undefined, "");
  ok(nosecret.res.status === 200 && nosecret.json.media === false && JSON.stringify(nosecret.json).indexOf("/api/help/file/") === -1, "without the link secret the text still comes and no media link or public address is sent");

  // a seller
  const s = await payload("seller", "?lang=pt&role=developer&audience=admin&login_role=owner&who=owner", { "X-Role": "developer", "X-Login-Role": "owner" });
  const sIds = s.json.guides.map((g) => g.id);
  ok(s.json.audience === "client" && sIds.length === 38 && sIds.join() === idsFor("seller").join(), "a seller who sends role=developer, audience=admin and other fields still gets the 33 seller guides");
  const sText = JSON.stringify(s.json);
  ok(!/guides\/(card-payments-setup|finances|analytics|daily-log)\//.test(sText), "a seller's answer holds no picture link of an owner only guide");
  const ownerOnly = allIds.filter((id) => !sIds.includes(id));
  ok(ownerOnly.every((id) => sText.indexOf('"id":"' + id + '"') === -1 && sText.indexOf("/guides/" + id + "/") === -1), "a seller's answer names none of the other " + ownerOnly.length + " guides");
  const hsrc = workerSrc.slice(workerSrc.indexOf("async function handleGetHelpGuides("), workerSrc.indexOf("async function handleGetHelpPublic("));
  ok(/helpViewerRole\(env, user\)/.test(hsrc) && !/get\("(role|login_role|who|token)"\)/.test(hsrc) && !/headers\.get\(/.test(hsrc), "the route takes the role from the verified session only: it reads no role, who or header field");

  // staff
  const a = await payload("alice", "?lang=pt&audience=admin");
  const c = await payload("rafa", "?lang=pt&audience=client");
  ok(a.json.audience === "admin" && a.json.guides.length === 42 && c.json.audience === "client" && c.json.guides.length === 84, "staff may ask for either side");
  const d = await payload("developer", "?lang=pt");
  ok(d.json.audience === "admin", "staff with no audience field start on the admin side");
  const sf = await payload("staff", "?lang=pt&audience=admin");
  ok(sf.json.audience === "client" && !sf.json.guides.some((g) => g.audience === "admin"), "client staff asking for the admin side get the client side");

  // a lead
  const l = await payload("lead", "?lang=pt");
  ok(l.json.guides.length === 14, "a lead (status read from the clients row) gets the 14 lead guides");
  const lbad = await payload(USERS.owner, "?lang=pt", undefined, "lead");
  ok(lbad.json.guides.length === 14, "an owner login of a client whose status is lead is a lead");
  const dbDown = await payload(USERS.owner, "?lang=pt", undefined, undefined);
  void dbDown;
  const brokenEnv = { HELP_LINK_SECRET: "x", ASSETS: fakeAssets(), DB: { prepare: () => { throw new Error("db down"); } } };
  currentUser = USERS.owner;
  const br = await build(FNS, VARS, stubsFor()).handleGetHelpGuides(getReq("/api/help/guides?lang=pt"), brokenEnv);
  ok(br.status === 200 && (await br.json()).guides.length === 14, "if the clients row cannot be read, the viewer is treated as a lead (the narrowest view)");

  // the public route
  currentUser = null;
  const pw = build(FNS, VARS, stubsFor());
  const pub = await pw.handleGetHelpPublic(getReq("/api/help/public?lang=en"), mkEnv());
  const pj = await pub.json();
  ok(pub.status === 200 && pj.guides.map((g) => g.id).join() === "sign-in-screens,invited-person-sign-in" && pub.headers.get("Cache-Control") === "private, no-store", "the public route sends only the two sign in guides, no-store");
  ok(JSON.stringify(pj).indexOf("&g=anon&") !== -1 && JSON.stringify(pj).indexOf("&g=owner") === -1, "public links are signed for the signed out viewer");
}

// ================================================================ D. the file route
function firstImageLink(json) {
  for (const g of json.guides) { for (const s of g.sections) { for (const st of s.steps) { if (st.image) { return { url: Object.values(st.image)[0], guide: g.id }; } } } }
  return null;
}
async function fetchFile(env, url, headers, method, w, rawPath) {
  const u = new URL(url);
  const worker = w || build(FNS, VARS, stubsFor());
  return worker.handleGetHelpFile(getReq(u.pathname + u.search, headers, method), env, rawPath || u.pathname);
}
async function bodyBytes(res) { return new Uint8Array(await res.arrayBuffer()); }
{
  const o = await payload("owner", "?lang=pt");
  const env = o.env;
  const link = firstImageLink(o.json);
  const res = await fetchFile(env, link.url);
  const key = new URL(link.url).pathname.replace("/api/help/file/", "");
  ok(res.status === 200 && (await bodyBytes(res)).join() === bytesOf(key).join(), "a valid link returns the picture bytes (200)");
  ok(res.headers.get("Content-Type") === "image/jpeg" && res.headers.get("Cache-Control") === "private, no-store" && res.headers.get("X-Content-Type-Options") === "nosniff", "headers: image/jpeg, private no-store, nosniff");
  ok(!res.headers.get("Set-Cookie") && res.headers.get("Accept-Ranges") === "bytes", "headers: no Set-Cookie, Accept-Ranges bytes");

  // expiry
  NOW += 14 * 60 * 1000;
  ok((await fetchFile(env, link.url)).status === 200, "a link still works after 14 minutes");
  NOW += 2 * 60 * 1000;
  const old = await fetchFile(env, link.url);
  ok(old.status === 404 && (await old.text()) === "Not found", "an expired link (16 minutes) is the neutral 404");
  NOW = Date.parse("2026-10-26T15:00:00Z");

  // signature
  const u = new URL(link.url);
  const flip = (s) => s.slice(0, -1) + (s.slice(-1) === "0" ? "1" : "0");
  const badSig = ORIGIN + u.pathname + "?e=" + u.searchParams.get("e") + "&g=" + u.searchParams.get("g") + "&s=" + flip(u.searchParams.get("s"));
  const r1 = await fetchFile(env, badSig);
  ok(r1.status === 404 && (await r1.text()) === "Not found", "a wrong signature is the neutral 404");
  const swapRole = ORIGIN + u.pathname + "?e=" + u.searchParams.get("e") + "&g=alice&s=" + u.searchParams.get("s");
  ok((await fetchFile(env, swapRole)).status === 404, "changing the role in a link breaks the signature (404)");
  const swapExp = ORIGIN + u.pathname + "?e=" + (parseInt(u.searchParams.get("e"), 10) + 5000) + "&g=owner&s=" + u.searchParams.get("s");
  ok((await fetchFile(env, swapExp)).status === 404, "stretching the expiry in a link breaks the signature (404)");
  ok((await fetchFile(env, ORIGIN + u.pathname)).status === 404 && (await fetchFile(env, ORIGIN + u.pathname + "?e=1&g=owner&s=zz")).status === 404, "a link with no parameters, or junk ones, is 404");
  const other = ORIGIN + u.pathname.replace(/[^/]+$/, "other.pt.jpg") + "?" + u.searchParams.toString();
  ok((await fetchFile(env, other)).status === 404, "a signed link used for a different file is 404");
  ok((await fetchFile(env, link.url, undefined, "POST")).status === 404, "POST is 404");
  ok((await fetchFile(mkEnv(undefined, ""), link.url)).status === 404, "with no secret set no link is accepted (404)");
  ok((await fetchFile(mkEnv(undefined, "another-secret"), link.url)).status === 404, "a link made with another secret is 404");

  // role group in the link must be allowed to see the guide that owns the file
  const w = build(FNS, VARS, stubsFor());
  const setupFile = REAL.guides.find((g) => g.id === "card-payments-setup").sections[0].steps.find((s) => s.image).image.pt;
  const mint = async (role, rel) => w.helpMintLink(env, ORIGIN, rel, role);
  ok((await fetchFile(env, await mint("owner", setupFile))).status === 200, "an owner link for a Settings guide picture works");
  for (const r of ["seller", "staff", "staff_finance", "lead", "anon"]) {
    ok((await fetchFile(env, await mint(r, setupFile))).status === 404, "a correctly signed " + r + " link for a Settings guide picture is still 404 (that role may not see the guide)");
  }
  const financeFile = REAL.guides.find((g) => g.id === "finances").sections[0].steps.find((s) => s.image).image.pt;
  ok((await fetchFile(env, await mint("staff", financeFile))).status === 404 && (await fetchFile(env, await mint("staff_finance", financeFile))).status === 200, "a staff link for a Finances picture is 404, a staff_finance link works");
  const signIn = REAL.guides.find((g) => g.id === "sign-in-screens").sections[0].steps.find((s) => s.image).image.pt;
  ok((await fetchFile(env, await mint("anon", signIn))).status === 200, "a signed out link for a sign in guide picture works");
  ok((await fetchFile(env, await mint("apex_seller", setupFile))).status === 404 && (await fetchFile(env, await mint("wizard", signIn))).status === 404, "reserved and unknown role tokens in a link are 404");
  const adminFile = REAL.guides.find((g) => g.id === "admin-invoices").sections[0].steps.find((s) => s.image).image.pt;
  ok((await fetchFile(env, await mint("alice", adminFile))).status === 200 && (await fetchFile(env, await mint("owner", adminFile))).status === 404, "an admin guide picture opens for alice and not for an owner");

  // paths that must never work, even with a valid signature for that very text
  const evil = ["help/img/guides/estimate/../../../wrangler.toml", "help/img/guides/../../x.jpg", "help/img/guides/estimate/a/b.jpg", "help/img/guides/nope-guide/x.pt.jpg",
    "help/img/guides/estimate/x.pt.html", "help/img/guides/estimate/.hidden", "help/video/estimate-pt.exe", "help/video/nope-pt.mp4", "help/img/hero.jpg", "help/img/03-confirmada.png",
    "help/img/guides/estimate/%2e%2e%2fx.jpg", "wrangler.toml", "help/img/guides/estimate/x.pt.jpg%00.html", "help/img/guides/estimate//x.jpg", "help/video/estimate-pt.mp4/../x"];
  for (const p of evil) {
    const e = Math.floor(NOW / 60000) * 60 + 900;
    const sig = await w.helpLinkSig(env, p, e, "alice");
    const res2 = await fetchFile(env, ORIGIN + "/api/help/file/x?e=" + e + "&g=alice&s=" + sig, undefined, undefined, w, "/api/help/file/" + p);
    ok(res2.status === 404, "path " + JSON.stringify(p) + " is 404 even with a valid signature");
  }
  ok(w.helpFileOwner("help/img/guides/estimate/send-01.pt.jpg") === "estimate" && w.helpFileOwner("help/video/receipt-pt.mp4") === "receipt" && w.helpFileOwner("help/video/receipt-pt.jpg") === "receipt", "helpFileOwner maps a picture, a video and a poster to their guide");

  // the R2 object missing
  env.ASSETS.objs.delete(key);
  const miss = await fetchFile(env, link.url);
  ok(miss.status === 404, "a valid link whose file is not in R2 is 404");

  // no D1 and no Set-Cookie: the DB stub throws on any write, and the file route never reads D1
  ok(!/env\.DB/.test(workerSrc.slice(workerSrc.indexOf("async function handleGetHelpFile("), workerSrc.indexOf("\n}\n", workerSrc.indexOf("async function handleGetHelpFile(")))), "the file route touches no database");
}

// ---- video and Range
{
  const o = await payload("owner", "?lang=pt");
  const env = o.env;
  const vid = o.json.guides.find((g) => g.video && g.video.pt).video.pt;
  const key = new URL(vid.src).pathname.replace("/api/help/file/", "");
  const all = bytesOf(key);
  const N = all.length;
  const full = await fetchFile(env, vid.src);
  ok(full.status === 200 && full.headers.get("Content-Type") === "video/mp4" && full.headers.get("Content-Length") === String(N) && full.headers.get("Accept-Ranges") === "bytes", "a video: 200, video/mp4, Content-Length, Accept-Ranges");
  const poster = await fetchFile(env, vid.poster);
  ok(poster.status === 200 && poster.headers.get("Content-Type") === "image/jpeg", "a poster: 200 image/jpeg");
  const r = await fetchFile(env, vid.src, { Range: "bytes=0-9" });
  ok(r.status === 206 && r.headers.get("Content-Range") === "bytes 0-9/" + N && r.headers.get("Content-Length") === "10" && (await bodyBytes(r)).join() === all.slice(0, 10).join(), "Range bytes=0-9: 206, Content-Range, 10 bytes");
  const r2 = await fetchFile(env, vid.src, { Range: "bytes=" + (N - 5) + "-" });
  ok(r2.status === 206 && r2.headers.get("Content-Range") === "bytes " + (N - 5) + "-" + (N - 1) + "/" + N && (await bodyBytes(r2)).join() === all.slice(N - 5).join(), "Range bytes=N-5-: the last 5 bytes");
  const r3 = await fetchFile(env, vid.src, { Range: "bytes=-4" });
  ok(r3.status === 206 && r3.headers.get("Content-Range") === "bytes " + (N - 4) + "-" + (N - 1) + "/" + N && (await bodyBytes(r3)).join() === all.slice(N - 4).join(), "Range bytes=-4: a suffix of 4 bytes");
  const r4 = await fetchFile(env, vid.src, { Range: "bytes=10-" + (N + 5000) });
  ok(r4.status === 206 && r4.headers.get("Content-Range") === "bytes 10-" + (N - 1) + "/" + N, "an end past the file is cut to the file");
  for (const bad of ["bytes=" + N + "-", "bytes=" + (N + 10) + "-" + (N + 20), "bytes=9-2", "bytes=-0", "bytes=-"]) {
    const rb = await fetchFile(env, vid.src, { Range: bad });
    ok(rb.status === 416 && rb.headers.get("Content-Range") === "bytes */" + N, "Range " + bad + " is 416 with Content-Range bytes */" + N);
  }
  const ig = await fetchFile(env, vid.src, { Range: "items=0-3" });
  ok(ig.status === 200 && (await bodyBytes(ig)).length === N, "a Range in another unit is ignored (200, whole file)");
  const multi = await fetchFile(env, vid.src, { Range: "bytes=0-1,5-6" });
  ok(multi.status === 200, "several ranges are ignored (200, whole file)");
  ok(r.headers.get("Cache-Control") === "private, no-store" && !r.headers.get("Set-Cookie") && r.headers.get("X-Content-Type-Options") === "nosniff", "a 206 answer is also no-store, nosniff, no cookie");
  const head = await fetchFile(env, vid.src, undefined, "HEAD");
  ok(head.status === 200 && head.headers.get("Content-Length") === String(N) && (await head.text()) === "", "HEAD: 200, the length, no body");
  const gets0 = env.ASSETS.log.gets;
  await fetchFile(env, vid.src, undefined, "HEAD");
  ok(env.ASSETS.log.gets === gets0, "HEAD reads no body from R2");
}

// ---- rate limit per address, in memory
{
  const o = await payload("owner", "?lang=pt");
  const link = firstImageLink(o.json);
  const w = build(FNS, VARS, stubsFor());
  let last = 0, firstOver = -1;
  for (let i = 1; i <= 3010; i++) {
    const u = new URL(link.url);
    const res = await w.handleGetHelpFile(new Request(ORIGIN + u.pathname + "?e=1&g=owner&s=x", { headers: { "CF-Connecting-IP": "9.9.9.9" } }), o.env, u.pathname);
    last = res.status;
    if (res.status === 429 && firstOver < 0) { firstOver = i; }
  }
  ok(firstOver === 3001 && last === 429, "the file route allows 3000 requests per address in ten minutes, then 429 (in memory)");
  const other = await w.handleGetHelpFile(new Request(link.url, { headers: { "CF-Connecting-IP": "8.8.8.8" } }), o.env, new URL(link.url).pathname);
  ok(other.status === 200, "another address is not affected");
}

// ================================================================ E. routes and allowlists in the source
{
  const flat = workerSrc.replace(/\s+/g, " ");
  const cr = workerSrc.slice(workerSrc.indexOf("function clientRequestAllowed("), workerSrc.indexOf("function clientRequestAllowed(") + 8000);
  const sr = workerSrc.slice(workerSrc.indexOf("function sellerRequestAllowed("), workerSrc.indexOf("function sellerRequestAllowed(") + 3000);
  for (const [name, src] of [["clientRequestAllowed", cr], ["sellerRequestAllowed", sr]]) {
    ok(src.indexOf('"/api/help/guides"') !== -1 && src.indexOf('"/api/help/public"') !== -1 && src.indexOf('"/api/help/file/"') !== -1, name + " lists the guide list, the public list and the file route");
  }
  ok(/path === "\/api\/help\/guides" && method === "GET"\) \{ return handleGetHelpGuides\(request, env\)/.test(flat) && /path === "\/api\/help\/public" && method === "GET"\) \{ return handleGetHelpPublic\(request, env\)/.test(flat) && /path\.indexOf\("\/api\/help\/file\/"\) === 0\) \{ return handleGetHelpFile\(request, env, path\)/.test(flat), "the three routes are registered in the dispatcher");
  const gateAt = workerSrc.indexOf("var gateResponse = await enforceClientRoleGate(request, env, path, method);");
  ok(gateAt !== -1 && gateAt < workerSrc.indexOf('if (path === "/api/help/guides" && method === "GET")'), "the routes sit after the client gate, which now lets them through");
  ok(!/Set-Cookie/i.test(workerSrc.slice(workerSrc.indexOf("async function handleGetHelpFile("), workerSrc.indexOf("async function handleGetHelpFile(") + 4500)), "the file route never sets a cookie");
}

// ================================================================ F. integrity of the real data
{
  const missing = [];
  let n = 0;
  REAL.guides.forEach((g) => {
    g.sections.forEach((s) => s.steps.forEach((st) => {
      if (!st.image) { return; }
      ["pt", "en"].forEach((l) => {
        const p = st.image[l]; n++;
        if (W.helpFileOwners(p).indexOf(g.id) === -1) { missing.push("owner " + g.id + " " + p); }
        if (!existsSync(new URL(p, root)) && !existsSync(new URL(p.replace(/^help\//, "help-private/"), root))) { missing.push("file " + p); }
      });
    }));
    if (g.video) { ["pt", "en"].forEach((l) => { const v = g.video[l]; if (!v) { return; } [v.src, v.poster].filter(Boolean).forEach((u) => { const p = new URL(u).pathname.slice(1); n++; if (W.helpFileOwners(p).indexOf(g.id) === -1) { missing.push("video owner " + g.id + " " + p); } }); }); }
  });
  ok(n > 900 && missing.length === 0, "every one of " + n + " picture, poster and video paths names its guide (a file can belong to several guides) and exists on disk" + (missing.length ? " :: " + missing.slice(0, 3).join(" | ") : ""));
  ok(core.validateTags(REAL).length === 0, "the real file's tags and groups are valid");
}

// ================================================================ G. the Ask index
{
  const hidden = (role) => REAL.guides.filter((g) => !W.helpGuideVisibleTo(g, REAL.groups, role) || g.audience === "admin");
  for (const role of ["seller", "staff", "staff_finance", "lead", "owner"]) {
    const idx = W.helpIndexFor(role, "client");
    const leaks = hidden(role).filter((g) => idx.text.indexOf("id=" + g.id + " ") !== -1 || idx.text.indexOf(g.title.pt) !== -1 || idx.text.indexOf(g.title.en) !== -1);
    ok(leaks.length === 0, "the Ask index for " + role + " names none of the " + hidden(role).length + " guides that " + role + " cannot see" + (leaks.length ? " :: " + leaks.slice(0, 3).map((g) => g.id).join() : ""));
    ok(Object.keys(idx.ids).length === idsFor(role).filter((id) => REAL.guides.find((g) => g.id === id).audience !== "admin").length, "the Ask index for " + role + " holds exactly the guides that " + role + " can see");
  }
  ok(W.helpIndexFor(null, "client").text.split("\n").length === 2, "the Ask index for a signed out viewer holds only the two public guides");
  ok(W.helpIndexFor("alice", "admin").text === W.helpIndexFor("developer", "admin").text && Object.keys(W.helpIndexFor("rafa", "admin").ids).length === 42, "the admin index is the same for the three admins and holds all 42 admin guides");
  ok(W.helpIndexFor("seller", "client") === W.helpIndexFor("seller", "client") && W.helpIndexFor("seller", "client") !== W.helpIndexFor("owner", "client"), "the index is cached per role and is not shared between roles");

  // the real handler: a seller, with a model that tries to name hidden guides
  const run = async (user, body, answer) => {
    currentUser = user; claudeCalls = []; claudeAnswer = answer;
    const w = build(FNS, VARS, stubsFor());
    const res = await w.handlePostHelpAsk({ url: ORIGIN + "/api/help/ask", headers: { get: () => null }, json: async () => body }, mkEnv(user.role === "client" ? "active" : undefined));
    return { res, sys: claudeCalls[0] ? claudeCalls[0].system[0].text : "" };
  };
  const forged = { kind: "answer", guide_ids: ["card-payments-setup", "finances", "estimate"], best: { guide: "finances", section: "x" }, reply: "Veja." };
  const s = await run(USERS.seller, { question: "como configuro cartao?", language: "pt", role: "developer", audience: "admin", login_role: "owner" }, forged);
  ok(s.res.status === 200 && s.res.data.guide_ids.join() === "estimate" && s.res.data.best === null, "a seller asking with a forged model answer gets only the guide the seller can see");
  const hiddenSeller = hidden("seller");
  ok(hiddenSeller.every((g) => s.sys.indexOf("id=" + g.id + " ") === -1 && s.sys.indexOf(g.title.en) === -1), "the system text sent to the model for a seller contains none of the hidden guides");
  ok(s.res.data.audience === "client", "a seller who sends audience=admin is answered from the client side");
  const st = await run(USERS.staff, { question: "como vejo o financeiro?", language: "en" }, { kind: "answer", guide_ids: ["finances", "estimate"], best: null, reply: "ok" });
  ok(st.res.data.guide_ids.join() === "estimate" && st.sys.indexOf("id=finances ") === -1, "staff without finance: the Finances guide is neither shown to the model nor returned");
  const ow = await run(USERS.owner, { question: "como vejo o financeiro?", language: "pt" }, { kind: "answer", guide_ids: ["finances"], best: null, reply: "ok" });
  ok(ow.res.data.guide_ids.join() === "finances" && ow.sys.indexOf("id=finances ") !== -1 && ow.sys.indexOf("id=admin-invoices ") === -1, "an owner gets Finances, and the admin side is never in the owner's prompt");
  const al = await run(USERS.alice, { question: "how do I record a payment?", language: "en", audience: "admin" }, { kind: "answer", guide_ids: ["admin-record-payment"], best: null, reply: "ok" });
  ok(al.res.data.guide_ids.join() === "admin-record-payment" && al.sys.indexOf("id=admin-record-payment ") !== -1, "staff keep the admin side in Ask");
  const alc = await run(USERS.alice, { question: "how do I send an invoice?", language: "en", audience: "client" }, { kind: "answer", guide_ids: ["invoice"], best: null, reply: "ok" });
  ok(alc.res.data.guide_ids.join() === "invoice" && alc.res.data.audience === "client", "staff still ask about the other side");
  // the second check behind the filtered index
  const clamped = W.helpClampResult({ found: true, guide_ids: ["finances", "estimate"], best: { guide: "finances", section: "s" }, reply: "r", other_side: [], kind: "answer" }, "staff", "client");
  ok(clamped.guide_ids.join() === "estimate" && clamped.best === null, "helpClampResult drops a hidden id and a hidden best even if one got through");
  const none = W.helpClampResult({ found: true, guide_ids: ["finances"], best: null, reply: "r", other_side: [], kind: "answer" }, "staff", "client");
  ok(none.found === false && none.guide_ids.length === 0 && none.kind === "missing_guide", "if every id was hidden the answer is 'no guide'");
  const same = { found: true, guide_ids: ["estimate"], best: null, reply: "r", other_side: [], kind: "answer" };
  ok(W.helpClampResult(same, "staff", "client") === same, "an answer with only visible ids passes through unchanged");

  // suggest never receives the guide index
  const sg = workerSrc.slice(workerSrc.indexOf("function helpSuggestSystem("), workerSrc.indexOf("async function handlePostHelpSuggest(")) + workerSrc.slice(workerSrc.indexOf("async function handlePostHelpSuggest("), workerSrc.indexOf("async function handlePostHelpSuggest(") + 9000);
  ok(!/HELP_INDEXES|HELP_OTHERS|helpIndexFor|GUIDE INDEX/.test(sg), "Suggest never receives the guide index, so it cannot name a guide");
}


// ================================================================ H. every role: every link it is given opens, nothing else does
{
  const everyMedia = Object.keys(W.helpFileGuideMap(REAL)).sort();
  let ipN = 10;
  for (const role of ["owner", "partner", "staff_finance", "staff", "seller", "lead", "alice", "rafa", "developer", null]) {
    const key = role === null ? null : role;
    const lang = "pt";
    const o = await payload(key, "?lang=" + lang + (role && ["alice", "rafa", "developer"].includes(role) ? "&audience=client" : ""));
    let urls;
    if (role === null) {
      currentUser = null;
      const pub = await build(FNS, VARS, stubsFor()).handleGetHelpPublic(getReq("/api/help/public?lang=pt"), mkEnv());
      o.json = await pub.json(); o.env = mkEnv();
    }
    urls = [];
    o.json.guides.forEach((g) => { g.sections.forEach((st) => st.steps.forEach((x) => { if (x.image) { urls.push(Object.values(x.image)[0]); } })); if (g.video && g.video.pt) { urls.push(g.video.pt.src); if (g.video.pt.poster) { urls.push(g.video.pt.poster); } } });
    const w = build(FNS, VARS, stubsFor());
    let bad = 0;
    const ip = "10.0." + (ipN++) + ".1";
    for (const u of urls) {
      const x = new URL(u);
      const r = await w.handleGetHelpFile(new Request(u, { headers: { "CF-Connecting-IP": ip } }), o.env, x.pathname);
      if (r.status !== 200) { bad++; }
    }
    ok(urls.length > 0 && bad === 0, (role || "signed out") + ": all " + urls.length + " links in the guide list open (200)");
    // links the Worker would never mint for this role: made by hand, correctly signed, still refused
    const allowed = new Set(urls.map((u) => new URL(u).pathname.replace("/api/help/file/", "")));
    const g = (role === null ? "anon" : role);
    const refused = everyMedia.filter((m) => !allowed.has(m));
    const staffAdmin = role && ["alice", "rafa", "developer"].includes(role);
    let leaked = 0, tried = 0;
    const gm = new Map(REAL.guides.map((x) => [x.id, x]));
    for (const m of refused.filter((_, i) => i % 7 === 0)) {
      const owners = W.helpFileOwners(m);
      const mayBy = owners.some((id) => W.helpGuideVisibleTo(gm.get(id), REAL.groups, role));
      const url = await w.helpMintLink(o.env, ORIGIN, m, g);
      const r = await w.handleGetHelpFile(new Request(url, { headers: { "CF-Connecting-IP": ip } }), o.env, new URL(url).pathname);
      tried++;
      if ((r.status === 200) !== mayBy) { leaked++; }
    }
    ok(tried > 0 && leaked === 0, (role || "signed out") + ": hand made links for files outside its list are refused unless one of the file's guides is visible to it (" + tried + " tried)");
    void staffAdmin;
  }
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
