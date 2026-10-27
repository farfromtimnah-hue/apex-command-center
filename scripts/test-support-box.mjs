// "Tell us" support box: the REAL Worker functions on an in-memory SQLite.
// No network, no production database. Claude calls are stubbed per test.
//
//   node scripts/test-support-box.mjs
import { makeDb, build, baseStubs } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };

const FNS = [
  "supportStaffAuthed", "supportStaffAuth", "supportToolLookupClient", "supportRunClaudeTool",
  "supportRateLimited", "supportIncrementDailyCount", "handlePostSupportMessage",
  "handleGetSupportTickets", "handleGetSupportTicketDetail", "handlePostSupportTicketResolve",
  "handlePostSupportTicketUndoResolve", "handlePostSupportTicketsClearResolved", "handleGetSupportOpenCount",
  "supportPageIsPortal", "supportFeatureGuideFor"
];
const VARS = ["SUPPORT_TOOLS", "SUPPORT_FEATURE_GUIDE_STAFF_PT", "SUPPORT_FEATURE_GUIDE_STAFF_EN",
  "SUPPORT_FEATURE_GUIDE_PORTAL_PT", "SUPPORT_FEATURE_GUIDE_PORTAL_EN", "SUPPORT_AI_MODEL"];
const MIGRATIONS = ["migrations/support_tickets.sql"];

function world(stubOverrides) {
  const d = makeDb(MIGRATIONS);
  const stubs = Object.assign({}, baseStubs, {
    gmEasternToday: () => TODAY,
    authenticate: async () => ({ role: "alice", display_name: "Alice", email: "alice@test.com" }),
    claudeBudgetGate: async () => null, // daily caps: see test-claude-budget.mjs
    jsonErr2: function (pt, en, status) { return { status: status || 400, error: en, error_pt: pt, error_en: en }; },
    CLAUDE_API_URL: "https://x.test/claude",
    getZohoAccessToken: async function () { throw new Error("Zoho should be stubbed per-test"); },
    zohoBankingFetch: async function () { throw new Error("Zoho should be stubbed per-test"); },
    pushToUsers: async function () { /* no-op: push delivery is not under test here */ },
    fetch: async function () { throw new Error("fetch should be stubbed per-test"); }
  }, stubOverrides || {});
  const F = build(FNS, VARS, stubs);
  return { d, env: { DB: d.DB }, F };
}

let TODAY = "2026-10-15";

function claudeTextReply(text) {
  return async function () { return { ok: true, json: async () => ({ content: [{ type: "text", text: text }] }) }; };
}

// ── Role gating ──────────────────────────────────────────────────────────
{
  const w = world();
  ok(w.F.supportStaffAuthed({ role: "alice" }), "alice can use the support box");
  ok(w.F.supportStaffAuthed({ role: "rafa" }), "rafa can use the support box");
  ok(w.F.supportStaffAuthed({ role: "developer" }), "developer can use the support box");
  ok(w.F.supportStaffAuthed({ role: "seller" }), "seller can use the support box");
  ok(!w.F.supportStaffAuthed({ role: "client" }), "a client role is never allowed");
  ok(!w.F.supportStaffAuthed(null), "no user is never allowed");
}

// ── lookup_client tool: non-secret fields only ──────────────────────────
{
  const w = world();
  w.d.raw.prepare("INSERT INTO clients (id, name, status, industry, location, created_at) VALUES ('c1', 'Dipro Remodeling', 'active', 'Remodeling', 'Orlando', datetime('now'))").run();
  w.d.raw.prepare("INSERT INTO clients (id, name, status, zoho_customer_id, created_at) VALUES ('c2', 'Secret Co', 'active', 'zoho-secret-123', datetime('now'))").run();
  const r = await w.F.supportToolLookupClient(w.env, "Dipro");
  ok(r.found === true && r.clients[0].name === "Dipro Remodeling", "partial name match finds the client");
  ok(!Object.keys(r.clients[0]).includes("zoho_customer_id"), "lookup_client never returns a Zoho id or other secret field");
  const r2 = await w.F.supportToolLookupClient(w.env, "Nonexistent Co");
  ok(r2.found === false, "no match reports found:false, never a guess");
}

// ── Daily rate cap ────────────────────────────────────────────────────────
{
  const w = world();
  ok(!(await w.F.supportRateLimited(w.env, "alice@test.com")), "under the cap: not rate-limited");
  for (let i = 0; i < 10; i++) { await w.F.supportIncrementDailyCount(w.env, "alice@test.com"); }
  ok((await w.F.supportRateLimited(w.env, "alice@test.com")) === true, "at 10 reports today: rate-limited");
  ok(!(await w.F.supportRateLimited(w.env, "bob@test.com")), "the cap is per-user, not global");
}

// ── Full conversation: a follow-up question, then a finished ticket ──────
{
  let callCount = 0;
  const w = world({
    fetch: async function (url, opts) {
      callCount++;
      const body = JSON.parse(opts.body);
      if (body.tools) {
        // First turn: ask one follow-up question. Second turn (after the
        // user answers it): give guidance and finish.
        if (callCount === 1) {
          return { ok: true, json: async () => ({ content: [{ type: "text", text: "Qual pagina estava aberta quando isso aconteceu?" }] }) };
        }
        return { ok: true, json: async () => ({ content: [{ type: "text", text: "Para criar uma fatura, abra Financeiro > Faturas > Nova Fatura. O relato foi enviado." }] }) };
      }
      // The summary call (no `tools` key).
      return { ok: true, json: async () => ({ content: [{ type: "text", text: "WHAT: invoice page broken. WHERE: Financeiro. EXPECTED vs ACTUAL: ..." }] }) };
    }
  });

  const req1 = { json: async () => ({ transcript: [{ role: "user", text: "A fatura nao esta abrindo" }], kind: "broken", page: "/finance.html", language: "pt" }) };
  const r1 = await w.F.handlePostSupportMessage(req1, w.env);
  ok(r1.status === 200 && r1.data.done === false, "first turn: Claude asks a follow-up, ticket not yet created");
  ok(w.d.q("SELECT COUNT(*) AS n FROM support_tickets")[0].n === 0, "no ticket row exists until the conversation finishes");

  const req2 = {
    json: async () => ({
      transcript: [
        { role: "user", text: "A fatura nao esta abrindo" },
        { role: "assistant", text: r1.data.assistant_text },
        { role: "user", text: "Estava na pagina financeiro" }
      ],
      kind: "broken", page: "/finance.html", language: "pt"
    })
  };
  const r2 = await w.F.handlePostSupportMessage(req2, w.env);
  ok(r2.status === 200 && r2.data.done === true, "second turn: Claude has enough and finishes");
  const tickets = w.d.q("SELECT * FROM support_tickets");
  ok(tickets.length === 1, "exactly one ticket is written when the conversation finishes");
  ok(tickets[0].original_words.indexOf("A fatura nao esta abrindo") !== -1, "her original words are saved verbatim");
  ok(tickets[0].status === "open", "a new ticket starts open");
}

// ── Claude failure still saves her original words ────────────────────────
{
  const w = world({ fetch: async function () { throw new Error("network down"); } });
  const reqBody = { transcript: [{ role: "user", text: "Preciso de um relatorio novo" }], kind: "need", page: "/dashboard.html", language: "pt" };
  const req = { json: async () => reqBody, clone: function () { return { json: async () => reqBody }; } };
  const r = await w.F.handlePostSupportMessage(req, w.env);
  ok(r.status === 200 || r.status === 500, "a Claude failure never crashes the request");
  const tickets = w.d.q("SELECT * FROM support_tickets");
  ok(tickets.length === 1, "her words are saved as a ticket even when Claude fails entirely");
  ok(tickets[0].original_words === "Preciso de um relatorio novo", "the exact words survive the failure path");
  ok((tickets[0].guidance || tickets[0].summary_en || "").toLowerCase().indexOf("fail") !== -1, "the ticket notes that follow-up questions failed");
}

// ── Resolve / undo / clear-resolved, with the overwrite guards ──────────
{
  const w = world({ authenticate: async () => ({ role: "developer", display_name: "Dev", email: "dev@test.com" }) });
  const nowIso = "2026-10-15 10:00:00";
  w.d.raw.prepare(
    "INSERT INTO support_tickets (id, created_at, reporter_email, reporter_name, language, kind, page, transcript_json, original_words, summary_en, guidance, status) " +
    "VALUES ('t1', ?, 'alice@test.com', 'Alice', 'pt', 'broken', '/finance.html', '[]', 'algo quebrado', 'summary', 'guidance', 'open')"
  ).run(nowIso);

  const openList = await w.F.handleGetSupportTickets({ url: "https://x/?status=open" }, w.env);
  ok(openList.status === 200 && openList.data.tickets.length === 1, "open tickets list shows the new ticket");

  const resolveResp = await w.F.handlePostSupportTicketResolve("t1", {}, w.env);
  ok(resolveResp.status === 200, "resolve: succeeds on an open ticket");
  let row = w.d.q("SELECT status, resolved_by FROM support_tickets WHERE id = 't1'")[0];
  ok(row.status === "resolved" && row.resolved_by === "Dev", "resolve: status and resolved_by are set");

  const doubleResolve = await w.F.handlePostSupportTicketResolve("t1", {}, w.env);
  ok(doubleResolve.status === 404, "resolve: a second resolve on an already-resolved ticket is rejected (WHERE status='open' guard)");

  const undoResp = await w.F.handlePostSupportTicketUndoResolve("t1", {}, w.env);
  ok(undoResp.status === 200, "undo-resolve: succeeds within the window");
  row = w.d.q("SELECT status, resolved_by FROM support_tickets WHERE id = 't1'")[0];
  ok(row.status === "open" && row.resolved_by === null, "undo-resolve: status reverts and resolved_by clears");

  const doubleUndo = await w.F.handlePostSupportTicketUndoResolve("t1", {}, w.env);
  ok(doubleUndo.status === 404, "undo-resolve: a second undo on an already-open ticket is rejected (WHERE status='resolved' guard)");

  await w.F.handlePostSupportTicketResolve("t1", {}, w.env);
  const countResp = await w.F.handleGetSupportOpenCount({}, w.env);
  ok(countResp.status === 200 && countResp.data.count === 0, "open-count reflects the resolve");

  const clearResp = await w.F.handlePostSupportTicketsClearResolved({}, w.env);
  ok(clearResp.status === 200 && clearResp.data.deleted === 1, "clear-resolved: deletes exactly the resolved ticket");
  ok(w.d.q("SELECT COUNT(*) AS n FROM support_tickets")[0].n === 0, "clear-resolved: the ticket is gone for good");
}

// ── The guide answers from the right menu for the page the user is on ──
{
  const w = world();
  ok(!w.F.supportPageIsPortal("/dashboard.html"), "dashboard.html is the staff app, not the portal");
  ok(!w.F.supportPageIsPortal(""), "no page given defaults to the staff app, not the portal");
  ok(w.F.supportPageIsPortal("/portal.html"), "portal.html is recognized as the client portal");
  ok(w.F.supportPageIsPortal("/portal.html?tab=gmpricing"), "a portal deep link with a query string still counts as the portal");

  const staffPt = w.F.supportFeatureGuideFor("/dashboard.html", "pt");
  const staffEn = w.F.supportFeatureGuideFor("/dashboard.html", "en");
  const portalPt = w.F.supportFeatureGuideFor("/portal.html", "pt");
  const portalEn = w.F.supportFeatureGuideFor("/portal.html", "en");
  ok(staffPt.indexOf("dock de 5 posicoes") !== -1, "staff PT guide describes the phone dock, not a side menu, for mobile");
  ok(staffEn.indexOf("5-spot dock") !== -1, "staff EN guide describes the phone dock, not a side menu, for mobile");
  ok(staffPt.indexOf("Precos") === -1 && staffEn.indexOf("Pricing") === -1, "the staff guide says nothing about the portal's Pricing placement");
  ok(portalPt.indexOf("Negocio") !== -1 && portalPt.indexOf("Precos") !== -1, "portal PT guide names the Negocio group and Precos");
  ok(portalEn.indexOf("Business") !== -1 && portalEn.indexOf("Pricing") !== -1, "portal EN guide names the Business group and Pricing");
  ok(/Precos[^\n]*por ultimo/.test(portalPt) || portalPt.indexOf("por ultimo Precos") !== -1, "portal PT guide places Precos last in Negocio");
  ok(portalEn.indexOf("last Pricing") !== -1, "portal EN guide places Pricing last in Business");
  ok(portalPt.indexOf("engrenagem") !== -1 && portalPt.toLowerCase().indexOf("nao fica mais na engrenagem") !== -1,
     "portal PT guide explicitly says Precos is no longer behind the gear");
  ok(portalEn.toLowerCase().indexOf("not behind the gear") !== -1, "portal EN guide explicitly says Pricing is no longer behind the gear");
}

// ── A page/feature not confirmed in the guide: "not sure", ticket still filed ──
{
  const w = world({
    fetch: async function (url, opts) {
      const body = JSON.parse(opts.body);
      if (body.tools) {
        return { ok: true, json: async () => ({ content: [{ type: "text", text: "Nao tenho certeza se essa pagina existe no momento. O relato foi enviado." }] }) };
      }
      return { ok: true, json: async () => ({ content: [{ type: "text", text: "WHAT: unclear feature request." }] }) };
    }
  });
  const reqBody = { transcript: [{ role: "user", text: "Onde fica a pagina de X?" }, { role: "assistant", text: "..." }, { role: "user", text: "Nao sei dizer mais detalhes" }], kind: "need", page: "/portal.html", language: "pt" };
  const r = await w.F.handlePostSupportMessage({ json: async () => reqBody }, w.env);
  ok(r.status === 200 && r.data.done === true, "an unconfirmed feature still finishes the conversation");
  ok(r.data.assistant_text.toLowerCase().indexOf("nao tenho certeza") !== -1 || r.data.assistant_text.toLowerCase().indexOf("certeza") !== -1,
     "the reply hedges with uncertainty rather than asserting the page doesn't exist");
  const tickets = w.d.q("SELECT * FROM support_tickets");
  ok(tickets.length === 1, "the ticket is still filed even when the guide can't confirm the feature");
}

// ── Non-developer is forbidden from the Support panel endpoints ─────────
{
  const w = world({ authenticate: async () => ({ role: "alice", display_name: "Alice" }) });
  const r = await w.F.handleGetSupportTickets({ url: "https://x/?status=open" }, w.env);
  ok(r.status === 403, "alice cannot read the developer Support panel");
}

console.log(fail ? ("\n" + fail + " FAILED") : "\nALL PASS");
process.exit(fail ? 1 : 0);
