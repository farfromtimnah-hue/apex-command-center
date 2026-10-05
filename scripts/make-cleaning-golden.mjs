// Writes the non-Florida golden files for scripts/test-cleaning-contract.mjs:
// how the five construction fixtures compose in Massachusetts and in Texas
// BEFORE the cleaning trade existed. (Their Florida golden files are the
// state-riders ones.) Run ONCE, against the worker/index.js of the commit the
// cleaning branch started from (8109e08), with that commit's riders data on disk:
//   git show 8109e08:worker/index.js | node scripts/make-cleaning-golden.mjs -
// It refuses to overwrite a golden file that already exists. No network.
// When a later job changes on purpose how a construction contract composes in
// one of these states (RES-35: Texas notices the builder now prints by itself),
// that state's files are remade from the working copy and nothing else:
//   node scripts/make-cleaning-golden.mjs worker/index.js --replace=TX
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { buildComposer, FLORIDA_FIXTURES, goldenView, GOLDEN_DIR } from "./fixtures/contract-compose-harness.mjs";

export const GOLDEN_STATES = ["MA", "TX"];
// The same fixture the state-riders test uses for a named state.
export function stateFixture(name, code) {
  const out = JSON.parse(JSON.stringify(FLORIDA_FIXTURES[name]));
  out.flags = Object.assign({}, out.flags, { job_state: code });
  out.doc = { address: "100 Bay St, Springfield", license_numbers: ["REG-12345"] };
  out.settings = Object.assign({}, out.settings || {}, { values: { business_state: code } });
  return out;
}

if (process.argv[1] && process.argv[1].endsWith("make-cleaning-golden.mjs")) {
  const srcPath = process.argv[2];
  if (!srcPath) { console.error("usage: git show 8109e08:worker/index.js | node scripts/make-cleaning-golden.mjs -"); process.exit(1); }
  const replace = ((process.argv[3] || "").match(/^--replace=([A-Z,]+)$/) || ["", ""])[1].split(",").filter(Boolean);
  const h = await buildComposer(readFileSync(srcPath === "-" ? 0 : srcPath, "utf8"));
  for (const name of Object.keys(FLORIDA_FIXTURES)) {
    for (const code of GOLDEN_STATES) {
      const out = new URL("cleaning-golden-" + name + "-" + code + ".json", GOLDEN_DIR);
      if (existsSync(out) && replace.indexOf(code) === -1) { console.error("exists, not overwritten: " + out.pathname); continue; }
      const r = await h.compose(stateFixture(name, code));
      writeFileSync(out, JSON.stringify(goldenView(r.comp), null, 2) + "\n");
      console.log("wrote " + out.pathname + " (" + r.comp.sections.length + " sections, " + r.comp.blockers.length + " blockers, " + r.comp.missing.length + " missing)");
    }
  }
}
