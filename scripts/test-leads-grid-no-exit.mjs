// NO WAY OUT guard for the Pipeline spreadsheet view (2026-11-13).
//
//   node scripts/test-leads-grid-no-exit.mjs
//
// If lead data can leave the grid, the usage log goes blind. This scans the
// grid code (the two marked blocks in gm.js, the grid rules in gm.css, and the
// developer log page) and FAILS when it finds anything that exports,
// downloads, prints or bulk copies, or reads a fingerprint of the browser.
// It also proves the blockers and the print rule are actually there.
import { readFileSync } from "fs";

const gm = readFileSync(new URL("../gm.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../gm.css", import.meta.url), "utf8");
const page = readFileSync(new URL("../leads-grid-log.html", import.meta.url), "utf8");
function slice(src, a, b) {
  const i = src.indexOf(a), j = src.indexOf(b, i + a.length);
  if (i < 0 || j < 0) { throw new Error("marker not found: " + (i < 0 ? a : b)); }
  return src.slice(i, j + b.length);
}
let fails = 0;
const t = (label, ok) => { if (!ok) { fails++; } console.log((ok ? "PASS" : "FAIL") + "  " + label); };

const logic = slice(gm, "// ==== LEADS GRID LOGIC BEGIN ====", "// ==== LEADS GRID LOGIC END ====");
const ui = slice(gm, "// ==== LEADS GRID UI BEGIN ====", "// ==== LEADS GRID UI END ====");
const gridCss = css.slice(css.indexOf("Pipeline spreadsheet view"));
const targets = { "gm.js grid logic": logic, "gm.js grid UI": ui, "gm.css grid rules": gridCss, "leads-grid-log.html": page };

// Comments are allowed to NAME these things (this very file explains them);
// code is not. Strip comments before looking.
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/([^:"'\\])\/\/.*$/gm, "$1");

const FORBIDDEN = [
  ["Blob", /\bBlob\b/],
  ["URL.createObjectURL / createObjectURL", /createObjectURL/],
  ["a download attribute", /\bdownload\s*=|\.download\b|setAttribute\(\s*["']download/],
  ["window.print(", /\bprint\s*\(/],
  ["navigator.clipboard", /navigator\.clipboard/],
  ["clipboardData.setData", /clipboardData\s*\.\s*setData/],
  ["document.execCommand", /execCommand/],
  ["XLSX", /XLSX/i],
  ["text/csv", /text\/csv/i],
  ["a .csv name", /\.csv\b/i],
  ["the SheetJS file in this repo", /xlsx\.mini/i],
  ["navigator.share", /navigator\.share/],
  ["canvas toDataURL (fingerprint)", /toDataURL/],
  ["getImageData (fingerprint)", /getImageData/],
  ["AudioContext (fingerprint)", /AudioContext/],
  ["WebGL (fingerprint)", /getContext\(\s*["'](webgl|experimental-webgl|2d)/],
  ["font probing (fingerprint)", /document\.fonts|measureText/],
  ["navigator.plugins / hardwareConcurrency (fingerprint)", /navigator\.(plugins|hardwareConcurrency|deviceMemory|getBattery)/],
  ["eval / new Function in the grid", /\beval\s*\(|new Function\(/],
  ["a browser pop-up", /(^|[^A-Za-z0-9_.$])(window\.)?(alert|confirm|prompt)\s*\(/],
  ["a CDN or outside script tag", /<script[^>]+src=["']https?:\/\/(?!www\.gstatic\.com\/firebasejs)/],
  ["a long dash or en dash", /[\u2013\u2014]/],
  ["window.open / a new window", /window\.open\(/]
];
Object.keys(targets).forEach((name) => {
  const code = name.endsWith(".html") ? stripComments(targets[name].replace(/<!--[\s\S]*?-->/g, "")) : stripComments(targets[name]);
  FORBIDDEN.forEach(([what, re]) => {
    if (name === "leads-grid-log.html" && what === "a CDN or outside script tag") { return; }
    const hit = re.exec(code);
    t(name + ": no " + what + (hit ? "  (found: " + JSON.stringify(code.slice(Math.max(0, hit.index - 30), hit.index + 50)) + ")" : ""), !hit);
  });
});

// The developer page may use the same Firebase scripts the other staff pages use, and nothing else outside.
const outside = (page.match(/<script[^>]+src=["']https?:\/\/[^"']+/g) || []).map(x => x.replace(/[\s\S]*src=["']/, ""));
t("leads-grid-log.html: outside scripts are only the Firebase ones the other staff pages load", outside.every(u => /^https:\/\/www\.gstatic\.com\/firebasejs\/10\.12\.1\//.test(u)));
t("leads-grid-log.html: no form, no button that saves or copies", !/<form|copy|clipboard|download/i.test(stripComments(page.replace(/<!--[\s\S]*?-->/g, ""))));

// The blockers exist and each blocked attempt is tracked.
t("copy is blocked and tracked", /addEventListener\("copy"[\s\S]{0,120}preventDefault\(\)[\s\S]{0,120}copy_blocked/.test(ui));
t("cut is blocked and tracked", /addEventListener\("cut"[\s\S]{0,120}preventDefault\(\)[\s\S]{0,120}cut_blocked/.test(ui));
t("dragstart is blocked", /addEventListener\("dragstart"[\s\S]{0,120}preventDefault\(\)/.test(ui));
t("the context menu is blocked and tracked", /addEventListener\("contextmenu"[\s\S]{0,120}preventDefault\(\)[\s\S]{0,120}contextmenu_blocked/.test(ui));
t("Ctrl/Cmd+P is blocked and tracked as print_blocked", /ctrlKey \|\| e\.metaKey\) && \(k === "p" \|\| k === "s"\)[\s\S]{0,200}print_blocked/.test(ui));
t("Ctrl/Cmd+S is blocked and tracked as save_blocked", /save_blocked/.test(ui));
t("the key blocker only lives while the grid is showing (added and removed)", /document\.addEventListener\("keydown", gmGridDocKey, true\)/.test(ui) && /document\.removeEventListener\("keydown", gmGridDocKey, true\)/.test(ui));
t("a print attempt from the browser menu is tracked", /addEventListener\("beforeprint"/.test(ui));
t("the print stylesheet hides the grid", /@media print\s*\{\s*\.gm-grid-wrap\s*\{\s*display:\s*none\s*!important/.test(gridCss));
// 2026-11-14 (Nicole: "make sure that no one can copy and paste the spreadsheet materials"):
// the cells can no longer be selected at all; only a text field inside the grid (the one cell being edited) can.
t("grid cells cannot be selected (user-select none)", /\.gm-grid-c\s*\{[^}]*user-select:\s*none/.test(gridCss) && !/\.gm-grid-c\s*\{[^}]*user-select:\s*text/.test(gridCss));
t("the grid has no touch callout (iPhone long press copy)", /\.gm-grid-wrap\s*\{[^}]*-webkit-touch-callout:\s*none/.test(gridCss));
t("selection starting inside the grid is stopped (selectstart), except in a text field", /addEventListener\("selectstart"[\s\S]{0,260}closest\("input, textarea, select"\)[\s\S]{0,80}return;[\s\S]{0,60}preventDefault\(\)/.test(ui));
t("Ctrl/Cmd+A, C, X and Insert are blocked and tracked while focus is in the grid", /k === "a" \|\| k === "c" \|\| k === "x" \|\| k === "insert"\) && gmGridFocusInside\(e\.target\)[\s\S]{0,240}(copy_blocked|cut_blocked)/.test(ui));
t("a document level copy and cut guard exists only while the grid is showing", /document\.addEventListener\("copy", gmGridCopyGuard, true\)/.test(ui) && /document\.addEventListener\("cut", gmGridCopyGuard, true\)/.test(ui) && /document\.removeEventListener\("copy", gmGridCopyGuard, true\)/.test(ui) && /document\.removeEventListener\("cut", gmGridCopyGuard, true\)/.test(ui));
t("the copy guard leaves anything outside the grid (the lead card) alone", /if \(!inside\) \{ return; \}/.test(ui));
t("a faint stamp (device id and time) sits over the rows", /gm-grid-wrap::after[\s\S]{0,200}var\(--gm-wm/.test(gridCss) && /function gmGridStamp\(\)/.test(ui) && /gmGridStamp\(\);\s*gmGridInstallPageHide/.test(ui));
t("the stamp text holds only a device id and the time, never typed text", /var text = "Apex " \+ short \+ " " \+ when;/.test(ui) && /replace\(\/\[\^A-Za-z0-9 :,\.-\]\/g, ""\)/.test(ui));
t("the stamp is hidden when printing", /@media print\s*\{\s*\.gm-grid-wrap::after\s*\{\s*display:\s*none\s*!important/.test(gridCss));
t("the lead card's own copying is untouched: no copy handler outside the grid blocks", !/addEventListener\("copy"/.test(gm.replace(ui, "")));

// What it must NOT depend on.
t("no new npm dependency in package.json for this build", !/xlsx|sheetjs|ag-grid|handsontable|datatables/i.test(readFileSync(new URL("../package.json", import.meta.url), "utf8")));
t("the grid does not call the lead export or any download route", !/\/export|\/download|\/pdf|\.pdf/i.test(stripComments(logic + ui)));

console.log(fails ? "\n" + fails + " FAILED" : "\nall passed");
process.exit(fails ? 1 : 0);
