// Apex Club plus-one name/phone, against the REAL Worker functions on an
// in-memory SQLite (see scripts/fixtures/d1-shim.mjs). No network.
//
//   node scripts/test-club-plus-one.mjs
import { makeDb, build, baseStubs, req } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };

const MIGS = ["migrations/apex_club_company.sql", "migrations/apex_invoice_public.sql", "migrations/apex_club_pay.sql", "migrations/2026-10-15_vendor_tracking_and_club_plus_one.sql"];
const stubs = Object.assign({}, baseStubs, { crypto: globalThis.crypto, authenticate: async () => ({ role: "alice", display_name: "Alice" }) });

function world() {
  const d = makeDb(MIGS);
  const F = build(["normalizeUsPhone", "handlePostClubRegister", "handlePostClubRegistrationUpdate", "clubEventHasPrice", "gmEstNewToken"], [],
    Object.assign({}, stubs, { buildApexClubEventPL: async () => ({}) }));
  return { d, env: { DB: d.DB }, F };
}

function seedEvent(d, id) {
  d.raw.prepare("INSERT INTO apex_club_events (id, name, event_date, window_start, window_end, price_single_cents, price_couple_cents, registration_open) VALUES (?, ?, '2026-10-20', '2026-10-06', '2026-10-27', 5000, 7500, 1)")
    .run(id, "Apex Club " + id);
}

// ── Registration with a valid plus-one ───────────────────────────────────
{
  const w = world();
  seedEvent(w.d, "ev1");
  const reg = (body) => w.F.handlePostClubRegister("ev1", req(body), w.env);
  const row = (phone) => w.d.q("SELECT plus_one, plus_one_name, plus_one_phone FROM apex_club_registrations WHERE phone = ?", phone)[0];

  let r = await reg({ name: "Maria Silva", phone: "8135550100", plus_one: true, plus_one_name: "Joao Silva", plus_one_phone: "8135550199" });
  ok(r.status === 200 && r.data.plus_one_missing === false, "a plus-one with a valid name and number: no plus_one_missing flag");
  const row1 = row("18135550100");
  ok(row1.plus_one === 1 && row1.plus_one_name === "Joao Silva" && row1.plus_one_phone === "18135550199", "both the plus-one's name and number are stored");

  // seats/price untouched: separate module (clubPriceFor) already proven in test-apex-club.mjs;
  // here we only confirm plus_one=1 and couple pricing fields on the event are unaffected.
  const ev = w.d.q("SELECT price_single_cents, price_couple_cents FROM apex_club_events WHERE id = 'ev1'")[0];
  ok(ev.price_single_cents === 5000 && ev.price_couple_cents === 7500, "event prices are unaffected by the plus-one fields");
}

// ── plus_one true, name/number missing: RSVP still saved, flagged ────────
{
  const w = world();
  seedEvent(w.d, "ev1");
  const reg = (body) => w.F.handlePostClubRegister("ev1", req(body), w.env);
  const row = (phone) => w.d.q("SELECT plus_one, plus_one_name, plus_one_phone, rsvp_state FROM apex_club_registrations WHERE phone = ?", phone)[0];

  let r = await reg({ name: "Carlos Souza", phone: "8135550101", plus_one: true });
  ok(r.status === 200 && r.data.registered === true && r.data.plus_one_missing === true, "plus_one true with no name/number: RSVP still saved, plus_one_missing true");
  ok(row("18135550101").rsvp_state === "going", "the RSVP (food count) went through");

  r = await reg({ name: "Ana Lima", phone: "8135550102", plus_one: true, plus_one_name: "X" });
  ok(r.status === 200 && r.data.plus_one_missing === true, "plus_one true with a name but no number: still flagged missing");
}

// ── Invalid plus-one number / same as guest's own ────────────────────────
{
  const w = world();
  seedEvent(w.d, "ev1");
  const reg = (body) => w.F.handlePostClubRegister("ev1", req(body), w.env);

  let r = await reg({ name: "Pedro Almeida", phone: "8135550103", plus_one: true, plus_one_name: "X", plus_one_phone: "123" });
  ok(r.status === 400 && r.error === "Número de WhatsApp do acompanhante inválido", "an invalid plus-one number gives 400 with the exact message");

  r = await reg({ name: "Duda Paz", phone: "8135550104", plus_one: true, plus_one_name: "X", plus_one_phone: "8135550104" });
  ok(r.status === 400 && r.error === "O acompanhante precisa de um número diferente", "the plus-one's number equal to the guest's own gives 400");
}

// ── Re-registration semantics ─────────────────────────────────────────────
{
  const w = world();
  seedEvent(w.d, "ev1");
  const reg = (body) => w.F.handlePostClubRegister("ev1", req(body), w.env);
  const row = (phone) => w.d.q("SELECT plus_one, plus_one_name, plus_one_phone FROM apex_club_registrations WHERE phone = ?", phone)[0];

  await reg({ name: "Maria Silva", phone: "8135550100", plus_one: true, plus_one_name: "Joao Silva", plus_one_phone: "8135550199" });
  // Re-register WITHOUT a plus one: clears both.
  let r = await reg({ name: "Maria Silva", phone: "8135550100", plus_one: false });
  ok(r.status === 200, "re-registering without a plus-one succeeds");
  let row1 = row("18135550100");
  ok(row1.plus_one === 0 && row1.plus_one_name === null && row1.plus_one_phone === null, "re-registering with no plus-one clears both stored fields");

  // Re-register WITH a plus-one and blank new fields: keeps old values if any existed.
  await reg({ name: "Carlos Souza", phone: "8135550101", plus_one: true, plus_one_name: "Original Name", plus_one_phone: "8135550198" });
  r = await reg({ name: "Carlos Souza", phone: "8135550101", plus_one: true });
  row1 = row("18135550101");
  ok(row1.plus_one === 1 && row1.plus_one_name === "Original Name" && row1.plus_one_phone === "18135550198", "re-registering with a plus-one and blank new fields KEEPS the stored name/number");

  // Re-register with a plus-one and NEW values: replaces.
  r = await reg({ name: "Carlos Souza", phone: "8135550101", plus_one: true, plus_one_name: "New Name", plus_one_phone: "8135550197" });
  row1 = row("18135550101");
  ok(row1.plus_one_name === "New Name" && row1.plus_one_phone === "18135550197", "re-registering with new plus-one values replaces the old ones");
}

// ── Old cached page (no plus_one keys at all) never refuses the RSVP ─────
{
  const w = world();
  seedEvent(w.d, "ev1");
  const r = await w.F.handlePostClubRegister("ev1", req({ name: "Old Page User", phone: "8135550110" }), w.env);
  ok(r.status === 200 && r.data.registered === true, "an old cached page posting without plus_one keys still succeeds");
}

// ── Admin edit route: set and clear ───────────────────────────────────────
{
  const w = world();
  seedEvent(w.d, "ev1");
  await w.F.handlePostClubRegister("ev1", req({ name: "Maria Silva", phone: "8135550100", plus_one: true, plus_one_name: "Joao", plus_one_phone: "8135550199" }), w.env);
  const regId = w.d.q("SELECT id FROM apex_club_registrations WHERE phone = '18135550100'")[0].id;

  let r = await w.F.handlePostClubRegistrationUpdate(regId, req({ plus_one_name: "Edited Name" }), w.env);
  ok(r.status === 200, "admin edit accepts a plus_one_name update");
  let row1 = w.d.q("SELECT plus_one_name FROM apex_club_registrations WHERE id = ?", regId)[0];
  ok(row1.plus_one_name === "Edited Name", "the edit route updated the plus-one's name");

  r = await w.F.handlePostClubRegistrationUpdate(regId, req({ plus_one_phone: "8135550177" }), w.env);
  ok(r.status === 200, "admin edit accepts a plus_one_phone update");
  row1 = w.d.q("SELECT plus_one_phone FROM apex_club_registrations WHERE id = ?", regId)[0];
  ok(row1.plus_one_phone === "18135550177", "the edit route updated the plus-one's number");

  // setting plus_one false clears both
  r = await w.F.handlePostClubRegistrationUpdate(regId, req({ plus_one: false }), w.env);
  ok(r.status === 200, "admin can turn off plus_one");
  row1 = w.d.q("SELECT plus_one, plus_one_name, plus_one_phone FROM apex_club_registrations WHERE id = ?", regId)[0];
  ok(row1.plus_one === 0 && row1.plus_one_name === null && row1.plus_one_phone === null, "setting plus_one false via admin clears the stored name and number");

  // invalid number via admin edit
  await w.F.handlePostClubRegistrationUpdate(regId, req({ plus_one: true }), w.env);
  r = await w.F.handlePostClubRegistrationUpdate(regId, req({ plus_one_phone: "12" }), w.env);
  ok(r.status === 400, "admin edit refuses an invalid plus-one phone");
}

// ── Guest SELECTs return the new columns ─────────────────────────────────
{
  const w = world();
  seedEvent(w.d, "ev1");
  await w.F.handlePostClubRegister("ev1", req({ name: "Maria Silva", phone: "8135550100", plus_one: true, plus_one_name: "Joao", plus_one_phone: "8135550199" }), w.env);
  const row = w.d.q("SELECT plus_one_name, plus_one_phone FROM apex_club_registrations WHERE phone = '18135550100'")[0];
  ok(row.plus_one_name === "Joao" && row.plus_one_phone === "18135550199", "columns are readable directly (SELECT shape exercised separately in test-apex-club.mjs)");
}

console.log(fail ? "\n" + fail + " FAILED" : "\nALL PASS");
process.exit(fail ? 1 : 0);
