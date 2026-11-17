// Branch names (2026-11-16): a pair never shows as "Branch 340" just because nobody opened Compare yet.
// The REAL Worker functions on an in-memory SQLite with a FAKE ABC. No network, no live database.
//
//   node scripts/test-abc-branch-names.mjs
import { makeWorld, seedConn, seedPairs, OWNER, get, post, reader, PAIR_A, PAIR_B } from "./fixtures/abc-world.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };
async function check(name, fn) { try { await fn(); } catch (e) { console.log("FAIL  " + name + "  [" + String(e && e.stack || e).split("\n").slice(0, 3).join(" | ").slice(0, 300) + "]"); fail++; } }
const logged = [];
console.error = function () { logged.push(Array.prototype.slice.call(arguments).map(String).join(" ")); };
const read = reader(null);
const world = () => makeWorld({}, () => OWNER);

// Counts the writes to gm_abc_branches and every search of ABC's accounts.
function watch(w) {
  const writes = [];
  const real = w.env.DB;
  w.env.DB = { prepare: (sql) => { if (/^\s*(INSERT|UPDATE|DELETE)\b[^;]*gm_abc_branches/i.test(sql)) { writes.push(sql.replace(/\s+/g, " ").slice(0, 60)); } return real.prepare(sql); }, batch: (x) => real.batch(x) };
  return { writes, searches: () => w.abc.calls.filter((c) => c.path === "/api/account/v1/search/accounts").length };
}
const status = async (w) => read(await w.F.handleGetGmAbcStatus("c1", get("/x"), w.env));
const rows = (w) => w.d.q("SELECT ship_to_number, branch_number, ship_to_name, branch_name, is_default FROM gm_abc_branches ORDER BY branch_number");
const empty = (w, ship, branch) => w.d.raw.prepare("INSERT INTO gm_abc_branches (id, client_id, ship_to_number, branch_number, ship_to_name, branch_name, is_default, created_by) VALUES (?, 'c1', ?, ?, '', '', ?, 'test')").run("e" + branch, ship, branch, branch === "1234" ? 1 : 0);

await check("default-pair-no-row", async () => {
  const w = world(); await seedConn(w); const k = watch(w);
  ok(rows(w).length === 0, "starts with a connection and NO pair row (the status route makes a default pair with empty names)");
  const r1 = await status(w);
  ok(r1.status === 200 && r1.data.pairs.length === 1 && r1.data.pairs[0].branch_name === "Tampa" && r1.data.pairs[0].ship_to_name === "Zeta Roofing", "the first status read answers with the names filled");
  ok(k.searches() === 1 && k.writes.length === 1, "one ABC call and one database write for that read (" + k.searches() + " calls, " + k.writes.length + " writes)");
  const row = rows(w);
  ok(row.length === 1 && row[0].is_default === 1 && row[0].branch_name === "Tampa", "the pair is now stored, still the default, with its names");
  const r2 = await status(w);
  ok(r2.data.pairs[0].branch_name === "Tampa" && k.searches() === 1 && k.writes.length === 1, "a second read does not call ABC and writes nothing");
});

await check("stored-empty-names", async () => {
  const w = world(); await seedConn(w); empty(w, PAIR_A.ship, "1234"); empty(w, PAIR_B.ship, "340"); const k = watch(w);
  const r1 = await status(w);
  ok(r1.data.pairs.length === 2 && r1.data.pairs.every((p) => p.branch_name && p.ship_to_name), "both stored pairs come back with names");
  ok(k.searches() === 1 && k.writes.length === 2 && rows(w).map((x) => x.branch_name).join() === "Tampa,Orem", "ONE ABC call for the business and one UPDATE per changed pair (" + k.writes.length + " writes)");
  await status(w);
  ok(k.searches() === 1 && k.writes.length === 2, "the second read is silent");
});

await check("named-pairs-are-left-alone", async () => {
  const w = world(); await seedConn(w); seedPairs(w, [PAIR_A, PAIR_B]); const k = watch(w);
  const r = await status(w);
  ok(r.status === 200 && k.searches() === 0 && k.writes.length === 0, "pairs that already have names: no ABC call, no write");
  w.d.raw.prepare("UPDATE gm_abc_branches SET branch_name = 'My own name' WHERE branch_number = '340'").run();
  await status(w);
  ok(rows(w).find((x) => x.branch_number === "340").branch_name === "My own name", "a name that is there is never overwritten");
  // half filled: the account name is there, the branch name is not
  w.d.raw.prepare("UPDATE gm_abc_branches SET branch_name = '' WHERE branch_number = '340'").run();
  const k2 = watch(w); const r2 = await status(w);
  ok(r2.data.pairs.find((p) => p.branch === "340").branch_name === "Orem" && k2.writes.length === 1, "only the empty half is filled, one write");
});

await check("abc-down-never-throws", async () => {
  const w = world(); await seedConn(w); empty(w, PAIR_A.ship, "1234"); const k = watch(w);
  w.abc.down = true;
  const r = await status(w);
  ok(r.status === 200 && r.data.pairs.length === 1 && r.data.pairs[0].branch_name === "" && r.data.pairs[0].branch === "1234", "ABC down: the status still answers with the pair, names empty (the screen shows Branch 1234)");
  ok(k.writes.length === 0 && !/Bearer|ABCACCESS|ABCREFRESH|secret/i.test(r.text), "nothing written, no secret in the answer");
  w.abc.down = false; const before = k.searches();
  await status(w);
  ok(k.searches() === before, "a failed try is not repeated on the very next read (no hammering ABC)");
});

await check("abc-has-no-name", async () => {
  const w = world(); await seedConn(w); empty(w, PAIR_A.ship, "1234");
  w.abc.accounts[0].branches[0].name = ""; w.abc.accounts[0].name = "";
  const k = watch(w);
  const r = await status(w);
  ok(r.data.pairs[0].branch_name === "1234" && r.data.pairs[0].ship_to_name === "2010466-2", "ABC really has no name: the number is stored, so the screen says Branch 1234 and the next read does not ask again");
  await status(w);
  ok(k.searches() === 1 && k.writes.length === 1, "and it did not ask again");
});

await check("account-not-listed", async () => {
  const w = world(); await seedConn(w); empty(w, PAIR_A.ship, "1234"); w.abc.accounts.splice(0, 1);
  const k = watch(w);
  const r = await status(w);
  ok(r.status === 200 && r.data.pairs[0].branch_name === "" && k.writes.length === 0, "ABC does not list the account: names stay empty, nothing written");
});

await check("needs-reconnect-skips-abc", async () => {
  const w = world(); await seedConn(w, { reconnect: true }); empty(w, PAIR_A.ship, "1234"); const k = watch(w);
  const r = await status(w);
  ok(r.status === 200 && k.searches() === 0, "a connection that needs reconnecting makes no ABC call");
});

await check("twenty-pairs-at-most", async () => {
  const w = world(); await seedConn(w);
  for (let i = 0; i < 25; i++) { w.d.raw.prepare("INSERT INTO gm_abc_branches (id, client_id, ship_to_number, branch_number, ship_to_name, branch_name, is_default, created_by) VALUES (?, 'c1', '2010466-2', ?, '', '', ?, 'test')").run("m" + i, String(2000 + i), i === 0 ? 1 : 0); }
  const k = watch(w); const r = await status(w);
  ok(r.data.pairs.length === 20 && k.writes.length <= 20 && k.searches() === 1, "no more than 20 pairs are read and at most 20 updates are made (" + k.writes.length + ")");
});

await check("created-with-names", async () => {
  // choosing the account (connect) and adding a pair store the names ABC gives; when ABC has none, the number is stored, never an empty text
  const w = world(); await seedConn(w, { account: false });
  w.abc.accounts[0].branches[0].name = "";
  let r = await read(await w.F.handlePostGmAbcAccount("c1", post("/x", { ship_to: "2010466-2", branch: "1234" }), w.env));
  ok(r.status === 200, "choosing an account works");
  const row = rows(w)[0];
  ok(row.ship_to_name === "Zeta Roofing" && row.branch_name === "1234", "connect: the account name is saved; a branch ABC has no name for is saved as its number, not as an empty text");
  w.abc.accounts[0].branches[0].name = "Tampa";
  r = await read(await w.F.handlePostGmAbcAccount("c1", post("/x", { ship_to: "2010466-2", branch: "1234" }), w.env));
  ok(rows(w)[0].branch_name === "Tampa", "choosing it again with a name saves the name");
  w.abc.accounts[0].branches[0].name = ""; w.abc.accounts[0].name = "";
  await w.F.handlePostGmAbcAccount("c1", post("/x", { ship_to: "2010466-2", branch: "1234" }), w.env);
  const again = rows(w)[0];
  ok(again.branch_name === "Tampa" && again.ship_to_name === "Zeta Roofing", "a later save with no names from ABC never blanks a name that is stored");
  w.abc.accounts[0].name = "Zeta Roofing";
  const add = await read(await w.F.handlePostGmAbcBranch("c1", post("/x", { ship_to: "2010466-2", branch: "340" }), w.env));
  ok(add.status === 200 && rows(w).find((x) => x.branch_number === "340").branch_name === "Orem", "adding a pair saves its names");
  w.abc.accounts[0].branches[1].name = "";
  await w.F.handlePostGmAbcBranch("c1", post("/x", { ship_to: "2010466-2", branch: "340" }), w.env);
  ok(rows(w).find((x) => x.branch_number === "340").branch_name === "Orem", "adding the same pair again with no name from ABC keeps the stored name");
});

console.log(fail ? "\n" + fail + " FAILED" : "\nall passed");
process.exit(fail ? 1 : 0);
