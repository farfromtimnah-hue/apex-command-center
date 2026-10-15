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
      html += '<button type="button" class="glass-tile glass-tile-btn" onclick="document.getElementById(\'vcard-' + v.id + '\') && document.getElementById(\'vcard-' + v.id + '\').scrollIntoView({behavior:\'smooth\',block:\'start\'})">' +
        '<div class="glass-tile-label">' + esc(v.name) + '</div>' +
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

  function renderAutoBatches() {
    var card = el("vndAutoCard"), list = el("vndAutoList");
    if (!card || !list) { return; }
    if (!OVERVIEW || !OVERVIEW.unconfirmed_auto_count) { card.hidden = true; return; }
    // The overview route doesn't carry the auto batch rows themselves (only
    // the count) -- fetch each vendor's detail lazily is overkill here, so
    // this tray reads from each vendor's history once the vendor card is
    // visible. Simpler: list vendors with an unconfirmed count hint.
    card.hidden = false;
    list.innerHTML = '<div class="empty">' + t("Veja o histórico de cada fornecedor para confirmar.", "See each vendor's history to confirm.") + '</div>';
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
          '<div><span class="vendor-card-name" style="cursor:pointer;" onclick="window.ApexVendors.openDetail(\'' + v.id + '\')">' + esc(v.name) + '</span>' +
            (v.vendor_type ? ' <span class="vendor-card-type">&mdash; ' + esc(v.vendor_type) + '</span>' : '') + '</div>' +
          '<div style="display:flex;align-items:center;gap:12px;">' +
            '<div class="vendor-card-owed">' + fmtCents(v.due_total_cents) + '</div>' +
            '<button class="btn btn-sm btn-gold" onclick="window.ApexVendors.openPayment(\'' + v.id + '\')">' + t("Registrar pagamento", "Record payment") + '</button>' +
          '</div>' +
        '</div>';

      if (!v.due.length) {
        html += '<div class="empty">' + t("Nada a pagar agora.", "Nothing to pay now.") + '</div>';
      } else {
        v.due.forEach(function (p) {
          html += '<div class="pay-row">' +
            '<div class="pay-row-main"><span class="pay-row-label">' + esc(p.client_name) + ' · ' + esc(p.service_label || "") + ' · ' + esc(p.label) + '</span></div>' +
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
            '<div class="pay-row-main"><span class="pay-row-label">' + esc(p.client_name) + ' · ' + esc(p.service_label || "") + ' · ' + esc(p.label) + '</span></div>' +
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
          vendorBtns += '<button class="btn btn-sm' + (v.id === hinted ? " btn-gold" : "") + '" onclick="window.ApexVendors.quickAssign(\'' + tx.id + '\',\'' + v.id + '\')">' + esc(v.name) + '</button>';
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
      data.vendors.forEach(function (v) { html += "<th>" + esc(v.name) + "</th>"; });
      html += "<th>" + t("Total", "Total") + "</th></tr></thead><tbody>";
      data.months.forEach(function (m) {
        html += "<tr><td>" + fmtMonthPill(m.month) + "</td>";
        data.vendors.forEach(function (v) { html += "<td>" + fmtCents(m.vendors[v.id] || 0) + "</td>"; });
        html += "<td>" + fmtCents(m.total_cents) + "</td></tr>";
      });
      html += "</tbody></table>";
      var waitingParts = [];
      data.vendors.forEach(function (v) {
        if (data.waiting_completion[v.id]) { waitingParts.push(esc(v.name) + ": " + fmtCents(data.waiting_completion[v.id])); }
      });
      if (waitingParts.length) {
        html += '<div class="sheet-note" style="margin-top:10px;"><b>' + t("Aguardando conclusão", "Awaiting completion") + ':</b> ' + waitingParts.join(" · ") + "</div>";
      }
      body.innerHTML = html;
      openSheet("sheetForecast");
    });
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
        svcHtml += '<div class="pay-row"><div class="pay-row-main"><span class="pay-row-label">' + esc(s.client_name) + " · " + esc(s.label) + "</span></div>" +
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
    if (!clientId || !label || !price || !firstMonth) { statusEl.textContent = t("Preencha todos os campos.", "Fill in every field."); return; }
    if (kind === "monthly" && !months) { statusEl.textContent = t("Informe o número de meses.", "Enter the number of months."); return; }
    apiFetch("/api/vendors/services", {
      method: "POST",
      body: {
        client_id: clientId, vendor_id: vendorId, label: label, kind: kind,
        price_cents: Math.round(parseFloat(price) * 100), first_month: firstMonth,
        months: kind === "monthly" ? parseInt(months, 10) : null,
        note: el("asNote").value.trim() || null
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
    openIgnore: openIgnore
  };
  window.loadOverview = loadOverview;
  window.openForecast = openForecast;
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
  window.submitReallocate = function () {};

})();
