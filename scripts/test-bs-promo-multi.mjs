// Business System promo page with a LIST of promos: the file name rule
// (bsPromoKey), the signed address, GET /api/bs/promos, PUT
// /api/bs/promos/:slug/:lang, the old routes, the migration, and the page
// script. Runs the REAL Worker code evaled from worker/index.js against an
// in-memory SQLite database. No network, no real token.
//
//   node scripts/test-bs-promo-multi.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";

const here = (p) => new URL("../" + p, import.meta.url);
const worker = readFileSync(here("worker/index.js"), "utf8");
const migOld = readFileSync(here("migrations/clients_plan_and_split.sql"), "utf8");
const migNew = readFileSync(here("migrations/bs_promo_multi.sql"), "utf8");
const page = readFileSync(here("bs-promo.html"), "utf8");

function slice(src, a, b) {
  const i = src.indexOf(a), j = src.indexOf(b, i);
  if (i < 0 || j < 0) { throw new Error("marker not found: " + (i < 0 ? a : b)); }
  return src.slice(i, j);
}
let fails = 0;
const t = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { fails++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label +
    (ok ? "" : "\n        expected " + JSON.stringify(expected) + "\n        got      " + JSON.stringify(actual)));
};

// The old table exactly as the old migration creates it.
const oldPromoSql = migOld.slice(migOld.indexOf("CREATE TABLE IF NOT EXISTS bs_promo_items"));
function makeDb(withNew) {
  const raw = new DatabaseSync(":memory:");
  raw.exec(oldPromoSql);
  if (withNew) { raw.exec(migNew); }
  return {
    raw,
    HELP_LINK_SECRET: "test-only-secret",
    DB: {
      prepare(sql) {
        let binds = [];
        const stmt = {
          bind: (...b) => { binds = b; return stmt; },
          first: async () => raw.prepare(sql).get(...binds) || null,
          all: async () => ({ results: raw.prepare(sql).all(...binds) }),
          run: async () => { raw.prepare(sql).run(...binds); return { success: true }; }
        };
        return stmt;
      }
    }
  };
}

globalThis.jsonOk = (o) => ({ ok: true, status: 200, body: o });
globalThis.jsonErr = (m, code) => ({ ok: false, error: m, status: code });
globalThis.jsonErr2 = (pt, en, code) => ({ ok: false, error: pt + " / " + en, status: code });
let asUser = { role: "alice", display_name: "Alice" };
globalThis.authenticate = async () => asUser;
globalThis.CORS_HEADERS = {};
vm.runInThisContext(slice(worker, "function isAdminRole(user)", "// Rafa and Nicole, NOT Alice."));
vm.runInThisContext(slice(worker, "function actorName(user)", "// ---------------------------------------------------------------------------\n// BUSINESS SYSTEM: clients.plan"));
vm.runInThisContext(slice(worker, "function bsIsStaff(user)", "\n", ));
vm.runInThisContext(slice(worker, "var HELP_LINK_TTL_SEC", "// info: { role, login_role, client_status }"));
vm.runInThisContext(slice(worker, "function helpB64hex(", "async function helpLinkSig("));
vm.runInThisContext(slice(worker, "async function helpLinkSig(", "async function helpMintLink("));
vm.runInThisContext(slice(worker, "function helpParseRange(header, size)", "// GET /api/help/file/<path>?e="));
vm.runInThisContext(slice(worker, "function helpNotFound()", "function helpParseRange("));
vm.runInThisContext(slice(worker, "function bsPromoUrlOk(u)", "// Router for the Business System routes"));
vm.runInThisContext(slice(worker, "var HELP_TYPES", "\n"));
vm.runInThisContext("this.__bsRoute = " + slice(worker, "function bsRoute(", "export default").trim().replace(/\n}\s*$/, "\n}"));

const origin = "https://apex-api.example";
const rq = (url, method, body) => ({ url: origin + url, method: method || "GET", headers: { get: () => null }, json: async () => { if (body === undefined) { throw new Error("no body"); } return body; } });

// ── bsPromoKey ───────────────────────────────────────────────────────────────
t("legacy video-pt.mp4 keeps its key", bsPromoKey("video-pt.mp4"), "help/video/bs-promo-pt.mp4");
t("legacy poster-en.jpg keeps its key", bsPromoKey("poster-en.jpg"), "help/video/bs-promo-en.jpg");
t("new video-one-link-pt.mp4", bsPromoKey("video-one-link-pt.mp4"), "help/video/bs-promo-one-link-pt.mp4");
t("new poster-weather-en.jpg", bsPromoKey("poster-weather-en.jpg"), "help/video/bs-promo-weather-en.jpg");
t("slug with digits", bsPromoKey("video-v2-pt.mp4"), "help/video/bs-promo-v2-pt.mp4");
t("40 character slug is allowed", bsPromoKey("video-" + "a".repeat(40) + "-pt.mp4"), "help/video/bs-promo-" + "a".repeat(40) + "-pt.mp4");
const rejects = {
  "uppercase": "video-One-pt.mp4", "dot in slug": "video-a.b-pt.mp4", "slash": "video-a/b-pt.mp4",
  "double hyphen": "video-a--b-pt.mp4", "leading hyphen": "video--a-pt.mp4", "trailing hyphen": "video-a--pt.mp4",
  "slug over 40": "video-" + "a".repeat(41) + "-pt.mp4", "wrong extension for video": "video-weather-pt.jpg",
  "wrong extension for poster": "poster-weather-pt.mp4", "empty slug": "video--pt.mp4", "bad language": "video-weather-fr.mp4",
  "dot dot": "../video-pt.mp4", "not a string": 5, "uppercase extension": "video-weather-pt.MP4"
};
Object.keys(rejects).forEach((k) => t("rejected: " + k, bsPromoKey(rejects[k]), null));

// ── signed address ───────────────────────────────────────────────────────────
{
  const env = makeDb(true);
  const signed = await bsPromoSign(env, { url: origin + "/x" }, "/api/bs/promo-file/video-weather-pt.mp4");
  t("a new name is signed", /^https:\/\/apex-api\.example\/api\/bs\/promo-file\/video-weather-pt\.mp4\?e=\d+&s=[a-f0-9]{64}$/.test(signed), true);
  const stored = new Map();
  const bucket = { head: async (k) => (k === "help/video/bs-promo-weather-pt.mp4" ? { size: 10 } : null), get: async (k) => (k === "help/video/bs-promo-weather-pt.mp4" ? { body: new Uint8Array(10) } : null) };
  env.ASSETS = bucket;
  const rf = (url) => ({ url, method: "GET", headers: { get: () => null } });
  let r = await handleGetBsPromoFile(rf(signed), env, "video-weather-pt.mp4");
  t("the signature verifies and the file is served", r.status, 200);
  r = await handleGetBsPromoFile(rf(signed), env, "video-weather-en.mp4");
  t("the same signature fails when the name changes", r.status, 404);
  r = await handleGetBsPromoFile(rf(signed.replace("video-weather-pt", "video-Weather-pt")), env, "video-Weather-pt.mp4");
  t("an uppercase name is a 404", r.status, 404);
  t("a name that fails the rule is not signed", await bsPromoSign(env, { url: origin }, "/api/bs/promo-file/video-a--b-pt.mp4"), "");
  r = await handleGetBsPromoFile(rf(signed + "&download=1"), env, "video-weather-pt.mp4");
  t("download name uses the slug", r.headers.get("Content-Disposition"), 'attachment; filename="apex-promo-weather-pt.mp4"');
  const sl = await bsPromoSign(env, { url: origin }, "/api/bs/promo-file/video-pt.mp4");
  env.ASSETS = { head: async () => ({ size: 10 }), get: async () => ({ body: new Uint8Array(10) }) };
  r = await handleGetBsPromoFile(rf(sl + "&download=1"), env, "video-pt.mp4");
  t("download name for the legacy file says aprenda", r.headers.get("Content-Disposition"), 'attachment; filename="apex-promo-aprenda-pt.mp4"');
}

// ── GET /api/bs/promos ───────────────────────────────────────────────────────
{
  const env = makeDb(true);
  asUser = null;
  t("list: not signed in is 401", (await handleGetBsPromos(rq("/api/bs/promos"), env)).status, 401);
  asUser = { role: "client", display_name: "Client" };
  t("list: not staff is 403", (await handleGetBsPromos(rq("/api/bs/promos"), env)).status, 403);
  asUser = { role: "alice", display_name: "Alice" };
  env.raw.exec("DELETE FROM bs_promo_entries WHERE id = 'bs-promo-weather-en'");
  const r = await handleGetBsPromos(rq("/api/bs/promos"), env);
  t("list: staff gets 200", r.ok, true);
  const p = r.body.promos;
  t("list: three promos in sort order", p.map((x) => x.slug), ["aprenda", "one-link", "weather"]);
  t("list: names and sort order", [p[1].name_pt, p[1].name_en, p[1].sort_order], ["Um só link: orçamento, contrato e entrada", "One link: estimate, contract, deposit", 2]);
  t("list: both languages present for one-link", [!!p[1].entries.pt, !!p[1].entries.en], [true, true]);
  t("list: a missing language is null", p[2].entries.en, null);
  t("list: entry carries the plain url", p[1].entries.pt.video_url, "/api/bs/promo-file/video-one-link-pt.mp4");
  t("list: video_src and poster_src are signed", [/\?e=\d+&s=[a-f0-9]{64}$/.test(p[1].entries.en.video_src), /poster-one-link-en\.jpg\?e=\d+&s=[a-f0-9]{64}$/.test(p[1].entries.en.poster_src)], [true, true]);
  t("list: the Aprenda entries are empty strings when the old row is empty", [p[0].entries.pt.video_src, p[0].entries.pt.poster_src], ["", ""]);
  t("list: entry fields", Object.keys(p[1].entries.pt).sort(), ["post_text", "poster_src", "poster_url", "updated_at", "updated_by", "video_src", "video_url"]);
  env.raw.exec("UPDATE bs_promos SET sort_order = 0 WHERE slug = 'weather'");
  t("list: sort_order decides the order", (await handleGetBsPromos(rq("/api/bs/promos"), env)).body.promos.map((x) => x.slug), ["weather", "aprenda", "one-link"]);
  const noSecret = makeDb(true); noSecret.HELP_LINK_SECRET = "";
  t("list: without a signing secret the sources are empty, not broken", (await handleGetBsPromos(rq("/api/bs/promos"), noSecret)).body.promos[1].entries.pt.video_src, "");
}

// ── PUT /api/bs/promos/:slug/:lang ───────────────────────────────────────────
{
  const env = makeDb(true);
  const put = (slug, lang, body) => handlePutBsPromoEntry(slug, lang, rq("/api/bs/promos/" + slug + "/" + lang, "PUT", body), env);
  asUser = null;
  t("save: not signed in is 401", (await put("weather", "pt", { post_text: "x" })).status, 401);
  asUser = { role: "client", display_name: "Client" };
  t("save: not staff is 403", (await put("weather", "pt", { post_text: "x" })).status, 403);
  asUser = { role: "alice", display_name: "Alice" };
  t("save: unknown promo is 404", (await put("nope", "pt", { post_text: "x" })).status, 404);
  t("save: bad slug is 404", (await put("We--ather", "pt", { post_text: "x" })).status, 404);
  t("save: unknown language is 404", (await put("weather", "fr", { post_text: "x" })).status, 404);
  env.raw.exec("DELETE FROM bs_promo_entries WHERE id = 'bs-promo-weather-en'");
  t("save: a promo without that entry is 404", (await put("weather", "en", { post_text: "x" })).status, 404);
  t("save: 5001 characters is 400", (await put("weather", "pt", { post_text: "a".repeat(5001) })).status, 400);
  t("save: 5000 characters is fine", (await put("weather", "pt", { post_text: "a".repeat(5000) })).ok, true);
  t("save: post_text that is not a string is 400", (await put("weather", "pt", { post_text: 5 })).status, 400);
  t("save: a bad video url is 400", (await put("weather", "pt", { video_url: "javascript:alert(1)" })).status, 400);
  t("save: a file name that fails the rule is 400", (await put("weather", "pt", { video_url: "/api/bs/promo-file/video-a--b-pt.mp4" })).status, 400);
  t("save: a poster name with the wrong extension is 400", (await put("weather", "pt", { poster_url: "/api/bs/promo-file/poster-weather-pt.mp4" })).status, 400);
  t("save: no body is 400", (await put("weather", "pt", undefined)).status, 400);
  t("save: an empty object (nothing to save) is 400", (await put("weather", "pt", {})).status, 400);
  const before = env.raw.prepare("SELECT * FROM bs_promo_entries WHERE id = 'bs-promo-weather-pt'").get();
  const r = await put("weather", "pt", { post_text: "Olá" });
  t("save: success", r.ok, true);
  const after = env.raw.prepare("SELECT * FROM bs_promo_entries WHERE id = 'bs-promo-weather-pt'").get();
  t("save: post_text changed, urls untouched", [after.post_text, after.video_url, after.poster_url], ["Olá", before.video_url, before.poster_url]);
  t("save: updated_by is the session name", after.updated_by, "Alice");
  t("save: updated_at is stamped", !!after.updated_at, true);
  await put("weather", "pt", { video_url: "/api/bs/promo-file/video-weather-pt.mp4", poster_url: "" });
  const after2 = env.raw.prepare("SELECT * FROM bs_promo_entries WHERE id = 'bs-promo-weather-pt'").get();
  t("save: only the sent fields change (text stays when urls are sent)", [after2.post_text, after2.poster_url], ["Olá", ""]);
  t("save: another entry is untouched", env.raw.prepare("SELECT post_text FROM bs_promo_entries WHERE id = 'bs-promo-one-link-pt'").get().post_text, "");
  t("save: a SQL looking text is stored as text", (await put("one-link", "pt", { post_text: "x'); DROP TABLE bs_promos;--" })).ok, true);
  t("save: and the table is still there", env.raw.prepare("SELECT COUNT(*) AS n FROM bs_promos").get().n, 3);
}

// ── router and the old routes ────────────────────────────────────────────────
{
  const env = makeDb(true);
  env.raw.exec("UPDATE bs_promo_items SET video_url = '/api/bs/promo-file/video-pt.mp4', post_text = 'texto antigo' WHERE lang = 'pt'");
  asUser = { role: "alice", display_name: "Alice" };
  let r = await __bsRoute("/api/bs/promo", "GET", rq("/api/bs/promo"), env);
  t("old GET /api/bs/promo still answers with items", [r.ok, r.body.items.length, r.body.items[0].post_text], [true, 2, "en" === r.body.items[0].lang ? r.body.items[0].post_text : "texto antigo"]);
  t("old GET keeps the signed video_src", /video-pt\.mp4\?e=\d+&s=/.test(r.body.items.filter((i) => i.lang === "pt")[0].video_src), true);
  r = await __bsRoute("/api/bs/promo/pt", "PUT", rq("/api/bs/promo/pt", "PUT", { title: "T", post_text: "novo" }), env);
  t("old PUT /api/bs/promo/pt still saves", [r.ok, env.raw.prepare("SELECT title, post_text FROM bs_promo_items WHERE lang = 'pt'").get().post_text], [true, "novo"]);
  r = await __bsRoute("/api/bs/promos", "GET", rq("/api/bs/promos"), env);
  t("router: GET /api/bs/promos", r.body.promos.length, 3);
  r = await __bsRoute("/api/bs/promos/weather/en", "PUT", rq("/api/bs/promos/weather/en", "PUT", { post_text: "Hi" }), env);
  t("router: PUT /api/bs/promos/weather/en", [r.ok, env.raw.prepare("SELECT post_text FROM bs_promo_entries WHERE id = 'bs-promo-weather-en'").get().post_text], [true, "Hi"]);
  r = await __bsRoute("/api/bs/promos/weather/en", "DELETE", rq("/api/bs/promos/weather/en", "DELETE"), env);
  t("router: there is no delete route", r, null);
  r = await __bsRoute("/api/bs/promos/weather", "PUT", rq("/api/bs/promos/weather", "PUT", {}), env);
  t("router: a PUT without a language is not a route", r, null);
}

// ── migration ────────────────────────────────────────────────────────────────
{
  const env = makeDb(false);
  env.raw.exec("UPDATE bs_promo_items SET video_url = '/api/bs/promo-file/video-pt.mp4', poster_url = '/api/bs/promo-file/poster-pt.jpg', post_text = 'texto do Aprenda', updated_at = '2026-10-01 10:00:00', updated_by = 'Nicole' WHERE lang = 'pt'");
  const oldRows = JSON.stringify(env.raw.prepare("SELECT * FROM bs_promo_items ORDER BY lang").all());
  env.raw.exec(migNew);
  const counts = () => [env.raw.prepare("SELECT COUNT(*) n FROM bs_promos").get().n, env.raw.prepare("SELECT COUNT(*) n FROM bs_promo_entries").get().n];
  const c1 = counts();
  env.raw.exec(migNew);
  t("migration: 3 promos and 6 entries", c1, [3, 6]);
  t("migration: running it twice gives the same counts", counts(), c1);
  const ap = env.raw.prepare("SELECT * FROM bs_promo_entries WHERE promo_id = 'bs-promo-aprenda' AND lang = 'pt'").get();
  t("migration: Aprenda pt carries the old video, poster, text, time and author", [ap.video_url, ap.poster_url, ap.post_text, ap.updated_at, ap.updated_by], ["/api/bs/promo-file/video-pt.mp4", "/api/bs/promo-file/poster-pt.jpg", "texto do Aprenda", "2026-10-01 10:00:00", "Nicole"]);
  t("migration: Aprenda en is copied too", env.raw.prepare("SELECT COUNT(*) n FROM bs_promo_entries WHERE promo_id = 'bs-promo-aprenda'").get().n, 2);
  const urls = env.raw.prepare("SELECT video_url, poster_url FROM bs_promo_entries WHERE promo_id IN ('bs-promo-one-link','bs-promo-weather') ORDER BY id").all().flatMap((x) => [x.video_url, x.poster_url]);
  t("migration: the eight addresses", urls, [
    "/api/bs/promo-file/video-one-link-en.mp4", "/api/bs/promo-file/poster-one-link-en.jpg",
    "/api/bs/promo-file/video-one-link-pt.mp4", "/api/bs/promo-file/poster-one-link-pt.jpg",
    "/api/bs/promo-file/video-weather-en.mp4", "/api/bs/promo-file/poster-weather-en.jpg",
    "/api/bs/promo-file/video-weather-pt.mp4", "/api/bs/promo-file/poster-weather-pt.jpg"]);
  t("migration: every address passes the file name rule", urls.every((u) => !!bsPromoKey(u.slice("/api/bs/promo-file/".length))), true);
  t("migration: post text empty for one-link and weather", env.raw.prepare("SELECT COUNT(*) n FROM bs_promo_entries WHERE promo_id != 'bs-promo-aprenda' AND post_text != ''").get().n, 0);
  t("migration: bs_promo_items unchanged", JSON.stringify(env.raw.prepare("SELECT * FROM bs_promo_items ORDER BY lang").all()), oldRows);
  t("migration: no statement changes or drops the old table", /(ALTER\s+TABLE|DROP\s+TABLE|DELETE\s+FROM|UPDATE|INSERT\s+(OR\s+\w+\s+)?INTO|CREATE\s+TABLE(\s+IF\s+NOT\s+EXISTS)?)\s+bs_promo_items/i.test(migNew), false);
  t("migration: a person's edit survives a second run", (env.raw.exec("UPDATE bs_promo_entries SET post_text = 'editado' WHERE id = 'bs-promo-weather-pt'"), env.raw.exec(migNew), env.raw.prepare("SELECT post_text FROM bs_promo_entries WHERE id = 'bs-promo-weather-pt'").get().post_text), "editado");
}

// ── page script ──────────────────────────────────────────────────────────────
{
  const script = page.slice(page.indexOf("// PROMO-LIST-LOGIC-START"), page.indexOf("// PROMO-LIST-LOGIC-END"));
  t("page: the pure logic block exists", script.length > 50, true);
  const ctx = { lang: "pt" };
  vm.createContext(ctx);
  vm.runInContext("var promo = { lang: 'pt', promos: [], msgs: {} }; function isEn() { return promo.lang === 'en'; } function t(pt, en) { return isEn() ? en : pt; } function escHtml(s) { return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;'); }\n" + script, ctx);
  const promoItem = { slug: "weather", name_pt: "Previsão do tempo", name_en: "Weather", entries: { pt: { video_src: "https://v/pt", poster_src: "https://p/pt", post_text: "oi" }, en: null } };
  t("page: Portuguese title", vm.runInContext("promoTitle(" + JSON.stringify(promoItem) + ")", ctx), "Previsão do tempo");
  vm.runInContext("promo.lang = 'en'", ctx);
  t("page: English title", vm.runInContext("promoTitle(" + JSON.stringify(promoItem) + ")", ctx), "Weather");
  t("page: entry for the chosen language is null when missing", vm.runInContext("promoEntry(" + JSON.stringify(promoItem) + ")", ctx), null);
  vm.runInContext("promo.lang = 'pt'", ctx);
  t("page: entry for the chosen language", vm.runInContext("promoEntry(" + JSON.stringify(promoItem) + ").post_text", ctx), "oi");
  const html = vm.runInContext("cardHtml(" + JSON.stringify(promoItem) + ")", ctx);
  t("page: card shows the video player", /<video[^>]*controls[^>]*playsinline[^>]*preload="metadata"/.test(html) && !/autoplay/.test(html), true);
  vm.runInContext("promo.lang = 'en'", ctx);
  const empty = vm.runInContext("cardHtml(" + JSON.stringify(promoItem) + ")", ctx);
  t("page: empty state in English", empty.indexOf("No video in English yet for this promo") > -1 && empty.indexOf("<video") === -1, true);
  t("page: the text box still shows when there is no entry video", empty.indexOf("<textarea") > -1, true);
  vm.runInContext("promo.lang = 'pt'", ctx);
  const emptyPt = vm.runInContext("cardHtml(" + JSON.stringify({ slug: "x", name_pt: "A", name_en: "B", entries: { pt: { video_src: "", poster_src: "", post_text: "" }, en: null } }) + ")", ctx);
  t("page: empty state in Portuguese", emptyPt.indexOf("Ainda não há vídeo em português para esta divulgação") > -1, true);
  const evil = vm.runInContext("cardHtml(" + JSON.stringify({ slug: "x", name_pt: "<img src=x onerror=1>", name_en: "", entries: { pt: { video_src: "", poster_src: "", post_text: "</textarea><script>1</script>" }, en: null } }) + ")", ctx);
  t("page: owner text is escaped", evil.indexOf("<img src=x") === -1 && evil.indexOf("<script>1") === -1, true);
  t("page: no browser pop-ups, no long dashes in visible text", /\balert\(|\bconfirm\(|\bprompt\(/.test(script) || /[–—]/.test(script), false);
}

console.log(fails ? "\n" + fails + " FAILED" : "\nAll passed");
process.exit(fails ? 1 : 0);
