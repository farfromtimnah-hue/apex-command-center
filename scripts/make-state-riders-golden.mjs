// Writes the Florida golden files for scripts/test-state-riders.mjs.
// Run ONCE, against main's worker/index.js, BEFORE the state riders change:
//   git show main:worker/index.js | node scripts/make-state-riders-golden.mjs -
// It refuses to overwrite a golden file that already exists: the golden files
// are the record of how a Florida contract composed before state riders, and
// must never be remade from newer code. No network.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { buildComposer, FLORIDA_FIXTURES, goldenView, GOLDEN_DIR } from "./fixtures/contract-compose-harness.mjs";

const srcPath = process.argv[2];
if (!srcPath) { console.error("usage: git show main:worker/index.js | node scripts/make-state-riders-golden.mjs -"); process.exit(1); }
const h = await buildComposer(readFileSync(srcPath === "-" ? 0 : srcPath, "utf8"));
for (const name of Object.keys(FLORIDA_FIXTURES)) {
  const out = new URL("state-riders-golden-" + name + ".json", GOLDEN_DIR);
  if (existsSync(out)) { console.error("exists, not overwritten: " + out.pathname); continue; }
  const r = await h.compose(FLORIDA_FIXTURES[name]);
  writeFileSync(out, JSON.stringify(goldenView(r.comp), null, 2) + "\n");
  console.log("wrote " + out.pathname + " (" + r.comp.sections.length + " sections, " + r.comp.blockers.length + " blockers, " + r.comp.missing.length + " missing)");
}
