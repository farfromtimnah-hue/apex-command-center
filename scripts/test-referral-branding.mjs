// Behavioral check for referral.html's per-client language + branding.
//
//   node scripts/test-referral-branding.mjs
//
// referral.html is PUBLIC and deliberately dependency-free ("must never grow a
// dependency on authenticated code"), so every one of these settings reaches it
// through the single GET /api/referral/:slug response. The rules worth pinning:
//
//   * null columns fall back to Apex's LITERAL palette (#1a1a1d / #C9A43A) —
//     not a generic guess, and resolved server-side in one place
//   * a stored value that is not a 6-digit hex is treated as unset, never
//     handed to the page as a broken color
//   * language only sets the STARTING body class; the manual toggle survives
//   * no logo -> business name as text, and Apex's own mark is NEVER
//     substituted (this is the client's own branded page)
//
// The real handler and the real page functions are evaled, so this exercises
// shipped code rather than restating it.
import { readFileSync } from "fs";

const worker   = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
const referral = readFileSync(new URL("../referral.html", import.meta.url), "utf8");

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

// ── Load the real Worker logic ────────────────────────────────────────────
globalThis.jsonOk  = (o) => ({ ok: true, body: o });
globalThis.jsonErr = (m, code) => ({ ok: false, error: m, status: code });
globalThis.gmGetConfig = async () => ({ servicos: ["Pavers", "Turf"] });

eval(slice(worker, "function gmReferralSlugValid(", "async function handlePostReferralLead(")
  .replace(/^async function handleGetReferralInfo[\s\S]*$/m, (s) => s) +
  "\n; Object.assign(globalThis, { referralHexOrNull, handleGetReferralInfo, gmPartnerBySlug," +
  " REFERRAL_DEFAULT_BG, REFERRAL_DEFAULT_TEXT });");

const req = { url: "https://apex-api.example/api/referral/abcdefghij" };
const envFor = (partnerRow) => ({
  DB: { prepare: () => ({ bind: () => ({ first: async () => partnerRow }) }) }
});
const base = {
  id: "p1", client_id: "c1", name: "Mark Aluminum", business_name: "LIRA Landscaping",
  language: null, referral_bg_color: null, referral_text_color: null, logo_url: null
};

// ── Fallback to Apex's literal palette when columns are null ──────────────
{
  const r = await handleGetReferralInfo("abcdefghij", req, envFor(base));
  t("null bg falls back to Apex --header", r.body.referral_bg_color, "#1a1a1d");
  t("null accent falls back to Apex --gold", r.body.referral_text_color, "#C9A43A");
  t("fallbacks are the named constants, not duplicated literals",
    [REFERRAL_DEFAULT_BG, REFERRAL_DEFAULT_TEXT], ["#1a1a1d", "#C9A43A"]);
  t("null language starts the page in PT", r.body.language, "pt");
  t("no logo reports has_logo false", r.body.has_logo, false);
  t("no logo sends no URL", r.body.logo_url, null);
  t("existing fields still returned", r.body.business_name, "LIRA Landscaping");
  t("partner first name only", r.body.partner_name, "Mark");
  t("services still returned", r.body.servicos, ["Pavers", "Turf"]);
}

// ── A client's own branding wins ──────────────────────────────────────────
{
  const r = await handleGetReferralInfo("abcdefghij", req, envFor(Object.assign({}, base, {
    language: "en", referral_bg_color: "#0b3d2e", referral_text_color: "#e0b64c",
    logo_url: "logos/c1.png"
  })));
  t("client bg color is used", r.body.referral_bg_color, "#0b3d2e");
  t("client accent color is used", r.body.referral_text_color, "#e0b64c");
  t("client language 'en' is honored", r.body.language, "en");
  t("logo presence reported", r.body.has_logo, true);
  t("logo served through the EXISTING logo-image route",
    r.body.logo_url, "https://apex-api.example/api/clients/c1/logo-image");
  t("no raw R2 key is ever exposed publicly", /logos\//.test(r.body.logo_url), false);
}

// ── Garbage in a column is treated as unset, never passed through ─────────
{
  const r = await handleGetReferralInfo("abcdefghij", req, envFor(Object.assign({}, base, {
    referral_bg_color: "red", referral_text_color: "#GGGGGG", language: "fr"
  })));
  t("a non-hex bg falls back rather than breaking the page", r.body.referral_bg_color, "#1a1a1d");
  t("an invalid hex accent falls back", r.body.referral_text_color, "#C9A43A");
  t("an unknown language falls back to PT", r.body.language, "pt");
}
t("hex validator accepts 6-digit hex", referralHexOrNull("#1A2b3C"), "#1A2b3C");
t("hex validator rejects 3-digit shorthand", referralHexOrNull("#abc"), null);
t("hex validator rejects a missing hash", referralHexOrNull("1a1a1d"), null);
t("hex validator rejects empty", referralHexOrNull(""), null);

// ── Unknown slug still 404s ───────────────────────────────────────────────
{
  const r = await handleGetReferralInfo("abcdefghij", req, envFor(null));
  t("unknown slug returns 404", r.status, 404);
}

// ── The page applies it correctly ─────────────────────────────────────────
const styleSet = [];
const el = { className: "logo", style: {}, onload: null, onerror: null, alt: "", src: "" };
globalThis.document = {
  body: {
    classList: {
      _c: new Set(["lang-pt"]),
      add(...v) { v.forEach((x) => this._c.add(x)); },
      remove(...v) { v.forEach((x) => this._c.delete(x)); },
      contains(v) { return this._c.has(v); }
    }
  },
  documentElement: { style: { setProperty: (k, v) => styleSet.push([k, v]) } },
  getElementById: () => el
};

eval(slice(referral, "function applyLanguage(lang)", "function showCard(id)") +
  "\n; Object.assign(globalThis, { applyLanguage, applyBranding });");

applyLanguage("en");
t("page opens in EN when the client set 'en'", document.body.classList.contains("lang-en"), true);
applyLanguage(null);
t("page opens in PT when language is null", document.body.classList.contains("lang-pt"), true);
applyLanguage("es");
t("an unexpected language still opens in PT", document.body.classList.contains("lang-pt"), true);
t("the two language classes are mutually exclusive",
  document.body.classList.contains("lang-en"), false);

styleSet.length = 0;
applyBranding({ referral_bg_color: "#0b3d2e", referral_text_color: "#e0b64c", has_logo: false });
t("valid colors become CSS custom properties",
  styleSet, [["--brand-bg", "#0b3d2e"], ["--brand-accent", "#e0b64c"]]);

styleSet.length = 0;
applyBranding({ referral_bg_color: "javascript:alert(1)", referral_text_color: null, has_logo: false });
t("the page re-validates and drops anything non-hex", styleSet, []);

el.className = "logo"; el.src = "";
applyBranding({ referral_bg_color: null, referral_text_color: null, has_logo: false, logo_url: null });
t("no logo leaves the img hidden", el.className, "logo");
t("no logo sets no src (no broken-image request)", el.src, "");

applyBranding({ has_logo: true, logo_url: "https://api.example/api/clients/c1/logo-image", business_name: "LIRA" });
t("a logo is requested when one exists", el.src, "https://api.example/api/clients/c1/logo-image");
t("the logo only becomes visible after it actually loads", el.className, "logo");
el.onload();
t("a loaded logo is shown", el.className, "logo on");
el.onerror();
t("a failed logo stays hidden rather than showing a broken icon", el.className, "logo");

// ── The page stays dependency-free ────────────────────────────────────────
t("referral.html pulls in no external script", /<script[^>]+src=/.test(referral), false);
t("referral.html pulls in no external stylesheet", /<link[^>]+stylesheet/.test(referral), false);
t("the manual language toggle still exists", /function toggleLang\(\)/.test(referral), true);
t("the toggle button is still in the markup", /onclick="toggleLang\(\)"/.test(referral), true);
t("Apex's palette remains the CSS-level default",
  /--brand-bg: var\(--ink\)/.test(referral) && /--brand-accent: var\(--gold\)/.test(referral), true);
t("Apex's literal fallback values are still present",
  /--gold: #C9A43A/.test(referral) && /--ink: #1a1a1d/.test(referral), true);

console.log(fails ? "\n" + fails + " FAILED" : "\nAll checks passed.");
process.exit(fails ? 1 : 0);
