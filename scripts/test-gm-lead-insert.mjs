// The new-lead INSERT must have exactly as many "?" as it has fixed columns plus values.
// On 10/14/2026 an address change added columns and values but missed one "?", and every
// new lead failed with "35 values for 36 columns". Static check on the source, no network.
//   node scripts/test-gm-lead-insert.mjs
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) { fail++; } };
const start = src.indexOf('"INSERT INTO gm_leads (id, client_id, mes_lead');
const bindAt = src.indexOf(".bind(", start);
ok(start > 0 && bindAt > start, "found the new-lead insert");
const stmt = src.slice(start, bindAt);
const colsText = stmt.slice(stmt.indexOf("(") + 1, stmt.indexOf("costCols")).replace(/"\s*\+\s*"/g, "").replace(/["\n]/g, " ");
const fixedCols = colsText.split(",").map((c) => c.trim()).filter((c) => /^[a-z_]+$/.test(c));
const placeholders = (stmt.split("VALUES (")[1].split("costMarks")[0].match(/\?/g) || []).length;
const end = src.indexOf("...costBinds", bindAt);
const bindText = src.slice(bindAt, end);
const binds = (bindText.match(/(leadId|clientId|f\.[a-z_]+ !== undefined|f\.cliente|f\.estagio|actor \|\| null)/g) || []).length;
ok(fixedCols.length === placeholders, "fixed columns (" + fixedCols.length + ") equal placeholders (" + placeholders + ")");
ok(fixedCols.length === binds, "fixed columns (" + fixedCols.length + ") equal bound values (" + binds + ")");
console.log(fail ? "FAILED " + fail : "ALL PASS");
process.exit(fail ? 1 : 0);
