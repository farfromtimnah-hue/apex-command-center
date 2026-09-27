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
    { key: "estimate_enviado", pt: "Orçamento Enviado", en: "Estimate Sent" },
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
  // The Portuguese label was "Estimate Enviado" until the docs PDF build (N3);
  // rows or requests carrying the old label still read as the same stage.
  STAGE_KEY_BY_LABEL["Estimate Enviado"] = "estimate_enviado";

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
    "Outro": "Other",
    // Cycle months (gm_config.cycle_months, stored in Portuguese): lead
    // "Mês" and project "Mês entrega" show English month names on an
    // English screen (N4).
    "Janeiro": "January", "Fevereiro": "February", "Março": "March", "Abril": "April",
    "Maio": "May", "Junho": "June", "Julho": "July", "Agosto": "August",
    "Setembro": "September", "Outubro": "October", "Novembro": "November", "Dezembro": "December"
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

  // Document hero gallery industries (hero build, 2026-09-27). Keys match
  // data/hero-gallery-v1.json categories, in Nicole's order.
  var HERO_CATEGORIES = [
    { key: "pools",          pt: "Piscinas",               en: "Pools" },
    { key: "pavers",         pt: "Pavers",                 en: "Pavers" },
    { key: "outdoor_living", pt: "Área externa",           en: "Outdoor living" },
    { key: "tile",           pt: "Porcelanato e cerâmica", en: "Tile" },
    { key: "flooring",       pt: "Pisos de madeira",       en: "Wood flooring" },
    { key: "home_exterior",  pt: "Fachadas",               en: "Home exteriors" },
    { key: "interiors",      pt: "Drywall e interiores",   en: "Drywall and interiors" },
    { key: "stone",          pt: "Pedras e mármore",       en: "Stone and marble" },
    { key: "construction",   pt: "Construção geral",       en: "General construction" },
    { key: "cakes",          pt: "Bolos e confeitaria",    en: "Cakes and bakery" },
    { key: "boutique",       pt: "Moda e tecidos",         en: "Boutique and fashion" },
    { key: "water",          pt: "Filtros de água",        en: "Water filters" }
  ];
  function heroCategoryLabel(key, en) {
    for (var i = 0; i < HERO_CATEGORIES.length; i++) {
      if (HERO_CATEGORIES[i].key === key) { return en ? HERO_CATEGORIES[i].en : HERO_CATEGORIES[i].pt; }
    }
    return key === null || key === undefined ? "" : String(key);
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

  // ── Contract placeholders (F15) ────────────────────────────────────────
  // The clause library's placeholder KEYS (contract_placeholders.field) with a
  // Portuguese and an English label for the builder screens. type drives the
  // editor: date = a date picker that stores the MM/DD/YYYY text the clauses
  // print; number = a numeric keypad; textarea = several lines.
  var CONTRACT_FIELDS = {
    access_instructions: { pt: "Chaves, portão ou código da garagem", en: "Keys, gate or garage codes" , type: "textarea" },
    access_route: { pt: "Caminho do equipamento até a obra", en: "Equipment path to the work area" },
    access_width: { pt: "Largura mínima do acesso do equipamento", en: "Minimum equipment access width" },
    allowance_basis: { pt: "O que cada allowance cobre", en: "What each allowance covers" },
    allowance_list: { pt: "Itens de allowance e valores", en: "Allowance items and amounts", type: "textarea" },
    allowance_markup_clause: { pt: "Acréscimo sobre excesso de allowance", en: "Markup on allowance overages" },
    arbitration_fee_allocation: { pt: "Divisão das custas de arbitragem", en: "Arbitration fee split" },
    arbitration_rules: { pt: "Regras de arbitragem", en: "Arbitration rules" },
    attachments_list: { pt: "Documentos anexos", en: "Attached documents" },
    attic_stock_quantity: { pt: "Sobra de material deixada com o cliente", en: "Spare material left with the owner" },
    backorder_days: { pt: "Dias de backorder antes de substituir", en: "Backorder days before a substitute", type: "number" },
    balance_amount: { pt: "Saldo na conclusão", en: "Balance at completion" },
    business_address: { pt: "Endereço da empresa", en: "Business address" },
    business_dba_clause: { pt: "Nome fantasia (DBA)", en: "Doing-business-as name" },
    business_email: { pt: "E-mail da empresa", en: "Business email" },
    business_entity_type: { pt: "Tipo de empresa", en: "Entity type" },
    business_legal_name: { pt: "Nome legal da empresa", en: "Business legal name" },
    business_phone: { pt: "Telefone da empresa", en: "Business phone" },
    cancellation_deadline_date: { pt: "Prazo de cancelamento", en: "Cancellation deadline" },
    cancellation_period_clause: { pt: "Frase do prazo de cancelamento", en: "Cancellation period wording" },
    ch515_doc_version: { pt: "Versão do documento do Capítulo 515", en: "Chapter 515 document version" },
    co_owner_clause: { pt: "Segundo proprietário", en: "Second owner" },
    co_response_days: { pt: "Dias úteis para enviar o aditivo", en: "Business days to send a change order", type: "number" },
    company_signed_at: { pt: "Data da assinatura da empresa", en: "Company signing date" },
    concealed_notice_days: { pt: "Dias úteis para avisar condição oculta", en: "Business days to notify a concealed condition", type: "number" },
    contract_date: { pt: "Data do contrato", en: "Contract date", type: "date" },
    contract_price: { pt: "Preço do contrato", en: "Contract price" },
    contractor_initials_arbitration: { pt: "Rubrica da empresa (arbitragem)", en: "Contractor initials (arbitration)" },
    contractor_initials_jury: { pt: "Rubrica da empresa (renúncia a júri)", en: "Contractor initials (jury waiver)" },
    contractor_termination_days: { pt: "Dias de suspensão antes de rescindir", en: "Days of suspension before termination", type: "number" },
    convenience_fee_description: { pt: "Valor de rescisão por conveniência", en: "Termination-for-convenience amount" },
    convenience_fee_percent: { pt: "Percentual de rescisão por conveniência", en: "Termination-for-convenience percent", type: "number" },
    days_out_of_use: { pt: "Dias em que os cômodos ficam sem uso", en: "Days rooms are out of use", type: "number" },
    debris_frequency: { pt: "Frequência de retirada de entulho", en: "Debris removal frequency" },
    debris_staging_area: { pt: "Onde o entulho fica durante a obra", en: "Where debris is kept during the job" },
    delay_notice_days: { pt: "Dias úteis para avisar atraso", en: "Business days to notify a delay", type: "number" },
    deposit_amount: { pt: "Sinal (primeiro pagamento)", en: "Deposit (initial payment)" },
    drowning_pub_version: { pt: "Versão da publicação sobre afogamento", en: "Drowning-prevention publication version" },
    dumpster_location: { pt: "Local da caçamba ou trailer", en: "Dumpster or trailer location" },
    estimate_accepted_date: { pt: "Data em que o orçamento foi aceito", en: "Estimate accepted date" },
    estimate_date: { pt: "Data do orçamento", en: "Estimate date" },
    estimate_number: { pt: "Número do orçamento", en: "Estimate number" },
    estimate_valid_until: { pt: "Validade do orçamento", en: "Estimate valid until" },
    estimate_version: { pt: "Versão do orçamento", en: "Estimate version" },
    estimated_duration_working_days: { pt: "Duração estimada (dias úteis)", en: "Estimated duration (working days)", type: "number" },
    estimated_start_date: { pt: "Data estimada de início", en: "Estimated start date", type: "date" },
    exclusions_list: { pt: "Itens excluídos marcados", en: "Ticked exclusion items", type: "textarea" },
    extended_permit_days: { pt: "Prazo maior para a licença (dias)", en: "Agreed longer permit period (days)", type: "number" },
    extended_start_days: { pt: "Prazo maior para o início (dias)", en: "Agreed longer start period (days)", type: "number" },
    extension_sentence: { pt: "Frase de prorrogação por escrito", en: "Written extension sentence" },
    fence_sections: { pt: "Trechos de cerca que podem ser retirados", en: "Fence sections that may be removed" },
    final_inspection_clause: { pt: "Frase da inspeção final", en: "Final inspection wording" },
    final_payment_days: { pt: "Dias para o pagamento final", en: "Days for the final payment", type: "number" },
    grace_period_days: { pt: "Dias de tolerância antes do atraso", en: "Grace days before a payment is late", type: "number" },
    grout_color: { pt: "Cor do rejunte aprovada", en: "Approved grout color" },
    insurance_carrier: { pt: "Seguradora", en: "Insurance carrier" },
    insurance_expiry_date: { pt: "Vencimento do seguro", en: "Insurance expiry date", type: "date" },
    insurance_policy_number: { pt: "Número da apólice", en: "Policy number" },
    insurance_policy_types: { pt: "Tipos de apólice", en: "Policy types" },
    insurance_statement: { pt: "Frase do seguro", en: "Insurance sentence" },
    late_interest_rate: { pt: "Juros anuais por atraso (%)", en: "Annual late interest rate (%)", type: "number" },
    late_payment_sentence: { pt: "Frase de pagamento em atraso", en: "Late payment sentence" },
    lead_paint_clause: { pt: "Texto de tinta com chumbo", en: "Lead paint wording" },
    lead_testing_sentence: { pt: "Frase do teste de chumbo", en: "Lead testing sentence" },
    leveling_included: { pt: "Nivelamento incluído no preço", en: "Leveling included in the price" },
    license_number: { pt: "Número da licença", en: "License number" },
    license_type: { pt: "Tipo de licença", en: "License type" },
    mediation_days: { pt: "Dias para a mediação", en: "Days for mediation", type: "number" },
    mutual_cure_days: { pt: "Dias para corrigir (C13-C)", en: "Cure period (C13-C)", type: "number" },
    mutual_execution_deadline: { pt: "Prazo de 72 horas para o cliente assinar", en: "72-hour signing deadline" },
    negotiation_days: { pt: "Dias para a negociação", en: "Days for negotiation", type: "number" },
    noc_first_inspection_sentence: { pt: "Frase da primeira inspeção (NOC)", en: "First inspection sentence (NOC)" },
    noc_sentence: { pt: "Frase do Notice of Commencement", en: "Notice of Commencement sentence" },
    offer_expiry_date: { pt: "Proposta válida até", en: "Offer valid until", type: "date" },
    overage_percent: { pt: "Percentual de material extra", en: "Extra material percentage", type: "number" },
    owner_agent_name: { pt: "Representante do cliente", en: "Owner's named agent" },
    owner_cure_days: { pt: "Dias úteis para começar a corrigir", en: "Business days to begin a cure", type: "number" },
    owner_email: { pt: "E-mail do cliente", en: "Owner email" },
    owner_entity_name: { pt: "Empresa proprietária", en: "Owner entity name" },
    owner_full_name: { pt: "Nome completo do cliente", en: "Owner full name" },
    owner_initials_arbitration: { pt: "Rubrica do cliente (arbitragem)", en: "Owner initials (arbitration)" },
    owner_initials_jury: { pt: "Rubrica do cliente (renúncia a júri)", en: "Owner initials (jury waiver)" },
    owner_mailing_address: { pt: "Endereço de correspondência do cliente", en: "Owner mailing address" },
    owner_marketing_consent_checkbox: { pt: "Autorização de fotos do cliente", en: "Owner photo consent" },
    owner_materials_due_date: { pt: "Quando o material do cliente deve chegar", en: "Owner-supplied materials due", type: "date" },
    owner_phone: { pt: "Telefone do cliente", en: "Owner phone" },
    owner_response_days: { pt: "Dias úteis para o cliente responder", en: "Business days for the owner to answer", type: "number" },
    owner_signer_name: { pt: "Quem assina pela empresa proprietária", en: "Owner entity signer" },
    owner_signer_title: { pt: "Cargo de quem assina pela empresa proprietária", en: "Owner entity signer title" },
    owner_signature_lien_notice: { pt: "Assinatura do cliente no aviso de lien", en: "Owner signature on the lien notice" },
    owner_signature_lien_notice_date: { pt: "Data da assinatura no aviso de lien", en: "Lien notice signature date" },
    owner_signature_pool_ack: { pt: "Assinatura do cliente (documentos de piscina)", en: "Owner signature (pool documents)" },
    owner_signature_pool_ack_date: { pt: "Data (documentos de piscina)", en: "Date (pool documents)" },
    owner_supplied_items: { pt: "Itens fornecidos pelo cliente", en: "Owner-supplied items", type: "textarea" },
    owner_title_note: { pt: "Observação sobre a propriedade", en: "Note on title" },
    payment_account_hint: { pt: "Dado da conta para pagamento", en: "Payment account hint" },
    payment_methods_list: { pt: "Formas de pagamento aceitas", en: "Accepted payment methods" },
    payment_schedule_note: { pt: "Observação do cronograma de pagamento", en: "Payment schedule note" },
    payment_schedule_table: { pt: "Cronograma de pagamento", en: "Payment schedule" },
    permit_fee_estimate: { pt: "Estimativa da taxa de licença", en: "Permit fee estimate" },
    permit_fee_treatment: { pt: "Como a taxa de licença é tratada", en: "Permit fee handling" },
    permit_jurisdiction: { pt: "Cidade ou condado da licença", en: "Permit jurisdiction" },
    plan_documents_list: { pt: "Plantas e documentos anexos", en: "Plans and documents attached", type: "textarea" },
    pool_docs_delivered_at: { pt: "Entrega dos documentos de piscina", en: "Pool documents delivered" },
    pool_docs_delivery_method: { pt: "Como os documentos de piscina foram entregues", en: "Pool documents delivery method" },
    pool_safety_feature: { pt: "Recurso de segurança da piscina", en: "Pool safety feature" },
    portable_toilet_location: { pt: "Local do banheiro químico", en: "Portable toilet location" },
    project_name: { pt: "Nome da obra", en: "Job name" },
    project_summary: { pt: "Resumo da obra", en: "Job summary" },
    property_address: { pt: "Endereço do imóvel", en: "Property address" },
    property_county: { pt: "Condado do imóvel", en: "Property county" },
    punch_completion_days: { pt: "Dias úteis para terminar pendências", en: "Business days to finish the punch list", type: "number" },
    punch_holdback_amount: { pt: "Valor retido até as pendências", en: "Punch list holdback amount" },
    punchlist_submit_days: { pt: "Dias para o cliente entregar a lista de pendências", en: "Days for the owner to give the punch list", type: "number" },
    qualifier_name: { pt: "Qualificador (qualifying agent)", en: "Qualifying agent" },
    recording_fee_treatment: { pt: "Quem paga o registro do NOC", en: "Who pays the NOC recording fee" },
    recovery_fund_contact_block: { pt: "Contato do Recovery Fund", en: "Recovery Fund contact block" },
    retainage_percent: { pt: "Retenção (%)", en: "Retainage (%)", type: "number" },
    rooms_out_of_use: { pt: "Cômodos sem uso durante a obra", en: "Rooms out of use" },
    selection_deadlines_table: { pt: "Escolhas e prazos", en: "Selections and due dates", type: "textarea" },
    site_contact_name: { pt: "Contato na obra", en: "On-site contact" },
    site_contact_phone: { pt: "Telefone do contato na obra", en: "On-site contact phone" },
    spoil_disposition: { pt: "Destino da terra escavada", en: "Excavated soil disposition" },
    start_hold_until_date: { pt: "Data reservada para o início até", en: "Start date held until", type: "date" },
    suspension_notice_days: { pt: "Dias úteis de aviso de suspensão", en: "Business days' notice before suspension", type: "number" },
    suspension_trigger_days: { pt: "Dias de atraso que permitem suspender", en: "Days late before suspension", type: "number" },
    co_number: { pt: "Número do aditivo", en: "Change order number" },
    co_date: { pt: "Data do aditivo", en: "Change order date" },
    co_description: { pt: "Descrição do aditivo", en: "Change order description" },
    co_price_before: { pt: "Preço antes do aditivo", en: "Price before the change order" },
    co_amount: { pt: "Valor do aditivo", en: "Change order amount" },
    co_price_after: { pt: "Preço depois do aditivo", en: "Price after the change order" },
    co_schedule_days: { pt: "Impacto no prazo (dias)", en: "Schedule impact (days)" },
    co_payment_change: { pt: "Mudança nas parcelas", en: "Payment schedule change" },
    surface_prep_included: { pt: "Preparação de superfície incluída", en: "Surface preparation included" },
    target_completion_date: { pt: "Data prevista de conclusão", en: "Target completion date", type: "date" },
    tax_statement: { pt: "Frase de impostos", en: "Sales tax sentence" },
    transaction_date: { pt: "Data em que o cliente assina", en: "Date the owner signs" },
    unit_price_list: { pt: "Itens com preço por unidade", en: "Unit-priced items", type: "textarea" },
    urgent_cap_amount: { pt: "Teto do serviço urgente", en: "Urgent work cap" },
    walkthrough_days: { pt: "Dias úteis para a vistoria final", en: "Business days for the walkthrough", type: "number" },
    warranty_component_table: { pt: "Componentes e meses de garantia", en: "Components and warranty months", type: "textarea" },
    warranty_contact: { pt: "Para onde enviar pedidos de garantia", en: "Where warranty claims go" },
    warranty_inspect_days: { pt: "Dias úteis para inspecionar garantia", en: "Business days to inspect a warranty claim", type: "number" },
    warranty_months_workmanship: { pt: "Meses de garantia de mão de obra", en: "Workmanship warranty months", type: "number" },
    warranty_notice_days: { pt: "Dias para o cliente avisar garantia", en: "Days for the owner to report a warranty issue", type: "number" },
    work_days: { pt: "Dias de trabalho", en: "Work days" },
    work_hours_end: { pt: "Fim do expediente", en: "Work hours end" },
    work_hours_start: { pt: "Início do expediente", en: "Work hours start" },
    year_built: { pt: "Ano de construção da casa", en: "Year the home was built", type: "number" },
    property_type: { pt: "Tipo do imóvel", en: "Property type" }
  };
  function contractFieldLabel(key, en) {
    var f = CONTRACT_FIELDS[key];
    if (f) { return en ? f.en : f.pt; }
    return key === null || key === undefined ? "" : String(key).replace(/_/g, " ");
  }
  function contractFieldType(key) { var f = CONTRACT_FIELDS[key]; return (f && f.type) || "text"; }


  // ── Contract builder, owner-facing Portuguese (docs PDF build, N2) ──────
  // Clause-area and option TITLES as the owner sees them on Portuguese
  // screens. The clause text that PRINTS in the contract stays English and is
  // never translated; these are screen labels only. A business's own custom
  // clause has no entry and shows as typed.
  var CONTRACT_AREA_PT = {
    C01: "Partes, imóvel e descrição da obra", C02: "Escopo do serviço e exclusões", C03: "Preço do contrato",
    C04: "Parcelas, formas de pagamento e atraso", C05: "Aditivos", C06: "Prazo, condições de início, atrasos e clima",
    C07: "Acesso à obra e responsabilidades do cliente", C08: "Condições ocultas e imprevistas", C09: "Licenças, Notice of Commencement e vistorias",
    C10: "Materiais, escolhas e substituições", C11: "Garantia de mão de obra e garantias dos fabricantes",
    C12: "Conclusão, pendências, pagamento final, liberação de gravames e declaração de pagamento final",
    C13: "Suspensão e rescisão", C14: "Solução de conflitos (pacotes definidos pelo advogado)", C15: "Limite de responsabilidade e seguro",
    C16: "Validade da proposta e aceite", C17: "Limpeza, entulho e proteção da obra", C18: "Fotos e uso em marketing (com aceite)",
    C19: "Acordo integral, avisos, assinatura eletrônica, independência das cláusulas e lei aplicável"
  };
  var CONTRACT_OPTION_PT = {
    "C01-A": "Partes e imóvel: dono ou donos assinam em nome próprio", "C01-B": "Partes e imóvel: dono assina por empresa, trust ou representante", "C01-C": "Partes e imóvel: imóvel alugado ou sem morador",
    "C02-A": "Escopo: orçamento aceito incorporado, contrato prevalece em conflito", "C02-B": "Escopo: orçamento mais plantas, projetos ou renderizações",
    "C03-A": "Preço total fechado", "C03-B": "Preço total fechado com verbas (allowances)", "C03-C": "Preço total fechado com preço por unidade para quantidades incertas",
    "C04-A": "Parcelas por etapa, recibos, sem multa por atraso", "C04-B": "Parcelas por etapa com carência e juros simples", "C04-C": "Sinal para comprar material, saldo na conclusão (obras curtas)",
    "C05-A": "Aditivo assinado antes de começar o trabalho alterado", "C05-B": "Aditivo assinado; a parte afetada para até a assinatura", "C05-C": "Aditivo assinado, com autorização para condição urgente",
    "C06-A": "Datas estimadas, sem garantia", "C06-B": "Data alvo de conclusão com prorrogações", "C06-C": "Obra externa: clima, dias de chuva e tempo de cura",
    "C07-A": "Acesso e responsabilidades gerais do cliente", "C07-B": "Casa ocupada (reforma e obra interna)", "C07-C": "Obra externa com acesso de máquinas",
    "C08-A": "Condições ocultas gerais", "C08-B": "Subsolo: piscinas e hardscape", "C08-C": "Contrapiso: cerâmica e piso", "C08-D": "Dentro das paredes e casas antigas: reforma e serviços gerais",
    "C09-A": "A empresa tira as licenças; o cliente registra a Notice of Commencement", "C09-B": "A empresa tira as licenças e registra a Notice of Commencement como representante do cliente", "C09-C": "Sem licença necessária",
    "C10-A": "Escolhas e substituições gerais", "C10-B": "Cerâmica e pedra natural: lotes, variação, rejunte e sobra de estoque", "C10-C": "Piscinas e hardscape: acabamentos, pavers e produtos naturais", "C10-D": "Material fornecido pelo cliente",
    "C11-A": "Garantia de mão de obra de um ano", "C11-B": "Garantia de mão de obra de dois anos", "C11-C": "Tabela de garantia por componente",
    "C12-A": "Pagamento final na conclusão substancial, pequena retenção para pendências", "C12-B": "Pagamento final na conclusão total", "C12-C": "Retenção em cada parcela",
    "C13-A": "Assimétrica: a empresa pode suspender ou rescindir por falta de pagamento ou acesso; o cliente, por justa causa", "C13-B": "Assimétrica, e o cliente pode rescindir sem motivo pagando uma taxa", "C13-C": "Rescisão só por justa causa, igual para os dois",
    "C14-A": "Pacote A: negociação, mediação e depois a justiça no condado do imóvel", "C14-B": "Pacote B: negociação, mediação e depois arbitragem obrigatória", "C14-C": "Pacote C: negociação, mediação, justiça, honorários para quem ganhar e renúncia ao júri",
    "C15-A": "Responsabilidade limitada ao preço do contrato; sem danos indiretos", "C15-B": "Sem limite de responsabilidade; só a declaração do seguro", "C15-C": "Responsabilidade limitada ao valor pago pela parte afetada da obra",
    "C16-A": "Validade ligada à do orçamento", "C16-B": "Execução mútua em 72 horas do Pr. Rafael", "C16-C": "Validade com data de início reservada",
    "C17-A": "Arrumação diária e limpeza final, retirada de entulho incluída", "C17-B": "Só limpeza final", "C17-C": "O cliente fornece a caçamba",
    "C18-A": "Sem uso em marketing", "C18-B": "Uso em marketing sem dados que identifiquem", "C18-C": "Uso em marketing com primeiro nome e cidade, e pedido de avaliação",
    "C19-A": "Termos gerais padrão", "C19-B": "Termos padrão mais tradução de cortesia em português"
  };
  var CONTRACT_TRADE_PT = {
    pools: "Piscinas e spas", tile: "Cerâmica e pisos", remodeling: "Reforma",
    hardscape: "Hardscape e área externa", general: "Serviços gerais"
  };
  // Why each Florida notice (L1-L7) is on or off, as the server sends it.
  var CONTRACT_NOTICE_WHY_PT = {
    "every contract": "todo contrato",
    "sold during a visit to the customer's home": "vendido durante uma visita à casa do cliente",
    "not sold at the home": "não vendido na casa do cliente",
    "pool contract": "contrato de piscina",
    "pool box unchecked": "caixa de piscina desmarcada",
    "business does not build pools": "a empresa não constrói piscinas",
    "over $2,500, residential 1-4 family": "acima de $2,500, residencial de 1 a 4 famílias",
    "over $2,500, residential": "acima de $2,500, residencial",
    "not a 1-4 family residence": "não é residência de 1 a 4 famílias",
    "not residential": "não residencial",
    "property type not answered": "tipo do imóvel não respondido",
    "contract $2,500 or less": "contrato de $2,500 ou menos",
    "first payment over 10%": "primeira parcela acima de 10%",
    "first payment 10% or less": "primeira parcela de 10% ou menos"
  };
  var CONTRACT_DISCLAIMER_PT = {
    "This contract template has not been reviewed by an attorney. Have your attorney review it.": "Este modelo de contrato não foi revisado por um advogado. Peça ao seu advogado para revisar."
  };
  function contractAreaTitle(id, title, en) { return (!en && CONTRACT_AREA_PT[id]) ? CONTRACT_AREA_PT[id] : (title || id || ""); }
  function contractOptionTitle(id, title, en) { return (!en && CONTRACT_OPTION_PT[id]) ? CONTRACT_OPTION_PT[id] : (title || id || ""); }
  function contractTradeLabel(key, label, en) { return (!en && CONTRACT_TRADE_PT[key]) ? CONTRACT_TRADE_PT[key] : (label || key || ""); }
  function contractNoticeWhy(why, en) { return (!en && CONTRACT_NOTICE_WHY_PT[why]) ? CONTRACT_NOTICE_WHY_PT[why] : (why || ""); }
  function contractDisclaimer(text, en) { return (!en && CONTRACT_DISCLAIMER_PT[text]) ? CONTRACT_DISCLAIMER_PT[text] : (text || ""); }

  // ── Invoice / payment step names (N6) ───────────────────────────────────
  // The stored step names stay English (they print on the English customer
  // invoice); a Portuguese screen shows these. A name the owner typed shows
  // as typed.
  var PAY_STEP_PT = { "Deposit": "Sinal", "Mid-project": "Meio da obra", "Completion": "Conclusão", "Final payment": "Pagamento final", "Balance": "Saldo" };
  function payStepLabel(name, en) {
    var s = name === null || name === undefined ? "" : String(name);
    if (en) { return s; }
    if (PAY_STEP_PT[s]) { return PAY_STEP_PT[s]; }
    var m = /^Change order (CO-\d+)$/.exec(s);
    if (m) { return "Aditivo " + m[1]; }
    return s;
  }

  global.GmLabels = {
    CONTRACT_FIELDS: CONTRACT_FIELDS,
    contractAreaTitle: contractAreaTitle,
    contractOptionTitle: contractOptionTitle,
    contractTradeLabel: contractTradeLabel,
    contractNoticeWhy: contractNoticeWhy,
    contractDisclaimer: contractDisclaimer,
    payStepLabel: payStepLabel,
    contractFieldLabel: contractFieldLabel,
    contractFieldType: contractFieldType,
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
    HERO_CATEGORIES: HERO_CATEGORIES,
    heroCategoryLabel: heroCategoryLabel,
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
