// The pause banner: POST /api/clients/:id/gm/leads/:leadId/pause-banner/clear (2026-11-14).
//
//   node scripts/test-lead-pause-banner-route.mjs
//
// Real handler against an in-memory SQLite with the live columns.
//   - 401 not signed in, 403 no access to the client, 403 a seller on a lead that
//     is not theirs, 404 unknown lead, 400 when there is no pause note.
//   - It saves the server time and the actor from the SESSION, never from the body.
//   - It writes one gm_lead_events row. A second press writes nothing more.
//   - The route is on the owner list and the seller list, and the router calls it.
//   - The banner stays after the return date until it is cleared.
import { makeDb, loadWorker, makeStubs, mkReq, USERS, workerSrc } from "./fixtures/lead-reason-harness.mjs";

let fails = 0;
const t = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { fails++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label + (ok ? "" : "\n        expected " + JSON.stringify(expected) + " got " + JSON.stringify(actual)));
};
const state = { user: USERS.owner };
const database = makeDb();
const W = loadWorker(makeStubs(state));
const env = { DB: database.DB };
const seed = (id, over) => {
  const row = Object.assign({ id, client_id: "c1", cliente: "Maria", estagio: "follow_up", vendedor: "Ana Lima",
    paused_until: "2026-11-20", paused_at: "2026-11-10", paused_reason: "Waiting for the permit" }, over || {});
  const k = Object.keys(row);
  database.raw.prepare("INSERT INTO gm_leads (" + k.join(",") + ") VALUES (" + k.map(() => "?").join(",") + ")").run(...k.map((x) => row[x]));
};
const lead = (id) => database.q("SELECT * FROM gm_leads WHERE id = ?", id)[0];
const evs = (id) => database.q("SELECT * FROM gm_lead_events WHERE lead_id = ? ORDER BY rowid", id);
const clear = async (id, user, body, cid) => {
  state.user = user;
  if (typeof W.handlePostGmLeadPauseBannerClear !== "function") { return { status: "no handler", body: {} }; }
  const res = await W.handlePostGmLeadPauseBannerClear(cid || "c1", id, mkReq(body || {}, {}, "https://w.example/api/clients/c1/gm/leads/" + id + "/pause-banner/clear"), env);
  return { status: res.status, body: await res.json() };
};

seed("L1"); seed("L2", { vendedor: "Bruno" }); seed("L3", { paused_until: null, paused_at: null, paused_reason: null });
let r = await clear("L1", null);
t("not signed in is 401", r.status, 401);
r = await clear("L1", USERS.otherOwner);
t("an owner of another client is 403", r.status, 403);
r = await clear("nope", USERS.owner);
t("an unknown lead is 404", r.status, 404);
r = await clear("L2", USERS.seller);
t("a seller on a lead that is not theirs is 403", r.status, 403);
t("...and nothing was cleared", lead("L2").pause_banner_cleared_at, null);
r = await clear("L3", USERS.owner);
t("a lead that was never paused has no note to clear (400)", [r.status, lead("L3").pause_banner_cleared_at], [400, null]);
t("nothing was written for the refused calls", evs("L1").length + evs("L2").length + evs("L3").length, 0);

// The pause date has passed: the banner is still there until somebody clears it.
t("the banner is still uncleared after the return date (nothing clears it by itself)", [lead("L1").pause_banner_cleared_at, lead("L1").pause_banner_cleared_by], [null, null]);

r = await clear("L1", USERS.owner, { pause_banner_cleared_by: "Somebody Else", pause_banner_cleared_at: "2000-01-01" });
const row = lead("L1");
t("the owner clears it (200)", r.status, 200);
t("the actor is the session's name, not the body's", row.pause_banner_cleared_by, "Piscinas Sol");
t("the time is the server's, not the body's", /^20(2[6-9]|[3-9]\d)-/.test(String(row.pause_banner_cleared_at)), true);
t("the pause itself is untouched", [row.paused_until, row.paused_at, row.paused_reason, row.estagio], ["2026-11-20", "2026-11-10", "Waiting for the permit", "follow_up"]);
t("one history row with the actor", evs("L1").map((e) => [e.action, e.field, e.actor]), [["pause_banner_cleared", "pause_banner", "Piscinas Sol"]]);
const stamp = row.pause_banner_cleared_at;
r = await clear("L1", USERS.alice);
t("a second press is 200 and changes nothing", [r.status, lead("L1").pause_banner_cleared_at, lead("L1").pause_banner_cleared_by, evs("L1").length], [200, stamp, "Piscinas Sol", 1]);

seed("L4");
r = await clear("L4", USERS.seller);
t("a seller clears the banner of their own lead", [r.status, lead("L4").pause_banner_cleared_by], [200, "Ana Lima"]);
t("...and the history names the seller", evs("L4").map((e) => e.actor), ["Ana Lima"]);
seed("L5");
r = await clear("L5", USERS.rafa);
t("staff can clear it too, named as themselves", [r.status, lead("L5").pause_banner_cleared_by], [200, "Rafa"]);

// Wiring: the owner list, the seller list, and the router.
const A = (fn, path) => (typeof W[fn] === "function" ? W[fn](path, "POST", "c1") : "no function");
const P = "/api/clients/c1/gm/leads/L1/pause-banner/clear";
t("the owner list allows the route", A("clientRequestAllowed", P), true);
t("the seller list allows the route", A("sellerRequestAllowed", P), true);
t("the seller list still refuses a made up neighbour route", A("sellerRequestAllowed", "/api/clients/c1/gm/leads/L1/pause-banner/other"), false);
t("the router sends it to the handler", /gmCol === "leads" && segs\[6\] === "pause-banner" && segs\[7\] === "clear" && method === "POST"[\s\S]{0,120}handlePostGmLeadPauseBannerClear\(cid, segs\[5\]/.test(workerSrc), true);

console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
process.exit(fails ? 1 : 0);
