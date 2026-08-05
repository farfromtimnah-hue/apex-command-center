// Shared derivation logic for the task unification migration.
//
// parseDueDate() and deriveTasks() are ported verbatim in behaviour from
// tasks.html (MONTH_MAP ~line 815, deriveTasks ~line 1138, parseDueDate
// ~line 1241) so the migrated rows match exactly what the Tasks tab has
// been rendering. Any divergence here silently changes what Rafa sees.

// ── Month abbrev map — kept in sync with tasks.html ───────────────────
// "fev"/"feb" previously mapped to 0, so February resolved to January.
// Combined with the six-months-ago rollover below, a "05 Fev" task on a
// 2026 session became 2027-01-05: silently a year out, never overdue,
// pending forever. Fixed to 1 so February resolves to February.
// Must stay identical to MONTH_MAP in tasks.html (~line 815).
export const MONTH_MAP = {
  "jan": 0, "fev": 1, "feb": 1,
  "mar": 2,
  "abr": 3, "apr": 3,
  "mai": 4, "may": 4,
  "jun": 5,
  "jul": 6,
  "ago": 7, "aug": 7,
  "set": 8, "sep": 8,
  "out": 9, "oct": 9,
  "nov": 10,
  "dez": 11, "dec": 11
};

export function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Parse "DD Mon" (e.g. "20 Jun") into a Date. Ported from tasks.html.
export function parseDueDate(dueStr, sessionYear, today) {
  if (!dueStr) { return null; }
  const parts = String(dueStr).trim().split(/\s+/);
  if (parts.length < 2) { return null; }
  const day = parseInt(parts[0], 10);
  const mon = MONTH_MAP[parts[1].toLowerCase().slice(0, 3)];
  if (isNaN(day) || mon === undefined) { return null; }

  let d = new Date(sessionYear, mon, day);
  d.setHours(0, 0, 0, 0);

  // Year-rollover branch: a date more than six months in the past is
  // assumed to belong to the following year.
  const sixMonthsAgo = new Date(today);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  if (d < sixMonthsAgo) {
    d = new Date(sessionYear + 1, mon, day);
    d.setHours(0, 0, 0, 0);
  }
  return d;
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

// Resolve a due date per Nicole's rule, in priority order:
//   1. stated date on the task  → 'stated'
//   2. else session date + 7    → 'session+7'
//   3. else created_at + 7      → 'created+7'  (proxy: created_at is the
//      batch-import timestamp, not the true session date)
export function resolveDue(statedStr, sessionDate, createdAt, today) {
  if (statedStr) {
    const sessionYear = sessionDate
      ? parseInt(sessionDate.split("-")[0], 10)
      : today.getFullYear();
    const d = parseDueDate(statedStr, sessionYear, today);
    if (d) { return { due: ymd(d), source: "stated" }; }
  }
  if (sessionDate) {
    return { due: ymd(addDays(sessionDate.slice(0, 10), 7)), source: "session+7" };
  }
  if (createdAt) {
    return { due: ymd(addDays(createdAt.slice(0, 10), 7)), source: "created+7" };
  }
  return { due: null, source: null };
}

// Derive tasks from sessions. Mirrors deriveTasks() in tasks.html, including
// the discarded-session skip and the same "{sessionId}_{type}_{index}" keys.
// The _text_ fallback is derived here too so it can be counted and reported;
// whether it is imported is the caller's decision.
export function deriveTasks(sessions, today) {
  const tasks = [];

  for (const s of sessions) {
    if (s.status === "discarded") { continue; }
    if (!s.summary_json && !s.pdf_data) { continue; }

    const sessionDate = s.date || null;
    const sessionYear = sessionDate
      ? parseInt(sessionDate.split("-")[0], 10)
      : today.getFullYear();

    let pdfData = null;
    if (s.pdf_data) {
      try { pdfData = JSON.parse(s.pdf_data); } catch (e) { pdfData = null; }
    }

    const push = (kind, idx, item) => {
      const stated = item.due || null;
      const r = resolveDue(stated, sessionDate, s.created_at, today);
      tasks.push({
        key: `${s.id}_${kind}_${idx}`,
        kind,                                     // rafa | client | text
        type: kind === "rafa" ? "consultant" : "client",
        text: item.text || "",
        stated_due: stated,
        due_date: r.due,
        due_date_source: r.source,
        client_id: s.client_id || null,
        client_name: s.client_name || "—",
        session_id: s.id,
        session_date: sessionDate
      });
    };

    if (pdfData && Array.isArray(pdfData.consultant_followups)) {
      pdfData.consultant_followups.forEach((cf, j) => push("rafa", j, cf));
    }
    if (pdfData && Array.isArray(pdfData.client_actions)) {
      pdfData.client_actions.forEach((ca, k) => push("client", k, ca));
    }

    // Fallback: one free-text task per session when there is no pdf_data.
    if (!pdfData && s.summary_json) {
      let sj = null;
      try { sj = JSON.parse(s.summary_json); } catch (e) { sj = null; }
      if (sj && sj.rafa_followups) {
        const rfText = sj.rafa_followups.pt || sj.rafa_followups.en || "";
        if (rfText) { push("text", 0, { text: rfText, due: null }); }
      }
    }
  }

  return tasks;
}

// Completion keys live in sessions.task_completions alongside a "fireflies_id"
// dedupe marker written by the Fireflies import path. Only the *_rafa_N /
// *_client_N / *_text_N keys are completions; everything else must be ignored
// here and preserved in D1.
export function completionKeys(taskCompletionsJson) {
  if (!taskCompletionsJson) { return []; }
  let obj;
  try { obj = JSON.parse(taskCompletionsJson); } catch (e) { return []; }
  return Object.keys(obj).filter(
    k => obj[k] === true && /_(rafa|client|text)_\d+$/.test(k)
  );
}
