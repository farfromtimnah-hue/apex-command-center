// A prepared statement's bind() must be called on the statement. Calling
// stmt.bind.apply(null, ...) loses `this`, and the real D1 binding then fails
// with "Cannot read properties of null (reading 'dbSession')". The fake
// databases used by the other tests do not notice, so this checks the source.
import { readFileSync } from "node:fs";

var src = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
var lines = src.split("\n");
var bad = [];
lines.forEach(function (line, i) {
  if (/\.bind\.(apply|call)\(\s*(null|undefined)\b/.test(line)) { bad.push((i + 1) + ": " + line.trim()); }
});
if (bad.length) {
  console.log("FAIL: bind called without its statement:\n" + bad.join("\n"));
  process.exit(1);
}
console.log("ALL PASS: no detached bind calls in worker/index.js");
