// Electronic signature consent evidence: the REAL esignSignWithConsent wrapper
// cut from worker/index.js, on an in-memory SQLite, plus checks on the four
// signing pages. No network.
//
//   node scripts/test-esign-consent.mjs
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { makeDb, build, baseStubs, workerSrc } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };
const root = new URL("../", import.meta.url);
const T = "a".repeat(48);
function world() {
  const d = makeDb(["migrations/esign_consents.sql"]);
  d.raw.exec("CREATE TABLE gm_estimates (id TEXT PRIMARY KEY, public_token TEXT)");
  d.raw.prepare("INSERT INTO gm_estimates (id, public_token) VALUES ('e1', ?)").run(T);
  const F = build(["sha256Hex", "esignSignWithConsent"], ["ESIGN_DOC_TABLES"], baseStubs);
  return { d, env: { DB: d.DB }, F };
}
const served = JSON.stringify({ estimate: { number: "EST-1", total_cents: 181475 } });
const getFn = async () => new Response(served, { status: 200 });
const mkReq = (body) => new Request("https://x.test/api/public/estimates/" + T + "/accept", { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": "9.9.9.9", "User-Agent": "TestBrowser/1.0" }, body: JSON.stringify(body) });
const rows = (w) => w.d.q("SELECT * FROM gm_esign_consents");

{
  const w = world(); let handlerSaw = null;
  const signOk = async (tok, request) => { handlerSaw = await request.json(); return new Response(JSON.stringify({ ok: true }), { status: 200 }); };
  const res = await w.F.esignSignWithConsent(w.env, mkReq({ signer_name: "Ana", consent: true, consent_text_version: "2026-10-04.1" }), "estimate", T, getFn, signOk);
  const r = rows(w);
  ok(res.status === 200 && handlerSaw && handlerSaw.signer_name === "Ana" && handlerSaw.consent === true, "the signing handler still receives the full request body and its answer is returned unchanged");
  ok(r.length === 1 && r[0].doc_kind === "estimate" && r[0].doc_id === "e1", "one consent row is written when the signature is recorded");
  ok(r[0].doc_sha256 === createHash("sha256").update(served).digest("hex"), "doc_sha256 is the SHA-256 of the JSON exactly as the public route served it");
  ok(r[0].ip === "9.9.9.9" && r[0].user_agent === "TestBrowser/1.0" && r[0].consent_text_version === "2026-10-04.1" && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(r[0].consented_at), "the row carries the time, IP, user agent and the version of the words");
}
{
  const w = world();
  const signRefuses = async () => new Response(JSON.stringify({ error: "Please agree to sign electronically" }), { status: 400 });
  const res = await w.F.esignSignWithConsent(w.env, mkReq({ signer_name: "Ana" }), "estimate", T, getFn, signRefuses);
  ok(res.status === 400 && rows(w).length === 0, "no flag: the handler's own 400 comes back and no row is written");
  const res2 = await w.F.esignSignWithConsent(w.env, mkReq({ signer_name: "", consent: true }), "estimate", T, getFn, signRefuses);
  ok(res2.status === 400 && rows(w).length === 0, "flag present but the signature was refused: no row (a row exists only with a recorded signature)");
}
{
  const w = world();
  const signOk = async () => new Response("{}", { status: 200 });
  await w.F.esignSignWithConsent(w.env, mkReq({ consent: true }), "estimate", T, getFn, signOk);
  ok(rows(w)[0].consent_text_version === "unversioned", "a page that posts no version (an old cached page) is recorded as unversioned");
  await w.F.esignSignWithConsent(w.env, mkReq({ consent: true, consent_text_version: "x'); DROP TABLE y;--" }), "estimate", T, getFn, signOk);
  ok(rows(w)[1].consent_text_version === "unversioned", "a version that is not a plain token is not stored");
  const getBoom = async () => { throw new Error("boom"); };
  const realErr = console.error; console.error = () => {};
  const res = await w.F.esignSignWithConsent(w.env, mkReq({ consent: true, consent_text_version: "2026-10-04.1" }), "estimate", T, getBoom, signOk);
  ok(res.status === 200 && rows(w).length === 3 && rows(w)[2].doc_sha256 === null, "a failed document read never blocks the signature: the row is written with no digest");
  const w2 = world(); w2.d.raw.exec("DROP TABLE gm_esign_consents");
  const res3 = await w2.F.esignSignWithConsent(w2.env, mkReq({ consent: true }), "estimate", T, getFn, signOk);
  console.error = realErr;
  ok(res3.status === 200, "a failed evidence write never breaks the signature");
}
// append-only, and wired on all four routes
{
  ok(!/UPDATE gm_esign_consents|DELETE FROM gm_esign_consents/.test(workerSrc), "nothing in the Worker updates or deletes a consent row");
  for (const [kind, get, sign] of [["estimate", "handleGetPublicEstimate", "handlePostPublicEstimateAccept"], ["contract", "handleGetPublicContract", "handlePostPublicContractSign"], ["change_order", "handleGetPublicChangeOrder", "handlePostPublicChangeOrderSign"], ["ack", "handleGetPublicAck", "handlePostPublicAckSign"]]) {
    ok(workerSrc.indexOf('esignSignWithConsent(env, request, "' + kind + '", ') !== -1 && new RegExp('"' + kind + '", [A-Za-z0-9\\[\\]]+, ' + get + ', ' + sign + '\\)').test(workerSrc), "the " + kind + " signing route records consent evidence");
  }
  ok((workerSrc.match(/if \(body\.consent !== true\) \{ return jsonErr\("Please agree to sign electronically", 400\); \}/g) || []).length === 4, "the four customer signing handlers still refuse a request without the flag (unchanged)");
}
// the pages
for (const [f, btn] of [["estimate-view.html", "btnAccept"], ["contract-view.html", "btnSign"], ["change-order-view.html", "btnSign"], ["ack-view.html", "btnSign"]]) {
  const src = readFileSync(new URL(f, root), "utf8");
  ok(/I agree to receive, review and sign this document and related notices electronically\. /.test(src) && /for a paper copy at no charge by contacting them at /.test(src) && /withdraw this consent before signing by closing this page or contacting them/.test(src) && /a current web browser and a PDF viewer/.test(src) && /To change my contact details I contact /.test(src), f + " carries the full consent sentence");
  ok(/Read the electronic consent details/.test(src) && (src.match(/"(Paper copy|Withdrawing consent|What this covers|What you need|Your contact details|Your copy): /g) || []).length === 6, f + " has the expandable list with the six points");
  ok(new RegExp('id="' + btn + '" onclick="(accept|sign)\\(\\)" disabled>').test(src), f + " renders the sign control disabled");
  ok(src.indexOf("esignConsentHtml(") < src.indexOf('id="' + btn + '" onclick') && /b\.disabled = !\(c && c\.checked\)/.test(src), f + " shows the box before the control and enables it only when ticked");
  ok(/consent: true, consent_text_version: ESIGN_CONSENT_VERSION \}/.test(src), f + " always posts the consent flag and the version of the words");
  ok(/"the business named above"/.test(src), f + " falls back to 'the business named above' when the document shows no name or contact");
  const block = src.slice(src.indexOf("var ESIGN_CONSENT_VERSION"), src.indexOf("function esignConsentChanged"));
  ok(block.length > 500 && !/apex/i.test(block), f + ": the consent words carry no Apex name");
}
console.log(fail ? `\n❌ ${fail} FAILED` : "\n✅ ALL PASS");
process.exit(fail ? 1 : 0);
