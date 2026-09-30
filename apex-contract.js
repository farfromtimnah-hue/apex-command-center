/* Apex's OWN consulting contract builder (Rafa's contract tool, 2026-09-29).
   One file, used by the lead page (client.html) and the X-Ray results meeting
   prep (meeting-prep.html), which Rafa opens from the lead. Same look and flow
   as the portal's contract sheet in gm.js (bottom sheet, hero, grouped rows,
   Preview, sign as the company, send, PDF), drawn with gm.css's .gm-sheet-*
   classes but with no dependency on gm.js.

   Flow: pick the package and add-ons -> the form fills from the lead ->
   Salvar -> Pre-visualizar -> Rafael signs for Apex (Alice asks him by push)
   -> Enviar ao cliente (WhatsApp / copy link) -> each representative signs
   on apex-contract.html -> the signed PDF is filed under Documentos (hidden
   from the client) -> "Salvar condicoes no cliente" makes it the payment plan.

   Rules from rafa-vault entry 48 / registro 45: the TOTAL is fixed by the
   package, the SCHEDULE is always asked; vendor costs roll into the total and
   never print. Host pages call ApexContract.init({ api: fn }) where
   fn(path, method, bodyObj) returns a fetch Response promise. */
(function() {
  "use strict";

  var API = null;
  var S = { clientId: null, mount: null, list: [], prefill: null, packages: null, vendors: [], role: null, clientPhone: null };
  var F = null;          // the builder form state
  var editingId = null;  // contract id being edited (null = new)
  var PAGE = "apex-contract";

  var PKG = {
    start:    { label: "START",    program: "APEX START™",    months: 0 },
    growth:   { label: "GROWTH",   program: "APEX Growth™",   months: 4 },
    advanced: { label: "ADVANCED", program: "APEX Advanced™", months: 6 }
  };
  // Vendor services INSIDE a package's price (Nicole, 2026-09-29): ADVANCED
  // carries social media at $220/month and the site at $300 once.
  // Never printed; once the client signs they land on the Fornecedores page
  // so Pra. Alice knows what to send to Brazil.
  var PKG_INCLUDED = {
    advanced: [
      { key: "social", label: "Gest\u00e3o de redes sociais", recurrence: "monthly", months: 6, vendor_cost_cents: 22000 },
      { key: "site",   label: "Site estrat\u00e9gico",        recurrence: "once",    months: 1, vendor_cost_cents: 30000 }
    ]
  };
  // Accounting is a referral: the client pays the accountant directly, so it
  // is never an add-on and never on the vendor tally.
  function sellableVendors() { return S.vendors.filter(function(v) { return !/contab/i.test(v.vendor_type || ""); }); }
  function defaultVendorId() { var m = sellableVendors().filter(function(v) { return /marketing/i.test(v.vendor_type || ""); }); return m.length === 1 ? m[0].id : null; }
  function vendorOptions(sel) {
    return '<option value="">&mdash; escolher &mdash;</option>' + sellableVendors().map(function(v) { return '<option value="' + esc(v.id) + '"' + (v.id === sel ? " selected" : "") + '>' + esc(v.name) + (v.vendor_type ? " (" + esc(v.vendor_type) + ")" : "") + '</option>'; }).join("");
  }
  var STATUS = {
    draft:  { pt: "Rascunho",                cls: "gm-muted" },
    ready:  { pt: "Assinado pela Apex",      cls: "gm-gold" },
    sent:   { pt: "Enviado ao cliente",      cls: "gm-gold" },
    viewed: { pt: "Aberto pelo cliente",     cls: "gm-gold" },
    signed: { pt: "Assinado por todos",      cls: "gm-green" },
    void:   { pt: "Cancelado",               cls: "gm-red" }
  };

  // ── small helpers ─────────────────────────────────────────────────────
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  function money(c) { var n = Math.round(Number(c) || 0); return "$" + String(Math.floor(n / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + String(n % 100).padStart(2, "0"); }
  function toCents(v) { var n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.]/g, "")); return isNaN(n) ? 0 : Math.round(n * 100); }
  function centsInput(c) { return c ? (Math.round(c) / 100).toFixed(2) : ""; }
  function todayET() {
    try { var p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); return p; }
    catch (e) { return new Date().toISOString().slice(0, 10); }
  }
  function addMonths(s, n, dayWanted) {
    var p = s.split("-").map(Number);
    var y = p[0], m = p[1] - 1 + n;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    var last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    var d = Math.min(dayWanted || p[2], last);
    return y + "-" + String(m + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
  }
  function addDays(s, n) { var d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function fmtDate(s) { if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "")) { return ""; } var p = s.split("-"); return p[1] + "/" + p[2] + "/" + p[0]; }
  function fmtWhen(v) {
    if (!v) { return ""; }
    var s = String(v).replace(" ", "T"); if (!/[Zz]|[+-]\d\d:?\d\d$/.test(s)) { s += "Z"; }
    var d = new Date(s); if (isNaN(d.getTime())) { return v; }
    try { var p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "2-digit", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(d).reduce(function(a, x) { a[x.type] = x.value; return a; }, {});
      return p.month + "/" + p.day + "/" + p.year + " " + p.hour + ":" + p.minute + " " + (p.dayPeriod || "").toUpperCase(); } catch (e) { return v; }
  }
  function byId(id) { return document.getElementById(id); }
  function call(path, method, body) {
    return API(path, method || "GET", body).then(function(res) {
      return res.json().catch(function() { return {}; }).then(function(d) {
        if (!res.ok) { var err = new Error(d.error_pt || d.error || ("Erro " + res.status)); err.problems = d.problems || null; throw err; }
        return d;
      });
    });
  }
  function base() { return "/api/clients/" + encodeURIComponent(S.clientId) + "/apex-contracts"; }
  function link(c, preview) { return c.link + (preview ? "&preview=1" : ""); }
  function isRafa() { return S.role === "rafa" || S.role === "developer"; }

  // ── bottom sheet (gm.css look, own lifecycle) ─────────────────────────
  var sheetEl = null;
  function sheetOpen(title, body) {
    sheetClose();
    var o = document.createElement("div");
    o.className = "gm-sheet-overlay";
    o.innerHTML = '<div class="gm-sheet apx-sheet"><div class="gm-sheet-grabber"></div><div class="gm-sheet-head"><div class="gm-sheet-title">' + title +
      '</div><button type="button" class="gm-sheet-close" aria-label="Fechar" onclick="ApexContract.close()">&#10005;</button></div><div class="gm-sheet-body">' + body + '</div></div>';
    o.addEventListener("click", function(ev) { if (ev.target === o) { sheetClose(); } });
    document.body.appendChild(o);
    sheetEl = o;
  }
  function sheetClose() { if (sheetEl && sheetEl.parentNode) { sheetEl.parentNode.removeChild(sheetEl); } sheetEl = null; }
  function section(title, inner, note) {
    return '<div class="gm-sheet-section"><div class="gm-sheet-section-title">' + title + (note ? ' <span class="gm-sheet-section-note">' + note + '</span>' : "") + '</div>' + inner + '</div>';
  }
  function row(label, value, onclick, sub) {
    var tag = onclick ? "button" : "div";
    return '<' + tag + (onclick ? ' type="button" onclick="' + onclick + '"' : "") + ' class="gm-sheet-row" style="' + (onclick ? "" : "cursor:default;") + '"><span class="gm-sheet-row-body"><span class="gm-sheet-row-label">' + label +
      '</span><span class="gm-sheet-row-value' + (value ? "" : " gm-empty") + '">' + (value || "&mdash;") + '</span>' + (sub ? '<span class="gm-sheet-row-sub">' + sub + '</span>' : "") + '</span>' +
      (onclick ? '<span class="gm-sheet-row-chev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 6l6 6-6 6"/></svg></span>' : "") + '</' + tag + '>';
  }
  function chip(label, sel, onclick) { return '<button type="button" class="gm-choice-chip' + (sel ? " gm-chip-sel" : "") + '" onclick="' + onclick + '">' + label + '</button>'; }
  function field(label, html) { return '<label class="gm-field-label" style="display:block;margin:10px 0 4px;">' + label + '</label>' + html; }
  function pill(st) { var s = STATUS[st] || { pt: st, cls: "gm-muted" }; return '<span class="gm-pill ' + s.cls + '">' + s.pt + '</span>'; }

  // ── card on the host page ─────────────────────────────────────────────
  function load() {
    return call(base()).then(function(d) {
      S.list = d.contracts || []; S.prefill = d.prefill || {}; S.packages = d.packages || {}; S.vendors = d.vendors || []; S.role = d.role; S.clientPhone = d.phone || null;
      renderCard();
      return d;
    }).catch(function(e) {
      if (S.mount) { S.mount.innerHTML = '<div class="gm-derived-note" style="color:var(--red);">Não foi possível carregar os contratos: ' + esc(e.message) + '</div>'; }
      console.error(e);
    });
  }
  function renderCard() {
    if (!S.mount) { return; }
    var h = "";
    if (S.list.length) {
      h += '<div class="gm-sheet-group" style="margin-bottom:10px;">' + S.list.map(function(c) {
        var prog = (PKG[c.package_key] || {}).program || c.package_key;
        return row(esc(c.number) + " &middot; " + esc(prog), money(c.total_cents), "ApexContract.open('" + c.id + "')", (STATUS[c.status] || {}).pt || c.status);
      }).join("") + '</div>';
    } else {
      h += '<div class="gm-derived-note" style="margin:0 0 10px;">Nenhum contrato ainda.</div>';
    }
    h += '<button type="button" class="gm-btn-primary" style="margin-top:0;" onclick="ApexContract.build()">Montar contrato</button>';
    S.mount.innerHTML = h;
  }

  // ── the builder ───────────────────────────────────────────────────────
  function freshForm() {
    var p = S.prefill || {};
    var today = todayET();
    var reps = (p.representatives || []).map(function(r) { return { name: r.name, gender: "m", title: r.title || "" }; });
    if (!reps.length) { reps = [{ name: "", gender: "m", title: "" }]; }
    var f = {
      package_key: p.package_key || null, pricing_option: null,
      company_name: p.company_name || "", company_city: p.company_city || "", company_state: "Flórida", segment: p.segment || "",
      representatives: reps,
      contract_date: today, start_date: today, end_date: null,
      package_price_cents: 0, schedule: [], payment_method: "card_zelle",
      addons: [], bonuses: [], notes: "", signing_city: "",
      _count: 1, _first: today, _freq: 1
    };
    if (f.package_key) { applyPackage(f, f.package_key, true); }
    return f;
  }
  // Package defaults: the price and a suggested split. The split is only a
  // starting point; Rafa sets how THIS client pays (never inherited).
  function applyPackage(f, key, keepDates) {
    var P = S.packages || {};
    f.package_key = key;
    var dv = defaultVendorId();
    f.included_services = (PKG_INCLUDED[key] || []).map(function(x) { return { key: x.key, label: x.label, recurrence: x.recurrence, months: x.months, vendor_cost_cents: x.vendor_cost_cents, vendor_id: dv }; });
    if (key === "start") {
      f.package_price_cents = Math.round((P.start && P.start.price ? P.start.price : 997) * 100);
      f.pricing_option = "upfront"; f._count = 1; f.payment_method = "zelle";
      if (!f.end_date) { f.end_date = addDays(f.start_date, 30); }
    } else if (key === "growth") {
      var g = P.growth || {};
      f.pricing_option = f.pricing_option === "upfront" ? "upfront" : "installment";
      f.package_price_cents = Math.round((f.pricing_option === "upfront" ? (g.upfront || 6997) : (g.installment_total || 8788)) * 100);
      f._count = f.pricing_option === "upfront" ? 1 : (g.count || 4);
      f.payment_method = "card_zelle"; f.end_date = null;
    } else {
      var a = P.advanced || {};
      f.pricing_option = "installment";
      f.package_price_cents = Math.round((a.installment_total || 8382) * 100);
      f._count = a.count || 6; f.payment_method = "card_zelle"; f.end_date = null;
    }
    f._first = f.contract_date;
    rebuildSchedule(f);
  }
  function totalCents(f) {
    var t = f.package_price_cents;
    f.addons.forEach(function(a) { t += a.recurrence === "once" ? a.client_price_cents : a.client_price_cents * (a.months || 1); });
    return t;
  }
  // Equal instalments on the same day each month (or every 3 months); any
  // remainder cents land on the last one. Rows stay editable (balloon plans).
  function rebuildSchedule(f) {
    var n = Math.max(1, Math.min(36, parseInt(f._count, 10) || 1));
    var total = totalCents(f);
    var each = Math.floor(total / n);
    var first = f._first || f.contract_date || todayET();
    var day = Number(first.slice(8, 10));
    var out = [];
    for (var i = 0; i < n; i++) { out.push({ due_date: addMonths(first, i * (f._freq || 1), day), amount_cents: i === n - 1 ? total - each * (n - 1) : each }); }
    f.schedule = out;
  }
  function readForm() {
    // Everything typed is read back into F before any re-render.
    var q = function(id) { var el = byId(id); return el ? el.value : null; };
    if (!byId("apxCompany")) { return; }
    F.company_name = q("apxCompany").trim(); F.company_city = q("apxCity").trim(); F.segment = (q("apxSegment") || "").trim();
    F.representatives.forEach(function(r, i) { r.name = (q("apxRepName" + i) || "").trim(); r.title = (q("apxRepTitle" + i) || "").trim(); });
    F.contract_date = q("apxDate") || F.contract_date; F.start_date = q("apxStart") || F.start_date;
    if (byId("apxEnd")) { F.end_date = q("apxEnd") || null; }
    F.package_price_cents = toCents(q("apxPrice"));
    F.addons.forEach(function(a, i) {
      a.vendor_id = q("apxAddVendor" + i) || null;
      var v = null; S.vendors.forEach(function(x) { if (x.id === a.vendor_id) { v = x; } });
      a.vendor_name = v ? v.name : null;
      a.label = (q("apxAddLabel" + i) || "").trim(); a.description = (q("apxAddDesc" + i) || "").trim();
      a.client_price_cents = toCents(q("apxAddPrice" + i)); a.months = parseInt(q("apxAddMonths" + i), 10) || 1;
      var vc = q("apxAddCost" + i); a.vendor_cost_cents = (vc === null || vc === "") ? null : toCents(vc);
    });
    F.bonuses = F.bonuses.map(function(b, i) { return (q("apxBonus" + i) || "").trim(); });
    (F.included_services || []).forEach(function(x, i) {
      if (byId("apxIncVendor" + i)) { x.vendor_id = q("apxIncVendor" + i) || null; }
      if (byId("apxIncCost" + i)) { var v = q("apxIncCost" + i); x.vendor_cost_cents = v === "" ? null : toCents(v); }
    });
    F.notes = (q("apxNotes") || "").trim();
    F._count = parseInt(q("apxCount"), 10) || 1; F._first = q("apxFirst") || F._first;
    F.schedule.forEach(function(s, i) { s.due_date = q("apxDue" + i) || s.due_date; s.amount_cents = toCents(q("apxAmt" + i)); });
  }

  function renderBuilder() {
    var f = F;
    var h = "";
    // 1. Package
    var pk = '<div class="gm-chip-set">' + ["start", "growth", "advanced"].map(function(k) { return chip(PKG[k].label, f.package_key === k, "ApexContract._pkg('" + k + "')"); }).join("") + '</div>';
    if (f.package_key === "growth") {
      var g = (S.packages && S.packages.growth) || {};
      pk += '<div class="gm-chip-set" style="margin-top:8px;">' + chip("À vista " + money((g.upfront || 6997) * 100), f.pricing_option === "upfront", "ApexContract._opt('upfront')") +
        chip("Parcelado " + (g.count || 4) + "× " + money((g.amount || 2197) * 100), f.pricing_option !== "upfront", "ApexContract._opt('installment')") + '</div>';
    }
    if (f.package_key) {
      pk += field("Valor do pacote ($)", '<input class="gm-input" id="apxPrice" inputmode="decimal" value="' + centsInput(f.package_price_cents) + '" onchange="ApexContract._reprice()">');
      pk += '<div class="gm-derived-note" style="margin-top:0;">O total é fixo. Se o cliente pedir desconto, mude a forma de pagar, não o valor.</div>';
      if ((f.included_services || []).length) {
        pk += '<div class="gm-field-label" style="margin:14px 0 4px;">Fornecedores inclu\u00eddos no pre\u00e7o (n\u00e3o aparecem no contrato; v\u00e3o para a p\u00e1gina de Fornecedores)</div>';
        f.included_services.forEach(function(x, i) {
          pk += '<div style="border:1px solid var(--border);border-radius:12px;padding:8px 12px 2px;margin-bottom:8px;"><div style="font-weight:700;font-size:14px;">' + esc(x.label) + ' <span class="gm-derived-note">' + (x.recurrence === "once" ? "uma vez" : "por m\u00eas, " + x.months + " meses") + '</span></div>' +
            field("Fornecedor", '<select class="gm-input" id="apxIncVendor' + i + '">' + vendorOptions(x.vendor_id) + '</select>') +
            field("Custo do fornecedor ($" + (x.recurrence === "once" ? "" : " por m\u00eas") + ")", '<input class="gm-input" id="apxIncCost' + i + '" inputmode="decimal" value="' + centsInput(x.vendor_cost_cents) + '">') + '</div>';
        });
      }
    }
    h += section("1. Pacote", pk);
    if (!f.package_key) { return h; }

    // 2. Company, from the lead
    var co = field("Nome da empresa (como vai no contrato)", '<input class="gm-input" id="apxCompany" value="' + esc(f.company_name) + '">') +
      field("Cidade", '<input class="gm-input" id="apxCity" value="' + esc(f.company_city) + '" placeholder="ex: Sarasota">');
    if (f.package_key === "start") { co += field("Segmento", '<input class="gm-input" id="apxSegment" value="' + esc(f.segment) + '" placeholder="ex: reforma">'); }
    co += '<div class="gm-field-label" style="margin:12px 0 4px;">Representantes (cada um assina)</div>';
    f.representatives.forEach(function(r, i) {
      co += '<div style="border:1px solid var(--border);border-radius:12px;padding:10px 12px 2px;margin-bottom:8px;">' +
        '<input class="gm-input" id="apxRepName' + i + '" value="' + esc(r.name) + '" placeholder="Nome completo">' +
        '<div class="gm-chip-set" style="margin-bottom:8px;">' + chip("Ele", r.gender !== "f", "ApexContract._gender(" + i + ",'m')") + chip("Ela", r.gender === "f", "ApexContract._gender(" + i + ",'f')") +
        (f.representatives.length > 1 ? '<button type="button" class="gm-choice-chip" onclick="ApexContract._repDel(' + i + ')">Remover</button>' : "") + '</div>' +
        '<input class="gm-input" id="apxRepTitle' + i + '" value="' + esc(r.title) + '" placeholder="Cargo (vazio = ' + esc(defaultTitle(r)) + ')"></div>';
    });
    co += '<button type="button" class="gm-btn-secondary" style="margin-top:0;" onclick="ApexContract._repAdd()">+ Representante</button>';
    h += section("2. Empresa", co, S.prefill && S.prefill.is_lead ? "preenchido pelo lead" : "");

    // 3. Dates
    var dt = field("Data do contrato", '<input class="gm-input" type="date" id="apxDate" value="' + esc(f.contract_date) + '">') +
      field("Início", '<input class="gm-input" type="date" id="apxStart" value="' + esc(f.start_date) + '">');
    if (f.package_key === "start") { dt += field("Término da vigência", '<input class="gm-input" type="date" id="apxEnd" value="' + esc(f.end_date || "") + '">'); }
    else { dt += '<div class="gm-derived-note">Duração: ' + PKG[f.package_key].months + ' meses. O término é calculado a partir do início.</div>'; }
    h += section("3. Datas", dt);

    // 4. Add-ons (vendor services). The client sees the service, never its cost.
    var ad = "";
    f.addons.forEach(function(a, i) {
      ad += '<div style="border:1px solid var(--border);border-radius:12px;padding:10px 12px 2px;margin-bottom:8px;">' +
        field("Fornecedor (vai para a p\u00e1gina de Fornecedores)", '<select class="gm-input" id="apxAddVendor' + i + '">' + vendorOptions(a.vendor_id) + '</select>') +
        field("Serviço (aparece no contrato)", '<input class="gm-input" id="apxAddLabel' + i + '" value="' + esc(a.label) + '" placeholder="ex: Gestão de tráfego pago">') +
        field("Descrição (aparece no contrato)", '<input class="gm-input" id="apxAddDesc' + i + '" value="' + esc(a.description) + '">') +
        '<div class="gm-chip-set" style="margin:4px 0 6px;">' + chip("Mensal", a.recurrence !== "once", "ApexContract._addRec(" + i + ",'monthly')") + chip("Uma vez", a.recurrence === "once", "ApexContract._addRec(" + i + ",'once')") + '</div>' +
        field("Preço ao cliente ($" + (a.recurrence === "once" ? "" : " por mês") + ")", '<input class="gm-input" id="apxAddPrice' + i + '" inputmode="decimal" value="' + centsInput(a.client_price_cents) + '" onchange="ApexContract._reprice()">') +
        (a.recurrence === "once" ? '<input type="hidden" id="apxAddMonths' + i + '" value="1">' : field("Quantos meses", '<input class="gm-input" id="apxAddMonths' + i + '" inputmode="numeric" value="' + (a.months || 1) + '" onchange="ApexContract._reprice()">')) +
        field("Custo do fornecedor (interno, não aparece)", '<input class="gm-input" id="apxAddCost' + i + '" inputmode="decimal" value="' + centsInput(a.vendor_cost_cents) + '">') +
        '<button type="button" class="gm-choice-chip" style="margin-bottom:10px;" onclick="ApexContract._addDel(' + i + ')">Remover</button></div>';
    });
    ad += '<button type="button" class="gm-btn-secondary" style="margin-top:0;" onclick="ApexContract._addAdd()">+ Serviço adicional</button>';
    h += section("4. Adicionais", ad, "somam ao total; o custo não aparece");

    // 5. Payment: always asked
    var tot = totalCents(f), sum = 0;
    f.schedule.forEach(function(s) { sum += s.amount_cents; });
    var pay = '<div class="gm-sheet-hero" style="margin-bottom:10px;"><div class="gm-sheet-hero-half" style="cursor:default;"><span class="gm-sheet-hero-body"><span class="gm-sheet-hero-label">Total do contrato</span><span class="gm-sheet-hero-value">' + money(tot) + '</span></span></div></div>' +
      '<div class="gm-chip-set">' + chip("Cartão ou Zelle", f.payment_method !== "zelle", "ApexContract._method('card_zelle')") + chip("Só Zelle", f.payment_method === "zelle", "ApexContract._method('zelle')") + '</div>' +
      field("Número de parcelas", '<input class="gm-input" id="apxCount" inputmode="numeric" value="' + (f._count || 1) + '" onchange="ApexContract._resched()">') +
      field("1º vencimento", '<input class="gm-input" type="date" id="apxFirst" value="' + esc(f._first || "") + '" onchange="ApexContract._resched()">') +
      '<div class="gm-chip-set" style="margin-bottom:8px;">' + chip("Mensal", (f._freq || 1) === 1, "ApexContract._freq(1)") + chip("Trimestral", f._freq === 3, "ApexContract._freq(3)") + '</div>' +
      '<div class="gm-sheet-group">' + f.schedule.map(function(s, i) {
        return '<div style="display:flex;gap:8px;align-items:center;padding:8px 10px;border-bottom:1px solid var(--border);"><span style="width:34px;font-weight:700;font-size:13px;">' + (i + 1) + 'ª</span>' +
          '<input class="gm-input" style="margin:0;flex:1;min-width:0;" type="date" id="apxDue' + i + '" value="' + esc(s.due_date || "") + '">' +
          '<input class="gm-input" style="margin:0;width:120px;" inputmode="decimal" id="apxAmt' + i + '" value="' + centsInput(s.amount_cents) + '" onchange="ApexContract._sum()"></div>';
      }).join("") + '</div>' +
      '<div class="gm-derived-note" id="apxSum">' + sumNote(sum, tot) + '</div>';
    h += section("5. Pagamento", pay, "sempre perguntado ao cliente");

    // 6. Bonus + specific clause
    var bo = f.bonuses.map(function(b, i) { return '<div style="display:flex;gap:8px;"><input class="gm-input" id="apxBonus' + i + '" value="' + esc(b) + '" placeholder="ex: DISC para a esposa"><button type="button" class="gm-choice-chip" style="margin-bottom:10px;" onclick="ApexContract._bonusDel(' + i + ')">&#10005;</button></div>'; }).join("") +
      '<button type="button" class="gm-btn-secondary" style="margin-top:0;" onclick="ApexContract._bonusAdd()">+ Bônus</button>' +
      field("Cláusula específica deste cliente (opcional)", '<textarea class="gm-input" id="apxNotes" placeholder="Entra como uma cláusula própria, antes do foro.">' + esc(f.notes) + '</textarea>');
    h += section("6. Bônus e observações", bo, "sem custo para o cliente");

    h += '<div class="gm-warn" id="apxErr" style="margin-top:6px;"></div>' +
      '<button type="button" class="gm-btn-primary" id="apxSave" onclick="ApexContract._save()">' + (editingId ? "Salvar alterações" : "Salvar contrato") + '</button>';
    return h;
  }
  function defaultTitle(r) {
    if (F && F.package_key === "start") { return r.gender === "f" ? "Sócia Administradora" : "Sócio Administrador"; }
    return r.gender === "f" ? "Proprietária / Representante Legal" : "Proprietário / Representante Legal";
  }
  function sumNote(sum, tot) {
    if (sum === tot) { return "As parcelas somam " + money(sum) + ". Confere com o total."; }
    return '<span class="gm-warn">As parcelas somam ' + money(sum) + ", mas o total é " + money(tot) + ". Ajuste um valor ou toque em Gerar de novo.</span>" +
      ' <button type="button" class="gm-choice-chip" onclick="ApexContract._resched()">Gerar de novo</button>';
  }
  function redrawBuilder(scrollKeep) {
    if (!sheetEl) { return; }
    var body = sheetEl.querySelector(".gm-sheet-body"), sheet = sheetEl.querySelector(".gm-sheet");
    var top = sheet ? sheet.scrollTop : 0;
    body.innerHTML = renderBuilder();
    if (scrollKeep && sheet) { sheet.scrollTop = top; }
  }
  function openBuilder(existing) {
    editingId = existing ? existing.id : null;
    if (existing) {
      F = JSON.parse(JSON.stringify(existing.data || {}));
      F.representatives = F.representatives && F.representatives.length ? F.representatives : [{ name: "", gender: "m", title: "" }];
      F.addons = F.addons || []; F.bonuses = F.bonuses || []; F.schedule = F.schedule || []; F.included_services = F.included_services || [];
      F._count = F.schedule.length || 1; F._first = (F.schedule[0] && F.schedule[0].due_date) || F.contract_date; F._freq = 1;
      if (F.schedule.length > 1) {
        var d0 = F.schedule[0].due_date, day = Number(d0.slice(8, 10));
        if (F.schedule[1].due_date === addMonths(d0, 3, day)) { F._freq = 3; }
      }
    } else {
      F = freshForm();
    }
    sheetOpen(editingId ? "Editar contrato " + esc(existing.number) : "Montar contrato", renderBuilder());
  }

  function save() {
    readForm();
    var err = byId("apxErr"); if (err) { err.textContent = ""; }
    var data = JSON.parse(JSON.stringify(F));
    delete data._count; delete data._first; delete data._freq;
    data.representatives = data.representatives.filter(function(r) { return r.name; });
    var btn = byId("apxSave"); if (btn) { btn.disabled = true; btn.textContent = "Salvando..."; }
    var p = editingId ? call(base() + "/" + editingId, "PUT", { data: data }) : call(base(), "POST", data);
    p.then(function(d) {
      return load().then(function() { openDetail(d.contract.id); });
    }).catch(function(e) {
      if (btn) { btn.disabled = false; btn.textContent = editingId ? "Salvar alterações" : "Salvar contrato"; }
      if (err) { err.textContent = e.message; }
    });
  }

  // ── the contract sheet (after saving) ─────────────────────────────────
  function find(id) { var out = null; S.list.forEach(function(c) { if (c.id === id) { out = c; } }); return out; }
  function openDetail(id) {
    var c = find(id);
    if (!c) { return; }
    var doc = c.contract || {};
    var h = '<div class="gm-sheet-hero"><div class="gm-sheet-hero-half" style="cursor:default;"><span class="gm-sheet-hero-body"><span class="gm-sheet-hero-label">Status</span><span class="gm-sheet-hero-pill">' + pill(c.status) + '</span></span></div>' +
      '<div class="gm-sheet-hero-half" style="cursor:default;"><span class="gm-sheet-hero-body"><span class="gm-sheet-hero-label">Total do contrato</span><span class="gm-sheet-hero-value">' + money(c.total_cents) + '</span>' +
      (c.vendor_cost_cents ? '<span class="gm-sheet-hero-hint">Custo de fornecedores (interno): ' + money(c.vendor_cost_cents) + '</span>' : "") + '</span></div></div>';

    var acts = '<div class="gm-est-actions">';
    if (c.status === "draft") {
      if (c.problems && c.problems.length) {
        h += section("Falta completar", '<div class="gm-sheet-group" style="padding:10px 13px;">' + c.problems.map(function(p) { return '<div class="gm-warn" style="font-size:14px;margin:4px 0;">' + esc(p) + '</div>'; }).join("") + '</div>');
      }
      acts += '<button type="button" class="gm-btn-secondary" onclick="ApexContract._edit(\'' + c.id + '\')">Editar</button>';
      acts += '<a class="gm-btn-secondary" href="' + esc(link(c, true)) + '" target="_blank" rel="noopener">Pré-visualizar</a>';
      if (!c.problems || !c.problems.length) {
        if (isRafa()) { acts += '<button type="button" class="gm-btn-primary" onclick="ApexContract._signOpen(\'' + c.id + '\')">Assinar pela Apex</button>'; }
        else { acts += '<button type="button" class="gm-btn-primary" id="apxAsk" onclick="ApexContract._ask(\'' + c.id + '\')">Pedir assinatura ao Pr. Rafael</button>'; }
      }
    } else if (c.status === "ready" || c.status === "sent" || c.status === "viewed") {
      acts += '<button type="button" class="gm-btn-primary" onclick="ApexContract._sendOpen(\'' + c.id + '\')">' + (c.status === "ready" ? "Enviar ao cliente" : "Enviar de novo") + '</button>';
      acts += '<a class="gm-btn-secondary" href="' + esc(link(c, true)) + '" target="_blank" rel="noopener">Ver contrato</a>';
      if (!(c.client_signatures || []).length) { acts += '<button type="button" class="gm-btn-secondary" onclick="ApexContract._reopen(\'' + c.id + '\')">Editar (retira a assinatura da Apex)</button>'; }
    } else if (c.status === "signed") {
      acts += '<a class="gm-btn-secondary" href="' + esc(link(c, true)) + '" target="_blank" rel="noopener">Ver contrato assinado</a>';
      if (!c.terms_applied_at) { acts += '<button type="button" class="gm-btn-primary" id="apxTerms" onclick="ApexContract._terms(\'' + c.id + '\')">Salvar condições de pagamento no cliente</button>'; }
    }
    if (c.status !== "void" && c.status !== "draft") {
      acts += '<a class="gm-btn-secondary" href="https://apex-api.farfromtimnah.workers.dev/api/public/pdf/apex-contract/' + esc(c.link.split("t=")[1]) + '" target="_blank" rel="noopener">Baixar PDF</a>';
    }
    acts += '</div><div class="gm-warn" id="apxActErr" style="margin-top:8px;"></div>';
    h += acts;

    var info = row("Programa", esc(doc.program || ""), null) +
      row("Empresa", esc(doc.company_name || ""), null) +
      row("Criado", esc(fmtWhen(c.created_at)), null, esc(c.created_by || ""));
    if (c.sent_at) { info += row("Enviado", esc(fmtWhen(c.sent_at)), null); }
    if (c.first_viewed_at) { info += row("Aberto pelo cliente", esc(fmtWhen(c.first_viewed_at)), null); }
    if (c.terms_applied_at) { info += row("Condições de pagamento", "Salvas no cliente", null, esc(fmtWhen(c.terms_applied_at))); }
    if (c.document_id) { info += row("Cópia assinada", "Em Documentos (oculta do cliente)", null); }
    if (c.status === "void") { info += row("Motivo do cancelamento", esc(c.void_reason || ""), null); }
    h += section("Contrato", '<div class="gm-sheet-group">' + info + '</div>');

    var sig = row("Apex", c.company_signature ? esc(c.company_signature.signer_name) : "", null, c.company_signature ? "Assinou " + esc(fmtWhen(c.company_signature.signed_at)) : "Aguardando");
    ((doc.signers && doc.signers.client) || []).forEach(function(s) {
      var done = null; (c.client_signatures || []).forEach(function(x) { if (x.index === s.index) { done = x; } });
      sig += row(esc(s.org), esc(done ? done.signer_name : s.name), null, done ? "Assinou " + esc(fmtWhen(done.signed_at)) : "Aguardando");
    });
    h += section("Assinaturas", '<div class="gm-sheet-group">' + sig + '</div>');

    if (c.status !== "void" && c.status !== "signed") {
      h += '<button type="button" class="gm-btn-secondary" style="color:var(--red);" onclick="ApexContract._voidOpen(\'' + c.id + '\')">Cancelar contrato</button>';
    }
    sheetOpen("Contrato " + esc(c.number), h);
  }

  function actErr(e) { var el = byId("apxActErr") || byId("apxSignErr"); if (el) { el.textContent = e.message + (e.problems ? " " + e.problems.join(" ") : ""); } }
  function after(id) { return function() { return load().then(function() { openDetail(id); }); }; }

  // Rafael signs for Apex (typed or drawn), same pad as the portal.
  var pad = { ctx: null, drew: false, drawing: false }, companyKind = "typed";
  function signOpen(id) {
    var c = find(id); if (!c) { return; }
    var who = (c.contract && c.contract.signers && c.contract.signers.company) || { name: "Rafael Prata" };
    var h = '<p class="gm-derived-note" style="margin-top:0;">Leia a pré-visualização antes de assinar. Depois de assinado, o texto fica congelado.</p>' +
      '<a class="gm-btn-secondary" style="text-align:center;text-decoration:none;" href="' + esc(link(c, true)) + '" target="_blank" rel="noopener">Pré-visualizar</a>' +
      field("Nome", '<input class="gm-input" id="apxSigName" value="' + esc(who.name) + '">') +
      '<div class="gm-chip-set">' + chip("Digitar meu nome", companyKind === "typed", "ApexContract._ckind('typed','" + id + "')") + chip("Desenhar", companyKind === "drawn", "ApexContract._ckind('drawn','" + id + "')") + '</div>' +
      (companyKind === "drawn" ? '<canvas id="apxSigCanvas" style="width:100%;height:160px;border:2px dashed var(--border);border-radius:10px;background:#fff;touch-action:none;display:block;margin-top:10px;"></canvas><button type="button" class="gm-btn-secondary" onclick="ApexContract._clear()">Limpar</button>' : "") +
      '<label style="display:flex;gap:10px;align-items:flex-start;margin-top:12px;font-size:14px;"><input type="checkbox" id="apxSigConsent" style="width:22px;height:22px;flex:0 0 auto;"><span>Assino eletronicamente este contrato em nome da APEX Business &amp; Leadership.</span></label>' +
      '<div class="gm-warn" id="apxSignErr" style="margin-top:8px;"></div><button type="button" class="gm-btn-primary" id="apxSignBtn" onclick="ApexContract._sign(\'' + id + '\')">Assinar pela Apex</button>' +
      '<button type="button" class="gm-btn-secondary" onclick="ApexContract.open(\'' + id + '\')">Voltar</button>';
    sheetOpen("Assinar pela Apex", h);
    if (companyKind === "drawn") { setupPad(); }
  }
  function setupPad() {
    var c = byId("apxSigCanvas"); if (!c) { return; }
    var ratio = window.devicePixelRatio || 1, w = c.clientWidth || 300;
    c.width = Math.round(w * ratio); c.height = Math.round(160 * ratio);
    var ctx = c.getContext("2d"); ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#111";
    pad = { ctx: ctx, drew: false, drawing: false };
    function pos(ev) { var r = c.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; }
    c.onpointerdown = function(ev) { pad.drawing = true; pad.drew = true; var p = pos(ev); ctx.beginPath(); ctx.moveTo(p.x, p.y); ev.preventDefault(); };
    c.onpointermove = function(ev) { if (!pad.drawing) { return; } var p = pos(ev); ctx.lineTo(p.x, p.y); ctx.stroke(); ev.preventDefault(); };
    c.onpointerup = c.onpointerleave = function() { pad.drawing = false; };
  }
  function sign(id) {
    var err = byId("apxSignErr"); err.textContent = "";
    if (!byId("apxSigConsent").checked) { err.textContent = "Confirme a assinatura eletrônica."; return; }
    var body = { signer_name: byId("apxSigName").value.trim(), signature_kind: companyKind, consent: true };
    if (companyKind === "drawn") { if (!pad.drew) { err.textContent = "Desenhe a assinatura."; return; } body.signature_png = byId("apxSigCanvas").toDataURL("image/png"); }
    var b = byId("apxSignBtn"); b.disabled = true; b.textContent = "Assinando...";
    call(base() + "/" + id + "/company-sign", "POST", body).then(after(id)).catch(function(e) { b.disabled = false; b.textContent = "Assinar pela Apex"; actErr(e); });
  }

  // Send: WhatsApp with the link, or copy it. Either marks it sent.
  function sendOpen(id) {
    var c = find(id); if (!c) { return; }
    var doc = c.contract || {};
    var first = ((doc.signers && doc.signers.client) || [])[0];
    var firstName = first ? String(first.name).split(/\s+/)[0] : "";
    var msg = "Olá" + (firstName ? " " + firstName : "") + "! Segue o contrato do " + (doc.program || "programa APEX") + " para você ler e assinar pelo celular: " + (c.share_link || c.link);
    var phone = String(S.clientPhone || "").replace(/\D/g, "");
    if (phone.length === 10) { phone = "1" + phone; }
    var wa = "https://wa.me/" + (phone || "") + "?text=" + encodeURIComponent(msg);
    var h = field("Mensagem", '<textarea class="gm-input" id="apxMsg">' + esc(msg) + '</textarea>') +
      '<a class="gm-btn-primary" style="text-align:center;text-decoration:none;" id="apxWa" href="' + esc(wa) + '" target="_blank" rel="noopener" onclick="ApexContract._sent(\'' + id + '\', true)">Enviar pelo WhatsApp</a>' +
      '<button type="button" class="gm-btn-secondary" onclick="ApexContract._copy(\'' + id + '\')">Copiar link</button>' +
      '<div class="gm-derived-note" id="apxCopyNote"></div>' +
      (doc.signers && doc.signers.client && doc.signers.client.length > 1 ? '<div class="gm-derived-note">Os ' + doc.signers.client.length + ' representantes assinam no mesmo link, um de cada vez.</div>' : "") +
      '<button type="button" class="gm-btn-secondary" onclick="ApexContract.open(\'' + id + '\')">Voltar</button>';
    sheetOpen("Enviar ao cliente", h);
    var ta = byId("apxMsg");
    if (ta) { ta.oninput = function() { byId("apxWa").href = "https://wa.me/" + (phone || "") + "?text=" + encodeURIComponent(ta.value); }; }
  }
  function markSent(id, keepOpen) {
    return call(base() + "/" + id + "/sent", "POST", {}).then(function() { return load(); }).then(function() { if (!keepOpen) { openDetail(id); } }).catch(function(e) { console.error(e); });
  }
  function copy(id) {
    var c = find(id); if (!c) { return; }
    var note = byId("apxCopyNote");
    var done = function() { if (note) { note.textContent = "Link copiado."; } markSent(id, true); };
    var l = c.share_link || c.link;
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(l).then(done).catch(function() { window.prompt("Copie o link:", l); done(); }); }
    else { window.prompt("Copie o link:", l); done(); }
  }

  function voidOpen(id) {
    sheetOpen("Cancelar contrato", field("Motivo", '<input class="gm-input" id="apxVoidReason" placeholder="ex: cliente escolheu outro pacote">') +
      '<p class="gm-derived-note">O link do cliente passa a dizer que o contrato foi cancelado. Nada é apagado.</p>' +
      '<div class="gm-warn" id="apxActErr"></div><button type="button" class="gm-btn-primary" onclick="ApexContract._void(\'' + id + '\')">Cancelar contrato</button>' +
      '<button type="button" class="gm-btn-secondary" onclick="ApexContract.open(\'' + id + '\')">Voltar</button>');
  }

  // ── public surface ────────────────────────────────────────────────────
  window.ApexContract = {
    init: function(opts) { API = opts.api; },
    // Draws the list + "Montar contrato" into el for this lead/client.
    mount: function(el, clientId, extra) { S.mount = el; S.clientId = clientId; if (extra && extra.phone) { S.clientPhone = extra.phone; } return load(); },
    // Opens the builder straight away (meeting prep button).
    start: function(clientId, extra) {
      S.clientId = clientId; if (extra && extra.phone) { S.clientPhone = extra.phone; }
      return load().then(function() {
        var live = S.list.filter(function(c) { return c.status !== "void"; })[0];
        if (live) { openDetail(live.id); } else { openBuilder(null); }
      });
    },
    build: function() { openBuilder(null); },
    open: function(id) { openDetail(id); },
    close: sheetClose,
    _pkg: function(k) { readForm(); if (F.package_key !== k) { applyPackage(F, k); } redrawBuilder(true); },
    _opt: function(o) { readForm(); F.pricing_option = o; applyPackage(F, "growth"); redrawBuilder(true); },
    _reprice: function() { readForm(); rebuildSchedule(F); redrawBuilder(true); },
    _resched: function() { readForm(); rebuildSchedule(F); redrawBuilder(true); },
    _freq: function(n) { readForm(); F._freq = n; rebuildSchedule(F); redrawBuilder(true); },
    _sum: function() { readForm(); var s = 0; F.schedule.forEach(function(x) { s += x.amount_cents; }); var el = byId("apxSum"); if (el) { el.innerHTML = sumNote(s, totalCents(F)); } },
    _method: function(m) { readForm(); F.payment_method = m; redrawBuilder(true); },
    _gender: function(i, g) { readForm(); F.representatives[i].gender = g; redrawBuilder(true); },
    _repAdd: function() { readForm(); F.representatives.push({ name: "", gender: "m", title: "" }); redrawBuilder(true); },
    _repDel: function(i) { readForm(); F.representatives.splice(i, 1); redrawBuilder(true); },
    _addAdd: function() { readForm(); F.addons.push({ vendor_id: null, label: "", description: "", recurrence: "monthly", months: (PKG[F.package_key] || {}).months || 1, client_price_cents: 0, vendor_cost_cents: null }); redrawBuilder(true); },
    _addDel: function(i) { readForm(); F.addons.splice(i, 1); rebuildSchedule(F); redrawBuilder(true); },
    _addRec: function(i, r) { readForm(); F.addons[i].recurrence = r; rebuildSchedule(F); redrawBuilder(true); },
    _bonusAdd: function() { readForm(); F.bonuses.push(""); redrawBuilder(true); },
    _bonusDel: function(i) { readForm(); F.bonuses.splice(i, 1); redrawBuilder(true); },
    _save: save,
    _edit: function(id) { openBuilder(find(id)); },
    _signOpen: function(id) { companyKind = "typed"; signOpen(id); },
    _ckind: function(k, id) { var nm = byId("apxSigName") ? byId("apxSigName").value : null; companyKind = k; signOpen(id); if (nm !== null && byId("apxSigName")) { byId("apxSigName").value = nm; } },
    _clear: function() { var c = byId("apxSigCanvas"); if (c && pad.ctx) { pad.ctx.clearRect(0, 0, c.width, c.height); pad.drew = false; } },
    _sign: sign,
    _ask: function(id) { var b = byId("apxAsk"); if (b) { b.disabled = true; } call(base() + "/" + id + "/ask-rafael", "POST", {}).then(function(d) { if (b) { b.textContent = d.pushed ? "Pedido enviado ao Pr. Rafael" : "Pedido registrado"; } }).catch(function(e) { if (b) { b.disabled = false; } actErr(e); }); },
    _sendOpen: sendOpen,
    _sent: function(id) { markSent(id, true); },
    _copy: copy,
    _reopen: function(id) { call(base() + "/" + id, "PUT", { reopen: true }).then(function() { return load(); }).then(function() { openBuilder(find(id)); }).catch(actErr); },
    _voidOpen: voidOpen,
    _void: function(id) { var r = (byId("apxVoidReason").value || "").trim(); call(base() + "/" + id + "/void", "POST", { reason: r }).then(after(id)).catch(actErr); },
    _terms: function(id) { var b = byId("apxTerms"); if (b) { b.disabled = true; b.textContent = "Salvando..."; } call(base() + "/" + id + "/apply-terms", "POST", {}).then(after(id)).catch(function(e) { if (b) { b.disabled = false; b.textContent = "Salvar condições de pagamento no cliente"; } actErr(e); }); }
  };
})();
