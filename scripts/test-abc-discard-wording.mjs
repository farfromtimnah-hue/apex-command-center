// The discard question names what is being discarded: a contract order, an estimate order, or a manual order (2026-11-16).
//
//   node scripts/test-abc-discard-wording.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };
const src = readFileSync(process.env.GM_JS || new URL("../gm.js", import.meta.url), "utf8");
function fn(name, optional) {
  const i = src.indexOf("\nfunction " + name + "(");
  if (i < 0) { if (optional) { return ""; } throw new Error("function not in gm.js: " + name); }
  return src.slice(i + 1, src.indexOf("\n}", i + 1) + 2);
}
function run(lang, kind) {
  const asked = [];
  const w = { gmT: (pt, en) => (lang === "pt" ? pt : en), gmAsk: (o) => asked.push(o), gmMatDraft: { id: "d1", data: { draft: kind === undefined ? {} : { source_kind: kind } } } };
  vm.createContext(w);
  vm.runInContext(fn("gmMatDiscardWords", true) + "\n" + fn("gmMatDiscardAsk"), w);
  w.gmMatDiscardAsk();
  return asked[0];
}
const WANT = {
  contract: { en: "Discard this order?\n\nThis contract's materials order leaves the list and is not sent.", pt: "Descartar este pedido?\n\nO pedido de material deste contrato sai da lista e não é enviado." },
  estimate: { en: "Discard this order?\n\nThis estimate's materials order leaves the list and is not sent.", pt: "Descartar este pedido?\n\nO pedido de material deste orçamento sai da lista e não é enviado." },
  manual: { en: "Discard this order?\n\nThis order leaves the list and is not sent.", pt: "Descartar este pedido?\n\nEste pedido sai da lista e não é enviado." }
};
for (const kind of ["contract", "estimate", "manual"]) {
  for (const lang of ["en", "pt"]) {
    const a = run(lang, kind);
    ok(a && a.message === WANT[kind][lang], kind + " order, " + lang + ": " + JSON.stringify(a && a.message));
  }
}
ok(run("en", undefined).message === WANT.contract.en && run("pt", "").message === WANT.contract.pt, "an order from before the no-contract migration (no kind) keeps the contract wording");
const a = run("en", "manual");
ok(a.yes === "Yes, discard" && a.keep === "Keep it" && run("pt", "manual").yes === "Sim, descartar" && run("pt", "manual").keep === "Manter", "the two buttons are unchanged in both languages");
ok(!/[—–]/.test(fn("gmMatDiscardWords", true)) && !/\b(alert|confirm|prompt)\s*\(/.test(fn("gmMatDiscardAsk")), "no long dashes and no browser pop-up");
console.log(fail ? "\n" + fail + " FAILED" : "\nall passed");
process.exit(fail ? 1 : 0);
