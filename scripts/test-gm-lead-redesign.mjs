// Structural check for the gm_leads LEAD detail sheet redesign.
//
//   node scripts/test-gm-lead-redesign.mjs
//
// The lead sheet was the screen users actually see, and it was still the
// original flat layout: 14 identical label/value rows in one undifferentiated
// list, a unicode phone glyph for Call, and a unicode triangle for the chevron.
// Commit 5880977 had applied the approved visual language to the PARTNER sheet
// instead. This test pins the rules that are easy to silently regress:
//
//   * ONE system, not two lookalikes: the lead sheet reuses the same
//     .gm-sheet-* family the partner sheet uses (the .gm-partner-* names are
//     kept as CSS aliases). A third parallel family is the failure mode.
//   * icons are real inline SVG, never unicode glyphs or emoji
//   * the sheet is GROUPED into sections, but editing still routes through the
//     SAME gmLeadFieldDefs() indexes — presentation only, not a second
//     editing mechanism. This is the rule that breaks if anyone reorders defs.
//   * follow-up count and first-contacted are DERIVED and not tap-to-edit:
//     the follow-up row opens the contact LOG, not a number editor.
//   * partner attribution renders in its own labelled row ("who sent me this
//     lead?" is a question users actively ask)
//   * SMS/Email are gated on their own field and explain themselves when empty
//
// The real gm.js render functions are evaled and run against fabricated leads,
// so this exercises shipped code rather than restating it.
import { readFileSync } from "fs";

const js  = readFileSync(new URL("../gm.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../gm.css", import.meta.url), "utf8");

function slice(src, a, b) {
  const i = src.indexOf(a), j = src.indexOf(b, i);
  if (i < 0 || j < 0) { throw new Error("marker not found: " + a); }
  return src.slice(i, j);
}

let fails = 0;
const t = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { fails++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label +
    (ok ? "" : "\n        expected " + JSON.stringify(expected) + " got " + JSON.stringify(actual)));
};

// ── Stubs for the shared helpers the render functions call ────────────────
globalThis.escHtml = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
globalThis.gmT = (pt, _en) => pt;                       // PT is the default
globalThis.isEn = () => false;
globalThis.fmtNum = (v, kind) => kind === "currency" ? "$" + Number(v || 0).toFixed(2) : String(v);
globalThis.formatDateTime = (s) => "[ts:" + s + "]";
// Distinct marker: stored-UTC values go through the converting formatter, so a
// site that swaps one for the other shows up in this test's output.
globalThis.formatDateTimeUTC = (s) => "[tsUTC:" + s + "]";
globalThis.gmPillHtml = (label, cls) => '<span class="gm-pill ' + (cls || "") + '">' + label + "</span>";
globalThis.GM_STAGE_PILL = { "Novo Lead": "gm-gold", "Follow-up": "gm-blue", Fechado: "gm-green" };
globalThis.gmServicoList = (v) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
globalThis.gmConfig = {
  config: { servicos: ["Telhado"], vendedores: ["Ana"], cycle_months: ["Julho"] },
  method: { origens: ["Indicação"], stages: ["Novo Lead", "Follow-up", "Fechado"] }
};

// The sheet renderer writes into gmSheetOpen; capture the HTML it produces.
let sheet;
globalThis.gmSheetOpen = (title, body) => { sheet = { title, body }; };

// ── Load the real render code ─────────────────────────────────────────────
eval(slice(js, "var GM_ICONS = {", "function gmRenderPartners(") +
  "\n; Object.assign(globalThis, { GM_ICONS, gmIcon });");
eval(slice(js, "function gmWaDigits(tel)", "// ═══") +
  "\n; Object.assign(globalThis, { gmWaDigits, gmContactButtonsHtml, gmContactMoreHtml });");
eval(slice(js, "function gmDaysSince(iso)", "// ── Status pills") +
  "\n; globalThis.gmDaysSince = gmDaysSince;");
// gmRelativeAge / gmMethodIcon live in the outreach block just above the
// field defs; the sheet renderer calls them, so both blocks load together.
eval(slice(js, "var GM_CONTACT_RESULTS = [", "function gmOpenStagePicker()") +
  "\n; Object.assign(globalThis, { gmLeadFieldDefs, gmLeadFieldDisplay, gmRenderLeadSheet, " +
  "gmSheetRowHtml, gmSheetSection, gmRelativeAge, gmMethodIcon, gmMethodLabel, " +
  "GM_CONTACT_RESULTS, GM_CONTACT_METHOD_LABELS });");

const LEAD = {
  id: "l1", cliente: "Dona Maria", estagio: "Follow-up",
  stage_changed_at: new Date(Date.now() - 4 * 86400000).toISOString(),
  valor: 4200, proxima_acao: "Ligar terça",
  servico: "Telhado", vendedor: "Ana", origem: "Indicação",
  parceiro_id: "p1", parceiro_name: "Mark Alluminum",
  telefone: "(305) 555-0142", email: "maria@example.com",
  contatos_count: 3, primeiro_contato: new Date(Date.now() - 9 * 86400000).toISOString(),
  observacao: "Casa de esquina", mes_fechamento: "Julho", mes_lead: "Julho",
  data_lead: "2026-07-01", data_estimate: "2026-07-02"
};
const render = (over) => {
  globalThis.gmDetailLead = Object.assign({}, LEAD, over || {});
  gmRenderLeadSheet();
  return sheet.body;
};

// ── One system: the shared .gm-sheet-* family, no third style ─────────────
{
  const html = render();
  t("the sheet uses the shared .gm-sheet-* row family",
    html.indexOf("gm-sheet-row") >= 0, true);
  t("the sheet groups rows into .gm-sheet-group cards",
    html.indexOf("gm-sheet-group") >= 0, true);
  t("no third parallel family was invented for the lead sheet",
    /gm-lead-section|gm-leadsheet-|gm-detail-section/.test(html), false);
  t("the partner sheet's classes still resolve in CSS (one system)",
    css.indexOf(".gm-partner-row") >= 0 && css.indexOf(".gm-sheet-row") >= 0, true);
  t("the shared row rule covers BOTH families in one declaration",
    /\.gm-sheet-row,\s*\.gm-partner-row\s*\{/.test(css), true);
}

// ── No unicode glyphs anywhere in the sheet ───────────────────────────────
{
  const html = render();
  t("no unicode phone glyph", html.indexOf("☎"), -1);
  t("no unicode triangle chevron", html.indexOf("▶"), -1);
  t("no emoji in the sheet", /[\u{1F300}-\u{1FAFF}]/u.test(html), false);
  t("chevrons are real inline SVG", html.indexOf("<svg") >= 0, true);
  t("every editable row carries an SVG chevron",
    (html.match(/gm-sheet-row-chev/g) || []).length >= 8, true);
}

// ── Hero card: stage + days left, estimate value right ────────────────────
{
  const html = render();
  const hero = slice(html, "gm-sheet-hero", "gm-sheet-section");
  t("hero renders the stage pill", hero.indexOf("gm-pill") >= 0, true);
  t("hero shows days-in-stage", hero.indexOf("4 dia(s) neste estágio") >= 0, true);
  t("hero shows the estimate value with real weight",
    hero.indexOf("gm-sheet-hero-value") >= 0 && hero.indexOf("$4200.00") >= 0, true);
  t("the stage pill is still tappable to change stage",
    hero.indexOf("gmOpenStagePicker()") >= 0, true);
  t("the value is still tap-to-edit", hero.indexOf("gmEditLeadField(") >= 0, true);
}
{
  // A lead with no estimate yet says so rather than rendering an empty box.
  const hero = slice(render({ valor: null }), "gm-sheet-hero", "gm-sheet-section");
  t("an unset estimate reads 'A definir', not blank",
    hero.indexOf("A definir") >= 0, true);
  t("an unset estimate is styled as empty", hero.indexOf("gm-empty") >= 0, true);
}

// ── Grouped sections, in the specified order ──────────────────────────────
{
  const html = render();
  const titles = (html.match(/gm-sheet-section-title">([^<]*)/g) || [])
    .map((s) => s.replace(/.*">/, "").trim());
  t("sections are Next action / Contact activity / Lead details / other",
    titles, ["Próxima ação", "Atividade de contato", "Dados do lead", "Outros campos"]);
  // Anchor past the section TITLE (which repeats the same words) to the group
  // that follows it, then count rows inside that group only.
  const nextGroup = slice(html, 'gm-sheet-group">', "</div></div>");
  t("Next action is alone in its section",
    (nextGroup.match(/class="gm-sheet-row"/g) || []).length, 1);
  t("Contact activity is labelled as tracked automatically",
    html.indexOf("registrado automaticamente") >= 0, true);
}

// ── Derived fields: not tap-to-edit, and the count opens the log ──────────
{
  const html = render();
  const act = slice(html, "Atividade de contato", "Dados do lead");
  t("follow-up count shows the derived value", act.indexOf(">3<") >= 0, true);
  t("tapping follow-ups opens the contact LOG, not a number editor",
    act.indexOf("gmOpenContactLog()") >= 0, true);
  t("the follow-up row is NOT wired to a field editor",
    act.indexOf("gmEditLeadField(") , -1);
  t("first-contacted renders as an age", act.indexOf("há 9 dias") >= 0, true);
  t("first-contacted keeps the exact timestamp as secondary text",
    act.indexOf("gm-sheet-row-sub") >= 0, true);
  t("first-contacted is read-only (no chevron, not a button)",
    slice(act, "1º contato", "</div>").indexOf("gm-sheet-row-chev"), -1);
}
{
  // followups / data_contato must no longer be hand-editable anywhere, or a
  // typed number could silently disagree with the log it summarizes.
  const keys = gmLeadFieldDefs().map((d) => d.key);
  t("followups is no longer an editable field def", keys.indexOf("followups"), -1);
  t("data_contato is no longer an editable field def", keys.indexOf("data_contato"), -1);
}
{
  // Leads predating the log fall back to the legacy hand-entered timestamp
  // rather than showing an empty row.
  const act = slice(render({ contatos_count: 0, primeiro_contato: null,
    data_contato: new Date(Date.now() - 2 * 86400000).toISOString() }),
    "Atividade de contato", "Dados do lead");
  t("a legacy lead still shows its first-contact date", act.indexOf("há 2 dias") >= 0, true);
  t("a lead with no contacts shows a zero count", act.indexOf(">0<") >= 0, true);
}

// ── Editing still routes through the REAL field-def indexes ───────────────
// The rule that breaks if anyone reorders gmLeadFieldDefs(): every edit call
// in the rendered HTML must point at the def whose key it claims to show.
{
  const html = render();
  const defs = gmLeadFieldDefs();
  const byKey = {};
  defs.forEach((d, i) => { byKey[d.key] = i; });
  [["Serviço(s)", "servico"], ["Vendedor", "vendedor"], ["Origem", "origem"],
   ["Parceiro", "parceiro_id"], ["Telefone", "telefone"], ["Email", "email"],
   ["Próxima ação", "proxima_acao"]].forEach(([label, key]) => {
    // The onclick precedes the label inside the row element, so anchor on the
    // row start and read forward past the label to the end of that row.
    // Anchor on the LABEL span specifically: "Email" is also its own value,
    // and a bare ">Email<" would match the value span first.
    const at = html.indexOf('gm-sheet-row-label">' + label + "<");
    const start = html.lastIndexOf("<button", at);
    const row = html.slice(start, html.indexOf("</button>", at));
    t("'" + label + "' edits the real '" + key + "' def index",
      row.indexOf("gmEditLeadField(" + byKey[key] + ")") >= 0, true);
  });
}

// ── Partner attribution is visible, not buried ────────────────────────────
{
  const details = slice(render(), "Dados do lead", "Outros campos");
  t("the partner name renders in Lead details",
    details.indexOf("Mark Alluminum") >= 0, true);
  t("the partner row is labelled 'Parceiro'", details.indexOf("Parceiro") >= 0, true);
  t("the partner row carries its own tour key",
    details.indexOf("crm-lead-partner") >= 0, true);
}
{
  const details = slice(render({ parceiro_id: null, parceiro_name: null }),
    "Dados do lead", "Outros campos");
  t("a lead with no partner still shows the row as fillable",
    details.indexOf("Toque para preencher") >= 0, true);
}

// ── Contact actions: SVG icons, and the SMS/Email disclosure ──────────────
{
  const html = gmContactButtonsHtml("(305) 555-0142");
  t("Call uses an SVG icon, not a glyph", html.indexOf("<svg") >= 0, true);
  t("Call still launches a tel: link", html.indexOf('href="tel:') >= 0, true);
  t("WhatsApp still launches wa.me with the country code",
    html.indexOf("wa.me/13055550142") >= 0, true);
}
{
  const more = gmContactMoreHtml("(305) 555-0142", "maria@example.com");
  t("the disclosure ships collapsed", more.indexOf("hidden") >= 0, true);
  t("the disclosure is aria-expanded=false by default",
    more.indexOf('aria-expanded="false"') >= 0, true);
  t("SMS uses an sms: link", more.indexOf('href="sms:3055550142"') >= 0, true);
  t("Email uses a mailto: link", more.indexOf('href="mailto:maria@example.com"') >= 0, true);
  t("SMS pre-selects Method 'Text message'",
    more.indexOf("gmLogOutreach('Text message')") >= 0, true);
  t("Email pre-selects Method 'Email'",
    more.indexOf("gmLogOutreach('Email')") >= 0, true);
  t("neither secondary button is disabled when both fields are filled",
    more.indexOf('aria-disabled="true"'), -1);
  t("secondary icons are real SVG", (more.match(/<svg/g) || []).length >= 3, true);
}
{
  // Each channel is gated on ITS OWN field — a phone must not enable Email.
  const more = gmContactMoreHtml("3055550142", null);
  t("a phone alone leaves exactly one channel disabled",
    (more.match(/aria-disabled="true"/g) || []).length, 1);
  t("the empty Email button explains itself rather than looking dead",
    more.indexOf("Nenhum email cadastrado") >= 0, true);
  t("the empty Email button is styled as a reason, not a label",
    more.indexOf("gm-reason") >= 0, true);
}
{
  const more = gmContactMoreHtml(null, null);
  t("with nothing on file both channels are disabled",
    (more.match(/aria-disabled="true"/g) || []).length, 2);
  t("the empty SMS button explains itself",
    more.indexOf("Nenhum telefone cadastrado") >= 0, true);
}

// ── Every field still reachable: nothing silently dropped ─────────────────
{
  const html = render();
  const defs = gmLeadFieldDefs();
  const missing = defs.filter((d, i) => html.indexOf("gmEditLeadField(" + i + ")") < 0)
    .map((d) => d.key);
  t("every editable field def is reachable somewhere on the sheet", missing, []);
  t("the delete action survives the redesign", html.indexOf("gmDeleteLead()") >= 0, true);
}

console.log(fails === 0 ? "\nAll checks passed." : "\n" + fails + " check(s) FAILED.");
process.exit(fails === 0 ? 0 : 1);
