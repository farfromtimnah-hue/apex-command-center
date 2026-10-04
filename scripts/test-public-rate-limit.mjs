// Public route rate limits: the REAL publicWriteRateLimit / publicReadRateLimited
// helpers cut from worker/index.js, on an in-memory SQLite. No network.
//
//   node scripts/test-public-rate-limit.mjs
import { makeDb, build, baseStubs, workerSrc } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };
const mk = () => {
  const d = makeDb(["migrations/gm_partner_referrals.sql"]);
  d.raw.exec("CREATE TABLE IF NOT EXISTS gm_referral_hits (id TEXT PRIMARY KEY, slug TEXT NOT NULL, ip TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))");
  const F = build(["publicWriteRateLimit", "publicReadRateLimited"], ["PUBLIC_LIMIT_MESSAGE", "PUBLIC_READ_HITS", "PUBLIC_READ_HITS_SWEPT"], baseStubs);
  return { d, env: { DB: d.DB }, F };
};
const rq = (ip) => ({ headers: { get: (h) => (h === "CF-Connecting-IP" ? ip : null) } });
const T1 = "a".repeat(48), T2 = "b".repeat(48);

// write limiter: per IP
{
  const w = mk(); let passed = 0, res = null;
  for (let i = 0; i < 31; i++) { res = await w.F.publicWriteRateLimit(w.env, rq("1.1.1.1"), "codecline", "tok" + i, 30, 20); if (!res) passed++; }
  ok(passed === 30 && res && res.status === 429, "30 per 10 minutes per IP pass, the 31st is 429");
  ok(/Muitas tentativas/.test(res.error) && /Too many attempts/.test(res.error), "the 429 message is bilingual");
  ok(w.d.writes.length === 30 && w.d.writes.every((x) => /^INSERT INTO gm_referral_hits/.test(x[0])), "one small insert per allowed request, none for the refused one");
  ok((await w.F.publicWriteRateLimit(w.env, rq("2.2.2.2"), "codecline", "tokX", 30, 20)) === null, "another IP is not affected");
  ok((await w.F.publicWriteRateLimit(w.env, rq("1.1.1.1"), "ackdecline", "tokX", 30, 20)) === null, "the same IP on another route is not affected");
}
// write limiter: per token
{
  const w = mk(); let passed = 0, res = null;
  for (let i = 0; i < 21; i++) { res = await w.F.publicWriteRateLimit(w.env, rq("9.9.9." + i), "sched", T1, 30, 20); if (!res) passed++; }
  ok(passed === 20 && res && res.status === 429, "20 per 10 minutes per token pass (from 21 different IPs), the 21st is 429");
  ok((await w.F.publicWriteRateLimit(w.env, rq("9.9.9.99"), "sched", T2, 30, 20)) === null, "another token is not affected");
}
// Apex Club: a whole room on one network
{
  const w = mk(); let passed = 0, res = null;
  for (let i = 0; i < 61; i++) { res = await w.F.publicWriteRateLimit(w.env, rq("7.7.7.7"), "club", "event-1", 60, 0); if (!res) passed++; }
  ok(passed === 60 && res && res.status === 429, "Apex Club: 60 registrations from ONE IP for ONE event pass, the 61st is 429 (no per event limit)");
}
// the window is 10 minutes
{
  const w = mk();
  for (let i = 0; i < 30; i++) { await w.F.publicWriteRateLimit(w.env, rq("3.3.3.3"), "codecline", "t" + i, 30, 20); }
  w.d.raw.exec("UPDATE gm_referral_hits SET created_at = datetime('now', '-11 minutes')");
  ok((await w.F.publicWriteRateLimit(w.env, rq("3.3.3.3"), "codecline", "t", 30, 20)) === null, "hits older than 10 minutes no longer count");
}
// the existing estimate limiter does not see these rows, and the reverse
{
  const w = mk();
  for (let i = 0; i < 30; i++) { await w.F.publicWriteRateLimit(w.env, rq("4.4.4.4"), "sched", "t" + i, 30, 20); }
  const est = w.d.q("SELECT COUNT(*) AS c FROM gm_referral_hits WHERE ip = '4.4.4.4' AND slug LIKE 'est:%'")[0].c;
  ok(est === 0, "the new rows are not counted by gmEstPublicRateLimit (slug prefix pw:, never est:)");
}
// read limiter: memory only
{
  const w = mk(); let passed = 0, last = false;
  for (let i = 0; i < 21; i++) { last = w.F.publicReadRateLimited(rq("5.5.5." + i), "doc", "/some-slug", 30, 20); if (!last) passed++; }
  ok(passed === 20 && last === true, "GET: 20 per key pass, the 21st is limited");
  let p2 = 0; for (let i = 0; i < 31; i++) { if (!w.F.publicReadRateLimited(rq("6.6.6.6"), "doc", "/slug-" + i, 30, 20)) p2++; }
  ok(p2 === 30, "GET: 30 per IP pass, the 31st is limited");
  ok(w.F.publicReadRateLimited(rq("5.5.5.200"), "docimg", "/some-slug", 30, 20) === false, "GET: the preview picture has its own count");
  ok(w.d.writes.length === 0 && w.d.log.length === 0, "GET: the read limiter never touches the database");
}
// wiring: every named route calls a limiter in the router
{
  const has = (re) => re.test(workerSrc);
  ok(has(/publicWriteRateLimit\(env, request, "club", clubRegPub\[1\], 60, 0\)/), "router: Apex Club registration POST is limited at 60 per IP");
  ok(has(/publicWriteRateLimit\(env, request, "sched", schedAny\[1\], 30, 20\)/) && has(/publicReadRateLimited\(request, "sched", schedAny\[1\], 30, 20\)/), "router: scheduling link POSTs (database) and GET (memory) are limited");
  ok(has(/publicWriteRateLimit\(env, request, "codecline", pubCo\[1\], 30, 20\)/) && has(/publicWriteRateLimit\(env, request, "ackdecline", pubAck\[1\], 30, 20\)/), "router: change order and acknowledgment decline are limited");
  ok(has(/publicReadRateLimited\(request, docIsImage \? "docimg" : "doc"/), "router: the readable link resolver is limited in memory");
}
// Fireflies: no expected signature and no raw payload in any log line
{
  const i = workerSrc.indexOf("\nasync function handleFirefliesWebhook("); const src = workerSrc.slice(i, workerSrc.indexOf("\n}", i + 1));
  const logs = src.split("\n").filter((l) => /console\.log/.test(l));
  ok(!logs.some((l) => /sigHex|sigHeader|expected/.test(l)), "Fireflies: no log line prints the expected or received signature");
  ok(!logs.some((l) => /JSON\.stringify\(payload\)|rawBody/.test(l)), "Fireflies: no log line prints the raw payload");
  ok(/stripeConstantTimeEqual\(sigHeader, sigHex\)/.test(src) && !/sigHex !== sigHeader/.test(src), "Fireflies: the signature comparison is constant time");
}
// Fireflies: a correctly signed webhook still gets in, a wrong one does not
{
  const logs = []; const realLog = console.log;
  const F = build(["stripeConstantTimeEqual", "handleFirefliesWebhook"], [], Object.assign({}, baseStubs, {
    fetchFirefliesTranscript: async () => null, ingestFirefliesTranscript: async (env, meta) => ({ session_id: "s1", duplicate: false })
  }));
  const secret = "made-up-webhook-secret";
  const body = JSON.stringify({ meetingId: "MEET123", eventType: "Transcription completed", transcript: "hello" });
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = "sha256=" + Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)))).map((b) => b.toString(16).padStart(2, "0")).join("");
  const call = async (h) => { console.log = (m) => logs.push(String(m)); try { return await F.handleFirefliesWebhook({ text: async () => body, headers: { get: (n) => (n === "X-Hub-Signature" ? h : null) } }, { FIREFLIES_WEBHOOK_SECRET: secret }); } finally { console.log = realLog; } };
  const good = await call(sig);
  ok(good.status === 200 && good.data.session_id === "s1", "Fireflies: a correctly signed webhook is ingested exactly as before");
  const bad = await call(sig.slice(0, -1) + (sig.slice(-1) === "0" ? "1" : "0"));
  ok(bad.status === 401, "Fireflies: a wrong signature is refused with 401");
  ok((await call("")).status === 401 && (await call("sha256=")).status === 401, "Fireflies: a missing or empty signature is refused");
  ok(logs.some((l) => /signature mismatch, transcript MEET123/.test(l)) && !logs.some((l) => l.indexOf(sig.slice(7)) !== -1 || l.indexOf("hello") !== -1), "Fireflies: the mismatch log names the transcript id and carries no signature and no payload");
}
console.log(fail ? `\n❌ ${fail} FAILED` : "\n✅ ALL PASS");
process.exit(fail ? 1 : 0);
