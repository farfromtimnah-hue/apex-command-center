// Cuts pieces out of gm.js as source text, so a test runs the shipped code.
import { readFileSync } from "node:fs";
export const gm = readFileSync(new URL("../../gm.js", import.meta.url), "utf8");

// A top level "function name(" to its closing brace at column 0. null when missing.
export function gmFn(name) {
  let i = gm.indexOf("\nfunction " + name + "(");
  if (i < 0) { return null; }
  const j = gm.indexOf("\n}\n", i + 1);
  return gm.slice(i + 1, j + 3);
}
export function gmBlock(a, b) {
  const i = gm.indexOf(a);
  if (i < 0) { return null; }
  const j = gm.indexOf(b, i + a.length);
  if (j < 0) { return null; }
  return gm.slice(i, j + b.length);
}
export const LOGIC = gmBlock("// ==== LEAD REASON LOGIC BEGIN ====", "// ==== LEAD REASON LOGIC END ====");
export const UI = gmBlock("// ==== LEAD REASON UI BEGIN ====", "// ==== LEAD REASON UI END ====");
