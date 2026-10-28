// Fornecedores page logic. Plain var/function, ASCII only (\u escapes for
// accents), matching the house style of the rest of this codebase.
(function () {

  var OVERVIEW = null;
  var VENDORS_BY_ID = {};
  var CURRENT_PAY_VENDOR = null;
  var CURRENT_PAY_UNASSIGNED = [];
  var CURRENT_SKIP_PAYABLE = null;
  var CURRENT_DELAY_PAYABLE = null;
  var CURRENT_IGNORE_TXN = null;
  var CLIENTS_CACHE = null;

  function fmtCents(cents) {
    var v = (Number(cents) || 0) / 100;
    return v.toLocaleString("en-US", { style: "currency", currency: "USD" });
  }
  function fmtMonthPill(ym) {
    if (!ym) { return ""; }
    var p = ym.split("-");
    var MONTHS_PT = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
    var MONTHS_EN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    var i = parseInt(p[1], 10) - 1;
    var mo = (window.apexIsEn && window.apexIsEn()) ? MONTHS_EN[i] : MONTHS_PT[i];
    return mo + "/" + p[0];
  }
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function el(id) { return document.getElementById(id); }
  function t(pt, en) { return (window.apexIsEn && window.apexIsEn()) ? en : pt; }

  // Data-driven Portuguese (vendor names, service labels, payable labels)
  // translated to English when the page language is English. A string not
  // in the table passes through unchanged -- this never touches client or
  // vendor proper names.
  var VND_LABEL_EN = {
    "Edição de vídeos": "Video editing",
    "Gestão de tráfego": "Paid traffic management",
    "Gestão de tráfego pago": "Paid traffic management",
    "Sistema - Aplicativo": "System / app",
    "Gestão de redes sociais": "Social media management",
    "Site estratégico": "Strategic website",
    "Identidade visual": "Visual identity",
    "Contabilidade": "Accounting",
    "Back office Brasil": "Back office Brazil",
    "Marketing": "Marketing",
    "Site": "Website",
    "1ª metade": "1st half",
    "2ª metade": "2nd half"
  };
  function trLabel(s) {
    if (!window.apexIsEn || !window.apexIsEn()) { return s; }
    if (s === null || s === undefined) { return s; }
    var str = String(s);
    if (VND_LABEL_EN.hasOwnProperty(str)) { return VND_LABEL_EN[str]; }
    // "Mês N" -> "Month N" for any N.
    var m = str.match(/^Mês (\d+)$/);
    if (m) { return "Month " + m[1]; }
    return str;
  }

  // A vendor's own name is free text Alice typed (often Portuguese), unlike
  // a client's name which is never translated. name_en is a STORED,
  // optional English name (migrations/2026-10-19_vendor_name_en.sql) set
  // once via the edit form -- never machine-translated -- so a vendor with
  // no English name set falls back to the Portuguese name exactly as typed,
  // same as every other untranslated proper name in this app.
  function vendorDisplayName(v) {
    if (!v) { return ""; }
    if (window.apexIsEn && window.apexIsEn() && v.name_en) { return v.name_en; }
    return v.name;
  }

  function openSheet(id) { var s = el(id); if (s) { s.hidden = false; } }
  window.closeSheet = function (id) { var s = el(id); if (s) { s.hidden = true; } };
  window.toggleFold = function (id) {
    var f = el(id);
    if (!f) { return; }
    f.hidden = !f.hidden;
  };

  function currentMonth() {
    var input = el("vndMonth");
    if (input && input.value) { return input.value; }
    var now = new Date();
    return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  }

  function init() {
    var input = el("vndMonth");
    if (input && !input.value) { input.value = currentMonth(); }
    loadOverview();
    loadNextQuestion();
    // Task 7.1(a): toggling PT/EN in nav.js only flips .show-pt/.show-en on
    // STATIC markup -- every string this page builds in JS (tiles, vendor
    // cards, auto-match tray, unassigned list) was baked in at the last
    // apiFetch and never redrawn until a full page reload. loadOverview()
    // re-renders all of it from the already-cached OVERVIEW/AUTO_BATCHES
    // data with no new network call.
    document.addEventListener("apex:langchange", function () {
      renderTiles();
      renderAutoBatches();
      renderVendorCards();
      loadUnassigned();
    });
  }

  function loadOverview() {
    var month = currentMonth();
    apiFetch("/api/vendors/overview?month=" + encodeURIComponent(month))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) { throw new Error(data.error); }
        OVERVIEW = data;
        VENDORS_BY_ID = {};
        (data.vendors || []).forEach(function (v) { VENDORS_BY_ID[v.id] = v; });
        renderTiles();
        renderAutoBatches();
        renderVendorCards();
        loadUnassigned();
      })
      .catch(function (e) {
        var wrap = el("vndVendorCards");
        if (wrap) { wrap.innerHTML = '<div class="empty">' + esc(t("Erro: ", "Error: ") + e.message) + "</div>"; }
      });
  }

  function renderTiles() {
    var wrap = el("vndTiles");
    if (!wrap || !OVERVIEW) { return; }
    var html = '<div class="glass-tile is-total">' +
      '<div class="glass-tile-label">' + t("Total a pagar agora", "Total to pay now") + '</div>' +
      '<div class="glass-tile-value is-gold' + (OVERVIEW.tiles.total_due_cents ? "" : " is-zero") + '">' + fmtCents(OVERVIEW.tiles.total_due_cents) + '</div>' +
    '</div>';
    (OVERVIEW.tiles.vendors || []).forEach(function (v) {
      html += '<button data-help="admin-vendors#vendors#1" type="button" class="glass-tile glass-tile-btn" onclick="document.getElementById(\'vcard-' + v.id + '\') && document.getElementById(\'vcard-' + v.id + '\').scrollIntoView({behavior:\'smooth\',block:\'start\'})">' +
        '<div class="glass-tile-label">' + esc(vendorDisplayName(v)) + '</div>' +
        '<div class="glass-tile-value' + (v.due_cents ? "" : " is-zero") + '">' + fmtCents(v.due_cents) + '</div>';
      var subParts = [];
      if (v.upcoming_cents) { subParts.push(t("próximos ", "upcoming ") + fmtCents(v.upcoming_cents)); }
      var full = (OVERVIEW.vendors || []).filter(function (x) { return x.id === v.id; })[0];
      if (full && full.credit_cents) { subParts.push(t("crédito ", "credit ") + fmtCents(full.credit_cents)); }
      if (subParts.length) { html += '<div class="glass-tile-sub">' + subParts.join(" · ") + '</div>'; }
      html += '</button>';
    });
    wrap.innerHTML = html;
  }

  var AUTO_BATCHES = [];
  var AUTO_VENDORS = [];

  function renderAutoBatches() {
    var card = el("vndAutoCard"), list = el("vndAutoList");
    if (!card || !list) { return; }
    if (!OVERVIEW || !OVERVIEW.unconfirmed_auto_count) { card.hidden = true; return; }
    card.hidden = false;
    apiFetch("/api/vendors/auto-batches").then(function (r) { return r.json(); }).then(function (data) {
      if (data.error) { throw new Error(data.error); }
      AUTO_BATCHES = data.batches || [];
      AUTO_VENDORS = data.vendors || [];
      if (!AUTO_BATCHES.length) { list.innerHTML = '<div class="empty">' + t("Nada pendente.", "Nothing pending.") + '</div>'; return; }
      var html = "";
      AUTO_BATCHES.forEach(function (b) {
        var itemsText = b.items.map(function (it) { return esc(it.client_name) + " · " + esc(trLabel(it.service_label || "")) + " · " + esc(trLabel(it.label)); }).join("; ");
        html += '<div class="pay-row">' +
          '<div class="pay-row-main"><span class="pay-row-label">' + esc(b.date) + ' · ' + esc((window.apexIsEn && window.apexIsEn() && b.vendor_name_en) ? b.vendor_name_en : b.vendor_name) + ' · ' + itemsText + '</span></div>' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
            '<span class="pay-row-amt">' + fmtCents(b.amount_cents) + '</span>' +
            '<div class="pay-row-actions">' +
              '<button class="btn btn-sm btn-gold" onclick="window.ApexVendors.confirmAutoBatch(\'' + b.id + '\')">' + t("Está certo", "Confirm") + '</button>' +
              '<button data-help="admin-vendors#vendors#4" class="btn btn-sm" onclick="window.ApexVendors.openChangeAuto(\'' + b.id + '\')">' + t("Mudar", "Change") + '</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      });
      list.innerHTML = html;
    }).catch(function () {});
  }

  function confirmAutoBatch(batchId) {
    apiFetch("/api/vendors/payments/" + encodeURIComponent(batchId) + "/confirm", { method: "POST", body: {} })
      .then(function (r) { return r.json(); })
      .then(function () { loadOverview(); })
      .catch(function () {});
  }

  function confirmAllAuto() {
    var ids = AUTO_BATCHES.map(function (b) { return b.id; });
    Promise.all(ids.map(function (id) {
      return apiFetch("/api/vendors/payments/" + encodeURIComponent(id) + "/confirm", { method: "POST", body: {} });
    })).then(function () { loadOverview(); }).catch(function () {});
  }

  var CURRENT_CHANGE_BATCH = null;
  function openChangeAuto(batchId) {
    var b = AUTO_BATCHES.filter(function (x) { return x.id === batchId; })[0];
    if (!b) { return; }
    CURRENT_CHANGE_BATCH = b;
    el("reallocateStatus").textContent = "";

    apiFetch("/api/vendors/" + encodeURIComponent(b.vendor_id) + "/change-options").then(function (r) { return r.json(); }).then(function (data) {
      var items = data.items || [];
      var html = '<div class="field-label">' + t("Itens disponíveis", "Available items") + '</div>';
      var byClient = {};
      items.forEach(function (it) { (byClient[it.client_name] = byClient[it.client_name] || []).push(it); });
      Object.keys(byClient).forEach(function (clientName) {
        html += '<div style="font-size:12px;font-weight:700;margin-top:8px;">' + esc(clientName) + '</div>';
        byClient[clientName].forEach(function (it) {
          html += '<label style="display:flex;align-items:center;gap:8px;font-size:13px;padding:4px 0;">' +
            '<input type="checkbox" class="reallocate-item" data-payable-id="' + it.id + '" data-remaining="' + it.remaining_cents + '">' +
            esc(trLabel(it.service_label || "")) + " · " + esc(trLabel(it.label)) + " — " + fmtCents(it.remaining_cents) +
          '</label>';
        });
      });
      el("reallocateFields").innerHTML = html || '<div class="empty">' + t("Nenhum item disponível.", "No items available.") + '</div>';

      var otherSel = el("reallocateOtherVendor");
      var otherOpts = '<option value="">' + t("Outro fornecedor...", "Another vendor...") + '</option>';
      AUTO_VENDORS.filter(function (v) { return v.id !== b.vendor_id; }).forEach(function (v) {
        otherOpts += '<option value="' + v.id + '">' + esc(vendorDisplayName(v)) + '</option>';
      });
      otherSel.innerHTML = otherOpts;
      otherSel.hidden = false;
      el("reallocateOtherVendorLabel").hidden = false;
      var unassignBtn = el("reallocateUnassignBtn");
      if (unassignBtn) { unassignBtn.hidden = false; }
      el("reallocateNotVendorBtn").hidden = false;
      openSheet("sheetReallocate");
    }).catch(function () { el("reallocateStatus").textContent = t("Erro ao carregar itens.", "Error loading items."); });
  }

  function submitReallocate() {
    if (!CURRENT_CHANGE_BATCH) { return; }
    var checked = Array.prototype.slice.call(document.querySelectorAll(".reallocate-item:checked"));
    if (!checked.length) { el("reallocateStatus").textContent = t("Marque pelo menos um item.", "Check at least one item."); return; }
    var remaining = CURRENT_CHANGE_BATCH.amount_cents;
    var allocations = checked.map(function (chk) {
      var take = Math.min(remaining, parseInt(chk.getAttribute("data-remaining"), 10));
      remaining -= take;
      return { payable_id: chk.getAttribute("data-payable-id"), applied_cents: take };
    });
    apiFetch("/api/vendors/payments/" + encodeURIComponent(CURRENT_CHANGE_BATCH.id) + "/reallocate", { method: "POST", body: { allocations: allocations } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) { throw new Error(data.error); }
        window.closeSheet("sheetReallocate");
        loadOverview();
      })
      .catch(function (e) { el("reallocateStatus").textContent = t("Erro: ", "Error: ") + e.message; });
  }

  function submitMoveVendor() {
    if (!CURRENT_CHANGE_BATCH) { return; }
    var vendorId = el("reallocateOtherVendor").value;
    if (!vendorId) { return; }
    apiFetch("/api/vendors/payments/" + encodeURIComponent(CURRENT_CHANGE_BATCH.id) + "/move_vendor", { method: "POST", body: { vendor_id: vendorId } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) { throw new Error(data.error); }
        window.closeSheet("sheetReallocate");
        loadOverview();
      })
      .catch(function (e) { el("reallocateStatus").textContent = t("Erro: ", "Error: ") + e.message; });
  }

  // Plain unassign: undoes the automatic match (same as "Not a vendor
  // payment") but WITHOUT the extra vendor_ignored_transactions write, so the
  // bank line goes back to the Unassigned list for a manual quickAssign --
  // "not a vendor" means "never offer this again", "unassign" means "this
  // match was wrong, let me reassign it".
  function unassignAutoMatch() {
    if (!CURRENT_CHANGE_BATCH) { return; }
    apiFetch("/api/vendors/payments/" + encodeURIComponent(CURRENT_CHANGE_BATCH.id) + "/undo", { method: "POST", body: {} })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) { throw new Error(data.error); }
        window.closeSheet("sheetReallocate");
        loadOverview();
      })
      .catch(function (e) { el("reallocateStatus").textContent = t("Erro: ", "Error: ") + e.message; });
  }

  function markReallocateNotVendor() {
    if (!CURRENT_CHANGE_BATCH || !CURRENT_CHANGE_BATCH.transaction_id) {
      // The tray's batches are automatic bank matches and always carry a
      // transaction_id in practice; guard anyway rather than guess.
      el("reallocateStatus").textContent = t("Esta transação não foi encontrada.", "This transaction was not found.");
      return;
    }
    apiFetch("/api/vendors/payments/" + encodeURIComponent(CURRENT_CHANGE_BATCH.id) + "/undo", { method: "POST", body: {} })
      .then(function () {
        return apiFetch("/api/vendors/remitly/ignore", { method: "POST", body: { transaction_id: CURRENT_CHANGE_BATCH.transaction_id, reason: null } });
      })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) { throw new Error(data.error); }
        window.closeSheet("sheetReallocate");
        loadOverview();
      })
      .catch(function (e) { el("reallocateStatus").textContent = t("Erro: ", "Error: ") + e.message; });
  }

  function payableStatusChip(p) {
    if (p.status === "late") { return '<span class="chip chip-late">' + t("Atrasado", "Late") + '</span>'; }
    if (p.remaining_cents < p.planned_cents) { return '<span class="chip chip-partial">' + t("parcial", "partial") + '</span>'; }
    return '<span class="chip chip-due">' + t("A pagar", "To pay") + '</span>';
  }

  function renderVendorCards() {
    var wrap = el("vndVendorCards"), empty = el("vndEmpty");
    if (!wrap || !OVERVIEW) { return; }
    var vendors = (OVERVIEW.vendors || []).filter(function (v) { return v.due.length || v.upcoming.length || v.paid_to_date_cents; });
    if (!vendors.length) { wrap.innerHTML = ""; if (empty) { empty.hidden = false; } return; }
    if (empty) { empty.hidden = true; }

    var html = "";
    vendors.forEach(function (v) {
      html += '<div class="card vendor-card" id="vcard-' + v.id + '">' +
        '<div class="vendor-card-head">' +
          '<div><span class="vendor-card-name" style="cursor:pointer;" onclick="window.ApexVendors.openDetail(\'' + v.id + '\')">' + esc(vendorDisplayName(v)) + '</span>' +
            (v.vendor_type ? ' <span class="vendor-card-type">&mdash; ' + esc(v.vendor_type) + '</span>' : '') + '</div>' +
          '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">' +
            '<div class="vendor-card-owed">' + fmtCents(v.due_total_cents) + '</div>' +
            (v.due_total_cents > 0 ? '<button class="btn btn-sm btn-gold" onclick="window.ApexVendors.openSentPayment(\'' + v.id + '\')">' + t("Enviei o pagamento", "I sent the payment") + '</button>' : '') +
            '<button class="btn btn-sm" onclick="window.ApexVendors.openPayment(\'' + v.id + '\')">' + t("Registrar pagamento", "Record payment") + '</button>' +
          '</div>' +
        '</div>' +
        (v.sent_chip === "SENT_WAITING" ? '<div class="chip chip-partial" style="margin-bottom:8px;">' + t("Enviado, aguardando o banco", "Sent, waiting for the bank") + '</div>' : '') +
        (v.sent_chip === "NOT_SEEN" ? '<div class="chip chip-late" style="margin-bottom:8px;">' + t("Ainda não apareceu no banco", "Not seen in the bank yet") + '</div>' : '');

      if (!v.due.length) {
        html += '<div class="empty">' + t("Nada a pagar agora.", "Nothing to pay now.") + '</div>';
      } else {
        v.due.forEach(function (p) {
          html += '<div class="pay-row">' +
            '<div class="pay-row-main"><span class="pay-row-label">' + esc(p.client_name) + ' · ' + esc(trLabel(p.service_label || "")) + ' · ' + esc(trLabel(p.label)) + '</span></div>' +
            '<div style="display:flex;align-items:center;gap:8px;">' +
              '<span class="pay-row-amt">' + fmtCents(p.remaining_cents) + '</span>' + payableStatusChip(p) +
              '<div class="pay-row-actions">' + payableRowActions(p) + '</div>' +
            '</div>' +
          '</div>';
        });
      }

      var upCount = v.upcoming.length;
      html += '<div class="fold">' +
        '<div class="fold-head" onclick="window.toggleFold(\'upfold-' + v.id + '\')">&#9656; ' + t("Próximos", "Coming up") + ' (' + upCount + ')</div>' +
        '<div class="fold-body" id="upfold-' + v.id + '" hidden>';
      if (!upCount) {
        html += '<div class="empty">' + t("Nada próximo.", "Nothing coming up.") + '</div>';
      } else {
        v.upcoming.forEach(function (p) {
          var pill = p.status === "waiting_completion" ? t("Quando o site terminar", "When the site is done")
            : (p.status === "delayed" ? t("Adiado", "Delayed") : fmtMonthPill(p.period_month));
          html += '<div class="pay-row">' +
            '<div class="pay-row-main"><span class="pay-row-label">' + esc(p.client_name) + ' · ' + esc(trLabel(p.service_label || "")) + ' · ' + esc(trLabel(p.label)) + '</span></div>' +
            '<div style="display:flex;align-items:center;gap:8px;"><span class="pay-row-amt">' + fmtCents(p.remaining_cents) + '</span><span class="chip chip-partial">' + esc(pill) + '</span></div>' +
          '</div>';
        });
      }
      html += '</div></div></div>';
    });
    wrap.innerHTML = html;
  }

  function payableRowActions(p) {
    var btns = "";
    if (p.status === "due" || p.status === "late") {
      // trigger not carried on due rows directly -- inferred by label pattern
      // is fragile; service-level action buttons cover skip/delay instead,
      // shown generically here for monthly/start rows.
      btns += '<button class="btn btn-sm" onclick="window.ApexVendors.openSkip(\'' + p.id + '\')">' + t("Pular este mês", "Skip this month") + '</button>';
      btns += '<button class="btn btn-sm" onclick="window.ApexVendors.openDelay(\'' + p.id + '\')">' + t("Adiar início", "Delay start") + '</button>';
    }
    return btns;
  }

  function loadUnassigned() {
    apiFetch("/api/vendors/remitly-unmatched").then(function (r) { return r.json(); }).then(function (data) {
      var rows = data.transactions || [];
      var line = el("vndUnassignedLine"), count = el("vndUnassignedCount"), fold = el("vndUnassignedFold");
      if (!rows.length) { if (line) { line.hidden = true; } if (count) { count.textContent = ""; } if (fold) { fold.innerHTML = '<div class="empty">' + t("Nada pendente.", "Nothing pending.") + '</div>'; } return; }
      var total = rows.reduce(function (s, x) { return s + x.amount_cents; }, 0);
      if (line) { line.hidden = false; line.textContent = t("Remitly sem fornecedor: ", "Remitly not assigned to a vendor: ") + fmtCents(total); }
      if (count) { count.textContent = "(" + rows.length + ")"; }
      if (!fold) { return; }
      var html = "";
      rows.forEach(function (tx) {
        var vendorBtns = "";
        var vendors = (OVERVIEW && OVERVIEW.vendors) || [];
        var hinted = tx.hint_vendor_id;
        var ordered = vendors.slice().sort(function (a, b) { return (a.id === hinted ? -1 : 0) - (b.id === hinted ? -1 : 0); });
        ordered.forEach(function (v) {
          vendorBtns += '<button class="btn btn-sm' + (v.id === hinted ? " btn-gold" : "") + '" onclick="window.ApexVendors.quickAssign(\'' + tx.id + '\',\'' + v.id + '\')">' + esc(vendorDisplayName(v)) + '</button>';
        });
        html += '<div class="pay-row">' +
          '<div class="pay-row-main"><span class="pay-row-label">' + esc(tx.date) + ' · ' + esc(tx.description) + '</span></div>' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><span class="pay-row-amt">' + fmtCents(tx.amount_cents) + '</span>' +
            '<div class="pay-row-actions">' + vendorBtns + '<button class="btn btn-sm" onclick="window.ApexVendors.openIgnore(\'' + tx.id + '\')">' + t("Não é de fornecedor", "Not a vendor payment") + '</button></div>' +
          '</div>' +
        '</div>';
      });
      fold.innerHTML = html;
    }).catch(function () {});
  }

  function quickAssign(txnId, vendorId) {
    apiFetch("/api/vendors/payments/quick", { method: "POST", body: { transaction_id: txnId, vendor_id: vendorId } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) { throw new Error(data.error); }
        loadOverview();
      })
      .catch(function (e) { window.alert ? null : null; });
  }

  function openIgnore(txnId) {
    CURRENT_IGNORE_TXN = txnId;
    el("ignoreReason").value = "";
    openSheet("sheetIgnore");
  }
  function submitIgnore() {
    apiFetch("/api/vendors/remitly/ignore", { method: "POST", body: { transaction_id: CURRENT_IGNORE_TXN, reason: el("ignoreReason").value.trim() || null } })
      .then(function (r) { return r.json(); })
      .then(function () { window.closeSheet("sheetIgnore"); loadUnassigned(); })
      .catch(function () {});
  }

  // ── Question box (Part D) ──────────────────────────────────────────────
  var CURRENT_QUESTION = null;
  var CURRENT_Q_INTERPRETED = null;

  function loadNextQuestion() {
    apiFetch("/api/vendors/questions").then(function (r) { return r.json(); }).then(function (data) {
      var card = el("vndQuestionCard");
      if (!card) { return; }
      if (!data.question) { card.hidden = true; CURRENT_QUESTION = null; return; }
      CURRENT_QUESTION = data.question;
      card.hidden = false;
      el("vndQCounter").textContent = data.position + " " + t("de", "of") + " " + data.total;
      el("vndQText").textContent = t(data.question.text_pt, data.question.text_en);
      el("vndQAnswer").value = "";
      el("vndQStatus").textContent = "";
      el("vndQConfirmCard").hidden = true;
      el("vndQMicStatus").textContent = "";
    }).catch(function () {});
  }

  function sendQuestionAnswer() {
    if (!CURRENT_QUESTION) { return; }
    var text = el("vndQAnswer").value.trim();
    var statusEl = el("vndQStatus");
    if (!text) { statusEl.textContent = t("Escreva ou grave uma resposta.", "Write or record an answer."); return; }
    statusEl.textContent = t("Enviando...", "Sending...");
    apiFetch("/api/vendors/questions/" + encodeURIComponent(CURRENT_QUESTION.id) + "/answer", { method: "POST", body: { answer_raw: text } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) { throw new Error(data.error); }
        if (!data.understood) {
          statusEl.textContent = t("Não entendi bem. Pode responder de outro jeito?", "I did not understand. Can you answer another way?");
          return;
        }
        statusEl.textContent = "";
        CURRENT_Q_INTERPRETED = data.interpreted;
        el("vndQConfirmText").textContent = questionConfirmText(CURRENT_QUESTION.key, data.interpreted);
        el("vndQConfirmCard").hidden = false;
      })
      .catch(function (e) { statusEl.textContent = t("Erro: ", "Error: ") + e.message; });
  }

  function questionConfirmText(key, interpreted) {
    if (key === "dipro_first_month") {
      return t("Entendi: o primeiro mês pago do Dipro foi " + fmtMonthPill(interpreted.month) + ". Está certo?",
                "I understood: Dipro's first paid month was " + fmtMonthPill(interpreted.month) + ". Is that right?");
    }
    if (key === "golden_site_halves") {
      return interpreted.second_half_owed
        ? t("Entendi: a segunda metade do site da Golden ainda está pendente. Está certo?", "I understood: Golden's second half is still owed. Is that right?")
        : t("Entendi: as duas metades do site da Golden já foram pagas. Está certo?", "I understood: both halves of Golden's site are paid. Is that right?");
    }
    if (key === "older_clients_no_vendors") {
      return interpreted.confirmed
        ? t("Entendi: confirmado, nenhum deles tem fornecedor. Está certo?", "I understood: confirmed, none of them has a vendor. Is that right?")
        : t("Entendi: não confirmado. Está certo?", "I understood: not confirmed. Is that right?");
    }
    return "";
  }

  function confirmQuestionAnswer() {
    if (!CURRENT_QUESTION || !CURRENT_Q_INTERPRETED) { return; }
    apiFetch("/api/vendors/questions/" + encodeURIComponent(CURRENT_QUESTION.id) + "/apply", { method: "POST", body: { interpreted: CURRENT_Q_INTERPRETED } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) { throw new Error(data.error); }
        loadNextQuestion();
        loadOverview();
      })
      .catch(function (e) { el("vndQStatus").textContent = t("Erro: ", "Error: ") + e.message; });
  }

  function correctQuestionAnswer() {
    el("vndQConfirmCard").hidden = true;
    el("vndQAnswer").focus();
  }

  // Dictation: same mechanism as contract-review.html (MediaRecorder ->
  // /api/contracts/transcribe). The transcript lands in the text area for
  // her to correct before sending -- typing and speaking fill the same box.
  var vndQRec = null, vndQRecChunks = [], vndQRecStartedAt = 0;
  var VND_Q_REC_MAX_MS = 120000, VND_Q_REC_MIN_MS = 1500;
  function toggleQuestionMic() {
    if (vndQRec && vndQRec.state === "recording") { stopQuestionMic(); return; }
    startQuestionMic();
  }
  function startQuestionMic() {
    var st = el("vndQMicStatus");
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      if (st) { st.textContent = t("Este navegador não consegue gravar áudio.", "This browser cannot record audio."); }
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      vndQRecChunks = [];
      vndQRec = new MediaRecorder(stream);
      vndQRec.ondataavailable = function (e) { if (e.data && e.data.size) { vndQRecChunks.push(e.data); } };
      vndQRec.onstop = function () {
        for (var i = 0; i < stream.getTracks().length; i++) { stream.getTracks()[i].stop(); }
        sendQuestionMic();
      };
      vndQRec.start();
      vndQRecStartedAt = Date.now();
      var btn = el("vndQMicBtn");
      if (btn) { btn.innerHTML = "&#9632; " + t("Parar", "Stop"); }
      if (st) { st.textContent = t("Gravando... fale a resposta.", "Recording... say the answer."); }
      setTimeout(function () { if (vndQRec && vndQRec.state === "recording") { stopQuestionMic(); } }, VND_Q_REC_MAX_MS);
    }).catch(function () {
      if (st) { st.textContent = t("Permissão do microfone negada.", "Microphone permission denied."); }
    });
  }
  function stopQuestionMic() {
    if (vndQRec && vndQRec.state === "recording") { vndQRec.stop(); }
    var btn = el("vndQMicBtn");
    if (btn) { btn.innerHTML = "&#127908; " + t("Ditar", "Dictate"); }
  }
  function sendQuestionMic() {
    var st = el("vndQMicStatus");
    if (!vndQRecChunks.length || (Date.now() - vndQRecStartedAt) < VND_Q_REC_MIN_MS) {
      if (st) { st.textContent = t("Muito curto - segure Ditar e fale.", "Too short - hold Dictate and speak."); }
      return;
    }
    var blob = new Blob(vndQRecChunks, { type: (vndQRecChunks[0] && vndQRecChunks[0].type) || "audio/webm" });
    var fd = new FormData();
    fd.append("audio", blob, "note.webm");
    if (st) { st.textContent = t("Transcrevendo...", "Transcribing..."); }
    apiFetch("/api/contracts/transcribe", { method: "POST", body: fd })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var ta = el("vndQAnswer");
        if (ta) { ta.value = (ta.value ? ta.value.trim() + " " : "") + (d.transcript || ""); ta.focus(); }
        if (st) { st.textContent = t("Transcrito. Corrija se precisar e envie.", "Transcribed. Correct it if needed and send."); }
      })
      .catch(function (e) { if (st) { st.textContent = t("Erro: ", "Error: ") + e.message; } });
  }

  // ── "Enviei o pagamento" / "I sent the payment" (Part E) ──────────────────
  var CURRENT_SENT_VENDOR = null;
  function openSentPayment(vendorId) {
    CURRENT_SENT_VENDOR = vendorId;
    var v = VENDORS_BY_ID[vendorId];
    el("sentVendorName").textContent = v ? v.name : "";
    el("sentAmount").value = v ? (v.due_total_cents / 100).toFixed(2) : "";
    el("sentDate").value = new Date().toISOString().slice(0, 10);
    el("sentStatus").textContent = "";
    var body = el("sentItemsBody");
    var html = "";
    (v ? v.due : []).forEach(function (p) {
      html += '<label style="display:flex;align-items:center;gap:8px;font-size:13px;padding:4px 0;">' +
        '<input type="checkbox" class="sent-item" data-payable-id="' + p.id + '" data-remaining="' + p.remaining_cents + '" checked>' +
        esc(p.client_name) + " · " + esc(trLabel(p.service_label || "")) + " · " + esc(trLabel(p.label)) + " — " + fmtCents(p.remaining_cents) +
      '</label>';
    });
    body.innerHTML = html || '<div class="empty">' + t("Nenhum item.", "No items.") + '</div>';
    body.hidden = true;
    openSheet("sheetSent");
  }
  function toggleSentItems() {
    var body = el("sentItemsBody");
    if (body) { body.hidden = !body.hidden; }
  }
  function submitSentPayment() {
    var statusEl = el("sentStatus");
    var amount = el("sentAmount").value;
    var sentOn = el("sentDate").value;
    if (!amount || !sentOn) { statusEl.textContent = t("Informe o valor e a data.", "Enter the amount and the date."); return; }
    var amountCents = Math.round(parseFloat(amount) * 100);
    var checked = Array.prototype.slice.call(document.querySelectorAll(".sent-item:checked"));
    var body = { vendor_id: CURRENT_SENT_VENDOR, amount_cents: amountCents, sent_on: sentOn };
    if (checked.length) {
      var remaining = amountCents;
      body.allocations = checked.map(function (chk) {
        var take = Math.min(remaining, parseInt(chk.getAttribute("data-remaining"), 10));
        remaining -= take;
        return { payable_id: chk.getAttribute("data-payable-id"), applied_cents: take };
      });
    }
    apiFetch("/api/vendors/payments/sent", { method: "POST", body: body })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) { throw new Error(data.error); }
        window.closeSheet("sheetSent");
        loadOverview();
      })
      .catch(function (e) { statusEl.textContent = t("Erro: ", "Error: ") + e.message; });
  }

  function openPayment(vendorId) {
    CURRENT_PAY_VENDOR = vendorId;
    var v = VENDORS_BY_ID[vendorId];
    el("payVendorName").textContent = v ? v.name : "";
    el("payAmount").value = "";
    el("payNote").value = "";
    var now = new Date();
    el("payDate").value = now.toISOString().slice(0, 10);
    el("payStatus").textContent = "";
    apiFetch("/api/vendors/remitly-unmatched").then(function (r) { return r.json(); }).then(function (data) {
      CURRENT_PAY_UNASSIGNED = data.transactions || [];
      var sel = el("payTxnSelect");
      var opts = '<option value="">' + t("Nenhuma (valor digitado)", "None (typed amount)") + '</option>';
      CURRENT_PAY_UNASSIGNED.forEach(function (tx) {
        opts += '<option value="' + tx.id + '">' + esc(tx.date) + " · " + fmtCents(tx.amount_cents) + '</option>';
      });
      sel.innerHTML = opts;
      openSheet("sheetPayment");
    });
  }
  function onPayTxnChange() {
    var id = el("payTxnSelect").value;
    var tx = CURRENT_PAY_UNASSIGNED.filter(function (x) { return x.id === id; })[0];
    if (tx) { el("payAmount").value = (tx.amount_cents / 100).toFixed(2); el("payDate").value = tx.date; }
  }
  function submitPayment() {
    var statusEl = el("payStatus");
    var txnId = el("payTxnSelect").value || null;
    var amount = el("payAmount").value;
    var body = { vendor_id: CURRENT_PAY_VENDOR, paid_on: el("payDate").value, note: el("payNote").value.trim() || null };
    if (txnId) { body.transaction_id = txnId; } else {
      if (!amount) { statusEl.textContent = t("Informe o valor.", "Enter the amount."); return; }
      body.amount_cents = Math.round(parseFloat(amount) * 100);
    }
    apiFetch("/api/vendors/payments", { method: "POST", body: body })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) { throw new Error(data.error); }
        window.closeSheet("sheetPayment");
        loadOverview();
      })
      .catch(function (e) { statusEl.textContent = t("Erro: ", "Error: ") + e.message; });
  }

  function openSkip(payableId) {
    CURRENT_SKIP_PAYABLE = payableId;
    el("skipReason").value = "";
    el("skipStatus").textContent = "";
    openSheet("sheetSkip");
  }
  function submitSkip() {
    var reason = el("skipReason").value.trim();
    apiFetch("/api/vendors/payables/" + encodeURIComponent(CURRENT_SKIP_PAYABLE) + "/pause", { method: "POST", body: { reason: reason } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) { throw new Error(data.error); }
        window.closeSheet("sheetSkip");
        loadOverview();
      })
      .catch(function (e) { el("skipStatus").textContent = t("Erro: ", "Error: ") + e.message; });
  }

  function openDelay(payableId) {
    CURRENT_DELAY_PAYABLE = payableId;
    el("delayNote").value = "";
    el("delayStatus").textContent = "";
    openSheet("sheetDelay");
  }
  function submitDelay() {
    apiFetch("/api/vendors/payables/" + encodeURIComponent(CURRENT_DELAY_PAYABLE) + "/delay", { method: "POST", body: { note: el("delayNote").value.trim() || null } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) { throw new Error(data.error); }
        window.closeSheet("sheetDelay");
        loadOverview();
      })
      .catch(function (e) { el("delayStatus").textContent = t("Erro: ", "Error: ") + e.message; });
  }

  function openForecast() {
    apiFetch("/api/vendors/forecast?months=6").then(function (r) { return r.json(); }).then(function (data) {
      var body = el("forecastBody");
      var html = '<table class="fc-table"><thead><tr><th>' + t("Mês", "Month") + '</th>';
      data.vendors.forEach(function (v) { html += "<th>" + esc(vendorDisplayName(v)) + "</th>"; });
      html += "<th>" + t("Total", "Total") + "</th></tr></thead><tbody>";
      data.months.forEach(function (m) {
        html += "<tr><td>" + fmtMonthPill(m.month) + "</td>";
        data.vendors.forEach(function (v) { html += "<td>" + fmtCents(m.vendors[v.id] || 0) + "</td>"; });
        html += "<td>" + fmtCents(m.total_cents) + "</td></tr>";
      });
      html += "</tbody></table>";
      var waitingParts = [];
      data.vendors.forEach(function (v) {
        if (data.waiting_completion[v.id]) { waitingParts.push(esc(vendorDisplayName(v)) + ": " + fmtCents(data.waiting_completion[v.id])); }
      });
      if (waitingParts.length) {
        html += '<div class="sheet-note" style="margin-top:10px;"><b>' + t("Aguardando conclusão", "Awaiting completion") + ':</b> ' + waitingParts.join(" · ") + "</div>";
      }
      body.innerHTML = html;
      openSheet("sheetForecast");
    });
  }

  var HISTORY_MONTHS = 12;
  var HISTORY_OFFSET = 0;

  function openHistory() {
    HISTORY_OFFSET = 0;
    el("historyBody").innerHTML = "";
    loadHistoryPage(false);
    openSheet("sheetHistory");
  }
  function loadMoreHistory() {
    HISTORY_OFFSET += HISTORY_MONTHS;
    loadHistoryPage(true);
  }
  function loadHistoryPage(append) {
    var btn = el("historyMoreBtn");
    if (btn) { btn.disabled = true; }
    apiFetch("/api/vendors/history?months=" + HISTORY_MONTHS + "&offset=" + HISTORY_OFFSET)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (btn) { btn.disabled = false; }
        if (data.error) { throw new Error(data.error); }
        var html = append ? el("historyBody").innerHTML : "";
        (data.months || []).forEach(function (m) {
          html += '<div class="fc-month-group" style="margin-bottom:14px;">' +
            '<div class="pay-row-main" style="font-weight:600;margin-bottom:4px;">' + fmtMonthPill(m.month) +
            ' <span style="float:right;">' + fmtCents(m.total_cents) + '</span></div>';
          (m.payments || []).forEach(function (p) {
            var sub = [];
            if (p.vendor_name) { sub.push(esc(p.vendor_name)); }
            if (p.client_name) { sub.push(esc(p.client_name)); }
            if (p.kind) { sub.push(esc(p.kind)); }
            if (p.note) { sub.push(esc(p.note)); }
            html += '<div class="pay-row"><div class="pay-row-main"><span class="pay-row-label">' + esc(p.paid_on) +
              (sub.length ? " &middot; " + sub.join(" &middot; ") : "") + '</span></div>' +
              '<div><span class="pay-row-amt">' + fmtCents(p.amount_cents) + '</span></div></div>';
          });
          html += "</div>";
        });
        if (!append && !(data.months || []).length) {
          html = '<div class="empty">' + t("Nenhum pagamento ainda.", "No payments yet.") + "</div>";
        }
        el("historyBody").innerHTML = html;
        if (btn) { btn.hidden = !data.has_more; }
      })
      .catch(function (e) { if (btn) { btn.disabled = false; } console.error(e); });
  }

  function openDetail(vendorId) {
    apiFetch("/api/vendors/" + encodeURIComponent(vendorId)).then(function (r) { return r.json(); }).then(function (data) {
      if (data.error) { return; }
      el("vndDetail").setAttribute("data-vendor-id", vendorId);
      el("vdName").textContent = data.vendor.name;
      var contactParts = [];
      if (data.vendor.contact_name) { contactParts.push(data.vendor.contact_name); }
      if (data.vendor.contact_phone) { contactParts.push(data.vendor.contact_phone); }
      if (data.vendor.payment_method) { contactParts.push(data.vendor.payment_method); }
      el("vdContact").textContent = contactParts.join(" · ");

      var svcHtml = "";
      (data.services || []).forEach(function (s) {
        var done = s.payables.filter(function (p) { return p.status === "paid" || p.status === "cancelled"; }).length;
        svcHtml += '<div class="pay-row"><div class="pay-row-main"><span class="pay-row-label">' + esc(s.client_name) + " · " + esc(trLabel(s.label)) + "</span></div>" +
          '<div><span class="pay-row-amt">' + done + " / " + s.payables.length + "</span></div></div>";
      });
      el("vdServices").innerHTML = svcHtml || '<div class="empty">' + t("Nenhum serviço.", "No services.") + "</div>";

      var histHtml = "";
      (data.batches || []).forEach(function (b) {
        histHtml += '<div class="pay-row"><div class="pay-row-main"><span class="pay-row-label">' + esc(b.paid_on) + "</span></div>" +
          '<div><span class="pay-row-amt">' + fmtCents(b.amount_cents) + "</span></div></div>";
      });
      el("vdHistory").innerHTML = histHtml || '<div class="empty">' + t("Nenhum pagamento ainda.", "No payments yet.") + "</div>";

      document.querySelectorAll("#appBelowHero > *").forEach(function (child) { if (child.id !== "vndDetail") { child.style.display = "none"; } });
      el("vndDetail").hidden = false;
    });
  }
  function closeVendorDetail() {
    el("vndDetail").hidden = true;
    document.querySelectorAll("#appBelowHero > *").forEach(function (child) { child.style.display = ""; });
  }

  function openNewVendorModal() {
    el("nvName").value = "";
    el("nvType").value = "";
    el("nvStatus").textContent = "";
    openSheet("sheetNewVendor");
  }
  function submitNewVendor() {
    var name = el("nvName").value.trim();
    if (!name) { el("nvStatus").textContent = t("Informe um nome.", "Enter a name."); return; }
    apiFetch("/api/finance-new/vendors", { method: "POST", body: { name: name, vendor_type: el("nvType").value.trim() || null } })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) { throw new Error(data.error); }
        window.closeSheet("sheetNewVendor");
        loadOverview();
      })
      .catch(function (e) { el("nvStatus").textContent = t("Erro: ", "Error: ") + e.message; });
  }

  function openEditVendorModal() {
    var vendorId = el("vndDetail").getAttribute("data-vendor-id");
    var v = VENDORS_BY_ID[vendorId] || {};
    el("evNameEn").value = v.name_en || "";
    el("evType").value = v.vendor_type || "";
    el("evContactName").value = "";
    el("evContactPhone").value = "";
    el("evPaymentMethod").value = "";
    el("evPaymentIdentifier").value = "";
    el("evStatus").textContent = "";
    openSheet("sheetEditVendor");
  }
  function submitEditVendor() {
    var vendorId = el("vndDetail").getAttribute("data-vendor-id");
    apiFetch("/api/finance-new/vendors/" + encodeURIComponent(vendorId), {
      method: "PUT",
      body: {
        name_en: el("evNameEn").value.trim() || null,
        vendor_type: el("evType").value.trim() || null,
        contact_name: el("evContactName").value.trim() || null,
        contact_phone: el("evContactPhone").value.trim() || null,
        payment_method: el("evPaymentMethod").value || null,
        payment_identifier: el("evPaymentIdentifier").value.trim() || null
      }
    }).then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) { throw new Error(data.error); }
        window.closeSheet("sheetEditVendor");
        openDetail(vendorId);
      })
      .catch(function (e) { el("evStatus").textContent = t("Erro: ", "Error: ") + e.message; });
  }

  function onAsKindChange() {
    el("asMonthsBlock").style.display = el("asKind").value === "monthly" ? "" : "none";
  }

  function openAddServiceModal() {
    var vendorId = el("vndDetail").getAttribute("data-vendor-id");
    el("asLabel").value = "";
    el("asPrice").value = "";
    el("asFirstMonth").value = "";
    el("asStartsOn").value = new Date().toISOString().slice(0, 10);
    el("asMonths").value = "";
    el("asNote").value = "";
    el("asKind").value = "monthly";
    onAsKindChange();
    el("asStatus").textContent = "";
    el("sheetAddService").setAttribute("data-vendor-id", vendorId);

    var load = CLIENTS_CACHE ? Promise.resolve(CLIENTS_CACHE) :
      apiFetch("/api/clients?limit=500").then(function (r) { return r.json(); }).then(function (data) {
        CLIENTS_CACHE = (data && (data.clients || data)) || [];
        return CLIENTS_CACHE;
      }).catch(function () { CLIENTS_CACHE = []; return CLIENTS_CACHE; });

    load.then(function (clients) {
      var opts = "";
      (clients || []).forEach(function (c) { opts += '<option value="' + c.id + '">' + esc(c.name) + "</option>"; });
      el("asClient").innerHTML = opts;
      openSheet("sheetAddService");
    });
  }
  function submitAddService() {
    var statusEl = el("asStatus");
    var vendorId = el("sheetAddService").getAttribute("data-vendor-id");
    var clientId = el("asClient").value;
    var label = el("asLabel").value.trim();
    var kind = el("asKind").value;
    var price = el("asPrice").value;
    var firstMonth = el("asFirstMonth").value;
    var months = el("asMonths").value;
    var startsOn = el("asStartsOn").value;
    if (!clientId || !label || !price || !firstMonth) { statusEl.textContent = t("Preencha todos os campos.", "Fill in every field."); return; }
    if (kind === "monthly" && !months) { statusEl.textContent = t("Informe o número de meses.", "Enter the number of months."); return; }
    apiFetch("/api/vendors/services", {
      method: "POST",
      body: {
        client_id: clientId, vendor_id: vendorId, label: label, kind: kind,
        price_cents: Math.round(parseFloat(price) * 100), first_month: firstMonth,
        months: kind === "monthly" ? parseInt(months, 10) : null,
        note: el("asNote").value.trim() || null,
        starts_on: startsOn || null
      }
    }).then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) { throw new Error(data.error); }
        window.closeSheet("sheetAddService");
        openDetail(vendorId);
        loadOverview();
      })
      .catch(function (e) { statusEl.textContent = t("Erro: ", "Error: ") + e.message; });
  }

  window.ApexVendors = {
    init: init,
    openPayment: openPayment,
    openSkip: openSkip,
    openDelay: openDelay,
    openDetail: openDetail,
    quickAssign: quickAssign,
    openIgnore: openIgnore,
    confirmAutoBatch: confirmAutoBatch,
    confirmAllAuto: confirmAllAuto,
    openChangeAuto: openChangeAuto,
    submitMoveVendor: submitMoveVendor,
    unassignAutoMatch: unassignAutoMatch,
    markReallocateNotVendor: markReallocateNotVendor,
    openSentPayment: openSentPayment,
    toggleSentItems: toggleSentItems,
    submitSentPayment: submitSentPayment,
    toggleQuestionMic: toggleQuestionMic,
    sendQuestionAnswer: sendQuestionAnswer,
    confirmQuestionAnswer: confirmQuestionAnswer,
    correctQuestionAnswer: correctQuestionAnswer
  };
  window.loadOverview = loadOverview;
  window.openForecast = openForecast;
  window.openHistory = openHistory;
  window.loadMoreHistory = loadMoreHistory;
  window.openNewVendorModal = openNewVendorModal;
  window.submitNewVendor = submitNewVendor;
  window.closeVendorDetail = closeVendorDetail;
  window.openEditVendorModal = openEditVendorModal;
  window.submitEditVendor = submitEditVendor;
  window.openAddServiceModal = openAddServiceModal;
  window.submitAddService = submitAddService;
  window.onAsKindChange = onAsKindChange;
  window.onPayTxnChange = onPayTxnChange;
  window.submitPayment = submitPayment;
  window.submitSkip = submitSkip;
  window.submitDelay = submitDelay;
  window.submitIgnore = submitIgnore;
  window.submitReallocate = submitReallocate;

})();
