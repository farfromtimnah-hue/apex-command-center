// Proves the pipeline search spans the WHOLE lead pool (not one stage),
// ranks name matches above other fields, and matches any field.
// Built 2026-09-08 for Rafa's "it only searches one stage" report.
import fs from "fs";

const src = fs.readFileSync(new URL("../gm.js", import.meta.url), "utf8");
function grab(startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  if (a === -1) throw new Error("not found: " + startMarker);
  const b = src.indexOf(endMarker, a);
  return src.slice(a, b === -1 ? undefined : b);
}
const code =
  grab("function gmSearchNorm", "function gmLeadMatchesSearch") +
  grab("function gmLeadMatchesSearch", "// Every lead matching") +
  grab("function gmLeadsMatching", "\nfunction gmSearchHasNoMatches");

const harness = `
  var gmLeadSearch = "";
  var gmLeadsData = null;
  var gmLeadMonth = "";
  function gmLeadMatchesMonth() { return true; }
  function gmStageLabel(s) { return ({ novo:"Novo", estimate:"Estimate", negociacao:"Negociação", fechado:"Fechado" })[s] || s; }
  ${code}
  return {
    set: function(q, leads) { gmLeadSearch = gmSearchNorm(q); gmLeadsData = { leads: leads }; },
    matching: function() { return gmLeadsMatching(); },
    rank: function(l) { return gmLeadSearchRank(l); }
  };
`;
const M = new Function(harness)();

const leads = [
  { id:"1", cliente:"MARIA SILVA",    estagio:"novo",       telefone:"(813) 555-0142", city:"Tampa",   servico:"Roof",  vendedor:"Ana" },
  { id:"2", cliente:"JOAO PEREIRA",   estagio:"fechado",    telefone:"813-555-9900",   city:"Brandon", servico:"Deck",  vendedor:"Anderson" },
  { id:"3", cliente:"CARLOS MARIANO", estagio:"negociacao", telefone:"7275551234",     city:"Tampa",   servico:"Fence", vendedor:"Ana" },
  { id:"4", cliente:"BETH ROCHA",     estagio:"estimate",   telefone:"8135550000",     city:"Riverview", servico:"Roof reppair", vendedor:"Maria" },
  { id:"5", cliente:"Conceição Lima", estagio:"fechado",    telefone:"8135551111",     city:"Tampa",   servico:"Paint", vendedor:"Ana" }
];

let failed = 0;
const check = (name, cond) => { console.log((cond ? "  ok   " : "  FAIL ") + name); if (!cond) failed++; };
const ids = (rs) => rs.map(r => r.id).join(",");

console.log('Query "maria" — leads sit in 4 DIFFERENT stages:\n');
M.set("maria", leads);
let r = M.matching();
check("finds matches across multiple stages (not just one)", r.length === 3);
check("exact name match ranks FIRST (MARIA SILVA, stage 'novo')", r[0].id === "1");
check("name-contains outranks field-only (CARLOS MARIANO before BETH)", ids(r).indexOf("3") < ids(r).indexOf("4"));
check("BETH ROCHA matched only via vendedor='Maria'", r.some(x => x.id === "4"));

console.log('\nQuery "tampa" (a city, never a name):\n');
M.set("tampa", leads);
r = M.matching();
check("matches 3 leads by city across stages novo/negociacao/fechado", r.length === 3);

console.log('\nQuery "8135550142" (phone, typed without punctuation):\n');
M.set("8135550142", leads);
r = M.matching();
check("phone matches through the (813) 555-0142 formatting", r.length === 1 && r[0].id === "1");

console.log('\nQuery "conceicao" (no cedilla, no accent):\n');
M.set("conceicao", leads);
r = M.matching();
check("accent-insensitive match on Conceição", r.length === 1 && r[0].id === "5");

console.log('\nQuery "roof" (service field):\n');
M.set("roof", leads);
r = M.matching();
check("matches service across stages novo + estimate", r.length === 2);

console.log('\nQuery "zzzz":\n');
M.set("zzzz", leads);
check("no matches returns empty", M.matching().length === 0);

console.log('\nEmpty query:\n');
M.set("", leads);
check("empty query returns the whole pool", M.matching().length === 5);

console.log("\n" + (failed ? failed + " FAILED" : "All checks passed."));
process.exit(failed ? 1 : 0);
