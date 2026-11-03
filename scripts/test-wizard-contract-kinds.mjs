// Every work category the wizard offers, plus "Something else": the contract kind, the
// lawyer PDF and the clause by clause screen must each be right, or say plainly there is none.
// Offline checks always run. The live part runs only with a branch Worker (wrangler dev --remote),
// APEX_TEST_API, APEX_TEST_TOKEN and APEX_TEST_CLIENT (a throwaway business, NEVER a real client).
// It puts the business's work answers and trades back when it is done.
//   node scripts/test-wizard-contract-kinds.mjs
import { readFileSync } from "node:fs";
const root = new URL("../", import.meta.url);
let failed = 0, passed = 0;
function ok(cond, label) { if (cond) { passed++; console.log("PASS  " + label); } else { failed++; console.log("FAIL  " + label); } }
function read(rel) { return readFileSync(new URL(rel, root), "utf8"); }
const WIZ = JSON.parse(read("data/wizard-v1.json")), WORKER = read("worker/index.js"), SW = read("setup-wizard.js"), GM = read("gm.js");

// What each category must give. The contract Apex has for each kind of work.
const WANT = {
  pools: ["construction"], pavers: ["construction"], outdoor_living: ["construction"], tile: ["construction"], flooring: ["construction"],
  home_exterior: ["construction"], interiors: ["construction"], stone: ["construction"], construction: ["construction"], cleaning: ["cleaning"],
  cakes: [], boutique: [], water: [], other: []
};
const cats = WIZ.categories.map(c => c.key).concat(["other"]);
ok(cats.length === 14 && cats.every(k => Object.prototype.hasOwnProperty.call(WANT, k)), "Every category the wizard offers has an expected contract kind in this test (13 kinds of work and Something else)");

// ── Offline: the kind function, as written in the Worker ────────────────
const src = /function wizNoContractCat\(cat\) \{[\s\S]*?\n\}\nfunction wizLawyerKinds\(trades, cat\) \{[\s\S]*?\n\}/.exec(WORKER);
ok(!!src, "The kind function is in the Worker");
const kinds = new Function("CONTRACT_CONSTRUCTION_TRADE_KEYS", "WIZARD_V1", src[0] + "; return wizLawyerKinds;")(["pools", "tile", "remodeling", "hardscape", "general"], WIZ);
cats.forEach(k => {
  const c = WIZ.categories.filter(x => x.key === k)[0];
  const stored = c ? c.contract_trades : ["general"];   // what the wizard writes for the pick
  ok(kinds(stored, k).join() === WANT[k].join(), k + ": trades " + JSON.stringify(stored) + " give " + (WANT[k].join() || "no contract"));
});
ok(kinds([], "other").length === 0 && kinds([], "cakes").length === 0, "No trade set after picking a kind without a contract: no contract (never a remodeling one)");
ok(kinds([], undefined).join() === "construction", "No trade set and nothing picked in the wizard (an owner from before the wizard): unchanged, construction");
ok(kinds(["general", "cleaning"], "cakes").join() === "cleaning", "A baker who also ticks cleaning in Settings gets the cleaning contract only");
ok(WIZ.categories.filter(c => c.contract_available === false).map(c => c.key).sort().join() === "boutique,cakes,water", "The categories marked as having no contract are cakes, boutique and water");

// ── Offline: the screens ────────────────────────────────────────────────
ok(/A contract for this kind of work is not available in Apex yet/.test(SW) && /id="swNoContract"/.test(SW) && /SW\.d\.contract\.available === false/.test(SW), "Review: the honest line is there, and the PDF and clause links are drawn only when a contract exists");
ok(/A contract for this kind of work is not available in Apex yet/.test(GM) && /id="gmConNoContract"/.test(GM) && /if \(!noContract\) \{\s*\n\s*h \+= '<div class="gm-sheet-section"><p class="gm-sheet-section-title">' \+ gmT\("Para o seu advogado"/.test(GM), "Settings, Contracts: the honest line is there, and the lawyer PDF section is drawn only when a contract exists");
ok(/d\.available === false/.test(SW) && /available: false, url: null/.test(WORKER), "An old page that still asks for the PDF gets a plain answer (available false), not an error");
const rev = SW.slice(SW.indexOf("function swReviewStage"), SW.indexOf("// ── Events"));
ok(/return \{ html: h, need: \[\], ok: true \}/.test(rev), "Start is never blocked by the contract (Review always returns ok)");

// ── Live ────────────────────────────────────────────────────────────────
const API = process.env.APEX_TEST_API, TOKEN = process.env.APEX_TEST_TOKEN, CLIENT = process.env.APEX_TEST_CLIENT;
if (API && TOKEN && CLIENT) {
  ok(CLIENT !== "gator" && !/^(gator|real)/i.test(CLIENT), "Live part runs on a throwaway business: " + CLIENT);
  const B = API + "/api/clients/" + CLIENT + "/gm/";
  async function call(path, method, body) { const res = await fetch(B + path, { method: method || "GET", headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await res.json(); } catch (e) {} return { status: res.status, j }; }
  const cs0 = (await call("contract-settings")).j.settings, w0 = (await call("wizard")).j.answers || {};
  for (const k of cats) {
    const c = WIZ.categories.filter(x => x.key === k)[0], want = WANT[k];
    const pick = await call("wizard/work", "PUT", { cat: k, subs: c ? c.subtaps.slice(0, 2).map(t => t.key) : [], other_text: k === "other" ? "Test, ignore" : "" });
    ok(pick.status === 200, k + ": saving the pick works (" + pick.status + (pick.status === 200 ? "" : " " + JSON.stringify(pick.j)) + ")");
    const cs = await call("contract-settings"), wz = await call("wizard");
    ok(cs.status === 200 && wz.status === 200 && cs.j.contract.kinds.join() === want.join() && wz.j.contract.kinds.join() === want.join() && cs.j.contract.available === (want.length > 0), k + ": the server reports kinds [" + want.join() + "] on both screens (trades stored " + JSON.stringify(cs.j.settings.trades) + ")");
    const p = await call("wizard/lawyer-pdf", "POST", {});
    ok(p.status === 200, k + ": the PDF call is not refused (" + p.status + (p.status === 200 ? "" : " " + JSON.stringify(p.j)) + ")");
    if (want.length) {
      ok(!!p.j.url && p.j.kinds.join() === want.join() && p.j.areas > 0, k + ": a PDF link, kinds " + (p.j.kinds || []).join() + ", clause areas " + p.j.areas);
      const f = await fetch(p.j.url.replace(/^https?:\/\/[^/]+/, API)); const buf = Buffer.from(await f.arrayBuffer());
      const pages = (buf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
      ok(f.status === 200 && buf.slice(0, 5).toString() === "%PDF-" && buf.length > 50000 && pages >= 3, k + ": the real PDF opens (%PDF, " + buf.length + " bytes, " + pages + " pages)");
      if (want[0] === "cleaning") { ok(p.j.areas === 19 && pages >= 15 && (cs.j.cleaning_areas || []).length === 19, k + ": cleaning has all 19 clause areas in the PDF and on the clause screen"); }
      else { ok(p.j.areas >= 10, k + ": the construction PDF has its clause areas (" + p.j.areas + ")"); }
    } else {
      ok(p.j.available === false && !p.j.url && p.j.areas === 0, k + ": no contract, so no PDF, and the answer is plain (available false), not an error");
    }
  }
  // Put the business back the way it was.
  if (w0.cat) { await call("wizard/work", "PUT", { cat: w0.cat, subs: w0.subs || [], other_text: w0.other_text || "" }); }
  await call("contract-settings", "PUT", { trades: cs0.trades, builds_pools: cs0.builds_pools });
  const back = (await call("contract-settings")).j.settings;
  ok(JSON.stringify(back.trades) === JSON.stringify(cs0.trades), "The throwaway business's trades are back as they were");
} else { console.log("SKIP  live checks (set APEX_TEST_API, APEX_TEST_TOKEN, APEX_TEST_CLIENT)"); }
console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
