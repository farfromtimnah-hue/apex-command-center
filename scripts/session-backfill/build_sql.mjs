// Mirrors handlePostSummarize's write path exactly:
//  1. summary_json = Object.assign({}, reviewData, pdfDataRaw)
//  2. pdf_data = summary_json.pdf_data, with .pt of the 3 structured
//     sections copied down, then active_sections/custom_sections stamped
//  3. three writes: sessions, session_summaries, documents
import { readFileSync } from "fs";

const STANDARD_SECTION_KEYS = [
  "business_diagnosis", "recommendations", "client_actions",
  "consultant_followups", "next_session_focus", "swot",
  "swot_synthesis", "thirty_day_plan", "thirty_day_goals"
];

const sessionId = process.argv[2];
const jsonPath  = process.argv[3];
if (!sessionId || !jsonPath) {
  console.error("usage: node build_sql.mjs <session_id> <summary.json>");
  process.exit(1);
}

const ss = JSON.parse(readFileSync(jsonPath, "utf8"));
const pdfData = ss.pdf_data;

// Safety net, same as worker: PT side of structured sections into pdf_data
for (const k of ["business_diagnosis", "swot_synthesis", "thirty_day_goals"]) {
  if (!pdfData[k] && ss[k]) pdfData[k] = ss[k].pt || null;
}
// active_sections/custom_sections are stamped server-side from section_config.
// If the summary JSON already carries them (gated by fix_sections.mjs against a
// non-null section_config), keep those; otherwise default to all 9 enabled.
if (!Array.isArray(pdfData.active_sections) || pdfData.active_sections.length === 0) {
  pdfData.active_sections = STANDARD_SECTION_KEYS.slice();
}
if (!Array.isArray(pdfData.custom_sections)) pdfData.custom_sections = [];

const q = (v) => v === null || v === undefined ? "NULL" : "'" + String(v).replace(/'/g, "''") + "'";
const secJson = (sec, lang) =>
  sec && sec[lang] !== undefined && sec[lang] !== null ? JSON.stringify(sec[lang]) : null;

const summaryJsonStr = JSON.stringify(ss);
const pdfDataStr     = JSON.stringify(pdfData);

// Deterministic ids (no Math.random / Date.now in this environment)
const summaryId = `sum-${sessionId.slice(0, 8)}-migrated`;
const docId     = `doc-${sessionId.slice(0, 8)}-migrated`;

const stmts = [];

stmts.push(
  `UPDATE sessions SET summary_json = ${q(summaryJsonStr)}, pdf_data = ${q(pdfDataStr)}, ` +
  `status = 'summarized' WHERE id = ${q(sessionId)};`
);

stmts.push(
  `INSERT INTO session_summaries (id, session_id, summary_pt, summary_en, ` +
  `recommendations_pt, recommendations_en, client_action_items_pt, client_action_items_en, ` +
  `rafa_followups_pt, rafa_followups_en, next_session_focus_pt, next_session_focus_en, ` +
  `client_profile_updates_pt, client_profile_updates_en, business_diagnosis_pt, business_diagnosis_en, ` +
  `swot_synthesis_pt, swot_synthesis_en, thirty_day_goals_pt, thirty_day_goals_en) VALUES (` +
  [
    q(summaryId), q(sessionId),
    q(ss.discussion_overview?.pt), q(ss.discussion_overview?.en),
    q(ss.recommendations?.pt), q(ss.recommendations?.en),
    q(ss.client_action_items?.pt), q(ss.client_action_items?.en),
    q(ss.rafa_followups?.pt), q(ss.rafa_followups?.en),
    q(ss.next_session_focus?.pt), q(ss.next_session_focus?.en),
    q(ss.client_profile_updates?.pt), q(ss.client_profile_updates?.en),
    q(secJson(ss.business_diagnosis, "pt")), q(secJson(ss.business_diagnosis, "en")),
    q(secJson(ss.swot_synthesis, "pt")), q(secJson(ss.swot_synthesis, "en")),
    q(secJson(ss.thirty_day_goals, "pt")), q(secJson(ss.thirty_day_goals, "en"))
  ].join(", ") +
  `) ON CONFLICT(session_id) DO UPDATE SET ` +
  [
    "summary_pt", "summary_en", "recommendations_pt", "recommendations_en",
    "client_action_items_pt", "client_action_items_en", "rafa_followups_pt", "rafa_followups_en",
    "next_session_focus_pt", "next_session_focus_en", "client_profile_updates_pt", "client_profile_updates_en",
    "business_diagnosis_pt", "business_diagnosis_en", "swot_synthesis_pt", "swot_synthesis_en",
    "thirty_day_goals_pt", "thirty_day_goals_en"
  ].map((c) => `${c} = excluded.${c}`).join(", ") + `;`
);

stmts.push(
  `INSERT INTO documents (id, session_id, pdf_data) VALUES (${q(docId)}, ${q(sessionId)}, ${q(pdfDataStr)}) ` +
  `ON CONFLICT(session_id) DO UPDATE SET pdf_data = excluded.pdf_data;`
);

console.log(stmts.join("\n"));
