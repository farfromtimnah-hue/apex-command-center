/* ═══════════════════════════════════════════════════════════════════════════
   analytics-view.js — the SINGLE implementation of the client Analytics view.

   Extracted verbatim from portal.html (2026-08-02) so Rafa's admin analytics
   page renders literally what the client sees, from the same code, off the
   same endpoints. There must never be a second copy of the attainment or pace
   math: if this file and portal.html ever disagree, the admin view stops being
   "what the client sees" and the whole feature is a lie in a meeting.

   Contract — the host page supplies its own environment, nothing is global:

     ApexAnalyticsView.create({
       clientId : string,               // client whose analytics to render
       fetch    : function(path)        // -> Promise<Response>, host's apiFetch
       isEn     : function()            // -> bool, host's language state
       root     : HTMLElement            // container; the view owns its innards
       showPace : bool                  // pace card ("Como estou indo?")
       showChartB : bool                 // month-over-month trend card
       onMonthChange : function(month)   // optional notify for host chrome
       helpRequest : {template, clientName} | null
                                         // client portal only — renders the
                                         // "Pedir ajuda com esta área" CTA.
                                         // The admin view omits it.
     })

   Returns a controller: { load(), setMonth(m), getMonth(), destroy() }.

   Every DOM id is scoped per-instance so two views could coexist on one page
   without colliding.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  var SECTION_ORDER = ["financeiro", "clientes_mercado", "processos", "crescimento", "rotina"];
  var SECTION_LABELS = {
    financeiro:       { pt: "Financeiro",          en: "Financial" },
    clientes_mercado: { pt: "Clientes & Mercado",  en: "Clients & Market" },
    processos:        { pt: "Processos",           en: "Processes" },
    crescimento:      { pt: "Crescimento",         en: "Growth" },
    rotina:           { pt: "Rotina",              en: "Routine" }
  };

  function escHtml(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function fmtNumAmerican(n) {
    var rounded = Math.round(n * 100) / 100;
    var neg = rounded < 0;
    var abs = Math.abs(rounded);
    var parts = String(abs).split(".");
    var intPart = parts[0];
    var decPart = parts.length > 1 ? parts[1].slice(0, 2) : "";
    var grouped = "";
    for (var i = 0; i < intPart.length; i++) {
      if (i > 0 && (intPart.length - i) % 3 === 0) { grouped += ","; }
      grouped += intPart.charAt(i);
    }
    var out = grouped + (decPart ? "." + decPart : "");
    return neg ? "-" + out : out;
  }

  function fmtNum(v, type) {
    if (v === null || v === undefined) { return "--"; }
    var n = Number(v);
    if (isNaN(n)) { return "--"; }
    if (type === "currency") { return "$" + fmtNumAmerican(n); }
    if (type === "percent")  { return fmtNumAmerican(n) + "%"; }
    return fmtNumAmerican(n);
  }

  // Attainment % — the client's proven formulas, uncapped (150% shows 150%).
  // Direct: (realizado/meta)*100. Inverse (lower is better): 100 when within
  // target, else (meta/realizado)*100 — the Worker's leaderboard formula.
  function attainmentPct(ind) {
    var meta = ind.meta_mensal;
    if (meta === null || meta === undefined || meta === 0 ||
        ind.realizado === null || ind.realizado === undefined) { return null; }
    if (ind.inverse) {
      return ind.realizado <= meta ? 100 : Math.round((meta / ind.realizado) * 100);
    }
    return Math.round((ind.realizado / meta) * 100);
  }

  // Red < 50, yellow 50-79, green >= 80. The glyph carries the status in
  // grayscale too (WCAG 1.4.1): ▼ red, ● yellow, ▲ green.
  function pctBand(pct) { return pct < 50 ? "red" : pct < 80 ? "yellow" : "green"; }

  function pillHtml(pct) {
    if (pct === null) { return ""; }
    var band = pctBand(pct);
    var glyph = band === "red" ? "▼" : band === "yellow" ? "●" : "▲";
    return '<span class="att-pill ' + band + '">' + glyph + ' ' + pct + '%</span>';
  }

  function indPctType(ind) {
    return (ind.key === "margem_lucro" || ind.key === "taxa_conversao" || ind.key === "metas_batidas")
      ? "percent" : ind.type;
  }

  // Aggregate attainment — mean of per-indicator attainment across enabled
  // indicators that have a target, each contribution capped at 100 so one
  // indicator at 300% cannot mask four at 20%. This cap applies ONLY to
  // aggregate figures (overall bar, section summary pills); an individual
  // indicator's own pill stays uncapped (150% still shows 150%).
  function cappedMeanPct(indicators) {
    var sum = 0, n = 0;
    indicators.forEach(function (ind) {
      var pct = attainmentPct(ind);
      if (pct !== null) { sum += Math.min(100, pct); n++; }
    });
    return n ? Math.round(sum / n) : null;
  }

  function withAttainment(indicators) {
    var out = [];
    indicators.forEach(function (ind) {
      var pct = attainmentPct(ind);
      if (pct !== null) { out.push({ ind: ind, pct: pct }); }
    });
    return out;
  }

  function pacePaceable(ind) {
    if (ind.inverse) { return false; }
    if (ind.key === "dias_rotina_completos") { return true; }
    return ind.type === "count" || ind.type === "currency";
  }

  function paceEligible(ind) {
    return ind.meta_mensal !== null && ind.meta_mensal !== undefined;
  }

  // Expose the pure math so callers (e.g. the cross-client average) reuse it
  // rather than re-deriving attainment — same reason this file exists at all.
  var PURE = {
    attainmentPct: attainmentPct, cappedMeanPct: cappedMeanPct,
    withAttainment: withAttainment, pctBand: pctBand, pillHtml: pillHtml,
    indPctType: indPctType, fmtNum: fmtNum, escHtml: escHtml,
    SECTION_ORDER: SECTION_ORDER, SECTION_LABELS: SECTION_LABELS
  };

  function create(opts) {
    var clientId = opts.clientId;
    var apiFetch = opts.fetch;
    var isEn     = opts.isEn || function () { return document.body.classList.contains("lang-en"); };
    var root     = opts.root;
    var showPace = opts.showPace !== false;
    var showChartB = opts.showChartB !== false;
    var onMonthChange = opts.onMonthChange || function () {};
    // Client-portal only: {template, clientName}. Omitted by the admin view.
    var helpRequest = opts.helpRequest || null;

    var uid = "av" + Math.floor(Math.random() * 1e9).toString(36);
    function id(suffix) { return uid + "_" + suffix; }
    function el(suffix) { return document.getElementById(id(suffix)); }

    function todayStr() {
      var d = new Date();
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
        "-" + String(d.getDate()).padStart(2, "0");
    }

    var analyticsMonth = todayStr().slice(0, 7);
    var analyticsIndicators = [];
    var sectionShowAll = {};
    var destroyed = false;

    function monthLabelText(month) {
      var p = month.split("-");
      var names = isEn()
        ? ["January","February","March","April","May","June","July","August","September","October","November","December"]
        : ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
      return names[Number(p[1]) - 1] + " " + p[0];
    }

    function chartBMonthShort(m) {
      var namesPt = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
      var namesEn = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      return (isEn() ? namesEn : namesPt)[Number(m.split("-")[1]) - 1];
    }

    // ── Shell ──────────────────────────────────────────────────────────────
    root.innerHTML =
      (showPace
        ? '<div class="content-card" id="' + id("paceCard") + '" hidden>' +
          '<div class="card-title">' +
          '<span class="show-pt">Como estou indo?</span>' +
          '<span class="show-en">How am I doing?</span></div>' +
          '<div id="' + id("paceBody") + '"></div></div>'
        : "") +
      '<div class="content-card">' +
      '<div class="month-nav">' +
      '<button type="button" id="' + id("prevMonth") + '">&lsaquo;</button>' +
      '<div class="month-label" id="' + id("monthLabel") + '"></div>' +
      '<button type="button" id="' + id("nextMonth") + '">&rsaquo;</button>' +
      '</div>' +
      '<div class="muted" id="' + id("analyticsMeta") + '"></div>' +
      '<div id="' + id("chartABody") + '"></div>' +
      '<div id="' + id("analyticsBody") + '"></div>' +
      '</div>' +
      (showChartB
        ? '<div class="content-card">' +
          '<div class="card-title">' +
          '<span class="show-pt">Evolu&ccedil;&atilde;o m&ecirc;s a m&ecirc;s</span>' +
          '<span class="show-en">Month-over-month trend</span></div>' +
          '<select class="chart-b-picker" id="' + id("chartBPicker") + '"></select>' +
          '<div id="' + id("chartBBody") + '"></div></div>'
        : "") +
      "";

    el("prevMonth").addEventListener("click", function () { changeMonth(-1); });
    el("nextMonth").addEventListener("click", function () { changeMonth(1); });
    if (showChartB) {
      el("chartBPicker").addEventListener("change", loadChartB);
    }

    // Delegated so re-rendered innerHTML never needs re-binding.
    root.addEventListener("click", function (ev) {
      var t = ev.target.closest("[data-av-action]");
      if (!t || !root.contains(t)) { return; }
      var action = t.getAttribute("data-av-action");
      var value  = t.getAttribute("data-av-value");
      if (action === "toggleSection")     { toggleSection(value); }
      else if (action === "toggleShowAll"){ toggleSectionShowAll(value); }
      else if (action === "pacePick")     { pacePick(value); }
      else if (action === "askHelp")      { paceAskHelp(); }
    });

    function changeMonth(delta) {
      var p = analyticsMonth.split("-");
      var d = new Date(Number(p[0]), Number(p[1]) - 1 + delta, 1);
      analyticsMonth = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
      onMonthChange(analyticsMonth);
      loadAnalytics();
    }

    // ── Overview (Chart A) ─────────────────────────────────────────────────
    function renderOverview(indicators) {
      var box = el("chartABody");
      var withPct = withAttainment(indicators);
      if (!withPct.length) {
        box.innerHTML = '<p class="muted">' + (isEn()
          ? "No goals set for this month yet. Set your goals in the Goals tab."
          : "Nenhuma meta definida para este mês ainda. Defina suas metas na aba Metas.") + '</p>';
        return;
      }
      var onTrack = withPct.filter(function (x) { return x.pct >= 80; }).length;
      var overall = cappedMeanPct(indicators);
      var band = pctBand(overall);
      var glyph = band === "red" ? "▼" : band === "yellow" ? "●" : "▲";
      var html = '<div class="overview-count">' +
        (isEn() ? onTrack + " of " + withPct.length + " goals on track"
                : onTrack + " de " + withPct.length + " metas no caminho certo") + '</div>' +
        '<div class="chart-a-track"><div class="chart-a-fill ' + band + '" style="width:' + overall + '%"></div></div>' +
        '<div class="overview-pct">' + glyph + ' ' + overall + '% ' +
        (isEn() ? "overall" : "geral") + '</div>';

      var wins = withPct.filter(function (x) { return x.pct >= 80; });
      if (wins.length) {
        wins.sort(function (a, b) { return b.pct - a.pct; });
        html += '<div class="wins-title">' + (isEn() ? "Your wins" : "Seus destaques") + '</div>' +
          '<div class="wins-strip">';
        wins.slice(0, 3).forEach(function (x) {
          html += '<span class="win-chip">' + escHtml(isEn() ? x.ind.label_en : x.ind.label_pt) +
            ' ▲ ' + x.pct + '%</span>';
        });
        html += '</div>';
      }
      box.innerHTML = html;
    }

    // Per-section collapse, persisted per client (same storage key the portal
    // uses, so Rafa's view opens the way the client's own view would).
    function sectionCollapseKey() { return "apex_portal_collapsed_" + clientId; }
    function getCollapsedSections() {
      try { return JSON.parse(localStorage.getItem(sectionCollapseKey())) || {}; }
      catch (e) { return {}; }
    }
    function toggleSection(sec) {
      var c = getCollapsedSections();
      if (c[sec]) { delete c[sec]; } else { c[sec] = true; }
      try { localStorage.setItem(sectionCollapseKey(), JSON.stringify(c)); } catch (e) {}
      renderAnalyticsBody();
    }
    function toggleSectionShowAll(sec) {
      sectionShowAll[sec] = !sectionShowAll[sec];
      renderAnalyticsBody();
    }

    function kpiCardHtml(ind) {
      var pct = attainmentPct(ind);
      var pctType = indPctType(ind);
      var html = '<div class="kpi-card">' +
        '<div class="kpi-name">' + escHtml(isEn() ? ind.label_en : ind.label_pt) + '</div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
        '<div class="kpi-value">' + fmtNum(ind.realizado, pctType) + '</div>' +
        pillHtml(pct) + '</div>';
      if (ind.meta_mensal !== null && ind.meta_mensal !== undefined) {
        html += '<div class="kpi-meta-row"><span>Meta: ' + fmtNum(ind.meta_mensal, pctType) + '</span>' +
          '<span>Falta: ' + fmtNum(ind.falta, pctType) + '</span></div>';
      }
      if (ind.goal_status === "pending" && ind.proposed_value !== null && ind.proposed_value !== undefined) {
        html += '<div class="kpi-pending-note">' +
          (isEn()
            ? "Proposed goal: " + fmtNum(ind.proposed_value, pctType) + " (awaiting approval)"
            : "Meta proposta: " + fmtNum(ind.proposed_value, pctType) + " (aguardando aprovação)") +
          '</div>';
      }
      return html + '</div>';
    }

    // BSC sections in fixed canonical order (never reordered by performance),
    // worst-first inside each section, 8 shown + "Ver todos (N)" per section,
    // then the "Precisa de atenção" focus list (< 50%, worst-first).
    function renderAnalyticsBody() {
      var collapsed = getCollapsedSections();
      var bySection = {};
      analyticsIndicators.forEach(function (ind) {
        (bySection[ind.section] = bySection[ind.section] || []).push(ind);
      });
      var html = "";
      SECTION_ORDER.forEach(function (sec) {
        var list = bySection[sec];
        if (!list || !list.length) { return; }
        list.sort(function (a, b) {
          var pa = attainmentPct(a), pb = attainmentPct(b);
          if (pa === null && pb === null) { return 0; }
          if (pa === null) { return 1; }
          if (pb === null) { return -1; }
          return pa - pb;
        });
        var isOpen = !collapsed[sec];
        var secPct = cappedMeanPct(list);
        html += '<button type="button" class="kpi-section-head" aria-expanded="' + (isOpen ? "true" : "false") +
          '" data-av-action="toggleSection" data-av-value="' + sec + '">' +
          '<span class="kpi-section-title">' + escHtml(isEn() ? SECTION_LABELS[sec].en : SECTION_LABELS[sec].pt) + '</span>' +
          '<span class="section-head-right">' + pillHtml(secPct) +
          '<span class="section-chevron">' + (isOpen ? "▼" : "►") + '</span></span>' +
          '</button>';
        if (!isOpen) { return; }
        var shown = (list.length > 8 && !sectionShowAll[sec]) ? list.slice(0, 8) : list;
        html += '<div class="kpi-grid">';
        shown.forEach(function (ind) { html += kpiCardHtml(ind); });
        html += '</div>';
        if (list.length > 8) {
          html += '<button type="button" class="btn-expand" style="margin-top:8px;" ' +
            'data-av-action="toggleShowAll" data-av-value="' + sec + '">' +
            (sectionShowAll[sec]
              ? (isEn() ? "Show less" : "Mostrar menos")
              : (isEn() ? "Show all (" + list.length + ")" : "Ver todos (" + list.length + ")")) +
            '</button>';
        }
      });

      var attention = withAttainment(analyticsIndicators).filter(function (x) { return x.pct < 50; });
      if (attention.length) {
        attention.sort(function (a, b) { return a.pct - b.pct; });
        html += '<div class="attention-title">' +
          (isEn() ? "Needs attention" : "Precisa de atenção") + '</div>' +
          '<div class="attention-sub">' + (isEn() ? "Focus here first" : "Foque aqui primeiro") + '</div>';
        attention.forEach(function (x) {
          var ind = x.ind;
          var pctType = indPctType(ind);
          var band = pctBand(x.pct);
          html += '<div class="chart-a-row">' +
            '<div class="chart-a-head"><span class="chart-a-label">' + escHtml(isEn() ? ind.label_en : ind.label_pt) + '</span>' +
            pillHtml(x.pct) + '</div>' +
            '<div class="chart-a-track"><div class="chart-a-fill ' + band + '" style="width:' + Math.min(100, x.pct) + '%"></div></div>' +
            '<div class="chart-a-sub">Meta: ' + fmtNum(ind.meta_mensal, pctType) +
            ' · Falta: ' + fmtNum(ind.falta, pctType) + '</div>' +
            '</div>';
        });
      }

      el("analyticsBody").innerHTML = html ||
        '<p class="muted">' + (isEn() ? "No indicators enabled." : "Nenhum indicador habilitado.") + '</p>';
    }

    function loadAnalytics() {
      el("monthLabel").textContent = monthLabelText(analyticsMonth);
      return apiFetch("/api/clients/" + clientId + "/entries-summary?month=" + analyticsMonth)
        .then(function (res) { return res.json(); })
        .then(function (d) {
          if (destroyed) { return; }
          el("analyticsMeta").textContent = (isEn()
            ? d.completed_days + " completed day(s) this month"
            : d.completed_days + " dia(s) completo(s) neste mês");
          analyticsIndicators = d.indicators || [];
          renderOverview(analyticsIndicators);
          renderAnalyticsBody();
          if (showChartB) { populateChartBPicker(); }
        })
        .catch(function () {});
    }

    // ── Pace card ("Como estou indo?") ─────────────────────────────────────
    var paceSummary = null, paceWd = null, paceSelectedKey = null;
    var paceChartCache = {};
    var paceTrackingStartRaw = null;   // from entry-state; drives new/established

    // New/established framing: an established client (60+ days tracked)
    // responds better to seeing the open gap; a newer one to what they've
    // already accomplished. Adjusts EMPHASIS only — all four tiles always show.
    function paceEstablished() {
      if (!paceTrackingStartRaw) { return false; }
      var t = Date.parse(paceTrackingStartRaw + "T12:00:00Z");
      return isFinite(t) && (Date.now() - t) >= 60 * 24 * 3600 * 1000;
    }

    function paceInds() {
      if (!paceSummary) { return []; }
      return paceSummary.indicators.filter(paceEligible);
    }

    function paceFmtValue(ind, v, ceil) {
      if (v === null || v === undefined) { return "--"; }
      if (ind.type === "currency") { return fmtNum(Math.round(v * 100) / 100, "currency"); }
      var n = ceil ? Math.ceil(v) : Math.round(v * 10) / 10;
      return fmtNum(n, indPctType(ind));
    }

    function paceStatusHtml(band, glyph, pt, en) {
      return '<span class="pace-status ' + band + '">' + glyph + ' ' +
        '<span class="show-pt">' + pt + '</span><span class="show-en">' + en + '</span></span>';
    }

    // Pinned to the CURRENT month: pace has no meaning for past months.
    function loadPace() {
      var cm = todayStr().slice(0, 7);
      return Promise.all([
        apiFetch("/api/clients/" + clientId + "/entries-summary?month=" + cm)
          .then(function (r) { if (!r.ok) { throw new Error("HTTP " + r.status); } return r.json(); }),
        apiFetch("/api/clients/" + clientId + "/working-days?month=" + cm + "&today=" + todayStr())
          .then(function (r) { if (!r.ok) { throw new Error("HTTP " + r.status); } return r.json(); }),
        // Non-fatal: only drives the new/established emphasis.
        apiFetch("/api/clients/" + clientId + "/entry-state?today=" + todayStr())
          .then(function (r) { return r.ok ? r.json() : null; })
          .catch(function () { return null; })
      ]).then(function (results) {
        if (destroyed) { return; }
        paceSummary = results[0];
        paceWd = results[1];
        paceTrackingStartRaw = (results[2] && results[2].tracking_start_raw) || null;
        renderPaceCard();
      }).catch(function () {
        var c = el("paceCard");
        if (c) { c.hidden = true; }
      });
    }

    function renderPaceCard() {
      var card = el("paceCard");
      var body = el("paceBody");
      if (!card || !body) { return; }
      var inds = paceInds();
      if (!paceSummary || !paceWd || !inds.length) { card.hidden = true; return; }
      card.hidden = false;
      if (!paceSelectedKey || !inds.some(function (x) { return x.key === paceSelectedKey; })) {
        paceSelectedKey = inds[0].key;
      }

      var overall = cappedMeanPct(paceSummary.indicators);
      var expected = paceWd.total ? Math.round((paceWd.elapsed / paceWd.total) * 100) : null;
      var html = "";
      if (overall !== null && expected !== null) {
        var good = overall >= expected - 10;
        html += '<div class="pace-head-line">' +
          (good
            ? '<span style="color:#2f6b3e;">▲ <span class="show-pt">Você está indo bem este mês.</span><span class="show-en">You are doing well this month.</span></span>'
            : '<span style="color:#8a6d1d;">● <span class="show-pt">Alguns pontos precisam de atenção.</span><span class="show-en">Some areas need attention.</span></span>') +
          '</div>';
      }

      html += '<div class="pace-rail">';
      inds.forEach(function (ind) {
        html += '<button type="button" class="pace-chip' + (ind.key === paceSelectedKey ? " active" : "") +
          '" data-av-action="pacePick" data-av-value="' + escHtml(ind.key) + '">' +
          escHtml(isEn() ? ind.label_en : ind.label_pt) + '</button>';
      });
      html += '</div>';

      var sel = null;
      inds.forEach(function (x) { if (x.key === paceSelectedKey) { sel = x; } });
      html += paceDetailHtml(sel);
      body.innerHTML = html;
      // Unconditional: the chart is part of the card, not a disclosure.
      paceRenderChart();
    }

    function paceDetailHtml(ind) {
      if (!ind) { return ""; }
      var html = "";
      var established = paceEstablished();

      if (pacePaceable(ind)) {
        var meta = ind.meta_mensal;
        var achieved = ind.realizado === null || ind.realizado === undefined ? 0 : ind.realizado;
        var left = ind.falta === null || ind.falta === undefined ? Math.max(0, meta - achieved) : ind.falta;
        var todayNeed = paceWd.remaining > 0 ? left / paceWd.remaining : null;
        var avgDay = paceWd.elapsed > 0 ? achieved / paceWd.elapsed : null;
        var hit = left <= 0;

        // Big pair: Hoje vs Média por dia — the comparison IS the answer.
        html += '<div class="pace-grid" data-tour="pace-tiles">' +
          '<div class="pace-tile pace-tile-big"><div class="pace-tile-label">' +
          '<span class="show-pt">Hoje</span><span class="show-en">Today</span></div>' +
          '<div class="pace-tile-value">' + (hit ? "✓" : paceFmtValue(ind, todayNeed, true)) + '</div>' +
          '<div class="pace-tile-sub">' +
          (hit
            ? '<span class="show-pt">meta do mês já batida</span><span class="show-en">monthly goal already hit</span>'
            : (paceWd.remaining > 0
              ? '<span class="show-pt">por dia útil para bater a meta (' + paceWd.remaining + ' restantes)</span>' +
                '<span class="show-en">per working day to hit the goal (' + paceWd.remaining + ' left)</span>'
              : '<span class="show-pt">sem dias úteis restantes no mês</span><span class="show-en">no working days left this month</span>')) +
          '</div></div>' +
          '<div class="pace-tile pace-tile-big"><div class="pace-tile-label">' +
          '<span class="show-pt">Média por dia</span><span class="show-en">Average per day</span></div>' +
          '<div class="pace-tile-value">' + paceFmtValue(ind, avgDay, false) + '</div>' +
          '<div class="pace-tile-sub"><span class="show-pt">seu ritmo até agora (' + paceWd.elapsed + ' dias úteis)</span>' +
          '<span class="show-en">your pace so far (' + paceWd.elapsed + ' working days)</span></div></div>' +
          '</div>';

        // One aggregated judgment for the pair — color + glyph + word.
        if (hit) {
          html += paceStatusHtml("ok", "✓", "Meta batida!", "Goal hit!");
        } else if (avgDay !== null && todayNeed !== null) {
          html += avgDay >= todayNeed
            ? paceStatusHtml("ok", "▲", "No ritmo certo", "On pace")
            : paceStatusHtml("warn", "●", "Precisa acelerar um pouco", "Needs a little push");
        }

        // Secondary pair: Realizado / Falta — emphasis follows the framing.
        html += '<div class="pace-grid">' +
          '<div class="pace-tile' + (!established ? " pace-emph" : "") + '"><div class="pace-tile-label">' +
          '<span class="show-pt">Realizado</span><span class="show-en">Achieved</span></div>' +
          '<div class="pace-tile-value">' + paceFmtValue(ind, achieved, false) + '</div>' +
          (!established
            ? '<div class="pace-tile-sub"><span class="show-pt">olha o que você já construiu</span><span class="show-en">look what you have built already</span></div>'
            : '') +
          '</div>' +
          '<div class="pace-tile' + (established ? " pace-emph" : "") + '"><div class="pace-tile-label">' +
          '<span class="show-pt">Falta</span><span class="show-en">Left</span></div>' +
          '<div class="pace-tile-value">' + paceFmtValue(ind, left, false) + '</div>' +
          (established
            ? '<div class="pace-tile-sub"><span class="show-pt">é isso que separa você da meta</span><span class="show-en">this is what stands between you and the goal</span></div>'
            : '') +
          '</div></div>';
        html += '<div class="muted" style="font-size:11px;margin-top:8px;">' +
          '<span class="show-pt">Meta do mês: ' + paceFmtValue(ind, ind.meta_mensal, false) + ' · dias úteis: ' + paceWd.total + '</span>' +
          '<span class="show-en">Monthly goal: ' + paceFmtValue(ind, ind.meta_mensal, false) + ' · working days: ' + paceWd.total + '</span></div>';
      } else if (ind.inverse && ind.type === "currency") {
        // Inverse money metric (saida): the meta is a spending CEILING, not a
        // target to reach. "Spend $X more per day to hit the goal" is
        // backwards here — the Hoje tile shows remaining budget per working
        // day, and being under the monthly figure reads as good.
        var limit = ind.meta_mensal;
        var spent = ind.realizado === null || ind.realizado === undefined ? 0 : ind.realizado;
        // ind.falta for inverse metrics is the OVERAGE (see Worker), so the
        // remaining budget is computed here.
        var budgetLeft = Math.max(0, limit - spent);
        var overBudget = spent > limit;
        var todayBudget = paceWd.remaining > 0 ? budgetLeft / paceWd.remaining : null;
        var spendPace = paceWd.elapsed > 0 ? spent / paceWd.elapsed : null;

        html += '<div class="pace-grid" data-tour="pace-tiles">' +
          '<div class="pace-tile pace-tile-big"><div class="pace-tile-label">' +
          '<span class="show-pt">Hoje</span><span class="show-en">Today</span></div>' +
          '<div class="pace-tile-value">' + (overBudget ? paceFmtValue(ind, 0, false) : paceFmtValue(ind, todayBudget, false)) + '</div>' +
          '<div class="pace-tile-sub">' +
          (overBudget
            ? '<span class="show-pt">orçamento do mês esgotado</span><span class="show-en">monthly budget used up</span>'
            : (paceWd.remaining > 0
              ? '<span class="show-pt">disponível por dia útil até o fim do mês (' + paceWd.remaining + ' restantes)</span>' +
                '<span class="show-en">available per working day until month end (' + paceWd.remaining + ' left)</span>'
              : '<span class="show-pt">sem dias úteis restantes no mês</span><span class="show-en">no working days left this month</span>')) +
          '</div></div>' +
          '<div class="pace-tile pace-tile-big"><div class="pace-tile-label">' +
          '<span class="show-pt">Média por dia</span><span class="show-en">Average per day</span></div>' +
          '<div class="pace-tile-value">' + paceFmtValue(ind, spendPace, false) + '</div>' +
          '<div class="pace-tile-sub"><span class="show-pt">seu ritmo de gastos (' + paceWd.elapsed + ' dias úteis)</span>' +
          '<span class="show-en">your spending pace (' + paceWd.elapsed + ' working days)</span></div></div>' +
          '</div>';

        if (overBudget) {
          html += paceStatusHtml("bad", "▼", "Acima do orçamento", "Over budget");
        } else if (spendPace !== null && paceWd.total > 0 && spendPace * paceWd.total > limit) {
          html += paceStatusHtml("warn", "●", "Ritmo de gastos alto", "Spending pace is high");
        } else {
          html += paceStatusHtml("ok", "✓", "Dentro do orçamento", "Within budget");
        }

        html += '<div class="pace-grid">' +
          '<div class="pace-tile"><div class="pace-tile-label">' +
          '<span class="show-pt">Gasto</span><span class="show-en">Spent</span></div>' +
          '<div class="pace-tile-value">' + paceFmtValue(ind, spent, false) + '</div></div>' +
          '<div class="pace-tile pace-emph"><div class="pace-tile-label">' +
          '<span class="show-pt">Disponível</span><span class="show-en">Available</span></div>' +
          '<div class="pace-tile-value">' + paceFmtValue(ind, budgetLeft, false) + '</div>' +
          '<div class="pace-tile-sub"><span class="show-pt">quanto ainda cabe no orçamento do mês</span>' +
          '<span class="show-en">how much still fits in this month\'s budget</span></div>' +
          '</div></div>';
        html += '<div class="muted" style="font-size:11px;margin-top:8px;">' +
          '<span class="show-pt">Limite do mês: ' + paceFmtValue(ind, limit, false) + ' · dias úteis: ' + paceWd.total + '</span>' +
          '<span class="show-en">Monthly limit: ' + paceFmtValue(ind, limit, false) + ' · working days: ' + paceWd.total + '</span></div>';
      } else {
        // Ratio/average/inverse metric: a fabricated daily pace would be
        // meaningless — current vs target + status (word + glyph + color).
        var pctType = indPctType(ind);
        var cur = ind.realizado;
        var target = ind.meta_mensal;
        html += '<div class="pace-grid" data-tour="pace-tiles">' +
          '<div class="pace-tile pace-tile-big"><div class="pace-tile-label">' +
          '<span class="show-pt">Atual</span><span class="show-en">Current</span></div>' +
          '<div class="pace-tile-value">' + fmtNum(cur, pctType) + '</div></div>' +
          '<div class="pace-tile pace-tile-big"><div class="pace-tile-label">' +
          '<span class="show-pt">Meta</span><span class="show-en">Target</span></div>' +
          '<div class="pace-tile-value">' + fmtNum(target, pctType) + '</div></div>' +
          '</div>';
        if (cur !== null && cur !== undefined && target !== null && target !== undefined) {
          var onTarget = ind.inverse ? cur <= target : cur >= target;
          html += onTarget
            ? paceStatusHtml("ok", "✓", "Na meta", "On target")
            : (ind.inverse
              ? paceStatusHtml("bad", "▼", "Acima do limite da meta", "Above the target limit")
              : paceStatusHtml("warn", "●", "Abaixo da meta", "Below target"));
        }
        html += '<div class="muted" style="font-size:11px;margin-top:8px;">' +
          '<span class="show-pt">Indicador de proporção — acompanhado por valor atual, não por ritmo diário.</span>' +
          '<span class="show-en">Ratio-style indicator — tracked by current value, not a daily pace.</span></div>';
      }

      // Client-only CTA. The admin view passes no helpRequest option, so
      // Rafa never sees a "ask for help" button on his own screen.
      if (helpRequest) {
        html += '<button type="button" class="btn-gold" style="width:100%;margin-top:10px;min-height:48px;" ' +
          'data-av-action="askHelp">' +
          '<span class="show-pt">Pedir ajuda com esta área</span>' +
          '<span class="show-en">Ask for help with this area</span></button>';
      }

      // Pace chart: ALWAYS visible (Nicole 2026-08-02). Never add a
      // show/hide/collapse control to #paceChartBox and never start it
      // hidden — it renders on load and re-renders on every area switch.
      // This is the pace card's per-category chart; the growth card's
      // chart carries the same no-hide invariant separately.
      html += '<div id="' + id("paceChartBox") + '" style="margin-top:12px;"></div>';

      return html;
    }

    function paceAskHelp() {
      if (!helpRequest) { return; }
      var inds = paceInds();
      var sel = null;
      inds.forEach(function(x) { if (x.key === paceSelectedKey) { sel = x; } });
      if (!sel) { return; }
      var values = {};
      if (pacePaceable(sel)) {
        var meta = sel.meta_mensal;
        var achieved = sel.realizado === null || sel.realizado === undefined ? 0 : sel.realizado;
        var left = sel.falta === null || sel.falta === undefined ? Math.max(0, meta - achieved) : sel.falta;
        values["Realizado"] = paceFmtValue(sel, achieved, false);
        values["Falta"] = paceFmtValue(sel, left, false);
        values["Hoje"] = paceWd.remaining > 0 ? paceFmtValue(sel, left / paceWd.remaining, true) : "--";
        values["Média/dia"] = paceWd.elapsed > 0 ? paceFmtValue(sel, achieved / paceWd.elapsed, false) : "--";
      } else if (sel.inverse && sel.type === "currency") {
        var spentH = sel.realizado === null || sel.realizado === undefined ? 0 : sel.realizado;
        values["Gasto"] = paceFmtValue(sel, spentH, false);
        values["Disponível"] = paceFmtValue(sel, Math.max(0, sel.meta_mensal - spentH), false);
        values["Limite"] = paceFmtValue(sel, sel.meta_mensal, false);
      } else {
        values["Atual"] = fmtNum(sel.realizado, indPctType(sel));
        values["Meta"] = fmtNum(sel.meta_mensal, indPctType(sel));
      }
      // iOS Safari requires a popup's destination URL to be set synchronously
      // inside the user gesture — an about:blank tab navigated later stays
      // blank. The wa.me URL only depends on clientName + label (both already
      // known here, and /api/portal/me returns the same clients.name the
      // Worker uses), so build it locally, open the tab with the final URL
      // in the tap itself, and create the consultant task in the background.
      var label = isEn() ? sel.label_en : sel.label_pt;
      var helpTemplate = (helpRequest.template) ||
        "Oi Rafa! Aqui é {clientName}. Preciso de ajuda com \"{label}\" no Portal Apex. Os números estão na sua aba de tarefas.";
      var waText = helpTemplate
        .split("{clientName}").join(helpRequest.clientName || "")
        .split("{label}").join(label);
      var tab = window.open("https://wa.me/?text=" + encodeURIComponent(waText), "_blank");
      if (!tab) {
        window.alert(isEn() ? "Popup blocked — allow popups and try again." : "Popup bloqueado — permita popups e tente de novo.");
        return;
      }
      apiFetch("/api/clients/" + clientId + "/help-request", {
        method: "POST",
        body: {
          category_label: label,
          month: todayStr().slice(0, 7),
          values: values
        }
      })
        .then(function(res) { return res.json().then(function(d) { return { ok: res.ok, data: d }; }); })
        .then(function(r) {
          if (!r.ok) { throw new Error(r.data.error || "Error"); }
          window.alert(isEn()
            ? "Help request sent — Rafa was notified and will see your numbers."
            : "Pedido de ajuda enviado — o Rafa foi avisado e vai ver seus números.");
        })
        .catch(function(e) {
          window.alert(isEn()
            ? "The WhatsApp message opened, but saving your numbers for Rafa failed: " + e.message
            : "O WhatsApp abriu, mas não foi possível salvar seus números para o Rafa: " + e.message);
        });
    }

    // Switching areas re-renders the chart for the newly selected area. It
    // must NOT hide it — see the no-hide invariant in paceDetailHtml().
    function pacePick(key) {
      paceSelectedKey = key;
      renderPaceCard();
    }

    function paceRenderChart() {
      var box = el("paceChartBox");
      if (!box) { return; }
      var key = paceSelectedKey;
      if (paceChartCache[key]) {
        box.innerHTML = trendChartHtml(paceChartCache[key]);
        return;
      }
      box.innerHTML = '<p class="muted">' + (isEn() ? "Loading…" : "Carregando…") + '</p>';
      apiFetch("/api/clients/" + clientId + "/indicator-history?indicator=" + encodeURIComponent(key) + "&months=12")
        .then(function (res) { return res.json(); })
        .then(function (d) {
          paceChartCache[key] = d;
          if (paceSelectedKey === key) {
            var b = el("paceChartBox");
            if (b) { b.innerHTML = trendChartHtml(d); }
          }
        })
        .catch(function () {
          var b = el("paceChartBox");
          if (b) { b.innerHTML = '<p class="muted">' + (isEn() ? "No data yet." : "Sem dados ainda.") + '</p>'; }
        });
    }

    // ── Trend chart (shared by Chart B and the pace chart) ─────────────────
    function trendChartHtml(d) {
      var points = (d.points || []).filter(function (p) { return p.realizado !== null && p.realizado !== undefined; });
      if (!points.length) {
        return '<p class="muted">' + (isEn() ? "No data yet for this indicator." : "Sem dados ainda para este indicador.") + '</p>';
      }
      var pctType = (d.indicator === "margem_lucro" || d.indicator === "taxa_conversao" || d.indicator === "metas_batidas") ? "percent" : d.type;
      var W = 320, H = 150, padL = 8, padR = 8, padT = 12, padB = 26;
      var vals = [];
      points.forEach(function (p) {
        vals.push(p.realizado);
        if (p.meta !== null && p.meta !== undefined) { vals.push(p.meta); }
      });
      var maxV = Math.max.apply(null, vals), minV = Math.min.apply(null, vals);
      if (maxV === minV) { maxV = maxV + (maxV === 0 ? 1 : Math.abs(maxV) * 0.2); minV = minV - (minV === 0 ? 1 : Math.abs(minV) * 0.2); }
      var span = maxV - minV;
      maxV += span * 0.1; minV -= span * 0.1;
      function x(i) { return points.length === 1 ? W / 2 : padL + (i / (points.length - 1)) * (W - padL - padR); }
      function y(v) { return padT + (1 - (v - minV) / (maxV - minV)) * (H - padT - padB); }

      var realPts = "", metaPts = "", hasMeta = false;
      points.forEach(function (p, i) {
        realPts += (i ? " " : "") + x(i).toFixed(1) + "," + y(p.realizado).toFixed(1);
        if (p.meta !== null && p.meta !== undefined) {
          metaPts += (metaPts ? " " : "") + x(i).toFixed(1) + "," + y(p.meta).toFixed(1);
          hasMeta = true;
        }
      });
      var svg = '<svg class="chart-b-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
        escHtml(isEn() ? d.label_en : d.label_pt) + '">';
      if (hasMeta) {
        svg += '<polyline points="' + metaPts + '" fill="none" stroke="#6b6660" stroke-width="1.5" stroke-dasharray="4 3"/>';
      }
      if (points.length > 1) {
        svg += '<polyline points="' + realPts + '" fill="none" stroke="#C9A43A" stroke-width="2.5"/>';
      }
      points.forEach(function (p, i) {
        svg += '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(p.realizado).toFixed(1) + '" r="3.5" fill="#C9A43A"/>';
        svg += '<text x="' + x(i).toFixed(1) + '" y="' + (H - 10) + '" text-anchor="middle" font-size="9" fill="#6b6660" font-family="Inter,sans-serif">' +
          chartBMonthShort(p.month) + '</text>';
      });
      svg += '</svg>';

      var last = points[points.length - 1];
      var prev = points.length > 1 ? points[points.length - 2] : null;
      var ptParts = [], enParts = [];
      if (prev && prev.realizado !== 0) {
        var change = Math.round(((last.realizado - prev.realizado) / Math.abs(prev.realizado)) * 100);
        if (change > 0) {
          ptParts.push("Subiu " + change + "% em relação ao mês anterior");
          enParts.push("Up " + change + "% vs last month");
        } else if (change < 0) {
          ptParts.push("Caiu " + Math.abs(change) + "% em relação ao mês anterior");
          enParts.push("Down " + Math.abs(change) + "% vs last month");
        } else {
          ptParts.push("Estável em relação ao mês anterior");
          enParts.push("Flat vs last month");
        }
      }
      if (last.meta !== null && last.meta !== undefined && last.meta !== 0) {
        var onTarget = d.inverse ? last.realizado <= last.meta : last.realizado >= last.meta;
        ptParts.push(onTarget ? "acima da meta" : "abaixo da meta");
        enParts.push(onTarget ? "above target" : "below target");
      }
      var legend = hasMeta
        ? '<div class="muted" style="font-size:11px;margin-top:4px;">' +
          (isEn() ? "Gold line: actual · dashed line: goal" : "Linha dourada: realizado · linha tracejada: meta") + '</div>'
        : "";
      var summary = "";
      if (ptParts.length) {
        summary = '<div class="chart-b-summary">' +
          '<span class="show-pt">' + escHtml(ptParts.join(", ")) + '.</span>' +
          '<span class="show-en">' + escHtml(enParts.join(", ")) + '.</span></div>';
      }
      return '<div class="muted" style="font-size:12px;margin-bottom:4px;">' +
        (isEn() ? "Latest: " : "Último mês: ") + fmtNum(last.realizado, pctType) +
        (last.meta !== null && last.meta !== undefined ? " · Meta: " + fmtNum(last.meta, pctType) : "") + '</div>' +
        svg + legend + summary;
    }

    // ── Chart B ────────────────────────────────────────────────────────────
    var chartBLoadedFor = null;
    function populateChartBPicker() {
      var sel = el("chartBPicker");
      if (!sel) { return; }
      var prev = sel.value;
      sel.innerHTML = "";
      analyticsIndicators.forEach(function (ind) {
        var o = document.createElement("option");
        o.value = ind.key;
        o.textContent = isEn() ? ind.label_en : ind.label_pt;
        sel.appendChild(o);
      });
      if (prev && analyticsIndicators.some(function (i) { return i.key === prev; })) { sel.value = prev; }
      if (sel.value && chartBLoadedFor !== sel.value) { loadChartB(); }
    }

    function loadChartB() {
      var sel = el("chartBPicker");
      var body = el("chartBBody");
      if (!sel || !body || !sel.value) { return; }
      var key = sel.value;
      chartBLoadedFor = key;
      body.innerHTML = '<p class="muted">' + (isEn() ? "Loading…" : "Carregando…") + '</p>';
      apiFetch("/api/clients/" + clientId + "/indicator-history?indicator=" + encodeURIComponent(key) + "&months=12")
        .then(function (res) { return res.json(); })
        .then(function (d) {
          if (destroyed || chartBLoadedFor !== key) { return; }
          body.innerHTML = trendChartHtml(d);
        })
        .catch(function () {
          body.innerHTML = '<p class="muted">' + (isEn() ? "No data yet." : "Sem dados ainda.") + '</p>';
        });
    }

    function load() {
      loadAnalytics();
      if (showPace) { loadPace(); }
    }

    return {
      load: load,
      getMonth: function () { return analyticsMonth; },
      setMonth: function (m) {
        analyticsMonth = m;
        loadAnalytics();
      },
      destroy: function () { destroyed = true; root.innerHTML = ""; }
    };
  }

  global.ApexAnalyticsView = { create: create, pure: PURE };

})(window);
