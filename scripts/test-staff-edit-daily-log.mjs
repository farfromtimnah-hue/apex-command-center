// Staff corrections of a client's daily log: the REAL Worker functions cut out of
// worker/index.js, on an in-memory SQLite. No network.
//
//   node scripts/test-staff-edit-daily-log.mjs
import { readFileSync } from "node:fs";
import { makeDb, build, baseStubs, req } from "./fixtures/d1-shim.mjs";

const root = new URL("../", import.meta.url);
let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) { fail++; } };

const d = makeDb([]);
const portal = readFileSync(new URL("migrations/client_portal.sql", root), "utf8");
portal.replace(/^\s*--[^\n]*$/gm, "").split(";").forEach((st) => { if (/CREATE\s+(TABLE|INDEX)[^]*?(client_daily_entries|client_missed_days|idx_cde)/i.test(st)) { try { d.raw.exec(st); } catch (e) { /* not ours */ } } });
d.raw.exec("CREATE TABLE client_field_config (client_id TEXT, indicator_key TEXT, month_label TEXT, enabled INTEGER, meta_mensal REAL, status TEXT, proposed_value REAL, proposed_at TEXT)");
const MIG = readFileSync(new URL("migrations/2026-10-08_daily_entry_edits.sql", root), "utf8");
d.raw.exec(MIG);
d.raw.exec("INSERT INTO clients (id, name, status, archived) VALUES ('c1','C ONE','active',0)");
ok(/client_daily_entry_edits/.test(MIG) && /idx_daily_entry_edits_client/.test(MIG), "migration file creates the table and its index");

const F = build(
  ["handlePutEntrySection", "handleGetEntryEdits", "requireClientAccess", "getFieldConfig", "sectionInputKeys", "indicatorByKey",
   "applicableSections", "isValidDateStr", "isValidMonthStr", "computeFinanceiroDerived", "recomputeTaxaConversao", "parseSectionsJson",
   "clientRequestAllowed", "sellerRequestAllowed"],
  ["ENTRY_SECTIONS", "INDICATORS"],
  Object.assign({}, baseStubs, {
    URL: globalThis.URL, crypto: globalThis.crypto, Object: Object,
    actorName: (u) => u.display_name,
    authenticate: async (r) => r.user,
    // the shipped sellerRequestAllowed leans on helpers this test does not exercise
    sessionSellerName: () => null
  }));

const env = { DB: d.DB };
const staff = (role, name) => ({ role: role, display_name: name });
const put = (user, date, sec, values, extra) => {
  const r = req(Object.assign({ values: values, draft: false, today: "2026-10-08" }, extra || {}));
  r.user = user;
  return F.handlePutEntrySection("c1", date, sec, r, env);
};
const edits = () => d.q("SELECT * FROM client_daily_entry_edits ORDER BY rowid");
const stored = (date) => JSON.parse(d.q("SELECT sections_json FROM client_daily_entries WHERE entry_date = ?", date)[0].sections_json);

async function main() {
  const fin = { receita: 8997494, saida: 91571.62, vendas_fechadas: 2, pipeline_ativo: 235768.688 };
  const client = { role: "client", client_id: "c1", display_name: "Owner" };

  // The client's own first save: creates the entry, records nothing.
  let r = await put(client, "2026-09-30", "financeiro", fin);
  ok(r.status === 200 && r.data.saved === true, "client save answers 200 saved");
  ok(edits().length === 0, "client's own save writes no edit row");
  ok(stored("2026-09-30").financeiro.values.lucro_liquido === 8905922.38, "derived lucro_liquido computed on save");

  // The client changing their own value: still nothing recorded.
  r = await put(client, "2026-09-30", "financeiro", Object.assign({}, fin, { saida: 100 }));
  ok(r.status === 200 && edits().length === 0, "client re-save with a changed value records no edit row");
  await put(client, "2026-09-30", "financeiro", fin);

  // Staff: one changed field.
  r = await put(staff("rafa", "Rafa Test"), "2026-09-30", "financeiro", Object.assign({}, fin, { receita: 89974.94 }));
  ok(r.status === 200, "staff save answers 200");
  let e = edits();
  ok(e.length === 1, "one changed field -> exactly one edit row (got " + e.length + ")");
  ok(e[0] && e[0].field_key === "receita" && e[0].old_value === 8997494 && e[0].new_value === 89974.94, "row has the right field, old and new value");
  ok(e[0] && e[0].actor === "Rafa Test" && e[0].actor_role === "rafa" && e[0].client_id === "c1" && e[0].entry_date === "2026-09-30" && e[0].section_key === "financeiro", "row has actor, role, client, date, section");
  ok(!e.some((x) => x.field_key === "lucro_liquido" || x.field_key === "margem_lucro"), "derived fields are not recorded as edits");
  const s = stored("2026-09-30").financeiro.values;
  ok(s.receita === 89974.94 && s.lucro_liquido === Math.round((89974.94 - 91571.62) * 100) / 100, "saved value and recomputed lucro_liquido agree with the edit row");
  ok(r.data.sections.financeiro.values.lucro_liquido === s.lucro_liquido, "server answer carries the recomputed derived value");

  // Staff: nothing changed -> nothing recorded.
  r = await put(staff("rafa", "Rafa Test"), "2026-09-30", "financeiro", Object.assign({}, fin, { receita: 89974.94 }));
  ok(r.status === 200 && edits().length === 1, "unchanged fields record nothing");

  // Staff: two fields changed -> two rows, developer role recorded.
  r = await put(staff("developer", "Dev Person"), "2026-09-30", "financeiro", Object.assign({}, fin, { receita: 90000, vendas_fechadas: 3 }));
  e = edits();
  ok(e.length === 3 && e.filter((x) => x.actor_role === "developer").length === 2, "two changed fields -> two more rows, role developer");

  // Same batch: a failing edit insert must roll the entry update back.
  const before = JSON.stringify(stored("2026-09-30"));
  d.raw.exec("ALTER TABLE client_daily_entry_edits RENAME TO edits_gone");
  r = await put(staff("rafa", "Rafa Test"), "2026-09-30", "financeiro", Object.assign({}, fin, { receita: 1234 }));
  d.raw.exec("ALTER TABLE edits_gone RENAME TO client_daily_entry_edits");
  ok(r.status === 500 && JSON.stringify(stored("2026-09-30")) === before, "edit row and entry update share one batch: when the row cannot be written the entry is unchanged");

  // Staff save of a section the client never submitted: nothing to compare.
  r = await put(staff("rafa", "Rafa Test"), "2026-09-30", "clientes_mercado", { leads_gerados: 4, visitas_estrategicas: 1, contatos_estrategicos: 1, retomadas_cliente: 1, interacoes_estrategicas: 1, google_review: 0, post_publicado: 0, story: 0, video_curto: 0, novos_clientes: 0 });
  ok(r.status === 200 && edits().length === 3, "staff first-time fill of a section records no correction");

  // entry-edits route
  const get = (user) => { const q = req({}, "https://x.test/api/clients/c1/entry-edits?month=2026-09"); q.user = user; return F.handleGetEntryEdits("c1", q, env); };
  r = await get(client);
  ok(r.status === 403, "entry-edits refuses a client session (handler)");
  r = await get(staff("rafa", "Rafa Test"));
  ok(r.status === 200 && r.data.edits.length === 3, "entry-edits answers rafa with the month's rows");
  ok(r.data.edits.filter((x) => x.actor_role === "rafa")[0].actor === "Rafa Test", "rafa's edit carries the name");
  ok(r.data.edits.filter((x) => x.actor_role === "developer").every((x) => x.actor === null), "developer's edit comes back without a name");
  ok(!JSON.stringify(r.data).includes("Dev Person"), "developer's name appears nowhere in the answer");
  r = await get(staff("alice", "Alice"));
  ok(r.status === 200, "entry-edits answers alice");
  r = await get({ role: "client", client_id: "c1", seller_name: "Ana" });
  ok(r.status === 403, "entry-edits refuses a seller session (handler)");

  // The role gates themselves, in front of the handler.
  ok(F.clientRequestAllowed("/api/clients/c1/entry-edits", "GET", "c1") === false, "client allowlist refuses entry-edits");
  ok(F.sellerRequestAllowed("/api/clients/c1/entry-edits", "GET", "c1") === false, "seller allowlist refuses entry-edits");
  ok(F.clientRequestAllowed("/api/clients/c1/entries", "GET", "c1") === true, "client allowlist still reaches its own entries (unchanged)");

  console.log(fail ? "\n" + fail + " FAILED" : "\nALL PASSED");
  process.exit(fail ? 1 : 0);
}
main();
