// Structural check for the gm_leads Partner tab redesign.
//
//   node scripts/test-gm-partner-redesign.mjs
//
// The Partner tab had no CSS of its own — it reused the generic .gm-row /
// .gm-lead-* classes shared by every other tab, which is exactly the flat,
// undifferentiated look the lead-detail redesign already fixed. The rules that
// are easy to silently regress:
//
//   * the two numbers that matter (referrals sent, revenue generated) are
//     rendered with real visual weight, not buried in .gm-lead-sub subtext
//   * icons are real inline SVG, never unicode glyphs or emoji
//   * the detail sheet is GROUPED into sections, but editing still routes
//     through the SAME gmEditSimpleField indexes the generic sheet uses —
//     the redesign is presentation only, not a second editing mechanism
//   * the referral block keeps all four actions (copy/share/QR/download)
//
// The real gm.js render functions are evaled and run against fabricated
// partner rows, so this exercises shipped code rather than restating it.
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
globalThis.fmtNum = (v, kind) => kind === "currency" ? "$" + Number(v || 0).toFixed(2) : String(v);
globalThis.formatDate = (s) => s;
globalThis.gmPillHtml = (label, cls) => '<span class="gm-pill ' + (cls || "") + '">' + label + "</span>";
globalThis.GM_STATUS_PILLS = { partner: { Ativo: "gm-green", Prospectando: "gm-gold", Inativo: "gm-muted" } };
globalThis.gmQrSvg = () => "<svg data-qr></svg>";
globalThis.gmConfig = { config: { partner_types: ["Fornecedor", "Indicador"] }, method: { partner_statuses: ["Prospectando", "Ativo", "Inativo"] } };
globalThis.gmPartnersData = { partners: [] };
// gmSimpleSpec() references every tab's reload fn by identity; only the
// partner branch is under test, so the rest just need to exist.
["gmLoadPartners", "gmLoadRoadmap", "gmLoadBase", "gmLoadFinance", "gmLoadJobs"]
  .forEach((n) => { globalThis[n] = () => {}; });
globalThis.gmRoadmapData = { items: [] };
globalThis.gmBaseData    = { items: [] };
globalThis.gmFinanceData = { entries: [] };
globalThis.gmJobsData    = { jobs: [] };

// ── Load the real render code ─────────────────────────────────────────────
eval(slice(js, "var GM_ICONS = {", "function gmOpenPartner(") +
  "\n; Object.assign(globalThis, { GM_ICONS, gmIcon, gmRenderPartners });");
eval(slice(js, "function gmSimpleSpec(kind)", "var gmSheetKind = null;") +
  "\n; Object.assign(globalThis, { gmSimpleSpec, gmSimpleFieldDisplay });");
eval(slice(js, "function gmPartnerRowHtml(", "function gmRenderSimpleSheet(") +
  "\n; Object.assign(globalThis, { gmPartnerRowHtml, gmPartnerSheetBody });");
globalThis.window = { location: { origin: "https://apex.example" } };
eval(slice(js, "function gmReferralUrl(", "function gmCopyReferralLink()") +
  "\n; Object.assign(globalThis, { gmReferralUrl, gmPartnerReferralHtml });");

// ── Partner list ──────────────────────────────────────────────────────────
const partners = [
  { name: "Mark Aluminum", tipo: "Fornecedor", contato: "(505) 555-0100", status: "Ativo",
    leads_indicados: 7, receita_gerada: 22759.42, ultima_interacao: "2026-07-20",
    proxima_acao: "Enviar catálogo", referral_slug: "abcdefghij" },
  { name: "Novo Parceiro", tipo: null, contato: null, status: "Prospectando",
    leads_indicados: 0, receita_gerada: 0, ultima_interacao: null, proxima_acao: null, referral_slug: null }
];
globalThis.gmPartnersData = { partners: partners };

let listEl = { innerHTML: "" };
globalThis.document = { getElementById: () => listEl };
gmRenderPartners();
const list = listEl.innerHTML;

t("partner list renders cards, not generic .gm-row", /class="gm-partner-card"/.test(list), true);
t("partner list no longer uses the shared flat row class", /class="gm-row"/.test(list), false);
t("referral count gets the hero stat treatment",
  /gm-partner-stat-value[^>]*>7</.test(list), true);
t("revenue gets the hero stat treatment",
  /gm-partner-stat-value[^>]*>\$22759\.42</.test(list), true);
t("the two numbers are NOT buried in .gm-lead-sub subtext",
  /gm-lead-sub/.test(list), false);
t("a zero-referral partner reads muted rather than shouting",
  /gm-partner-stat-value gm-partner-zero">0</.test(list), true);
t("status pill still shown per partner", (list.match(/gm-pill/g) || []).length, 2);
t("card still opens the detail sheet", /onclick="gmOpenPartner\(0\)"/.test(list), true);

// ── Partner detail sheet ──────────────────────────────────────────────────
const spec = gmSimpleSpec("partner");
const sheet = gmPartnerSheetBody(partners[0], spec);

t("detail sheet is grouped into sections", (sheet.match(/gm-partner-section-title/g) || []).length, 3);
t("sections are Contact / Activity / Next step",
  (sheet.match(/gm-partner-section-title">([^<]+)/g) || []).map((s) => s.split(">")[1]),
  ["Contato", "Atividade", "Próximo passo"]);
t("rows carry real inline SVG icons", /<svg viewBox="0 0 24 24"/.test(sheet), true);
t("icons are not unicode glyphs or emoji",
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(sheet.replace(/&#9654;/g, "")), false);

// Editing must still route through the SAME spec indexes the generic sheet
// uses — this is the rule that breaks if someone reorders spec.fields.
const idx = {};
spec.fields.forEach((d, i) => { idx[d.key] = i; });
["name", "contato", "tipo", "status", "ultima_interacao", "proxima_acao"].forEach((key) => {
  t("edit row for '" + key + "' targets its real spec index",
    sheet.includes('gmEditSimpleField(' + idx[key] + ')'), true);
});
t("derived numbers are NOT tap-to-edit",
  /Leads indicados<\/span><span class="gm-partner-row-value[^"]*">7/.test(sheet.replace(/\n/g, "")), true);
t("referral count appears in Activity", /Leads indicados/.test(sheet), true);
t("revenue appears in Activity", /Receita gerada/.test(sheet), true);
t("next action is editable", sheet.includes("Próxima ação"), true);

// An empty partner shows the tap-to-fill affordance rather than blank rows.
const emptySheet = gmPartnerSheetBody(partners[1], spec);
t("empty fields show the tap-to-fill prompt",
  (emptySheet.match(/Toque para preencher/g) || []).length >= 3, true);

// ── Referral block: restyled, functionally intact ─────────────────────────
const ref = gmPartnerReferralHtml(partners[0]);
t("referral block keeps Copy", /gmCopyReferralLink\(\)/.test(ref), true);
t("referral block keeps Share", /gmShareReferralLink\(\)/.test(ref), true);
t("referral block keeps QR download", /gmDownloadReferralQr\(\)/.test(ref), true);
t("referral block still renders the QR", /data-qr/.test(ref), true);
t("referral buttons carry icons, not plain text", (ref.match(/<svg viewBox="0 0 24 24"/g) || []).length, 3);
t("referral block adopts the partner card family", /gm-partner-group/.test(ref), true);
t("referral URL element id preserved for copy/download", /id="gmRefUrl"/.test(ref), true);
t("QR box id preserved for the PNG export", /id="gmRefQrBox"/.test(ref), true);
t("a partner with no slug renders no referral block", gmPartnerReferralHtml(partners[1]), "");

// ── CSS family exists ─────────────────────────────────────────────────────
[".gm-partner-card", ".gm-partner-stats", ".gm-partner-stat-value", ".gm-partner-section",
 ".gm-partner-group", ".gm-partner-row", ".gm-partner-row-icon", ".gm-partner-ref-btn"].forEach((sel) => {
  t("gm.css defines " + sel, css.includes(sel + " ") || css.includes(sel + ","), true);
});

console.log(fails ? "\n" + fails + " FAILED" : "\nAll checks passed.");
process.exit(fails ? 1 : 0);
