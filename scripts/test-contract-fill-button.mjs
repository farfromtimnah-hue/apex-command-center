// The "fix these before signing" screens lead straight to the contract form.
// Source checks on gm.js (root and iOS copy) plus a run of the real
// gmConGoFill with a stubbed page. No network, nothing written.
//   node scripts/test-contract-fill-button.mjs
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
let failed = 0, passed = 0;
function ok(cond, label) { if (cond) { passed++; console.log("PASS  " + label); } else { failed++; console.log("FAIL  " + label); } }

function fnSource(src, name) {
  const start = src.indexOf("function " + name + "(");
  if (start === -1) { return null; }
  let i = src.indexOf("{", start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") { depth++; } else if (src[i] === "}") { depth--; if (depth === 0) { return src.slice(start, i + 1); } }
  }
  return null;
}

for (const rel of ["gm.js", "ios/App/App/public/gm.js"]) {
  const src = readFileSync(new URL(rel, root), "utf8");
  ok(src.split('onclick="gmConGoFill()"').length - 1 === 2, rel + ": both stop screens carry the Fill in now button");
  ok(src.indexOf('gmT("Preencher agora", "Fill in now")') !== -1, rel + ": button is bilingual");
  ok(src.indexOf('onclick="gmRenderContractSheet()">\' + gmT("Voltar ao contrato"') === -1, rel + ": no stop screen ends in Back to the contract only");
  ok(src.indexOf('id="gmConFormSection"') !== -1, rel + ": the form section has an id to fall back to");
}

const src = readFileSync(new URL("gm.js", root), "utf8");
const body = fnSource(src, "gmConGoFill");
ok(!!body, "gmConGoFill exists");

function run(page) {
  const log = { rendered: 0, scrolled: null, focused: null };
  const doc = {
    getElementById(id) { return page.byId[id] || null; },
    querySelectorAll() { return page.inputs; }
  };
  const mk = (name) => ({ name, value: "", scrollIntoView() { log.scrolled = name; }, focus() { log.focused = name; } });
  Object.values(page.byId).forEach((e) => { if (e) { e.scrollIntoView = () => { log.scrolled = e.name; }; e.focus = () => { log.focused = e.name; }; } });
  page.inputs.forEach((e) => { e.scrollIntoView = () => { log.scrolled = e.name; }; e.focus = () => { log.focused = e.name; }; });
  const fn = new Function("gmRenderContractSheet", "document", "setTimeout", body + "; return gmConGoFill;")(
    () => { log.rendered++; }, doc, (f) => f());
  fn();
  return log;
}

let r = run({ byId: { gmConSafety: { name: "safety", value: "" }, gmConFormSection: { name: "form", value: "" } }, inputs: [{ name: "email", value: "" }] });
ok(r.rendered === 1 && r.focused === "safety", "empty pool safety choice comes first");
r = run({ byId: { gmConSafety: { name: "safety", value: "alarm" }, gmConFormSection: { name: "form", value: "" } }, inputs: [{ name: "filled", value: "x" }, { name: "email", value: "" }] });
ok(r.focused === "email", "otherwise the first empty missing field");
r = run({ byId: { gmConFormSection: { name: "form", value: "" } }, inputs: [{ name: "filled", value: "x" }] });
ok(r.focused === "form", "otherwise the top of the contract questions");
r = run({ byId: {}, inputs: [] });
ok(r.rendered === 1 && r.scrolled === null, "nothing to find: still reopens the contract, no crash");

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
