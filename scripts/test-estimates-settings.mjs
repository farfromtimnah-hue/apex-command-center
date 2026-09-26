// Estimates & invoices build — PHASE 1 (foundation).
//
// Runs the REAL functions out of worker/index.js and gm.js (sliced and
// evaluated, no copies) for:
//   * the 18% late-fee cap (Florida §687.03)
//   * schedule presets: steps must total exactly 100 (or be empty = Custom)
//   * cost line types: material | labor | other, absent = material, and the
//     per-type split gmPricingComputed / gmPricingCompute report
//   * the role gates: a seller reads pricing and jobs, writes neither; the
//     document settings are owner-only and never seller-reachable.
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const worker = readFileSync(new URL("worker/index.js", root), "utf8");
const gm = readFileSync(new URL("gm.js", root), "utf8");

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };
const slice = (src, a, b) => {
  const i = src.indexOf(a); const j = src.indexOf(b, i);
  if (i < 0 || j < 0) throw new Error("slice not found: " + a);
  return src.slice(i, j);
};
const fnSrc = (src, name) => {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) throw new Error("function not found: " + name);
  // to the first "\n}" at column 0 after the start
  const j = src.indexOf("\n}", i);
  return src.slice(i, j + 2);
};

// ---- worker: pure helpers ----
const W = {};
// Pieces are joined with newlines: a slice can end on a comment line.
new Function("g", [
  "var jsonErr=function(){};",
  fnSrc(worker, "gmStr"), fnSrc(worker, "gmNum"),
  slice(worker, "var GM_COST_LINE_TYPES = [", "\nvar GM_PRICING_KINDS"),
  fnSrc(worker, "gmPricingParseBreakdown"), fnSrc(worker, "gmPricingComputed"),
  slice(worker, "var GM_DOC_PAYMENT_METHODS = [", "\nasync function gmDocSettingsRow"),
  slice(worker, "function clientRequestAllowed(path, method, clientId) {", "\nasync function enforceClientRoleGate")
].join("\n") +
  "\ng.gmPricingComputed=gmPricingComputed; g.gmCostLineType=gmCostLineType; g.gmDocScheduleStepsError=gmDocScheduleStepsError;" +
  "g.gmDocParseSchedulePresets=gmDocParseSchedulePresets; g.gmDocParseLateFeePct=gmDocParseLateFeePct;" +
  "g.gmDocParsePaymentMethods=gmDocParsePaymentMethods; g.gmDocParseLicenses=gmDocParseLicenses;" +
  "g.clientRequestAllowed=clientRequestAllowed; g.sellerRequestAllowed=sellerRequestAllowed;" +
  "g.GM_DOC_DEFAULT_SCHEDULE_PRESETS=GM_DOC_DEFAULT_SCHEDULE_PRESETS;"
)(W);

// 18% cap
ok(W.gmDocParseLateFeePct(18).value === 18, "18% is accepted (the cap itself)");
ok(W.gmDocParseLateFeePct(18.01).error && /687\.03/.test(W.gmDocParseLateFeePct(18.01).error), "18.01% is refused, citing §687.03");
ok(W.gmDocParseLateFeePct(25).error && /18% per year \(1\.5% per month\)/.test(W.gmDocParseLateFeePct(25).error), "25% is refused with the exact statute message");
ok(W.gmDocParseLateFeePct("").value === null && W.gmDocParseLateFeePct(null).value === null, "blank = no penalty (null)");
ok(W.gmDocParseLateFeePct(-1).error, "a negative rate is refused");

// schedule steps
ok(W.gmDocScheduleStepsError([{ label: "Deposit", pct: 50 }, { label: "Completion", pct: 50 }]) === null, "50/50 totals 100");
ok(W.gmDocScheduleStepsError([{ pct: 33.34 }, { pct: 33.33 }, { pct: 33.33 }]) === null, "33.34/33.33/33.33 totals exactly 100");
ok(/100/.test(W.gmDocScheduleStepsError([{ pct: 50 }, { pct: 49.99 }]) || ""), "50/49.99 is refused");
ok(/100/.test(W.gmDocScheduleStepsError([{ pct: 50 }, { pct: 50 }, { pct: 0.01 }]) || ""), "100.01 is refused");
ok(W.gmDocScheduleStepsError([{ pct: 100 }, { pct: 0 }]) !== null, "a 0% step is refused");
ok(W.gmDocScheduleStepsError([]) === null, "an empty step list (Custom) is allowed");
const presets = W.gmDocParseSchedulePresets(W.GM_DOC_DEFAULT_SCHEDULE_PRESETS);
ok(!presets.error && presets.presets.length === 3, "the three default presets validate");
ok(W.gmDocParseSchedulePresets([{ name: "Bad", steps: [{ label: "a", pct: 60 }, { label: "b", pct: 60 }] }]).error, "a preset at 120% is refused by name");
ok(W.gmDocParseSchedulePresets([{ steps: [{ pct: 100 }] }]).error, "a preset without a name is refused");

// cost types
ok(W.gmCostLineType(undefined) === "material" && W.gmCostLineType("MATERIAL") === "material", "absent / any case reads as material");
ok(W.gmCostLineType("labor") === "labor" && W.gmCostLineType("other") === "other" && W.gmCostLineType("junk") === "material", "labor/other kept, junk -> material");
const comp = W.gmPricingComputed({
  cost_breakdown: JSON.stringify([{ label: "Pump", amount: 400 }, { label: "Crew", amount: 250, type: "labor" }, { label: "Permit", amount: 50, type: "other" }]),
  price: 1000
});
ok(comp.cost_total === 700 && comp.material_cost === 400 && comp.labor_cost === 250 && comp.other_cost === 50, "per-type split: 400 material / 250 labor / 50 other of 700");
ok(comp.margin === 300 && comp.margin_pct === 30, "margin 300 = 30%");
ok(comp.cost_breakdown[0].type === "material", "an old line without type is returned as material");
const empty = W.gmPricingComputed({ cost_breakdown: "[]", price: 100 });
ok(empty.cost_total === null && empty.material_cost === null, "no lines -> null, never 0");

// payment methods & licenses
const pm = W.gmDocParsePaymentMethods({ zelle: "555-0100", cash: "", bogus: "x", check: false });
ok(pm.methods.zelle === "555-0100" && pm.methods.cash === "" && !("bogus" in pm.methods) && !("check" in pm.methods), "only ticked, known methods are stored");
ok(W.gmDocParseLicenses(["CPC1234567", " ", "CPC1234567", "CGC0001"]).length === 2, "licenses are trimmed and de-duplicated");

// ---- role gates ----
const C = "test-client-temp-001";
const base = "/api/clients/" + C + "/gm/";
ok(W.sellerRequestAllowed(base + "pricing", "GET", C) === true, "seller GET gm/pricing allowed");
ok(W.sellerRequestAllowed(base + "pricing", "POST", C) === false, "seller POST gm/pricing refused");
ok(W.sellerRequestAllowed(base + "pricing/abc", "PUT", C) === false, "seller PUT gm/pricing/:id refused");
ok(W.sellerRequestAllowed(base + "pricing/abc", "DELETE", C) === false, "seller DELETE gm/pricing/:id refused");
ok(W.sellerRequestAllowed(base + "pricing/import", "POST", C) === false, "seller pricing import refused");
ok(W.sellerRequestAllowed(base + "jobs", "GET", C) === true, "seller GET gm/jobs allowed");
ok(W.sellerRequestAllowed(base + "jobs", "POST", C) === false, "seller POST gm/jobs refused");
ok(W.sellerRequestAllowed(base + "jobs/abc", "PUT", C) === false, "seller PUT gm/jobs/:id refused");
ok(W.sellerRequestAllowed(base + "jobs/abc/photos", "GET", C) === false, "seller job photos still refused");
ok(W.sellerRequestAllowed(base + "doc-settings", "GET", C) === false, "seller GET doc-settings refused");
ok(W.sellerRequestAllowed(base + "doc-settings", "PUT", C) === false, "seller PUT doc-settings refused");
ok(W.sellerRequestAllowed(base + "doc-hero", "POST", C) === false, "seller hero upload refused");
ok(W.sellerRequestAllowed("/api/clients/other-client/gm/pricing", "GET", C) === false, "seller cannot read another client's pricing");
ok(W.clientRequestAllowed(base + "doc-settings", "GET", C) && W.clientRequestAllowed(base + "doc-settings", "PUT", C), "owner GET/PUT doc-settings allowed");
ok(W.clientRequestAllowed(base + "doc-settings/history", "GET", C), "owner history allowed");
ok(W.clientRequestAllowed(base + "doc-hero", "POST", C), "owner hero upload allowed");
ok(W.clientRequestAllowed("/api/clients/other-client/gm/doc-settings", "GET", C) === false, "owner cannot read another client's settings");

// ---- gm.js mirrors ----
const G = {};
new Function("g", [
  slice(gm, "var GM_COST_LINE_TYPES = [", "\n// The client's own categories"),
  fnSrc(gm, "gmDocStepsTotal"), fnSrc(gm, "gmDocStepsOk")
].join("\n") +
  "\ng.gmPricingCompute=gmPricingCompute; g.gmDocStepsOk=gmDocStepsOk; g.gmDocStepsTotal=gmDocStepsTotal;"
)(G);
const gc = G.gmPricingCompute([{ amount: "400" }, { amount: "250", type: "labor" }, { amount: "50", type: "other" }], "1000");
ok(gc.cost_total === 700 && gc.material_cost === 400 && gc.labor_cost === 250 && gc.other_cost === 50 && gc.margin_pct === 30,
   "gm.js gmPricingCompute matches the Worker split");
ok(G.gmDocStepsOk([{ pct: "33.34" }, { pct: "33.33" }, { pct: "33.33" }]) && !G.gmDocStepsOk([{ pct: "50" }, { pct: "49.9" }]) && G.gmDocStepsOk([]),
   "gm.js gmDocStepsOk matches the Worker rule (100 exactly, empty = Custom)");
ok(G.gmDocStepsTotal([{ pct: "0.1" }, { pct: "0.2" }]) === 0.3, "running total is rounded to two decimals");

// ---- static rules ----
ok(!/\bconst\b|\blet\b|=>/.test(slice(gm, "// TAB 8 — ESTIMATES", "\n// ═══") + slice(gm, "// TAB 9 — FATURAS", "function gmRenderInvoicesTab")),
   "the new gm.js code uses var and function() only");
ok(!/DELETE FROM gm_doc_settings|DELETE FROM gm_pricing|DELETE FROM gm_doc_settings_history/.test(worker), "no DELETE on the new tables");

console.log(fail ? `\n❌ ${fail} FAILED` : "\n✅ ALL PASS");
process.exit(fail ? 1 : 0);
