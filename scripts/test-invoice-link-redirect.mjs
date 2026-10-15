// GET /api/public/apex-invoice-link/:invoice_id -- the no-login route a
// client's old WhatsApp link (the staff-era templates/apex-invoice-template-
// DRAFT.html address) now calls to find its way to the real, readable
// client link, built 2026-10-15 after JM Luxury Pools (INV-000048) opened
// that old link and saw a login error.
//
// Against the REAL functions on an in-memory SQLite (scripts/fixtures/d1-shim.mjs).
// No network.
//
//   node scripts/test-invoice-link-redirect.mjs
import { makeDb, build, baseStubs, req, workerSrc } from "./fixtures/d1-shim.mjs";

const root = new URL("../", import.meta.url);
const MIGS = ["migrations/apex_club_company.sql", "migrations/apex_invoice_public.sql", "migrations/apex_club_pay.sql"];
let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) { fail++; } };
const TOK = (ch) => ch.repeat(48);
const UUID = (n) => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");

function world() {
  const d = makeDb(MIGS);
  d.raw.exec("INSERT INTO clients (id, name, status, package, email, phone) VALUES ('c1', 'JM LUXURY POOLS', 'active', 'ADV', 'owner@jm.test', '8135550199')");
  d.raw.exec("INSERT INTO packages (id, name, short_name, full_name) VALUES ('p1', 'Advanced', 'ADV', 'APEX ADVANCED')");
  return d;
}
function seedInvoice(d, id, status, extra) {
  const e = Object.assign({ cents: 250000, due: "2099-01-31", token: null }, extra || {});
  d.raw.prepare("INSERT INTO invoices (id, client_id, number, amount_cents, issued_at, due_at, status, public_token) VALUES (?,?,?,?,?,?,?,?)")
    .run(id, "c1", "INV-9" + id, e.cents, "2026-09-01", e.due, status, e.token);
}

const stubs = Object.assign({}, baseStubs, {
  DEFAULT_ORIGIN: "https://apex.test", DOC_LINK_ORIGIN: "https://doc.test",
  gmEstPublicRateLimit: async () => null, crypto: globalThis.crypto
});
const fns = ["apxInvNoIndex", "apxInvShareLink", "docLinkSlugPart", "docLinkRandom", "gmEstNewToken", "handleGetPublicApexInvoiceLink"];
const vars = ["APX_INV_PAGE", "APX_INV_LINK_UUID_RE"];

function buildF(rateLimitFn) {
  const s = rateLimitFn ? Object.assign({}, stubs, { gmEstPublicRateLimit: rateLimitFn }) : stubs;
  return build(fns, vars, s);
}

// ── Valid invoice, no token yet: a link is returned and ONLY a link ───────
{
  const d = world(); const env = { DB: d.DB };
  const F = buildF();
  seedInvoice(d, "001", "sent", { cents: 440000 });
  const id = "001";
  // seedInvoice used a plain id, but the route requires a real uuid shape --
  // use a uuid as the invoice's own id for this group of checks.
  d.raw.exec("UPDATE invoices SET id = '" + UUID(1) + "' WHERE id = '001'");
  const r = await F.handleGetPublicApexInvoiceLink(UUID(1), req({}, "https://x.test/api/public/apex-invoice-link/" + UUID(1)), env);
  ok(r.status === 200 && typeof r.data.link === "string" && r.data.link.length > 0, "a valid uuid of a sent invoice returns 200 with a link");
  ok(Object.keys(r.data).join(",") === "link", "the response carries ONLY {link} -- no token, amount, client name or id");
  ok(!/440000|JM LUXURY|owner@jm\.test|8135550199/.test(JSON.stringify(r.data)), "no amount, client name, email or phone leaks into the answer");
  const tokRow = d.q("SELECT public_token FROM invoices WHERE id = ?", UUID(1))[0];
  ok(tokRow.public_token && tokRow.public_token.length === 48, "a public_token was created since none existed");
  ok(r.data.link.indexOf(tokRow.public_token) >= 0 || /^https:\/\/doc\.test\//.test(r.data.link), "the link is the readable doc.resonateai.online address (or the direct fallback carrying the token)");
}

// ── Token already exists: it is reused, never re-minted ────────────────────
{
  const d = world(); const env = { DB: d.DB };
  const F = buildF();
  seedInvoice(d, "001", "sent", { token: TOK("a") });
  d.raw.exec("UPDATE invoices SET id = '" + UUID(2) + "' WHERE id = '001'");
  const r = await F.handleGetPublicApexInvoiceLink(UUID(2), req({}, "https://x.test/api/public/apex-invoice-link/" + UUID(2)), env);
  ok(r.status === 200, "an invoice that already has a token still returns 200");
  const tok = d.q("SELECT public_token FROM invoices WHERE id = ?", UUID(2))[0].public_token;
  ok(tok === TOK("a"), "the existing token is unchanged, never re-minted");
}

// ── Two requests at once with no token yet: both end on the SAME token ─────
{
  const d = world(); const env = { DB: d.DB };
  const F = buildF();
  seedInvoice(d, "001", "sent", {});
  d.raw.exec("UPDATE invoices SET id = '" + UUID(3) + "' WHERE id = '001'");
  const call = () => F.handleGetPublicApexInvoiceLink(UUID(3), req({}, "https://x.test/api/public/apex-invoice-link/" + UUID(3)), env);
  const [a, b] = await Promise.all([call(), call()]);
  ok(a.status === 200 && b.status === 200, "both concurrent requests succeed");
  const rows = d.q("SELECT DISTINCT public_token FROM invoices WHERE id = ?", UUID(3));
  ok(rows.length === 1 && rows[0].public_token, "exactly one token was minted even though two requests raced for it");
}

// ── A void or voided_mistake invoice: the SAME 404 as anything else missing ─
{
  const d = world(); const env = { DB: d.DB };
  const F = buildF();
  seedInvoice(d, "001", "void", {}); d.raw.exec("UPDATE invoices SET id = '" + UUID(4) + "' WHERE id = '001'");
  seedInvoice(d, "002", "voided_mistake", {}); d.raw.exec("UPDATE invoices SET id = '" + UUID(5) + "' WHERE id = '002'");
  const rVoid = await F.handleGetPublicApexInvoiceLink(UUID(4), req({}, "https://x.test/api/public/apex-invoice-link/" + UUID(4)), env);
  const rVoidedMistake = await F.handleGetPublicApexInvoiceLink(UUID(5), req({}, "https://x.test/api/public/apex-invoice-link/" + UUID(5)), env);
  const rUnknown = await F.handleGetPublicApexInvoiceLink(UUID(6), req({}, "https://x.test/api/public/apex-invoice-link/" + UUID(6)), env);
  const rBad = await F.handleGetPublicApexInvoiceLink("not-a-uuid", req({}, "https://x.test/api/public/apex-invoice-link/not-a-uuid"), env);
  const rBad2 = await F.handleGetPublicApexInvoiceLink("", req({}, "https://x.test/api/public/apex-invoice-link/"), env);
  const bodies = [rVoid, rVoidedMistake, rUnknown, rBad, rBad2];
  ok(bodies.every(r => r.status === 404 && r.error === "Not found"), "void, voided_mistake, unknown uuid, a non-uuid string and an empty id all answer the IDENTICAL 404 -- 'Not found', status 404");
  ok(new Set(bodies.map(r => JSON.stringify(r))).size === 1, "the four failing answers are byte-for-byte identical (nothing distinguishes one failure reason from another)");
}

// ── A draft invoice still gets a link: the route does not gate on status
//    beyond void/voided_mistake (the spec only excludes those two) ─────────
{
  const d = world(); const env = { DB: d.DB };
  const F = buildF();
  seedInvoice(d, "001", "draft", {}); d.raw.exec("UPDATE invoices SET id = '" + UUID(7) + "' WHERE id = '001'");
  const r = await F.handleGetPublicApexInvoiceLink(UUID(7), req({}, "https://x.test/api/public/apex-invoice-link/" + UUID(7)), env);
  ok(r.status === 200 && typeof r.data.link === "string", "a draft invoice (not void) still returns a link -- only void/voided_mistake are excluded");
}

// ── Rate limiting: the same public limiter the other public routes use ─────
{
  const d = world(); const env = { DB: d.DB };
  const F = buildF(async () => ({ status: 429, error: "Too many requests. Try again later." }));
  seedInvoice(d, "001", "sent", {}); d.raw.exec("UPDATE invoices SET id = '" + UUID(8) + "' WHERE id = '001'");
  const r = await F.handleGetPublicApexInvoiceLink(UUID(8), req({}, "https://x.test/api/public/apex-invoice-link/" + UUID(8)), env);
  ok(r.status === 429, "when the shared public rate limiter says no, this route answers 429 too");
}

// ── The response is wrapped with apxInvNoIndex (no-store, no-index markers
//    the shared public-doc header middleware looks for) ────────────────────
{
  const noIndexSrc = workerSrc.slice(workerSrc.indexOf("function apxInvNoIndex("), workerSrc.indexOf("function apxInvNoIndex(") + 400);
  const handlerSrc = workerSrc.slice(workerSrc.indexOf("async function handleGetPublicApexInvoiceLink("), workerSrc.indexOf("async function handleGetPublicApexInvoiceLink(") + 2200);
  ok((handlerSrc.match(/apxInvNoIndex\(/g) || []).length >= 3, "every answer path in the handler (success, 404s, rate limit, error) is wrapped in apxInvNoIndex");
  ok(noIndexSrc.length > 0, "apxInvNoIndex exists");
}

// ── The route is on the public prefix list: no-store + no-index applied,
//    and the doc.resonateai.online origin is allowed ──────────────────────
{
  const reSrc = (workerSrc.match(/var PUBLIC_DOC_PATH_RE = (\/\^[^\n]*\/;)/) || [])[1] || "";
  ok(/apex-invoice-link/.test(reSrc), "PUBLIC_DOC_PATH_RE includes apex-invoice-link");
  const re = new RegExp(reSrc.slice(1, reSrc.lastIndexOf("/")));
  ok(re.test("/api/public/apex-invoice-link/" + UUID(1) + "/"), "the new route's path matches PUBLIC_DOC_PATH_RE (origin-allow and no-store/no-index both key off this)");
}

// ── Route is registered ahead of the apex-invoices catch-all, and that
//    catch-all does not swallow the new, differently-prefixed path ────────
{
  const fetchSrc = workerSrc.slice(workerSrc.indexOf("async function handleFetch("));
  const iNewRoute = fetchSrc.indexOf("apex-invoice-link");
  const iCatchAll = fetchSrc.indexOf('path.indexOf("/api/public/apex-invoices/") === 0');
  ok(iNewRoute > 0 && iCatchAll > 0 && iNewRoute < iCatchAll, "the new route is declared before the /api/public/apex-invoices/ catch-all");
  const catchAllRe = /^\/api\/public\/apex-invoices\//;
  ok(!catchAllRe.test("/api/public/apex-invoice-link/" + UUID(1)), "the apex-invoices catch-all's own prefix does not match the new route's path (different word)");
}

// ── Never logs the invoice id or the link ───────────────────────────────────
{
  const handlerSrc = workerSrc.slice(workerSrc.indexOf("async function handleGetPublicApexInvoiceLink("), workerSrc.indexOf("async function handleGetPublicApexInvoiceLink(") + 2200);
  ok(!/console\.(log|error)\([^)]*invoiceId[^)]*\)/.test(handlerSrc.replace(/\n/g, " ")) || !/console\.(log|error)\([^)]*\blink\b[^)]*\)/.test(handlerSrc.replace(/\n/g, " ")),
    "no console.log/error call in the handler includes the invoice id or the link variable");
}

console.log(fail ? "\n" + fail + " FAILED" : "\nALL PASS");
process.exit(fail ? 1 : 0);
