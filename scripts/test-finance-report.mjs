// The financial report (finance-report-view.html): the page's own arithmetic
// and formatters, cut out of the page by the id of their script block, and
// the Worker's row filter and access lists, cut out of worker/index.js.
// No network, no database, no live data.
//
//   node scripts/test-finance-report.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { build, makeDb, baseStubs } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), m + (JSON.stringify(a) === JSON.stringify(b) ? "" : "  got " + JSON.stringify(a) + "  want " + JSON.stringify(b)));
const root = new URL("../", import.meta.url);
const page = readFileSync(new URL("finance-report-view.html", root), "utf8");
const iosPage = readFileSync(new URL("ios/App/App/public/finance-report-view.html", root), "utf8");

const block = /<script id="frMath">([\s\S]*?)<\/script>/.exec(page);
ok(!!block, "the page has its frMath script block");
const ctx = vm.createContext({ Intl, Date, Math, Number, String, isFinite });
vm.runInContext(block[1] + "\nthis.F = { frCents, frMoney, frDate, frEasternYmd, frDateTime, frBuild, frCheckSum };", ctx);
const F = ctx.F;
ok(!/document|window|fetch|localStorage/.test(block[1].replace(/\/\/[^\n]*/g, "")), "the frMath block touches no DOM, no network");

// ---- acerto.txt section 3: the real figures --------------------------------
const E = "Entrada", S = "Saída";
const acerto = [
  { date: "2026-09-01", descricao: "Repasse Gator (relatório nº 2)", categoria: "Repasse", tipo: E, valor: 1115.9 },
  { date: "2026-09-02", descricao: "Acerto Gator: horas do Manu", categoria: "Equipe", tipo: S, valor: 165 },
  { date: "2026-09-10", descricao: "Recebimento filtros Juliana e Fernando", categoria: "Vendas", tipo: E, valor: 4091.8 },
  { date: "2026-09-12", descricao: "Devolução ao Bruno", categoria: "Comissão", tipo: S, valor: 467.9 },
  { date: "2026-09-15", descricao: "Acerto Neyce", categoria: "Equipe", tipo: S, valor: 125.37, obs: "113,37 + 12,00 do café da manhã" },
  { date: "2026-09-20", descricao: "Comissão do Manu (filtro da Juliana)", categoria: "Comissão", tipo: S, valor: 150 },
  { date: "2026-10-01", descricao: "Contabilidade da abertura da holding", categoria: null, tipo: S, valor: 510 }
];
const r = F.frBuild(acerto, 0);
eq(r.lines.map((l) => l.balance_cents), [111590, 95090, 504270, 457480, 444943, 429943, 378943], "acerto: running balance after each line (1,115.90 950.90 5,042.70 4,574.80 4,449.43 4,299.43 3,789.43)");
eq(r.total_in_cents, 520770, "acerto: total in 5,207.70");
eq(r.total_out_cents, 141827, "acerto: total out 1,418.27");
eq(r.closing_cents, 378943, "acerto: closing 3,789.43");
ok(r.check_ok && r.check_cents === 378943, "acerto: check agrees with the running balance");
eq(F.frCheckSum(r), "$5,207.70 - $1,418.27 = $3,789.43", "acerto: check line, US format, no opening balance");
ok(!r.has_opening && r.lines.length === 7 && r.lines[0].kind === "entry", "acerto: no opening line when the opening balance is 0");
eq(r.lines[4].obs, "113,37 + 12,00 do café da manhã", "acerto: an entry's obs rides on its line");
eq(r.lines[0].in_cents + "/" + r.lines[0].out_cents + " " + r.lines[1].in_cents + "/" + r.lines[1].out_cents, "111590/0 0/16500", "acerto: in and out land in their own columns");
eq(r.categories, [
  { categoria: "Comissão", in_cents: 0, out_cents: 61790 },
  { categoria: "Equipe", in_cents: 0, out_cents: 29037 },
  { categoria: "Repasse", in_cents: 111590, out_cents: 0 },
  { categoria: "Vendas", in_cents: 409180, out_cents: 0 },
  { categoria: null, in_cents: 0, out_cents: 51000 }
], "acerto: totals by category, by name, no category last");
eq(r.categories.reduce((a, c) => a + c.in_cents, 0) + "/" + r.categories.reduce((a, c) => a + c.out_cents, 0), "520770/141827", "acerto: the category totals add up to the totals row");

// ---- with an opening balance -----------------------------------------------
const o = F.frBuild(acerto, 12100);
ok(o.has_opening && o.lines.length === 8 && o.lines[0].kind === "opening" && o.lines[0].balance_cents === 12100, "opening: it is the first line, with its balance");
eq(o.lines[1].balance_cents, 123690, "opening: the first entry runs from it (121.00 + 1,115.90)");
eq(o.closing_cents, 391043, "opening: closing 3,910.43");
eq(o.total_in_cents + "/" + o.total_out_cents, "520770/141827", "opening: the totals row does not count the opening balance");
eq(F.frCheckSum(o), "$121.00 + $5,207.70 - $1,418.27 = $3,910.43", "opening: the check line carries the opening balance");
ok(o.check_ok, "opening: check agrees");
const neg = F.frBuild([{ date: "2026-01-02", tipo: S, valor: 30, descricao: "x" }], -2000);
eq(neg.closing_cents + " " + F.frMoney(neg.closing_cents), "-5000 -$50.00", "opening: a negative opening balance stays negative");

// ---- empty -----------------------------------------------------------------
const z = F.frBuild([], 0);
eq([z.lines.length, z.entry_count, z.total_in_cents, z.total_out_cents, z.closing_cents, z.categories.length, z.check_ok], [0, 0, 0, 0, 0, 0, true], "empty: no lines, zero totals, no categories");
eq(F.frBuild(null, 0).lines.length, 0, "empty: a missing list is an empty list");
const zo = F.frBuild([], 5000);
eq([zo.lines.length, zo.entry_count, zo.closing_cents], [1, 0, 5000], "empty with an opening balance: only the opening line, no entries");

// ---- float traps -----------------------------------------------------------
ok(1115.9 - 165 + 4091.8 - 467.9 !== 4574.8, "trap is real: the acerto running sum in dollars is " + (1115.9 - 165 + 4091.8 - 467.9) + ", not 4574.8");
const t1 = F.frBuild([{ tipo: E, valor: 4091.8 }, { tipo: S, valor: 467.9 }], 0);
eq(t1.closing_cents + " " + F.frMoney(t1.closing_cents), "362390 $3,623.90", "trap: 4091.8 - 467.9 closes at exactly $3,623.90");
const t2 = F.frBuild([{ tipo: E, valor: 0.1 }, { tipo: E, valor: 0.2 }], 0);
eq(t2.closing_cents, 30, "trap: 0.1 + 0.2 is 30 cents");
const t3 = F.frBuild(Array.from({ length: 1000 }, () => ({ tipo: E, valor: 0.01 })), 0);
eq(t3.closing_cents, 1000, "trap: a thousand 1-cent entries are $10.00");
eq([F.frCents(1.15), F.frCents(8.29), F.frCents(19.99), F.frCents(1115.9), F.frCents(125.37), F.frCents("4091.80")], [115, 829, 1999, 111590, 12537, 409180], "trap: 1.15, 8.29, 19.99, 1115.9, 125.37 and a string amount become whole cents");
eq([F.frCents(null), F.frCents(undefined), F.frCents("abc"), F.frCents(NaN)], [0, 0, 0, 0], "trap: a missing or unreadable amount is 0 cents, never NaN");
ok(t1.lines.concat(t3.lines).every((l) => Number.isInteger(l.balance_cents) && Number.isInteger(l.in_cents) && Number.isInteger(l.out_cents)), "trap: every figure on a line is an integer");

// ---- formatters ------------------------------------------------------------
eq([F.frMoney(378943), F.frMoney(0), F.frMoney(5), F.frMoney(100000000), F.frMoney(-500), F.frMoney(838200)], ["$3,789.43", "$0.00", "$0.05", "$1,000,000.00", "-$5.00", "$8,382.00"], "money: $3,789.43 style, minus before the dollar sign");
eq([F.frDate("2026-10-01"), F.frDate("2026-01-10"), F.frDate("2026-10-06T12:00:00"), F.frDate(""), F.frDate(null), F.frDate("06/10/2026")], ["10/01/2026", "01/10/2026", "10/06/2026", "", "", ""], "date: October 1 is 10/01/2026, month first");
eq(F.frDateTime(new Date("2026-10-07T18:05:00Z")), "10/07/2026 2:05 PM", "date and time: Eastern, 12-hour (daylight time)");
eq(F.frDateTime(new Date("2026-01-15T05:30:00Z")), "01/15/2026 12:30 AM", "date and time: Eastern, 12-hour (standard time, after midnight)");
eq(F.frDateTime(new Date("2026-01-15T17:00:00Z")), "01/15/2026 12:00 PM", "date and time: noon is 12:00 PM");
eq(F.frEasternYmd(new Date("2026-10-08T02:30:00Z")), "2026-10-07", "today: 10:30 PM Eastern is still that day");

// ---- the page itself -------------------------------------------------------
ok(page === iosPage, "the iOS copy of the page is the same as the root copy");
ok(!/US\$/.test(page), "the page never writes US$");
ok(!/toLocale(Date|Time)?String/.test(page), "the page never formats with the device locale");
ok(/\/gm\/finance\/report/.test(page) && !/api\/public/.test(page), "the page reads the signed-in report route, no public route");
ok(/@page \{ size: letter;/.test(page) && /thead \{ display: table-header-group; \}/.test(page) && /tr \{ break-inside: avoid;/.test(page), "print rules: Letter, header repeats, rows are not cut");
const scripts = [...page.matchAll(/<script(?:\s+id="[^"]*")?>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
ok(scripts.length === 2, "the page has two inline scripts");
scripts.forEach((s, i) => { let good = true; try { new vm.Script(s); } catch (e) { good = false; console.log(String(e)); } ok(good, "inline script " + (i + 1) + " parses"); });

// ---- the Worker: which rows, in what order, and who may ask ---------------
const W = build(["gmFinanceReportRows", "gmUtcStampToEasternDate", "clientRequestAllowed", "sellerRequestAllowed"], [], {});
const rows = [
  { id: "c", data: "2026-09-10", descricao: "third", categoria: "A", tipo: E, valor: 3, obs: null, created_at: "2026-09-10 15:00:00", obra_id: "job1", invoice_payment_id: "p1" },
  { id: "b", data: "2026-09-02", descricao: "second, later", categoria: "A", tipo: S, valor: 2, obs: "note", created_at: "2026-09-05 10:00:00" },
  { id: "a", data: "2026-09-02", descricao: "second, earlier", categoria: null, tipo: S, valor: 1, obs: "", created_at: "2026-09-03 10:00:00" },
  { id: "d", data: null, descricao: "undated, 10 PM Eastern on 09/01", categoria: "A", tipo: E, valor: 4, obs: null, created_at: "2026-09-02 02:00:00" },
  { id: "e", data: "2026-08-31", descricao: "before", categoria: "A", tipo: E, valor: 5, obs: null, created_at: "2026-08-31 10:00:00" },
  { id: "f", data: "2026-10-01T00:00", descricao: "after", categoria: "A", tipo: E, valor: 6, obs: null, created_at: "2026-10-01 10:00:00" }
];
const got = W.gmFinanceReportRows(rows, "2026-09-01", "2026-09-30");
eq(got.map((x) => x.id), ["d", "a", "b", "c"], "worker: rows in range, by date, then created_at; an undated row uses its Eastern creation date");
eq(got[0].date, "2026-09-01", "worker: 02:00 UTC is the day before in Eastern");
eq(Object.keys(got[0]).sort(), ["categoria", "created_at", "date", "descricao", "id", "obs", "tipo", "valor"], "worker: a row carries the report's fields and nothing else");
eq(W.gmFinanceReportRows(rows, "", "").length, 6, "worker: no bounds returns every row");
eq(W.gmFinanceReportRows(rows, "2027-01-01", "2027-12-31"), [], "worker: an empty range is an empty list");
eq(W.gmFinanceReportRows(rows, "2026-10-01", "2026-10-01").map((x) => x.id), ["f"], "worker: both bounds are inclusive");
ok(W.clientRequestAllowed("/api/clients/c1/gm/finance/report", "GET", "c1") === true, "access: the owner's session may read its own report");
ok(!W.clientRequestAllowed("/api/clients/c2/gm/finance/report", "GET", "c1"), "access: never another client's");
ok(!W.clientRequestAllowed("/api/clients/c1/gm/finance/report", "POST", "c1"), "access: nothing can be posted to it");
ok(!W.sellerRequestAllowed("/api/clients/c1/gm/finance/report", "GET", "c1"), "access: a salesperson session is refused");

// ---- the Worker route, on an in-memory copy of the real gm_finance table ---
let who = null;
const H = build(["handleGetGmFinanceReport", "gmFinanceReportRows", "gmUtcStampToEasternDate", "requireClientAccess", "logoVersionParam", "gmDocHero"], [], Object.assign({}, baseStubs, {
  authenticate: async () => who,
  heroAnyImage: () => null,
  gmDocSettingsRow: async (env, id) => ({ client_id: id, legal_name: null, hero_r2_key: "doc-heroes/c1.jpg", hero_gallery_key: null, brand_primary: "#123456", brand_accent: null, address: "1 Main St", phone: "8135550100", payment_methods: { zelle: "x" } })
}));
const d = makeDb(["migrations/gm_growth_management.sql"]);
d.raw.prepare("INSERT INTO clients (id, name, logo_url) VALUES ('c1', 'My Pure Filter', 'logos/c1-9.png')").run();
d.raw.prepare("INSERT INTO clients (id, name) VALUES ('c2', 'Other Co')").run();
const ins = d.raw.prepare("INSERT INTO gm_finance (id, client_id, mes, data, descricao, categoria, tipo, valor, obs, created_at) VALUES (?, ?, 'Setembro', ?, ?, ?, ?, ?, ?, ?)");
acerto.forEach((x, i) => ins.run("r" + i, "c1", x.date, x.descricao, x.categoria || "Outros", x.tipo, x.valor, x.obs || null, "2026-10-0" + (7 - i) + " 12:00:00"));
ins.run("other", "c2", "2026-09-05", "another client's money", "Vendas", E, 999, null, "2026-09-05 12:00:00");
const env = { DB: d.DB };
const req = (q) => new Request("https://api.x.test/api/clients/c1/gm/finance/report" + q);

who = { role: "client", client_id: "c1" };
let res = await H.handleGetGmFinanceReport("c1", req("?from=2026-09-01&to=2026-10-07"), env);
eq(res.status, 200, "route: the client's own session gets its report");
eq(res.data.entries.map((x) => x.valor), [1115.9, 165, 4091.8, 467.9, 125.37, 150, 510], "route: that client's rows only, oldest first, whatever order they were typed in");
eq(F.frBuild(res.data.entries, 0).closing_cents, 378943, "route to page: the rows the route returns close at $3,789.43");
eq(Object.keys(res.data).sort(), ["business", "entries", "from", "to"], "route: answers with the period, the rows and the business, nothing else");
eq(res.data.business, { name: "My Pure Filter", logo_url: "https://api.x.test/api/clients/c1/logo-image?v=c1-9", hero_url: "https://api.x.test/api/clients/c1/doc-hero-image", hero: { focus_x: 50, focus_y: 50, zoom: 100, slide: 0, fill: null, tone: "dark", flip: false }, brand_primary: "#123456", brand_accent: null }, "route: the business is its name and brand fields only (no address, phone or payment details)");
res = await H.handleGetGmFinanceReport("c1", req("?from=2026-09-10&to=2026-09-15"), env);
eq(res.data.entries.map((x) => x.valor), [4091.8, 467.9, 125.37], "route: from and to narrow the rows, both ends included");
res = await H.handleGetGmFinanceReport("c1", req("?from=2025-01-01&to=2025-12-31"), env);
eq([res.status, res.data.entries.length, res.data.business.name], [200, 0, "My Pure Filter"], "route: an empty period is an empty list, still with the brand");
res = await H.handleGetGmFinanceReport("c1", req("?from=01/09/2026&to=2026-10-07"), env);
eq(res.status, 400, "route: a date that is not YYYY-MM-DD is refused");
who = { role: "developer" };
res = await H.handleGetGmFinanceReport("c1", req("?from=2026-09-01&to=2026-10-07&previewAs=c1"), env);
eq([res.status, res.data.entries.length], [200, 7], "route: staff previewing the client get the same report");
who = { role: "client", client_id: "c2" };
res = await H.handleGetGmFinanceReport("c1", req("?from=2026-09-01&to=2026-10-07"), env);
eq(res.status, 403, "route: another client's session is refused");
who = null;
res = await H.handleGetGmFinanceReport("c1", req("?from=2026-09-01&to=2026-10-07"), env);
eq(res.status, 401, "route: no session is refused");
ok(d.writes.length === 0, "route: it writes nothing");

console.log(fail ? "\n" + fail + " FAILED" : "\nall passed");
process.exit(fail ? 1 : 0);
