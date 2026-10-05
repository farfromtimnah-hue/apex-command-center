// POST /api/staff/click against the REAL handler cut out of worker/index.js, on
// an in-memory SQLite (scripts/fixtures/d1-shim.mjs). No network.
//
//   node scripts/test-staff-click.mjs
import { readFileSync } from "node:fs";
import { makeDb, build, baseStubs } from "./fixtures/d1-shim.mjs";

const root = new URL("../", import.meta.url);
let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) { fail++; } };
const MIG = readFileSync(new URL("migrations/2026-10-05_staff_click_log.sql", root), "utf8");

function world(withTable) {
  const d = makeDb([]);
  if (withTable) { d.raw.exec(MIG); }
  return d;
}
function handler(d, role, name) {
  const logs = [];
  const stubs = Object.assign({}, baseStubs, {
    jsonErr: (m, status) => ({ status: status || 400, error: m }),
    authenticate: async () => (role ? { role, display_name: name || role } : null),
    actorName: (u) => (u && (u.display_name || u.role)) || null,
    crypto: globalThis.crypto,
    console: { log: (...a) => logs.push(a.join(" ")), error: (...a) => logs.push(a.join(" ")), warn: (...a) => logs.push(a.join(" ")) }
  });
  const F = build(["handlePostStaffClick"], ["STAFF_CLICK_MAX_PER_DAY", "STAFF_CLICK_RE"], stubs);
  return { logs, click: (body) => F.handlePostStaffClick({ url: "https://x.test/api/staff/click", json: async () => body }, { DB: d.DB }) };
}
const rows = (d) => d.q("SELECT * FROM staff_click_log ORDER BY rowid");

// 1. staff roles store a row
for (const role of ["alice", "rafa", "developer"]) {
  const d = world(true);
  const h = handler(d, role, "Person " + role);
  const r = await h.click({ page: "dashboard", control: "nav:clients", client_id: "c-1" });
  const t = rows(d);
  ok(r.status === 200 && t.length === 1, role + ": 200 and one row");
  ok(t[0] && t[0].role === role && t[0].who === "Person " + role && t[0].page === "dashboard" && t[0].control === "nav:clients" && t[0].client_id === "c-1" && !!t[0].created_at, role + ": row carries role, who, page, control, client_id, created_at");
  ok(h.logs.length === 0, role + ": nothing written to the console");
}
{ const d = world(true); const h = handler(d, "alice");
  await h.click({ page: "tasks", control: "dock:tasks" });
  ok(rows(d)[0].client_id === null, "client_id is optional (stored NULL)"); }

// 2. client, seller, signed-out: nothing stored
for (const [role, status] of [["client", 403], ["seller", 403], [null, 401]]) {
  const d = world(true);
  const r = await handler(d, role).click({ page: "dashboard", control: "nav:clients" });
  ok(r.status === status && rows(d).length === 0, (role || "signed out") + ": " + status + " and no row");
}

// 3. hard validation
{
  const d = world(true); const h = handler(d, "alice");
  const bad = [
    { page: "dashboard", control: "nav clients" },
    { page: "dashboard", control: "<b>x</b>" },
    { page: "da shboard", control: "nav:x" },
    { page: "dashboard", control: "" },
    { page: "dashboard", control: "a".repeat(81) },
    { page: "a".repeat(81), control: "nav:x" },
    { page: "dashboard", control: 5 },
    { page: "dashboard" },
    { page: "dashboard", control: "nav:x", client_id: "has space" },
    { page: "dashboard", control: "nav:x", client_id: "a".repeat(81) },
    { page: "dashboard", control: "nav:x", client_id: 7 },
    null
  ];
  let allBad = true;
  for (const b of bad) { const r = await h.click(b); if (r.status !== 400) { allBad = false; console.log("  not refused:", JSON.stringify(b)); } }
  ok(allBad && rows(d).length === 0, "spaces, angle brackets, empty, too long, wrong type, bad client_id, no body: all 400, nothing stored");
  const r = await h.click({ page: "a".repeat(80), control: "docktool:a.b-c_d/e:f" });
  ok(r.status === 200 && rows(d).length === 1, "80 characters and . - _ : / are accepted");
}

// 4. developer preview: real role and name, ":preview" on the page
{
  const d = world(true); const h = handler(d, "developer", "Dev Person");
  await h.click({ page: "dashboard", control: "nav:sales", preview: true });
  await h.click({ page: "dashboard", control: "nav:sales" });
  const t = rows(d);
  ok(t[0].role === "developer" && t[0].who === "Dev Person" && t[0].page === "dashboard:preview", "preview: real role and name, page gets :preview");
  ok(t[1].page === "dashboard", "no preview flag: page unchanged");
  const d2 = world(true); await handler(d2, "alice").click({ page: "dashboard", control: "nav:x", preview: true });
  ok(rows(d2)[0].page === "dashboard", "preview flag from a non-developer is ignored");
}

// 5. daily cap: stops storing, still 200
{
  const d = world(true);
  const ins = d.raw.prepare("INSERT INTO staff_click_log (id, role, who, page, control) VALUES (?,?,?,?,?)");
  d.raw.exec("BEGIN");
  for (let i = 0; i < 3000; i++) { ins.run("old" + i, "alice", "Capped", "dashboard", "nav:x"); }
  d.raw.exec("COMMIT");
  const h = handler(d, "alice", "Capped");
  const r = await h.click({ page: "dashboard", control: "nav:y" });
  ok(r.status === 200 && rows(d).length === 3000, "at 3000 rows in 24 hours: 200 and nothing new stored");
  const r2 = await handler(d, "alice", "Someone Else").click({ page: "dashboard", control: "nav:y" });
  ok(r2.status === 200 && rows(d).length === 3001, "the cap is per person: another person still stores");
  d.raw.exec("UPDATE staff_click_log SET created_at = datetime('now', '-2 days') WHERE who = 'Capped'");
  await h.click({ page: "dashboard", control: "nav:y" });
  ok(rows(d).length === 3002, "rows older than 24 hours do not count");
}

// 6. missing table: 200, nothing stored, no error
{
  const d = world(false);
  const r = await handler(d, "alice").click({ page: "dashboard", control: "nav:clients" });
  ok(r.status === 200 && r.data && r.data.ok === true, "no table yet: 200");
}

console.log(fail ? "\n" + fail + " FAILED" : "\nall passed");
process.exit(fail ? 1 : 0);
