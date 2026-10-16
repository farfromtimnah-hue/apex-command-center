// Vendors (Fornecedores) access gate. Rafa is a co-owner and must reach
// every /api/vendors/* route the same as Alice, even though he doesn't use
// it day to day -- see the phone dock / desktop menu placement (last, after
// the tools he does use). This runs the REAL vendorAuthed/vendorAuth cut
// from worker/index.js, never a rewritten copy.
//
//   node scripts/test-vendor-auth.mjs
import { build, baseStubs } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };

const FNS = ["vendorAuthed", "vendorAuth"];

function world(authUser) {
  const stubs = Object.assign({}, baseStubs, {
    authenticate: async () => authUser
  });
  const F = build(FNS, [], stubs);
  return { F };
}

// ---- vendorAuthed: the role check itself ----
{
  const w = world(null);
  ok(w.F.vendorAuthed({ role: "alice" }), "alice passes the vendor gate");
  ok(w.F.vendorAuthed({ role: "developer" }), "developer passes the vendor gate");
  ok(w.F.vendorAuthed({ role: "rafa" }), "rafa passes the vendor gate (co-owner, added in this job)");
  ok(!w.F.vendorAuthed({ role: "seller" }), "a seller role is still refused");
  ok(!w.F.vendorAuthed({ role: "client" }), "a client role is still refused");
  ok(!w.F.vendorAuthed(null), "no user is still refused");
  ok(!w.F.vendorAuthed(undefined), "undefined user is still refused");
}

// ---- vendorAuth: the full request-level gate (401 vs 403) ----
for (const role of ["alice", "developer", "rafa"]) {
  const w = world({ role: role, display_name: "Test" });
  const a = await w.F.vendorAuth({}, {});
  ok(!a.err && a.user && a.user.role === role, role + ": vendorAuth lets the request through with no error");
}
{
  const w = world({ role: "seller", display_name: "Seller" });
  const a = await w.F.vendorAuth({}, {});
  ok(a.err && a.err.status === 403, "a seller role gets 403 Forbidden, not 401");
}
{
  const w = world(null);
  const a = await w.F.vendorAuth({}, {});
  ok(a.err && a.err.status === 401, "no authenticated user gets 401 Unauthorized, not 403");
}

console.log(fail ? `\n❌ ${fail} FAILED` : "\n✅ VENDOR AUTH CONSISTENT");
process.exit(fail ? 1 : 0);
