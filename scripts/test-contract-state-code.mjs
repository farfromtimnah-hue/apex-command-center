// The contract builder's state reader must accept the shape clients.location_state is
// stored in ("US-FL", "US-WA"). The estimate setup screen passed that value straight in,
// the two letter check rejected it, and the business state (and the state aware license
// and late fee wording) never turned on. The REAL Worker functions are cut out of
// worker/index.js.
//
//   node scripts/test-contract-state-code.mjs
import { build, baseStubs } from "./fixtures/d1-shim.mjs";
import { readFileSync } from "node:fs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) { fail++; } };
const eq = (a, b, m) => ok(a === b, m + (a === b ? "" : "  (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"));

const riders = JSON.parse(readFileSync(new URL("../data/contract-state-riders-v1.json", import.meta.url), "utf8"));
const F = build(["contractStateCode", "contractStateName"], [],
  Object.assign({}, baseStubs, { CONTRACT_STATE_RIDERS_V1: riders, String: String, Object: Object }));

eq(F.contractStateCode("FL"), "FL", "FL is read as FL");
eq(F.contractStateCode(" wa "), "WA", "lower case and spaces still work");
eq(F.contractStateCode("US-FL"), "FL", "the stored shape US-FL is read as FL");
eq(F.contractStateCode("us-wa"), "WA", "lower case us-wa is read as WA");
eq(F.contractStateCode("US-DC"), "DC", "US-DC is read as DC");
eq(F.contractStateCode("US-ZZ"), null, "an unknown US- code is rejected");
eq(F.contractStateCode("US-"), null, "a bare US- prefix is rejected");
eq(F.contractStateCode("BR-SP"), null, "a Brazilian state code is not a US contract state");
eq(F.contractStateCode("Florida"), null, "a full name is not accepted (the checklist asks for the code)");
eq(F.contractStateCode(null), null, "null is rejected");
eq(F.contractStateName(F.contractStateCode("US-WA")), "Washington", "US-WA gives the name Washington");

console.log("\n" + (fail ? fail + " failing" : "all passing"));
process.exit(fail ? 1 : 0);
