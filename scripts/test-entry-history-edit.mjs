// Entry history "Edit"/"Editar" (N10): a client correcting their own past,
// already-submitted day through the SAME PUT route the daily form always
// used. Worker behavior against the REAL functions cut out of
// worker/index.js, on an in-memory SQLite (no network), plus a static check
// of the new portal.html functions (no confirm()/alert()/prompt(), the Edit
// button is withheld in staff read-only preview, status wording is never
// touched by this feature).
//
//   node scripts/test-entry-history-edit.mjs
import { readFileSync } from "node:fs";
import { makeDb, build, baseStubs, req } from "./fixtures/d1-shim.mjs";

const root = new URL("../", import.meta.url);
let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) { fail++; } };

// ── Worker: handlePutEntrySection reused for a historic, already-submitted day ──

const d = makeDb([]);
const portal = readFileSync(new URL("migrations/client_portal.sql", root), "utf8");
portal.replace(/^\s*--[^\n]*$/gm, "").split(";").forEach((st) => { if (/CREATE\s+(TABLE|INDEX)[^]*?(client_daily_entries|client_missed_days|idx_cde)/i.test(st)) { try { d.raw.exec(st); } catch (e) { /* not ours */ } } });
d.raw.exec("CREATE TABLE client_field_config (client_id TEXT, indicator_key TEXT, month_label TEXT, enabled INTEGER, meta_mensal REAL, status TEXT, proposed_value REAL, proposed_at TEXT)");
d.raw.exec(readFileSync(new URL("migrations/2026-10-08_daily_entry_edits.sql", root), "utf8"));
d.raw.exec("INSERT INTO clients (id, name, status, archived) VALUES ('c1','C ONE','active',0)");

const F = build(
  ["handlePutEntrySection", "requireClientAccess", "getFieldConfig", "sectionInputKeys", "indicatorByKey",
   "applicableSections", "isValidDateStr", "isValidMonthStr", "computeFinanceiroDerived", "recomputeTaxaConversao", "parseSectionsJson",
   "clientRequestAllowed", "sellerRequestAllowed"],
  ["ENTRY_SECTIONS", "INDICATORS"],
  Object.assign({}, baseStubs, {
    URL: globalThis.URL, crypto: globalThis.crypto, Object: Object,
    actorName: (u) => u.display_name,
    authenticate: async (r) => r.user,
    sessionSellerName: () => null
  }));

const env = { DB: d.DB };
const client = { role: "client", client_id: "c1", display_name: "Owner" };
const put = (date, sec, values, extra) => {
  const r = req(Object.assign({ values: values, draft: false, today: "2026-10-08" }, extra || {}));
  r.user = client;
  return F.handlePutEntrySection("c1", date, sec, r, env);
};
const edits = () => d.q("SELECT * FROM client_daily_entry_edits ORDER BY rowid");
const stored = (date) => JSON.parse(d.q("SELECT sections_json, completed FROM client_daily_entries WHERE entry_date = ?", date)[0].sections_json);
const row = (date) => d.q("SELECT sections_json, completed FROM client_daily_entries WHERE entry_date = ?", date)[0];

async function main() {
  const fin = { receita: 10000, saida: 4000, vendas_fechadas: 2, pipeline_ativo: 5000 };
  const cli = { leads_gerados: 10, visitas_estrategicas: 2, contatos_estrategicos: 2, retomadas_cliente: 1, interacoes_estrategicas: 3, google_review: 1, post_publicado: 1, story: 0, video_curto: 0, novos_clientes: 1 };

  // Fill out a historic day's financeiro and clientes_mercado sections, as
  // the original daily form would (whether the day is fully "completed"
  // depends on how many sections this client has enabled -- not relevant to
  // the edit mechanism itself, which works on a per-section basis).
  await put("2026-09-15", "financeiro", fin);
  let r = await put("2026-09-15", "clientes_mercado", cli);
  ok(r.status === 200 && r.data.saved === true, "both sections submit cleanly (setup)");
  const completedAfterSetup = row("2026-09-15").completed;
  ok(edits().length === 0, "no edit rows from the original, first-time fill");

  // -- The Edit button's flow: re-submit an already-submitted section of a past day --
  r = await put("2026-09-15", "financeiro", Object.assign({}, fin, { vendas_fechadas: 3 }));
  ok(r.status === 200 && r.data.saved === true, "editing an already-submitted section still answers 200 saved");
  ok(row("2026-09-15").completed === completedAfterSetup, "editing a submitted section does not change the day's completed flag either way");
  let e = edits();
  ok(e.length === 1 && e[0].field_key === "vendas_fechadas" && e[0].old_value === 2 && e[0].new_value === 3, "exactly one audit row for the one changed field");
  ok(e[0].actor === "Owner" && e[0].actor_role === "client", "audit row names the client as actor with role client (N10 requirement)");
  const finVals = stored("2026-09-15").financeiro.values;
  ok(finVals.lucro_liquido === 6000 && finVals.margem_lucro === 60, "derived financeiro fields (lucro_liquido, margem_lucro) recomputed from the edited values");
  ok(finVals.taxa_conversao === 30, "taxa_conversao recomputed across sections after the edit (3/10 * 100 = 30)");

  // -- Future-day refusal still holds for an edit, same as a first-time fill --
  r = await put("2099-01-01", "financeiro", fin);
  ok(r.status === 400 && /future/i.test(r.error || ""), "a future date is still refused through the edit path");

  // -- Required fields still required on an edit submit (draft:false) --
  r = await put("2026-09-15", "financeiro", { receita: 10000, saida: 4000, vendas_fechadas: 3 /* pipeline_ativo missing */ });
  ok(r.status === 400, "a missing required field is still rejected on an edit submit, exactly as on first fill");

  // -- A section the client never submitted has nothing to compare: no audit noise --
  r = await put("2026-09-16", "financeiro", fin); // first-time fill of a different day
  ok(r.status === 200 && edits().length === 1, "a first-time fill of another day adds no audit rows (still just the one real edit)");

  console.log("");

  // ── Frontend: the new portal.html functions, read statically ──────────────
  const page = readFileSync(new URL("portal.html", root), "utf8");
  const cutFrom = (html, name) => {
    const i = html.indexOf("\n    function " + name + "(");
    if (i < 0) { throw new Error("not in portal.html: " + name); }
    return html.slice(i + 1, html.indexOf("\n    }\n", i) + 6);
  };
  const NAMES = ["startEntryEdit", "entryEditHasUnsavedChanges", "cancelEntryEdit", "closeDiscardEditModal",
    "confirmDiscardEdit", "exitEntryEdit", "finishEntryEdit", "relabelEntryFormStatic"];
  NAMES.forEach((n) => ok(!!cutFrom(page, n), "portal.html defines " + n + "()"));

  ok(page.indexOf('onclick="startEntryEdit(') > 0, "loadHistory() wires an edit button to startEntryEdit(i)");
  ok(/canEdit\s*=\s*!\(PREVIEW_AS\s*&&\s*!PREVIEW_MANAGE\)/.test(page), "the history row's edit button is gated the same way other write actions are: hidden when PREVIEW_AS is read-only");
  ok(/function startEntryEdit\(histIdx\) \{\s*\n\s*if \(PREVIEW_AS && !PREVIEW_MANAGE\) \{ return; \}/.test(page), "startEntryEdit() itself also refuses to open in staff read-only preview, not just the button's visibility");

  const js = [...page.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join("\n");
  const jsNoComments = js.split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
  ok(!/\b(confirm|alert|prompt)\s*\(/.test(jsNoComments), "portal.html: no confirm(), alert() or prompt() call anywhere (discard-changes uses an in-page card)");
  ok(page.indexOf('id="modalDiscardEdit"') > 0, "the discard-changes confirmation is an in-page modal card, not a browser dialog");
  ok(/onclick="confirmDiscardEdit\(\)"/.test(page) && /onclick="closeDiscardEditModal\(\)"/.test(page), "the discard modal has two labelled buttons (Discard / Keep editing)");

  ok(cutFrom(page, "startEntryEdit").indexOf("day-off") < 0 && cutFrom(page, "startEntryEdit").indexOf("missed") < 0, "startEntryEdit() never touches day-off or missed-day endpoints -- status wording stays whatever it already was");
  ok(cutFrom(page, "finishEntryEdit").indexOf("loadHistory") > 0 && cutFrom(page, "finishEntryEdit").indexOf("loadAnalytics") > 0, "finishing an edit reloads the history table and the analytics numbers that depend on entries");

  console.log(fail ? "\n" + fail + " FAILED" : "\nALL PASSED");
  process.exit(fail ? 1 : 0);
}
main();
