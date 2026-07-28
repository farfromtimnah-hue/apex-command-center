// Stored-UTC timestamps must render in Eastern, and stored-LOCAL ones must not.
//
// This bug has now survived two fixes. Both times the formatter itself was
// right and the CALL SITES were wrong: a UTC value handed to formatDateTime
// prints the raw UTC clock, four hours ahead of Eastern. The first fix touched
// only the calendar, the second only the lead contact log, so "the timezone is
// fixed" was true and false at the same time.
//
// So this file asserts two different things:
//   1. the formatters convert (or deliberately don't) correctly, and
//   2. each known call site still uses the formatter its STORAGE demands.
// Part 2 is the part that catches the next regression. A call site is
// classified by how its value is WRITTEN, never by how it reads on screen:
//   datetime('now') / CURRENT_TIMESTAMP / toISOString()  -> UTC  -> ...UTC()
//   browser local construction / user-entered date field -> local -> plain

import { readFileSync } from "node:fs";

let fails = 0;
function t(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) { fails++; }
  console.log((ok ? "  ok  " : "  FAIL") + "  " + name);
  if (!ok) { console.log("        expected: " + expected + "\n        actual:   " + actual); }
}

const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
const dt = read("datetime.js");
const fmt = new Function(dt + "; return { formatDateTimeUTC, formatDateTime, formatDateUTC };")();

// ── 1. The real assessment from the incident ─────────────────────────────
{
  console.log("\nUTC -> Eastern conversion");

  // Ground truth: a real assessment completed at 2026-07-27 23:04:55 UTC by the
  // TESTING CLIENT PORTAL client. It rendered as 11:04 PM; it happened 7:04 PM.
  t("the real completed assessment renders 7:04 PM, not 11:04 PM",
    fmt.formatDateTimeUTC("2026-07-27 23:04:55"), "07/27/2026 7:04 PM");

  // Crossing midnight UTC is where the error also flips the DATE, which is how
  // a timeline gets misread as "tomorrow".
  t("UTC past midnight renders as the previous Eastern day",
    fmt.formatDateTimeUTC("2026-07-28 02:08:42"), "07/27/2026 10:08 PM");

  // DST: America/New_York is UTC-4 in July but UTC-5 in January. A hardcoded
  // offset would pass one of these and fail the other.
  t("EDT (July) converts by four hours",
    fmt.formatDateTimeUTC("2026-07-15 18:30:00"), "07/15/2026 2:30 PM");
  t("EST (January) converts by five hours",
    fmt.formatDateTimeUTC("2026-01-15 18:30:00"), "01/15/2026 1:30 PM");
  t("EST (January) crossing midnight",
    fmt.formatDateTimeUTC("2026-01-15 02:08:42"), "01/14/2026 9:08 PM");

  // An ISO string that already carries "Z" (the digital-presence notes path
  // writes new Date().toISOString()) must not get a second Z appended.
  t("an explicit-Z ISO string converts rather than breaking",
    fmt.formatDateTimeUTC("2026-07-27T23:04:55.123Z"), "07/27/2026 7:04 PM");

  t("empty stays the em dash", fmt.formatDateTimeUTC(""), "—");
  // Unparseable input falls through to formatDateTime, which splits on the
  // space and returns the date portion. Pre-existing fallback behavior, pinned
  // here as-is: the point is that it degrades rather than throwing or blanking.
  t("unparseable degrades via the plain formatter",
    fmt.formatDateTimeUTC("not a date"), "not a");
}

// ── 1b. Date-only UTC -> Eastern (formatDateUTC) ─────────────────────────
// Sibling of formatDateTimeUTC: same parse, date-only output. Three call sites
// render a stored-UTC timestamp as a DATE, so after ~8 PM Eastern the raw UTC
// date is already tomorrow — the exact BRAX bug.
{
  console.log("\nUTC -> Eastern conversion (date only)");

  // 02:03:21 UTC on 07-28 is 10:03 PM EDT on 07-27: the date must roll BACK.
  t("date-only UTC past midnight rolls back to the prior Eastern day",
    fmt.formatDateUTC("2026-07-28 02:03:21"), "07/27/2026");

  // A UTC time still within the same Eastern date must NOT roll back.
  t("date-only UTC still on the same Eastern day does not roll back",
    fmt.formatDateUTC("2026-07-28 15:00:00"), "07/28/2026");

  // An ISO string already carrying "Z" must convert, not get a second Z.
  t("date-only explicit-Z ISO string converts rather than breaking",
    fmt.formatDateUTC("2026-07-27T23:04:55.123Z"), "07/27/2026");

  t("date-only empty stays the em dash", fmt.formatDateUTC(""), "—");
}

// ── 2. Locally-stored values must NOT shift ──────────────────────────────
{
  console.log("\nlocal-stored values are left alone");

  // gmNowLocalIso() builds "YYYY-MM-DDTHH:MM" from getFullYear()/getHours() —
  // already wall-clock. Converting it would INTRODUCE a four-hour error, which
  // is the failure mode of an over-eager blanket fix.
  t("a gmNowLocalIso value keeps its wall clock",
    fmt.formatDateTime("2026-07-26T23:15"), "07/26/2026 11:15 PM");
  t("a user-entered date field is unshifted",
    fmt.formatDateTime("2026-07-26"), "07/26/2026");
  t("formatDateTime still applies no conversion at all",
    fmt.formatDateTime("2026-07-28 02:08:42"), "07/28/2026 2:08 AM");
}

// ── 3. Call-site classification ──────────────────────────────────────────
// Each entry pins one rendered value to the formatter its storage requires.
{
  console.log("\ncall sites use the formatter their storage demands");

  const client = read("client.html");
  const gm     = read("gm.js");
  const portal = read("portal.html");

  // Stored UTC -> must be formatDateTimeUTC.
  const utcSites = [
    ["client_assessments.completed_at",   client, "formatDateTimeUTC(a.completed_at)"],
    ["client_assessments.activated_at",   client, "formatDateTimeUTC(a.activated_at)"],
    ["client_logins.last_login_at",       client, "formatDateTimeUTC(s.last_login_at)"],
    ["client_notes.created_at",           client, "formatDateTimeUTC(n.created_at)"],
    ["documents date (created_at)",       client, "formatDateTimeUTC(doc.date)"],
    ["digital-presence note toISOString", client, "formatDateTimeUTC(note.date)"],
    ["gm_lead_contacts.logged_at",        gm,     "formatDateTimeUTC(c.logged_at)"],
  ];
  for (const [label, src, needle] of utcSites) {
    t(label + " uses formatDateTimeUTC", src.includes(needle), true);
  }

  // Stored local -> must stay on plain formatDateTime. gm.js:827 renders the
  // generic type:"datetime" field, whose users (data_lead, data_estimate) are
  // written by gmNowLocalIso().
  t("the generic datetime field renderer stays local",
    gm.includes('if (def.type === "datetime") { return escHtml(formatDateTime(v)); }'), true);

  // Mixed source: primeiro_contato is MIN(logged_at) (UTC) but the legacy
  // data_contato is hand-entered (local), so this one row needs BOTH — a
  // blanket conversion here would corrupt the legacy values.
  t("first-contacted branches on which source supplied the value",
    gm.includes("firstAtUtc ? formatDateTimeUTC(firstAt) : formatDateTime(firstAt)"), true);
  t("firstAtUtc is true only for the UTC-stored source",
    gm.includes("var firstAtUtc = !!lead.primeiro_contato;"), true);

  // No stray UTC value left on the plain formatter.
  for (const bad of ["formatDateTime(a.completed_at)", "formatDateTime(a.activated_at)",
                     "formatDateTime(s.last_login_at)", "formatDateTime(n.created_at)",
                     "formatDateTime(doc.date)"]) {
    t("no leftover: " + bad, client.includes(bad), false);
  }
  t("no leftover: formatDateTime(c.logged_at)", gm.includes("formatDateTime(c.logged_at)"), false);

  // Date-only stored-UTC sites -> must be formatDateUTC. These render a UTC
  // timestamp as a bare date, so the plain formatDate rolled them to tomorrow
  // after ~8 PM Eastern.
  const dateUtcSites = [
    ["documents date (doc.date, portal)",        portal, "formatDateUTC(doc.date)"],
    ["assessment completedAt (portal)",          portal, "formatDateUTC(a.completedAt)"],
    ["growth entry entered_at (client)",     client, "formatDateUTC(en.entered_at)"],
  ];
  for (const [label, src, needle] of dateUtcSites) {
    t(label + " uses formatDateUTC", src.includes(needle), true);
  }

  // No stray UTC value left on the non-converting formatDate.
  t("no leftover: formatDate((doc.date || \"\").slice(0, 10))",
    portal.includes('formatDate((doc.date || "").slice(0, 10))'), false);
  t("no leftover: formatDate((a.completedAt || \"\").slice(0, 10))",
    portal.includes('formatDate((a.completedAt || "").slice(0, 10))'), false);
  t("no leftover: formatDate(en.entered_at)",
    client.includes("formatDate(en.entered_at)"), false);
}

console.log(fails ? "\n" + fails + " FAILED" : "\nAll passed");
process.exit(fails ? 1 : 0);
