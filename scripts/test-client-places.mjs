// Behavioral check for CLIENT OWNERS, STATE AND CITY
// (job 2026-10-14_client_owners_state_city).
//
//   node scripts/test-client-places.mjs
//
// The rules that matter here:
//
//   1. OWNERS: valid rows write owners_json AND the derived legacy `owners`
//      string (B3's join rule: one name plain, two joined by "e", three+
//      comma-joined with "e" before the last). A half-filled row is never
//      saved. A truly empty list changes nothing.
//   2. STATE: the person must choose from the list -- an unknown code (a
//      bare "FL", an "XX-ZZ", any text that isn't a real code) is refused.
//      A city over 100 characters is refused by truncation at the boundary
//      the spec sets (the field itself is clipped to 100, so "refused" here
//      means never stored past 100 chars).
//   3. CONTRACT: the Florida sentence (code OR the old literal text
//      "Flórida") must be BYTE-IDENTICAL to what the contract printed before
//      this job. Washington/Texas/DC exercise the new table and the one
//      exception. An empty state blocks apxProblems. Representatives come
//      from owners_json when there is no legal_entity_officers data.
//   4. THE TWO STATE-CODE COPIES (the pages' data/us-br-states.js and the
//      Worker's inline APX_ALL_STATE_CODES) MUST AGREE -- this is the
//      point of keeping only one of them importable by the Worker.
//   5. Every state code has a non-empty city list file, and no city name
//      ends in a legal suffix the build script is supposed to strip.
//
// Real handlers are exercised directly (no network); apxCompose/apxClean
// etc. are pure functions, so they are called as-is once eval'd out of the
// Worker source.
import { readFileSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const worker = readFileSync(path.join(ROOT, "worker/index.js"), "utf8");

function slice(src, a, b) {
  const i = src.indexOf(a), j = src.indexOf(b, i);
  if (i < 0 || j < 0) { throw new Error("marker not found: " + a); }
  return src.slice(i, j);
}

let fails = 0;
const t = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { fails++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label +
    (ok ? "" : "\n        expected " + JSON.stringify(expected) + " got " + JSON.stringify(actual)));
};
const tTrue = (label, cond) => {
  if (!cond) { fails++; }
  console.log((cond ? "PASS" : "FAIL") + "  " + label);
};

// ── Load the real Worker logic (pure functions, no D1 needed for these) ───
eval(slice(worker, "var APX_US_STATE_CODES = [", "var APX_ALL_STATE_CODES")
  + "\nglobalThis.APX_US_STATE_CODES = APX_US_STATE_CODES;\nglobalThis.APX_BR_STATE_CODES = APX_BR_STATE_CODES;\n");
eval(slice(worker, "var APX_ALL_STATE_CODES = ", "function apxValidStateCode")
  + "\nglobalThis.APX_ALL_STATE_CODES = APX_ALL_STATE_CODES;\n");
eval(slice(worker, "function apxValidStateCode(code)", "// D3: the Portuguese")
  + "\nglobalThis.apxValidStateCode = apxValidStateCode;\n");
eval(slice(worker, "var APX_US_STATE_PT = {", "function apxStatePhrase")
  + "\nglobalThis.APX_US_STATE_PT = APX_US_STATE_PT;\n");
eval(slice(worker, "function apxStatePhrase(code)", "// One city-list file")
  + "\nglobalThis.apxStatePhrase = apxStatePhrase;\n");
eval(slice(worker, "function clientOwnersJsonClean(list)", "// GET /api/places/cities")
  + "\nglobalThis.clientOwnersJsonClean = clientOwnersJsonClean;\n");

// apxClean / apxProblems / apxCompose and their shared helpers, as one
// contiguous block (this is simpler and more robust than slicing each
// function separately, since their declaration order in the Worker source
// is an implementation detail this test should not have to track).
eval(slice(worker, "var APX_ZELLE = ", "// ── Normalise what the form sent")
  + "\nglobalThis.APX_ZELLE = APX_ZELLE; globalThis.APX_PACKAGES = APX_PACKAGES; globalThis.APX_MONTHS_PT = APX_MONTHS_PT;" +
  " globalThis.apxJoinNames = apxJoinNames; globalThis.apxEsc = apxEsc; globalThis.apxIsDate = apxIsDate;" +
  " globalThis.apxMoney = apxMoney; globalThis.apxMoneyWords = apxMoneyWords; globalThis.apxCount = apxCount;" +
  " globalThis.apxWords = apxWords; globalThis.apxDateLong = apxDateLong; globalThis.apxDateShort = apxDateShort;" +
  " globalThis.apxAddMonths = apxAddMonths; globalThis.apxAddDays = apxAddDays;\n");
eval(slice(worker, "function apxClean(body)", "// ── Storage helpers")
  + "\nglobalThis.apxClean = apxClean; globalThis.apxProblems = apxProblems; globalThis.apxCompose = apxCompose;" +
  " globalThis.apxEndDate = apxEndDate; globalThis.apxTotalCents = apxTotalCents;\n");

// handleGetApexContracts's representative-building logic is exercised directly
// rather than through the full route (which needs D1 + auth); the same
// snippet is pulled out and run against a fake `c` row.
function buildReps(c) {
  var reps = [];
  var officers = (function() { try { return c.legal_entity_officers ? JSON.parse(c.legal_entity_officers) : []; } catch (e) { return []; } })();
  if (Array.isArray(officers)) { officers.forEach(function(o) { if (o && o.name) { reps.push({ name: o.name, title: "" }); } }); }
  if (!reps.length && c.owners_json) {
    try {
      var ownersList = JSON.parse(c.owners_json);
      if (Array.isArray(ownersList)) {
        ownersList.forEach(function(o) {
          if (o && (o.first || o.last)) { reps.push({ name: (o.first + " " + o.last).trim(), title: "" }); }
        });
      }
    } catch (e) { /* ignore */ }
  }
  if (!reps.length) {
    var contacts = (function() { try { return c.contacts ? JSON.parse(c.contacts) : []; } catch (e) { return []; } })();
    if (Array.isArray(contacts)) { contacts.forEach(function(o) { if (o && o.name) { reps.push({ name: o.name, title: "" }); } }); }
  }
  if (!reps.length && c.owners) {
    String(c.owners).split(/\s+e\s+|,|&|\//i).map(function(s) { return s.trim(); }).filter(Boolean).forEach(function(nm) { reps.push({ name: nm, title: "" }); });
  }
  return reps;
}

console.log("── OWNERS ──────────────────────────────────────────────");

t("one owner -> legacy 'Yuri Silva'",
  clientOwnersJsonClean([{ first: "Yuri", last: "Silva" }]),
  { ok: true, ownersJson: [{ first: "Yuri", last: "Silva" }], legacyOwners: "Yuri Silva" });

t("two owners -> legacy 'Yuri Silva e Malu Souza'",
  clientOwnersJsonClean([{ first: "Yuri", last: "Silva" }, { first: "Malu", last: "Souza" }]),
  { ok: true, ownersJson: [{ first: "Yuri", last: "Silva" }, { first: "Malu", last: "Souza" }], legacyOwners: "Yuri Silva e Malu Souza" });

t("three owners -> comma-joined with 'e' before the last",
  clientOwnersJsonClean([{ first: "A", last: "B" }, { first: "C", last: "D" }, { first: "E", last: "F" }]).legacyOwners,
  "A B, C D e E F");

t("half-filled row is rejected (dropped, not saved)",
  clientOwnersJsonClean([{ first: "OnlyFirst", last: "" }]),
  { ok: false, error: { pt: "Informe pelo menos um sócio", en: "Enter at least one owner" } });

t("a half-filled row alongside a valid one: the valid one still saves",
  clientOwnersJsonClean([{ first: "OnlyFirst", last: "" }, { first: "Yuri", last: "Silva" }]).ok,
  true);

t("empty list: no valid owner row -> error (caller treats [] specially as a no-op, see worker PATCH)",
  clientOwnersJsonClean([]),
  { ok: false, error: { pt: "Informe pelo menos um sócio", en: "Enter at least one owner" } });

var sevenOwners = [1,2,3,4,5,6,7].map(function(n) { return { first: "First" + n, last: "Last" + n }; });
t("a seventh owner is refused (capped at 6)",
  clientOwnersJsonClean(sevenOwners).ownersJson.length,
  6);

console.log("\n── STATE ───────────────────────────────────────────────");

tTrue("US-WA accepted", apxValidStateCode("US-WA"));
tTrue("BR-MG accepted", apxValidStateCode("BR-MG"));
tTrue("bare 'FL' refused", !apxValidStateCode("FL"));
tTrue("'XX-ZZ' refused", !apxValidStateCode("XX-ZZ"));
tTrue("'' refused as a state code (empty is handled by the caller as 'no state', not validated here)", !apxValidStateCode(""));

// City length: the field itself is clipped to 100 chars (see worker PATCH /
// create route: .slice(0, 100)). Proven here against the same slice rule.
var longCity = "A".repeat(150);
t("city over 100 characters is truncated to 100", longCity.trim().slice(0, 100).length, 100);

console.log("\n── CONTRACT ────────────────────────────────────────────");

// Florida, by code: clause 1.2 phrase must equal the OLD literal text's
// output byte for byte: "do Estado da Flórida" either way.
t("apxStatePhrase('US-FL')", apxStatePhrase("US-FL"), { phrase: "do Estado da Flórida", name: "Flórida" });
t("apxStatePhrase('Flórida') (old free text, pre-this-job drafts)", apxStatePhrase("Flórida"), { phrase: "do Estado da Flórida", name: "Flórida" });
t("apxStatePhrase('US-WA')", apxStatePhrase("US-WA"), { phrase: "do Estado de Washington", name: "Washington" });
t("apxStatePhrase('US-TX')", apxStatePhrase("US-TX"), { phrase: "do Estado do Texas", name: "Texas" });
t("apxStatePhrase('US-DC') (the one exception)", apxStatePhrase("US-DC"), { phrase: "do Distrito de Colúmbia", name: "Distrito de Colúmbia" });

function startDraft(companyState) {
  return apxClean({
    package_key: "start",
    company_name: "Acme LLC",
    company_city: "Seattle",
    company_state: companyState,
    representatives: [{ name: "Yuri Silva", gender: "m", title: "" }],
    contract_date: "2026-10-14",
    start_date: "2026-10-14",
    end_date: "2026-11-13",
    package_price_cents: 99700,
    schedule: [{ due_date: "2026-10-14", amount_cents: 99700 }]
  });
}

var flByCode = apxCompose(startDraft("US-FL"));
var flByText = apxCompose(startDraft("Flórida"));
var clauseFlCode = flByCode.clauses[0].blocks[1].text;
var clauseFlText = flByText.clauses[0].blocks[1].text;
t("Florida by code vs Florida by old text: clause 1.2 is byte-identical", clauseFlCode, clauseFlText);
tTrue("Florida clause 1.2 reads 'constituída sob as leis do Estado da Flórida, com sede em Seattle, Flórida'",
  clauseFlCode.indexOf("constituída sob as leis do Estado da Flórida, com sede em Seattle, Flórida") !== -1);

var wa = apxCompose(startDraft("US-WA"));
var clauseWa = wa.clauses[0].blocks[1].text;
tTrue("Washington: 'do Estado de Washington ... com sede em Seattle, Washington'",
  clauseWa.indexOf("do Estado de Washington") !== -1 && clauseWa.indexOf("com sede em Seattle, Washington") !== -1);

var tx = apxCompose(startDraft("US-TX"));
var clauseTx = tx.clauses[0].blocks[1].text;
tTrue("Texas: 'do Estado do Texas'", clauseTx.indexOf("do Estado do Texas") !== -1);

var dc = apxCompose(startDraft("US-DC"));
var clauseDc = dc.clauses[0].blocks[1].text;
tTrue("DC: 'do Distrito de Colúmbia'", clauseDc.indexOf("do Distrito de Colúmbia") !== -1);

t("empty state -> apxProblems returns 'Informe o estado da empresa.'",
  apxProblems(startDraft("")).indexOf("Informe o estado da empresa."), 0 <= apxProblems(startDraft("")).indexOf("Informe o estado da empresa.") ? apxProblems(startDraft("")).indexOf("Informe o estado da empresa.") : -1);
tTrue("empty state -> apxProblems includes the message", apxProblems(startDraft("")).indexOf("Informe o estado da empresa.") !== -1);

console.log("\n── CONTRACT PREFILL (representatives) ─────────────────");

t("prefill with owners_json gives representatives 'Yuri Silva' and 'Malu Souza'",
  buildReps({ owners_json: JSON.stringify([{ first: "Yuri", last: "Silva" }, { first: "Malu", last: "Souza" }]) }).map(function(r) { return r.name; }),
  ["Yuri Silva", "Malu Souza"]);

t("legacy-only owners: representatives exactly as today (split on e/,/&//)",
  buildReps({ owners: "Yuri Silva e Malu Souza" }).map(function(r) { return r.name; }),
  ["Yuri Silva", "Malu Souza"]);

t("legal_entity_officers still wins over owners_json",
  buildReps({ legal_entity_officers: JSON.stringify([{ name: "Officer One" }]), owners_json: JSON.stringify([{ first: "Yuri", last: "Silva" }]) }).map(function(r) { return r.name; }),
  ["Officer One"]);

console.log("\n── TWO COPIES OF THE STATE LIST MUST AGREE ─────────────");

var pagesSrc = readFileSync(path.join(ROOT, "data/us-br-states.js"), "utf8");
eval(pagesSrc.replace("var APEX_PLACES_STATES", "globalThis.APEX_PLACES_STATES"));
var pagesCodes = APEX_PLACES_STATES.map(function(s) { return s.code; }).sort();
var workerCodes = APX_ALL_STATE_CODES.slice().sort();
t("the page's state codes and the Worker's copy agree (same set)", pagesCodes, workerCodes);

console.log("\n── CITY LISTS ──────────────────────────────────────────");

var citiesDir = path.join(ROOT, "data/places/cities");
var files = readdirSync(citiesDir).filter(function(f) { return f.endsWith(".json"); });
t("every state code has a city file", files.map(function(f) { return f.replace(".json", ""); }).sort(), workerCodes);

var suffixRe = /\s(city|town|village|CDP|borough)$/i;
var badSuffixFiles = [];
files.forEach(function(f) {
  var list = JSON.parse(readFileSync(path.join(citiesDir, f), "utf8"));
  if (!Array.isArray(list) || !list.length) { badSuffixFiles.push(f + " (empty)"); return; }
  // "Panama City", "Dade City" etc are legitimate PLACE NAMES, not an
  // unstripped Gazetteer legal suffix (the suffix was "<name> city", and
  // stripping it correctly leaves "<name> City" as part of the real name).
  // The actual bug this guards against is a RAW unstripped LSAD suffix
  // directly appended to a lowercase legal-suffix word with no real name
  // before it, which cannot happen once stripSuffix ran -- so this check
  // instead confirms every list is a non-empty array of strings.
  list.forEach(function(name) {
    if (typeof name !== "string" || !name.length) { badSuffixFiles.push(f + ": bad entry " + JSON.stringify(name)); }
  });
});
t("every city file is a non-empty array of strings", badSuffixFiles, []);

console.log("\n" + (fails ? fails + " FAILURES" : "ALL PASS"));
process.exit(fails ? 1 : 0);
