// Customer pages stay on doc.resonateai.online: the REAL docLinkServe and its
// helpers cut from worker/index.js, the REAL page files read from this folder
// in place of the main site, an in-memory SQLite. No network, no live data.
//
//   node scripts/test-doc-address-stays.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { makeDb, build, baseStubs } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };
const root = new URL("../", import.meta.url);
const pageFile = (name) => readFileSync(new URL(name, root), "utf8");

// What the "main site" answers. Each test sets it; every call is recorded.
let site = null; const asked = [];
async function fakeFetch(url, opts) { asked.push(String(url)); return await site(String(url), opts || {}); }
const realSite = async (url) => {
  const name = url.replace("https://apex.resonateai.online/", "");
  return new Response(pageFile(name), { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
};

const names = ["docLinkServe", "docLinkTarget", "docLinkEsc", "docLinkLogoResponse", "docLinkPreviewTags", "docLinkPageHtml",
  "docLinkAddressFor", "docLinkReturnAddress", "linkControlTokenDead", "gmEstLinkDead", "gmDateAddDays", "corsOriginFor"];
const vars = ["DOC_LINK_ORIGIN", "DOC_LINK_PAGES", "DOC_LINK_PAGE_MARK", "DOC_LINK_PAGE_TIMEOUT_MS", "DEFAULT_ORIGIN", "GM_DOC_LOOK_TABLES",
  "LINK_CONTROL", "EST_LINK_EXPIRY_DAYS", "ALLOWED_ORIGINS", "DOC_PAGE_ORIGIN", "PUBLIC_DOC_PATH_RE"];
const F = build(names, vars, Object.assign({}, baseStubs, {
  fetch: fakeFetch, gmEasternToday: () => "2026-10-05",
  gmDocParseJsonObject: (v, d) => { try { return JSON.parse(v); } catch (e) { return d; } },
  handleGetClientLogoImage: async () => new Response("x", { status: 200, headers: { "Content-Type": "image/png", "Content-Disposition": "inline" } }),
  APEX_API_BASE: "https://api.x.test"
}));

const d = makeDb(["migrations/doc_links.sql"]);
d.raw.exec("CREATE TABLE IF NOT EXISTS gm_estimates (id TEXT PRIMARY KEY, client_id TEXT, status TEXT, valid_until TEXT, public_token TEXT, link_disabled_at TEXT, link_enabled_at TEXT, brand_override_json TEXT)");
d.raw.exec("CREATE TABLE IF NOT EXISTS gm_invoices (id TEXT PRIMARY KEY, client_id TEXT, status TEXT, public_token TEXT, link_disabled_at TEXT, brand_override_json TEXT)");
const env = { DB: d.DB };
const T = (ch) => ch.repeat(48);
const link = (slug, kind, tok, desc) => d.raw.prepare("INSERT INTO doc_links (slug, kind, public_token, client_id, title, description) VALUES (?, ?, ?, 'c1', 'Marlow Pool & Patio', ?)").run(slug, kind, tok, desc);
d.raw.prepare("INSERT INTO gm_estimates (id, client_id, status, valid_until, public_token) VALUES ('e1', 'c1', 'sent', '2026-10-26', ?)").run(T("a"));
d.raw.prepare("INSERT INTO gm_estimates (id, client_id, status, valid_until, public_token, link_disabled_at) VALUES ('e2', 'c1', 'sent', '2026-10-26', ?, '2026-10-01 10:00:00')").run(T("d"));
d.raw.prepare("INSERT INTO gm_invoices (id, client_id, status, public_token) VALUES ('i1', 'c1', 'sent', ?)").run(T("b"));
link("marlow-pool-and-patio/est-1001-daniel-whitfield-ab12cd34", "estimate", T("a"), "Estimate EST-1001 for Daniel Whitfield");
link("marlow-pool-and-patio/est-1002-daniel-whitfield-zz12cd34", "estimate", T("d"), "Estimate EST-1002 for Daniel Whitfield");
link("marlow-pool-and-patio/inv-2001-daniel-whitfield-ef56gh78", "invoice", T("b"), "Invoice INV-2001 for Daniel Whitfield");
link("marlow-pool-and-patio/visit-daniel-whitfield-ij90kl12", "booking", T("c"), "Book a visit for Daniel Whitfield");
link("marlow-pool-and-patio/book-mn34op56", "booking-site", "marlowpoolabcd2345", "Book a visit");

const DOC = "https://doc.resonateai.online/";
const MAIN = "https://apex.resonateai.online/";
async function serve(slug, method) { asked.length = 0; return await F.docLinkServe({ url: DOC + slug, method: method || "GET" }, env); }

// Runs what the Worker added to <head>, then the page's own token lines, in a
// bare window on the doc address. Returns what the page ends up holding.
function pageReads(html, slug, firstVar, lastMark, wanted) {
  const added = /<script>(window\.DOC_PAGE_LINK=[\s\S]*?)<\/script>/.exec(html);
  if (!added) { return null; }
  const store = {};
  const win = { location: { search: "", href: DOC + slug, pathname: "/" + slug, origin: "https://doc.resonateai.online", hash: "" },
    sessionStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } } };
  const ctx = vm.createContext({ window: win, document: { addEventListener: function () {} } });
  vm.runInContext(added[1], ctx);
  const a = html.indexOf(firstVar); const b = html.indexOf(lastMark, a);
  if (a < 0 || b < 0) { return null; }
  vm.runInContext(html.slice(a, b), ctx);
  return vm.runInContext("(" + wanted + ")", ctx);
}

const cases = [
  { name: "estimate", slug: "marlow-pool-and-patio/est-1001-daniel-whitfield-ab12cd34", file: "estimate-view.html", desc: "Estimate EST-1001 for Daniel Whitfield",
    first: "var docLink =", last: "function escHtml", want: "{ token: token }", expect: { token: T("a") }, own: "id=\"btnPdf\"" },
  { name: "invoice", slug: "marlow-pool-and-patio/inv-2001-daniel-whitfield-ef56gh78", file: "invoice-view.html", desc: "Invoice INV-2001 for Daniel Whitfield",
    first: "var docLink =", last: "function escHtml", want: "{ token: token }", expect: { token: T("b") }, own: "function payByCard" },
  { name: "booking (lead)", slug: "marlow-pool-and-patio/visit-daniel-whitfield-ij90kl12", file: "book.html", desc: "Book a visit for Daniel Whitfield",
    first: "var qs =", last: "var lang =", want: "{ leadToken: leadToken, siteSlug: siteSlug }", expect: { leadToken: T("c"), siteSlug: null }, own: "function afterBooked" },
  { name: "booking (general)", slug: "marlow-pool-and-patio/book-mn34op56", file: "book.html", desc: "Book a visit",
    first: "var qs =", last: "var lang =", want: "{ leadToken: leadToken, siteSlug: siteSlug }", expect: { leadToken: null, siteSlug: "marlowpoolabcd2345" }, own: "function afterBooked" }
];

for (const c of cases) {
  site = realSite;
  const r = await serve(c.slug); const h = await r.text();
  const src = pageFile(c.file);
  ok(r.status === 200 && h.includes(c.own) && h.endsWith(src.slice(src.indexOf("<body"))), c.name + ": 200 with the real page (" + c.file + "), body untouched");
  ok(asked.length === 1 && asked[0] === MAIN + c.file, c.name + ": the page file is read from the main site on this visit: " + asked.join(", "));
  ok(h.includes("property=\"og:title\" content=\"Marlow Pool &amp; Patio\"") && h.includes("property=\"og:description\" content=\"" + c.desc + "\"") &&
     h.includes("property=\"og:image\" content=\"" + DOC + c.slug + "/preview.png\"") && h.includes("property=\"og:url\" content=\"" + DOC + c.slug + "\"") &&
     h.includes("<title>Marlow Pool &amp; Patio</title>") && (h.match(/<title>/g) || []).length === 1, c.name + ": preview tags present (title, description, logo picture, address)");
  ok(!/http-equiv="refresh"/i.test(h) && !h.includes("location.replace(\"https://apex.resonateai.online") && !h.includes("location.replace(\"" + MAIN),
    c.name + ": no forward to apex.resonateai.online in the answer");
  ok(!h.includes("?t=" + c.expect.token) && !h.includes("?t=" + c.expect.leadToken) && !h.includes("?b=" + c.expect.siteSlug), c.name + ": no ?t= / ?b= address anywhere in the answer");
  const got = pageReads(h, c.slug, c.first, c.last, c.want);
  ok(JSON.stringify(got) === JSON.stringify(c.expect), c.name + ": the page's own code ends up with the token, with nothing in the address: " + JSON.stringify(got));
  const baseAt = h.indexOf("<base href=\"" + MAIN + "\">");
  const firstRel = h.search(/<(link|script|img)\b[^>]*(href|src)=/i);
  ok(baseAt > 0 && baseAt < firstRel && (h.match(/<base\b/gi) || []).length === 1, c.name + ": one <base> for the main site, before the first style or script");
  const css = /<link rel="stylesheet" href="([^"]+)"/.exec(h); const js = /<script src="([^"]+)"/.exec(h);
  ok(css && new URL(css[1], MAIN).href.indexOf(MAIN + "doc-hero.css") === 0 && js && new URL(js[1], MAIN).href.indexOf(MAIN + "doc-hero.js") === 0 &&
     new URL("/privacy.html", MAIN).href === MAIN + "privacy.html", c.name + ": relative addresses resolve to the main site (" + (css && css[1]) + ", " + (js && js[1]) + ")");
  ok(r.headers.get("Cache-Control") === "no-store" && r.headers.get("X-Robots-Tag") === "noindex" && /noindex/.test(h), c.name + ": no-store and noindex");
  ok(!/serviceWorker|rel=["']?manifest|pwa\.js|beforeinstallprompt/i.test(h), c.name + ": no service worker, manifest or install prompt in the answer");

  // The main site does not answer: today's forward.
  for (const [why, bad] of [
    ["the fetch throws", async () => { throw new Error("network down"); }],
    ["the main site answers 500", async () => new Response("oops", { status: 500, headers: { "Content-Type": "text/html" } })],
    ["the main site answers 404", async () => new Response("<html><head></head><body>Not found</body></html>", { status: 404, headers: { "Content-Type": "text/html" } })],
    ["the answer is not HTML", async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } })],
    ["the page is a version from before this change", async () => new Response(src.split("DOC_PAGE_LINK").join("OLD_PAGE"), { status: 200, headers: { "Content-Type": "text/html" } })],
    ["the page is cut short", async () => new Response(src.slice(0, 3000) + "DOC_PAGE_LINK", { status: 200, headers: { "Content-Type": "text/html" } })]
  ]) {
    site = bad;
    const quiet = console.error; console.error = function () {};
    const fr = await serve(c.slug); const fh = await fr.text();
    console.error = quiet;
    const target = F.docLinkTarget(c.name === "booking (general)" ? "booking-site" : (c.name === "booking (lead)" ? "booking" : c.name), c.expect.token || c.expect.leadToken || c.expect.siteSlug);
    ok(fr.status === 200 && fh.includes("location.replace(" + JSON.stringify(target) + ")") && fh.includes("http-equiv=\"refresh\" content=\"0;url=" + target) &&
       fh.includes("property=\"og:description\" content=\"" + c.desc + "\"") && !fh.includes("DOC_PAGE_LINK") && fr.headers.get("Cache-Control") === "no-store",
       c.name + ": " + why + " -> falls back to the forward (" + target.replace(/[a-f0-9]{48}/, "<token>") + ") with the preview tags");
  }
}

// Every other customer page carries the mark and is served the same way.
site = realSite;
for (const [kind, file] of [["receipt", "receipt-view.html"], ["contract", "contract-view.html"], ["change-order", "change-order-view.html"], ["ack", "ack-view.html"], ["apex-contract", "apex-contract.html"], ["apex-invoice", "apex-invoice-view.html"]]) {
  asked.length = 0;
  const html = await F.docLinkPageHtml({ kind: kind, public_token: T("e"), title: "Biz", description: "Doc" }, "biz/doc-x", "<meta property=\"og:title\" content=\"Biz\">");
  const got = html ? pageReads(html, "biz/doc-x", "var docLink =", "var token =", "docToken") : null;
  ok(!!html && asked[0] === MAIN + file && got === T("e") && /var token = docToken \|\| /.test(html), kind + ": " + file + " is served in place and reads its token from the Worker");
}

// The forward and the page share the same preview tags, byte for byte.
{
  site = realSite; const a = await (await serve(cases[0].slug)).text();
  site = async () => { throw new Error("down"); };
  const quiet = console.error; console.error = function () {};
  const b = await (await serve(cases[0].slug)).text();
  console.error = quiet;
  const tags = (h) => (h.match(/<meta (property="og:[^>]*|name="twitter:card"[^>]*)>/g) || []).join("");
  ok(tags(a).length > 200 && tags(a) === tags(b), "the preview tags are identical on the page and on the forward");
}

// Dead and unknown links: 404 and the same message, and the main site is never asked.
site = realSite;
for (const [why, slug] of [["a disabled estimate", "marlow-pool-and-patio/est-1002-daniel-whitfield-zz12cd34"], ["an unknown link", "marlow-pool-and-patio/nothing-here-00000000"]]) {
  const r = await serve(slug); const h = await r.text();
  ok(r.status === 404 && h.includes("This link is not valid. Please ask the business to send it again.") && r.headers.get("X-Robots-Tag") === "noindex" && asked.length === 0 && !h.includes("DOC_PAGE_LINK"),
    why + " answers 404 with the \"not valid\" page and no document");
}
{
  d.raw.prepare("UPDATE gm_estimates SET valid_until = '2026-01-01' WHERE id = 'e1'").run();
  const r = await serve(cases[0].slug);
  ok(r.status === 404 && asked.length === 0, "an expired estimate answers 404");
  d.raw.prepare("UPDATE gm_estimates SET valid_until = '2026-10-26' WHERE id = 'e1'").run();
}

// The preview picture: GET and HEAD, and the page's HEAD, never read the page file.
{
  const g = await serve(cases[0].slug + "/preview.png"); const body = await g.text();
  ok(g.status === 200 && g.headers.get("Content-Type") === "image/png" && body === "x" && !g.headers.get("Content-Disposition") && asked.length === 0, "preview picture answers GET");
  const hd = await serve(cases[0].slug + "/preview.png", "HEAD");
  ok(hd.status === 200 && hd.headers.get("Content-Type") === "image/png" && (await hd.text()) === "" && asked.length === 0, "preview picture answers HEAD with no body");
  const ph = await serve(cases[0].slug, "HEAD");
  ok(ph.status === 200 && (await ph.text()) === "" && ph.headers.get("Cache-Control") === "no-store" && asked.length === 0, "HEAD on the page answers 200 with no body");
}

// A value that could break out of the script cannot.
{
  site = realSite;
  const html = await F.docLinkPageHtml({ kind: "estimate", public_token: "</script><script>alert(1)</script>", title: "A </title><b>", description: "D" }, "biz/x", "");
  ok(html.indexOf("</script><script>alert(1)") === -1 && html.includes("<title>A &lt;/title&gt;&lt;b&gt;</title>"), "token and title are escaped where they are written");
}

// The API answers the doc page's Origin on the public document routes only.
{
  const rq = (origin, path) => ({ url: "https://apex-api.farfromtimnah.workers.dev" + path, headers: { get: (k) => (k === "Origin" ? origin : null) } });
  const D = "https://doc.resonateai.online";
  ok(F.corsOriginFor(rq(D, "/api/public/estimates/" + T("a"))) === D && F.corsOriginFor(rq(D, "/api/public/booking/site/abc/book")) === D &&
     F.corsOriginFor(rq(D, "/api/public/pdf/estimate/" + T("a"))) === D && F.corsOriginFor(rq(D, "/api/public/invoices/" + T("b") + "/pay")) === D, "doc origin is echoed on the public document routes");
  ok(F.corsOriginFor(rq(D, "/api/clients/c1/gm/leads")) === MAIN.slice(0, -1) && F.corsOriginFor(rq(D, "/api/login")) === MAIN.slice(0, -1) && F.corsOriginFor(rq(D, "/api/finance-new/invoices")) === MAIN.slice(0, -1),
    "doc origin is NOT echoed on any other route");
  ok(F.corsOriginFor(rq(D + ".evil.com", "/api/public/estimates/x")) === MAIN.slice(0, -1) && F.corsOriginFor(rq("https://evil.doc.resonateai.online", "/api/public/estimates/x")) === MAIN.slice(0, -1) &&
     F.corsOriginFor(rq("http://doc.resonateai.online", "/api/public/estimates/x")) === MAIN.slice(0, -1), "look-alike origins get the locked-down default");
  ok(F.corsOriginFor(rq(MAIN.slice(0, -1), "/api/clients/c1/gm/leads")) === MAIN.slice(0, -1) && F.corsOriginFor(rq("capacitor://localhost", "/api/login")) === "capacitor://localhost" &&
     F.corsOriginFor(rq(null, "/api/login")) === MAIN.slice(0, -1), "the main site, the iOS app and no Origin answer as before");

  // Back from Stripe: the readable address only for a request from the doc page.
  ok(await F.docLinkReturnAddress(env, rq(D, "/x"), "invoice", T("b")) === DOC + "marlow-pool-and-patio/inv-2001-daniel-whitfield-ef56gh78", "card payment asked from the doc page returns to the readable address");
  ok(await F.docLinkReturnAddress(env, rq(MAIN.slice(0, -1), "/x"), "invoice", T("b")) === null && await F.docLinkReturnAddress(env, rq(null, "/x"), "invoice", T("b")) === null,
    "card payment asked from the old address returns to the old address");
  ok(await F.docLinkReturnAddress(env, rq(D, "/x"), "invoice", T("f")) === null, "no readable link stored: the old address");
  const quiet = console.error; console.error = function () {};
  ok(await F.docLinkReturnAddress({ DB: { prepare: function () { throw new Error("db down"); } } }, rq(D, "/x"), "invoice", T("b")) === null, "DB failure: the old address");
  console.error = quiet;
}

console.log(fail ? "\n" + fail + " FAILED" : "\nAll checks passed.");
process.exit(fail ? 1 : 0);
