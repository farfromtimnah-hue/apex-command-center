// ABC order drafts, saved delivery locations, batch (2026-11-07).
// The REAL Worker functions on an in-memory SQLite with a FAKE ABC. No real order
// is ever sent: the fake records what would have gone out.
//
//   node scripts/test-abc-order-draft.mjs
import { makeWorld, seedConn, addRow, rowOf, reader, OWNER, SELLER, RIVAL, STAFF, HIDDEN, get, post, put } from "./fixtures/abc-world.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };
async function check(name, fn) { try { await fn(); } catch (e) { console.log("FAIL  " + name + "  [" + String(e && e.stack || e).split("\n").slice(0, 3).join(" | ").slice(0, 300) + "]"); fail++; } }
let user = OWNER;
const logged = [];
console.error = function () { logged.push(Array.prototype.slice.call(arguments).map(String).join(" ")); };
const read = reader(null);
const world = (o) => makeWorld(o, () => user);

// ── seed: Price list rows, a job, an accepted estimate and a signed contract ──
function seedPricing(w) {
  addRow(w, { id: "p-paver", item: "Paver 6x9 Charcoal", unit: "sq ft", abc: "PAVER6X9", abcUnit: "PL", apexUnit: "sq ft", conv: 100, abcCost: 3.8, extra: 10, extraSource: "standard" });
  addRow(w, { id: "p-boot", item: "Pipe boot each", unit: "each", abc: "EACH0001", abcUnit: "EA", apexUnit: "each", abcCost: 12.5 });
  addRow(w, { id: "p-shingle", item: "GAF Timberline HD", unit: "bundle", abc: "02GASTZ3WW", abcUnit: "BD", apexUnit: "bundle", abcCost: 41.5, extra: 5, extraSource: "item" });
  addRow(w, { id: "p-noconv", item: "Mystery roll", unit: "sq ft", abc: "NOCONV01", abcUnit: "RL", apexUnit: null, abcCost: null });
  addRow(w, { id: "p-labor", item: "Labor", unit: "hora" });
}
function seedWorld(w) {
  seedPricing(w);
  w.d.raw.prepare("INSERT INTO gm_doc_settings (client_id, legal_name, address, phone, email) VALUES ('c1', 'Zeta Roofing LLC', '12 Main St, Tampa, FL 33602', '8135550100', 'office@zeta.example')").run();
}
const counters = new WeakMap();
// lines: [[pricing_id | null, qty, unit, name?]]
function seedContract(w, lines, o) {
  o = o || {};
  const k = (counters.get(w) || 0) + 1; counters.set(w, k);
  w.d.raw.prepare("INSERT INTO gm_jobs (id, client_id, lead_id, obra, job_name, addr_street, addr_city, addr_state, addr_zip) VALUES (?, 'c1', ?, ?, ?, ?, ?, ?, ?)").run("job" + k, "lead" + k, "Obra " + k, "Smith roof " + k, k + " Oak St", "Tampa", "FL", "33602");
  w.d.raw.prepare("INSERT INTO gm_estimates (id, client_id, lead_id, job_id, number, revision, status, mode, job_name, public_token, accepted_option_id) VALUES (?, 'c1', ?, ?, ?, 1, 'accepted', 'single', ?, ?, ?)").run("est" + k, "lead" + k, "job" + k, "E-" + k, "Smith roof " + k, "tok" + k, "opt" + k);
  w.d.raw.prepare("INSERT INTO gm_estimate_options (id, estimate_id, tier, sort_order) VALUES (?, ?, 'single', 0)").run("opt" + k, "est" + k);
  lines.forEach((l, i) => w.d.raw.prepare("INSERT INTO gm_estimate_items (id, estimate_id, option_id, pricing_id, item_name, qty, unit, rate_cents, amount_cents, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, 1000, 1000, ?)").run("il" + k + "-" + i, "est" + k, "opt" + k, l[0], l[3] || ("Line " + i), l[1], l[2], i));
  w.d.raw.prepare("INSERT INTO gm_contracts (id, client_id, job_id, lead_id, estimate_ids_json, number, status, public_token, homeowner_signed_at, company_signed_at) VALUES (?, 'c1', ?, ?, ?, ?, ?, ?, ?, '2026-11-01 10:00:00')")
    .run("con" + k, "job" + k, "lead" + k, JSON.stringify(["est" + k]), "CON-000" + k, o.status || "completed", "ctok" + k, o.status && o.status !== "completed" ? null : "2026-11-02 10:00:00");
  return "con" + k;
}
const MAIN = [["p-paver", 40, "sq ft"], ["p-paver", 32, "sq ft"], ["p-boot", 3, "each"], ["p-shingle", 30, "bundle"], ["p-noconv", 5, "sq ft"], ["p-labor", 8, "hora", "Labor"], [null, 1, "each", "Custom haul"]];
const draftsOf = (w) => w.d.q("SELECT * FROM gm_abc_order_drafts ORDER BY rowid");
const linesOfDraft = (w, did) => w.d.q("SELECT * FROM gm_abc_order_draft_lines WHERE draft_id = ? ORDER BY sort_order", did);
const drafts = (w) => w.F.handleGetGmAbcDrafts("c1", get("/x"), w.env);
const getDraft = async (w, did) => (await read(await w.F.handleGetGmAbcDraft("c1", did, get("/x"), w.env)));
const putDraft = async (w, did, body) => (await read(await w.F.handlePutGmAbcDraft("c1", did, put("/x", body), w.env)));
const sendDraft = async (w, did, prices) => (await read(await w.F.handlePostGmAbcDraftSend("c1", did, post("/x", { prices: prices || {} }), w.env)));
const GOOD_LOC = { name: "Warehouse", line1: "5 Yard Rd", city: "Tampa", state: "FL", postal: "33610" };
const pricesOf = (g) => Object.fromEntries(g.data.lines.filter((l) => !l.removed).map((l) => [l.id, l.unit_price]));
async function ready(w, did, over) {
  const body = Object.assign({ delivery_service: "OTG", delivery_to: "job", delivery_date: "2026-11-20", contact_name: "Zeta Roofing LLC", contact_email: "office@zeta.example", contact_phone: "8135550100" }, over || {});
  return putDraft(w, did, body);
}
async function openAndPrice(w, did) {
  await w.F.handlePostGmAbcDraftPrices("c1", did, post("/x", {}), w.env);
  return getDraft(w, did);
}
async function oneDraft(w, lines, o) {
  const con = seedContract(w, lines || MAIN, o);
  await w.F.abcDraftEnsureForContract(w.env, "c1", con, "Signer");
  const row = draftsOf(w).find((d) => d.contract_id === con);
  if (row && lines === undefined) { await putDraft(w, row.id, { lines: linesOfDraft(w, row.id).filter((l) => l.item_number === "NOCONV01").map((l) => ({ id: l.id, removed: true })) }); }
  return { con, did: row && row.id };
}

await check("exists", async () => {
  const w = world();
  for (const f of ["abcDraftEnsureForContract", "handleGetGmAbcDrafts", "handleGetGmAbcDraft", "handlePutGmAbcDraft", "handlePostGmAbcDraftSend", "handlePostGmAbcDraftsCombine", "handlePostGmAbcLocation", "abcPlaceOrder"]) { ok(typeof w.F[f] === "function", f + " exists in the Worker"); }
});

await check("draft-created-once-per-contract", async () => {
  const w = world(); seedWorld(w); await seedConn(w); user = OWNER;
  const con = seedContract(w, MAIN);
  const r1 = await w.F.abcDraftEnsureForContract(w.env, "c1", con, "Signer");
  const r2 = await w.F.abcDraftEnsureForContract(w.env, "c1", con, "Signer");
  ok(draftsOf(w).length === 1 && r1 && r2 && r1.id === r2.id, "ensure twice: still ONE draft for the contract");
  const ls = linesOfDraft(w, r1.id);
  ok(ls.length === 4, "one order line per ABC item, same item merged (4 lines from 5 ABC estimate lines), non ABC left out (got " + ls.length + ")");
  const paver = ls.find((l) => l.item_number === "PAVER6X9");
  ok(paver.quantity === 1 && paver.uom === "PL" && paver.extra_percent_used === 10 && paver.extra_source === "standard", "paver: 40 + 32 = 72 sq ft, 10 percent extra is 79.2, a 100 sq ft pallet is 1 pallet, with how it was made");
  ok(ls.find((l) => l.item_number === "EACH0001").quantity === 3 && ls.find((l) => l.item_number === "EACH0001").extra_percent_used === null, "a counted item: 3, no extra");
  ok(ls.find((l) => l.item_number === "02GASTZ3WW").quantity === 32 && ls.find((l) => l.item_number === "02GASTZ3WW").extra_source === "item", "same unit word: 30 bundles with 5 percent extra rounds UP to 32");
  const nc = ls.find((l) => l.item_number === "NOCONV01");
  ok(nc.quantity === null, "no conversion and different units: the quantity is left empty to be set");
  ok(w.abc.calls.length === 0, "creating the draft never calls ABC (the contractor is not present when a customer signs)");
  const row = draftsOf(w)[0];
  ok(row.delivery_service === "" && row.delivery_to === "" && row.delivery_date === "" && row.location_id === "", "no delivery type, place or date is chosen for the owner");
  ok(/^[A-Za-z0-9-]{1,16}$/.test(row.order_ref) && row.contact_email === "office@zeta.example" && row.contact_phone === "8135550100" && row.job_name === "Smith roof 1", "a short unique purchase order number, contact from the business profile, job name from the project");
  const g = await getDraft(w, r1.id);
  ok(g.data.not_from_abc.map((x) => x.item_name).sort().join("|") === "Custom haul|Labor", "the lines that are not from ABC are listed as left out");
  ok(g.data.lines.find((l) => l.item_number === "NOCONV01").needs_quantity === true, "the empty quantity is flagged: set the quantity");
  // Not created: unsigned, no ABC lines, no connection, a change order never.
  const unsigned = seedContract(w, MAIN, { status: "sent" });
  ok((await w.F.abcDraftEnsureForContract(w.env, "c1", unsigned, "S")) === null && draftsOf(w).length === 1, "an unsigned contract gets no draft");
  const noAbc = seedContract(w, [["p-labor", 8, "hora"], [null, 1, "each"]]);
  ok((await w.F.abcDraftEnsureForContract(w.env, "c1", noAbc, "S")) === null && draftsOf(w).length === 1, "no ABC linked lines: no draft");
  const w2 = world(); seedWorld(w2); user = OWNER;
  const c2 = seedContract(w2, MAIN);
  ok((await w2.F.abcDraftEnsureForContract(w2.env, "c1", c2, "S")) === null && draftsOf(w2).length === 0, "no ABC connection: no draft");
  ok((await w.F.abcDraftEnsureForContract(w.env, "c2", con, "S")) === null && draftsOf(w).length === 1, "another business cannot create a draft from this contract");
});

await check("signing-hook-never-breaks-signing", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
  const i = src.indexOf("await abcDraftEnsureForContract(env, c.client_id");
  ok(i > 0, "the contract signing code calls abcDraftEnsureForContract");
  const around = src.slice(Math.max(0, i - 200), i + 400);
  ok(/try\s*\{[^}]*abcDraftEnsureForContract/.test(around) && /catch \(\w+\) \{ console\.error\(/.test(around), "the call is wrapped in try and catch and logs with console.error");
});

await check("guards", async () => {
  const w = world(); seedWorld(w); await seedConn(w);
  user = OWNER; const { did } = await oneDraft(w);
  w.d.raw.prepare("INSERT INTO gm_abc_order_drafts (id, client_id, contract_id, job_name) VALUES ('foreign', 'c2', 'conx', 'Theirs')").run();
  w.d.raw.prepare("INSERT INTO gm_abc_delivery_locations (id, client_id, name, line1, city, state, postal) VALUES ('floc', 'c2', 'Theirs', '1 St', 'Miami', 'FL', '33101')").run();
  const calls = {
    list: () => w.F.handleGetGmAbcDrafts("c1", get("/x"), w.env),
    one: () => w.F.handleGetGmAbcDraft("c1", did, get("/x"), w.env),
    ensure: () => w.F.handlePostGmAbcDraftEnsure("c1", post("/x", { contract_id: "con1" }), w.env),
    put: () => w.F.handlePutGmAbcDraft("c1", did, put("/x", { job_name: "X" }), w.env),
    discard: () => w.F.handlePostGmAbcDraftDiscard("c1", did, post("/x", {}), w.env),
    prices: () => w.F.handlePostGmAbcDraftPrices("c1", did, post("/x", {}), w.env),
    send: () => w.F.handlePostGmAbcDraftSend("c1", did, post("/x", { prices: {} }), w.env),
    combine: () => w.F.handlePostGmAbcDraftsCombine("c1", post("/x", { draft_ids: [did, did] }), w.env),
    locations: () => w.F.handleGetGmAbcLocations("c1", get("/x"), w.env),
    newLoc: () => w.F.handlePostGmAbcLocation("c1", post("/x", GOOD_LOC), w.env),
    changeLoc: () => w.F.handlePutGmAbcLocation("c1", "floc", put("/x", GOOD_LOC), w.env),
    archiveLoc: () => w.F.handlePostGmAbcLocationArchive("c1", "floc", post("/x", {}), w.env)
  };
  const callsBefore = w.abc.calls.length;
  for (const k of Object.keys(calls)) {
    user = null; ok((await calls[k]()).status === 401, k + ": not signed in is 401");
    for (const who of [SELLER, RIVAL, STAFF]) { user = who; ok((await calls[k]()).status === 403, k + ": " + (who.login_role || who.role) + " is 403"); }
  }
  ok(w.abc.calls.length === callsBefore, "no call reached ABC from a refused request");
  user = OWNER;
  ok((await w.F.handleGetGmAbcDraft("c1", "foreign", get("/x"), w.env)).status === 404, "another business's draft id is 404");
  for (const f of [() => w.F.handlePutGmAbcDraft("c1", "foreign", put("/x", { job_name: "Hacked" }), w.env), () => w.F.handlePostGmAbcDraftSend("c1", "foreign", post("/x", { prices: {} }), w.env), () => w.F.handlePostGmAbcDraftDiscard("c1", "foreign", post("/x", {}), w.env), () => w.F.handlePostGmAbcDraftPrices("c1", "foreign", post("/x", {}), w.env)]) { ok((await f()).status === 404, "another business's draft: 404 on write"); }
  ok(w.d.q("SELECT job_name, status FROM gm_abc_order_drafts WHERE id = 'foreign'")[0].job_name === "Theirs", "the other business's draft is untouched");
  ok((await putDraft(w, did, { delivery_to: "saved", location_id: "floc" })).status === 404, "another business's saved location cannot be used on my draft");
  ok((await w.F.handlePutGmAbcLocation("c1", "floc", put("/x", GOOD_LOC), w.env)).status === 404 && w.d.q("SELECT name FROM gm_abc_delivery_locations WHERE id = 'floc'")[0].name === "Theirs", "another business's location cannot be changed");
  ok((await w.F.handlePostGmAbcLocationArchive("c1", "floc", post("/x", {}), w.env)).status === 404 && w.d.q("SELECT archived FROM gm_abc_delivery_locations WHERE id = 'floc'")[0].archived === 0, "another business's location cannot be removed");
  ok(!(await (await w.F.handleGetGmAbcLocations("c1", get("/x"), w.env)).text()).includes("Theirs"), "the other business's location is never listed");
});

await check("bad-input-400", async () => {
  const w = world(); seedWorld(w); await seedConn(w); user = OWNER;
  const { did } = await oneDraft(w);
  const bads = [{ delivery_service: "XXX" }, { delivery_service: 5 }, { delivery_date: "2026-13-40" }, { delivery_date: "11/20/2026" }, { delivery_to: "elsewhere" }, { order_ref: "has space" }, { order_ref: "A".repeat(17) }, { order_ref: "" },
    { contact_email: "x".repeat(300) }, { job_name: "J".repeat(200) }, { lines: [{ id: "nope", quantity: 1 }] }, { lines: "x" }, { new_location: { name: "", line1: "a", city: "b", state: "FL", postal: "33610" } },
    { new_location: { name: "N", line1: "a", city: "b", state: "Florida", postal: "33610" } }, { new_location: { name: "N", line1: "a", city: "b", state: "FL", postal: "abc" } }, { add_lines: [{ item_number: "bad item!", uom: "EA", quantity: 1 }] }];
  for (const b of bads) { const r = await putDraft(w, did, b); ok(r.status === 400 || r.status === 404, "refused: " + JSON.stringify(b).slice(0, 70) + " (" + r.status + ")"); }
  const ls = linesOfDraft(w, did).filter((l) => !l.removed);
  for (const q of [-1, 0, "5", 1000000]) { ok((await putDraft(w, did, { lines: [{ id: ls[0].id, quantity: q }] })).status === 400, "line quantity refused: " + JSON.stringify(q)); }
  ok((await w.F.handlePostGmAbcLocation("c1", post("/x", { name: "x" }), w.env)).status === 400, "a location with missing fields is 400");
  ok((await w.F.handlePostGmAbcDraftEnsure("c1", post("/x", { contract_id: "bad id!" }), w.env)).status === 400, "ensure with a bad contract id is 400");
  ok((await w.F.handlePostGmAbcDraftsCombine("c1", post("/x", { draft_ids: [] }), w.env)).status === 400, "combine with no drafts is 400");
});

await check("rate-limit-429", async () => {
  const w = world(); seedWorld(w); await seedConn(w); user = OWNER;
  const { did } = await oneDraft(w);
  let first = 0;
  for (let i = 1; i <= 40; i++) { const r = await w.F.handlePostGmAbcDraftSend("c1", did, post("/x", { prices: {} }), w.env); if (r.status === 429 && !first) { first = i; } }
  ok(first === 31, "the 31st send request in the window is the first 429 (got " + first + ")");
});

await check("delivery-and-locations", async () => {
  const w = world(); seedWorld(w); await seedConn(w); user = OWNER;
  const a = await oneDraft(w), b = await oneDraft(w);
  let g = await getDraft(w, a.did);
  ok(g.data.job_address.line1 === "1 Oak St" && g.data.job_address.city === "Tampa" && g.data.job_address.state === "FL" && g.data.job_address.postal === "33602", "the job address comes from the project");
  ok(g.data.business.address.line1 === "12 Main St" && g.data.business.address.city === "Tampa" && g.data.business.address.state === "FL" && g.data.business.address.postal === "33602", "Use my business address: the profile address split into its parts");
  ok(g.data.locations.length === 0, "no saved locations yet");
  let r = await putDraft(w, a.did, { delivery_to: "job", job_address: { line1: "99 Other Ave", city: "Tampa", state: "FL", postal: "33603" } });
  ok(r.status === 200 && draftsOf(w).find((d) => d.id === a.did).ship_line1 === "99 Other Ave" && w.d.q("SELECT addr_street FROM gm_jobs WHERE id = 'job1'")[0].addr_street === "1 Oak St", "the job address can be edited for this order only (the project is not changed)");
  r = await putDraft(w, a.did, { delivery_to: "saved", new_location: GOOD_LOC });
  ok(r.status === 200, "a NEW LOCATION typed in the form is accepted");
  ok(w.d.q("SELECT * FROM gm_abc_delivery_locations WHERE client_id = 'c1'").length === 1, "...and saved the moment it is used");
  r = await putDraft(w, b.did, { delivery_to: "saved", new_location: GOOD_LOC });
  ok(r.status === 200 && w.d.q("SELECT * FROM gm_abc_delivery_locations WHERE client_id = 'c1'").length === 1, "the same location typed again is NOT saved twice");
  r = await putDraft(w, b.did, { delivery_to: "saved", new_location: Object.assign({}, GOOD_LOC, { line1: "Another Rd" }) });
  ok(r.status === 409, "the same name with a different address is refused (change the saved one instead)");
  const list = await read(await w.F.handleGetGmAbcLocations("c1", get("/x"), w.env));
  ok(list.data.locations.length === 1 && list.data.locations[0].name === "Warehouse" && list.data.locations[0].line1 === "5 Yard Rd", "listed from then on, with its name and address");
  const locId = list.data.locations[0].id;
  ok(draftsOf(w).find((d) => d.id === a.did).location_id === locId && draftsOf(w).find((d) => d.id === a.did).ship_line1 === "5 Yard Rd", "the draft points at the saved location and shows its address");
  r = await read(await w.F.handlePutGmAbcLocation("c1", locId, put("/x", Object.assign({}, GOOD_LOC, { line1: "7 New Yard Rd" })), w.env));
  ok(r.status === 200 && w.d.q("SELECT line1 FROM gm_abc_delivery_locations WHERE id = ?", locId)[0].line1 === "7 New Yard Rd", "Change location edits the saved location");
  const second = await read(await w.F.handlePostGmAbcLocation("c1", post("/x", { name: "Home", line1: "1 Home Ln", city: "Tampa", state: "FL", postal: "33611" }), w.env));
  ok(second.status === 200, "a second location is saved");
  ok((await w.F.handlePutGmAbcLocation("c1", locId, put("/x", Object.assign({}, GOOD_LOC, { name: "Home" })), w.env)).status === 409, "renaming onto another location's name is 409");
  r = await read(await w.F.handlePostGmAbcLocationArchive("c1", locId, post("/x", {}), w.env));
  ok(r.status === 200 && w.d.q("SELECT archived FROM gm_abc_delivery_locations WHERE id = ?", locId)[0].archived === 1, "remove from the list archives, the row stays");
  const list2 = await read(await w.F.handleGetGmAbcLocations("c1", get("/x"), w.env));
  ok(list2.data.locations.length === 1 && list2.data.locations[0].name === "Home", "an archived location is no longer listed");
  ok((await putDraft(w, b.did, { delivery_to: "saved", location_id: locId })).status === 404, "an archived location cannot be picked");
  ok(draftsOf(w).find((d) => d.id === a.did).ship_line1 === "5 Yard Rd" || draftsOf(w).find((d) => d.id === a.did).location_id === locId, "a draft that used it still points at it");
});

await check("send-one-order", async () => {
  const w = world(); seedWorld(w); await seedConn(w); user = OWNER;
  const { did } = await oneDraft(w);
  let g = await openAndPrice(w, did);
  ok(g.data.lines.filter((l) => !l.removed).every((l) => l.unit_price !== null), "opening the draft prices every line from ABC (the contractor is present)");
  ok(g.data.lines.find((l) => l.item_number === "PAVER6X9").unit_price === 380, "the paver is 380 a pallet");
  let r = await sendDraft(w, did, pricesOf(g));
  ok(r.status === 400 && r.data.missing && r.data.missing.indexOf("delivery_service") !== -1 && w.abc.orders.length === 0, "nothing chosen yet: refused with what is missing, nothing sent");
  await ready(w, did);
  r = await putDraft(w, did, { delivery_to: "" });
  r = await sendDraft(w, did, pricesOf(g));
  ok(r.status === 400 && r.data.missing.indexOf("delivery_place") !== -1 && w.abc.orders.length === 0, "no delivery place chosen: refused and named, nothing sent");
  await putDraft(w, did, { delivery_to: "job" });
  r = await sendDraft(w, did, pricesOf(g));
  ok(r.status === 200 && /^CONF-/.test(r.data.confirmation_number) && r.data.status === "sent", "sent: a confirmation number comes back (" + JSON.stringify(r.data).slice(0, 100) + ")");
  const o = w.abc.orders[0];
  ok(w.abc.orders.length === 1 && o.deliveryService === "OTG" && o.dates.deliveryRequestedFor === "2026-11-20" && o.shipTo.address.line1 === "1 Oak St" && o.lines.length === 3, "ONE order, the chosen delivery type and date, the job address, 3 lines (the line with no quantity was removed)");
  ok(o.lines.find((l) => l.itemNumber === "PAVER6X9").orderedQty.value === 1 && o.lines.find((l) => l.itemNumber === "PAVER6X9").unitPrice.value === 380, "quantities and prices as reviewed");
  ok(o.purchaseOrder === draftsOf(w)[0].order_ref && o.requestId === o.purchaseOrder && o.purchaseOrder.length <= 16, "purchase order and request id are the draft's number");
  const row = draftsOf(w)[0];
  ok(row.status === "sent" && /^CONF-/.test(row.abc_confirmation) && row.ship_line1 === "1 Oak St", "the draft is sent, keeps the confirmation and a copy of the delivery place");
  const again = await sendDraft(w, did, pricesOf(g));
  ok(again.status === 409 && w.abc.orders.length === 1, "a sent draft cannot be sent again (ABC was called once)");
  ok((await putDraft(w, did, { job_name: "Changed" })).status === 409, "a sent draft cannot be edited");
  ok((await read(await w.F.handlePostGmAbcDraftDiscard("c1", did, post("/x", {}), w.env))).status === 409, "a sent draft cannot be discarded");
  const ord = w.d.q("SELECT status FROM gm_abc_orders WHERE order_ref = ?", row.order_ref)[0];
  ok(ord && ord.status === "submitted", "the order is in the orders list and follows the webhook from there");
  const after = await getDraft(w, did);
  ok(after.data.draft.order_status === "submitted", "the draft screen shows the status ABC sends");
});

await check("blank-date-and-order-input", async () => {
  const w = world(); seedWorld(w); await seedConn(w); user = OWNER;
  const { did } = await oneDraft(w);
  const g = await openAndPrice(w, did);
  await ready(w, did, { delivery_date: "" });
  const r = await sendDraft(w, did, pricesOf(g));
  ok(r.status === 200 && w.abc.orders[0].dates === undefined, "a blank date is sent without a date: the branch decides");
  const conn = { ship_to_number: "2010466-2", branch_number: "1234" };
  const base = () => ({ order_ref: "AP-1", ship_to: "2010466-2", branch: "1234", delivery_service: "COM", job_name: "J", address: { line1: "1 St", city: "Tampa", state: "FL", postal: "33610" },
    contact: { name: "N", email: "a@b.co", phone: "8135550100" }, lines: [{ item_number: "EACH0001", description: "d", quantity: 1, uom: "EA", unit_price: 1 }] });
  ok(w.F.abcOrderInput(base(), conn) !== null && w.F.abcOrderInput(Object.assign(base(), { delivery_date: "" }), conn) !== null, "the order input accepts no date");
  ok(w.F.abcOrderInput(Object.assign(base(), { delivery_date: "2026-02-30" }), conn) === null && w.F.abcOrderInput(Object.assign(base(), { delivery_date: "11/20/2026" }), conn) === null, "a date that is typed must still be a real YYYY-MM-DD date");
  const noService = base(); delete noService.delivery_service;
  ok(w.F.abcOrderInput(noService, conn) === null, "every other check stays: delivery service");
  ok(w.F.abcOrderInput(Object.assign(base(), { order_ref: "has space" }), conn) === null && w.F.abcOrderInput(Object.assign(base(), { branch: "9999" }), conn) === null, "every other check stays: reference and branch");
});

await check("price-change-needs-confirm", async () => {
  const w = world(); seedWorld(w); await seedConn(w); user = OWNER;
  const { did } = await oneDraft(w);
  const g = await openAndPrice(w, did); await ready(w, did);
  const seen = pricesOf(g);
  w.abc.prices["PAVER6X9"] = { uom: "PL", price: 395 };
  let r = await sendDraft(w, did, seen);
  ok(r.status === 409 && r.data.price_changed === true && r.data.changes.some((c) => c.was === 380 && c.now === 395) && w.abc.orders.length === 0, "a price that changed since the owner reviewed: nothing sent, the change is shown");
  const g2 = await getDraft(w, did);
  ok(g2.data.lines.find((l) => l.item_number === "PAVER6X9").unit_price === 395 && draftsOf(w)[0].status === "draft", "the draft now holds the new price and is still a draft");
  r = await sendDraft(w, did, pricesOf(g2));
  ok(r.status === 200 && w.abc.orders[0].lines.find((l) => l.itemNumber === "PAVER6X9").unitPrice.value === 395, "after the owner confirms the new price, it is sent with that price");
  const w2 = world(); seedWorld(w2); await seedConn(w2); user = OWNER;
  const x = await oneDraft(w2); const g3 = await openAndPrice(w2, x.did); await ready(w2, x.did);
  const tampered = pricesOf(g3); const k = Object.keys(tampered)[0]; tampered[k] = 0.01;
  const t = await sendDraft(w2, x.did, tampered);
  ok(t.status === 409 && w2.abc.orders.length === 0, "a price sent by the page that ABC does not confirm is never used");
  const w3 = world(); seedWorld(w3); await seedConn(w3); user = OWNER;
  const y = await oneDraft(w3); const g4 = await openAndPrice(w3, y.did); await ready(w3, y.did);
  w3.abc.prices["EACH0001"] = { err: true };
  const nop = await sendDraft(w3, y.did, pricesOf(g4));
  ok(nop.status === 409 && nop.data.no_price && w3.abc.orders.length === 0, "ABC gives no price for a line: not sent, the line is named");
});

await check("abc-refuses-and-down", async () => {
  const w = world(); seedWorld(w); await seedConn(w); user = OWNER;
  const { did } = await oneDraft(w);
  const g = await openAndPrice(w, did); await ready(w, did);
  w.abc.orderFail = { status: 400, message: "Delivery service OTG is not available for branch 1234" };
  let r = await sendDraft(w, did, pricesOf(g));
  ok(r.status === 422 && /not available for branch 1234/.test(r.data.error_en) && /not available for branch 1234/.test(JSON.stringify(r.data.abc_refusal || "")), "ABC refusing a delivery type: ABC's words are shown in plain text (" + r.status + ")");
  ok(draftsOf(w)[0].status === "draft" && w.d.q("SELECT * FROM gm_abc_orders").length === 0, "the draft stays a draft and the purchase order number is free again");
  await putDraft(w, did, { delivery_service: "COM" });
  w.abc.orderFail = null;
  r = await sendDraft(w, did, pricesOf(g));
  ok(r.status === 200 && w.abc.orders[w.abc.orders.length - 1].deliveryService === "COM", "the owner picks another type and it goes");
  ok(!HIDDEN.some((h) => JSON.stringify(r).includes(h)) && !logged.some((l) => HIDDEN.some((h) => l.includes(h))), "no secret in an answer or the log");
});

await check("duplicate-purchase-order", async () => {
  const w = world(); seedWorld(w); await seedConn(w); user = OWNER;
  const a = await oneDraft(w), b = await oneDraft(w);
  const refA = draftsOf(w).find((d) => d.id === a.did).order_ref, refB = draftsOf(w).find((d) => d.id === b.did).order_ref;
  ok(refA !== refB && /^[A-Za-z0-9-]{1,16}$/.test(refA), "two drafts get two different short numbers");
  ok((await putDraft(w, b.did, { order_ref: refA })).status === 409, "the same number on a second draft is refused");
  const g = await openAndPrice(w, a.did); await ready(w, a.did);
  await sendDraft(w, a.did, pricesOf(g));
  const g2 = await openAndPrice(w, b.did); await ready(w, b.did);
  ok((await putDraft(w, b.did, { order_ref: refA })).status === 409, "a number already sent is refused");
  w.d.raw.prepare("UPDATE gm_abc_order_drafts SET order_ref = ? WHERE id = ?").run("AP-DUP", b.did);
  w.d.raw.prepare("INSERT INTO gm_abc_orders (id, client_id, order_ref, status) VALUES ('o1', 'c1', 'AP-DUP', 'submitted')").run();
  const r = await sendDraft(w, b.did, pricesOf(g2));
  ok(r.status === 409 && w.abc.orders.length === 1, "the existing rule in the orders list still refuses a used reference (ABC called once)");
});

await check("batch-A-each-order-its-own-place", async () => {
  const w = world(); seedWorld(w); await seedConn(w); user = OWNER;
  const a = await oneDraft(w), b = await oneDraft(w), c = await oneDraft(w);
  const ga = await openAndPrice(w, a.did), gb = await openAndPrice(w, b.did), gc = await openAndPrice(w, c.did);
  await ready(w, a.did, { delivery_to: "job" });
  await ready(w, b.did, { delivery_to: "saved", new_location: GOOD_LOC });
  // c has no delivery choice yet: it is listed as missing and cannot go.
  let r = await sendDraft(w, c.did, pricesOf(gc));
  ok(r.status === 400 && r.data.missing.indexOf("delivery_service") !== -1, "a draft with no delivery choice is named as missing and not sent");
  await ready(w, c.did, { delivery_to: "job", job_address: { line1: "3 Elm St", city: "Tampa", state: "FL", postal: "33604" } });
  w.abc.orderFail = (o) => (o.shipTo.address.line1 === "3 Elm St" ? { status: 400, message: "Address could not be validated" } : null);
  const results = [];
  for (const [d, g] of [[a.did, ga], [b.did, gb], [c.did, gc]]) { results.push(await sendDraft(w, d, pricesOf(g))); }
  ok(results[0].status === 200 && results[1].status === 200 && results[2].status === 422, "one order at a time: two went, the third was refused and the rest were not stopped");
  ok(w.abc.orders.length === 3 && w.abc.orders[0].shipTo.address.line1 === "1 Oak St" && w.abc.orders[1].shipTo.address.line1 === "5 Yard Rd" && w.abc.orders[1].shipTo.name === "Warehouse", "each order went to its own place (job address, saved location)");
  const statusOf = (did) => draftsOf(w).find((d) => d.id === did).status;
  ok(statusOf(a.did) === "sent" && statusOf(b.did) === "sent" && statusOf(c.did) === "draft", "the owner sees which succeeded and which did not");
});

await check("batch-B-one-place-separate-and-combined", async () => {
  const w = world(); seedWorld(w); await seedConn(w); user = OWNER;
  const a = await oneDraft(w, [["p-paver", 72, "sq ft"], ["p-boot", 3, "each"]]);
  const b = await oneDraft(w, [["p-paver", 150, "sq ft"], ["p-boot", 2, "each"]]);
  const c = await oneDraft(w, [["p-paver", 10, "sq ft"]]);
  const gs = [await openAndPrice(w, a.did), await openAndPrice(w, b.did), await openAndPrice(w, c.did)];
  // Separate orders: the same place on each, one purchase order each.
  const loc = await read(await w.F.handlePostGmAbcLocation("c1", post("/x", GOOD_LOC), w.env));
  ok(loc.status === 200, "the batch location is typed ONCE and saved");
  for (const d of [a.did, b.did]) { await ready(w, d, { delivery_to: "saved", location_id: loc.data.location.id }); }
  const r1 = await sendDraft(w, a.did, pricesOf(gs[0])), r2 = await sendDraft(w, b.did, pricesOf(gs[1]));
  ok(r1.status === 200 && r2.status === 200 && w.abc.orders.length === 2 && w.abc.orders[0].purchaseOrder !== w.abc.orders[1].purchaseOrder && w.abc.orders.every((o) => o.shipTo.address.line1 === "5 Yard Rd"), "SEPARATE ORDERS: one per job, each with its own purchase order, all to the one place");
  ok(w.d.q("SELECT last_used_at FROM gm_abc_delivery_locations WHERE id = ?", loc.data.location.id)[0].last_used_at !== "", "using the location updates last_used_at");
  // Combined: the second pair plus c, merged.
  const w2 = world(); seedWorld(w2); await seedConn(w2); user = OWNER;
  const a2 = await oneDraft(w2, [["p-paver", 72, "sq ft"], ["p-boot", 3, "each"]]);
  const b2 = await oneDraft(w2, [["p-paver", 150, "sq ft"], ["p-boot", 2, "each"]]);
  const g1 = await openAndPrice(w2, a2.did), g2 = await openAndPrice(w2, b2.did);
  const prices = { PAVER6X9: 380, EACH0001: 12.5 };
  const body = (extra) => Object.assign({ draft_ids: [a2.did, b2.did], mode: "combined", delivery_service: "OTG", delivery_date: "", location: GOOD_LOC, contact: { name: "Zeta", email: "office@zeta.example", phone: "8135550100" }, order_ref: "AP-COMBO1", prices: prices }, extra || {});
  let r = await read(await w2.F.handlePostGmAbcDraftsCombine("c1", post("/x", body({ delivery_service: "" })), w2.env));
  ok(r.status === 400 && w2.abc.orders.length === 0, "a combined order with no delivery type is refused, nothing sent");
  r = await read(await w2.F.handlePostGmAbcDraftsCombine("c1", post("/x", body({ prices: { PAVER6X9: 1, EACH0001: 12.5 } })), w2.env));
  ok(r.status === 409 && r.data.price_changed === true && w2.abc.orders.length === 0 && draftsOf(w2).every((d) => d.status === "draft"), "a price the page showed that ABC does not confirm: nothing sent, drafts stay drafts");
  r = await read(await w2.F.handlePostGmAbcDraftsCombine("c1", post("/x", body()), w2.env));
  ok(r.status === 200 && w2.abc.orders.length === 1, "ONE COMBINED ORDER: one call to ABC (" + r.status + " " + JSON.stringify(r.data).slice(0, 120) + ")");
  const o = w2.abc.orders[0];
  ok(o.purchaseOrder === "AP-COMBO1" && o.lines.length === 2 && o.lines.find((l) => l.itemNumber === "PAVER6X9").orderedQty.value === 3 && o.lines.find((l) => l.itemNumber === "EACH0001").orderedQty.value === 5, "lines merged by ABC item number: 1 + 2 pallets = 3, 3 + 2 = 5, one purchase order");
  ok(o.dates === undefined && o.shipTo.name === "Warehouse" && o.shipTo.address.line1 === "5 Yard Rd", "blank date left out; the one place is the ship to");
  ok(draftsOf(w2).every((d) => d.status === "combined" && d.combined_into === "AP-COMBO1" && /^CONF-/.test(d.abc_confirmation)), "every included draft shows: combined into order AP-COMBO1 with the confirmation");
  ok(w2.d.q("SELECT * FROM gm_abc_delivery_locations WHERE client_id = 'c1'").length === 1, "the location typed in the form was saved once");
  r = await read(await w2.F.handlePostGmAbcDraftsCombine("c1", post("/x", body({ order_ref: "AP-COMBO2" })), w2.env));
  ok(r.status === 409 && w2.abc.orders.length === 1, "drafts already combined are never sent again");
  // A refusal reverts the claim.
  const w3 = world(); seedWorld(w3); await seedConn(w3); user = OWNER;
  const a3 = await oneDraft(w3, [["p-paver", 72, "sq ft"]]), b3 = await oneDraft(w3, [["p-paver", 72, "sq ft"]]);
  await openAndPrice(w3, a3.did);
  w3.abc.orderFail = { status: 400, message: "Branch cannot deliver on that day" };
  r = await read(await w3.F.handlePostGmAbcDraftsCombine("c1", post("/x", { draft_ids: [a3.did, b3.did], mode: "combined", delivery_service: "OTG", delivery_date: "", location: GOOD_LOC, contact: { name: "Z", email: "o@z.example", phone: "8135550100" }, order_ref: "AP-C3", prices: { PAVER6X9: 380 } }), w3.env));
  ok(r.status === 422 && draftsOf(w3).every((d) => d.status === "draft" && d.combined_into === ""), "a refused combined order puts every draft back and says why");
});

await check("discard", async () => {
  const w = world(); seedWorld(w); await seedConn(w); user = OWNER;
  const { did, con } = await oneDraft(w);
  const r = await read(await w.F.handlePostGmAbcDraftDiscard("c1", did, post("/x", {}), w.env));
  ok(r.status === 200 && draftsOf(w)[0].status === "discarded", "a draft can be discarded");
  ok((await w.F.abcDraftEnsureForContract(w.env, "c1", con, "S")) === null && draftsOf(w).length === 1, "a discarded draft is not made again on the next open");
  ok((await putDraft(w, did, { job_name: "x" })).status === 409, "a discarded draft cannot be edited");
});

console.log(fail ? "\n" + fail + " check(s) FAILED" : "\nAll checks passed");
process.exit(fail ? 1 : 0);
