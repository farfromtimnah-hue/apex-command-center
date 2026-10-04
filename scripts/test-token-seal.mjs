// Sealed credentials: the REAL tokenSeal / tokenOpen helpers cut from
// worker/index.js, run on made-up values with a made-up key. No network, no
// database, no real credential anywhere near this file.
//
//   node scripts/test-token-seal.mjs
import { build, baseStubs, makeDb, req } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };
const F = build(["bytesToB64", "b64ToBytes", "tokenEncKey", "tokenIsSealed", "tokenSeal", "tokenOpen"], ["TOKEN_SEAL_PREFIX"], baseStubs);
const rndKey = () => F.bytesToB64(crypto.getRandomValues(new Uint8Array(32)));
const env = { TOKEN_ENC_KEY: rndKey() };
const throwsWith = async (fn, re) => { try { await fn(); return false; } catch (e) { return re.test(e.message); } };
const PLAIN = "access-sandbox-made-up-0000-not-a-real-token";

// round trip
const sealed = await F.tokenSeal(env, PLAIN);
ok(/^enc:v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/.test(sealed), "the sealed form is enc:v1:<base64 iv>:<base64 ciphertext>");
ok(F.b64ToBytes(sealed.split(":")[2]).length === 12, "the IV is 12 bytes");
ok(sealed.indexOf(PLAIN) === -1 && sealed.indexOf(btoa(PLAIN)) === -1, "the sealed form does not contain the plain value");
ok((await F.tokenOpen(env, sealed)) === PLAIN, "round trip: tokenOpen(tokenSeal(x)) equals x");
const accented = "1//0g-ção-ñ-✓-refresh";
ok((await F.tokenOpen(env, await F.tokenSeal(env, accented))) === accented, "round trip holds for non ASCII text");

// fresh IV: a different ciphertext every time
const again = await F.tokenSeal(env, PLAIN);
const many = new Set(); for (let i = 0; i < 50; i++) { many.add(await F.tokenSeal(env, PLAIN)); }
ok(again !== sealed && sealed.split(":")[2] !== again.split(":")[2] && many.size === 50, "the same input seals to a different value every time (fresh IV)");
ok((await F.tokenOpen(env, again)) === PLAIN, "and every one of them opens to the same plain value");

// tamper detection
const parts = sealed.split(":");
const flip = (b64) => { const b = F.b64ToBytes(b64); b[b.length - 1] ^= 1; return F.bytesToB64(b); };
ok(await throwsWith(() => F.tokenOpen(env, "enc:v1:" + parts[2] + ":" + flip(parts[3])), /could not be opened/), "a changed ciphertext is refused");
ok(await throwsWith(() => F.tokenOpen(env, "enc:v1:" + flip(parts[2]) + ":" + parts[3]), /could not be opened/), "a changed IV is refused");
ok(await throwsWith(() => F.tokenOpen({ TOKEN_ENC_KEY: rndKey() }, sealed), /could not be opened/), "another key cannot open it");
ok(await throwsWith(() => F.tokenOpen(env, "enc:v1:onlyonepart"), /malformed/), "a malformed sealed value is refused");

// dual read: a plain value passes through unchanged, with or without a key
ok((await F.tokenOpen(env, PLAIN)) === PLAIN, "a plain value passes through tokenOpen unchanged");
ok((await F.tokenOpen({}, PLAIN)) === PLAIN, "a plain value passes through even when the key is missing");
ok((await F.tokenOpen(env, null)) === null && (await F.tokenOpen(env, "")) === "", "null and empty pass through");

// missing key
ok(await throwsWith(() => F.tokenSeal({}, PLAIN), /TOKEN_ENC_KEY secret is not set/), "tokenSeal throws when the key is missing (nothing is stored in plain text)");
ok(await throwsWith(() => F.tokenOpen({}, sealed), /TOKEN_ENC_KEY secret is not set/), "tokenOpen throws a clear error when the value is sealed and the key is missing");
ok(await throwsWith(() => F.tokenSeal({ TOKEN_ENC_KEY: btoa("too short") }, PLAIN), /32 bytes/), "a key that is not 32 bytes is refused");
ok(await throwsWith(() => F.tokenSeal(env, ""), /nothing to seal/), "an empty value is never sealed");

// The conversion route on an in-memory database: guard, idempotence, counts only.
{
  const d = makeDb([]);
  d.raw.exec("CREATE TABLE IF NOT EXISTS plaid_items (id TEXT PRIMARY KEY, plaid_item_id TEXT, access_token TEXT, institution TEXT, status TEXT)");
  d.raw.exec("CREATE TABLE IF NOT EXISTS oauth_tokens (id TEXT PRIMARY KEY, refresh_token TEXT, scope TEXT, organization_id TEXT, access_token TEXT, access_token_expires_at INTEGER)");
  d.raw.prepare("INSERT INTO plaid_items (id, access_token) VALUES ('a', 'plain-a'), ('b', 'plain-b'), ('c', 'plain-c')").run();
  d.raw.prepare("INSERT INTO oauth_tokens (id, refresh_token, access_token) VALUES ('google_calendar', 'plain-cal', NULL), ('google_drive', 'plain-drive', NULL), ('zoho_books', 'plain-zoho', 'plain-zoho-access')").run();
  let role = "developer";
  const stubs = Object.assign({}, baseStubs, { authenticate: async () => (role ? { role } : null), plaidFetch: async () => ({ ok: true }), plaidErrMessage: () => "", getGoogleAccessToken: async () => "x", getGoogleDriveAccessToken: async () => "x" });
  const R = build(["bytesToB64", "b64ToBytes", "tokenEncKey", "tokenIsSealed", "tokenSeal", "tokenOpen", "handlePostAdminSealTokens"], ["TOKEN_SEAL_PREFIX"], stubs);
  const e2 = { DB: d.DB, TOKEN_ENC_KEY: env.TOKEN_ENC_KEY };
  role = null; ok((await R.handlePostAdminSealTokens(req({}), e2)).status === 401, "seal route: no session is 401");
  for (const r of ["alice", "rafa", "client", "seller"]) { role = r; ok((await R.handlePostAdminSealTokens(req({}), e2)).status === 403, "seal route: role " + r + " is 403"); }
  ok(d.writes.length === 0, "seal route: a refused call writes nothing");
  role = "developer";
  const r1 = await R.handlePostAdminSealTokens(req({}), e2);
  ok(r1.status === 200 && r1.data.sealed === 5 && r1.data.empty === 2 && r1.data.failed === 0 && r1.data.changed_meanwhile === 0, "seal route: 3 bank rows and 2 Google refresh tokens sealed, the 2 empty Google access tokens skipped");
  ok(JSON.stringify(r1.data).indexOf("plain-") === -1 && JSON.stringify(r1.data).indexOf("enc:v1:") === -1, "seal route: the answer carries counts only, never a value");
  const rows = d.q("SELECT access_token AS v FROM plaid_items UNION ALL SELECT refresh_token FROM oauth_tokens WHERE id != 'zoho_books'");
  ok(rows.length === 5 && rows.every((x) => x.v.indexOf("enc:v1:") === 0), "seal route: every converted column now starts with enc:v1:");
  ok((await R.tokenOpen(e2, d.q("SELECT access_token AS v FROM plaid_items WHERE id = 'b'")[0].v)) === "plain-b" && (await R.tokenOpen(e2, d.q("SELECT refresh_token AS v FROM oauth_tokens WHERE id = 'google_drive'")[0].v)) === "plain-drive", "seal route: each sealed row opens to its own original value");
  const z = d.q("SELECT refresh_token, access_token FROM oauth_tokens WHERE id = 'zoho_books'")[0];
  ok(z.refresh_token === "plain-zoho" && z.access_token === "plain-zoho-access", "seal route: the zoho_books row is not touched");
  const n = d.writes.length;
  const r2 = await R.handlePostAdminSealTokens(req({}), e2);
  ok(r2.data.sealed === 0 && r2.data.already_sealed === 5 && d.writes.length === n, "seal route: a second run seals nothing and writes nothing");
  ok(d.writes.every((w) => /WHERE id = \? AND (access_token|refresh_token) = \?$/.test(w[0])), "seal route: every write is guarded by the original value");
  const c = await R.handlePostAdminSealTokens(req({ check: true }), e2);
  ok(c.status === 200 && c.data.results.plaid_items.length === 3 && c.data.results.plaid_items.every((x) => x.sealed && x.plaid_ok) && d.writes.length === n && JSON.stringify(c.data).indexOf("enc:v1:") === -1, "seal route: check mode opens each credential, writes nothing, returns no value");
}

console.log(fail ? `\n❌ ${fail} FAILED` : "\n✅ ALL PASS");
process.exit(fail ? 1 : 0);
