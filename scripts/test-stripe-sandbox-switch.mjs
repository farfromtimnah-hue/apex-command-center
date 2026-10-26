// The test client alone can use a Stripe SANDBOX key (secret STRIPE_SANDBOX_SECRET_KEY).
// Every other client, and every call when the secret is missing or not a test key, keeps the live key.
import fs from "node:fs";
import vm from "node:vm";
const src = fs.readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
function grab(name) {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) throw new Error("missing " + name);
  let d = 0, j = src.indexOf("{", i);
  for (let k = j; k < src.length; k++) { if (src[k] === "{") d++; if (src[k] === "}") { d--; if (d === 0) return src.slice(i, k + 1); } }
  throw new Error("unbalanced " + name);
}
const ctx = {};
vm.createContext(ctx);
vm.runInContext('var STRIPE_SANDBOX_CLIENT_ID = "test-client-temp-001";\n' + grab("stripeEnvFor"), ctx);
let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };
const live = { STRIPE_SECRET_KEY: "sk_live_AAA", DB: { x: 1 }, STRIPE_SANDBOX_SECRET_KEY: "sk_test_BBB" };
const e1 = ctx.stripeEnvFor(live, "test-client-temp-001");
ok(e1.STRIPE_SECRET_KEY === "sk_test_BBB", "the test client uses the sandbox key");
ok(e1.DB === live.DB && e1 !== live, "the copy keeps the other bindings and the original is untouched");
ok(live.STRIPE_SECRET_KEY === "sk_live_AAA", "the original env still holds the live key");
ok(ctx.stripeEnvFor(live, "some-real-client") === live, "a real client keeps the live key (same object)");
ok(ctx.stripeEnvFor({ STRIPE_SECRET_KEY: "sk_live_AAA" }, "test-client-temp-001").STRIPE_SECRET_KEY === "sk_live_AAA", "no sandbox secret: the test client keeps the live key");
ok(ctx.stripeEnvFor({ STRIPE_SECRET_KEY: "sk_live_AAA", STRIPE_SANDBOX_SECRET_KEY: "sk_live_ZZZ" }, "test-client-temp-001").STRIPE_SECRET_KEY === "sk_live_AAA", "a live key in the sandbox slot is refused");
ok(ctx.stripeEnvFor({ STRIPE_SECRET_KEY: "sk_live_AAA", STRIPE_SANDBOX_SECRET_KEY: "" }, "test-client-temp-001").STRIPE_SECRET_KEY === "sk_live_AAA", "an empty sandbox secret is ignored");
console.log(fail ? "❌ " + fail + " FAILED" : "✅ ALL PASS");
process.exit(fail ? 1 : 0);
