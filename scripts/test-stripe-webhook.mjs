// Stripe webhook verification: the REAL Worker functions (cut from
// worker/index.js) against synthetic payloads signed with a test secret.
//   node scripts/test-stripe-webhook.mjs
import { createHmac } from "node:crypto";
import { build, makeDb } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };
const F = build(["stripeVerifySignature", "stripeConstantTimeEqual", "stripeWebhookGate"], ["STRIPE_WEBHOOK_TOLERANCE_S"], {});
const SECRET = "whsec_test_synthetic_secret";
const env = { STRIPE_WEBHOOK_SECRET: SECRET };
const now = () => Math.floor(Date.now() / 1000);
const sign = (body, t, secret) => createHmac("sha256", secret || SECRET).update(t + "." + body).digest("hex");
const body = JSON.stringify({ id: "evt_test_1", type: "checkout.session.completed", livemode: false, account: "acct_known", data: { object: { payment_status: "paid" } } });

let t = now();
ok(await F.stripeVerifySignature(env, body, "t=" + t + ",v1=" + sign(body, t)) === true, "a valid signature on the raw body is accepted");
ok(await F.stripeVerifySignature(env, body, "t=" + t + ",v1=" + sign(body, t, "whsec_wrong")) === false, "a signature made with the wrong secret is rejected");
ok(await F.stripeVerifySignature(env, body.replace("paid", "unpaid"), "t=" + t + ",v1=" + sign(body, t)) === false, "an altered body is rejected");
ok(await F.stripeVerifySignature(env, body + " ", "t=" + t + ",v1=" + sign(body, t)) === false, "one added byte of whitespace is rejected (the RAW body is what is signed)");
let old = now() - 301;
ok(await F.stripeVerifySignature(env, body, "t=" + old + ",v1=" + sign(body, old)) === false, "a correctly signed event 301 seconds old is rejected (5 minute tolerance)");
old = now() - 290;
ok(await F.stripeVerifySignature(env, body, "t=" + old + ",v1=" + sign(body, old)) === true, "290 seconds old is still accepted");
const future = now() + 400;
ok(await F.stripeVerifySignature(env, body, "t=" + future + ",v1=" + sign(body, future)) === false, "a timestamp 400 seconds in the future is rejected");
ok(await F.stripeVerifySignature(env, body, null) === false && await F.stripeVerifySignature(env, body, "") === false, "a missing Stripe-Signature header is rejected");
ok(await F.stripeVerifySignature(env, body, "v1=" + sign(body, t)) === false, "a header with no timestamp is rejected");
ok(await F.stripeVerifySignature(env, body, "t=" + t) === false, "a header with no v1 signature is rejected");
ok(await F.stripeVerifySignature(env, body, "t=" + t + ",v1=" + "0".repeat(64) + ",v1=" + sign(body, t)) === true, "several v1 signatures: accepted when any one is valid (secret rotation)");
ok(await F.stripeVerifySignature(env, body, "t=" + t + ",v1=" + sign(body, t) + ",v1=" + sign(body, t)) === true, "duplicate valid signatures are accepted");
ok(await F.stripeVerifySignature(env, body, "t=" + t + ",v1=" + "0".repeat(64) + ",v1=" + "f".repeat(64)) === false, "several v1 signatures, none valid: rejected");
ok(await F.stripeVerifySignature(env, body, "t=" + t + ",v0=" + sign(body, t)) === false, "a v0 signature alone is rejected");
ok(await F.stripeVerifySignature({}, body, "t=" + t + ",v1=" + sign(body, t)) === false && await F.stripeVerifySignature({ STRIPE_WEBHOOK_SECRET: "  " }, body, "t=" + t + ",v1=" + sign(body, t, "")) === false, "no secret configured: everything is rejected");
ok(await F.stripeVerifySignature(env, body, "t=abc,v1=" + sign(body, "abc")) === false, "a non-numeric timestamp is rejected");
ok(F.stripeConstantTimeEqual("abc", "abc") && !F.stripeConstantTimeEqual("abc", "abd") && !F.stripeConstantTimeEqual("ab", "abc") && !F.stripeConstantTimeEqual("", "abc") && !F.stripeConstantTimeEqual("abcabc", "abc"), "the comparison is exact on content and length");

// The gate after the signature.
const d = makeDb([]);
d.raw.exec("CREATE TABLE gm_stripe_accounts (client_id TEXT PRIMARY KEY, stripe_account_id TEXT NOT NULL)");
d.raw.prepare("INSERT INTO gm_stripe_accounts VALUES ('c1', 'acct_known')").run();
const testEnv = { DB: d.DB, STRIPE_SECRET_KEY: "sk_test_x" }, liveEnv = { DB: d.DB, STRIPE_SECRET_KEY: "sk_live_x" };
const ev = (o) => Object.assign({ id: "evt_1", type: "checkout.session.completed", livemode: false, account: "acct_known" }, o);
ok(await F.stripeWebhookGate(testEnv, ev({})) === null, "test event, test key, known account: proceeds");
ok(await F.stripeWebhookGate(liveEnv, ev({ livemode: true })) === null, "live event, live key, known account: proceeds");
let g = await F.stripeWebhookGate(liveEnv, ev({ livemode: false }));
ok(g && g.status === 400 && /livemode/.test(g.reason), "a test event while the key is live is rejected with 400");
g = await F.stripeWebhookGate(testEnv, ev({ livemode: true }));
ok(g && g.status === 400, "a live event while the key is a test key is rejected with 400");
g = await F.stripeWebhookGate(testEnv, ev({ account: "acct_stranger" }));
ok(g && g.status === 200 && /unknown account/.test(g.reason), "an event for an unknown account is acknowledged and ignored");
g = await F.stripeWebhookGate(testEnv, ev({ account: undefined }));
ok(g && g.status === 200, "an event with no connected account is acknowledged and ignored");
g = await F.stripeWebhookGate(testEnv, { type: "x" });
ok(g && g.status === 400, "an event with no id is rejected");

console.log(fail ? `\n❌ ${fail} FAILED` : "\n✅ ALL PASS");
process.exit(fail ? 1 : 0);
