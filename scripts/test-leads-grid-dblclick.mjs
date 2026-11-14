// Double click on a grid cell opens the editor (2026-11-14).
//
//   node scripts/test-leads-grid-dblclick.mjs
//
// FOUND LIVE on the test client in real Chrome: the first click selects the
// cell and the grid redraws its rows, so the second click lands on a NEW
// element and the browser never sends a "dblclick" event. Double click did
// nothing; only Enter opened the editor. The fix reads the second click's
// click count (event.detail) and opens the editor from there, and ignores the
// real dblclick event if it also arrives, so the editor opens once.
import { readFileSync } from "fs";
const src = readFileSync(new URL("../gm.js", import.meta.url), "utf8");
function grab(a, b) {
  const i = src.indexOf(a); if (i < 0) { throw new Error("not found: " + a); }
  const j = src.indexOf(b, i + a.length); if (j < 0) { throw new Error("end not found: " + b); }
  return src.slice(i, j);
}
const code = grab("function gmGridOnClick(e) {", "function gmGridOnChange(e)");
let fails = 0;
const t = (label, ok) => { if (!ok) { fails++; } console.log((ok ? "PASS" : "FAIL") + "  " + label); };

function make() {
  const calls = { start: [], lead: [], select: [] };
  const harness = `
    var gmGridSuppressClick = false;
    var gmGridDblAt = 0;
    var gmGridEdit = { isOn: function() { return true; } };
    function gmGridSelectCell(r, ci) { calls.select.push([r, ci]); }
    function gmGridSelectRow(r) { calls.select.push([r, -1]); }
    function gmGridStartEdit(r, ci, how) { calls.start.push([r, ci, how]); }
    function gmGridOpenLead(r, how) { calls.lead.push([r, how]); }
    var document = { getElementById: function() { return { focus: function() {} }; } };
    ${code}
    return { click: gmGridOnClick, dbl: gmGridOnDblClick };
  `;
  const api = new Function("calls", harness)(calls);
  return { api, calls };
}
const cellEl = (r, ci) => {
  const attrs = { "data-r": String(r), "data-ci": String(ci) };
  const el = { classList: { contains: () => false }, getAttribute: (k) => attrs[k], closest: (sel) => (/\.gm-grid-c/.test(sel) && !/hrow/.test(sel) ? el : (sel === ".gm-grid-hrow" ? null : (/\[data-act\]/.test(sel) ? null : null))) };
  return el;
};
const ev = (target, detail) => ({ target, detail, shiftKey: false });

{ const { api, calls } = make();
  api.click(ev(cellEl(3, 0), 1));
  t("one click only selects the cell", calls.select.length === 1 && calls.start.length === 0); }
{ const { api, calls } = make();
  const c = cellEl(3, 0);
  api.click(ev(c, 1)); api.click(ev(c, 2));
  t("the second click (detail 2) opens the editor on that cell, even with no dblclick event", calls.start.length === 1 && calls.start[0][0] === 3 && calls.start[0][1] === 0); }
{ const { api, calls } = make();
  const c = cellEl(3, 0);
  api.click(ev(c, 1)); api.click(ev(c, 2)); api.dbl(ev(c, 2));
  t("a real dblclick event arriving afterwards does not open it a second time", calls.start.length === 1); }
{ const { api, calls } = make();
  api.dbl(ev(cellEl(5, 2), 2));
  t("a dblclick event on its own still opens the editor", calls.start.length === 1 && calls.start[0][0] === 5 && calls.start[0][1] === 2); }
{ const { api, calls } = make();
  const c = cellEl(4, 1);
  api.click(ev(c, 3));
  t("a triple click does not open it again", calls.start.length === 0); }
console.log(fails ? "\n" + fails + " FAILED" : "\nall passed");
process.exit(fails ? 1 : 0);
