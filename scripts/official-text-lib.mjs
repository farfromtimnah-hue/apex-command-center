// Reads one state file from the official-text input folder: the summary table
// and every fenced block under its "###" heading. Used by the loader script
// and by test-state-riders.mjs, so both agree on what a "fenced block" is.
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const INPUT_DIR = join(homedir(), "rez-work", "inputs", "state-riders", "official-text");
export function inputExists() { return existsSync(INPUT_DIR); }
export function statePath(code) { return join(INPUT_DIR, code + ".md"); }

export function parseStateFile(code) {
  var raw = readFileSync(statePath(code), "utf8");
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
