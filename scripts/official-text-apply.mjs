// Loads official notice wording and corrections into data/contract-state-riders-v1.json.
// Text is only ever COPIED out of a fenced block in ~/rez-work/inputs/state-riders/official-text/<ST>.md,
// chosen by a spec file in scripts/official-text-specs/<ST>.json. Nothing is retyped.
//   node scripts/official-text-apply.mjs --check AZ     validate one spec, write nothing
//   node scripts/official-text-apply.mjs --check-all    validate every spec, write nothing
//   node scripts/official-text-apply.mjs --apply        write the data file and the change log
// Spec shape: see scripts/official-text-specs/README.md
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { parseStateFile, baseStatus, norm, cutRange } from "./official-text-lib.mjs";

var root = new URL("../", import.meta.url);
var DATA = new URL("data/contract-state-riders-v1.json", root);
var SPECS = new URL("scripts/official-text-specs/", root);
var LOG = new URL("scripts/fixtures/official-text-changes.json", root);
var PRINT_KEYS = ["sold_in_home", "is_pool", "residential", "over_cents", "at_least_cents"];
var MIRROR_STATES = null; // taken from spec.mirror_source

function clone(x) { return JSON.parse(JSON.stringify(x)); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function getPath(o, p) { var parts = p.split("."); for (var i = 0; i < parts.length; i++) { if (o === null || o === undefined) { return undefined; } o = o[parts[i]]; } return o; }
function setPath(o, p, v) { var parts = p.split("."); for (var i = 0; i < parts.length - 1; i++) { if (o[parts[i]] === null || o[parts[i]] === undefined || typeof o[parts[i]] !== "object") { o[parts[i]] = {}; } o = o[parts[i]]; } o[parts[parts.length - 1]] = v; }

export function processState(code, rider, spec, errors, log) {
  var f = parseStateFile(code), flat = norm(f.raw);
  function err(m) { errors.push(code + ": " + m); }
  function supportOk(s, what) {
    if (!s || typeof s !== "string") { err(what + ": support quote missing"); return false; }
    if (flat.indexOf(norm(s)) === -1) { err(what + ": support quote not found in the state file: " + s.slice(0, 80)); return false; }
    return true;
  }
  f.blocks.forEach(function (b) { if (!b.closed) { err("unclosed fence under " + b.heading); } });
  if (spec.state !== code) { err("spec.state is not " + code); }
  // field corrections (everything except notices)
  (spec.changes || []).forEach(function (c) {
    if (/^(notices|reviewed|outside_florida)(\.|$)/.test(c.path)) { err("change path not allowed: " + c.path); return; }
    var old = getPath(rider, c.path);
    if (!("new" in c)) { err("change without new: " + c.path); return; }
    if (supportOk(c.support, "change " + c.path)) {
      if (same(old, c.new)) { err("change " + c.path + " does not change anything"); return; }
      setPath(rider, c.path, c.new);
      log.push({ state: code, field: c.path, old: old === undefined ? null : old, new: c.new, support: c.support });
    }
  });
  // notices
  var oldNotices = rider.notices || [], handled = {}, out = [];
  (spec.notices || []).forEach(function (sn) {
    var id = sn.id, old = oldNotices.filter(function (n) { return n.id === id; })[0] || null;
    if (!id) { err("notice without id"); return; }
    if (handled[id]) { err("notice listed twice: " + id); return; }
    handled[id] = true;
    if (sn.remove) {
      if (!old) { err("remove of unknown notice " + id); return; }
      if (supportOk(sn.support, "remove " + id)) { log.push({ state: code, field: "notices." + id, old: old.title + " (" + old.cite + ")", new: "(removed)", support: sn.support }); }
      return;
    }
    var n = old ? clone(old) : { id: id };
    ["title", "cite", "trigger", "format", "applies"].forEach(function (k) {
      if (sn[k] === undefined) { return; }
      if (!same(n[k], sn[k])) { log.push({ state: code, field: "notices." + id + "." + k, old: old ? (n[k] === undefined ? null : n[k]) : null, new: sn[k], support: sn.support || null }); n[k] = sn[k]; if (old && !supportOk(sn.support, "notice " + id + " " + k)) { return; } }
    });
    if (!old) {
      log.push({ state: code, field: "notices." + id, old: null, new: "(added) " + (sn.title || "") + " (" + (sn.cite || "") + ")", support: sn.support || null });
      supportOk(sn.support, "added notice " + id);
      ["title", "cite", "trigger", "format", "applies"].forEach(function (k) { if (n[k] === undefined) { err("new notice " + id + " lacks " + k); } });
    }
    // source row
    var row = null;
    if (sn.summary_row) {
      row = f.rows.filter(function (r) { return r.item === sn.summary_row; })[0];
      if (!row) { err(id + ": summary_row not found: " + sn.summary_row); }
    }
    var st = row ? baseStatus(row.status) : "NOT OBTAINED";
    if (row && !st) { err(id + ": unreadable status " + row.status); }
    n.source_status = st; n.source_url = row ? row.url : null; n.source_date = row ? row.date : null; n.text_status = st;
    delete n.hold_reason; delete n.text_on_file; delete n.range; n.text = null;
    var mode = sn.mode || "none";
    if (mode === "print" || mode === "on_file") {
      var cond = st === "VERBATIM-OFFICIAL" || st === "VERBATIM-NEAR-OFFICIAL";
      if (!cond) { err(id + ": cannot load text with status " + st); }
      var blk = f.blocks.filter(function (b) { return b.heading === sn.block && b.index === (sn.block_index || 0); })[0];
      if (!blk) { err(id + ": block not found: " + sn.block + " #" + (sn.block_index || 0)); }
      else if (cond) {
        var isRange = sn.start !== undefined || sn.end !== undefined;
        if (!isRange && /omitted/i.test(blk.text)) { err(id + ": block contains 'omitted'; must be held"); }
        if (!blk.text.trim()) { err(id + ": empty block"); }
        var body = blk.text;
        if (sn.start !== undefined || sn.end !== undefined) {
          var rg = { start: sn.start, end: sn.end, start_occurrence: sn.start_occurrence, end_occurrence: sn.end_occurrence };
          var cut = cutRange(blk.text, rg);
          if (cut.error) { err(id + ": " + cut.error); body = ""; }
          else {
            body = cut.text;
            if (/omitted/i.test(body)) { err(id + ": cut text contains 'omitted'; must be held"); }
            if (!sn.quote_note) { err(id + ": a range needs quote_note saying how the statute's own quotation marks were handled"); }
            if (!Array.isArray(sn.blanks)) { err(id + ": a range needs blanks (an array, empty if none)"); }
            n.range = { block: blk.heading, block_index: blk.index, start: rg.start, end: rg.end, quote_note: sn.quote_note || "", blanks: sn.blanks || [] };
            if (rg.start_occurrence) { n.range.start_occurrence = rg.start_occurrence; }
            if (rg.end_occurrence) { n.range.end_occurrence = rg.end_occurrence; }
            if (sn.boundary_unsure) { n.range.boundary_unsure = sn.boundary_unsure; }
          }
        }
        if (mode === "print") {
          var ks = Object.keys(n.applies || {});
          if (!n.applies || ks.some(function (k) { return PRINT_KEYS.indexOf(k) === -1; })) { err(id + ": applies has keys the builder cannot decide; use mode on_file"); }
          if (/credit|age|homestead|insur/i.test(n.trigger || "") && !/every/i.test(n.trigger || "")) { /* judgement call, listed in unsure */ }
          n.text = body;
        } else { n.text_on_file = body; }
        log.push({ state: code, field: "notices." + id + "." + (mode === "print" ? "text" : "text_on_file"), old: null, new: "(copied from \"" + blk.heading + "\", block " + blk.index + ", " + body.length + " characters" + (n.range ? ", cut by start/end markers" : ", whole block") + ")", support: row ? row.item + " | " + row.status + " | " + row.url : null });
      }
    } else {
      if (st && (st === "VERBATIM-OFFICIAL" || st === "VERBATIM-NEAR-OFFICIAL") && !sn.hold_reason) { err(id + ": official text exists but is not loaded and no hold_reason given"); }
    }
    if (sn.hold_reason) { n.hold_reason = sn.hold_reason; }
    out.push(n);
  });
  oldNotices.forEach(function (o) { if (!handled[o.id]) { err("existing notice not covered by the spec: " + o.id); } });
  // blocks never used are fine. Status.
  var printable = out.length, loaded = out.filter(function (n) { return n.text || n.text_on_file; }).length;
  var held = out.filter(function (n) { return n.hold_reason; }).length;
  var oldStatus = rider.status;
  var status, reason;
  if (spec.mirror_source) { status = "needs primary source before use"; reason = spec.mirror_source_reason || "Built from copies that are not the state's own pages; get the primary source before use."; }
  else if (loaded === out.length && held === 0) { status = "draft rider ready"; reason = "Every notice carries wording copied from the state's own sources; no lawyer has reviewed it."; }
  else { status = "notice text still needs official copy"; reason = (out.length - loaded) + " of " + out.length + " notices still have no official wording loaded" + (held ? " (" + held + " held for a problem named in the state file)" : "") + "."; if (out.length === 0) { reason = "No state notice is listed for this state."; status = "draft rider ready"; } }
  rider.notices = out;
  if (status !== oldStatus) { log.push({ state: code, field: "status", old: oldStatus, new: status, support: reason }); }
  var oldReason = rider.status_reason;
  rider.status = status; rider.status_reason = reason;
  if (oldReason !== reason) { log.push({ state: code, field: "status_reason", old: oldReason === undefined ? null : oldReason, new: reason, support: "computed from the notices above" }); }
  return { loaded: loaded, held: held, none: out.length - loaded, total: out.length };
}

function loadSpec(code) { var u = new URL(code + ".json", SPECS); return existsSync(u) ? JSON.parse(readFileSync(u, "utf8")) : null; }
var args = process.argv.slice(2);
if (import.meta.url === new URL("file://" + process.argv[1]).href) {
  // --baseline <file>: read the starting data from this file (the data file as it was before the first load) instead of the data file itself
  var bi = args.indexOf("--baseline");
  var baselineUrl = bi !== -1 ? new URL("file://" + (args[bi + 1].charAt(0) === "/" ? args[bi + 1] : process.cwd() + "/" + args[bi + 1])) : new URL("scripts/fixtures/riders-baseline-16890ad.json", root);
  var data = JSON.parse(readFileSync(baselineUrl, "utf8"));
  var codes = args[0] === "--check" ? [args[1]] : readdirSync(SPECS).filter(function (x) { return /^[A-Z]{2}\.json$/.test(x); }).map(function (x) { return x.slice(0, 2); });
  var errors = [], log = [], summary = {};
  codes.forEach(function (code) {
    var spec = loadSpec(code);
    if (!spec) { errors.push(code + ": no spec"); return; }
    summary[code] = processState(code, data.riders[code], spec, errors, log);
  });
  if (args[0] === "--check-all" || args[0] === "--apply") {
    var all = data.states.map(function (s) { return s.code; }).filter(function (c) { return c !== "FL"; });
    all.forEach(function (c) { if (codes.indexOf(c) === -1) { errors.push(c + ": no spec"); } });
  }
  console.log(JSON.stringify(summary));
  if (errors.length) { console.log("ERRORS (" + errors.length + "):\n" + errors.join("\n")); process.exit(1); }
  console.log("OK: " + codes.length + " spec(s), " + log.length + " logged changes");
  if (args[0] === "--apply") {
    writeFileSync(DATA, JSON.stringify(data, null, 2) + "\n");
    writeFileSync(LOG, JSON.stringify(log, null, 1) + "\n");
    console.log("written");
  }
}
