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

function gmOpenFieldEditor(label, type, value, options, onSave, extraNoteHtml) {
  gmEditorSave = onSave;
  var inner = "";
  if (type === "choice") {
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

function gmEditorCommit(type) {
  var value = null;
  if (type === "choice") {
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
    '<a class="gm-contact-btn gm-call"' + dis + ' href="tel:' + escHtml(tel || "") + '">&#9742; ' + gmT("Ligar", "Call") + '</a>' +
    '<a class="gm-contact-btn gm-wa"' + dis + ' href="https://wa.me/' + digits + '" target="_blank" rel="noopener">WhatsApp</a>' +
    '</div>';
}

// ═════════════════════════════════════════════════════════════════════════
// TAB 1 — CRM PIPELINE
// ═════════════════════════════════════════════════════════════════════════

function gmLoadCrm() {
  gmCurrentTab = "gmcrm";
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
  if (lead.servico) { parts.push(escHtml(lead.servico)); }
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

  // Quick-add FAB: a lead must be capturable in ten seconds from a truck.
  html += '<button type="button" class="gm-fab" data-tour="crm-quick-add" aria-label="' +
    gmT("Adicionar lead", "Add lead") + '" onclick="gmQuickAddOpen()">+</button>';

  body.innerHTML = html;
}

function gmPickStage(stage) {
  gmActiveStage = stage;
  gmRenderCrm();
}

// ── Quick add: THREE fields (Nome, Telefone, Serviço-as-chips) ──────────
var gmQuickServico = null;
var GM_QUICKADD_DRAFT_KEY_PREFIX = "apex_gm_quickadd_";

function gmQuickDraftKey() { return GM_QUICKADD_DRAFT_KEY_PREFIX + clientId; }

function gmQuickAddOpen() {
  var draft = {};
  try { draft = JSON.parse(localStorage.getItem(gmQuickDraftKey())) || {}; } catch (e) { draft = {}; }
  gmQuickServico = draft.servico || null;
  var servicos = gmConfig.config.servicos;
  var chips = "";
  servicos.forEach(function(s, i) {
    chips += '<button type="button" class="gm-choice-chip' + (s === gmQuickServico ? " gm-chip-sel" : "") +
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
  var wrap = document.getElementById("gmQaServicos");
  var already = btn.classList.contains("gm-chip-sel");
  wrap.querySelectorAll(".gm-choice-chip").forEach(function(c) { c.classList.remove("gm-chip-sel"); });
  if (already) { gmQuickServico = null; }
  else { btn.classList.add("gm-chip-sel"); gmQuickServico = btn.textContent; }
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
      servico: gmQuickServico
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
    servico: gmQuickServico,
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
    { key: "followups",      type: "number",   pt: "Nº follow-ups",           en: "# follow-ups" },
    { key: "data_contato",   type: "datetime", pt: "Data/hora 1º contato",    en: "1st contact date/time" },
    { key: "data_estimate",  type: "datetime", pt: "Data/hora estimate",      en: "Estimate date/time" },
    { key: "servico",        type: "choice",   pt: "Serviço",                 en: "Service",   options: cfg.servicos },
    { key: "vendedor",       type: "choice",   pt: "Vendedor",                en: "Salesperson", options: cfg.vendedores },
    { key: "origem",         type: "choice",   pt: "Origem",                  en: "Source",    options: method.origens },
    { key: "parceiro_id",    type: "partner",  pt: "Parceiro",                en: "Partner" },
    { key: "telefone",       type: "tel",      pt: "Telefone",                en: "Phone" },
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
  return escHtml(String(v));
}

function gmRenderLeadSheet() {
  var lead = gmDetailLead;
  var days = gmDaysSince(lead.stage_changed_at);
  var body = gmContactButtonsHtml(lead.telefone);
  body += '<button type="button" class="gm-field-row" data-tour="crm-stage-change" onclick="gmOpenStagePicker()">' +
    '<span style="min-width:0;flex:1;"><span class="gm-field-label">' + gmT("Estágio", "Stage") + '</span>' +
    '<div class="gm-field-value">' + gmPillHtml(lead.estagio, GM_STAGE_PILL[lead.estagio]) +
    (days !== null ? ' <span class="muted" style="font-size:11px;">' +
      (isEn() ? days + " day(s)" : days + " dia(s)") + '</span>' : "") +
    '</div></span><span class="gm-field-chev">&#9654;</span></button>';
  gmLeadFieldDefs().forEach(function(def, i) {
    body += gmFieldRowHtml(gmT(def.pt, def.en), gmLeadFieldDisplay(lead, def), "gmEditLeadField(" + i + ")");
  });
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
  gmCurrentTab = "gmbase";
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
  gmCurrentTab = "gmpartners";
  var body = document.getElementById("gmPartnersBody");
  body.innerHTML = '<div class="content-card"><p class="muted">' + gmT("Carregando…", "Loading…") + '</p></div>';
  Promise.all([gmLoadConfig(), gmLoadPartnersList()])
    .then(function() { gmRenderPartners(); })
    .catch(function(e) {
      body.innerHTML = '<div class="content-card"><p class="muted">' + escHtml(e.message) + '</p></div>';
    });
}

function gmRenderPartners() {
  var body = document.getElementById("gmPartnersBody");
  var partners = gmPartnersData.partners;
  var html = '<div class="content-card">' +
    '<div class="card-title">' + gmT("Parceiros de indicação", "Referral partners") + '</div>' +
    '<p class="muted" style="margin-bottom:8px;" data-tour="partners-attribution">' +
    gmT("Leads indicados e receita gerada são calculados automaticamente do CRM pelo vínculo do lead com o parceiro.",
        "Referred leads and revenue are calculated automatically from the CRM via each lead's partner link.") + '</p>';
  if (!partners.length) {
    html += '<p class="muted">' + gmT("Nenhum parceiro cadastrado ainda.", "No partners yet.") + '</p>';
  } else {
    partners.forEach(function(p, i) {
      html += '<button type="button" class="gm-row" data-tour="partners-row" onclick="gmOpenPartner(' + i + ')">' +
        '<span class="gm-lead-main">' +
        '<span class="gm-lead-name">' + escHtml(p.name) + '</span>' +
        '<div class="gm-lead-sub">' + [p.tipo, p.contato].filter(function(x) { return !!x; }).map(escHtml).join(" · ") + '</div>' +
        '<div class="gm-lead-sub">' + p.leads_indicados + " " + gmT("leads indicados", "referred leads") +
        ' · ' + fmtNum(p.receita_gerada, "currency") + " " + gmT("fechados", "closed") + '</div>' +
        '</span>' +
        '<span class="gm-lead-side">' + gmPillHtml(p.status, GM_STATUS_PILLS.partner[p.status]) + '</span>' +
        '</button>';
    });
  }
  html += '<button type="button" class="btn-gold gm-add-btn" data-tour="partners-add" onclick="gmOpenPartner(-1)">' +
    gmT("+ Novo parceiro", "+ New partner") + '</button></div>';
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

function gmRenderSimpleSheet(kind) {
  gmSheetKind = kind;
  var spec = gmSimpleSpec(kind);
  var row = gmSheetRow;
  if (!row) { gmRenderSimpleCreate(spec); return; }

  var body = "";
  if (spec.contactTel) { body += gmContactButtonsHtml(row.telefone); }
  spec.fields.forEach(function(def, i) {
    body += gmFieldRowHtml(gmT(def.pt, def.en), gmSimpleFieldDisplay(row, def),
      "gmEditSimpleField(" + i + ")", def.tour || null);
  });

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

// ── Language toggle re-render (called from portal.html's toggleLang) ─────
function gmOnLangChange() {
  if (gmCurrentTab === "gmcrm" && gmLeadsData) { gmRenderCrm(); }
  if (gmCurrentTab === "gmroadmap" && gmRoadmapData) { gmRenderRoadmap(); }
  if (gmCurrentTab === "gmbase" && gmBaseData) { gmRenderBase(); }
  if (gmCurrentTab === "gmpartners" && gmPartnersData) { gmRenderPartners(); }
  if (gmCurrentTab === "gmfinance" && gmFinanceData) { gmRenderFinance(); }
  if (gmCurrentTab === "gmjobs" && gmJobsData) { gmRenderJobs(); }
}
