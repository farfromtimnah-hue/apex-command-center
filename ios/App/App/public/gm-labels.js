// Stored KEYS vs displayed LABELS — the shape that makes the portal bilingual.
//
// THE DEFECT THIS EXISTS TO FIX. gm.js calls gmT(pt, en) in hundreds of places
// and the machinery works, but gmT can only translate strings that live in the
// CODE. Anything stored in the database as a display string can never
// translate, no matter how good the toggle is. gm_leads.estagio stored
// "Negociação" as literal text, so an English-speaking owner saw English
// chrome wrapped around Portuguese data — at its worst, gm.js read
// "Stage: Novo Lead · Date: now."
//
// THE RULE, applied to every FIXED system list:
//   * the database stores a stable, language-neutral KEY ('negociacao');
//   * the UI looks up the LABEL for the caller's language at render time.
//
// A key never changes when a translation is corrected, and a label never
// reaches the database. Client-AUTHORED vocabulary (servicos, vendedores,
// partner names, job names, lead names) is deliberately NOT in here: it is
// the client's own words and must never be machine-translated.
//
// Shared by portal.html/gm.js and seller-diagnostics.html so a label is
// defined exactly once. Loaded as a plain script; attaches to window.

(function (global) {
  "use strict";

  // ── Lead pipeline stages ───────────────────────────────────────────────
  //
  // A FIXED, never-configurable ladder — no client can add a stage (see the
  // comment block in migrations/lead_pipeline.sql), which is what makes keys
  // safe here. ORDER MATTERS: it is the pipeline order the UI renders in.
  var STAGES = [
    { key: "novo_lead",        pt: "Novo Lead",        en: "New Lead" },
    { key: "contato_feito",    pt: "Contato Feito",    en: "Contacted" },
    { key: "visita_agendada",  pt: "Visita Agendada",  en: "Visit Scheduled" },
    { key: "estimate_enviado", pt: "Estimate Enviado", en: "Estimate Sent" },
    { key: "follow_up",        pt: "Follow-up",        en: "Follow-up" },
    { key: "negociacao",       pt: "Negociação",       en: "Negotiation" },
    { key: "fechado",          pt: "Fechado",          en: "Closed" },
    { key: "perdido",          pt: "Perdido",          en: "Lost" }
  ];

  // The three stages "pipeline ativo" sums. Visita Agendada and Contato Feito
  // deliberately do NOT count — the client's own rule, unchanged by the
  // rename; only the representation moved from label to key.
  var ACTIVE_PIPELINE_STAGE_KEYS = ["estimate_enviado", "follow_up", "negociacao"];
  // "Live" = everything except closed and lost.
  var LIVE_STAGE_KEYS = ["novo_lead", "contato_feito", "visita_agendada",
                         "estimate_enviado", "follow_up", "negociacao"];

  var STAGE_KEYS = STAGES.map(function (s) { return s.key; });

  var STAGE_BY_KEY = {};
  STAGES.forEach(function (s) { STAGE_BY_KEY[s.key] = s; });

  // Legacy Portuguese label -> key, for reading rows written before the
  // migration and for any request body that still sends a display string.
  var STAGE_KEY_BY_LABEL = {};
  STAGES.forEach(function (s) {
    STAGE_KEY_BY_LABEL[s.pt] = s.key;
    STAGE_KEY_BY_LABEL[s.en] = s.key;
  });

  // Normalise anything that might be a stage into a key.
  //
  // Accepts a key, a Portuguese label or an English label, so a stale client
  // build posting "Negociação" still writes negociacao rather than being
  // rejected. Returns null for anything unrecognised — callers decide whether
  // that is an error; nothing here silently coerces an unknown stage into a
  // real one.
  function stageKey(v) {
    if (v === null || v === undefined) { return null; }
    var s = String(v).trim();
    if (!s) { return null; }
    if (STAGE_BY_KEY[s]) { return s; }
    if (STAGE_KEY_BY_LABEL[s]) { return STAGE_KEY_BY_LABEL[s]; }
    return null;
  }

  // The label for a stage key in the caller's language. An unknown key is
  // echoed back rather than blanked: showing the raw value is more honest
  // than showing nothing, and it makes a missed migration visible instead of
  // silent.
  function stageLabel(key, en) {
    var s = STAGE_BY_KEY[key];
    if (!s) { return key === null || key === undefined ? "" : String(key); }
    return en ? s.en : s.pt;
  }

  // ── Calendar event types ───────────────────────────────────────────────
  //
  // UNLIKE STAGES, CLIENTS CAN ADD THEIR OWN, so the stored shape carries the
  // labels with the key:
  //   [{key:"visita_tecnica", pt:"Visita técnica", en:"Site visit"}, ...]
  //
  // A type a client adds themselves stores THE SAME TEXT in pt and en. Their
  // vocabulary is theirs and must never be machine-translated; it simply
  // displays identically in both languages. That is correct behaviour, not a
  // gap.
  //
  // This table is the translation for the SEEDED types only. It is also what
  // the migration uses to convert the old string arrays.
  var EVENT_TYPE_EN = {
    "Visita técnica": "Site visit",
    "Medição": "Measurement",
    "Instalação": "Installation",
    "Entrega de material": "Material delivery",
    "Início de obra": "Job start",
    "Entrega de obra": "Job completion",
    "Reunião": "Meeting",
    "Apresentação de projeto": "Design presentation",
    "Pedido de material": "Material order",
    "Chegada de importação": "Import arrival",
    "Entrega / retirada": "Delivery / pickup",
    "Degustação": "Tasting",
    "Consulta de projeto": "Design consultation",
    "Sinal / confirmação": "Deposit / confirmation",
    "Dia de produção": "Production day",
    "Dia de decoração": "Decorating day",
    "Atendimento personalizado": "Personal shopping",
    "Prova / ajuste": "Fitting / alteration",
    "Atendimento online": "Virtual appointment",
    "Chegada de novidades": "New arrivals",
    "Live": "Live sale",
    "Viagem de compras": "Buying trip",
    "Evento / pop-up": "Event / pop-up",
    "Visita": "Visit",
    "Serviço": "Service",
    "Entrega": "Delivery",
    "Outro": "Other"
  };

  // Stable keys for the seeded types, so the same concept carries the same key
  // for every client and a corrected translation never orphans stored rows.
  var EVENT_TYPE_KEY = {
    "Visita técnica": "visita_tecnica",
    "Medição": "medicao",
    "Instalação": "instalacao",
    "Entrega de material": "entrega_de_material",
    "Início de obra": "inicio_de_obra",
    "Entrega de obra": "entrega_de_obra",
    "Reunião": "reuniao",
    "Apresentação de projeto": "apresentacao_de_projeto",
    "Pedido de material": "pedido_de_material",
    "Chegada de importação": "chegada_de_importacao",
    "Entrega / retirada": "entrega_retirada",
    "Degustação": "degustacao",
    "Consulta de projeto": "consulta_de_projeto",
    "Sinal / confirmação": "sinal_confirmacao",
    "Dia de produção": "dia_de_producao",
    "Dia de decoração": "dia_de_decoracao",
    "Atendimento personalizado": "atendimento_personalizado",
    "Prova / ajuste": "prova_ajuste",
    "Atendimento online": "atendimento_online",
    "Chegada de novidades": "chegada_de_novidades",
    "Live": "live",
    "Viagem de compras": "viagem_de_compras",
    "Evento / pop-up": "evento_pop_up",
    "Visita": "visita",
    "Serviço": "servico",
    "Entrega": "entrega",
    "Outro": "outro"
  };

  // THE one true "Outro" key. Compared as a KEY, never as a lowercased display
  // string: "Other" and "Outro" are the same escape hatch and a string compare
  // gets that wrong the moment the UI is in English.
  var OUTRO_KEY = "outro";

  // A slug for a type a client typed themselves. Suffixed with a short random
  // tag so two different custom types that slugify the same ("Prova!" and
  // "prova") cannot collide and silently become one type.
  function customEventTypeKey(label, rnd) {
    var base = String(label || "")
      .toLowerCase()
      .normalize ? String(label || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
                 : String(label || "").toLowerCase();
    base = base.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32);
    if (!base) { base = "tipo"; }
    return "custom_" + base + "_" + (rnd || Math.random().toString(36).slice(2, 6));
  }

  // Normalise one stored event type into {key, pt, en}.
  //
  // Tolerates the OLD shape (a bare string) so a client whose gm_config has
  // not been migrated yet still gets a working picker: the string becomes both
  // labels, and a seeded name also picks up its stable key and translation.
  function normalizeEventType(t) {
    if (!t) { return null; }
    if (typeof t === "string") {
      var key = EVENT_TYPE_KEY[t] || customEventTypeKey(t, "lgcy");
      return { key: key, pt: t, en: EVENT_TYPE_EN[t] || t };
    }
    if (!t.key) { return null; }
    return { key: t.key, pt: t.pt || t.key, en: t.en || t.pt || t.key };
  }

  function normalizeEventTypes(list) {
    var out = [];
    (list || []).forEach(function (t) {
      var n = normalizeEventType(t);
      if (n) { out.push(n); }
    });
    return out;
  }

  // The label for an event-type key, looked up in the client's OWN configured
  // list (their custom types are only defined there). Falls back to the seeded
  // translation table, then to the key itself.
  function eventTypeLabel(key, types, en) {
    var list = normalizeEventTypes(types);
    for (var i = 0; i < list.length; i++) {
      if (list[i].key === key) { return en ? list[i].en : list[i].pt; }
    }
    // Not in this client's list any more (a type they removed, on an event
    // that still references it). Try the seeded table by key before giving up.
    var byKey = null;
    Object.keys(EVENT_TYPE_KEY).forEach(function (pt) {
      if (EVENT_TYPE_KEY[pt] === key) { byKey = pt; }
    });
    if (byKey) { return en ? (EVENT_TYPE_EN[byKey] || byKey) : byKey; }
    return key === null || key === undefined ? "" : String(key);
  }

  // ── Other FIXED system lists ───────────────────────────────────────────
  //
  // Job status, roadmap status/frente, Base de Ouro status, partner status and
  // lead origem are all fixed lists a client cannot add to, so they have the
  // same defect stages had: the stored value IS the display string.
  //
  // TRANSLATED AT THE DISPLAY LAYER ONLY — the stored values stay Portuguese
  // and NO data migration is performed. That is a deliberate, narrower fix
  // than the one applied to stages, and the reason is risk asymmetry:
  //
  //   * Stages earned a full key migration because gm_leads.estagio is
  //     compared in revenue SQL (receita_fechada, pipeline_ativo), so the
  //     stored representation had to be language-neutral to be safe.
  //   * These five are compared in far fewer places and none of them produce
  //     a money figure, so a lookup table at render time buys the whole
  //     bilingual benefit at none of the migration risk (~950 live rows).
  //
  // NOT DONE, deliberately: gm_finance.tipo (Entrada / Saída). It is DERIVED
  // from gm_config.finance_categories_json, whose category names are
  // admin-editable per client and which embeds tipo per category. Migrating
  // the column means migrating that JSON for every client and re-deriving
  // every row — real risk to money classification for a two-value list.
  // Left alone on purpose; see the report.
  var STATUS_EN = {
    // gm_jobs.status
    "Em andamento": "In progress",
    "Concluída": "Completed",
    "Atrasada": "Late",
    "Pausada": "Paused",
    // gm_roadmap.status ("Em andamento" shared with jobs above)
    "Realizado": "Done",
    "Pendente": "Pending",
    "Atrasado": "Late",
    "Cancelado": "Cancelled",
    // gm_base_ouro.status
    "Não contatado": "Not contacted",
    "Contatado": "Contacted",
    "Interessado": "Interested",
    "Reativado": "Reactivated",
    "Sem interesse": "Not interested",
    // gm_partners.status
    "Prospectando": "Prospecting",
    "Ativo": "Active",
    "Inativo": "Inactive",
    // gm_roadmap.frente
    "Comercial": "Sales",
    "Gestão": "Management",
    "Base de Ouro": "Golden Base",
    "Financeiro": "Finance",
    "Parcerias": "Partnerships",
    "Marketing": "Marketing",
    "Operação": "Operations",
    // gm_leads.origem
    "Orgânico": "Organic",
    "Tráfego pago": "Paid traffic",
    "Indicação": "Referral",
    "Base de Clientes": "Customer base",
    "Parceiro": "Partner",
    "Google": "Google",
    "Instagram": "Instagram",
    "Site": "Website",
    "Outro": "Other"
  };

  // An unknown value is echoed back rather than blanked: showing the stored
  // word is more honest than showing nothing.
  function statusLabel(v, en) {
    if (v === null || v === undefined || v === "") { return ""; }
    if (!en) { return String(v); }
    return STATUS_EN[v] || String(v);
  }

  // ── Estimates & invoices build: fixed document vocabulary ─────────────
  //
  // Stored as language-neutral KEYS (gm_doc_settings.payment_methods_json
  // keys, gm_pricing.kind, cost_breakdown[].type) and labelled here. The
  // customer-facing documents are English only, so the EN label is also
  // what prints; the PT label is for the portal UI.
  var DOC_PAYMENT_METHODS = [
    { key: "zelle",         pt: "Zelle",                    en: "Zelle",               hintPt: "Chave ou telefone do Zelle",     hintEn: "Zelle handle or phone" },
    { key: "check",         pt: "Cheque",                   en: "Check",               hintPt: "Nominal a",                      hintEn: "Payable to" },
    { key: "cash",          pt: "Dinheiro",                 en: "Cash",                hintPt: "",                               hintEn: "" },
    { key: "money_order",   pt: "Money order",              en: "Money order",         hintPt: "Nominal a",                      hintEn: "Payable to" },
    { key: "bank_transfer", pt: "Transferência / ACH",      en: "Bank transfer / ACH", hintPt: "Instruções",                     hintEn: "Instructions" },
    { key: "card_link",     pt: "Cartão / Stripe",          en: "Card / Stripe",       hintPt: "Cole o seu próprio link de pagamento. A Apex não processa pagamentos.", hintEn: "Paste your own payment link. Apex does not process payments." },
    { key: "other",         pt: "Outro",                    en: "Other",               hintPt: "Texto livre",                    hintEn: "Free text" }
  ];
  var DOC_PAYMENT_METHOD_BY_KEY = {};
  DOC_PAYMENT_METHODS.forEach(function (m) { DOC_PAYMENT_METHOD_BY_KEY[m.key] = m; });
  function paymentMethodLabel(key, en) {
    var m = DOC_PAYMENT_METHOD_BY_KEY[key];
    if (!m) { return key === null || key === undefined ? "" : String(key); }
    return en ? m.en : m.pt;
  }

  // gm_pricing.kind
  var PRICING_KINDS = [
    { key: "product", pt: "Produto", en: "Product" },
    { key: "addon",   pt: "Adicional", en: "Add-on" }
  ];
  function pricingKindLabel(key, en) {
    for (var i = 0; i < PRICING_KINDS.length; i++) {
      if (PRICING_KINDS[i].key === key) { return en ? PRICING_KINDS[i].en : PRICING_KINDS[i].pt; }
    }
    return en ? "Product" : "Produto";
  }

  // cost_breakdown[].type — absent reads as material.
  var COST_LINE_TYPES = [
    { key: "material", pt: "Material",    en: "Material" },
    { key: "labor",    pt: "Mão de obra", en: "Labor" },
    { key: "other",    pt: "Outro",       en: "Other" }
  ];
  function costLineTypeLabel(key, en) {
    for (var i = 0; i < COST_LINE_TYPES.length; i++) {
      if (COST_LINE_TYPES[i].key === key) { return en ? COST_LINE_TYPES[i].en : COST_LINE_TYPES[i].pt; }
    }
    return en ? "Material" : "Material";
  }

  // Payment terms: stored as a number of days (0 = due on receipt).
  var DOC_TERMS_PRESETS = [
    { days: 0,  pt: "Na entrega (due on receipt)", en: "Due on receipt" },
    { days: 7,  pt: "Net 7",  en: "Net 7" },
    { days: 15, pt: "Net 15", en: "Net 15" },
    { days: 30, pt: "Net 30", en: "Net 30" }
  ];
  function termsLabel(days, en) {
    var d = Number(days) || 0;
    for (var i = 0; i < DOC_TERMS_PRESETS.length; i++) {
      if (DOC_TERMS_PRESETS[i].days === d) { return en ? DOC_TERMS_PRESETS[i].en : DOC_TERMS_PRESETS[i].pt; }
    }
    return "Net " + d;
  }

  // gm_estimates.status (stored) plus the derived "expired".
  var ESTIMATE_STATUSES = [
    { key: "draft",             pt: "Rascunho",           en: "Draft" },
    { key: "sent",              pt: "Enviado",            en: "Sent" },
    { key: "viewed",            pt: "Aberto",             en: "Viewed" },
    { key: "changes_requested", pt: "Mudanças pedidas",   en: "Changes requested" },
    { key: "accepted",          pt: "Aceito",             en: "Accepted" },
    { key: "declined",          pt: "Recusado",           en: "Declined" },
    { key: "expired",           pt: "Expirado",           en: "Expired" },
    { key: "superseded",        pt: "Substituído",        en: "Superseded" },
    { key: "void",              pt: "Anulado",            en: "Void" }
  ];
  function estimateStatusLabel(key, en) {
    for (var i = 0; i < ESTIMATE_STATUSES.length; i++) {
      if (ESTIMATE_STATUSES[i].key === key) { return en ? ESTIMATE_STATUSES[i].en : ESTIMATE_STATUSES[i].pt; }
    }
    return key === null || key === undefined ? "" : String(key);
  }
  var ESTIMATE_LINE_TYPES = [
    { key: "standard",  pt: "Normal",    en: "Standard" },
    { key: "included",  pt: "Incluído",  en: "Included" },
    { key: "allowance", pt: "Allowance", en: "Allowance" }
  ];
  function estimateLineTypeLabel(key, en) {
    for (var i = 0; i < ESTIMATE_LINE_TYPES.length; i++) {
      if (ESTIMATE_LINE_TYPES[i].key === key) { return en ? ESTIMATE_LINE_TYPES[i].en : ESTIMATE_LINE_TYPES[i].pt; }
    }
    return en ? "Standard" : "Normal";
  }

  // Invoice status is DERIVED by the Worker (never stored except draft /
  // sent / void); these are the labels for what it reports.
  var INVOICE_STATUSES = [
    { key: "draft",          pt: "Rascunho",         en: "Draft" },
    { key: "unpaid",         pt: "Em aberto",        en: "Unpaid" },
    { key: "partially_paid", pt: "Parcialmente paga", en: "Partially paid" },
    { key: "paid",           pt: "Paga",             en: "Paid" },
    { key: "overdue",        pt: "Vencida",          en: "Overdue" },
    { key: "void",           pt: "Anulada",          en: "Void" }
  ];
  function invoiceStatusLabel(key, en) {
    for (var i = 0; i < INVOICE_STATUSES.length; i++) {
      if (INVOICE_STATUSES[i].key === key) { return en ? INVOICE_STATUSES[i].en : INVOICE_STATUSES[i].pt; }
    }
    return key === null || key === undefined ? "" : String(key);
  }
  // gm_invoice_payments.method
  var INVOICE_PAYMENT_METHODS = [
    { key: "zelle", pt: "Zelle", en: "Zelle" }, { key: "check", pt: "Cheque", en: "Check" }, { key: "cash", pt: "Dinheiro", en: "Cash" },
    { key: "money_order", pt: "Money order", en: "Money order" }, { key: "bank_transfer", pt: "Transferência / ACH", en: "Bank transfer / ACH" },
    { key: "card", pt: "Cartão", en: "Card" }, { key: "other", pt: "Outro", en: "Other" }
  ];
  function invoicePaymentMethodLabel(key, en) {
    for (var i = 0; i < INVOICE_PAYMENT_METHODS.length; i++) {
      if (INVOICE_PAYMENT_METHODS[i].key === key) { return en ? INVOICE_PAYMENT_METHODS[i].en : INVOICE_PAYMENT_METHODS[i].pt; }
    }
    return key === null || key === undefined ? "" : String(key);
  }

  global.GmLabels = {
    INVOICE_STATUSES: INVOICE_STATUSES,
    invoiceStatusLabel: invoiceStatusLabel,
    INVOICE_PAYMENT_METHODS: INVOICE_PAYMENT_METHODS,
    invoicePaymentMethodLabel: invoicePaymentMethodLabel,
    ESTIMATE_STATUSES: ESTIMATE_STATUSES,
    estimateStatusLabel: estimateStatusLabel,
    ESTIMATE_LINE_TYPES: ESTIMATE_LINE_TYPES,
    estimateLineTypeLabel: estimateLineTypeLabel,
    DOC_PAYMENT_METHODS: DOC_PAYMENT_METHODS,
    paymentMethodLabel: paymentMethodLabel,
    PRICING_KINDS: PRICING_KINDS,
    pricingKindLabel: pricingKindLabel,
    COST_LINE_TYPES: COST_LINE_TYPES,
    costLineTypeLabel: costLineTypeLabel,
    DOC_TERMS_PRESETS: DOC_TERMS_PRESETS,
    termsLabel: termsLabel,
    STATUS_EN: STATUS_EN,
    statusLabel: statusLabel,
    STAGES: STAGES,
    STAGE_KEYS: STAGE_KEYS,
    STAGE_BY_KEY: STAGE_BY_KEY,
    ACTIVE_PIPELINE_STAGE_KEYS: ACTIVE_PIPELINE_STAGE_KEYS,
    LIVE_STAGE_KEYS: LIVE_STAGE_KEYS,
    stageKey: stageKey,
    stageLabel: stageLabel,
    EVENT_TYPE_EN: EVENT_TYPE_EN,
    EVENT_TYPE_KEY: EVENT_TYPE_KEY,
    OUTRO_KEY: OUTRO_KEY,
    customEventTypeKey: customEventTypeKey,
    normalizeEventType: normalizeEventType,
    normalizeEventTypes: normalizeEventTypes,
    eventTypeLabel: eventTypeLabel
  };
})(typeof window !== "undefined" ? window : globalThis);
