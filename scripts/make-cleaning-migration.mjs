// Writes migrations/contracts_e_cleaning.sql from the cleaning clause library
// draft (data/cleaning-clause-library-draft-v1.md). Every clause text and
// every locked-block text is COPIED from the draft by this script, never
// typed. No network, no database: it reads two files and writes one.
//   node scripts/make-cleaning-migration.mjs            (writes the .sql)
//   node scripts/make-cleaning-migration.mjs --check    (writes nothing; fails if the .sql on disk differs)
// scripts/test-cleaning-contract.mjs imports parseCleaningDraft() to prove the
// migration on disk is a byte-exact copy of the draft.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
export const DRAFT_URL = new URL("data/cleaning-clause-library-draft-v1.md", root);
export const SEED_URL = new URL("migrations/contracts_a_library.sql", root);
export const OUT_URL = new URL("migrations/contracts_e_cleaning.sql", root);

export const OLD_LABEL_SENTENCE = "Cleaning is out of scope for this draft.";
export const NEW_LABEL_SENTENCE = "Cleaning services (residential recurring; one-time or move-out; short-term-rental turnover; small commercial office): draft 1, 2026-10-04.";
// Cleaning rows sort after every construction row. The Worker tells a
// cleaning placeholder row from a construction one by this number.
export const CLEANING_SORT_BASE = 1000;
// The draft numbers its attorney questions 1 to 27; the table's key is
// (n, version) and 1 to 30 are taken, so cleaning question N is stored as 100 + N.
export const CLEANING_QUESTION_BASE = 100;

// The text of the first block of "> " lines in a run of lines.
function quoteBlock(lines) {
  let i = 0;
  while (i < lines.length && !/^>/.test(lines[i])) { i++; }
  if (i >= lines.length) { return null; }
  const out = [];
  while (i < lines.length && /^>/.test(lines[i])) { out.push(lines[i].replace(/^> ?/, "")); i++; }
  return out.join("\n");
}
function bullet(lines, label) {
  for (const l of lines) {
    const m = new RegExp("^- (?:\\*\\*)?" + label + ":(?:\\*\\*)? ?(.*)$").exec(l);
    if (m) { return m[1].trim(); }
  }
  return null;
}
function trimBlank(lines) {
  const a = lines.slice();
  while (a.length && !a[0].trim()) { a.shift(); }
  while (a.length && (!a[a.length - 1].trim() || a[a.length - 1].trim() === "---")) { a.pop(); }
  return a;
}

export function parseCleaningDraft(md) {
  const lines = md.split("\n");
  function idx(re, from) { for (let i = from || 0; i < lines.length; i++) { if (re.test(lines[i])) { return i; } } return -1; }
  const s2 = idx(/^## 2\. /), s3 = idx(/^## 3\. /), s4 = idx(/^## 4\. /), s5 = idx(/^## 5\. /), s6 = idx(/^## 6\. /), s7 = idx(/^## 7\. /);
  if ([s2, s3, s4, s5, s6, s7].some(function (x) { return x < 0; })) { throw new Error("draft sections 2 to 7 not found"); }

  // ── Section 2: locked blocks ──────────────────────────────────────────
  const blocks = [];
  const heads = [];
  for (let i = s2; i < s3; i++) {
    const m = /^(#{3,4}) (LC\d(?:-[A-Z])?)  (.+)$/.exec(lines[i]);
    if (m) { heads.push({ at: i, level: m[1].length, id: m[2], title: m[3].trim() }); }
  }
  heads.forEach(function (h, n) {
    // A parent block (###) runs to the next ### ; a sub-block (####) to the
    // next heading or to its parent's "When this block appears" line.
    let end = s3;
    for (let k = n + 1; k < heads.length; k++) { if (h.level === 4 || heads[k].level === 3) { end = heads[k].at; break; } }
    let body = lines.slice(h.at + 1, end);
    const parentBody = body;
    if (h.level === 4) {
      const stop = body.findIndex(function (l) { return /^\*\*When this block appears/.test(l); });
      if (stop >= 0) { body = body.slice(0, stop); }
    } else {
      // The parent's own text is the quote before its first sub-block.
      const firstSub = body.findIndex(function (l) { return /^#### /.test(l); });
      body = firstSub >= 0 ? body.slice(0, firstSub) : body;
    }
    const whenLine = parentBody.filter(function (l) { return /^\*\*When this block appears/.test(l); })[0] || "";
    const when = h.level === 3 ? whenLine.replace(/^\*\*When this block appears[^*]*\*\*\s*/, "").trim() : "";
    blocks.push({
      id: h.id, parent: h.level === 3 ? null : h.id.split("-")[0], title: h.title, text: quoteBlock(body),
      trigger_rule: when || null, builder_rule: bullet(body, "Builder rule") || null,
      source_url: bullet(body, "Source URLs?") || null, verification_note: bullet(body, "Verifi(?:cation|ed)") || null,
      notes_md: trimBlank(h.level === 3 ? parentBody : body).join("\n")
    });
  });

  // ── Section 4: clause areas and options ───────────────────────────────
  const areas = [], options = [];
  const cheads = [];
  for (let i = s4; i < s5; i++) {
    const m = /^### (CL\d\d(?:-[A-Z])?)  (.+)$/.exec(lines[i]);
    if (m) { cheads.push({ at: i, id: m[1], title: m[2].trim() }); }
  }
  cheads.forEach(function (h, n) {
    const end = n + 1 < cheads.length ? cheads[n + 1].at : s5;
    const body = lines.slice(h.at + 1, end);
    if (h.id.indexOf("-") === -1) { areas.push({ id: h.id, title: h.title, intro_md: trimBlank(body).join("\n"), notes_md: "" }); return; }
    const area = areas[areas.length - 1];
    const resumoAt = body.findIndex(function (l) { return /^- Resumo em portugu/.test(l); });
    const after = resumoAt >= 0 ? trimBlank(body.slice(resumoAt + 1)) : [];
    // Prose after an area's last option ("Notes for CL07: ...") belongs to the area.
    if (after.length) { area.notes_md = after.join("\n"); }
    const text = quoteBlock(body);
    if (text === null) { throw new Error("no clause text for " + h.id); }
    const textLabel = body.filter(function (l) { return /^- Clause text/.test(l); })[0] || "";
    const noteM = /^- Clause text \((.+)\):$/.exec(textLabel);
    options.push({
      id: h.id, area_id: area.id, title: h.title, templates: bullet(body, "Templates"), owner_description: bullet(body, "For the owner"),
      clause_text: text, text_note: noteM ? noteM[1] : null, placeholders: bullet(body, "Fields"), pt_summary: bullet(body, "Resumo em portugu[^:]*")
    });
  });

  // ── Section 5: placeholder fields ─────────────────────────────────────
  const placeholders = [];
  for (let i = s5; i < s6; i++) {
    const m = /^\| ([^|]+) \| ([^|]+) \| ([^|]+) \|$/.exec(lines[i]);
    if (!m || m[1].trim() === "Field" || /^-+$/.test(m[1].trim())) { continue; }
    placeholders.push({ field: m[1].trim(), meaning: m[2].trim(), source: m[3].trim() });
  }

  // ── Section 6: attorney questions ─────────────────────────────────────
  const questions = [];
  let group = "";
  for (let i = s6; i < s7; i++) {
    const g = /^\*\*(Locked blocks|Clause options)\*\*$/.exec(lines[i]);
    if (g) { group = g[1]; continue; }
    const m = /^(\d+)\. (.+)$/.exec(lines[i]);
    if (m) { questions.push({ n: Number(m[1]), group: group, text: m[2] }); }
  }
  return { blocks: blocks, areas: areas, options: options, placeholders: placeholders, questions: questions };
}

function q(v) { return v === null || v === undefined ? "NULL" : "'" + String(v).split("'").join("''") + "'"; }

export function buildCleaningSql(md, seedSql) {
  const d = parseCleaningDraft(md);
  const taken = {};
  const re = /INSERT OR IGNORE INTO contract_placeholders \([a-z_, ]*\) VALUES \('((?:[^']|'')*)'/g;
  let m;
  while ((m = re.exec(seedSql)) !== null) { taken[m[1]] = true; }
  const out = [], skipped = [];
  let rows = 0;
  out.push("-- Contract builder: the cleaning trade (service agreements). JOB R / RES-24.");
  out.push("-- GENERATED by scripts/make-cleaning-migration.mjs from data/cleaning-clause-library-draft-v1.md.");
  out.push("-- Do not edit by hand: change the script or stage a new draft version and run it again.");
  out.push("-- Adds rows only (INSERT OR IGNORE, new ids LC.. and CL..) and rewrites ONE sentence of the");
  out.push("-- version 1 label. No ALTER, no DELETE. Safe to run twice.");
  out.push("-- DRAFT - NOT REVIEWED BY AN ATTORNEY.");
  out.push("");
  out.push("UPDATE contract_library_versions SET label = REPLACE(label, " + q(OLD_LABEL_SENTENCE) + ", " + q(NEW_LABEL_SENTENCE) + ") WHERE version = 1 AND label LIKE " + q("%" + OLD_LABEL_SENTENCE + "%") + ";");
  rows++;
  d.blocks.forEach(function (b, i) {
    out.push("INSERT OR IGNORE INTO contract_locked_blocks (id, version, title, text, extra_json, trigger_rule, format_rules, builder_rule, source_url, verification_note, notes_md, sort_order) VALUES (" +
      [q(b.id), 1, q(b.title), q(b.text), q("[]"), q(b.trigger_rule), "NULL", q(b.builder_rule), q(b.source_url), q(b.verification_note), q(b.notes_md), CLEANING_SORT_BASE + i + 1].join(",") + ");");
    rows++;
  });
  d.areas.forEach(function (a, i) {
    out.push("INSERT OR IGNORE INTO contract_clause_areas (id, version, title, intro_md, notes_md, sort_order) VALUES (" + [q(a.id), 1, q(a.title), q(a.intro_md), q(a.notes_md), CLEANING_SORT_BASE + i + 1].join(",") + ");");
    rows++;
  });
  d.options.forEach(function (o, i) {
    // "Cleaning: " in front, so the trade is never read as one of the
    // construction trades (the draft's "all" means all four templates).
    out.push("INSERT OR IGNORE INTO contract_clause_options (id, version, scope, area_id, title, trades, owner_description, clause_text, text_note, placeholders, pt_summary, status, sort_order) VALUES (" +
      [q(o.id), 1, q("apex"), q(o.area_id), q(o.title), q("Cleaning: " + o.templates), q(o.owner_description), q(o.clause_text), q(o.text_note), q(o.placeholders), q(o.pt_summary), q("draft"), CLEANING_SORT_BASE + i + 1].join(",") + ");");
    rows++;
  });
  d.placeholders.forEach(function (p, i) {
    if (taken[p.field.split("'").join("''")]) { skipped.push(p.field); return; }
    out.push("INSERT OR IGNORE INTO contract_placeholders (field, version, meaning, source, sort_order) VALUES (" + [q(p.field), 1, q(p.meaning), q(p.source), CLEANING_SORT_BASE + i + 1].join(",") + ");");
    rows++;
  });
  d.questions.forEach(function (x) {
    out.push("INSERT OR IGNORE INTO contract_attorney_questions (n, version, group_name, text) VALUES (" + [CLEANING_QUESTION_BASE + x.n, 1, q("Cleaning: " + x.group), q(x.text)].join(",") + ");");
    rows++;
  });
  return { sql: out.join("\n") + "\n", rows: rows, skipped: skipped, parsed: d };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = buildCleaningSql(readFileSync(DRAFT_URL, "utf8"), readFileSync(SEED_URL, "utf8"));
  const d = r.parsed;
  console.log("locked blocks " + d.blocks.length + ", areas " + d.areas.length + ", options " + d.options.length + ", placeholder rows " + (d.placeholders.length - r.skipped.length) +
    " (skipped, already in the seed: " + (r.skipped.join("; ") || "none") + "), attorney questions " + d.questions.length + ", label update 1");
  console.log("rows written by the migration: " + r.rows);
  if (process.argv.indexOf("--check") !== -1) {
    const same = readFileSync(OUT_URL, "utf8") === r.sql;
    console.log(same ? "migrations/contracts_e_cleaning.sql matches the draft" : "migrations/contracts_e_cleaning.sql DIFFERS from what the draft generates");
    process.exit(same ? 0 : 1);
  }
  writeFileSync(OUT_URL, r.sql);
  console.log("wrote " + fileURLToPath(OUT_URL));
}
