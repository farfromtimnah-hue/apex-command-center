// The event queue, the typing merge, edit mode and the cell save of the
// Pipeline spreadsheet view (2026-11-13). Loads the REAL functions from gm.js
// (the LEADS GRID LOGIC block) and drives them with fake timers.
//
//   node scripts/test-leads-grid-queue-edit.mjs
//
// Rules proven:
//   - the queue sends at 3 seconds, at once at 25, and on pagehide (keepalive)
//   - a failing sender never throws and never stops later events
//   - typing merges: one call 800 ms after the last keystroke
//   - edit mode opens read only, turns off after 10 minutes without activity,
//     and an edit or switch click starts the 10 minutes again
//   - a save calls the EXISTING lead update route and no other write route
//   - a refused save restores the old value; a cell_saved event never holds
//     the value
import { readFileSync } from "fs";

const gm = readFileSync(new URL("../gm.js", import.meta.url), "utf8");
function slice(src, a, b) {
  const i = src.indexOf(a), j = src.indexOf(b, i + a.length);
  if (i < 0 || j < 0) { throw new Error("marker not found: " + (i < 0 ? a : b)); }
  return src.slice(i, j);
}
let fails = 0;
const t = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { fails++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label +
    (ok ? "" : "\n        expected " + JSON.stringify(expected) + " got " + JSON.stringify(actual)));
};

const code =
  slice(gm, "function gmSearchNorm", "// Digits only") +
  slice(gm, "function gmParseMoney", "function gmNowLocalIso") +
  slice(gm, "function gmServicoList", "// requiredMsg") +
  slice(gm, "// ==== LEADS GRID LOGIC BEGIN ====", "// ==== LEADS GRID LOGIC END ====");
const G = new Function(code + `
  return { gmGridMakeQueue: gmGridMakeQueue, gmGridMakeDebounce: gmGridMakeDebounce, gmGridMakeEditMode: gmGridMakeEditMode,
    gmGridCommitCell: gmGridCommitCell, gmGridBuildPayload: gmGridBuildPayload, gmGridMergeServerLead: gmGridMergeServerLead,
    GM_GRID_EDIT_IDLE_MS: GM_GRID_EDIT_IDLE_MS };`)();

// ── Fake clock ────────────────────────────────────────────────────────────
function clock() {
  let now = 0, seq = 0; const timers = new Map();
  return {
    setTimeout(fn, ms) { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let next = null;
        timers.forEach((v, id) => { if (v.at <= end && (!next || v.at < next.v.at)) { next = { id, v }; } });
        if (!next) { break; }
        now = next.v.at; timers.delete(next.id); next.v.fn();
      }
      now = end;
    },
    pending() { return timers.size; }
  };
}

// ── The queue ─────────────────────────────────────────────────────────────
{
  const c = clock(); const sent = [];
  const q = G.gmGridMakeQueue({ send: (b, k) => { sent.push({ n: b.length, keepalive: k }); }, setTimeout: c.setTimeout, clearTimeout: c.clearTimeout });
  q.push({ i: 1 });
  c.advance(2999);
  t("one event waits: nothing sent at 2.999 seconds", sent.length, 0);
  c.advance(1);
  t("one event goes out at 3 seconds", sent, [{ n: 1, keepalive: false }]);
  q.push({ i: 2 }); q.push({ i: 3 });
  c.advance(3000);
  t("two later events go out together at their own 3 seconds", sent.length + ":" + sent[1].n, "2:2");
}
{
  const c = clock(); const sent = [];
  const q = G.gmGridMakeQueue({ send: (b) => { sent.push(b.length); }, setTimeout: c.setTimeout, clearTimeout: c.clearTimeout });
  for (let i = 0; i < 24; i++) { q.push({ i }); }
  t("24 events wait", sent.length, 0);
  q.push({ i: 24 });
  t("the 25th event sends the batch IMMEDIATELY", sent, [25]);
  t("the 3 second timer was cleared by the immediate send", c.pending(), 0);
  c.advance(10000);
  t("nothing is sent twice", sent, [25]);
  for (let i = 0; i < 26; i++) { q.push({ i }); }
  t("26 more: 25 go at once, one stays queued", sent.join(",") + "|" + q.size(), "25,25|1");
  c.advance(3000);
  t("the last one goes at 3 seconds", sent.join(","), "25,25,1");
}
{
  const c = clock(); const sent = [];
  const q = G.gmGridMakeQueue({ send: (b, k) => { sent.push({ n: b.length, k }); }, setTimeout: c.setTimeout, clearTimeout: c.clearTimeout });
  q.push({ i: 1 }); q.push({ i: 2 });
  q.flush(true);
  t("pagehide flush sends what is waiting with keepalive", sent, [{ n: 2, k: true }]);
  c.advance(5000);
  t("and the old timer does not send again", sent.length, 1);
  q.flush(true);
  t("flushing an empty queue sends nothing", sent.length, 1);
}
{
  const c = clock(); let calls = 0; let threw = false;
  const q = G.gmGridMakeQueue({ send: () => { calls++; throw new Error("network down"); }, setTimeout: c.setTimeout, clearTimeout: c.clearTimeout });
  try { q.push({ i: 1 }); c.advance(3000); q.push({ i: 2 }); q.flush(true); } catch (e) { threw = true; }
  t("a sender that throws never throws out of the queue", threw, false);
  t("later events still go out after a failure", calls, 2);
  const q2 = G.gmGridMakeQueue({ send: () => Promise.reject(new Error("fetch failed")), setTimeout: c.setTimeout, clearTimeout: c.clearTimeout });
  let unhandled = 0; const onU = () => { unhandled++; }; process.on("unhandledRejection", onU);
  q2.push({ i: 1 }); q2.flush(false);
  await new Promise(r => setTimeout(r, 20));
  process.off("unhandledRejection", onU);
  t("a rejected send is not an unhandled rejection", unhandled, 0);
}

// ── Typing merge ──────────────────────────────────────────────────────────
{
  const c = clock(); const d = G.gmGridMakeDebounce({ setTimeout: c.setTimeout, clearTimeout: c.clearTimeout });
  let fired = 0;
  d.run("search", 800, () => { fired++; }); c.advance(300);
  d.run("search", 800, () => { fired++; }); c.advance(300);
  d.run("search", 800, () => { fired++; }); c.advance(799);
  t("typing: nothing fires while the person is still typing", fired, 0);
  c.advance(1);
  t("typing: ONE call 800 ms after the last keystroke", fired, 1);
  d.run("a", 800, () => { fired++; }); d.run("b", 800, () => { fired++; }); c.advance(800);
  t("typing: two different boxes are merged separately", fired, 3);
  d.run("a", 800, () => { fired++; }); d.cancel("a"); c.advance(2000);
  t("typing: a cancelled call never fires", fired, 3);
}

// ── Edit mode ─────────────────────────────────────────────────────────────
{
  const c = clock(); const changes = [];
  const em = G.gmGridMakeEditMode({ setTimeout: c.setTimeout, clearTimeout: c.clearTimeout, onChange: (m, why) => changes.push(m + ":" + why) });
  t("edit mode opens READ ONLY", em.isOn(), false);
  t("the idle limit is 10 minutes", G.GM_GRID_EDIT_IDLE_MS, 600000);
  em.turnOn("button");
  t("switching on turns edit mode on", [em.isOn(), changes], [true, ["edit:button"]]);
  c.advance(599999);
  t("still on at 9 minutes 59 seconds", em.isOn(), true);
  c.advance(1);
  t("off after 10 minutes without activity", [em.isOn(), changes], [false, ["edit:button", "read:idle"]]);

  em.turnOn("button"); c.advance(9 * 60000); em.touch(); c.advance(9 * 60000);
  t("an edit or a switch click starts the 10 minutes again", em.isOn(), true);
  c.advance(60000);
  t("and then it still turns off 10 minutes after the last activity", em.isOn(), false);

  const n0 = changes.length;
  em.touch(); c.advance(20 * 60000);
  t("touching while off does not turn it on or call anything", [em.isOn(), changes.length], [false, n0]);

  em.turnOn("button"); em.turnOff("leave");
  t("leaving the grid turns it off with the reason leave", changes.slice(-1)[0], "read:leave");
  c.advance(30 * 60000);
  t("a manual off leaves no timer behind", changes.length, n0 + 2);
  em.turnOn("button"); em.turnOn("button");
  t("turning on twice is one change", changes.length, n0 + 3);
}

// ── The cell save ─────────────────────────────────────────────────────────
const lead = { id: "lead-1", cliente: "Maria Silva", valor: 1000, estagio: "novo_lead", contatos_count: 4, parceiro_name: "Parceiro X", telefone: "8135550142" };
const mkDeps = (apiImpl) => {
  const calls = [], tracked = [];
  return { calls, tracked, isEn: true, ctx: { looksLikePhone: (v) => /^\+?[\d\s().-]{7,}$/.test(v) },
    api: (path, opts) => { calls.push({ path, opts }); return apiImpl(path, opts); },
    track: (action, o) => tracked.push(Object.assign({ action }, o)) };
};

{
  const deps = mkDeps(async (path, opts) => ({ saved: true, lead: Object.assign({}, lead, opts.body) }));
  const r = await G.gmGridCommitCell(deps, lead, "valor", "4.500,00");
  t("a save calls exactly ONE route", deps.calls.length, 1);
  t("that route is the existing lead update: PUT leads/<id>", [deps.calls[0].path, deps.calls[0].opts.method], ["leads/lead-1", "PUT"]);
  t("it sends only the one field, as the lead card does", deps.calls[0].opts.body, { valor: 4500 });
  t("no other write route was called", deps.calls.filter(x => !/^leads\/lead-1$/.test(x.path) || x.opts.method !== "PUT").length, 0);
  t("ok:true and the server's lead come back", [r.ok, r.lead.valor], [true, 4500]);
  t("one cell_saved event, with column, lead and the word ok", deps.tracked, [{ action: "cell_saved", detail: "ok", column_key: "valor", lead_id: "lead-1" }]);
  t("a cell_saved event never contains the value", /4500|4\.500|1000|Maria|Silva/.test(JSON.stringify(deps.tracked)), false);
}
{
  const deps = mkDeps(async () => { const e = new Error("Sem permissão para esta ação."); e.status = 403; throw e; });
  const before = JSON.stringify(lead);
  const r = await G.gmGridCommitCell(deps, lead, "estagio", "fechado");
  t("a refused save is ok:false with the route's own words", [r.ok, r.message], [false, "Sem permissão para esta ação."]);
  t("a refused save returns no row, so the old value stays", [r.lead === undefined, G.gmGridMergeServerLead(lead, r.lead).valor], [true, 1000]);
  t("a refused save never changes the lead object", JSON.stringify(lead), before);
  t("a refused save is tracked as cell_refused, no value", deps.tracked, [{ action: "cell_refused", detail: "refused", column_key: "estagio", lead_id: "lead-1" }]);
}
{
  const deps = mkDeps(async () => ({ lead }));
  const r = await G.gmGridCommitCell(deps, lead, "valor", "abc");
  t("an unreadable valor is refused WITHOUT calling the server", [r.ok, deps.calls.length], [false, 0]);
  t("the refusal text is in the person's language (English here)", /Invalid value/.test(r.message), true);
  t("it is tracked as cell_refused", deps.tracked.map(x => x.action), ["cell_refused"]);
  const r2 = await G.gmGridCommitCell(deps, lead, "cliente", "   ");
  t("an empty client name is refused locally", [r2.ok, deps.calls.length], [false, 0]);
  const r3 = await G.gmGridCommitCell(deps, lead, "parceiro", "x");
  t("a read only column cannot be saved", [r3.ok, deps.calls.length], [false, 0]);
  const r4 = await G.gmGridCommitCell(deps, lead, "followups", "9");
  t("follow-ups stay read only, like the lead card", r4.ok, false);
  const r5 = await G.gmGridCommitCell(deps, lead, "telefone", "abc");
  t("a bad phone is refused locally", [r5.ok, deps.calls.length], [false, 0]);
}

// ── Payload shapes (same as the lead card sends) ─────────────────────────
const P = (k, v) => G.gmGridBuildPayload(k, v, { looksLikePhone: () => true });
t("text is trimmed", P("cliente", "  Ana  ").body, { cliente: "Ana" });
t("an empty note clears the field with null", P("observacao", "").body, { observacao: null });
t("services join like the card: A, B", P("servico", ["Pavers", "Lighting"]).body, { servico: "Pavers, Lighting" });
t("no service clears it", P("servico", []).body, { servico: null });
t("an empty valor clears with null", P("valor", "").body, { valor: null });
t("valor accepts a comma decimal", P("valor", "1.234,56").body, { valor: 1234.56 });
t("a zero valor is sent as 0, not null", P("valor", "0").body, { valor: 0 });
t("a datetime is sent as typed", P("data_lead", "2026-11-13T09:30").body, { data_lead: "2026-11-13T09:30" });
t("a stage is sent as its key", P("estagio", "negociacao").body, { estagio: "negociacao" });
t("dias_estagio is not editable", P("dias_estagio", "3").ok, false);
t("mes_lead is not editable", P("mes_lead", "x").ok, false);
t("parceiro is not editable", P("parceiro", "x").ok, false);
t("merge keeps the GET-only fields the PUT answer lacks", (() => { const m = G.gmGridMergeServerLead(lead, { id: "lead-1", valor: 7 }); return [m.valor, m.contatos_count, m.parceiro_name]; })(), [7, 4, "Parceiro X"]);

console.log(fails ? "\n" + fails + " FAILED" : "\nall passed");
process.exit(fails ? 1 : 0);
