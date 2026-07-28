// Behavioral check for the Lead Pipeline's stage-duration + next-step fields.
//
//   node scripts/test-lead-stage-duration.mjs
//
// The load-bearing rule is narrow and easy to regress: stage_changed_at is the
// answer to "when did this lead last MOVE", so it must be stamped on a real
// stage change and on NOTHING else. A lead sitting on "Agendamento" for 12 days
// that Alice re-picks from the dropdown is still 12 days in; an unrelated edit
// (phone, package, notes) must not touch the clock either.
//
// This evals the real handlers out of worker/index.js against a fake D1 that
// records every statement, so the assertions exercise shipped code rather than
// a restatement of it. The client-side day/relative-time helpers are pulled out
// of client.html the same way.
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
// Records each prepared SQL string, and returns whatever the current test
// queued as the row for a .first() call.
let statements = [];
let nextRow = null;
const makeEnv = (row) => {
  statements = [];
  nextRow = row;
  return {
    DB: {
      prepare(sql) {
        statements.push(sql);
        return {
          bind: () => ({
            first: async () => nextRow,
            run:   async () => ({ success: true }),
            all:   async () => ({ results: [] })
          })
        };
      }
    }
  };
};

const req = (body) => ({ url: "https://x/api", json: async () => body });
const stamped = () => statements.filter((s) => /stage_changed_at\s*=\s*datetime/.test(s));

// ── Load the real Worker logic ────────────────────────────────────────────
globalThis.jsonOk  = (o) => ({ ok: true, body: o });
globalThis.jsonErr = (m, code) => ({ ok: false, error: m, status: code });

eval(slice(worker, "function isAdminRole(user)", "// ---------------------------------------------------------------------------\n// LEAD PIPELINE") +
  "\n; globalThis.isAdminRole = isAdminRole;");

eval(slice(worker, "var LEAD_STAGES = [", "// ---------------------------------------------------------------------------\n// Route: GET /api/role") +
  "\n; Object.assign(globalThis, { LEAD_STAGES, leadStageIndex, advanceLeadStage, actorName });");

eval(slice(worker, "async function handlePatchLeadStage(", "// ---------------------------------------------------------------------------\n// Route: PATCH /api/clients/:id/lead-next-step") +
  "\n; globalThis.handlePatchLeadStage = handlePatchLeadStage;");

eval(slice(worker, "async function handlePatchLeadNextStep(", "// ---------------------------------------------------------------------------\n// Route: POST /api/clients/:id/lead-outcome") +
  "\n; globalThis.handlePatchLeadNextStep = handlePatchLeadNextStep;");

const alice = { role: "alice" };
const rafa  = { role: "rafa" };
const client = { role: "client", client_id: "c1" };
let asUser = alice;
globalThis.authenticate = async () => asUser;

// ── stage_changed_at: only on a REAL change ───────────────────────────────
{
  // Manual override to a DIFFERENT stage -> stamped.
  let env = makeEnv({ id: "c1", status: "lead", lead_stage: "Lead", stage_changed_at: "2026-07-01 10:00:00" });
  let r = await handlePatchLeadStage("c1", req({ stage: "Agendamento" }), env);
  t("manual move to a new stage stamps stage_changed_at", stamped().length, 1);
  t("manual move reports the new stage", r.body.lead_stage, "Agendamento");
}
{
  // Manual override to the SAME stage -> no write at all.
  let env = makeEnv({ id: "c1", status: "lead", lead_stage: "Agendamento", stage_changed_at: "2026-07-01 10:00:00" });
  let r = await handlePatchLeadStage("c1", req({ stage: "Agendamento" }), env);
  t("re-picking the current stage does NOT stamp", stamped().length, 0);
  t("re-picking the current stage writes nothing", statements.filter((s) => /^UPDATE/.test(s)).length, 0);
  t("re-picking reports unchanged", r.body.unchanged, true);
  t("re-picking preserves the original timestamp", r.body.stage_changed_at, "2026-07-01 10:00:00");
}
{
  // NULL lead_stage reads as "Lead" — picking "Lead" is therefore a no-op.
  let env = makeEnv({ id: "c1", status: "lead", lead_stage: null, stage_changed_at: null });
  await handlePatchLeadStage("c1", req({ stage: "Lead" }), env);
  t("NULL stage treated as 'Lead' — picking 'Lead' does NOT stamp", stamped().length, 0);
}
{
  // Auto-advance FORWARD -> stamped.
  let env = makeEnv({ status: "lead", lead_stage: "Lead" });
  await advanceLeadStage(env, "c1", "Contato inicial");
  t("forward auto-advance stamps stage_changed_at", stamped().length, 1);
}
{
  // Auto-advance to a stage already passed -> forward-only guard, no write.
  let env = makeEnv({ status: "lead", lead_stage: "Agendamento" });
  await advanceLeadStage(env, "c1", "Contato inicial");
  t("backwards auto-advance does NOT stamp", stamped().length, 0);
}
{
  // Auto-advance re-running the SAME stage -> no write (the >= guard).
  let env = makeEnv({ status: "lead", lead_stage: "Contato inicial" });
  await advanceLeadStage(env, "c1", "Contato inicial");
  t("re-running the same auto-advance does NOT stamp", stamped().length, 0);
}
{
  // Not a lead at all -> untouched, whatever the target stage.
  let env = makeEnv({ status: "active", lead_stage: null });
  await advanceLeadStage(env, "c1", "Agendamento");
  t("auto-advance on a non-lead client does NOT stamp", stamped().length, 0);
}

// ── Next step: attribution is server-derived, all three columns move together ─
{
  asUser = rafa;
  let env = makeEnv({ id: "c1", next_step: "Call Friday", next_step_set_by: "Rafa", next_step_set_at: "2026-07-25 09:00:00" });
  // A forged author in the body must be ignored.
  let r = await handlePatchLeadNextStep("c1", req({ next_step: "Call Friday", next_step_set_by: "Alice" }), env);
  const write = statements.find((s) => /^UPDATE clients SET next_step =/.test(s));
  t("next-step write sets value, author and time in ONE statement",
    [/next_step =/, /next_step_set_by =/, /next_step_set_at = datetime/].every((re) => re.test(write)), true);
  t("author comes from the session, not the body", r.body.next_step_set_by, "Rafa");
}
{
  asUser = alice;
  let env = makeEnv({ id: "c1" });
  // Alice overwriting Rafa's next step is allowed — either can step in.
  await handlePatchLeadNextStep("c1", req({ next_step: "Send proposal" }), env);
  t("Alice may overwrite Rafa's next step", statements.some((s) => /^UPDATE clients SET next_step =/.test(s)), true);
}
{
  asUser = alice;
  let env = makeEnv({ id: "c1" });
  let r = await handlePatchLeadNextStep("c1", req({ next_step: "   " }), env);
  t("blank clears the value AND its attribution",
    statements.some((s) => /next_step = NULL.*next_step_set_by = NULL.*next_step_set_at = NULL/.test(s)), true);
  t("cleared next step reports null author", r.body.next_step_set_by, null);
}
{
  // Client-role tokens must never reach the Apex-internal attribution fields.
  asUser = client;
  let r = await handlePatchLeadNextStep("c1", req({ next_step: "x" }), makeEnv({ id: "c1" }));
  t("client role is forbidden from the next-step route", r.status, 403);
  r = await handlePatchLeadStage("c1", req({ stage: "Lead" }), makeEnv({ id: "c1", status: "lead" }));
  t("client role is forbidden from the lead-stage route", r.status, 403);
  asUser = alice;
}

// ── Client-side day counting ──────────────────────────────────────────────
eval(slice(html, "function daysSince(ts)", "function renderLeadHero()") +
  "\n; Object.assign(globalThis, { daysSince, relativeTime });");

const ago = (ms) => new Date(Date.now() - ms).toISOString().replace("T", " ").slice(0, 19);
t("NULL stage_changed_at yields null, not 0 days", daysSince(null), null);
t("same-day is 0 days", daysSince(ago(3 * 3600 * 1000)), 0);
t("just over 2 days is 2", daysSince(ago(2.5 * 86400000)), 2);
t("a future timestamp (clock skew) floors at 0",
  daysSince(new Date(Date.now() + 86400000).toISOString().replace("T", " ").slice(0, 19)), 0);
// The zone bug this guards: a bare SQLite datetime must be read as UTC.
t("bare SQLite datetime is parsed as UTC, not local", daysSince(ago(5 * 86400000)), 5);
t("relative time reads in English", relativeTime(ago(2 * 86400000), true), "2 days ago");
t("relative time reads in Portuguese", relativeTime(ago(2 * 86400000), false), "há 2 dias");
t("singular day is not pluralized", relativeTime(ago(86400000 + 3600000), true), "1 day ago");

console.log(fails ? "\n" + fails + " FAILED" : "\nAll checks passed.");
process.exit(fails ? 1 : 0);
