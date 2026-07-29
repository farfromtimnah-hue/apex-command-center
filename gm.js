// APEX Growth Management — Part 1: the six data tabs (CRM pipeline, Metas &
// Execução, Base de Ouro, Parceiros, Financeiro, Obras & Margem) inside the
// client portal. Loaded by portal.html AFTER its inline script; uses its
// globals: apiFetch, escHtml, isEn, fmtNum, clientId, and datetime.js's
// formatDate/formatTime/formatDateTime.
//
// The leads here are the CLIENT's own customers — one tier below the app's
// clients table, unrelated to clients.status = 'lead'.
//
// Function is the spreadsheet's, verbatim (stages, dropdowns, formulas);
// only the UI is reimagined for phones. Fixed method rules (8 stages, the
// 3-stage pipeline-ativo, tipo-from-categoria) arrive from the Worker via
// GET gm/config so there is one source of truth.

var gmConfig      = null;   // { config, method } from GET gm/config
var gmConfigPromise = null;
var gmLeadsData   = null;   // { leads, summary }
var gmPartnersData = null;  // { partners }
var gmRoadmapData = null;
var gmBaseData    = null;
var gmFinanceData = null;
var gmJobsData    = null;
var gmActiveStage = null;   // chip-rail filter (null = first stage)
var gmCurrentTab  = null;   // which gm tab is on screen (lang re-render)

function gmT(pt, en) { return isEn() ? en : pt; }

function gmApi(path, opts) {
  return apiFetch("/api/clients/" + clientId + "/gm/" + path, opts)
    .then(function(res) {
      return res.json().then(function(d) {
        if (!res.ok) { throw new Error(d.error || ("HTTP " + res.status)); }
        return d;
      });
    });
}

function gmLoadConfig() {
  if (gmConfig) { return Promise.resolve(gmConfig); }
  if (!gmConfigPromise) {
    gmConfigPromise = gmApi("config").then(function(d) { gmConfig = d; return d; })
      .catch(function(e) { gmConfigPromise = null; throw e; });
  }
  return gmConfigPromise;
}

// "1.234,56" / "1,234.56" / "$1234" → 1234.56 (Portuguese comma-decimal
// keyboards are the whole reason these inputs are text+inputmode=decimal).
function gmParseMoney(s) {
  if (s === null || s === undefined) { return null; }
  var t = String(s).replace(/[$\s]/g, "");
  if (!t) { return null; }
  if (t.indexOf(",") !== -1 && t.indexOf(".") === -1) {
    t = t.replace(/\./g, "").replace(",", ".");
  } else if (t.indexOf(",") !== -1 && t.indexOf(".") !== -1) {
    if (t.lastIndexOf(",") > t.lastIndexOf(".")) {
      t = t.replace(/\./g, "").replace(",", ".");
    } else {
      t = t.replace(/,/g, "");
    }
  }
  var n = Number(t);
  return isFinite(n) ? n : null;
}

function gmNowLocalIso() {
  var d = new Date();
  function p2(n) { return String(n).padStart(2, "0"); }
  return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()) +
    "T" + p2(d.getHours()) + ":" + p2(d.getMinutes());
}

function gmTodayLocal() { return gmNowLocalIso().slice(0, 10); }

var GM_MONTH_NAMES_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
function gmCurrentCycleMonth() {
  var name = GM_MONTH_NAMES_PT[new Date().getMonth()];
  var months = (gmConfig && gmConfig.config.cycle_months) || [];
  return months.indexOf(name) !== -1 ? name : null;
}

// Days since an ISO datetime (UTC "YYYY-MM-DD HH:MM:SS" from D1).
function gmDaysSince(iso) {
  if (!iso) { return null; }
  var s = String(iso).replace(" ", "T");
  if (!/[Zz]|[+-]\d\d:?\d\d$/.test(s)) { s += "Z"; }
  var t = Date.parse(s);
  if (isNaN(t)) { return null; }
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

// ── Status pills: colour + glyph + word, never colour alone ─────────────
var GM_STAGE_PILL = {
  "Novo Lead":        { band: "gm-gold",  glyph: "●" },
  "Contato Feito":    { band: "gm-gold",  glyph: "●" },
  "Visita Agendada":  { band: "gm-gold",  glyph: "●" },
  "Estimate Enviado": { band: "gm-gold",  glyph: "◆" },
  "Follow-up":        { band: "gm-gold",  glyph: "◆" },
  "Negociação":       { band: "gm-gold",  glyph: "◆" },
  "Fechado":          { band: "gm-green", glyph: "✓" },
  "Perdido":          { band: "gm-red",   glyph: "✕" }
};
var GM_STATUS_PILLS = {
  roadmap: {
    "Realizado":    { band: "gm-green", glyph: "✓" },
    "Em andamento": { band: "gm-gold",  glyph: "●" },
    "Pendente":     { band: "gm-muted", glyph: "○" },
    "Atrasado":     { band: "gm-red",   glyph: "!" },
    "Cancelado":    { band: "gm-muted", glyph: "✕" }
  },
  base: {
    "Não contatado": { band: "gm-muted", glyph: "○" },
    "Contatado":     { band: "gm-gold",  glyph: "●" },
    "Interessado":   { band: "gm-gold",  glyph: "▲" },
    "Reativado":     { band: "gm-green", glyph: "✓" },
    "Sem interesse": { band: "gm-red",   glyph: "✕" }
  },
  partner: {
    "Prospectando": { band: "gm-gold",  glyph: "●" },
    "Ativo":        { band: "gm-green", glyph: "✓" },
    "Inativo":      { band: "gm-muted", glyph: "○" }
  },
  job: {
    "Em andamento": { band: "gm-gold",  glyph: "●" },
    "Concluída":    { band: "gm-green", glyph: "✓" },
    "Atrasada":     { band: "gm-red",   glyph: "!" },
    "Pausada":      { band: "gm-muted", glyph: "○" }
  }
};

// Portuguese status words are the spreadsheet's own vocabulary; the EN
// toggle is a developer QA aid, so statuses stay PT in both languages.
function gmPillHtml(word, def) {
  var d = def || { band: "gm-muted", glyph: "○" };
  return '<span class="gm-pill ' + d.band + '">' + d.glyph + ' ' + escHtml(word) + '</span>';
}

// ── Bottom-sheet framework ───────────────────────────────────────────────
// Always a visible ✕; a history entry so the Back gesture dismisses too.
var gmSheetEl = null;
var gmSheetHistoryArmed = false;

function gmSheetOpen(titleHtml, bodyHtml, tourKey) {
  gmSheetCloseNow();
  var overlay = document.createElement("div");
  overlay.className = "gm-sheet-overlay";
  overlay.innerHTML =
    '<div class="gm-sheet"' + (tourKey ? ' data-tour="' + tourKey + '"' : '') + '>' +
    '<div class="gm-sheet-grabber"></div>' +
    '<div class="gm-sheet-head">' +
    '<div class="gm-sheet-title">' + titleHtml + '</div>' +
    '<button type="button" class="gm-sheet-close" aria-label="' + gmT("Fechar", "Close") + '" onclick="gmSheetClose()">&#10005;</button>' +
    '</div>' +
    '<div class="gm-sheet-body">' + bodyHtml + '</div>' +
    '</div>';
  overlay.addEventListener("click", function(ev) {
    if (ev.target === overlay) { gmSheetClose(); }
  });
  document.body.appendChild(overlay);
  gmSheetEl = overlay;
  if (!gmSheetHistoryArmed) {
    history.pushState({ gmSheet: true }, "");
    gmSheetHistoryArmed = true;
  }
}

function gmSheetCloseNow() {
  if (gmSheetEl && gmSheetEl.parentNode) { gmSheetEl.parentNode.removeChild(gmSheetEl); }
  gmSheetEl = null;
}

function gmSheetClose() {
  gmSheetCloseNow();
  if (gmSheetHistoryArmed) {
    gmSheetHistoryArmed = false;
    history.back();   // consume the sheet's history entry
  }
}

window.addEventListener("popstate", function() {
  if (gmSheetHistoryArmed) {
    gmSheetHistoryArmed = false;
    gmSheetCloseNow();
  }
});

// Escape closes the topmost open layer — registered once here rather than
// wired per sheet, so anything opened later inherits it for free. gm.js is
// shared by portal.html, client.html and clients.html, so each layer is
// probed defensively: a page that lacks one simply falls through.
//
// Order matches the z-index stack, closing only ONE layer per press:
//   .support-overlay (1100) → .gm-sheet-overlay (1000) → .modal-overlay (100)
document.addEventListener("keydown", function(ev) {
  if (ev.key !== "Escape" || ev.defaultPrevented) { return; }

  // Support modal — highest layer. Its own overlay, closed via supportClose().
  var support = document.getElementById("supportModal");
  if (support && !support.hidden) {
    if (typeof supportClose === "function") { supportClose(); }
    else { support.hidden = true; }
    ev.preventDefault();
    return;
  }

  // GM bottom sheet. gmSheetClose() also unwinds the history entry it pushed,
  // so Escape and the Back gesture leave identical state.
  if (gmSheetEl) {
    gmSheetClose();
    ev.preventDefault();
    return;
  }

  // Generic .modal-overlay boxes (day-off, and any future one). Last visible
  // wins: later in document order sits on top when z-index ties.
  var overlays = document.querySelectorAll(".modal-overlay:not([hidden])");
  if (overlays.length) {
    overlays[overlays.length - 1].hidden = true;
    ev.preventDefault();
  }
});

// ── Toast / snackbar ─────────────────────────────────────────────────────
var gmToastEl = null, gmToastTimer = null, gmToastAction = null;

function gmToast(msg, actionLabel, actionFn) {
  if (gmToastEl && gmToastEl.parentNode) { gmToastEl.parentNode.removeChild(gmToastEl); }
  if (gmToastTimer) { clearTimeout(gmToastTimer); }
  gmToastAction = actionFn || null;
  var el = document.createElement("div");
  el.className = "gm-toast";
  el.innerHTML = '<span>' + escHtml(msg) + '</span>' +
    (actionLabel ? '<button type="button" onclick="gmToastRunAction()">' + escHtml(actionLabel) + '</button>' : '');
  document.body.appendChild(el);
  gmToastEl = el;
  gmToastTimer = setTimeout(function() {
    if (gmToastEl && gmToastEl.parentNode) { gmToastEl.parentNode.removeChild(gmToastEl); }
    gmToastEl = null;
  }, 5000);
}

function gmToastRunAction() {
  var fn = gmToastAction;
  gmToastAction = null;
  if (gmToastEl && gmToastEl.parentNode) { gmToastEl.parentNode.removeChild(gmToastEl); }
  gmToastEl = null;
  if (fn) { fn(); }
}

// ── Shared single-field editor ───────────────────────────────────────────
// Progressive disclosure: tap a field row → a sheet with that ONE input.
// type: text | textarea | tel | currency | number | date | datetime | choice
// choice with ≤5 options renders big chips; >5 renders a native <select>.
var gmEditorSave = null;
var gmEditorChoiceValue;
var gmEditorMultiValue = [];

// servico holds one or MORE services as one comma-separated TEXT value
// ("Pavers, Lighting"). A pre-multi-select lead with a single value is just
// a one-item list — same parser everywhere.
function gmServicoList(v) {
  if (v === null || v === undefined || v === "") { return []; }
  var out = [];
  String(v).split(",").forEach(function(part) {
    var t = part.trim();
    if (t) { out.push(t); }
  });
  return out;
}

function gmOpenFieldEditor(label, type, value, options, onSave, extraNoteHtml) {
  gmEditorSave = onSave;
  var inner = "";
  if (type === "multichoice") {
    // Independent toggle chips — several can be active at once (servico).
    gmEditorMultiValue = gmServicoList(value);
    inner = '<div class="gm-chip-set" id="gmEditorChips">';
    options.forEach(function(opt, i) {
      inner += '<button type="button" class="gm-choice-chip' + (gmEditorMultiValue.indexOf(opt) !== -1 ? " gm-chip-sel" : "") +
        '" data-opt-idx="' + i + '" onclick="gmEditorToggleChip(this)">' + escHtml(opt) + '</button>';
    });
    inner += '</div>';
  } else if (type === "choice") {
    gmEditorChoiceValue = (value === null || value === undefined) ? null : value;
    if ((options || []).length <= 5) {
      inner = '<div class="gm-chip-set" id="gmEditorChips">';
      options.forEach(function(opt, i) {
        inner += '<button type="button" class="gm-choice-chip' + (opt === value ? " gm-chip-sel" : "") +
          '" data-opt-idx="' + i + '" onclick="gmEditorPickChip(this)">' + escHtml(opt) + '</button>';
      });
      inner += '</div>';
    } else {
      inner = '<select id="gmEditorInput"><option value="">—</option>';
      options.forEach(function(opt) {
        inner += '<option value="' + escHtml(opt) + '"' + (opt === value ? " selected" : "") + '>' + escHtml(opt) + '</option>';
      });
      inner += '</select>';
    }
  } else if (type === "textarea") {
    inner = '<textarea id="gmEditorInput">' + escHtml(value === null || value === undefined ? "" : String(value)) + '</textarea>';
  } else {
    var inputType = "text", inputMode = "";
    if (type === "tel") { inputType = "tel"; }
    if (type === "date") { inputType = "date"; }               // native OS picker
    if (type === "datetime") { inputType = "datetime-local"; } // native OS picker
    if (type === "currency") { inputMode = ' inputmode="decimal"'; }   // NOT type=number: surfaces the locale decimal comma
    if (type === "number") { inputMode = ' inputmode="numeric"'; }
    var v = (value === null || value === undefined) ? "" : String(value);
    if (type === "datetime" && v) { v = v.replace(" ", "T").slice(0, 16); }
    if (type === "date" && v) { v = v.slice(0, 10); }
    inner = '<input type="' + inputType + '"' + inputMode + ' id="gmEditorInput" value="' + escHtml(v) + '">';
  }
  var body = '<div class="gm-editor-input" data-gm-type="' + type + '">' + inner + '</div>' +
    (extraNoteHtml || "") +
    '<div class="gm-editor-actions">' +
    '<button type="button" class="btn-outline" onclick="gmSheetClose()">' + gmT("Cancelar", "Cancel") + '</button>' +
    '<button type="button" class="btn-gold" onclick="gmEditorCommit(\'' + type + '\')">' + gmT("Salvar", "Save") + '</button>' +
    '</div>';
  gmSheetOpen(escHtml(label), body, "gm-field-editor");
  var input = document.getElementById("gmEditorInput");
  if (input && type !== "date" && type !== "datetime" && input.tagName !== "SELECT") {
    input.focus();
  }
}

function gmEditorPickChip(btn) {
  var chips = document.getElementById("gmEditorChips");
  var idx = Number(btn.getAttribute("data-opt-idx"));
  var already = btn.classList.contains("gm-chip-sel");
  chips.querySelectorAll(".gm-choice-chip").forEach(function(c) { c.classList.remove("gm-chip-sel"); });
  if (already) {
    gmEditorChoiceValue = null;   // tap again to clear
  } else {
    btn.classList.add("gm-chip-sel");
    gmEditorChoiceValue = btn.textContent;
  }
}

function gmEditorToggleChip(btn) {
  var opt = btn.textContent;
  var pos = gmEditorMultiValue.indexOf(opt);
  if (pos === -1) {
    gmEditorMultiValue.push(opt);
    btn.classList.add("gm-chip-sel");
  } else {
    gmEditorMultiValue.splice(pos, 1);
    btn.classList.remove("gm-chip-sel");
  }
}

function gmEditorCommit(type) {
  var value = null;
  if (type === "multichoice") {
    value = gmEditorMultiValue.length ? gmEditorMultiValue.join(", ") : null;
  } else if (type === "choice") {
    var sel = document.getElementById("gmEditorInput");
    if (sel) { value = sel.value || null; }
    else { value = gmEditorChoiceValue || null; }
  } else {
    var input = document.getElementById("gmEditorInput");
    var raw = input ? input.value : "";
    if (type === "currency") {
      value = gmParseMoney(raw);
      if (raw !== "" && value === null) {
        window.alert(gmT("Valor inválido — use números, ex.: 4.500,00", "Invalid value — numbers only, e.g. 4500.00"));
        return;
      }
    } else if (type === "number") {
      value = raw === "" ? null : Math.round(Number(raw));
      if (raw !== "" && !isFinite(value)) { window.alert(gmT("Número inválido", "Invalid number")); return; }
    } else {
      value = raw.trim() === "" ? null : raw.trim();
    }
  }
  var fn = gmEditorSave;
  gmEditorSave = null;
  gmSheetClose();
  if (fn) { fn(value); }
}

function gmFieldRowHtml(label, valueHtml, onclickJs, tourKey) {
  return '<button type="button" class="gm-field-row"' +
    (tourKey ? ' data-tour="' + tourKey + '"' : '') +
    ' onclick="' + onclickJs + '">' +
    '<span style="min-width:0;flex:1;"><span class="gm-field-label">' + label + '</span>' +
    '<div class="gm-field-value' + (valueHtml ? "" : " gm-empty") + '">' +
    (valueHtml || gmT("Toque para preencher", "Tap to fill in")) + '</div></span>' +
    '<span class="gm-field-chev">&#9654;</span></button>';
}

function gmWaDigits(tel) {
  var digits = String(tel || "").replace(/\D/g, "");
  if (digits.length === 10) { digits = "1" + digits; }   // US default
  return digits;
}

function gmContactButtonsHtml(tel) {
  var digits = gmWaDigits(tel);
  var dis = tel ? "" : ' aria-disabled="true"';
  return '<div class="gm-contact-row" data-tour="crm-detail-contact">' +
    '<a class="gm-contact-btn gm-call"' + dis + ' href="tel:' + escHtml(tel || "") + '"' +
      ' onclick="gmLogOutreach(\'Phone call\')">' +
      gmIcon("phone") + gmT("Ligar", "Call") + '</a>' +
    '<a class="gm-contact-btn gm-wa"' + dis + ' href="https://wa.me/' + digits + '" target="_blank" rel="noopener"' +
      ' onclick="gmLogOutreach(\'WhatsApp\')">' +
      gmIcon("wa") + 'WhatsApp</a>' +
    '</div>';
}

// SMS and Email: the rarer channels, collapsed under Call/WhatsApp so they do
// not compete with the two primary buttons. Same disclosure the Apex-internal
// Contact Log uses (.cl-contact-more in client.html) — both sides of the app
// behave identically.
//
// A channel with nothing on file does NOT render a dead-looking button: the
// label becomes the reason, because an unexplained greyed control reads as a
// bug rather than as missing data.
function gmContactMoreHtml(tel, email) {
  var smsDis = tel ? "" : ' aria-disabled="true"';
  var mailDis = email ? "" : ' aria-disabled="true"';
  return '<div class="gm-contact-more">' +
    '<button type="button" class="gm-contact-more-btn" id="gmContactMoreBtn" ' +
      'aria-expanded="false" aria-controls="gmContactMorePanel" onclick="gmToggleContactMore()">' +
      gmIcon("chevron") + gmT("Mais formas de contato", "More ways to reach out") + '</button>' +
    '<div class="gm-contact-more-panel" id="gmContactMorePanel" hidden>' +
      '<a class="gm-contact-btn gm-sms' + (tel ? "" : " gm-reason") + '"' + smsDis +
        ' href="sms:' + escHtml(String(tel || "").replace(/[^\d+]/g, "")) + '" onclick="gmLogOutreach(\'Text message\')">' +
        gmIcon("sms") + (tel ? gmT("Mensagem de texto", "Text message")
                             : gmT("Nenhum telefone cadastrado", "No phone number on file")) + '</a>' +
      '<a class="gm-contact-btn gm-email' + (email ? "" : " gm-reason") + '"' + mailDis +
        ' href="mailto:' + escHtml(email || "") + '" onclick="gmLogOutreach(\'Email\')">' +
        gmIcon("mail") + (email ? "Email"
                                : gmT("Nenhum email cadastrado", "No email on file")) + '</a>' +
    '</div></div>';
}

function gmToggleContactMore() {
  var btn = document.getElementById("gmContactMoreBtn");
  var panel = document.getElementById("gmContactMorePanel");
  if (!btn || !panel) { return; }
  var open = btn.getAttribute("aria-expanded") === "true";
  btn.setAttribute("aria-expanded", open ? "false" : "true");
  panel.hidden = open;
}

// ═════════════════════════════════════════════════════════════════════════
// TAB 1 — PIPELINE (Leads · Parceiros · Base de Ouro)
// ═════════════════════════════════════════════════════════════════════════
// One tab, three sub-sections. They are one workflow: a reactivated Base de
// Ouro customer re-enters as a lead with origin "Base de Clientes", and
// partner scores are computed FROM the CRM. As separate tabs the latter two
// sat in "Mais" on every phone, since .portal-tabs is hidden below 769px and
// the dock holds only four.
//
// This is a CONTAINER around gmRenderCrm() / gmRenderPartners() /
// gmRenderBase() — their bodies are unchanged, and each still owns its own
// #gm*Body div. Only one body is visible at a time.

var GM_PIPELINE_SECTIONS = ["leads", "partners", "base"];
var GM_PIPELINE_KEY_PREFIX = "apex_gm_pipeline_section_";
var gmPipelineSection = "leads";

function gmPipelineKey() { return GM_PIPELINE_KEY_PREFIX + clientId; }

// Per client id, so a coach previewing several clients does not carry one
// client's section into the next.
function gmPipelineRestore() {
  var saved = null;
  try { saved = localStorage.getItem(gmPipelineKey()); } catch (e) {}
  if (GM_PIPELINE_SECTIONS.indexOf(saved) !== -1) { gmPipelineSection = saved; }
  return gmPipelineSection;
}

function gmSetPipelineSection(section) {
  if (GM_PIPELINE_SECTIONS.indexOf(section) === -1) { section = "leads"; }
  gmPipelineSection = section;
  try { localStorage.setItem(gmPipelineKey(), section); } catch (e) {}
}

// Called by the pills. Loads the section's data on first visit, then just
// swaps which body is visible — the three renderers keep their own caches.
function gmPipelineGo(section) {
  gmSetPipelineSection(section);
  gmLoadPipeline();
}

// One row of three pills, in normal flow — NOT sticky, and nothing is
// reserved above it. finance.html / sessions.html / documents.html nest a
// sticky sub-nav inside a scrolling panel (status file item #27, abandoned
// rather than resolved); that nesting is deliberately not copied.
function gmRenderPipelineSubnav() {
  var nav = document.getElementById("gmPipelineSubnav");
  if (!nav) { return; }
  var labels = {
    leads:    gmT("Leads", "Leads"),
    partners: gmT("Parceiros", "Partners"),
    base:     gmT("Base de Ouro", "Golden Base")
  };
  var html = "";
  GM_PIPELINE_SECTIONS.forEach(function(s) {
    var active = s === gmPipelineSection;
    html += '<button type="button" role="tab" aria-selected="' + (active ? "true" : "false") +
      '" class="gm-stage-chip' + (active ? " gm-chip-active" : "") +
      '" data-pipeline-section="' + s + '" onclick="gmPipelineGo(\'' + s + '\')">' +
      escHtml(labels[s]) + '</button>';
  });
  nav.innerHTML = html;
}

// The single entry point switchTab('gmcrm') calls. Shows the selected body,
// hides the other two, and loads that section's data.
function gmLoadPipeline() {
  gmCurrentTab = "gmcrm";
  gmPipelineRestore();
  gmRenderPipelineSubnav();

  var bodies = {
    leads:    document.getElementById("gmCrmBody"),
    partners: document.getElementById("gmPartnersBody"),
    base:     document.getElementById("gmBaseBody")
  };
  GM_PIPELINE_SECTIONS.forEach(function(s) {
    if (bodies[s]) { bodies[s].hidden = s !== gmPipelineSection; }
  });

  if (gmPipelineSection === "leads")    { gmLoadCrm(); }
  if (gmPipelineSection === "partners") { gmLoadPartners(); }
  if (gmPipelineSection === "base")     { gmLoadBase(); }
}

// The FAB, emitted by all three sub-section renderers so it does not vanish
// when the user switches pills.
//
// On Leads it goes STRAIGHT to gmQuickAddOpen() with no menu. gmQuickAddOpen()
// exists so a lead can be captured in ten seconds from a truck, and putting a
// chooser in front of it would cost every single lead capture an extra tap.
// The three-way sheet appears only on Parceiros and Base de Ouro, where
// creation is a deskbound, occasional act rather than a timed one. That is a
// deliberate asymmetry: the speed of lead capture wins over menu consistency.
// Two behaviors, so two glyphs — the previous version used a bare "+" for
// both, which is the actual problem with the split: identical button, one
// fires instantly and one opens a chooser, with nothing on screen to say
// which. Leads keeps the bare "+" ("add a lead, right now"). The menu
// version carries a small caret after it, the standard "this opens
// something" affordance, so the two are distinguishable at a glance without
// changing the FAB's size, color or position.
//
// The caret is &#9662; (▾), the same geometric-glyph family as the &#9650;
// and &#9654; already shipping in portal.html — those render via system
// fallback, since Google Fonts subsets Inter and these sit outside its Latin
// range. Proven in production here, unlike a novel codepoint would be.
function gmPipelineFabHtml() {
  var onLeads = gmPipelineSection === "leads";
  return '<button type="button" class="gm-fab' + (onLeads ? "" : " gm-fab-menu") +
    '" data-tour="crm-quick-add" aria-label="' +
    (onLeads ? gmT("Adicionar lead", "Add lead")
             : gmT("Adicionar registro", "Add record")) +
    '"' + (onLeads ? "" : ' aria-haspopup="menu"') +
    ' onclick="' + (onLeads ? "gmQuickAddOpen()" : "gmPipelineCreateOpen()") + '">' +
    (onLeads ? "+" : '+<span class="gm-fab-caret" aria-hidden="true">&#9662;</span>') +
    '</button>';
}

// Three-way create sheet. Shown only off the Leads section (see above).
function gmPipelineCreateOpen() {
  var opts = [
    { fn: "gmQuickAddOpen()",  pt: "Novo lead",           en: "New lead" },
    { fn: "gmOpenPartner(-1)", pt: "Novo parceiro",       en: "New partner" },
    { fn: "gmOpenBase(-1)",    pt: "Novo cliente antigo", en: "New dormant customer" }
  ];
  var body = '<div class="gm-create-menu">';
  opts.forEach(function(o) {
    // gmSheetOpen replaces any open sheet, so each target can be called
    // directly — the create sheet is torn down as the target sheet opens.
    body += '<button type="button" class="btn-outline gm-create-choice" onclick="' + o.fn + '">' +
      gmT(o.pt, o.en) + '</button>';
  });
  body += '</div>';
  gmSheetOpen(gmT("Criar", "Create"), body, "pipeline-create");
}

function gmLoadCrm() {
  gmCurrentTab = "gmcrm";   // the Pipeline container; section is gmPipelineSection
  var body = document.getElementById("gmCrmBody");
  body.innerHTML = '<div class="content-card"><p class="muted">' + gmT("Carregando…", "Loading…") + '</p></div>';
  Promise.all([gmLoadConfig(), gmApi("leads")])
    .then(function(results) {
      gmLeadsData = results[1];
      gmRenderCrm();
    })
    .catch(function(e) {
      body.innerHTML = '<div class="content-card"><p class="muted">' +
        gmT("Não foi possível carregar o pipeline.", "Could not load the pipeline.") + " " + escHtml(e.message) + '</p></div>';
    });
}

// View mode: manual override (persisted per client) beats the automatic
// threshold in BOTH directions. The automatic switch counts LIVE leads only
// (summary.live_count = estágio NOT IN Fechado/Perdido, computed in SQL) —
// a client with 200 closed deals and 20 live leads stays stacked.
function gmCrmViewMode() {
  var override = gmConfig.config.pipeline_view_override;
  if (override === "stacked" || override === "rail") { return override; }
  var live = (gmLeadsData && gmLeadsData.summary && gmLeadsData.summary.live_count) || 0;
  return live > gmConfig.config.pipeline_view_threshold ? "rail" : "stacked";
}

function gmToggleViewMode() {
  var next = gmCrmViewMode() === "stacked" ? "rail" : "stacked";
  gmConfig.config.pipeline_view_override = next;
  gmRenderCrm();
  gmApi("config/view-mode", { method: "PUT", body: { override: next } }).catch(function() {});
}

function gmLeadsInStage(stage) {
  var out = [];
  ((gmLeadsData && gmLeadsData.leads) || []).forEach(function(l) {
    if (l.estagio === stage) { out.push(l); }
  });
  return out;
}

function gmLeadRowHtml(lead) {
  var idx = gmLeadsData.leads.indexOf(lead);
  var parts = [];
  if (lead.valor !== null && lead.valor !== undefined) { parts.push(fmtNum(lead.valor, "currency")); }
  if (lead.servico) { parts.push(escHtml(gmServicoList(lead.servico).join(", "))); }
  var line2 = parts.join(" · ");
  var line3;
  if (lead.proxima_acao) {
    line3 = escHtml(lead.proxima_acao);
  } else {
    var days = gmDaysSince(lead.stage_changed_at);
    line3 = days === null ? "" :
      (isEn() ? days + " day(s) in this stage" : days + " dia(s) neste estágio");
  }
  return '<button type="button" class="gm-lead-row" data-tour="crm-lead-row" onclick="gmOpenLead(' + idx + ')">' +
    '<span class="gm-lead-main">' +
    '<span class="gm-lead-name">' + escHtml(lead.cliente) + '</span>' +
    (line2 ? '<div class="gm-lead-sub">' + line2 + '</div>' : "") +
    (line3 ? '<div class="gm-lead-sub">' + line3 + '</div>' : "") +
    '</span>' +
    '<span class="gm-lead-side">' + gmPillHtml(lead.estagio, GM_STAGE_PILL[lead.estagio]) + '</span>' +
    '</button>';
}

function gmCrmSummaryHtml() {
  var s = gmLeadsData.summary;
  var conv = s.conversao_pct === null ? "--" : fmtNum(s.conversao_pct, "percent");
  var slaContatoBad = s.fora_sla_contato > 0;
  var slaEstimateBad = s.fora_sla_estimate > 0;
  return '<div class="gm-summary-grid" data-tour="crm-summary">' +
    '<div class="gm-metric"><div class="gm-metric-name">' + gmT("Leads totais", "Total leads") + '</div>' +
    '<div class="gm-metric-value">' + s.leads_totais + '</div></div>' +
    '<div class="gm-metric"><div class="gm-metric-name">' + gmT("Pipeline ativo ($)", "Active pipeline ($)") + '</div>' +
    '<div class="gm-metric-value">' + fmtNum(s.pipeline_ativo, "currency") + '</div>' +
    '<div class="gm-metric-sub">' + gmT("Estimate + Follow-up + Negociação", "Estimate + Follow-up + Negotiation") + '</div></div>' +
    '<div class="gm-metric"><div class="gm-metric-name">' + gmT("Receita fechada ($)", "Closed revenue ($)") + '</div>' +
    '<div class="gm-metric-value">' + fmtNum(s.receita_fechada, "currency") + '</div></div>' +
    '<div class="gm-metric"><div class="gm-metric-name">' + gmT("Conversão", "Conversion") + '</div>' +
    '<div class="gm-metric-value">' + conv + '</div></div>' +
    '<div class="gm-metric' + (slaContatoBad ? " gm-metric-bad" : " gm-metric-good") + '">' +
    '<div class="gm-metric-name">' + gmT("Fora do SLA 5 min (1º contato)", "Outside 5-min SLA (1st contact)") + '</div>' +
    '<div class="gm-metric-value">' + (slaContatoBad ? "! " : "✓ ") + s.fora_sla_contato + '</div>' +
    '<div class="gm-metric-sub">' + gmT("contato em até 5 minutos", "first contact under 5 minutes") + '</div></div>' +
    '<div class="gm-metric' + (slaEstimateBad ? " gm-metric-bad" : " gm-metric-good") + '">' +
    '<div class="gm-metric-name">' + gmT("Fora do SLA 24h (estimate)", "Outside 24h SLA (estimate)") + '</div>' +
    '<div class="gm-metric-value">' + (slaEstimateBad ? "! " : "✓ ") + s.fora_sla_estimate + '</div>' +
    '<div class="gm-metric-sub">' + gmT("estimate em até 24 horas", "estimate within 24 hours") + '</div></div>' +
    '</div>';
}

function gmRenderCrm() {
  var body = document.getElementById("gmCrmBody");
  if (!gmConfig || !gmLeadsData) { return; }
  var stages = gmConfig.method.stages;
  var mode = gmCrmViewMode();
  var html = '<div class="content-card">' + gmCrmSummaryHtml() + '</div>';

  html += '<div class="gm-view-toggle">' +
    '<span class="muted">' +
    (mode === "stacked"
      ? gmT("Pipeline completo em uma rolagem", "Whole pipeline in one scroll")
      : gmT("Toque em um estágio para filtrar", "Tap a stage to filter")) + '</span>' +
    '<button type="button" class="btn-outline" data-tour="crm-view-toggle" onclick="gmToggleViewMode()">' +
    (mode === "stacked"
      ? gmT("Ver por estágio", "View by stage")
      : gmT("Ver tudo empilhado", "View stacked")) + '</button></div>';

  if (mode === "stacked") {
    html += '<div class="content-card">';
    stages.forEach(function(stage, i) {
      var leads = gmLeadsInStage(stage);
      html += '<div class="gm-stage-section"' + (i === 0 ? ' data-tour="crm-stage-section"' : '') + '>' +
        '<div class="gm-stage-head"><span class="gm-stage-name">' + escHtml(stage) + '</span>' +
        '<span class="gm-stage-count">' + leads.length + '</span></div>';
      if (!leads.length) {
        html += '<div class="gm-stage-empty">' + gmT("Nenhum lead neste estágio", "No leads in this stage") + '</div>';
      } else {
        leads.forEach(function(l) { html += gmLeadRowHtml(l); });
      }
      html += '</div>';
    });
    html += '</div>';
  } else {
    if (!gmActiveStage || stages.indexOf(gmActiveStage) === -1) { gmActiveStage = stages[0]; }
    html += '<div class="gm-stage-rail" data-tour="crm-stage-rail">';
    stages.forEach(function(stage) {
      var n = gmLeadsInStage(stage).length;
      html += '<button type="button" class="gm-stage-chip' + (stage === gmActiveStage ? " gm-chip-active" : "") +
        '" onclick="gmPickStage(\'' + escHtml(stage).replace(/'/g, "\\'") + '\')">' +
        escHtml(stage) + ' <span class="gm-chip-count">' + n + '</span></button>';
    });
    html += '</div><div class="content-card">';
    var filtered = gmLeadsInStage(gmActiveStage);
    if (!filtered.length) {
      html += '<p class="muted">' + gmT("Nenhum lead neste estágio", "No leads in this stage") + '</p>';
    } else {
      filtered.forEach(function(l) { html += gmLeadRowHtml(l); });
    }
    html += '</div>';
  }

  html += gmPipelineFabHtml();

  body.innerHTML = html;
}

function gmPickStage(stage) {
  gmActiveStage = stage;
  gmRenderCrm();
}

// ── Quick add: THREE fields (Nome, Telefone, Serviços-as-chips) ─────────
var gmQuickServicos = [];
var GM_QUICKADD_DRAFT_KEY_PREFIX = "apex_gm_quickadd_";

function gmQuickDraftKey() { return GM_QUICKADD_DRAFT_KEY_PREFIX + clientId; }

function gmQuickAddOpen() {
  var draft = {};
  try { draft = JSON.parse(localStorage.getItem(gmQuickDraftKey())) || {}; } catch (e) { draft = {}; }
  gmQuickServicos = gmServicoList(draft.servico);
  var servicos = gmConfig.config.servicos;
  var chips = "";
  servicos.forEach(function(s, i) {
    chips += '<button type="button" class="gm-choice-chip' + (gmQuickServicos.indexOf(s) !== -1 ? " gm-chip-sel" : "") +
      '" data-opt-idx="' + i + '" onclick="gmQuickPickServico(this)">' + escHtml(s) + '</button>';
  });
  var body =
    '<label class="field-label">' + gmT("Nome", "Name") + ' *</label>' +
    '<div class="gm-editor-input"><input type="text" id="gmQaNome" value="' + escHtml(draft.nome || "") + '" oninput="gmQuickDraftSave()"></div>' +
    '<label class="field-label" style="margin-top:12px;">' + gmT("Telefone", "Phone") + '</label>' +
    '<div class="gm-editor-input"><input type="tel" id="gmQaTel" value="' + escHtml(draft.telefone || "") + '" oninput="gmQuickDraftSave()"></div>' +
    '<label class="field-label" style="margin-top:12px;">' + gmT("Serviço", "Service") + '</label>' +
    '<div class="gm-chip-set" id="gmQaServicos">' + chips + '</div>' +
    '<div class="gm-derived-note">' +
    gmT("Estágio: Novo Lead · Data: agora. Depois de salvar você pode adicionar os detalhes.",
        "Stage: Novo Lead · Date: now. You can add details after saving.") + '</div>' +
    '<div class="gm-editor-actions">' +
    '<button type="button" class="btn-outline" onclick="gmSheetClose()">' + gmT("Cancelar", "Cancel") + '</button>' +
    '<button type="button" class="btn-gold" onclick="gmQuickAddSave()">' + gmT("Salvar lead", "Save lead") + '</button>' +
    '</div>';
  gmSheetOpen(gmT("Novo lead", "New lead"), body, "crm-quick-add-sheet");
}

function gmQuickPickServico(btn) {
  // True multi-select: each chip toggles on its own, several can be active.
  var opt = btn.textContent;
  var pos = gmQuickServicos.indexOf(opt);
  if (pos === -1) {
    gmQuickServicos.push(opt);
    btn.classList.add("gm-chip-sel");
  } else {
    gmQuickServicos.splice(pos, 1);
    btn.classList.remove("gm-chip-sel");
  }
  gmQuickDraftSave();
}

// Autosave the quick-add draft so backgrounding the tab never loses it.
function gmQuickDraftSave() {
  var nomeEl = document.getElementById("gmQaNome");
  var telEl = document.getElementById("gmQaTel");
  try {
    localStorage.setItem(gmQuickDraftKey(), JSON.stringify({
      nome: nomeEl ? nomeEl.value : "",
      telefone: telEl ? telEl.value : "",
      servico: gmQuickServicos.length ? gmQuickServicos.join(", ") : null
    }));
  } catch (e) {}
}

function gmQuickAddSave() {
  var nome = (document.getElementById("gmQaNome").value || "").trim();
  var tel = (document.getElementById("gmQaTel").value || "").trim();
  if (!nome) {
    window.alert(gmT("O nome é obrigatório.", "Name is required."));
    return;
  }
  var payload = {
    cliente: nome,
    telefone: tel || null,
    servico: gmQuickServicos.length ? gmQuickServicos.join(", ") : null,
    estagio: "Novo Lead",
    data_lead: gmNowLocalIso(),
    mes_lead: gmCurrentCycleMonth()
  };
  gmApi("leads", { method: "POST", body: payload })
    .then(function(d) {
      try { localStorage.removeItem(gmQuickDraftKey()); } catch (e) {}
      gmSheetClose();
      gmLoadCrmSilent().then(function() {
        var createdId = d.lead && d.lead.id;
        gmToast(gmT("Lead salvo ✓", "Lead saved ✓"), gmT("Adicionar detalhes", "Add details"), function() {
          var idx = -1;
          gmLeadsData.leads.forEach(function(l, i) { if (l.id === createdId) { idx = i; } });
          if (idx !== -1) { gmOpenLead(idx); }
        });
      });
    })
    .catch(function(e) { window.alert(e.message); });
}

function gmLoadCrmSilent() {
  return gmApi("leads").then(function(d) { gmLeadsData = d; gmRenderCrm(); })
    .catch(function() {});
}

// ── Lead detail: bottom sheet, fields ordered by frequency of use ────────
var gmDetailLead = null;
var gmLeadContacts = null;        // cached log rows for the open lead

// ── Outreach logging ─────────────────────────────────────────────────────
// Tapping Call / WhatsApp / SMS / Email launches the link AND opens the
// outcome modal with Method already filled in, so only Result is left to
// pick. Same one-tap contract as the Apex-internal Contact Log.
//
// The href does the launching (a real <a>, so the OS handoff is a plain
// navigation and nothing can be popup-blocked); this only records it. It is
// called from onclick and must therefore do NO async work before returning.
var GM_CONTACT_RESULTS = [
  { key: "Answered",       pt: "Atendeu",        en: "Answered" },
  { key: "No response",    pt: "Sem resposta",   en: "No response" },
  { key: "Left voicemail", pt: "Deixou recado",  en: "Left voicemail" },
  { key: "Rescheduled",    pt: "Remarcado",      en: "Rescheduled" },
  { key: "Not interested", pt: "Sem interesse",  en: "Not interested" }
];
var GM_CONTACT_METHOD_LABELS = {
  "WhatsApp":     { pt: "WhatsApp",          en: "WhatsApp" },
  "Phone call":   { pt: "Ligação",           en: "Phone call" },
  "Email":        { pt: "Email",             en: "Email" },
  "In person":    { pt: "Pessoalmente",      en: "In person" },
  "Text message": { pt: "Mensagem de texto", en: "Text message" }
};

function gmMethodLabel(key) {
  var m = GM_CONTACT_METHOD_LABELS[key];
  return m ? gmT(m.pt, m.en) : escHtml(key);
}

function gmLogOutreach(method) {
  if (!gmDetailLead) { return; }
  // Deferred one tick so the browser commits the link navigation first; the
  // modal is only bookkeeping and must never delay the outreach itself.
  window.setTimeout(function() { gmOpenOutcomeModal(method); }, 0);
}

function gmOpenOutcomeModal(method) {
  var body = '<p class="gm-derived-note">' +
    gmT("Registrando: ", "Logging: ") + '<strong>' + gmMethodLabel(method) + '</strong>. ' +
    gmT("Escolha o resultado.", "Pick the outcome.") + '</p>' +
    '<div class="gm-chip-set" style="flex-direction:column;align-items:stretch;">';
  GM_CONTACT_RESULTS.forEach(function(r) {
    body += '<button type="button" class="gm-choice-chip" style="text-align:left;" onclick="gmSaveOutreach(' +
      "'" + escHtml(method).replace(/'/g, "\\'") + "','" + r.key + "')\">" +
      gmT(r.pt, r.en) + '</button>';
  });
  body += '</div>' +
    '<button type="button" class="btn-outline gm-add-btn" onclick="gmRenderLeadSheet()">' +
    gmT("Cancelar", "Cancel") + '</button>';
  gmSheetOpen(gmT("Resultado do contato", "Contact outcome"), body, "crm-outcome");
}

function gmSaveOutreach(method, result) {
  var lead = gmDetailLead;
  gmApi("leads/" + lead.id + "/contacts", { method: "POST", body: { method: method, result: result } })
    .then(function(d) {
      // The server returns the refreshed derived values, so the sheet can
      // re-render without a second round trip.
      lead.contatos_count = d.contatos_count;
      lead.primeiro_contato = d.primeiro_contato;
      gmLeadContacts = null;                 // force a refetch if the log opens
      gmRenderLeadSheet();
      gmToast(gmT("Contato registrado ✓", "Contact logged ✓"));
    })
    .catch(function(e) { window.alert(e.message); });
}

// The follow-up count row opens the LOG, not a number editor: the count is
// derived from these rows and cannot be typed.
function gmOpenContactLog() {
  var lead = gmDetailLead;
  gmSheetOpen(gmT("Histórico de contatos", "Contact history"),
    '<p class="muted">' + gmT("Carregando…", "Loading…") + '</p>', "crm-contact-log");
  gmApi("leads/" + lead.id + "/contacts")
    .then(function(d) {
      gmLeadContacts = d.contacts || [];
      var body = "";
      if (!gmLeadContacts.length) {
        body = '<p class="gm-derived-note">' +
          gmT("Nenhum contato registrado ainda. Use Ligar, WhatsApp, SMS ou Email acima — cada contato é registrado aqui.",
              "No contacts logged yet. Use Call, WhatsApp, SMS or Email above — each one is logged here.") + '</p>';
      } else {
        body = '<div class="gm-sheet-group">';
        gmLeadContacts.forEach(function(c) {
          var res = "";
          GM_CONTACT_RESULTS.forEach(function(r) { if (r.key === c.result) { res = gmT(r.pt, r.en); } });
          body += '<div class="gm-sheet-row" style="cursor:default;">' +
            '<span class="gm-sheet-row-icon">' + gmIcon(gmMethodIcon(c.method)) + '</span>' +
            '<span class="gm-sheet-row-body">' +
              '<span class="gm-sheet-row-label">' + gmMethodLabel(c.method) +
              (res ? ' · ' + escHtml(res) : "") + '</span>' +
              '<span class="gm-sheet-row-value">' + escHtml(formatDateTimeUTC(c.logged_at)) + '</span>' +
              (c.notes ? '<span class="gm-sheet-row-sub">' + escHtml(c.notes) + '</span>' : "") +
            '</span></div>';
        });
        body += '</div>';
      }
      body += '<button type="button" class="btn-outline gm-add-btn" onclick="gmRenderLeadSheet()">' +
        gmT("Voltar", "Back") + '</button>';
      gmSheetOpen(gmT("Histórico de contatos", "Contact history"), body, "crm-contact-log");
    })
    .catch(function(e) {
      gmSheetOpen(gmT("Histórico de contatos", "Contact history"),
        '<p class="muted">' + escHtml(e.message) + '</p>' +
        '<button type="button" class="btn-outline gm-add-btn" onclick="gmRenderLeadSheet()">' +
        gmT("Voltar", "Back") + '</button>', "crm-contact-log");
    });
}

function gmMethodIcon(method) {
  if (method === "WhatsApp") { return "wa"; }
  if (method === "Phone call") { return "phone"; }
  if (method === "Email") { return "mail"; }
  if (method === "Text message") { return "sms"; }
  return "person";
}

// "4 days ago" / "há 4 dias" — a relative age reads faster than a timestamp
// for the question this row answers ("is this lead going cold?").
function gmRelativeAge(iso) {
  var days = gmDaysSince(iso);
  if (days === null) { return ""; }
  if (days === 0) { return gmT("hoje", "today"); }
  if (days === 1) { return gmT("ontem", "yesterday"); }
  return isEn() ? days + " days ago" : "há " + days + " dias";
}

function gmOpenLead(idx) {
  var lead = gmLeadsData.leads[idx];
  if (!lead) { return; }
  gmDetailLead = lead;
  gmRenderLeadSheet();
}

function gmLeadFieldDefs() {
  var cfg = gmConfig.config, method = gmConfig.method;
  return [
    { key: "valor",          type: "currency", pt: "Valor estimate ($)",      en: "Estimate value ($)" },
    { key: "proxima_acao",   type: "text",     pt: "Próxima ação",            en: "Next action" },
    // followups and data_contato are NOT here: both are derived from the
    // gm_lead_contacts log (contatos_count / primeiro_contato) and rendered
    // as read-only rows. Leaving them editable would let a typed number
    // silently disagree with the log it is supposed to summarize.
    { key: "data_estimate",  type: "datetime", pt: "Data/hora estimate",      en: "Estimate date/time" },
    { key: "servico",        type: "multichoice", pt: "Serviço(s)",           en: "Service(s)", options: cfg.servicos },
    { key: "vendedor",       type: "choice",   pt: "Vendedor",                en: "Salesperson", options: cfg.vendedores },
    { key: "origem",         type: "choice",   pt: "Origem",                  en: "Source",    options: method.origens },
    { key: "parceiro_id",    type: "partner",  pt: "Parceiro",                en: "Partner" },
    { key: "telefone",       type: "tel",      pt: "Telefone",                en: "Phone" },
    { key: "email",          type: "text",     pt: "Email",                   en: "Email" },
    { key: "observacao",     type: "textarea", pt: "Observação do trabalho",  en: "Job notes" },
    { key: "mes_fechamento", type: "choice",   pt: "Mês fechamento",          en: "Closing month", options: cfg.cycle_months },
    { key: "mes_lead",       type: "choice",   pt: "Mês lead",                en: "Lead month",    options: cfg.cycle_months },
    { key: "data_lead",      type: "datetime", pt: "Data/hora lead",          en: "Lead date/time" },
    { key: "cliente",        type: "text",     pt: "Cliente (nome)",          en: "Client (name)" }
  ];
}

function gmLeadFieldDisplay(lead, def) {
  var v = lead[def.key];
  if (v === null || v === undefined || v === "") { return ""; }
  if (def.type === "currency") { return escHtml(fmtNum(v, "currency")); }
  if (def.type === "datetime") { return escHtml(formatDateTime(v)); }
  if (def.key === "parceiro_id") { return escHtml(lead.parceiro_name || ""); }
  if (def.type === "multichoice") { return escHtml(gmServicoList(v).join(", ")); }
  return escHtml(String(v));
}

// One icon+label+value row inside a grouped sheet section. Same tap-to-edit
// contract as gmFieldRowHtml — this is the grouped presentation of it, not a
// second editing mechanism. Shared with the Partner sheet via .gm-sheet-*.
function gmSheetRowHtml(icon, label, valueHtml, onclickJs, tourKey, subHtml) {
  var tag = onclickJs ? "button" : "div";
  return '<' + tag + (onclickJs ? ' type="button"' : ' style="cursor:default;"') +
    ' class="gm-sheet-row"' + (tourKey ? ' data-tour="' + tourKey + '"' : '') +
    (onclickJs ? ' onclick="' + onclickJs + '"' : '') + '>' +
    '<span class="gm-sheet-row-icon">' + gmIcon(icon) + '</span>' +
    '<span class="gm-sheet-row-body">' +
      '<span class="gm-sheet-row-label">' + label + '</span>' +
      '<span class="gm-sheet-row-value' + (valueHtml ? "" : " gm-empty") + '">' +
      (valueHtml || (onclickJs ? gmT("Toque para preencher", "Tap to fill in") : "—")) + '</span>' +
      (subHtml ? '<span class="gm-sheet-row-sub">' + subHtml + '</span>' : "") +
    '</span>' +
    (onclickJs ? '<span class="gm-sheet-row-chev">' + gmIcon("chevron") + '</span>' : "") +
    '</' + tag + '>';
}

function gmSheetSection(title, rowsHtml, noteHtml) {
  return '<div class="gm-sheet-section">' +
    '<p class="gm-sheet-section-title">' + title +
    (noteHtml ? ' <span class="gm-sheet-section-note">' + noteHtml + '</span>' : "") + '</p>' +
    '<div class="gm-sheet-group">' + rowsHtml + '</div></div>';
}

// The Lead detail sheet. Field indexes are the SAME gmLeadFieldDefs() indexes
// the flat sheet used, so editing still goes through gmEditLeadField — only
// the presentation differs.
function gmRenderLeadSheet() {
  var lead = gmDetailLead;
  var days = gmDaysSince(lead.stage_changed_at);
  var byKey = {};
  gmLeadFieldDefs().forEach(function(def, i) { byKey[def.key] = { def: def, i: i }; });
  var val = function(key) { return gmLeadFieldDisplay(lead, byKey[key].def); };
  var edit = function(key) { return "gmEditLeadField(" + byKey[key].i + ")"; };

  // ── Contact actions ───────────────────────────────────────────────────
  var body = gmContactButtonsHtml(lead.telefone);
  body += gmContactMoreHtml(lead.telefone, lead.email);

  // ── Hero: stage + days on the left, estimate value on the right ───────
  // The two things asked first about any lead, given the sheet's headline
  // weight instead of being two more rows in a flat list.
  var valor = gmLeadFieldDisplay(lead, byKey.valor.def);
  body += '<div class="gm-sheet-hero" data-tour="crm-lead-hero">' +
    '<div class="gm-sheet-hero-left">' +
      '<button type="button" style="background:none;border:none;padding:0;cursor:pointer;" ' +
        'data-tour="crm-stage-change" onclick="gmOpenStagePicker()">' +
        gmPillHtml(lead.estagio, GM_STAGE_PILL[lead.estagio]) + '</button>' +
      (days !== null ? '<div class="gm-sheet-hero-age">' +
        (isEn() ? days + " day(s) in this stage" : days + " dia(s) neste estágio") + '</div>' : "") +
    '</div>' +
    '<button type="button" class="gm-sheet-hero-right" style="background:none;border:none;cursor:pointer;" ' +
      'onclick="' + edit("valor") + '">' +
      '<div class="gm-sheet-hero-label">' + gmT("Valor estimate", "Estimate value") + '</div>' +
      '<div class="gm-sheet-hero-value' + (valor ? "" : " gm-empty") + '">' +
      (valor || gmT("A definir", "Not set")) + '</div>' +
    '</button></div>';

  // ── Next action ───────────────────────────────────────────────────────
  // On its own, because it is the one genuinely manual judgement call on the
  // sheet — everything else is either a fact or derived.
  body += gmSheetSection(gmT("Próxima ação", "Next action"),
    gmSheetRowHtml("check", gmT("Próxima ação", "Next action"),
      val("proxima_acao"), edit("proxima_acao")));

  // ── Contact activity — derived, never typed ───────────────────────────
  // Both values come from the gm_lead_contacts log (COUNT and MIN(logged_at),
  // computed server-side in handleGetGmLeads). Neither is tap-to-edit: the
  // follow-up row opens the LOG, and first-contacted is auto-stamped by the
  // first logged contact. COALESCE onto the legacy hand-entered data_contato
  // keeps leads that predate the log from showing an empty row.
  var count = lead.contatos_count || 0;
  // Two differently-stored sources, so they cannot share one formatter:
  // primeiro_contato is MIN(gm_lead_contacts.logged_at) — datetime('now'), UTC —
  // while the legacy data_contato is hand-entered in a local date field.
  // Converting the legacy value would shift it four hours the wrong way.
  var firstAt    = lead.primeiro_contato || lead.data_contato || null;
  var firstAtUtc = !!lead.primeiro_contato;
  body += gmSheetSection(gmT("Atividade de contato", "Contact activity"),
    gmSheetRowHtml("repeat", gmT("Nº follow-ups", "# follow-ups"),
      String(count), "gmOpenContactLog()", "crm-followups",
      gmT("Toque para ver o histórico", "Tap to see the history")) +
    gmSheetRowHtml("clock", gmT("1º contato", "First contacted"),
      firstAt ? escHtml(gmRelativeAge(firstAt)) : "",
      null, null,
      firstAt ? escHtml(firstAtUtc ? formatDateTimeUTC(firstAt) : formatDateTime(firstAt)) : ""),
    gmT("registrado automaticamente", "tracked automatically"));

  // ── Lead details ──────────────────────────────────────────────────────
  // parceiro is here rather than buried: "who sent me this lead?" is a
  // question users actively ask, so it gets a labelled row of its own.
  body += gmSheetSection(gmT("Dados do lead", "Lead details"),
    gmSheetRowHtml("briefcase", gmT("Serviço(s)", "Service(s)"), val("servico"), edit("servico")) +
    gmSheetRowHtml("person", gmT("Vendedor", "Salesperson"), val("vendedor"), edit("vendedor")) +
    gmSheetRowHtml("compass", gmT("Origem", "Source"), val("origem"), edit("origem")) +
    gmSheetRowHtml("handshake", gmT("Parceiro", "Partner"), val("parceiro_id"), edit("parceiro_id"),
      "crm-lead-partner") +
    gmSheetRowHtml("phone", gmT("Telefone", "Phone"), val("telefone"), edit("telefone")) +
    gmSheetRowHtml("mail", gmT("Email", "Email"), val("email"), edit("email")));

  // ── Everything else, still tap-to-edit ────────────────────────────────
  // The remaining fields keep the flat treatment: they are lower-frequency,
  // and promoting all fifteen would defeat the grouping.
  var shown = { valor: 1, proxima_acao: 1,
                servico: 1, vendedor: 1, origem: 1, parceiro_id: 1, telefone: 1, email: 1 };
  var rest = "";
  gmLeadFieldDefs().forEach(function(def, i) {
    if (shown[def.key]) { return; }
    rest += gmSheetRowHtml("tag", gmT(def.pt, def.en),
      gmLeadFieldDisplay(lead, def), "gmEditLeadField(" + i + ")");
  });
  body += gmSheetSection(gmT("Outros campos", "Other fields"), rest);

  body += '<button type="button" class="btn-outline gm-add-btn" style="color:var(--red);border-color:var(--red);" onclick="gmDeleteLead()">' +
    gmT("Excluir lead", "Delete lead") + '</button>';
  gmSheetOpen(escHtml(lead.cliente), body, "crm-lead-detail");
}

function gmOpenStagePicker() {
  var lead = gmDetailLead;
  var stages = gmConfig.method.stages;
  var body = '<div class="gm-chip-set" style="flex-direction:column;align-items:stretch;">';
  stages.forEach(function(stage) {
    body += '<button type="button" class="gm-choice-chip' + (stage === lead.estagio ? " gm-chip-sel" : "") +
      '" style="text-align:left;" onclick="gmSetStage(\'' + escHtml(stage).replace(/'/g, "\\'") + '\')">' +
      gmPillHtml(stage, GM_STAGE_PILL[stage]) + '</button>';
  });
  body += '</div>' +
    '<button type="button" class="btn-outline gm-add-btn" onclick="gmRenderLeadSheet()">' + gmT("Cancelar", "Cancel") + '</button>';
  gmSheetOpen(escHtml(lead.cliente) + ' — ' + gmT("Estágio", "Stage"), body, "crm-stage-picker");
}

function gmSetStage(stage) {
  gmSaveLeadField("estagio", stage, function() { gmRenderLeadSheet(); });
}

function gmEditLeadField(defIdx) {
  var def = gmLeadFieldDefs()[defIdx];
  var lead = gmDetailLead;
  if (def.type === "partner") {
    gmLoadPartnersList().then(function(partners) {
      var names = [];
      partners.forEach(function(p) { names.push(p.name); });
      gmOpenFieldEditor(gmT(def.pt, def.en), "choice", lead.parceiro_name || null, names, function(value) {
        var pid = null;
        partners.forEach(function(p) { if (p.name === value) { pid = p.id; } });
        gmSaveLeadField("parceiro_id", pid, function() { gmRenderLeadSheet(); });
      }, '<div class="gm-derived-note">' +
        gmT("A lista vem da aba Parceiros — cadastre o parceiro lá primeiro. O vínculo é pelo registro, não pelo texto.",
            "The list comes from the Partners tab — add the partner there first. The link is by record, not by text.") + '</div>');
    });
    return;
  }
  gmOpenFieldEditor(gmT(def.pt, def.en), def.type, lead[def.key], def.options || [], function(value) {
    if (def.key === "cliente" && (value === null || value === "")) {
      window.alert(gmT("O nome do cliente é obrigatório.", "Client name is required."));
      gmRenderLeadSheet();
      return;
    }
    gmSaveLeadField(def.key, value, function() { gmRenderLeadSheet(); });
  });
}

function gmSaveLeadField(key, value, after) {
  var lead = gmDetailLead;
  var payload = {};
  payload[key] = value;
  gmApi("leads/" + lead.id, { method: "PUT", body: payload })
    .then(function(d) {
      var idx = gmLeadsData.leads.indexOf(lead);
      if (idx !== -1 && d.lead) {
        // keep the joined partner name fresh
        if (key === "parceiro_id") {
          var name = null;
          (gmPartnersData && gmPartnersData.partners || []).forEach(function(p) { if (p.id === value) { name = p.name; } });
          d.lead.parceiro_name = name;
        } else {
          d.lead.parceiro_name = lead.parceiro_name;
        }
        gmLeadsData.leads[idx] = d.lead;
        gmDetailLead = d.lead;
      }
      gmLoadCrmSilent();
      if (after) { after(); }
    })
    .catch(function(e) { window.alert(e.message); });
}

function gmDeleteLead() {
  var lead = gmDetailLead;
  if (!window.confirm(gmT("Excluir o lead \"" + lead.cliente + "\"? Essa ação não pode ser desfeita.",
                          "Delete lead \"" + lead.cliente + "\"? This cannot be undone."))) { return; }
  gmApi("leads/" + lead.id, { method: "DELETE" })
    .then(function() { gmSheetClose(); gmLoadCrmSilent(); })
    .catch(function(e) { window.alert(e.message); });
}

// ═════════════════════════════════════════════════════════════════════════
// TAB 2 — METAS & EXECUÇÃO (roadmap)
// ═════════════════════════════════════════════════════════════════════════

function gmLoadRoadmap() {
  gmCurrentTab = "gmroadmap";
  var body = document.getElementById("gmRoadmapBody");
  body.innerHTML = '<div class="content-card"><p class="muted">' + gmT("Carregando…", "Loading…") + '</p></div>';
  Promise.all([gmLoadConfig(), gmApi("roadmap")])
    .then(function(results) { gmRoadmapData = results[1]; gmRenderRoadmap(); })
    .catch(function(e) {
      body.innerHTML = '<div class="content-card"><p class="muted">' + escHtml(e.message) + '</p></div>';
    });
}

function gmRenderRoadmap() {
  var body = document.getElementById("gmRoadmapBody");
  var items = gmRoadmapData.items;
  var s = gmRoadmapData.summary;
  var html = '<div class="content-card">' +
    '<div class="card-title">' + gmT("Execução do plano", "Plan execution") + '</div>';
  if (s.total) {
    html += '<div data-tour="roadmap-progress"><div class="progress-track"><div class="progress-fill" style="width:' + (s.completion_pct || 0) + '%;"></div></div>' +
      '<div class="progress-label">' + s.realizado + " / " + s.total + " " +
      gmT("ações realizadas", "actions done") + " · " + (s.completion_pct || 0) + '%</div></div>';
  }
  if (!items.length) {
    html += '<p class="muted" style="margin-top:10px;">' + gmT("Nenhuma ação cadastrada ainda.", "No actions yet.") + '</p>';
  } else {
    items.forEach(function(item, i) {
      html += '<button type="button" class="gm-row" data-tour="roadmap-row" onclick="gmOpenRoadmap(' + i + ')">' +
        '<span class="gm-lead-main">' +
        '<span class="gm-lead-name" style="white-space:normal;">' + escHtml(item.acao) + '</span>' +
        '<div class="gm-lead-sub">' +
        [item.mes, item.frente, item.responsavel].filter(function(x) { return !!x; }).map(escHtml).join(" · ") +
        '</div></span>' +
        '<span class="gm-lead-side" data-tour="roadmap-status">' + gmPillHtml(item.status, GM_STATUS_PILLS.roadmap[item.status]) + '</span>' +
        '</button>';
    });
  }
  html += '<button type="button" class="btn-gold gm-add-btn" data-tour="roadmap-add" onclick="gmOpenRoadmap(-1)">' +
    gmT("+ Nova ação", "+ New action") + '</button></div>';
  body.innerHTML = html;
}

var gmSheetRow = null;   // shared "row being edited" for the simple tabs

function gmOpenRoadmap(idx) {
  gmSheetRow = idx === -1 ? null : gmRoadmapData.items[idx];
  gmRenderSimpleSheet("roadmap");
}

// ═════════════════════════════════════════════════════════════════════════
// TAB 3 — BASE DE OURO
// ═════════════════════════════════════════════════════════════════════════

function gmLoadBase() {
  gmCurrentTab = "gmcrm";   // Base de Ouro is a Pipeline sub-section now
  var body = document.getElementById("gmBaseBody");
  body.innerHTML = '<div class="content-card"><p class="muted">' + gmT("Carregando…", "Loading…") + '</p></div>';
  Promise.all([gmLoadConfig(), gmApi("base-ouro")])
    .then(function(results) { gmBaseData = results[1]; gmRenderBase(); })
    .catch(function(e) {
      body.innerHTML = '<div class="content-card"><p class="muted">' + escHtml(e.message) + '</p></div>';
    });
}

function gmRenderBase() {
  var body = document.getElementById("gmBaseBody");
  var items = gmBaseData.items;
  var html = '<div class="content-card">' +
    '<div class="card-title">' + gmT("Clientes antigos para reativar", "Dormant customers to reactivate") + '</div>' +
    '<p class="muted" style="margin-bottom:8px;">' +
    gmT("Marcar como Reativado cria um novo lead no CRM com origem “Base de Clientes”.",
        "Marking as Reativado creates a new CRM lead with source “Base de Clientes”.") + '</p>';
  if (!items.length) {
    html += '<p class="muted">' + gmT("Nenhum cliente cadastrado ainda.", "No customers yet.") + '</p>';
  } else {
    items.forEach(function(item, i) {
      html += '<button type="button" class="gm-row" data-tour="base-ouro-row" onclick="gmOpenBase(' + i + ')">' +
        '<span class="gm-lead-main">' +
        '<span class="gm-lead-name">' + escHtml(item.cliente) + '</span>' +
        '<div class="gm-lead-sub">' +
        [item.telefone, item.servico_anterior].filter(function(x) { return !!x; }).map(escHtml).join(" · ") +
        '</div>' +
        (item.data_contato ? '<div class="gm-lead-sub">' + gmT("Contato: ", "Contacted: ") + formatDate(item.data_contato) + '</div>' : "") +
        '</span>' +
        '<span class="gm-lead-side">' + gmPillHtml(item.status, GM_STATUS_PILLS.base[item.status]) + '</span>' +
        '</button>';
    });
  }
  html += '<button type="button" class="btn-gold gm-add-btn" data-tour="base-ouro-add" onclick="gmOpenBase(-1)">' +
    gmT("+ Novo cliente antigo", "+ New dormant customer") + '</button></div>';
  // This in-card button stays; the FAB is an additional, always-reachable
  // entry point that can also create the other two record types.
  html += gmPipelineFabHtml();
  body.innerHTML = html;
}

function gmOpenBase(idx) {
  gmSheetRow = idx === -1 ? null : gmBaseData.items[idx];
  gmRenderSimpleSheet("base");
}

function gmReactivateBase() {
  var row = gmSheetRow;
  if (!row) { return; }
  if (!window.confirm(gmT(
    "Reativar \"" + row.cliente + "\"?\n\nIsso cria um novo lead no CRM com origem “Base de Clientes” e marca este cliente como Reativado.",
    "Reactivate \"" + row.cliente + "\"?\n\nThis creates a new CRM lead with source “Base de Clientes” and marks this customer as Reativado."))) { return; }
  gmApi("base-ouro/" + row.id + "/reactivate", {
    method: "POST",
    body: { data_lead: gmNowLocalIso(), mes_lead: gmCurrentCycleMonth() }
  })
    .then(function() {
      gmSheetClose();
      gmToast(gmT("Lead criado no CRM ✓", "CRM lead created ✓"));
      gmLoadBase();
      gmLeadsData = null;   // stale — CRM refetches on next open
    })
    .catch(function(e) { window.alert(e.message); });
}

// ═════════════════════════════════════════════════════════════════════════
// TAB 4 — PARCEIROS
// ═════════════════════════════════════════════════════════════════════════

function gmLoadPartnersList() {
  return gmApi("partners").then(function(d) { gmPartnersData = d; return d.partners; });
}

function gmLoadPartners() {
  gmCurrentTab = "gmcrm";   // Parceiros is a Pipeline sub-section now
  var body = document.getElementById("gmPartnersBody");
  body.innerHTML = '<div class="content-card"><p class="muted">' + gmT("Carregando…", "Loading…") + '</p></div>';
  Promise.all([gmLoadConfig(), gmLoadPartnersList()])
    .then(function() { gmRenderPartners(); })
    .catch(function(e) {
      body.innerHTML = '<div class="content-card"><p class="muted">' + escHtml(e.message) + '</p></div>';
    });
}

// Inline SVG icons for the partner screens. Real stroked paths, never unicode
// glyphs or emoji — those render differently on every platform and cannot take
// a color token. Sized and colored entirely by CSS (.gm-partner-row-icon svg).
var GM_ICONS = {
  person:   '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  tag:      '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><path d="M7 7h.01"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  users:    '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  dollar:   '<path d="M12 1v22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  check:    '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  copy:     '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  share:    '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.59 13.51l6.83 3.98M15.41 6.51L8.59 10.49"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  link:     '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  phone:    '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  sms:      '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  mail:     '<path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><polyline points="22,6 12,13 2,6"/>',
  chevron:  '<polyline points="9 18 15 12 9 6"/>',
  clock:    '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  repeat:   '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  compass:  '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
  handshake: '<path d="M20.42 4.58a5.4 5.4 0 0 0-7.65 0l-.77.78-.77-.78a5.4 5.4 0 0 0-7.65 7.65l8.42 8.42 8.42-8.42a5.4 5.4 0 0 0 0-7.65z"/>'
};

function gmIcon(name) {
  // The WhatsApp mark is a filled brand path, not a stroked glyph, so it is
  // rendered with its own fill/stroke rather than the shared stroked frame.
  if (name === "wa") {
    return '<svg viewBox="0 0 24 24" fill="currentColor">' +
      '<path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.65.07' +
      '-.3-.15-1.25-.46-2.38-1.47-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5' +
      '.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.21-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48' +
      '0 1.46 1.06 2.87 1.21 3.07.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.76-.72 2.01-1.41' +
      '.25-.7.25-1.29.17-1.42-.07-.12-.27-.2-.57-.35z"/>' +
      '<path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5.05-1.32A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.18-1.14l-.3-.18-3 .78.8-2.92' +
      '-.2-.31A8.2 8.2 0 1 1 12 20.2z"/></svg>';
  }
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round">' + (GM_ICONS[name] || "") + '</svg>';
}

function gmRenderPartners() {
  var body = document.getElementById("gmPartnersBody");
  var partners = gmPartnersData.partners;
  var html = '<div class="content-card">' +
    '<div class="card-title">' + gmT("Parceiros de indicação", "Referral partners") + '</div>' +
    '<p class="muted" style="margin-bottom:12px;" data-tour="partners-attribution">' +
    gmT("Leads indicados e receita gerada são calculados automaticamente do CRM pelo vínculo do lead com o parceiro.",
        "Referred leads and revenue are calculated automatically from the CRM via each lead's partner link.") + '</p>';
  if (!partners.length) {
    html += '<p class="muted">' + gmT("Nenhum parceiro cadastrado ainda.", "No partners yet.") + '</p>';
  } else {
    partners.forEach(function(p, i) {
      // Card, not a flat row: name + type + status on top, then the two
      // numbers that answer "is this partner worth the relationship?" at
      // full size. A zero reads muted rather than shouting a big "0".
      var leads = p.leads_indicados || 0;
      var receita = p.receita_gerada || 0;
      html += '<button type="button" class="gm-partner-card" data-tour="partners-row" onclick="gmOpenPartner(' + i + ')">' +
        '<span class="gm-partner-card-top">' +
          '<span class="gm-lead-main">' +
            '<span class="gm-partner-card-name">' + escHtml(p.name) + '</span>' +
            (p.tipo ? '<span class="gm-partner-card-type">' + escHtml(p.tipo) + '</span>' : '') +
          '</span>' +
          '<span class="gm-lead-side">' + gmPillHtml(p.status, GM_STATUS_PILLS.partner[p.status]) + '</span>' +
        '</span>' +
        '<span class="gm-partner-stats">' +
          '<span class="gm-partner-stat">' +
            '<span class="gm-partner-stat-label">' + gmT("Leads indicados", "Referrals sent") + '</span>' +
            '<span class="gm-partner-stat-value' + (leads ? '' : ' gm-partner-zero') + '">' + leads + '</span>' +
          '</span>' +
          '<span class="gm-partner-stat">' +
            '<span class="gm-partner-stat-label">' + gmT("Receita gerada", "Revenue generated") + '</span>' +
            '<span class="gm-partner-stat-value' + (receita ? '' : ' gm-partner-zero') + '">' + escHtml(fmtNum(receita, "currency")) + '</span>' +
          '</span>' +
        '</span>' +
        '</button>';
    });
  }
  html += '<button type="button" class="btn-gold gm-add-btn" data-tour="partners-add" onclick="gmOpenPartner(-1)">' +
    gmT("+ Novo parceiro", "+ New partner") + '</button></div>';
  // This in-card button stays; the FAB is an additional, always-reachable
  // entry point that can also create the other two record types.
  html += gmPipelineFabHtml();
  body.innerHTML = html;
}

function gmOpenPartner(idx) {
  gmSheetRow = idx === -1 ? null : gmPartnersData.partners[idx];
  gmRenderSimpleSheet("partner");
}

// ═════════════════════════════════════════════════════════════════════════
// TAB 5 — FINANCEIRO
// ═════════════════════════════════════════════════════════════════════════

function gmLoadFinance() {
  gmCurrentTab = "gmfinance";
  var body = document.getElementById("gmFinanceBody");
  body.innerHTML = '<div class="content-card"><p class="muted">' + gmT("Carregando…", "Loading…") + '</p></div>';
  Promise.all([gmLoadConfig(), gmApi("finance"), gmApi("jobs")])
    .then(function(results) {
      gmFinanceData = results[1];
      gmJobsData = results[2];
      gmRenderFinance();
    })
    .catch(function(e) {
      body.innerHTML = '<div class="content-card"><p class="muted">' + escHtml(e.message) + '</p></div>';
    });
}

// Hand-rolled horizontal bar chart (inline SVG — no library, no CDN).
// Horizontal bars with the values printed on the marks: touch has no hover.
function gmFinanceChartSvg(monthly) {
  var months = gmConfig.config.cycle_months;
  var rows = [];
  months.forEach(function(m) {
    monthly.forEach(function(x) { if (x.mes === m) { rows.push(x); } });
  });
  monthly.forEach(function(x) {
    if (!x.mes || months.indexOf(x.mes) === -1) { rows.push(x); }
  });
  if (!rows.length) { return ""; }
  var maxV = 1;
  rows.forEach(function(r) { maxV = Math.max(maxV, r.entradas, r.saidas); });
  var W = 340, rowH = 44, padL = 4, labelH = 14, barH = 11;
  var H = rows.length * rowH + 6;
  var svg = '<svg class="gm-finance-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
    gmT("Entradas e saídas por mês", "Money in and out per month") + '">';
  rows.forEach(function(r, i) {
    var y = i * rowH + 4;
    var wIn = Math.max(2, Math.round((r.entradas / maxV) * (W - 110)));
    var wOut = Math.max(2, Math.round((r.saidas / maxV) * (W - 110)));
    svg += '<text x="' + padL + '" y="' + (y + 10) + '" font-size="11" font-weight="700" fill="#1a1a1d" font-family="Inter,sans-serif">' +
      escHtml(r.mes || "—") + '</text>';
    svg += '<rect x="' + padL + '" y="' + (y + labelH) + '" width="' + wIn + '" height="' + barH + '" rx="3" fill="#3f7d4e"/>';
    svg += '<text x="' + (padL + wIn + 5) + '" y="' + (y + labelH + 9) + '" font-size="10" fill="#2f6b3e" font-family="Inter,sans-serif">▲ ' +
      escHtml(fmtNum(r.entradas, "currency")) + '</text>';
    svg += '<rect x="' + padL + '" y="' + (y + labelH + barH + 3) + '" width="' + wOut + '" height="' + barH + '" rx="3" fill="#b44040"/>';
    svg += '<text x="' + (padL + wOut + 5) + '" y="' + (y + labelH + barH + 12) + '" font-size="10" fill="#a03636" font-family="Inter,sans-serif">▼ ' +
      escHtml(fmtNum(r.saidas, "currency")) + '</text>';
  });
  svg += '</svg>';
  return svg;
}

function gmRenderFinance() {
  var body = document.getElementById("gmFinanceBody");
  var monthly = gmFinanceData.monthly;
  var entries = gmFinanceData.entries;
  var html = '<div class="content-card">' +
    '<div class="card-title">' + gmT("Resumo mensal", "Monthly summary") + '</div>' +
    '<div data-tour="finance-chart">' + (monthly.length ? gmFinanceChartSvg(monthly) : "") + '</div>' +
    '<div data-tour="finance-summary">';
  if (!monthly.length) {
    html += '<p class="muted">' + gmT("Nenhum lançamento ainda.", "No entries yet.") + '</p>';
  } else {
    monthly.forEach(function(m) {
      var band = m.resultado >= 0 ? "gm-ok" : "gm-warn";
      var glyph = m.resultado >= 0 ? "▲" : "▼";
      html += '<div class="gm-month-card"><div class="gm-month-title">' + escHtml(m.mes || "—") + '</div>' +
        '<div class="gm-month-line"><span>' + gmT("Entradas", "In") + '</span><span>' + fmtNum(m.entradas, "currency") + '</span></div>' +
        '<div class="gm-month-line"><span>' + gmT("Saídas", "Out") + '</span><span>' + fmtNum(m.saidas, "currency") + '</span></div>' +
        '<div class="gm-month-line"><span>' + gmT("Resultado", "Net") + '</span><span class="' + band + '">' + glyph + ' ' + fmtNum(m.resultado, "currency") + '</span></div>' +
        '<div class="gm-month-line"><span>' + gmT("Margem líquida", "Net margin") + '</span><span class="' + band + '">' +
        (m.margem_pct === null ? "--" : glyph + ' ' + fmtNum(m.margem_pct, "percent")) + '</span></div></div>';
    });
  }
  html += '</div></div>';

  html += '<div class="content-card"><div class="card-title">' + gmT("Lançamentos", "Entries") + '</div>';
  if (!entries.length) {
    html += '<p class="muted">' + gmT("Nenhum lançamento ainda.", "No entries yet.") + '</p>';
  } else {
    entries.forEach(function(e, i) {
      var isIn = e.tipo === "Entrada";
      html += '<button type="button" class="gm-row" data-tour="finance-row" onclick="gmOpenFinance(' + i + ')">' +
        '<span class="gm-lead-main">' +
        '<span class="gm-lead-name" style="white-space:normal;">' + escHtml(e.descricao) + '</span>' +
        '<div class="gm-lead-sub">' +
        [e.data ? formatDate(e.data) : null, e.categoria, e.obra_name].filter(function(x) { return !!x; }).map(escHtml).join(" · ") +
        '</div></span>' +
        '<span class="gm-lead-side"><span class="' + (isIn ? "gm-ok" : "gm-warn") + '" style="font-size:14px;">' +
        (isIn ? "▲ " : "▼ ") + fmtNum(e.valor, "currency") + '</span>' +
        '<div class="gm-lead-sub">' + escHtml(e.tipo) + '</div></span>' +
        '</button>';
    });
  }
  html += '<button type="button" class="btn-gold gm-add-btn" data-tour="finance-add-entry" onclick="gmOpenFinance(-1)">' +
    gmT("+ Novo lançamento", "+ New entry") + '</button></div>';
  body.innerHTML = html;
}

function gmOpenFinance(idx) {
  gmSheetRow = idx === -1 ? null : gmFinanceData.entries[idx];
  gmRenderSimpleSheet("finance");
}

// ═════════════════════════════════════════════════════════════════════════
// TAB 6 — OBRAS & MARGEM
// ═════════════════════════════════════════════════════════════════════════

function gmLoadJobs() {
  gmCurrentTab = "gmjobs";
  var body = document.getElementById("gmJobsBody");
  body.innerHTML = '<div class="content-card"><p class="muted">' + gmT("Carregando…", "Loading…") + '</p></div>';
  Promise.all([gmLoadConfig(), gmApi("jobs")])
    .then(function(results) { gmJobsData = results[1]; gmRenderJobs(); })
    .catch(function(e) {
      body.innerHTML = '<div class="content-card"><p class="muted">' + escHtml(e.message) + '</p></div>';
    });
}

function gmRenderJobs() {
  var body = document.getElementById("gmJobsBody");
  var jobs = gmJobsData.jobs;
  var target = gmJobsData.target_margin;
  var html = '<div class="content-card">' +
    '<div class="card-title">' + gmT("Obras e margem", "Jobs & margin") + '</div>' +
    '<p class="muted" style="margin-bottom:8px;">' +
    gmT("Margem alvo mínima: ", "Minimum target margin: ") + fmtNum(target, "percent") +
    gmT(" — nenhuma proposta sai abaixo desse número.", " — no proposal goes out below this number.") + '</p>';
  if (!jobs.length) {
    html += '<p class="muted">' + gmT("Nenhuma obra cadastrada ainda.", "No jobs yet.") + '</p>';
  } else {
    jobs.forEach(function(j, i) {
      var margemHtml = "";
      if (j.margem_pct !== null) {
        margemHtml = j.alvo_ok
          ? '<span class="gm-ok">✓ ' + fmtNum(j.margem_pct, "percent") + '</span>'
          : '<span class="gm-warn" data-tour="jobs-margin-alert">⚠ ' + fmtNum(j.margem_pct, "percent") + " " +
            gmT("abaixo do alvo", "below target") + '</span>';
      }
      var prazoHtml = "";
      if (j.no_prazo !== null) {
        prazoHtml = j.no_prazo
          ? '<span class="gm-ok">✓ ' + gmT("no prazo", "on time") + '</span>'
          : '<span class="gm-warn">! ' + gmT("fora do prazo", "late") + '</span>';
      }
      html += '<button type="button" class="gm-row" data-tour="jobs-row" onclick="gmOpenJob(' + i + ')">' +
        '<span class="gm-lead-main">' +
        '<span class="gm-lead-name" style="white-space:normal;">' + escHtml(j.obra) + '</span>' +
        '<div class="gm-lead-sub">' +
        [j.valor !== null && j.valor !== undefined ? fmtNum(j.valor, "currency") : null, j.mes_entrega]
          .filter(function(x) { return !!x; }).map(escHtml).join(" · ") + '</div>' +
        '<div class="gm-lead-sub">' + [margemHtml, prazoHtml].filter(function(x) { return !!x; }).join(" · ") + '</div>' +
        '</span>' +
        '<span class="gm-lead-side" data-tour="jobs-status">' + gmPillHtml(j.status, GM_STATUS_PILLS.job[j.status]) + '</span>' +
        '</button>';
    });
  }
  html += '<button type="button" class="btn-gold gm-add-btn" data-tour="jobs-add" onclick="gmOpenJob(-1)">' +
    gmT("+ Nova obra", "+ New job") + '</button></div>';
  body.innerHTML = html;
}

function gmOpenJob(idx) {
  gmSheetRow = idx === -1 ? null : gmJobsData.jobs[idx];
  gmRenderSimpleSheet("job");
}

// ═════════════════════════════════════════════════════════════════════════
// Shared create/edit sheet for the five simple tabs
// ═════════════════════════════════════════════════════════════════════════
// Existing rows: tap-a-field progressive disclosure (same as the CRM lead).
// New rows: the required fields inline in one short sheet, because a brand
// new row has nothing to disclose yet.

function gmSimpleSpec(kind) {
  var cfg = gmConfig.config, method = gmConfig.method;
  if (kind === "roadmap") {
    return {
      collection: "roadmap", data: function() { return gmRoadmapData.items; },
      reload: gmLoadRoadmap, itemKey: "item",
      titleNew: gmT("Nova ação", "New action"), nameKey: "acao",
      fields: [
        { key: "acao",        type: "textarea", pt: "Ação",         en: "Action", required: true },
        { key: "mes",         type: "choice",   pt: "Mês",          en: "Month", options: cfg.cycle_months },
        { key: "frente",      type: "choice",   pt: "Frente",       en: "Front", options: method.frentes },
        { key: "responsavel", type: "text",     pt: "Responsável",  en: "Owner" },
        { key: "status",      type: "choice",   pt: "Status",       en: "Status", options: method.roadmap_statuses, pills: GM_STATUS_PILLS.roadmap },
        { key: "observacoes", type: "textarea", pt: "Observações",  en: "Notes" }
      ]
    };
  }
  if (kind === "base") {
    return {
      collection: "base-ouro", data: function() { return gmBaseData.items; },
      reload: gmLoadBase, itemKey: "item",
      titleNew: gmT("Novo cliente antigo", "New dormant customer"), nameKey: "cliente",
      contactTel: true,
      fields: [
        { key: "cliente",          type: "text",     pt: "Cliente",                 en: "Customer", required: true },
        { key: "telefone",         type: "tel",      pt: "Telefone",                en: "Phone" },
        { key: "servico_anterior", type: "text",     pt: "Serviço anterior / ano",  en: "Previous service / year" },
        { key: "status",           type: "choice",   pt: "Status",                  en: "Status",
          options: ["Não contatado", "Contatado", "Interessado", "Sem interesse"], pills: GM_STATUS_PILLS.base },
        { key: "data_contato",     type: "date",     pt: "Data do contato",         en: "Contact date" },
        { key: "oferta",           type: "text",     pt: "Oferta apresentada",      en: "Offer presented" },
        { key: "observacoes",      type: "textarea", pt: "Observações",             en: "Notes" }
      ]
    };
  }
  if (kind === "partner") {
    return {
      collection: "partners", data: function() { return gmPartnersData.partners; },
      reload: gmLoadPartners, itemKey: "partner",
      titleNew: gmT("Novo parceiro", "New partner"), nameKey: "name",
      fields: [
        { key: "name",             type: "text",   pt: "Parceiro (nome)",   en: "Partner (name)", required: true },
        { key: "tipo",             type: "choice", pt: "Tipo",              en: "Type", options: cfg.partner_types },
        { key: "contato",          type: "text",   pt: "Contato",           en: "Contact" },
        { key: "status",           type: "choice", pt: "Status",            en: "Status", options: method.partner_statuses, pills: GM_STATUS_PILLS.partner },
        { key: "ultima_interacao", type: "date",   pt: "Última interação",  en: "Last interaction" },
        { key: "proxima_acao",     type: "text",   pt: "Próxima ação",      en: "Next action" }
      ]
    };
  }
  if (kind === "finance") {
    var catNames = [];
    cfg.finance_categories.forEach(function(c) { catNames.push(c.name); });
    var jobNames = [];
    ((gmJobsData && gmJobsData.jobs) || []).forEach(function(j) { jobNames.push(j.obra); });
    return {
      collection: "finance", data: function() { return gmFinanceData.entries; },
      reload: gmLoadFinance, itemKey: "entry",
      titleNew: gmT("Novo lançamento", "New entry"), nameKey: "descricao",
      fields: [
        { key: "descricao", type: "text",     pt: "Descrição",       en: "Description", required: true },
        { key: "valor",     type: "currency", pt: "Valor ($)",       en: "Amount ($)", required: true },
        { key: "categoria", type: "choice",   pt: "Categoria",       en: "Category", options: catNames, required: true, tour: "finance-category",
          note: gmT("O tipo (Entrada/Saída) é definido automaticamente pela categoria.",
                    "The type (Entrada/Saída) is set automatically by the category.") },
        { key: "data",      type: "date",     pt: "Data",            en: "Date" },
        { key: "mes",       type: "choice",   pt: "Mês",             en: "Month", options: cfg.cycle_months },
        { key: "obra_id",   type: "jobref",   pt: "Obra vinculada",  en: "Linked job" },
        { key: "obs",       type: "textarea", pt: "Obs",             en: "Notes" }
      ]
    };
  }
  // job
  return {
    collection: "jobs", data: function() { return gmJobsData.jobs; },
    reload: gmLoadJobs, itemKey: "job",
    titleNew: gmT("Nova obra", "New job"), nameKey: "obra",
    fields: [
      { key: "obra",           type: "text",     pt: "Cliente / obra",     en: "Client / job", required: true },
      { key: "valor",          type: "currency", pt: "Valor ($)",          en: "Value ($)" },
      { key: "material",       type: "currency", pt: "Material ($)",       en: "Materials ($)" },
      { key: "mao_de_obra",    type: "currency", pt: "Mão de obra ($)",    en: "Labor ($)" },
      { key: "outros",         type: "currency", pt: "Outros ($)",         en: "Other ($)" },
      { key: "status",         type: "choice",   pt: "Status",             en: "Status", options: gmConfig.method.job_statuses, pills: GM_STATUS_PILLS.job },
      { key: "mes_entrega",    type: "choice",   pt: "Mês entrega",        en: "Delivery month", options: gmConfig.config.cycle_months },
      { key: "inicio",         type: "date",     pt: "Início",             en: "Start" },
      { key: "prazo_previsto", type: "date",     pt: "Prazo previsto",     en: "Deadline" },
      { key: "entrega_real",   type: "date",     pt: "Entrega real",       en: "Actual delivery" }
    ]
  };
}

function gmSimpleFieldDisplay(row, def) {
  var v = row[def.key];
  if (v === null || v === undefined || v === "") { return ""; }
  if (def.type === "currency") { return escHtml(fmtNum(v, "currency")); }
  if (def.type === "date") { return escHtml(formatDate(v)); }
  if (def.type === "jobref") { return escHtml(row.obra_name || ""); }
  if (def.pills) { return gmPillHtml(String(v), def.pills[v]); }
  return escHtml(String(v));
}

var gmSheetKind = null;

// One icon+label+value row inside a grouped partner section. Same tap-to-edit
// contract as gmFieldRowHtml (which every other tab still uses) — this is the
// partner-specific presentation of it, not a second editing mechanism.
function gmPartnerRowHtml(icon, label, valueHtml, onclickJs, tourKey) {
  return '<button type="button" class="gm-partner-row"' +
    (tourKey ? ' data-tour="' + tourKey + '"' : '') +
    ' onclick="' + onclickJs + '">' +
    '<span class="gm-partner-row-icon">' + gmIcon(icon) + '</span>' +
    '<span class="gm-partner-row-body">' +
      '<span class="gm-partner-row-label">' + label + '</span>' +
      '<span class="gm-partner-row-value' + (valueHtml ? "" : " gm-empty") + '">' +
      (valueHtml || gmT("Toque para preencher", "Tap to fill in")) + '</span>' +
    '</span>' +
    '<span class="gm-partner-row-chev">&#9654;</span></button>';
}

// The Partner detail sheet, grouped into Contact / Activity / Next step
// instead of one flat run of identical rows. Field indexes are the SAME
// gmSimpleSpec("partner").fields indexes the generic sheet uses, so editing
// still goes through gmEditSimpleField — only the presentation differs.
function gmPartnerSheetBody(row, spec) {
  var byKey = {};
  spec.fields.forEach(function(def, i) { byKey[def.key] = { def: def, i: i }; });
  var f = function(key) { return byKey[key]; };
  var val = function(key) { return gmSimpleFieldDisplay(row, f(key).def); };
  var edit = function(key) { return "gmEditSimpleField(" + f(key).i + ")"; };

  var body = "";

  // ── Contact ───────────────────────────────────────────────────────────
  body += '<div class="gm-partner-section">' +
    '<p class="gm-partner-section-title">' + gmT("Contato", "Contact") + '</p>' +
    '<div class="gm-partner-group">' +
      gmPartnerRowHtml("person", gmT("Parceiro", "Partner"), val("name"), edit("name")) +
      gmPartnerRowHtml("person", gmT("Contato", "Contact"), val("contato"), edit("contato")) +
      gmPartnerRowHtml("tag", gmT("Tipo", "Type"), val("tipo"), edit("tipo")) +
      gmPartnerRowHtml("check", gmT("Status", "Status"), val("status"), edit("status")) +
    '</div></div>';

  // ── Activity ──────────────────────────────────────────────────────────
  // The two computed numbers are NOT tap-to-edit: they are derived from the
  // CRM at read time (never stored), so they are shown as static rows.
  var leads = row.leads_indicados || 0;
  var receita = row.receita_gerada || 0;
  body += '<div class="gm-partner-section">' +
    '<p class="gm-partner-section-title">' + gmT("Atividade", "Activity") + '</p>' +
    '<div class="gm-partner-group">' +
      gmPartnerRowHtml("calendar", gmT("Última interação", "Last interaction"),
        val("ultima_interacao"), edit("ultima_interacao")) +
      '<div class="gm-partner-row" style="cursor:default;">' +
        '<span class="gm-partner-row-icon">' + gmIcon("users") + '</span>' +
        '<span class="gm-partner-row-body">' +
          '<span class="gm-partner-row-label">' + gmT("Leads indicados", "Referrals sent") + '</span>' +
          '<span class="gm-partner-row-value' + (leads ? '' : ' gm-empty') + '">' + leads + '</span>' +
        '</span></div>' +
      '<div class="gm-partner-row" style="cursor:default;">' +
        '<span class="gm-partner-row-icon">' + gmIcon("dollar") + '</span>' +
        '<span class="gm-partner-row-body">' +
          '<span class="gm-partner-row-label">' + gmT("Receita gerada", "Revenue generated") + '</span>' +
          '<span class="gm-partner-row-value' + (receita ? '' : ' gm-empty') + '">' +
          escHtml(fmtNum(receita, "currency")) + '</span>' +
        '</span></div>' +
    '</div></div>';

  // ── Next step ─────────────────────────────────────────────────────────
  // Same next-step pattern as the Apex-internal pipeline, but this is the
  // CLIENT's own partner record — one client, one user, so there is no
  // cross-user attribution to show here. Just the value.
  body += '<div class="gm-partner-section">' +
    '<p class="gm-partner-section-title">' + gmT("Próximo passo", "Next step") + '</p>' +
    '<div class="gm-partner-group">' +
      gmPartnerRowHtml("check", gmT("Próxima ação", "Next action"),
        val("proxima_acao"), edit("proxima_acao")) +
    '</div></div>';

  return body;
}

function gmRenderSimpleSheet(kind) {
  gmSheetKind = kind;
  var spec = gmSimpleSpec(kind);
  var row = gmSheetRow;
  if (!row) { gmRenderSimpleCreate(spec); return; }

  var body = "";
  if (spec.contactTel) { body += gmContactButtonsHtml(row.telefone); }
  if (kind === "partner") {
    body += gmPartnerSheetBody(row, spec);
  } else {
    spec.fields.forEach(function(def, i) {
      body += gmFieldRowHtml(gmT(def.pt, def.en), gmSimpleFieldDisplay(row, def),
        "gmEditSimpleField(" + i + ")", def.tour || null);
    });
  }

  if (kind === "job") {
    var target = gmJobsData.target_margin;
    body += '<div class="gm-month-card" style="margin-top:12px;">' +
      '<div class="gm-month-title">' + gmT("Calculado automaticamente", "Calculated automatically") + '</div>' +
      '<div class="gm-month-line"><span>' + gmT("Custo total", "Total cost") + '</span><span>' + fmtNum(row.custo_total, "currency") + '</span></div>' +
      '<div class="gm-month-line"><span>' + gmT("Lucro", "Profit") + '</span><span>' + (row.lucro === null ? "--" : fmtNum(row.lucro, "currency")) + '</span></div>' +
      '<div class="gm-month-line"><span>' + gmT("Margem", "Margin") + '</span><span>' +
      (row.margem_pct === null ? "--"
        : (row.alvo_ok ? '<span class="gm-ok">✓ ' : '<span class="gm-warn">⚠ ') + fmtNum(row.margem_pct, "percent") +
          (row.alvo_ok ? "" : " " + gmT("abaixo do alvo de ", "below the target of ") + fmtNum(target, "percent")) + '</span>') +
      '</span></div>' +
      '<div class="gm-month-line"><span>' + gmT("No prazo?", "On time?") + '</span><span>' +
      (row.no_prazo === null ? "--" : (row.no_prazo ? '<span class="gm-ok">✓ ' + gmT("Sim", "Yes") + '</span>' : '<span class="gm-warn">! ' + gmT("Não", "No") + '</span>')) +
      '</span></div></div>';
  }
  if (kind === "base") {
    if (row.reactivated_lead_id) {
      body += '<p class="muted" style="margin-top:12px;">✓ ' +
        gmT("Já reativado — lead criado no CRM.", "Already reactivated — CRM lead created.") + '</p>';
    } else {
      body += '<button type="button" class="btn-gold gm-add-btn" data-tour="base-ouro-reactivate" onclick="gmReactivateBase()">' +
        gmT("Reativar → criar lead no CRM", "Reactivate → create CRM lead") + '</button>';
    }
  }
  if (kind === "partner") {
    body += gmPartnerReferralHtml(row);
  }
  if (kind === "finance") {
    body += '<div class="gm-derived-note">' + gmT("Tipo: ", "Type: ") +
      (row.tipo === "Entrada" ? '<span class="gm-ok">▲ Entrada</span>' : '<span class="gm-warn">▼ Saída</span>') +
      ' — ' + gmT("definido pela categoria", "set by the category") + '</div>';
  }
  body += '<button type="button" class="btn-outline gm-add-btn" style="color:var(--red);border-color:var(--red);" onclick="gmDeleteSimple()">' +
    gmT("Excluir", "Delete") + '</button>';
  gmSheetOpen(escHtml(row[spec.nameKey] || ""), body, kind + "-detail");
}

// Create: only the required fields inline, everything else after saving.
function gmRenderSimpleCreate(spec) {
  var body = "";
  var inputs = [];
  spec.fields.forEach(function(def, i) {
    if (!def.required) { return; }
    inputs.push(def);
    body += '<label class="field-label" style="margin-top:10px;">' + gmT(def.pt, def.en) + ' *</label>';
    if (def.type === "choice") {
      body += '<div class="gm-editor-input"><select id="gmNew_' + def.key + '"><option value="">—</option>';
      (def.options || []).forEach(function(opt) {
        body += '<option value="' + escHtml(opt) + '">' + escHtml(opt) + '</option>';
      });
      body += '</select></div>';
    } else if (def.type === "textarea") {
      body += '<div class="gm-editor-input"><textarea id="gmNew_' + def.key + '"></textarea></div>';
    } else {
      var t = def.type === "tel" ? "tel" : "text";
      var im = def.type === "currency" ? ' inputmode="decimal"' : "";
      body += '<div class="gm-editor-input"><input type="' + t + '"' + im + ' id="gmNew_' + def.key + '"></div>';
    }
    if (def.note) { body += '<div class="gm-derived-note">' + def.note + '</div>'; }
  });
  body += '<div class="gm-derived-note">' +
    gmT("Os demais campos podem ser preenchidos depois de salvar.", "The other fields can be filled in after saving.") + '</div>' +
    '<div class="gm-editor-actions">' +
    '<button type="button" class="btn-outline" onclick="gmSheetClose()">' + gmT("Cancelar", "Cancel") + '</button>' +
    '<button type="button" class="btn-gold" onclick="gmSimpleCreateSave()">' + gmT("Salvar", "Save") + '</button></div>';
  gmSheetOpen(spec.titleNew, body, spec.collection + "-create");
}

function gmSimpleCreateSave() {
  var spec = gmSimpleSpec(gmSheetKind);
  var payload = {};
  var missing = null;
  spec.fields.forEach(function(def) {
    if (!def.required) { return; }
    var el = document.getElementById("gmNew_" + def.key);
    var raw = el ? el.value : "";
    var value;
    if (def.type === "currency") {
      value = gmParseMoney(raw);
      if (value === null) { missing = missing || def; return; }
    } else {
      value = raw.trim();
      if (!value) { missing = missing || def; return; }
    }
    payload[def.key] = value;
  });
  if (missing) {
    window.alert(gmT("Preencha: " + missing.pt, "Fill in: " + missing.en));
    return;
  }
  if (gmSheetKind === "finance") { payload.mes = gmCurrentCycleMonth(); payload.data = gmTodayLocal(); }
  gmApi(spec.collection, { method: "POST", body: payload })
    .then(function(d) {
      gmSheetClose();
      gmToast(gmT("Salvo ✓", "Saved ✓"));
      spec.reload();
      if (gmSheetKind === "finance" || gmSheetKind === "job") { gmJobsData = null; }
    })
    .catch(function(e) { window.alert(e.message); });
}

function gmEditSimpleField(defIdx) {
  var spec = gmSimpleSpec(gmSheetKind);
  var def = spec.fields[defIdx];
  var row = gmSheetRow;
  var kind = gmSheetKind;
  if (def.type === "jobref") {
    var jobs = (gmJobsData && gmJobsData.jobs) || [];
    var names = [];
    jobs.forEach(function(j) { names.push(j.obra); });
    gmOpenFieldEditor(gmT(def.pt, def.en), "choice", row.obra_name || null, names, function(value) {
      var jid = null;
      jobs.forEach(function(j) { if (j.obra === value) { jid = j.id; } });
      gmSaveSimpleField(kind, "obra_id", jid);
    }, '<div class="gm-derived-note">' +
      gmT("A lista vem da aba Obras — o vínculo é pelo registro da obra.",
          "The list comes from the Jobs tab — the link is by job record.") + '</div>');
    return;
  }
  gmOpenFieldEditor(gmT(def.pt, def.en), def.type, row[def.key], def.options || [], function(value) {
    if (def.required && (value === null || value === "")) {
      window.alert(gmT("Este campo é obrigatório.", "This field is required."));
      gmRenderSimpleSheet(kind);
      return;
    }
    gmSaveSimpleField(kind, def.key, value);
  }, def.note ? '<div class="gm-derived-note">' + def.note + '</div>' : null);
}

function gmSaveSimpleField(kind, key, value) {
  var spec = gmSimpleSpec(kind);
  var row = gmSheetRow;
  var payload = {};
  payload[key] = value;
  gmApi(spec.collection + "/" + row.id, { method: "PUT", body: payload })
    .then(function(d) {
      var updated = d[spec.itemKey];
      if (updated) {
        var list = spec.data();
        var idx = list.indexOf(row);
        // computed fields (jobs) and joins come back on the reload below
        if (idx !== -1) {
          Object.keys(updated).forEach(function(k) { list[idx][k] = updated[k]; });
          gmSheetRow = list[idx];
        }
      }
      spec.reload();
      // reload wipes+refetches; reopen the sheet on fresh data
      var reopenId = row.id;
      var reopen = function(tries) {
        var list = spec.data && spec.data();
        var found = null;
        (list || []).forEach(function(r) { if (r.id === reopenId) { found = r; } });
        if (found) { gmSheetRow = found; gmRenderSimpleSheet(kind); }
        else if (tries > 0) { setTimeout(function() { reopen(tries - 1); }, 300); }
      };
      setTimeout(function() { reopen(8); }, 300);
    })
    .catch(function(e) { window.alert(e.message); });
}

function gmDeleteSimple() {
  var spec = gmSimpleSpec(gmSheetKind);
  var row = gmSheetRow;
  if (!window.confirm(gmT("Excluir \"" + (row[spec.nameKey] || "") + "\"? Essa ação não pode ser desfeita.",
                          "Delete \"" + (row[spec.nameKey] || "") + "\"? This cannot be undone."))) { return; }
  gmApi(spec.collection + "/" + row.id, { method: "DELETE" })
    .then(function() { gmSheetClose(); spec.reload(); })
    .catch(function(e) { window.alert(e.message); });
}

// ═════════════════════════════════════════════════════════════════════════
// QR code generator — self-contained, no CDN, no external requests.
// Byte mode, error-correction level M, versions 1-10 (auto-picked), mask
// pattern 0 applied with matching format info (spec-valid: mask choice is a
// readability optimization, not a correctness requirement). Renders SVG.
// ═════════════════════════════════════════════════════════════════════════

// GF(256) log/antilog tables (poly 0x11d) for Reed-Solomon EC codewords.
var GM_QR_EXP = [], GM_QR_LOG = [];
(function() {
  var x = 1;
  for (var i = 0; i < 255; i++) {
    GM_QR_EXP[i] = x;
    GM_QR_LOG[x] = i;
    x = x << 1;
    if (x & 0x100) { x = (x ^ 0x11d) & 0xff; }
  }
  for (var j = 255; j < 512; j++) { GM_QR_EXP[j] = GM_QR_EXP[j - 255]; }
})();

// Per-version (1-10) EC-level-M block structure:
// [ecPerBlock, [dataCodewordsPerBlock, ...]]
var GM_QR_BLOCKS_M = {
  1:  [10, [16]],
  2:  [16, [28]],
  3:  [26, [44]],
  4:  [18, [32, 32]],
  5:  [24, [43, 43]],
  6:  [16, [27, 27, 27, 27]],
  7:  [18, [31, 31, 31, 31]],
  8:  [22, [38, 38, 39, 39]],
  9:  [22, [36, 36, 36, 37, 37]],
  10: [26, [43, 43, 43, 43, 44]]
};
var GM_QR_ALIGN = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
};
// Format info for EC level M, mask 0 (BCH-encoded, spec table).
var GM_QR_FORMAT_M0 = "101010000010010";
// Version info bit strings for versions 7-10 (spec table).
var GM_QR_VERSION_INFO = {
  7: "000111110010010100", 8: "001000010110111100",
  9: "001001101010011001", 10: "001010010011010011"
};

// GF(256) polynomial multiply (coefficients as byte values, index 0 = highest term).
function gmQrPolyMul(a, b) {
  var out = [];
  for (var i = 0; i < a.length + b.length - 1; i++) { out.push(0); }
  for (var x = 0; x < a.length; x++) {
    if (a[x] === 0) { continue; }
    for (var y = 0; y < b.length; y++) {
      if (b[y] === 0) { continue; }
      out[x + y] ^= GM_QR_EXP[(GM_QR_LOG[a[x]] + GM_QR_LOG[b[y]]) % 255];
    }
  }
  return out;
}

function gmQrRsEncode(data, ecLen) {
  // Generator polynomial: product of (x - a^d) for d = 0..ecLen-1.
  var gen = [1];
  for (var d = 0; d < ecLen; d++) {
    gen = gmQrPolyMul(gen, [1, GM_QR_EXP[d]]);
  }
  // Synthetic division of data·x^ecLen by gen; remainder = EC codewords.
  var rem = data.slice();
  for (var z = 0; z < ecLen; z++) { rem.push(0); }
  for (var i = 0; i < data.length; i++) {
    var factor = rem[i];
    if (factor === 0) { continue; }
    for (var j = 0; j < gen.length; j++) {
      rem[i + j] ^= GM_QR_EXP[(GM_QR_LOG[gen[j]] + GM_QR_LOG[factor]) % 255];
    }
  }
  return rem.slice(data.length);
}

function gmQrBytes(str) {
  // UTF-8 encode.
  var out = [];
  var enc = unescape(encodeURIComponent(str));
  for (var i = 0; i < enc.length; i++) { out.push(enc.charCodeAt(i)); }
  return out;
}

function gmQrPickVersion(nBytes) {
  for (var v = 1; v <= 10; v++) {
    var spec = GM_QR_BLOCKS_M[v];
    var dataCw = 0;
    spec[1].forEach(function(n) { dataCw += n; });
    var cci = v <= 9 ? 8 : 16;
    var capacity = Math.floor((dataCw * 8 - 4 - cci) / 8);
    if (nBytes <= capacity) { return v; }
  }
  return null;
}

function gmQrBuildCodewords(bytes, version) {
  var spec = GM_QR_BLOCKS_M[version];
  var ecLen = spec[0];
  var blocks = spec[1];
  var dataCw = 0;
  blocks.forEach(function(n) { dataCw += n; });
  var cci = version <= 9 ? 8 : 16;
  // Bit stream: mode 0100, char count, data, terminator, pad.
  var bits = [];
  function push(val, len) {
    for (var i = len - 1; i >= 0; i--) { bits.push((val >> i) & 1); }
  }
  push(4, 4);
  push(bytes.length, cci);
  bytes.forEach(function(b) { push(b, 8); });
  var maxBits = dataCw * 8;
  var term = Math.min(4, maxBits - bits.length);
  push(0, term);
  while (bits.length % 8 !== 0) { bits.push(0); }
  var cw = [];
  for (var i = 0; i < bits.length; i += 8) {
    var val = 0;
    for (var j = 0; j < 8; j++) { val = (val << 1) | bits[i + j]; }
    cw.push(val);
  }
  var padToggle = true;
  while (cw.length < dataCw) { cw.push(padToggle ? 0xec : 0x11); padToggle = !padToggle; }
  // Split into blocks, compute EC, interleave.
  var dataBlocks = [], ecBlocks = [];
  var offset = 0;
  blocks.forEach(function(n) {
    var block = cw.slice(offset, offset + n);
    offset += n;
    dataBlocks.push(block);
    ecBlocks.push(gmQrRsEncode(block, ecLen));
  });
  var out = [];
  var maxData = 0;
  dataBlocks.forEach(function(b) { maxData = Math.max(maxData, b.length); });
  for (var c = 0; c < maxData; c++) {
    dataBlocks.forEach(function(b) { if (c < b.length) { out.push(b[c]); } });
  }
  for (var e = 0; e < ecLen; e++) {
    ecBlocks.forEach(function(b) { out.push(b[e]); });
  }
  return out;
}

// Build the module matrix. Returns { size, get(r,c) → 0|1 }.
function gmQrMatrix(text) {
  var bytes = gmQrBytes(text);
  var version = gmQrPickVersion(bytes.length);
  if (!version) { return null; }
  var size = version * 4 + 17;
  var modules = [], reserved = [];
  for (var r = 0; r < size; r++) {
    modules.push(new Array(size));
    reserved.push(new Array(size));
  }
  function set(r, c, v) { modules[r][c] = v ? 1 : 0; reserved[r][c] = true; }

  // Finder patterns + separators.
  function finder(r0, c0) {
    for (var r = -1; r <= 7; r++) {
      for (var c = -1; c <= 7; c++) {
        var rr = r0 + r, cc = c0 + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) { continue; }
        var on = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                 (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                 (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        set(rr, cc, on);
      }
    }
  }
  finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

  // Alignment patterns.
  var centers = GM_QR_ALIGN[version];
  centers.forEach(function(cr) {
    centers.forEach(function(cc) {
      if (reserved[cr][cc]) { return; }   // overlaps a finder
      for (var r = -2; r <= 2; r++) {
        for (var c = -2; c <= 2; c++) {
          var on = Math.max(Math.abs(r), Math.abs(c)) !== 1;
          set(cr + r, cc + c, on);
        }
      }
    });
  });

  // Timing patterns.
  for (var t = 8; t < size - 8; t++) {
    if (!reserved[6][t]) { set(6, t, t % 2 === 0); }
    if (!reserved[t][6]) { set(t, 6, t % 2 === 0); }
  }

  // Dark module.
  set(size - 8, 8, 1);

  // Reserve format info areas.
  for (var f = 0; f < 9; f++) {
    if (!reserved[8][f]) { reserved[8][f] = true; modules[8][f] = 0; }
    if (!reserved[f][8]) { reserved[f][8] = true; modules[f][8] = 0; }
  }
  for (var f2 = size - 8; f2 < size; f2++) {
    if (!reserved[8][f2]) { reserved[8][f2] = true; modules[8][f2] = 0; }
    if (!reserved[f2][8]) { reserved[f2][8] = true; modules[f2][8] = 0; }
  }

  // Reserve + write version info (v >= 7).
  if (version >= 7) {
    var vi = GM_QR_VERSION_INFO[version];
    // Bits placed LSB-first per spec: bit i at (floor(i/3), size-11 + i%3).
    for (var i = 0; i < 18; i++) {
      var bit = Number(vi.charAt(17 - i));
      var rr2 = Math.floor(i / 3), cc2 = size - 11 + (i % 3);
      set(rr2, cc2, bit);
      set(cc2, rr2, bit);
    }
  }

  // Data placement: zigzag from bottom-right, skipping column 6, mask 0.
  var codewords = gmQrBuildCodewords(bytes, version);
  var bitIdx = 0;
  var totalBits = codewords.length * 8;
  function nextBit() {
    if (bitIdx >= totalBits) { bitIdx++; return 0; }   // remainder bits = 0
    var b = (codewords[Math.floor(bitIdx / 8)] >> (7 - (bitIdx % 8))) & 1;
    bitIdx++;
    return b;
  }
  var col = size - 1;
  var upward = true;
  while (col > 0) {
    if (col === 6) { col--; }
    for (var step = 0; step < size; step++) {
      var row = upward ? size - 1 - step : step;
      for (var dc = 0; dc < 2; dc++) {
        var c2 = col - dc;
        if (reserved[row][c2]) { continue; }
        var bit = nextBit();
        // Mask 0: invert when (row + col) even.
        if ((row + c2) % 2 === 0) { bit = bit ^ 1; }
        modules[row][c2] = bit;
        reserved[row][c2] = true;
      }
    }
    upward = !upward;
    col -= 2;
  }

  // Format info (EC M, mask 0) — written last over the reserved cells.
  var fmt = GM_QR_FORMAT_M0;
  for (var fi = 0; fi < 15; fi++) {
    var fb = Number(fmt.charAt(fi));
    // Copy 1: around the top-left finder.
    if (fi < 6)       { modules[8][fi] = fb; }
    else if (fi === 6) { modules[8][7] = fb; }
    else if (fi === 7) { modules[8][8] = fb; }
    else if (fi === 8) { modules[7][8] = fb; }
    else              { modules[14 - fi][8] = fb; }
    // Copy 2: split between top-right and bottom-left.
    if (fi < 8) { modules[8][size - 1 - fi] = fb; }
    else        { modules[size - 15 + fi][8] = fb; }
  }

  return { size: size, modules: modules };
}

// SVG render with a 4-module quiet zone. Black on white, crisp rects.
function gmQrSvg(text, pixelSize) {
  var m = gmQrMatrix(text);
  if (!m) { return ""; }
  var quiet = 4;
  var dim = m.size + quiet * 2;
  var svg = '<svg class="gm-qr-svg" viewBox="0 0 ' + dim + ' ' + dim + '" ' +
    'width="' + (pixelSize || 220) + '" height="' + (pixelSize || 220) + '" ' +
    'shape-rendering="crispEdges" role="img" aria-label="QR code">' +
    '<rect width="' + dim + '" height="' + dim + '" fill="#ffffff"/>';
  for (var r = 0; r < m.size; r++) {
    var runStart = -1;
    for (var c = 0; c <= m.size; c++) {
      var on = c < m.size && m.modules[r][c] === 1;
      if (on && runStart === -1) { runStart = c; }
      if (!on && runStart !== -1) {
        svg += '<rect x="' + (runStart + quiet) + '" y="' + (r + quiet) +
          '" width="' + (c - runStart) + '" height="1" fill="#1a1a1d"/>';
        runStart = -1;
      }
    }
  }
  svg += '</svg>';
  return svg;
}

// ── Partner referral link + QR (Task: real attribution, no text match) ───
function gmReferralUrl(row) {
  if (!row || !row.referral_slug) { return null; }
  return window.location.origin + "/referral.html?p=" + row.referral_slug;
}

function gmPartnerReferralHtml(row) {
  var url = gmReferralUrl(row);
  if (!url) { return ""; }
  // Functionally unchanged (copy / share / QR / download) — restyled into the
  // same grouped-card language as the rest of the partner sheet, with real
  // icons on the buttons instead of plain text.
  return '<div class="gm-partner-section" data-tour="partners-referral-link">' +
    '<p class="gm-partner-section-title">' + gmT("Link de indicação", "Referral link") + '</p>' +
    '<div class="gm-partner-group" style="padding:13px 14px;">' +
    '<p class="muted" style="font-size:12px;margin:0 0 9px;">' +
    gmT("Quem preencher este link vira lead no CRM já vinculado a este parceiro — sem digitação manual.",
        "Anyone who fills in this link becomes a CRM lead already linked to this partner — no manual matching.") + '</p>' +
    '<div class="gm-partner-ref-url" id="gmRefUrl">' + escHtml(url) + '</div>' +
    '<div class="gm-partner-ref-actions">' +
    '<button type="button" class="gm-partner-ref-btn" onclick="gmCopyReferralLink()">' +
    gmIcon("copy") + gmT("Copiar", "Copy") + '</button>' +
    '<button type="button" class="gm-partner-ref-btn" onclick="gmShareReferralLink()">' +
    gmIcon("share") + gmT("Compartilhar", "Share") + '</button>' +
    '</div>' +
    '<div class="gm-partner-qr" data-tour="partners-referral-qr" id="gmRefQrBox">' +
    gmQrSvg(url, 200) +
    '</div>' +
    '<button type="button" class="gm-partner-ref-btn" style="width:100%;margin-top:12px;" onclick="gmDownloadReferralQr()">' +
    gmIcon("download") + gmT("Baixar QR (PNG)", "Download QR (PNG)") + '</button>' +
    '</div></div>';
}

function gmCopyReferralLink() {
  var url = gmReferralUrl(gmSheetRow);
  if (!url) { return; }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(function() {
      gmToast(gmT("Link copiado ✓", "Link copied ✓"));
    }).catch(function() { window.prompt(gmT("Copie o link:", "Copy the link:"), url); });
  } else {
    window.prompt(gmT("Copie o link:", "Copy the link:"), url);
  }
}

function gmShareReferralLink() {
  var row = gmSheetRow;
  var url = gmReferralUrl(row);
  if (!url) { return; }
  var tpl = (gmConfig && gmConfig.referral_share_template) ||
    gmT("Peça um orçamento por este link: {referralUrl}", "Request a quote through this link: {referralUrl}");
  var text = tpl.split("{referralUrl}").join(url);
  if (navigator.share) {
    navigator.share({ title: row.name, text: text, url: url }).catch(function() {});
  } else {
    window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank", "noopener");
  }
}

function gmDownloadReferralQr() {
  var row = gmSheetRow;
  var url = gmReferralUrl(row);
  if (!url) { return; }
  var box = document.getElementById("gmRefQrBox");
  var svgEl = box ? box.querySelector("svg") : null;
  if (!svgEl) { return; }
  var xml = new XMLSerializer().serializeToString(svgEl);
  var img = new Image();
  img.onload = function() {
    var canvas = document.createElement("canvas");
    canvas.width = 800; canvas.height = 800;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 800, 800);
    ctx.drawImage(img, 0, 0, 800, 800);
    var a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "qr-" + (row.referral_slug || "indicacao") + ".png";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
}

// ── Language toggle re-render (called from portal.html's toggleLang) ─────
function gmOnLangChange() {
  // Pipeline: the pills carry labels too, and only the visible section needs
  // re-rendering — the other two re-render when their pill is next tapped.
  if (gmCurrentTab === "gmcrm") {
    gmRenderPipelineSubnav();
    if (gmPipelineSection === "leads" && gmLeadsData) { gmRenderCrm(); }
    if (gmPipelineSection === "partners" && gmPartnersData) { gmRenderPartners(); }
    if (gmPipelineSection === "base" && gmBaseData) { gmRenderBase(); }
  }
  if (gmCurrentTab === "gmroadmap" && gmRoadmapData) { gmRenderRoadmap(); }
  if (gmCurrentTab === "gmfinance" && gmFinanceData) { gmRenderFinance(); }
  if (gmCurrentTab === "gmjobs" && gmJobsData) { gmRenderJobs(); }
}
