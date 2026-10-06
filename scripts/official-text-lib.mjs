// Reads one state file from the official-text input folder: the summary table
// and every fenced block under its "###" heading. Used by the loader script
// and by test-state-riders.mjs, so both agree on what a "fenced block" is.
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const INPUT_DIR = join(homedir(), "rez-work", "inputs", "state-riders", "official-text");
export function inputExists() { return existsSync(INPUT_DIR); }
export function statePath(code) { return join(INPUT_DIR, code + ".md"); }
// The third research pass (RES-36): same format, its own folder. A notice
// loaded from it carries source_pass "pass3" in the data file.
export const PASS3_DIR = join(homedir(), "rez-work", "inputs", "state-riders", "pass3");
export function pass3Exists(code) { return existsSync(join(PASS3_DIR, (code || "INDEX") + ".md")); }
// The file a notice's wording was cut from.
export function parseNoticeFile(code, n) { return parseStateFile(code, n && n.source_pass === "pass3" ? PASS3_DIR : null); }

export function parseStateFile(code, dir) {
  var raw = readFileSync(dir ? join(dir, code + ".md") : statePath(code), "utf8");
  var lines = raw.split("\n");
  var rows = [], blocks = [], section = "", heading = null, i = 0;
  while (i < lines.length) {
    var ln = lines[i];
    if (/^## /.test(ln)) { section = ln.slice(3).trim(); heading = null; i++; continue; }
    if (/^### /.test(ln)) { heading = ln.slice(4).trim(); i++; continue; }
    if (/^```/.test(ln)) {
      var fence = /^`+/.exec(ln)[0], start = i + 1, j = start;
      while (j < lines.length && lines[j] !== fence) { j++; }
      blocks.push({ heading: heading, section: section, index: blocks.filter(function (b) { return b.heading === heading; }).length, text: lines.slice(start, j).join("\n"), closed: j < lines.length });
      i = j + 1; continue;
    }
    if (section === "Summary table" && /^\|/.test(ln) && !/^\|\s*-/.test(ln)) {
      var cells = ln.split("|").slice(1, -1).map(function (c) { return c.trim(); });
      if (cells.length >= 5 && cells[0] !== "Item") { rows.push({ item: cells[0], cite: cells[1], status: cells[2], url: cells[3], date: cells[4] }); }
    }
    i++;
  }
  return { raw: raw, rows: rows, blocks: blocks };
}
// VERBATIM-OFFICIAL (agency page) counts as VERBATIM-OFFICIAL.
export function baseStatus(s) {
  var m = /^(VERBATIM-OFFICIAL|VERBATIM-NEAR-OFFICIAL|VERBATIM-SECONDARY|NOT OBTAINED)/.exec(String(s || "").trim());
  return m ? m[1] : null;
}
export function norm(s) { return String(s).replace(/\s+/g, " ").trim(); }

// Cuts a notice out of one block: copies the characters from the start marker through the end marker,
// both markers included, byte for byte. range = { start, end, start_occurrence, end_occurrence } (occurrences are 1-based, default 1;
// the end marker is searched only AFTER the start marker). Returns { text } or { error }.
export function cutRange(blockText, range) {
  if (!range || typeof range.start !== "string" || typeof range.end !== "string" || !range.start || !range.end) { return { error: "range needs start and end markers" }; }
  function nth(hay, needle, from, k) {
    var pos = from - 1, c = 0;
    while (c < k) { pos = hay.indexOf(needle, pos + 1); if (pos === -1) { return -1; } c++; }
    return pos;
  }
  var so = range.start_occurrence || 1, eo = range.end_occurrence || 1;
  var a = nth(blockText, range.start, 0, so);
  if (a === -1) { return { error: "start marker not found (occurrence " + so + "): " + range.start.slice(0, 60) }; }
  if (range.start_occurrence === undefined && blockText.indexOf(range.start, a + 1) !== -1) { return { error: "start marker occurs more than once; give start_occurrence or a longer marker: " + range.start.slice(0, 60) }; }
  var from = a + range.start.length;
  var b = nth(blockText, range.end, from, eo);
  if (b === -1) { return { error: "end marker not found after the start marker (occurrence " + eo + "): " + range.end.slice(0, 60) }; }
  if (range.end_occurrence === undefined && blockText.indexOf(range.end, b + 1) !== -1) { return { error: "end marker occurs more than once after the start; give end_occurrence or a longer marker: " + range.end.slice(0, 60) }; }
  return { text: blockText.slice(a, b + range.end.length) };
}
