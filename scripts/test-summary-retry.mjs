// Session summary: each of the two parallel Claude calls is retried ONCE, after
// a 2 second wait, only for status 524, 529 or any 500 or higher. A 4xx is never
// retried. If the retry also fails the handler returns the same 502 as before.
// Runs the REAL handlePostSummarize from worker/index.js with a fake fetch and a
// fake database. No network.
//
//   node scripts/test-summary-retry.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

const worker = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
function slice(src, a, b) {
  const i = src.indexOf(a), j = src.indexOf(b, i);
  if (i < 0 || j < 0) { throw new Error("marker not found: " + (i < 0 ? a : b)); }
  return src.slice(i, j);
}
let fails = 0;
const t = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { fails++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label +
    (ok ? "" : "\n        expected " + JSON.stringify(expected) + "\n        got      " + JSON.stringify(actual)));
};

// ── stand-ins for what the handler reads ────────────────────────────────────
globalThis.jsonOk = (o) => ({ ok: true, body: o });
globalThis.jsonErr = (m, code) => ({ ok: false, error: m, status: code });
globalThis.authenticate = async () => ({ role: "alice", display_name: "Alice", email: "a@example.com" });
globalThis.claudeBudgetGate = async () => null;
globalThis.parseSectionConfig = () => ({});
globalThis.reviewKeysForConfig = () => [];
globalThis.buildReviewPrompt = () => "review prompt";
globalThis.buildPdfPrompt = () => "pdf prompt";
globalThis.buildCustomSectionsPrompt = () => "";
globalThis.applySectionConfigToPdfData = () => {};
globalThis.logSessionEvent = async () => {};
globalThis.CLAUDE_API_URL = "https://claude.test/v1/messages";
globalThis.CLAUDE_MODEL = "test-model";
globalThis.SUMMARY_SYSTEM = "system";
const session = { id: "s1", raw_transcript: "hello", section_config: null, client_name: "X", client_id: "c1", date: "2026-10-30" };
const env = {
  CLAUDE_API_KEY: "k",
  DB: { prepare(sql) {
    const s = { bind: () => s, run: async () => ({ success: true }), all: async () => ({ results: [] }),
      first: async () => (/FROM sessions WHERE id/.test(sql) ? session : { c: 0 }) };
    return s;
  } }
};

vm.runInThisContext(slice(worker, "var CLAUDE_RETRY_WAIT_MS", "function sessionTaskYmd("));
t("the wait before the retry is 2 seconds", CLAUDE_RETRY_WAIT_MS, 2000);
const waits = [];
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms) => { waits.push(ms); return realSetTimeout(fn, 1); };   // do not really wait 2 s

const okBody = (text) => ({ content: [{ text }] });
const resp = (status, body) => ({
  ok: status >= 200 && status < 300, status,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  json: async () => body, body: null
});
// Each call is told apart by its prompt, so the parallel calls can be scripted
// separately: plan = { review: [status, ...], pdf: [status, ...] }.
function fakeFetch(plan) {
  const calls = { review: 0, pdf: 0, all: [] };
  globalThis.fetch = async (url, init) => {
    const prompt = JSON.parse(init.body).messages[0].content;
    const which = prompt.indexOf("review prompt") === 0 ? "review" : "pdf";
    const seq = plan[which];
    const status = seq[Math.min(calls[which], seq.length - 1)];
    calls[which]++;
    calls.all.push({ which, status, max_tokens: JSON.parse(init.body).max_tokens, model: JSON.parse(init.body).model });
    if (status === 200) { return resp(200, okBody(which === "review" ? '{"internal":"x"}' : '{"pdf_data":{"a":1}}')); }
    if (status === 524) { return resp(524, "error code: 524"); }
    return resp(status, "upstream said " + status);
  };
  return calls;
}
const run = () => handlePostSummarize({ json: async () => ({ session_id: "s1" }) }, env);

{
  waits.length = 0;
  const calls = fakeFetch({ review: [200], pdf: [200] });
  const r = await run();
  t("success first time: one call each, two in all", [calls.review, calls.pdf], [1, 1]);
  t("success first time: the handler finishes and answers ok", r.ok, true);
  t("success first time: no wait happened", waits.length, 0);
  t("the model and token limits are unchanged", calls.all.map((c) => [c.which, c.model, c.max_tokens]).sort(),
    [["pdf", "test-model", 8192], ["review", "test-model", 4096]]);
}
{
  waits.length = 0;
  const calls = fakeFetch({ review: [524, 200], pdf: [200] });
  const r = await run();
  t("524 then success: the failing call is made twice, the other once", [calls.review, calls.pdf], [2, 1]);
  t("524 then success: succeeds (not a 502)", r.status === 502, false);
  t("524 then success: waited 2000 ms once", waits, [2000]);
}
{
  waits.length = 0;
  const calls = fakeFetch({ review: [200], pdf: [529, 200] });
  const r = await run();
  t("529 then success: two calls for the pdf call", [calls.review, calls.pdf], [1, 2]);
  t("529 then success: succeeds (the handler finishes and answers ok)", r.ok, true);
}
{
  waits.length = 0;
  const calls = fakeFetch({ review: [503, 200], pdf: [500, 200] });
  const r = await run();
  t("503 and 500 then success: both calls retried once, in parallel", [calls.review, calls.pdf], [2, 2]);
  t("503 and 500 then success: succeeds (the handler finishes and answers ok)", r.ok, true);
}
{
  waits.length = 0;
  const calls = fakeFetch({ review: [524], pdf: [200] });
  const r = await run();
  t("524 twice: exactly two calls, no third", calls.review, 2);
  t("524 twice: returns the 502", [r.ok, r.status], [false, 502]);
  t("524 twice: the error text is the same shape as before", r.error, "Claude API error: error code: 524");
}
{
  waits.length = 0;
  const calls = fakeFetch({ review: [200], pdf: [400] });
  const r = await run();
  t("400: one call, not retried", calls.pdf, 1);
  t("400: returns the 502 as today", [r.ok, r.status], [false, 502]);
  t("400: no wait happened", waits.length, 0);
}
{
  const calls = fakeFetch({ review: [401], pdf: [429] });
  const r = await run();
  t("401 and 429 are never retried", [calls.review, calls.pdf], [1, 1]);
}
t("the handler runs both calls in parallel with Promise.all",
  /Promise\.all\(\[\s*callClaude\(reviewPromptText, 4096\),\s*callClaude\(pdfPromptText, 8192\)\s*\]\)/.test(worker), true);
globalThis.setTimeout = realSetTimeout;

console.log(fails ? "\n" + fails + " FAILED" : "\nAll passed");
process.exit(fails ? 1 : 0);
