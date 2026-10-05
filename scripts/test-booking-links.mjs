// Booking links on doc.resonateai.online: the REAL docPrettyLink / docLinkServe /
// bkRequestLink cut from worker/index.js, run against an in-memory SQLite.
// No network, no live data.
//
//   node scripts/test-booking-links.mjs
import { makeDb, build, baseStubs } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };

const names = ["docPrettyLink", "docLinkTarget", "docLinkSlugPart", "docLinkRandom", "docLinkServe", "docLinkEsc", "docLinkLogoResponse", "docLinkPreviewTags", "docLinkPageHtml", "bkRequestLink"];
const vars = ["DOC_LINK_ORIGIN", "DOC_LINK_PAGES", "DOC_LINK_LABELS", "DEFAULT_ORIGIN", "GM_DOC_LOOK_TABLES", "DOC_LINK_PAGE_MARK", "DOC_LINK_PAGE_TIMEOUT_MS"];
const stubs = Object.assign({}, baseStubs, {
  linkControlTokenDead: async () => false,
  // The main site does not answer here, so the link forwards as it always
  // did. The page served in place is covered by test-doc-address-stays.mjs.
  fetch: async () => { throw new Error("no network in this test"); },
  handleGetClientLogoImage: async () => new Response("x", { status: 200, headers: { "Content-Type": "image/png" } }),
  APEX_API_BASE: "https://api.x.test"
});
const F = build(names, vars, stubs);

const d = makeDb(["migrations/doc_links.sql"]);
d.raw.exec("CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY, name TEXT)");
d.raw.exec("CREATE TABLE IF NOT EXISTS gm_doc_settings (client_id TEXT PRIMARY KEY, legal_name TEXT)");
d.raw.exec("INSERT INTO clients (id, name) VALUES ('c1', 'Marlow Pool & Patio')");
const env = { DB: d.DB };
const TOK = "a".repeat(48);
const lead = { cliente: "Daniel and Marisa Whitfield" };

const link = await F.bkRequestLink(env, { token: TOK, client_id: "c1" }, lead);
ok(/^https:\/\/doc\.resonateai\.online\/marlow-pool-and-patio\/visit-daniel-and-marisa-whitfield-[a-z0-9]{8}$/.test(link), "lead link shape: " + link);
const again = await F.bkRequestLink(env, { token: TOK, client_id: "c1" }, lead);
ok(again === link, "asking twice returns the same link");
ok(d.q("SELECT COUNT(*) AS c FROM doc_links WHERE kind='booking'")[0].c === 1, "only one row stored for the request");
ok(d.q("SELECT description FROM doc_links WHERE kind='booking'")[0].description === "Book a visit for Daniel and Marisa Whitfield", "lead link description");

const site = await F.docPrettyLink(env, "booking-site", "shine-abc123", "c1", "book", "");
ok(/^https:\/\/doc\.resonateai\.online\/marlow-pool-and-patio\/book-[a-z0-9]{8}$/.test(site), "general link shape: " + site);
ok(await F.docPrettyLink(env, "booking-site", "shine-abc123", "c1", "book", "") === site, "general link is stable");
ok(d.q("SELECT description FROM doc_links WHERE kind='booking-site'")[0].description === "Book a visit", "general link description");

async function serve(url) { return await F.docLinkServe({ url: url, method: "GET" }, env); }
const slugOf = (u) => u.replace("https://doc.resonateai.online/", "");
const quietServe = console.error; console.error = function () {};
const r1 = await serve(link); const h1 = await r1.text();
ok(r1.status === 200 && h1.includes("location.replace(\"https://apex.resonateai.online/book.html?t=" + TOK + "\")"), "lead link forwards to book.html?t=<token> when the page cannot be served in place");
ok(h1.includes("content=\"Marlow Pool &amp; Patio\"") && h1.includes("Book a visit for Daniel and Marisa Whitfield") && h1.includes("preview.png"), "lead card: business name, description, logo");
const r2 = await serve(site); const h2 = await r2.text();
console.error = quietServe;
ok(r2.status === 200 && h2.includes("location.replace(\"https://apex.resonateai.online/book.html?b=shine-abc123\")"), "general link forwards to book.html?b=<slug> when the page cannot be served in place");
ok(h2.includes("og:description\" content=\"Book a visit\""), "general card description");

const bad = { DB: { prepare: function () { throw new Error("db down"); } } };
const quiet = console.error; console.error = function () {};
const f1 = await F.bkRequestLink(bad, { token: TOK, client_id: "c1" }, lead);
const f2 = await F.docPrettyLink(bad, "booking-site", "shine-abc123", "c1", "book", "");
console.error = quiet;
ok(f1 === "https://apex.resonateai.online/book.html?t=" + TOK, "DB failure: lead link falls back to the old address");
ok(f2 === "https://apex.resonateai.online/book.html?b=shine-abc123", "DB failure: general link falls back to the old address");

console.log(fail ? "\n" + fail + " FAILED" : "\nAll checks passed.");
process.exit(fail ? 1 : 0);
