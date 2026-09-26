// Estimates & invoices build — PHASE 2 math, run against the REAL Worker
// functions (sliced from worker/index.js) and gm.js.
import { readFileSync } from "node:fs";
const root = new URL("../", import.meta.url);
const worker = readFileSync(new URL("worker/index.js", root), "utf8");
const gm = readFileSync(new URL("gm.js", root), "utf8");
let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };
const slice = (src, a, b) => { const i = src.indexOf(a); const j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error("slice not found: " + a); return src.slice(i, j); };
const fnSrc = (src, name) => { const i = src.indexOf("function " + name + "("); if (i < 0) throw new Error("fn not found " + name); const j = src.indexOf("\n}", i); return src.slice(i, j + 2); };

const W = {};
new Function("g", [
  fnSrc(worker, "gmStr"), fnSrc(worker, "gmNum"),
  fnSrc(worker, "gmDocScheduleStepsError"),
  slice(worker, "var GM_EST_STATUSES = [", "\n// ── Reads ──"),
  fnSrc(worker, "gmEstDerivedStatus"), fnSrc(worker, "gmEstValorOption"),
  "g.W = { gmEstLineAmountCents, gmEstDiscountCents, gmEstOptionTotals, gmEstScheduleAmounts, gmEstDepositOverTen, gmEstOptionCosts, gmEstParseSchedule, gmDocFormatNumber, gmEasternToday, gmDateAddDays, gmEstDerivedStatus, gmEstValorOption };"
].join("\n"))(W);
const F = W.W;

// line totals
ok(F.gmEstLineAmountCents({ qty: 3, rate_cents: 12550, line_type: "standard" }) === 37650, "3 x $125.50 = $376.50");
ok(F.gmEstLineAmountCents({ qty: 2.5, rate_cents: 1000, line_type: "standard" }) === 2500, "fractional qty rounds to cents");
ok(F.gmEstLineAmountCents({ qty: 1, rate_cents: 99900, line_type: "included" }) === 0, "an included line is $0");
ok(F.gmEstLineAmountCents({ qty: 1, rate_cents: 250000, line_type: "allowance" }) === 250000, "an allowance carries its amount");

// section subtotals + discount on the WHOLE total only
const items = [
  { category: "Pool", qty: 1, rate_cents: 5000000, line_type: "standard" },
  { category: "Pool", qty: 2, rate_cents: 150000, line_type: "standard" },
  { category: "Deck", qty: 400, rate_cents: 1250, line_type: "standard" },
  { category: "Deck", qty: 1, rate_cents: 0, line_type: "included" }
];
const t = F.gmEstOptionTotals(items, "pct", 10);
ok(t.subtotal_cents === 5000000 + 300000 + 500000, "subtotal sums every line");
ok(t.categories[0].category === "Pool" && t.categories[0].subtotal_cents === 5300000 && t.categories[1].subtotal_cents === 500000, "section subtotals per category in order of first appearance");
ok(t.discount_cents === 580000 && t.total_cents === 5220000, "10% discount applies once to the whole total");
const ta = F.gmEstOptionTotals(items, "amount", 250000);
ok(ta.discount_cents === 250000 && ta.total_cents === 5550000, "$2,500 discount on the total");
ok(F.gmEstDiscountCents(100000, "amount", 999999) === 100000, "a discount never exceeds the subtotal (no floor otherwise)");
ok(F.gmEstDiscountCents(100000, null, 50) === 0 && F.gmEstDiscountCents(100000, "pct", 0) === 0, "no discount type or 0 = no discount");
ok(F.gmEstOptionTotals(items, "pct", 100).total_cents === 0, "100% discount is allowed (no floor)");

// schedule amounts sum exactly to the total
const steps = [{ label: "Deposit", pct: 33.34 }, { label: "Mid", pct: 33.33 }, { label: "Final", pct: 33.33 }];
const amts = F.gmEstScheduleAmounts(steps, 1000001);
ok(amts.reduce((a, s) => a + s.amount_cents, 0) === 1000001, "schedule amounts add up to the total to the cent (last step absorbs rounding)");
ok(F.gmEstParseSchedule([{ label: "a", pct: 60 }, { label: "b", pct: 40 }]).steps.length === 2, "60/40 parses");
ok(!!F.gmEstParseSchedule([{ label: "a", pct: 60 }, { label: "b", pct: 41 }]).error, "60/41 refused");
ok(!!F.gmEstParseSchedule([]).error, "an estimate needs at least one step");
ok(F.gmEstDepositOverTen([{ pct: 10 }, { pct: 90 }]) === false && F.gmEstDepositOverTen([{ pct: 10.01 }, { pct: 89.99 }]) === true, "the §489.126 rule fires above 10%, not at 10%");

// costs x qty
const c = F.gmEstOptionCosts([{ qty: 2, material_cost_cents: 100, labor_cost_cents: 50, other_cost_cents: 10 }, { qty: 1, material_cost_cents: 5 }]);
ok(c.material_cents === 205 && c.labor_cents === 100 && c.other_cents === 20 && c.total_cents === 325, "costs are per unit x qty, split by type");

// numbers, dates, derived status, valor rule
ok(F.gmDocFormatNumber("EST", 7) === "EST-0007" && F.gmDocFormatNumber("INV", 12345) === "INV-12345", "EST-0001 formatting");
ok(/^\d{4}-\d{2}-\d{2}$/.test(F.gmEasternToday()), "Eastern today is YYYY-MM-DD");
ok(F.gmDateAddDays("2026-12-31", 30) === "2027-01-30", "valid_until = issue + N days across a year end");
ok(F.gmEstDerivedStatus({ status: "sent", valid_until: "2000-01-01" }) === "expired", "a sent estimate past valid_until reads as expired");
ok(F.gmEstDerivedStatus({ status: "accepted", valid_until: "2000-01-01" }) === "accepted", "an accepted estimate never expires");
ok(F.gmEstDerivedStatus({ status: "sent", valid_until: "2999-01-01" }) === "sent", "a live one stays sent");
const tiered = { mode: "tiered", accepted_option_id: null, options: [{ id: "a", tier: "best" }, { id: "b", tier: "better" }, { id: "c", tier: "good" }] };
ok(F.gmEstValorOption(tiered).id === "b", "valor uses Better before acceptance on a tiered estimate");
ok(F.gmEstValorOption({ mode: "tiered", accepted_option_id: "c", options: tiered.options }).id === "c", "…and the accepted option after");

// stage-forward rule lives in gmEstApplyToLead: assert the exact guard text
ok(/\["novo_lead", "contato_feito", "visita_agendada"\]\.indexOf\(lead\.estagio\) !== -1/.test(worker), "first send moves the stage forward only from novo_lead / contato_feito / visita_agendada");
ok(!/data_estimate = /.test(slice(worker, "async function gmEstApplyToLead", "\n// ── Handlers: contractor side")), "the estimate never writes data_estimate");
ok(!/comissao = /.test(slice(worker, "async function gmEstApplyToLead", "\n// ── Handlers: contractor side")), "the estimate never writes comissao");

// SQL-guarded transitions
ok(/status IN \('sent','viewed','changes_requested'\) AND valid_until >= \?/.test(worker), "customer acceptance is guarded in SQL on status and valid_until");
ok(/status = 'superseded'[^;]*status IN \('sent','viewed','changes_requested'\)/.test(worker), "supersede on edit is guarded in SQL");

// public payload never carries internal fields
const pub = slice(worker, "function gmEstimatePublicPayload", "\n// The internal detail");
// decline_reason is the CUSTOMER's own text, so it may print back to them.
ok(!/cost|margin|commission|internal_notes|override|override_reason|vendedor|lead_id|actor/.test(pub.replace(/\/\/[^\n]*/g, "").replace(/decline_reason/g, "")), "gmEstimatePublicPayload exposes no cost, margin, commission, override, reason, internal notes, seller, actor or lead id");

// gm.js response state
const G = {};
new Function("g", "var gmT=function(p,e){return e;}; var isEn=function(){return true;}; var GmLabels={estimateStatusLabel:function(k){return k;}};" + fnSrc(gm, "gmEstResponseState") + fnSrc(gm, "gmEstStatusLabel") + "\ng.f=gmEstResponseState;")(G);
const hAgo = (h) => new Date(Date.now() - h * 3600000).toISOString().slice(0, 19).replace("T", " ");
ok(G.f({ status: "sent", sent_at: hAgo(1) }).band === "gm-gold", "sent 1h ago: yellow");
ok(G.f({ status: "viewed", sent_at: hAgo(30), first_viewed_at: hAgo(2) }).band === "gm-orange" && G.f({ status: "viewed", sent_at: hAgo(30), first_viewed_at: hAgo(2) }).eye, "viewed but unanswered at 30h: orange, with the eye (viewing does not clear the colour)");
ok(G.f({ status: "sent", sent_at: hAgo(50) }).band === "gm-red", "unanswered at 50h: red");
ok(G.f({ status: "sent", sent_at: hAgo(50) }).reminders.some(r => /Not opened/.test(r)), "not opened after 2 days reminder");
ok(G.f({ status: "accepted", sent_at: hAgo(100) }).band === "gm-green" && G.f({ status: "declined", sent_at: hAgo(100) }).band === "gm-muted" && G.f({ status: "changes_requested", sent_at: hAgo(100) }).band === "gm-muted", "any response clears the colour");
const soon = new Date(Date.now() + 20 * 3600000); const ymd = soon.getFullYear() + "-" + String(soon.getMonth() + 1).padStart(2, "0") + "-" + String(soon.getDate()).padStart(2, "0");
ok(G.f({ status: "sent", sent_at: hAgo(1), valid_until: ymd }).reminders.some(r => /Expires in 48/.test(r)), "expires-in-48h reminder");

// static rules for the new files
const ev = readFileSync(new URL("estimate-view.html", root), "utf8");
const tpl = readFileSync(new URL("templates/client-estimate-template.html", root), "utf8");
// Comments explain the rule and name what is forbidden; only RENDERED text
// and code count, so they are stripped before the check.
const strip = (s) => s.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*$/gm, "").replace(/apex-api\.farfromtimnah\.workers\.dev/g, "");
ok(!/apex/i.test(strip(ev)), "estimate-view.html carries no Apex branding (only the API host)");
ok(!/apex/i.test(strip(tpl)), "the print template carries no Apex branding");
ok(!/position:\s*fixed/.test(strip(tpl)) && !/@bottom-center/.test(strip(tpl)), "the print template has no position:fixed footer");
ok(/\.slide \{ position: relative; width: 8\.5in; height: 11in/.test(tpl) && /\.slide::after \{ content: attr\(data-footer\)/.test(tpl), "fixed 8.5x11 slides with the footer as ::after inside the slide");
ok(/window\.print\(\)/.test(tpl) && !/html2pdf|puppeteer/.test(tpl), "PDF via the template window's own print, no html2pdf");
ok(/name="viewport"/.test(ev) && /padding: 0 16px/.test(ev), "customer page is mobile-first with 16px gutters");
ok(!/\bconst\b|\blet\b|=>/.test(slice(gm, "// ESTIMATES — list, detail sheet, wizard, send", "function gmEstWizSave")), "new gm.js code uses var/function only");
ok(!/DELETE FROM gm_estimates|DELETE FROM gm_estimate_items|DELETE FROM gm_estimate_options|DELETE FROM gm_doc_counters/.test(worker), "no DELETE on the estimate tables");

console.log(fail ? `\n❌ ${fail} FAILED` : "\n✅ ALL PASS");
process.exit(fail ? 1 : 0);
