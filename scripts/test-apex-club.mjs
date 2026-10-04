// Apex Club registration and payments, against the REAL Worker functions on an
// in-memory SQLite (see scripts/fixtures/d1-shim.mjs). No network.
//
//   node scripts/test-apex-club.mjs
import { readFileSync } from "node:fs";
import { makeDb, build, baseStubs, req, hasFn, workerSrc } from "./fixtures/d1-shim.mjs";

const root = new URL("../", import.meta.url);
const MIGS = ["migrations/apex_club_company.sql", "migrations/apex_invoice_public.sql", "migrations/apex_club_pay.sql"];
let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) { fail++; } };
const stubs = Object.assign({}, baseStubs, { crypto: globalThis.crypto });

function seedEvent(d, id, extra) {
  const e = Object.assign({ single: 5000, couple: 7500, open: 1 }, extra || {});
  d.raw.prepare("INSERT INTO apex_club_events (id, name, event_date, window_start, window_end, price_single_cents, price_couple_cents, registration_open) VALUES (?, ?, '2026-10-20', '2026-10-06', '2026-10-27', ?, ?, ?)")
    .run(id, "Apex Club " + id, e.single, e.couple, e.open);
}

// ── Phase 1: the business name on the registration ─────────────────────────
{
  const d = makeDb(MIGS); const env = { DB: d.DB };
  const names = ["normalizeUsPhone", "handlePostClubRegister"].concat(hasFn("gmEstNewToken") ? ["gmEstNewToken"] : []);
  const F = build(names, [], stubs);
  seedEvent(d, "ev1");
  const reg = (body) => F.handlePostClubRegister("ev1", req(body), env);
  const row = (phone) => d.q("SELECT name, company, plus_one, rsvp_state, source FROM apex_club_registrations WHERE phone = ?", phone)[0];

  let r = await reg({ name: "Maria Silva", phone: "(813) 555-0100", plus_one: false, company: "  Silva Flooring LLC  " });
  ok(r.status === 200 && r.data.registered === true && row("18135550100").company === "Silva Flooring LLC", "a registration with a company stores it, trimmed");
  r = await reg({ name: "Maria Silva", phone: "8135550100", plus_one: true, company: "" });
  ok(r.status === 200 && row("18135550100").company === "Silva Flooring LLC" && row("18135550100").plus_one === 1, "re-registering with a blank company keeps the stored one (and still updates the plus one)");
  r = await reg({ name: "Maria Silva", phone: "8135550100", plus_one: true, company: "   " });
  ok(row("18135550100").company === "Silva Flooring LLC", "a whitespace-only company never erases the stored one");
  r = await reg({ name: "Maria S.", phone: "8135550100", company: "Silva Tile Inc" });
  ok(row("18135550100").company === "Silva Tile Inc" && row("18135550100").name === "Maria S.", "re-registering with a new company replaces it");
  r = await reg({ name: "Carlos Souza", phone: "8135550101", plus_one: false });
  ok(r.status === 200 && r.data.registered === true && row("18135550101").company === null, "a registration posted WITHOUT a company key still succeeds, company NULL");
  r = await reg({ name: "Ana Lima", phone: "8135550102", company: "x".repeat(300) });
  ok(row("18135550102").company.length === 120, "company is capped at 120 characters");
  d.raw.prepare("UPDATE apex_club_registrations SET rsvp_state = 'next_time' WHERE phone = '18135550101'").run();
  r = await reg({ name: "Carlos Souza", phone: "8135550101" });
  ok(row("18135550101").rsvp_state === "going" && row("18135550101").source === "public", "re-registering still resets next_time to going");
  ok((await reg({ name: "A", phone: "8135550103", company: "Co" })).status === 400, "the name rule is unchanged (400)");
  ok((await reg({ name: "Ana", phone: "123", company: "Co" })).status === 400, "the phone rule is unchanged (400)");
  ok(d.q("SELECT COUNT(*) AS n FROM apex_club_registrations")[0].n === 3, "one row per phone (idempotent)");
  d.raw.prepare("UPDATE apex_club_events SET registration_open = 0 WHERE id = 'ev1'").run();
  ok((await reg({ name: "Late", phone: "8135550104", company: "Co" })).status === 403, "a closed event still refuses (403)");
  ok((await F.handlePostClubRegister("nope", req({ name: "Late", phone: "8135550104" }), env)).status === 404, "an unknown event is still 404");
}

// The client-portal Club invite never gains a column; the calendar view gains
// company and nothing about money.
{
  const inv = workerSrc.slice(workerSrc.indexOf("async function gmClubInviteEvents("), workerSrc.indexOf("\n}", workerSrc.indexOf("async function gmClubInviteEvents(")));
  ok(/"SELECT id, name, event_date, start_time, venue, speakers, flyer_r2_key " \+\s*"FROM apex_club_events/.test(inv) && !/company|price|paid|pay_token|zelle/i.test(inv.replace(/\/\/[^\n]*/g, "")),
    "gmClubInviteEvents still selects its seven explicit columns, nothing about company, price or payment");
  const by = workerSrc.slice(workerSrc.indexOf("async function handleGetClubBySession("), workerSrc.indexOf("\n}", workerSrc.indexOf("async function handleGetClubBySession(")));
  const regSel = (by.match(/"SELECT id, name, phone[^"]*"/) || [""])[0];
  ok(/company/.test(regSel) && !/paid|pay_token|zelle|cents/.test(regSel), "by-session guest SELECT has company and no paid or payment column: " + regSel);
}

// club.html: the form contract iOS AutoFill needs.
{
  const html = readFileSync(new URL("club.html", root), "utf8");
  ok(/<label for="empresa">Empresa<\/label>\s*<input id="empresa" name="empresa" type="text"\s+autocomplete="organization" autocapitalize="words"\s+placeholder="Nome da sua empresa" required>/.test(html), "club.html has the Empresa field with a real label and the organization token");
  ok(html.indexOf('<label for="nome">') < html.indexOf('<label for="empresa">') && html.indexOf('<label for="empresa">') < html.indexOf('<label for="tel">'), "Empresa sits right after Nome, before WhatsApp");
  ok(/autocomplete="name"/.test(html) && /type="tel"\s+autocomplete="tel"/.test(html) && /<form id="regForm" novalidate>/.test(html) && /<button type="submit"/.test(html), "name and tel tokens, the real form and the submit are intact");
  ok(html.indexOf("Escreva o nome da empresa.") > 0 && /company: empresa/.test(html), "client validation message and company in the POST body");
}
console.log(fail ? "\n" + fail + " FAILED" : "\nALL PASS");
process.exit(fail ? 1 : 0);
