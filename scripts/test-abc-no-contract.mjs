// ABC orders without a contract, one readiness check, branch names (2026-11-16).
// The REAL Worker functions on an in-memory SQLite (every migration, including
// migrations/abc_orders_without_contract.sql) with a FAKE ABC. No network, no live database,
// no real order is ever sent.
//
//   node scripts/test-abc-no-contract.mjs
import { readFileSync } from "node:fs";
import { makeWorld, seedConn, seedPairs, addRow, reader, OWNER, SELLER, RIVAL, STAFF, ENV_OK, PAIR_A, PAIR_B, get, post, put } from "./fixtures/abc-world.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };
async function check(name, fn) { try { await fn(); } catch (e) { console.log("FAIL  " + name + "  [" + String(e && e.stack || e).split("\n").slice(0, 3).join(" | ").slice(0, 300) + "]"); fail++; } }
let user = OWNER;
console.error = function () {};
const read = reader(null);
const world = (o) => makeWorld(o, () => user);
const src = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
const future = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

function seedPricing(w) {
  addRow(w, { id: "p-paver", item: "Paver 6x9 Charcoal", unit: "sq ft", abc: "PAVER6X9", abcUnit: "PL", apexUnit: "sq ft", conv: 100, abcCost: 3.8, extra: 10, extraSource: "standard" });
  addRow(w, { id: "p-boot", item: "Pipe boot each", unit: "each", abc: "EACH0001", abcUnit: "EA", apexUnit: "each", abcCost: 12.5 });
  addRow(w, { id: "p-labor", item: "Labor", unit: "hora" });
  addRow(w, { id: "p-other", client: "c2", item: "Rival item", unit: "each", abc: "EACH0001", abcUnit: "EA", apexUnit: "each" });
  w.d.raw.exec("UPDATE gm_pricing SET abc_description = 'ABC ' || item WHERE abc_item_number IS NOT NULL");
}
function seedWorld(w) {
  seedPricing(w);
  w.d.raw.prepare("INSERT INTO gm_doc_settings (client_id, legal_name, address, phone, email) VALUES ('c1', 'Zeta Roofing LLC', '12 Main St, Tampa, FL 33602', '8135550100', 'office@zeta.example')").run();
}
let kk = 0;
// An estimate (accepted by default) with lines [[pricing_id, qty, unit, abcShipTo?, abcBranch?]].
function seedEstimate(w, lines, o) {
  o = o || {};
  const k = ++kk;
  const jobId = o.noJob ? null : "job" + k;
  if (jobId) { w.d.raw.prepare("INSERT INTO gm_jobs (id, client_id, lead_id, obra, job_name, addr_street, addr_city, addr_state, addr_zip) VALUES (?, 'c1', ?, ?, ?, ?, ?, ?, ?)").run(jobId, "lead" + k, "Obra " + k, "Smith roof " + k, o.street === undefined ? k + " Oak St" : o.street, o.city === undefined ? "Tampa" : o.city, o.state === undefined ? "FL" : o.state, o.zip === undefined ? "33602" : o.zip); }
  w.d.raw.prepare("INSERT INTO gm_leads (id, client_id, cliente, address, city, estado) VALUES (?, 'c1', 'Smith', ?, ?, ?)").run("lead" + k, o.leadAddress || "", o.leadCity || "", o.leadState || "");
  w.d.raw.prepare("INSERT INTO gm_estimates (id, client_id, lead_id, job_id, number, revision, status, mode, job_name, public_token, accepted_option_id) VALUES (?, 'c1', ?, ?, ?, 1, ?, 'single', ?, ?, ?)").run("est" + k, "lead" + k, jobId, "EST-000" + k, o.status || "accepted", "Smith roof " + k, "tok" + k, "opt" + k);
  w.d.raw.prepare("INSERT INTO gm_estimate_options (id, estimate_id, tier, sort_order) VALUES (?, ?, 'single', 0)").run("opt" + k, "est" + k);
  lines.forEach((l, i) => w.d.raw.prepare("INSERT INTO gm_estimate_items (id, estimate_id, option_id, pricing_id, item_name, qty, unit, rate_cents, amount_cents, sort_order, abc_ship_to, abc_branch) VALUES (?, ?, ?, ?, ?, ?, ?, 1000, 1000, ?, ?, ?)").run("il" + k + "-" + i, "est" + k, "opt" + k, l[0], "Line " + i, l[1], l[2], i, l[3] || "", l[4] || ""));
  return "est" + k;
}
function signContract(w, estId, o) {
  o = o || {};
  const k = estId.replace("est", "");
  const jobId = w.d.q("SELECT job_id FROM gm_estimates WHERE id = ?", estId)[0].job_id;
  w.d.raw.prepare("INSERT INTO gm_contracts (id, client_id, job_id, lead_id, estimate_ids_json, number, status, public_token, homeowner_signed_at, company_signed_at) VALUES (?, 'c1', ?, ?, ?, ?, 'completed', ?, '2026-11-02 10:00:00', '2026-11-01 10:00:00')")
    .run("con" + k, jobId, "lead" + k, JSON.stringify([estId]), "CON-000" + k, "ctok" + k);
  return "con" + k;
}
const L1 = [["p-paver", 40, "sq ft"], ["p-boot", 3, "each"], ["p-labor", 8, "hora"]];
const draftsOf = (w) => w.d.q("SELECT * FROM gm_abc_order_drafts ORDER BY rowid");
const linesOf = (w, did) => w.d.q("SELECT * FROM gm_abc_order_draft_lines WHERE draft_id = ? ORDER BY sort_order", did);
const getDraft = async (w, did, qs) => read(await w.F.handleGetGmAbcDraft("c1", did, get("/x" + (qs || "")), w.env));
const putDraft = async (w, did, body) => read(await w.F.handlePutGmAbcDraft("c1", did, put("/x", body), w.env));
const sendDraft = async (w, did, fresh) => {
  // The page sends the prices the owner reviewed; a line with no stored price is reviewed at ABC's current price.
  const prices = {};
  w.d.q("SELECT id, item_number, unit_price FROM gm_abc_order_draft_lines WHERE draft_id = ? AND removed = 0", did).forEach((l) => { prices[l.id] = l.unit_price !== null ? l.unit_price : (w.abc.prices[l.item_number] || {}).price; });
  return read(await w.F.handlePostGmAbcDraftSend("c1", did, post("/x", { prices }), w.env));
};
const ensureRoute = async (w, body) => read(await w.F.handlePostGmAbcDraftEnsure("c1", post("/x", body), w.env));
const newRoute = async (w, body) => read(await w.F.handlePostGmAbcDraftNew("c1", post("/x", body), w.env));
async function fresh(opts) { const w = world(opts); seedWorld(w); await seedConn(w); user = OWNER; return w; }
// Fills every answer of a draft and prices it, so only what a test breaks can be missing.
async function fillAll(w, did) {
  await putDraft(w, did, { delivery_service: "OTG", delivery_to: "job", delivery_date: future(10), contact_name: "Zeta Owner", contact_email: "office@zeta.example", contact_phone: "8135550100", delivery_contact_name: "Sam Lee", delivery_contact_phone: "8135550111" });
  await w.F.handlePostGmAbcDraftPrices("c1", did, post("/x", {}), w.env);
}

await check("ready-flag", async () => {
  const w = world();
  ok(typeof w.F.abcNoContractReady === "function", "abcNoContractReady exists");
  ok((await w.F.abcNoContractReady(w.env)) === true, "ready when source_kind and manual_key exist");
  const o = world({ nocontract: false });
  ok((await o.F.abcNoContractReady(o.env)) === false, "not ready without the migration: the Worker behaves as before");
  const sql = readFileSync(new URL("../migrations/abc_orders_without_contract.sql", import.meta.url), "utf8");
  ok(/DROP INDEX IF EXISTS idx_gm_abc_drafts_live_pair/.test(sql) && /idx_gm_abc_drafts_live_src/.test(sql) && /duplicate column name/.test(sql) && /manual_key/.test(sql) && /source_kind/.test(sql), "the migration drops the old index, makes the new one, and says what fails if run twice");
  const e = readFileSync(new URL("../migrations/ticket_evidence.sql", import.meta.url), "utf8");
  ok(/evidence_json TEXT/.test(e) && /occurrences INTEGER NOT NULL DEFAULT 1/.test(e), "the evidence migration adds evidence_json and occurrences");
});

await check("estimate-draft", async () => {
  const w = await fresh();
  const est = seedEstimate(w, L1);
  const r1 = await w.F.abcDraftEnsureForEstimate(w.env, "c1", est, "Owner", "Zeta Owner");
  const rows = draftsOf(w);
  ok(r1 && rows.length === 1 && rows[0].source_kind === "estimate" && rows[0].contract_id === "" && rows[0].estimate_id === est && rows[0].manual_key === "", "an accepted estimate with ABC lines makes ONE estimate draft (no contract, estimate id filled)");
  ok(linesOf(w, rows[0].id).length === 2 && rows[0].contact_name === "Zeta Owner", "only the ABC linked lines are on it, the contact is the owner's own name");
  const r2 = await w.F.abcDraftEnsureForEstimate(w.env, "c1", est, "Owner", "Zeta Owner");
  ok(draftsOf(w).length === 1 && r2 && r2.id === r1.id, "a second call makes no second draft");
  ok(w.abc.calls.length === 0, "making the draft never calls ABC");
  const none = seedEstimate(w, [["p-labor", 8, "hora"]]);
  ok((await w.F.abcDraftEnsureForEstimate(w.env, "c1", none, "Owner", "")) === null && draftsOf(w).length === 1, "an estimate with no ABC linked line makes no draft");
  const sent = seedEstimate(w, L1, { status: "sent" });
  ok((await w.F.abcDraftEnsureForEstimate(w.env, "c1", sent, "Owner", "")) === null && draftsOf(w).length === 1, "an estimate that is not accepted makes no draft");
  ok((await w.F.abcDraftEnsureForEstimate(w.env, "c2", est, "Owner", "")) === null && draftsOf(w).length === 1, "another business cannot make a draft from this estimate");
  await w.F.handlePostGmAbcDraftDiscard("c1", r1.id, post("/x", {}), w.env);
  ok((await w.F.abcDraftEnsureForEstimate(w.env, "c1", est, "Owner", "")) === null && draftsOf(w).filter((d) => d.status === "draft").length === 0, "a discarded estimate draft is never made again");
  const off = await fresh({ env: Object.assign({}, ENV_OK, { ABC_SANDBOX_CLIENT_IDS: "c9" }) });
  const e2 = seedEstimate(off, L1);
  ok((await off.F.abcDraftEnsureForEstimate(off.env, "c1", e2, "Owner", "")) === null && draftsOf(off).length === 0, "a business that may not use ABC gets no draft");
  const old = world({ nocontract: false }); seedWorld(old); await seedConn(old);
  const e3 = seedEstimate(old, L1);
  ok((await old.F.abcDraftEnsureForEstimate(old.env, "c1", e3, "Owner", "")) === null, "before the migration: no draft, nothing breaks");
});

await check("two-pairs", async () => {
  const w = await fresh(); seedPairs(w, [PAIR_A, PAIR_B]);
  const est = seedEstimate(w, [["p-paver", 40, "sq ft", PAIR_A.ship, PAIR_A.branch], ["p-boot", 3, "each", PAIR_B.ship, PAIR_B.branch]]);
  await w.F.abcDraftEnsureForEstimate(w.env, "c1", est, "Owner", "Zeta Owner");
  const rows = draftsOf(w);
  ok(rows.length === 2 && rows.map((d) => d.branch_number).sort().join() === "1234,340", "two branches make two drafts, one per pair");
  await w.F.abcDraftEnsureForEstimate(w.env, "c1", est, "Owner", "Zeta Owner");
  ok(draftsOf(w).length === 2, "calling again makes no more");
});

await check("ensure-route", async () => {
  const w = await fresh();
  const est = seedEstimate(w, L1);
  const r = await ensureRoute(w, { estimate_id: est });
  ok(r.status === 200 && r.data.draft && r.data.draft.status === "draft" && draftsOf(w).length === 1, "the ensure route makes the draft from estimate_id");
  user = null; ok((await ensureRoute(w, { estimate_id: est })).status === 401, "not signed in is 401");
  for (const who of [SELLER, RIVAL, STAFF]) { user = who; ok((await ensureRoute(w, { estimate_id: est })).status === 403, (who.login_role || who.role) + " is 403"); }
  user = OWNER;
  ok((await ensureRoute(w, { estimate_id: "x/y" })).status === 400, "a bad id is 400");
  ok((await ensureRoute(w, {})).status === 400, "neither contract_id nor estimate_id is 400");
  ok((await ensureRoute(w, { estimate_id: "nope-1" })).status === 400, "an estimate of nobody is 400");
  const sent = seedEstimate(w, L1, { status: "sent" });
  ok((await ensureRoute(w, { estimate_id: sent })).status === 409, "an estimate that is not accepted is 409");
  const w2 = await fresh(); const e2 = seedEstimate(w2, L1);
  const w3 = await fresh(); seedEstimate(w3, L1);
  w3.d.raw.prepare("UPDATE gm_estimates SET client_id = 'c2'").run();
  ok((await ensureRoute(w3, { estimate_id: "est" + kk })).status === 400, "an estimate of another business is 400");
  void e2;
});

await check("contract-adopts-estimate-draft", async () => {
  const w = await fresh();
  const est = seedEstimate(w, L1);
  const d0 = await w.F.abcDraftEnsureForEstimate(w.env, "c1", est, "Owner", "Zeta Owner");
  await putDraft(w, d0.id, { delivery_service: "COM", delivery_date: future(7), delivery_contact_name: "Sam Lee", delivery_contact_phone: "8135550111" });
  const before = linesOf(w, d0.id).map((l) => l.id).join();
  const con = signContract(w, est);
  const r = await w.F.abcDraftEnsureForContract(w.env, "c1", con, "contract signed");
  const rows = draftsOf(w);
  ok(rows.length === 1 && r && r.id === d0.id && rows[0].contract_id === con && rows[0].source_kind === "contract", "the contract ADOPTS the live estimate draft: still one draft, now with the contract id");
  ok(rows[0].delivery_date === future(7) && rows[0].delivery_contact_name === "Sam Lee" && rows[0].delivery_service === "COM" && linesOf(w, d0.id).map((l) => l.id).join() === before, "its lines and its answers (date, person) are kept");
  // a SENT estimate draft is not made again by the contract
  const w2 = await fresh();
  const e2 = seedEstimate(w2, L1);
  const d2 = await w2.F.abcDraftEnsureForEstimate(w2.env, "c1", e2, "Owner", "Z");
  w2.d.raw.prepare("UPDATE gm_abc_order_drafts SET status = 'sent' WHERE id = ?").run(d2.id);
  await w2.F.abcDraftEnsureForContract(w2.env, "c1", signContract(w2, e2), "contract signed");
  ok(draftsOf(w2).length === 1 && draftsOf(w2)[0].status === "sent", "a SENT estimate draft is not made again when the contract is signed");
});

await check("manual-order", async () => {
  const w = await fresh();
  const good = { job_name: "Quick repair", items: [{ price_list_id: "p-boot", quantity: 4 }, { item_number: "PAVER6X9", quantity: 2 }] };
  const r = await newRoute(w, good);
  const rows = draftsOf(w);
  ok(r.status === 200 && rows.length === 1 && rows[0].source_kind === "manual" && rows[0].manual_key.length >= 16 && rows[0].contract_id === "" && rows[0].estimate_id === "" && rows[0].job_name === "Quick repair", "a manual order: source manual, a fresh key, no contract, no estimate, the job name");
  const ls = linesOf(w, rows[0].id);
  ok(ls.length === 2 && ls.find((l) => l.item_number === "EACH0001").quantity === 4 && ls.find((l) => l.item_number === "EACH0001").uom === "EA" && ls[0].abc_description.indexOf("ABC ") === 0, "lines from the owner's own Price list rows, quantity in ABC units, ABC's own description");
  await newRoute(w, good);
  ok(draftsOf(w).length === 2, "many manual orders can exist");
  ok(w.abc.calls.length === 0, "making it never calls ABC");
  ok((await newRoute(w, { job_name: "X", items: [{ price_list_id: "p-other", quantity: 1 }] })).status === 400, "a Price list row of another business is refused");
  ok((await newRoute(w, { job_name: "X", items: [{ price_list_id: "p-labor", quantity: 1 }] })).status === 400, "a Price list row not linked to ABC is refused");
  ok((await newRoute(w, { job_name: "X", items: [{ item_number: "NOTMINE1", quantity: 1 }] })).status === 400, "an item number that is not on the owner's list is refused");
  ok((await newRoute(w, Object.assign({}, good, { ship_to: "9999", branch: "1" }))).status === 400, "a pair that is not the business's own is refused");
  ok((await newRoute(w, { job_name: "X", items: Array.from({ length: 51 }, () => ({ price_list_id: "p-boot", quantity: 1 })) })).status === 400, "more than 50 items is refused");
  ok((await newRoute(w, { job_name: "X", items: [] })).status === 400, "no items is refused");
  ok((await newRoute(w, { job_name: "X", items: [{ price_list_id: "p-boot", quantity: 0 }] })).status === 400 && (await newRoute(w, { job_name: "X", items: [{ price_list_id: "p-boot", quantity: "3" }] })).status === 400, "a quantity that is not a positive number is refused");
  ok((await newRoute(w, { job_name: "", items: good.items })).status === 400 && (await newRoute(w, { job_name: "<b>x</b>", items: good.items })).status === 400 && (await newRoute(w, { job_name: "a".repeat(61), items: good.items })).status === 400, "a job name that is empty, unsafe or over 60 characters is refused");
  ok((await newRoute(w, { job_name: "X", items: [{ price_list_id: "p-boot", item_number: "EACH0001", quantity: 1 }] })).status === 400, "both an id and a number on one item is refused");
  user = null; ok((await newRoute(w, good)).status === 401, "not signed in is 401");
  for (const who of [SELLER, RIVAL, STAFF]) { user = who; ok((await newRoute(w, good)).status === 403, (who.login_role || who.role) + " is 403"); }
  user = OWNER;
  const w2 = await fresh(); let first = 0;
  for (let i = 1; i <= 40; i++) { const rr = await newRoute(w2, good); if (rr.status === 429 && !first) { first = i; } }
  ok(first === 31, "the 31st request in the window is the first 429 (got " + first + ")");
  const old = world({ nocontract: false }); seedWorld(old); await seedConn(old);
  ok((await newRoute(old, good)).status === 503, "before the migration the route answers Not available yet");
});

// ── ONE readiness answer ──
async function completeDraft(w, o) {
  const est = seedEstimate(w, L1, o);
  const d = await w.F.abcDraftEnsureForEstimate(w.env, "c1", est, "Owner", "Zeta Owner");
  await fillAll(w, d.id);
  return d.id;
}
const missingOf = async (w, did, qs) => (await getDraft(w, did, qs)).data.draft.missing;
const sendMissing = async (w, did) => { const r = await sendDraft(w, did); return r.data && Array.isArray(r.data.missing) ? r.data.missing : []; };

await check("readiness-complete", async () => {
  const w = await fresh();
  const did = await completeDraft(w);
  const m = await missingOf(w, did);
  ok(Array.isArray(m) && m.length === 0, "a fully answered, priced draft lists nothing (got " + JSON.stringify(m) + ")");
  const s = await sendDraft(w, did);
  ok(s.status === 200 && w.abc.orders.length === 1, "and then the send goes through");
});

const REFUSALS = [
  ["delivery_place_complete", "the job address cannot be read as complete", async (w, did) => { w.d.raw.prepare("UPDATE gm_jobs SET addr_street = 'Near the lake', addr_city = '', addr_state = '', addr_zip = ''").run(); w.d.raw.prepare("UPDATE gm_abc_order_drafts SET ship_line1 = '', ship_city = '', ship_state = '', ship_postal = ''").run(); }],
  ["delivery_date", "no date and no TBD", async (w, did) => { w.d.raw.prepare("UPDATE gm_abc_order_drafts SET delivery_date = '', delivery_date_tbd = 0").run(); }],
  ["delivery_contact_name", "no on-site person", async (w, did) => { w.d.raw.prepare("UPDATE gm_abc_order_drafts SET delivery_contact_name = ''").run(); }],
  ["delivery_contact_phone", "no on-site phone", async (w, did) => { w.d.raw.prepare("UPDATE gm_abc_order_drafts SET delivery_contact_phone = ''").run(); }],
  ["contact_name", "no contact name", async (w, did) => { w.d.raw.prepare("UPDATE gm_abc_order_drafts SET contact_name = ''").run(); }],
  ["delivery_service", "no delivery type", async (w, did) => { w.d.raw.prepare("UPDATE gm_abc_order_drafts SET delivery_service = ''").run(); }],
  ["item_description", "no ABC description", async (w, did) => { w.d.raw.prepare("UPDATE gm_abc_order_draft_lines SET abc_description = ''").run(); }],
  ["item_length", "a line sold in lengths", async (w, did) => { w.d.raw.prepare("UPDATE gm_abc_order_draft_lines SET abc_dimensional = 1").run(); }],
  ["branch", "a pair that is no longer the business's", async (w, did) => { w.d.raw.prepare("UPDATE gm_abc_order_drafts SET ship_to_number = '9', branch_number = '9'").run(); }]
];
for (const [key, label, breakIt] of REFUSALS) {
  await check("readiness-" + key, async () => {
    const w = await fresh(); seedPairs(w, [PAIR_A, PAIR_B]);
    const did = await completeDraft(w);
    ok((await missingOf(w, did)).length === 0, key + ": starts with nothing missing");
    await breakIt(w, did);
    const list = await missingOf(w, did);
    ok(list.indexOf(key) !== -1, key + " (" + label + ") is in the readiness list (got " + JSON.stringify(list) + ")");
    const refused = await sendMissing(w, did);
    ok(refused.length > 0 && refused.every((k) => list.indexOf(k) !== -1), key + ": every refusal the send gives is in that list first (" + JSON.stringify(refused) + ")");
    ok(w.abc.orders.length === 0, key + ": nothing was sent");
  });
}

await check("readiness-line-price", async () => {
  const w = await fresh();
  const did = await completeDraft(w);
  w.d.raw.prepare("UPDATE gm_abc_order_draft_lines SET unit_price = NULL").run();
  ok((await missingOf(w, did)).indexOf("line_price") !== -1, "a line with no price is listed as line_price");
  const s = await sendDraft(w, did);
  ok(s.status === 200, "the send asks ABC for fresh prices itself, so a missing stored price never blocks it");
});

await check("readiness-location-name-taken", async () => {
  const w = await fresh();
  const did = await completeDraft(w);
  w.d.raw.prepare("INSERT INTO gm_abc_delivery_locations (id, client_id, name, line1, city, state, postal) VALUES ('loc1', 'c1', 'Warehouse', '5 Yard Rd', 'Tampa', 'FL', '33610')").run();
  const q = (name, line1) => "?loc_name=" + encodeURIComponent(name) + "&loc_line1=" + encodeURIComponent(line1) + "&loc_city=Tampa&loc_state=FL&loc_postal=33611";
  ok((await missingOf(w, did, q("warehouse", "99 Other Rd"))).indexOf("location_name_taken") !== -1, "a new location with the name of a saved one at another address is listed as location_name_taken");
  ok((await missingOf(w, did, q("Depot", "99 Other Rd"))).indexOf("location_name_taken") === -1, "another name is fine");
  ok((await missingOf(w, did)).indexOf("location_name_taken") === -1, "nothing typed, nothing taken");
  const r = await putDraft(w, did, { new_location: { name: "Warehouse", line1: "99 Other Rd", city: "Tampa", state: "FL", postal: "33611" } });
  ok(r.status === 409, "and the save the page would have made is the same refusal (409), so the page never asks for it");
});

await check("readiness-address-one-line", async () => {
  const w = await fresh();
  const est = seedEstimate(w, L1, { street: "", city: "", state: "", zip: "", leadAddress: "77 Pine Ave, Tampa, FL 33603" });
  const d = await w.F.abcDraftEnsureForEstimate(w.env, "c1", est, "Owner", "Zeta Owner");
  await fillAll(w, d.id);
  ok((await missingOf(w, d.id)).length === 0, "a lead that keeps its address as ONE line is read into street, city, state and zip: nothing missing");
  const ship = draftsOf(w)[0];
  ok(ship.ship_line1 === "77 Pine Ave" && ship.ship_city === "Tampa" && ship.ship_state === "FL" && ship.ship_postal === "33603", "the parts are saved on the order only");
  ok(w.d.q("SELECT address FROM gm_leads WHERE id = 'lead" + kk + "'")[0].address === "77 Pine Ave, Tampa, FL 33603", "the lead is never rewritten");
  const w2 = await fresh();
  const e2 = seedEstimate(w2, L1, { street: "", city: "", state: "", zip: "", leadAddress: "the red house by the lake" });
  const d2 = await w2.F.abcDraftEnsureForEstimate(w2.env, "c1", e2, "Owner", "Zeta Owner");
  await fillAll(w2, d2.id);
  ok((await missingOf(w2, d2.id)).indexOf("delivery_place_complete") !== -1, "a line that cannot be read is delivery_place_complete");
  const r = await putDraft(w2, d2.id, { delivery_to: "job", job_address: { line1: "1 Lake Rd", city: "Tampa", state: "FL", postal: "33603" } });
  ok(r.status === 200 && (await missingOf(w2, d2.id)).indexOf("delivery_place_complete") === -1, "answering the four parts clears it");
});

await check("route-list-and-detail-for-estimate-and-manual", async () => {
  const w = await fresh();
  const est = seedEstimate(w, L1);
  const d = await w.F.abcDraftEnsureForEstimate(w.env, "c1", est, "Owner", "Zeta Owner");
  await newRoute(w, { job_name: "Quick repair", items: [{ price_list_id: "p-boot", quantity: 4 }] });
  const l = (await read(await w.F.handleGetGmAbcDrafts("c1", get("/x"), w.env))).data.drafts;
  const e = l.find((x) => x.id === d.id), m = l.find((x) => x.source_kind === "manual");
  ok(e && e.source_kind === "estimate" && e.estimate_number === "EST-000" + kk && e.contract_number === null, "the list shows the estimate draft with the estimate number");
  ok(m && m.job_name === "Quick repair" && m.estimate_number === null, "the list shows the manual order by its job name");
  const g = await getDraft(w, d.id);
  ok(g.status === 200 && g.data.draft.estimate_number === "EST-000" + kk && g.data.draft.source_kind === "estimate", "opening an estimate draft works (no contract needed)");
  const g2 = await getDraft(w, m.id);
  ok(g2.status === 200 && g2.data.draft.source_kind === "manual", "opening a manual order works");
  const r = await read(await w.F.handleGetGmAbcDrafts("c1", get("/x?estimate_id=" + est), w.env));
  ok(r.data.drafts.length === 1 && r.data.drafts[0].id === d.id, "the list can be asked for one estimate");
});

await check("names-filled-from-abc", async () => {
  const w = await fresh();
  ok(w.d.q("SELECT branch_name, ship_to_name FROM gm_abc_branches").length === 0, "starts with no pair row");
  w.d.raw.prepare("INSERT INTO gm_abc_branches (id, client_id, ship_to_number, branch_number, ship_to_name, branch_name, is_default, created_by) VALUES ('bk-c1', 'c1', '2010466-2', '1234', '', '', 1, 'backfill')").run();
  const r = await read(await w.F.handleGetGmAbcAccounts("c1", get("/x"), w.env));
  ok(r.status === 200, "the accounts route answers");
  const row = w.d.q("SELECT * FROM gm_abc_branches")[0];
  ok(row.ship_to_name === "Zeta Roofing" && row.branch_name === "Tampa", "the empty names of the default pair are filled from ABC's own list");
  w.d.raw.prepare("UPDATE gm_abc_branches SET branch_name = 'My own name'").run();
  await w.F.handleGetGmAbcAccounts("c1", get("/x"), w.env);
  ok(w.d.q("SELECT branch_name FROM gm_abc_branches")[0].branch_name === "My own name", "a name that is already there is never overwritten");
  const w2 = await fresh();
  w2.d.raw.prepare("INSERT INTO gm_abc_branches (id, client_id, ship_to_number, branch_number, ship_to_name, branch_name, is_default, created_by) VALUES ('bk-c1', 'c1', '2010466-2', '340', '', '', 0, 'backfill')").run();
  w2.d.raw.prepare("INSERT INTO gm_abc_branches (id, client_id, ship_to_number, branch_number, ship_to_name, branch_name, is_default, created_by) VALUES ('bk-c2', 'c1', '2010466-2', '1234', '', '', 1, 'backfill')").run();
  const add = await read(await w2.F.handlePostGmAbcBranch("c1", post("/x", { ship_to: "2010999-1", branch: "55" }), w2.env));
  const names = w2.d.q("SELECT branch_number, branch_name, ship_to_name FROM gm_abc_branches ORDER BY branch_number");
  ok(add.status === 200 && names.find((x) => x.branch_number === "55").branch_name === "Provo", "adding a pair saves the names of the new pair");
  ok(w2.abc.calls.length > 0, "the names come from an owner action that asks ABC (never from a background job)");
});

await check("home-reason-both-languages", async () => {
  const w = await fresh();
  const res = new Response(JSON.stringify({ error: "This project already has contract CON-0034 (completed). Open it from the project.", error_en: "This project already has contract CON-0034 (completed). Open it from the project.", error_pt: "Este projeto já tem o contrato CON-0034 (concluído). Abra pelo projeto." }), { status: 409 });
  const { build } = await import("./fixtures/d1-shim.mjs");
  const F = build(["gmChainReason", "gmReasonIn"], [], {});
  const both = await F.gmChainReason(res);
  ok(F.gmReasonIn(both, "pt").indexOf("Este projeto") === 0 && F.gmReasonIn(both, "en").indexOf("This project") === 0, "the stored reason carries both languages and each is picked on its own");
  ok(F.gmReasonIn("unexpected error: x", "pt") === "unexpected error: x", "a one language reason is returned as it is");
  void w;
});

await check("acceptance-paths-make-the-draft", async () => {
  const sliceOf = (a, b) => { const i = src.indexOf("async function " + a + "("); return src.slice(i, src.indexOf("async function " + b + "(", i)); };
  const mark = sliceOf("handlePostGmEstimateMarkAccepted", "handlePostGmEstimateVoid");
  ok(mark.indexOf("abcDraftEnsureForEstimate") > mark.indexOf("estimate_accepted") && /materials_order: materials/.test(mark) && /catch \(eMat\)/.test(mark), "Mark accepted (in person): after the acceptance is recorded it makes the draft, tells the page, and a failure never undoes the acceptance");
  const online = sliceOf("handlePostPublicEstimateAccept", "gmEstChainContract");
  ok(online.indexOf("abcDraftEnsureForEstimate") > online.indexOf("gmEstApplyToLead") && /catch \(eMat2\)/.test(online), "the customer's acceptance link makes the draft too, inside its own try so signing never fails");
  ok(/body\.estimate_id !== undefined && body\.contract_id === undefined/.test(src), "the ensure route takes estimate_id");
});

console.log(fail ? "\n" + fail + " FAILED" : "\nAll passed");
process.exit(fail ? 1 : 0);
