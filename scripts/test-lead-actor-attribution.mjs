// Behavioral check for lead-pipeline ACTOR ATTRIBUTION — "who did this".
//
//   node scripts/test-lead-actor-attribution.mjs
//
// The load-bearing rules, and why each is easy to regress:
//
//   1. An automatic advance records BOTH the triggering person and an 'auto:*'
//      source. A stage that moved as a side effect must never read as somebody
//      deliberately picking it — that confusion is why these columns exist.
//   2. A manual pick records source 'manual'.
//   3. advanceLeadStage's forward-only EARLY RETURN must leave the existing
//      attribution alone. This is the subtle one: the columns describe the last
//      REAL change, so a second session booked by Rafa on a lead already at
//      "Agendamento" must not overwrite Alice's name on the move that actually
//      happened. A naive implementation that stamps before the guard passes
//      every other test here and silently destroys history.
//   4. The transcript-ingestion path is NOT attributed to a human.
//
// Evals the real handlers out of worker/index.js against a fake D1 that records
// every statement and its bindings, so the assertions exercise shipped code
// rather than a restatement of it. Follows scripts/test-lead-stage-duration.mjs.
import { readFileSync } from "fs";

const worker = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
const html   = readFileSync(new URL("../client.html", import.meta.url), "utf8");

function slice(src, a, b) {
  const i = src.indexOf(a), j = src.indexOf(b, i);
  if (i < 0 || j < 0) { throw new Error("marker not found: " + a); }
  return src.slice(i, j);
}

let fails = 0;
const t = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { fails++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label +
    (ok ? "" : "\n        expected " + JSON.stringify(expected) + " got " + JSON.stringify(actual)));
};

// ── Fake D1 ───────────────────────────────────────────────────────────────
// Records {sql, args} per prepared statement that was actually .run(), so a
// test can assert on what was WRITTEN rather than merely what was prepared.
let statements = [];   // every prepare()
let writes     = [];   // only those that reached .run()
let nextRow    = null;

const makeEnv = (row) => {
  statements = []; writes = []; nextRow = row;
  return {
    DB: {
      prepare(sql) {
        statements.push(sql);
        return {
          bind: (...args) => ({
            first: async () => nextRow,
            run:   async () => { writes.push({ sql, args }); return { success: true }; },
            all:   async () => ({ results: [] })
          })
        };
      }
    }
  };
};

const stageWrites = () => writes.filter((w) => /UPDATE clients SET lead_stage/.test(w.sql));

// ── Load advanceLeadStage + actorName + leadStageIndex ────────────────────
const LEAD_STAGES = ["Lead", "Contato inicial", "Raio X enviado", "Raio X recebido", "Agendamento"];
const ctx = { LEAD_STAGES };
const helpers = slice(worker, "function actorName(user)", "// ---------------------------------------------------------------------------\n// Route: GET /api/role");
const advance = new Function("LEAD_STAGES",
  slice(worker, "function leadStageIndex(stage)", "function actorName(user)") +
  helpers +
  "return { advanceLeadStage, actorName };")(LEAD_STAGES);

const { advanceLeadStage, actorName } = advance;

// ── 1. Automatic advance records actor + auto source ──────────────────────
{
  const env = makeEnv({ status: "lead", lead_stage: "Raio X recebido" });
  await advanceLeadStage(env, "c1", "Agendamento", "Alice", "auto:session_scheduled");
  const w = stageWrites();
  t("auto advance writes the stage row", w.length, 1);
  t("auto advance records the triggering person", w[0].args[1], "Alice");
  t("auto advance records the auto source", w[0].args[2], "auto:session_scheduled");
  t("auto advance still stamps the clock",
    /stage_changed_at\s*=\s*datetime\('now'\)/.test(w[0].sql), true);
}

// ── 2. THE REGRESSION GUARD: early return must not overwrite ──────────────
// Lead is ALREADY at "Agendamento" and Rafa books a second session. The stage
// does not move, so nothing at all may be written — Alice's name must survive.
{
  const env = makeEnv({ status: "lead", lead_stage: "Agendamento" });
  await advanceLeadStage(env, "c1", "Agendamento", "Rafa", "auto:session_scheduled");
  t("no-op re-run writes nothing (attribution survives)", stageWrites().length, 0);
}
{
  // Backwards target — a contact logged on a lead already far down the ladder.
  const env = makeEnv({ status: "lead", lead_stage: "Agendamento" });
  await advanceLeadStage(env, "c1", "Contato inicial", "Rafa", "auto:contact_logged");
  t("backwards advance writes nothing", stageWrites().length, 0);
}
{
  // Not a lead at all: scheduling a session for a real active client.
  const env = makeEnv({ status: "active", lead_stage: "Agendamento" });
  await advanceLeadStage(env, "c1", "Agendamento", "Rafa", "auto:session_scheduled");
  t("non-lead writes nothing", stageWrites().length, 0);
}

// ── 3. actorName follows the display-name convention ──────────────────────
t("actorName prefers display_name", actorName({ display_name: "Alice", role: "alice" }), "Alice");
t("actorName falls back to role",   actorName({ role: "rafa" }), "rafa");
t("actorName of nothing is null",   actorName(null), null);

// ── 4. Manual path stamps source 'manual' ─────────────────────────────────
{
  const handler = new Function("LEAD_STAGES", "authenticate", "isAdminRole", "jsonOk", "jsonErr",
    slice(worker, "function leadStageIndex(stage)", "function actorName(user)") +
    slice(worker, "function actorName(user)", "// Auto-advance a lead's stage") +
    slice(worker, "async function handlePatchLeadStage", "// ---------------------------------------------------------------------------\n// Route: PATCH /api/clients/:id/lead-next-step") +
    "return handlePatchLeadStage;"
  )(LEAD_STAGES,
    async () => ({ role: "alice", display_name: "Alice" }),
    () => true,
    (o) => ({ ok: true, body: o }),
    (m, s) => ({ ok: false, error: m, status: s })
  );

  // Real move: Lead -> Raio X enviado.
  const env = makeEnv({ id: "c1", status: "lead", lead_stage: "Lead",
                        stage_changed_at: null, stage_changed_by: null, stage_change_source: null });
  await handler("c1", { json: async () => ({ stage: "Raio X enviado" }) }, env);
  const w = stageWrites();
  t("manual change writes the stage row", w.length, 1);
  t("manual change records source 'manual'", /stage_change_source\s*=\s*'manual'/.test(w[0].sql), true);
  t("manual change records the acting admin", w[0].args[1], "Alice");
}
{
  // Re-picking the CURRENT stage is a no-op and must not restamp anything.
  const handler = new Function("LEAD_STAGES", "authenticate", "isAdminRole", "jsonOk", "jsonErr",
    slice(worker, "function leadStageIndex(stage)", "function actorName(user)") +
    slice(worker, "function actorName(user)", "// Auto-advance a lead's stage") +
    slice(worker, "async function handlePatchLeadStage", "// ---------------------------------------------------------------------------\n// Route: PATCH /api/clients/:id/lead-next-step") +
    "return handlePatchLeadStage;"
  )(LEAD_STAGES,
    async () => ({ role: "rafa", display_name: "Rafa" }),
    () => true,
    (o) => ({ ok: true, body: o }),
    (m, s) => ({ ok: false, error: m, status: s })
  );

  const env = makeEnv({ id: "c1", status: "lead", lead_stage: "Agendamento",
                        stage_changed_at: "2026-07-20 14:00:00",
                        stage_changed_by: "Alice", stage_change_source: "auto:session_scheduled" });
  const res = await handler("c1", { json: async () => ({ stage: "Agendamento" }) }, env);
  t("re-picking current stage writes nothing", stageWrites().length, 0);
  t("re-pick echoes the PREVIOUS mover, not the caller", res.body.stage_changed_by, "Alice");
  t("re-pick echoes the previous source", res.body.stage_change_source, "auto:session_scheduled");
}

// ── 5. Ingestion path is not attributed to a human ────────────────────────
{
  const ingest = slice(worker, "INSERT INTO sessions (id, client_name, date, status, raw_transcript, task_completions, created_at, created_by)", "return { session_id: sessionId, duplicate: false };");
  t("fireflies ingest stamps created_by 'fireflies'", /'fireflies'/.test(ingest), true);
  t("fireflies ingest binds no actor name", /actorName/.test(ingest), false);

  const gsync = slice(worker, "INSERT INTO sessions (id, client_name, date, time, session_type, google_meet_link, google_event_id, calendar_provider, status, html_link, end_time, attendees, created_by)", ").bind(");
  t("google sync stamps created_by 'google_calendar'", /'google_calendar'/.test(gsync), true);
}

// ── 6. Every advanceLeadStage call site passes an actor and a source ──────
{
  const calls = worker.match(/await advanceLeadStage\([^;]*\);/g) || [];
  t("all four call sites found", calls.length, 4);
  const missing = calls.filter((c) => {
    const args = c.slice(c.indexOf("(") + 1).split(",");
    return args.length < 5;   // env, id, stage, actor, source
  });
  t("no call site omits actor/source", missing, []);
  const sources = calls.map((c) => (c.match(/"(auto:[a-z_]+)"/) || [])[1]).filter(Boolean);
  t("each auto source is distinct", new Set(sources).size, sources.length);
}

// ── 7. UI: automatic never reads as a deliberate pick ─────────────────────
{
  const ui = new Function("document", "escHtml",
    slice(html, "var STAGE_SOURCE_TEXT = {", "    // ── Next step") +
    "return { renderStageProvenance, setState: (by, src) => { leadStageChangedBy = by; leadStageSource = src; } };"
  );
  // Minimal DOM double: one element, and a body whose class decides language.
  const mk = (en) => {
    const el = { hidden: true, innerHTML: "" };
    const doc = {
      body: { classList: { contains: () => en } },
      getElementById: () => el
    };
    return { el, doc };
  };

  const run = (by, src, en) => {
    const { el, doc } = mk(en);
    const scope = new Function("document", "escHtml",
      "var leadStageChangedBy = " + JSON.stringify(by) + ";" +
      "var leadStageSource = " + JSON.stringify(src) + ";" +
      slice(html, "var STAGE_SOURCE_TEXT = {", "    // ── Next step") +
      "renderStageProvenance(); return { hidden: document.getElementById().hidden, html: document.getElementById().innerHTML };"
    )(doc, (s) => String(s));
    return scope;
  };

  const autoEn = run("Alice", "auto:session_scheduled", true);
  t("auto text says it was automatic",
    /automatically when a session was scheduled/.test(autoEn.html), true);
  t("auto text still names the triggering person", /Alice/.test(autoEn.html), true);
  t("auto text does NOT read as a deliberate pick",
    /^Moved by/.test(autoEn.html.replace(/<[^>]*>/g, "")), false);

  const manualEn = run("Rafa", "manual", true);
  t("manual text reads as a person's move",
    /Moved by Rafa/.test(manualEn.html.replace(/<[^>]*>/g, "")), true);
  t("manual text says nothing about automation",
    /automatic/i.test(manualEn.html), false);

  const clientEn = run("client", "auto:xray_submitted", true);
  t("client submission is named as the client, not an Apex person",
    /by the client/.test(clientEn.html.replace(/<[^>]*>/g, "")), true);

  t("unknown attribution renders nothing at all", run(null, null, true).hidden, true);

  const autoPt = run("Alice", "auto:session_scheduled", false);
  t("PT auto text is translated", /automaticamente ao agendar/.test(autoPt.html), true);

  // A source token this page does not know (worker deployed ahead of the page)
  // must still read as automatic rather than as a deliberate pick.
  const future = run("Alice", "auto:something_new", true);
  t("unknown auto token still reads as automatic", /automatically/.test(future.html), true);
}

// ── 8. Timezone: stored-UTC timestamps render in Eastern ──────────────────
{
  const dt = readFileSync(new URL("../datetime.js", import.meta.url), "utf8");
  const fmt = new Function(dt + "; return { formatDateTimeUTC, formatDateTime };")();

  // The exact value from the incident: 02:08:42 UTC is 10:08 PM Eastern the
  // PREVIOUS day. The old formatter read it as 2am, a four-hour error.
  t("UTC 02:08 renders as 10:08 PM Eastern the previous day",
    fmt.formatDateTimeUTC("2026-07-28 02:08:42"), "07/27/2026 10:08 PM");
  t("plain formatDateTime still shows the raw UTC clock (unchanged behavior)",
    fmt.formatDateTime("2026-07-28 02:08:42"), "07/28/2026 2:08 AM");
  // Winter: EST is UTC-5, so the same wall clock shifts by five hours.
  t("EST (winter) converts by five hours",
    fmt.formatDateTimeUTC("2026-01-15 02:08:42"), "01/14/2026 9:08 PM");
  t("empty stays the em dash", fmt.formatDateTimeUTC(""), "—");
}

console.log(fails ? "\n" + fails + " FAILED" : "\nAll passed");
process.exit(fails ? 1 : 0);
