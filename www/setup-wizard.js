// Setup wizard: a guided, section by section setup for a new owner.
// Loaded by portal.html after gm.js. It uses the app's own pieces: gmApi, the
// real estimate preview (gmHeroPreviewHtml), the cover picker (gmHeroPickerHtml),
// the People and access card (peopleCardHtml), the Stripe routes and the
// Thumbtack connect. The Worker keeps every rule and every piece of license
// data; this file only draws what the Worker answers.
// Every answer saves to the server as it is given (taps at once, typing after a
// short pause). The stage is saved too, so closing the app or switching phones
// resumes on the same stage. Only the Start button completes setup.

var SW_STAGES = [
  { key: "brand", pt: "Sua marca", en: "Your brand" },
  { key: "business", pt: "Seu negócio", en: "Your business" },
  { key: "work", pt: "O que você faz", en: "What you do" },
  { key: "license", pt: "Sua licença", en: "Your license" },
  { key: "hours", pt: "Seus horários", en: "Your hours" },
  { key: "payments", pt: "Como você recebe", en: "How you get paid" },
  { key: "how", pt: "Como você trabalha", en: "How you work" },
  { key: "connections", pt: "Conexões", en: "Connections" },
  { key: "team", pt: "Sua equipe", en: "Your team" },
  { key: "bio", pt: "Seu link na bio", en: "Your link in bio" },
  { key: "review", pt: "Revisão", en: "Review" }
];
var SW_REQUIRED = ["brand", "business", "work", "license", "hours", "payments", "how"];
var SW_PAY = [["zelle", "Zelle", "Zelle"], ["check", "Cheque", "Check"], ["cash", "Dinheiro", "Cash"], ["money_order", "Money order", "Money order"],
  ["bank_transfer", "Transferência bancária", "Bank transfer"], ["card_link", "Cartão pelo Stripe", "Card through Stripe"], ["other", "Outro", "Other"]];
var SW_TERMS = [["0", "Pagamento na hora", "Due on receipt"], ["7", "7 dias", "Net 7"], ["15", "15 dias", "Net 15"], ["30", "30 dias", "Net 30"]];
var SW_DAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
var SW_DAYS_PT = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
var SW_DAY_LETTER_PT = ["D", "S", "T", "Q", "Q", "S", "S"];
var SW_DAY_LETTER_EN = ["S", "M", "T", "W", "T", "F", "S"];

var SW = { queue: Promise.resolve(), open: false, stage: 1, ready: false, loadErr: "", d: null, doc: null, cs: null, bk: null, lic: null, licKey: "", licBusy: false, stripe: null,
  pending: 0, saveErr: "", saveRetry: null, savedAt: 0, timers: {}, web: { url: "", st: "idle", res: null, use: {}, err: "" },
  swatches: [], logoTs: 0, upErr: "", people: false, tt: null, ttBusy: false, confirmSave: false, finishing: false, finishErr: "", copied: false, ownBusy: false };

function swEl(id) { return document.getElementById(id); }
function swT(pt, en) { return isEn() ? en : pt; }
function swH(stage, n) { return ' data-help="setup-wizard#' + stage + '#' + n + '"'; }
function swCap(s) { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); }
function swEsc(s) { return escHtml(String(s === null || s === undefined ? "" : s)); }
function swFmtHour(h) { if (!isEn()) { return (h < 10 ? "0" : "") + h + ":00"; } var n = h % 12 === 0 ? 12 : h % 12; return n + ":00 " + (h < 12 ? "AM" : "PM"); }
function swFmtHHMM(t) { var h = parseInt(String(t).slice(0, 2), 10); return swFmtHour(h); }
function swHour(t) { return parseInt(String(t || "09:00").slice(0, 2), 10); }
function swHHMM(h) { return (h < 10 ? "0" : "") + h + ":00"; }

var SW_INFO = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#c9a43a" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/></svg>';
var SW_CHECK = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#1a1405" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>';
function swCallout(title, body, stage, n, err) {
  return '<div class="sw-callout' + (err ? " err" : "") + '"' + swH(stage, n) + '>' + SW_INFO + '<div><b>' + swEsc(title) + '</b><span>' + swEsc(body) + '</span></div></div>';
}

// ── Saving as you go ───────────────────────────────────────────────────────
function swStatusRender() {
  var el = swEl("swStatus");
  if (!el) { return; }
  if (SW.saveErr) {
    el.className = "sw-status err";
    el.innerHTML = swEsc(SW.saveErr) + ' <button type="button" data-act="retry-save"' + swH("brand", 1) + '>' + swT("Tentar de novo", "Try again") + '</button>';
  } else if (SW.pending > 0) {
    el.className = "sw-status"; el.textContent = swT("Salvando…", "Saving…");
  } else if (SW.savedAt) {
    el.className = "sw-status"; el.textContent = swT("Salvo", "Saved");
  } else { el.className = "sw-status"; el.textContent = ""; }
}

// Runs a save. On failure the screen says so in words and keeps the value.
function swSave(label, fn) {
  SW.pending++; SW.saveErr = ""; swStatusRender();
  // One save at a time, in order. A blank business has no settings row yet, and two saves
  // racing to make it fail with a database error (found on the first brand new owner test).
  var run = function() { try { return fn(); } catch (e) { return Promise.reject(e); } };
  var p = SW.queue.then(run, run);
  SW.queue = p.then(function() {}, function() {});
  return Promise.resolve(p).then(function(r) {
    SW.pending--; SW.savedAt = Date.now(); SW.saveRetry = null; swStatusRender(); return r;
  }).catch(function(e) {
    SW.pending--;
    SW.saveErr = swT("Não foi possível salvar. ", "Could not save. ") + (e && e.message ? e.message + " " : "") + swT("O que você escreveu continua na tela.", "What you entered is still on the screen.");
    SW.saveRetry = fn; swStatusRender();
    console.error("wizard save " + label + ": " + (e && e.message));
    throw e;
  });
}
function swSaveQuiet(label, fn) { return swSave(label, fn).catch(function() { return null; }); }
function swDebounce(key, ms, fn) {
  if (SW.timers[key]) { clearTimeout(SW.timers[key]); }
  SW.timers[key] = setTimeout(function() { SW.timers[key] = null; fn(); }, ms);
}
// Runs every waiting typed save now (before leaving a stage, before Stripe).
function swFlush() {
  var keys = Object.keys(SW.timers).filter(function(k) { return SW.timers[k]; });
  keys.forEach(function(k) { clearTimeout(SW.timers[k]); SW.timers[k] = null; if (SW.flushFns && SW.flushFns[k]) { SW.flushFns[k](); } });
  SW.flushFns = {};
}
function swTyped(key, fn) { SW.flushFns = SW.flushFns || {}; SW.flushFns[key] = fn; swDebounce(key, 700, function() { delete SW.flushFns[key]; fn(); }); }

function swDocPut(body) {
  body.wizard_draft = true;
  return gmApi("doc-settings", { method: "PUT", body: body }).then(function(r) {
    if (r && r.field_errors && Object.keys(r.field_errors).length) {
      var k = Object.keys(r.field_errors)[0], fe = r.field_errors[k];
      throw new Error(isEn() ? (fe.en || fe.pt) : (fe.pt || fe.en));
    }
    if (r && r.settings) { var keep = SW.doc || {}; SW.doc = Object.assign({}, keep, r.settings, { prefill: keep.prefill, has_logo: keep.has_logo, has_hero: keep.has_hero, link_slug: keep.link_slug }); gmDocSettings = SW.doc; }
    return r;
  });
}
function swStageSave(n) { return gmApi("wizard", { method: "PUT", body: { stage: n } }); }
function swAnswer(patch) {
  Object.keys(patch).forEach(function(k) { SW.d.answers[k] = patch[k]; });
  return swSave("answers", function() { return gmApi("wizard", { method: "PUT", body: { answers: patch } }); });
}
function swCs() { return (SW.cs && SW.cs.settings) || { values: {}, defaults: {}, trades: [], signers: [] }; }

// ── Loading ────────────────────────────────────────────────────────────────
function swLoad() {
  SW.ready = false; SW.loadErr = "";
  return Promise.all([gmApi("wizard"), gmApi("doc-settings"), gmApi("contract-settings"), gmApi("booking-settings")]).then(function(r) {
    SW.d = r[0]; SW.doc = r[1].settings; SW.cs = r[2]; SW.bk = r[3].settings || r[3];
    gmDocSettings = SW.doc;
    SW.ready = true; SW.contractFresh = true; swNoneFlag(SW.d.contract);
    if (!SW.d.ready) { throw new Error(swT("O assistente ainda não está pronto.", "The setup wizard is not ready yet.")); }
    SW.web.url = (SW.d.answers && SW.d.answers.website_url) || SW.web.url;
  }).catch(function(e) {
    SW.ready = false; SW.loadErr = e.message || String(e); console.error("wizard load: " + SW.loadErr);
  });
}
// Review shows the lawyer links only when Apex has a contract for the owner's kind of work.
// The answer comes from the server, fresh each time Review opens (the kind of work may have just changed).
function swContractRefresh() {
  SW.contractFresh = false;
  function done() { SW.contractFresh = true; if (SW.open && (SW.stage === 7 || SW.stage === 9 || SW.stage === 11)) { swRender(); } }
  // After every save in line, so a kind of work just tapped is already stored when this asks.
  return SW.queue.then(function() { return gmApi("wizard"); }).then(function(d) { SW.d.contract = d.contract; swNoneFlag(d.contract); if (d.answers) { SW.d.answers.contract_requested = d.answers.contract_requested; } done(); }).catch(done);
}
// Kinds of work with no Apex contract (cakes, boutique, water, Something else): "none". "own": the owner chose their own contract.
function swNoneFlag(c) { if (typeof gmContractNoneSet === "function") { gmContractNoneSet(!!(c && c.none)); } }
function swCMode() { var c = SW.d && SW.d.contract; return c && c.mode ? c.mode : ""; }
// The honest line and the two small actions. Used on How you work, Team and Review.
function swContractActions() {
  var sent = !!((SW.d.answers && SW.d.answers.contract_requested) || SW.reqDone);
  var h = '<div class="sw-row" id="swContractActions"><p class="sw-lead" id="swNoContract" style="margin:0 0 6px">' +
    swT("Um contrato para este tipo de trabalho ainda não está disponível na Apex. Orçamentos, faturas e pagamentos funcionam do mesmo jeito. Você pode começar agora.", "A contract for this kind of work is not available in Apex yet. Estimates, invoices and payments work the same for you. You can start now.") + '</p>';
  h += '<div class="sw-chips"><button type="button" class="sw-btn" data-act="cn-ask"' + swH("nocontract", 1) + (sent ? " disabled" : "") + '>' + swT("Pedir à Apex um contrato para o meu negócio", "Ask Apex for a contract for my business") + '</button></div>';
  if (sent) { h += '<p class="sw-fine" id="swReqSent">' + swT("Pedido enviado. A Apex vai ver o seu pedido.", "Request sent. Apex will see your request.") + '</p>'; }
  else if (SW.reqOpen) {
    h += '<label class="sw-l" for="swReqNote" style="margin-top:10px">' + swT("Uma linha sobre o contrato que você quer", "One line about the contract you want") + '</label>' +
      '<input id="swReqNote" type="text" maxlength="200" data-bind="reqnote" value="' + swEsc(SW.reqNote || "") + '"' + swH("nocontract", 2) + '>' +
      '<button type="button" class="sw-btn solid" style="margin-top:8px" data-act="cn-send"' + swH("nocontract", 2) + (SW.reqBusy ? " disabled" : "") + '>' + (SW.reqBusy ? swT("Enviando…", "Sending…") : swT("Enviar o pedido", "Send the request")) + '</button>';
    if (SW.reqErr) { h += '<p class="sw-fine" style="color:var(--sw-err)">' + swEsc(SW.reqErr) + '</p>'; }
  }
  return h + '</div>';
}
function swRefreshStatus() {
  return gmApi("wizard").then(function(d) { SW.d.done = d.done; SW.d.missing = d.missing; SW.d.setup_completed_at = d.setup_completed_at; });
}

// ── Open and close ─────────────────────────────────────────────────────────
function swRoot() {
  var r = swEl("swRoot");
  if (!r) { r = document.createElement("div"); r.id = "swRoot"; r.hidden = true; r.setAttribute("role", "dialog"); r.setAttribute("aria-modal", "true"); r.setAttribute("aria-label", "Setup"); document.body.appendChild(r); swBind(r); }
  return r;
}
function swOpen(stage) {
  var root = swRoot();
  SW.open = true; root.hidden = false; document.body.style.overflow = "hidden";
  root.innerHTML = '<div class="sw-shell"><p class="sw-load">' + swT("Carregando…", "Loading…") + '</p></div>';
  swPatchHeroRepaint();
  swLoad().then(function() {
    if (!SW.ready) { swRenderError(); return; }
    var st = stage || SW.d.stage || 1;
    swGo(st, true);
  });
}
function swClose() {
  swFlush();
  var root = swEl("swRoot"); if (root) { root.hidden = true; root.innerHTML = ""; }
  document.body.style.overflow = ""; SW.open = false;
  // Hand the estimate screens back clean: they load their own settings and draft when opened.
  gmDocSettings = null; gmDocDraft = null; if (typeof gmHeroUi !== "undefined") { gmHeroUi = null; }
  swRestorePeopleWrap();
  swFinishCardRender();
}
function swRenderError() {
  var root = swRoot();
  root.innerHTML = '<div class="sw-shell"><div class="sw-top"><div class="sw-stagename">' + swT("Configuração", "Setup") + '</div><button type="button" class="sw-close" data-act="close"' + swH("brand", 1) + '>' + swT("Fechar", "Close") + '</button></div>' +
    swCallout(swT("Não foi possível abrir a configuração", "Could not open the setup"), SW.loadErr || "", "brand", 1, true) +
    '<button type="button" class="sw-btn" data-act="reload"' + swH("brand", 1) + '>' + swT("Tentar de novo", "Try again") + '</button></div>';
}
function swGo(n, noSave) {
  swFlush();
  SW.stage = Math.max(1, Math.min(11, n));
  if (SW.stage === 7 || SW.stage === 9 || SW.stage === 11) { swContractRefresh(); }
  if (!noSave) { swSaveQuiet("stage", function() { return swStageSave(SW.stage); }); }
  swRender();
  var root = swEl("swRoot"); if (root) { root.scrollTop = 0; }
}

// ── Rendering ──────────────────────────────────────────────────────────────
function swTop() {
  var h = '<div class="sw-seg" aria-hidden="true">';
  for (var i = 0; i < 11; i++) { h += '<i class="' + (i === SW.stage - 1 ? "on" : i < SW.stage - 1 ? "done" : "") + '"></i>'; }
  h += '</div>';
  var s = SW_STAGES[SW.stage - 1];
  return '<div class="sw-top">' + h + '</div><div class="sw-top" style="margin-top:-6px"><div class="sw-stagename" style="flex:1">' + SW.stage + '/11 · ' + swT(s.pt, s.en) + '</div><button type="button" class="sw-close" data-act="close"' + swH("brand", 1) + '>' + swT("Fechar", "Close") + '</button></div>';
}
function swStageHtml() {
  var fns = [swBrand, swBusiness, swWork, swLicense, swHours, swPayments, swHow, swConnections, swTeam, swBio, swReviewStage];
  return fns[SW.stage - 1]();
}
function swRender() {
  var root = swRoot();
  var y = root.scrollTop;
  var st = swStageHtml();
  var wide = SW.stage === 1;
  var body = wide
    ? '<div class="sw-layout"><div class="sw-herocol">' + swHeroHtml() + '</div><div class="sw-q">' + st.html + '</div></div>'
    : '<div class="sw-q sw-enter">' + st.html + '</div>';
  var go = SW.stage === 11 ? swT("Começar", "Start") : (SW.stage === 7 ? swT("Isto parece o meu negócio", "This sounds like my business") : swT("Continuar", "Continue"));
  var why = st.ok ? "" : swT("Falta: ", "Still needed: ") + st.need.join(", ") + ".";
  root.innerHTML = '<div class="sw-shell' + (wide ? " wide" : "") + '">' + swTop() + body + '</div>' +
    '<div class="sw-bar"><div class="in"><div class="sw-status" id="swStatus" role="status" aria-live="polite"></div>' +
    '<div class="sw-why sw-fine" id="swWhy" style="text-align:center;margin:0 0 8px">' + swEsc(why) + '</div>' +
    '<div class="sw-btns">' + (SW.stage > 1 ? '<button type="button" class="sw-back" data-act="back"' + swH("brand", 1) + '>' + swT("Voltar", "Back") + '</button>' : '') +
    '<button type="button" class="sw-go" id="swGo" data-act="next"' + swH(SW_STAGES[SW.stage - 1].key, 1) + (st.ok && !SW.finishing ? "" : " disabled") + '>' + swEsc(go) + '</button></div></div></div>';
  swStatusRender();
  if (st.after) { st.after(); }
  root.scrollTop = y;
}
// After typing: only the Continue button and the "still needed" words change.
function swGate() {
  var st = swStageHtml();   // cheap: strings only
  var go = swEl("swGo"), why = swEl("swWhy");
  if (go) { go.disabled = !(st.ok && !SW.finishing); }
  if (why) { why.textContent = st.ok ? "" : swT("Falta: ", "Still needed: ") + st.need.join(", ") + "."; }
}

// The estimate preview is the app's real one. Nothing here redraws it.
function swHeroHtml() {
  var s = SW.doc || {}, url = "", hero = null;
  var keepDraft = gmDocDraft;   // the real estimate settings form keeps its own draft; only borrow it for the preview
  gmDocDraft = { brand_primary: s.brand_primary, brand_accent: s.brand_accent, legal_name: s.legal_name };
  gmDocSettings = s;
  if (s.hero_gallery_key && gmHeroGallery) {
    var im = (gmHeroGallery.images || []).filter(function(x) { return x.key === s.hero_gallery_key; })[0];
    if (im) { url = im.url; hero = im; }
  } else if (s.has_hero && !s.hero_gallery_key) {
    url = WORKER_URL + "/api/clients/" + clientId + "/doc-hero-image?ts=" + (SW.logoTs || 1);
    hero = { focus_x: s.hero_focus_x === null || s.hero_focus_x === undefined ? 50 : s.hero_focus_x, focus_y: s.hero_focus_y === null || s.hero_focus_y === undefined ? 50 : s.hero_focus_y,
      zoom: s.hero_zoom || 100, slide: 0, fill: null, tone: s.hero_tone || "dark", flip: !!s.hero_flip };
  }
  var html = '<div class="sw-hero" id="swHero">' + gmHeroPreviewHtml(url, hero || {}) + '</div>';
  gmDocDraft = keepDraft;
  return html;
}
function swRefreshHero() { var h = swEl("swHero"); if (h) { h.outerHTML = swHeroHtml(); } }
var swHeroRepaintPatched = false;
function swPatchHeroRepaint() {
  if (swHeroRepaintPatched || typeof gmHeroRepaint !== "function") { return; }
  swHeroRepaintPatched = true;
  var orig = gmHeroRepaint;
  gmHeroRepaint = function() { orig(); if (SW.open && SW.stage === 1) { swRefreshHero(); swGate(); } };
}

// ── Stage 1: your brand ────────────────────────────────────────────────────
function swCatLabel(c) { return isEn() ? c.label_en : c.label_pt; }
function swCat(key) { return (SW.d.catalog || []).filter(function(c) { return c.key === key; })[0]; }
function swBrand() {
  var s = SW.doc, a = SW.d.answers, cat = a.cat || "";
  var coverOk = !!(s.hero_gallery_key || s.has_hero);
  var done = { industry: !!cat, name: !!(s.legal_name && s.legal_name.trim()), logo: !!s.has_logo, colors: !!s.brand_primary, cover: coverOk };
  var names = { industry: swT("o seu ramo", "your kind of work"), name: swT("o nome do negócio", "your business name"), logo: swT("o logo", "your logo"), colors: swT("a cor principal", "a main color"), cover: swT("a foto de capa", "a cover photo") };
  var need = Object.keys(names).filter(function(k) { return !done[k]; }).map(function(k) { return names[k]; });
  function sec(id, h, body) { return '<section class="sw-sec" id="sw-' + id + '"><h2 class="sw-h' + (done[id] ? " ok" : "") + '">' + h + '</h2>' + body + '</section>'; }
  var html = '<h1>' + swT("Sua marca", "Your brand") + '</h1><p class="sw-lead">' + swT("Tudo aqui aparece no topo dos seus orçamentos, contratos e faturas. O orçamento ao lado muda enquanto você escolhe.", "Everything here appears at the top of your estimates, contracts and invoices. The estimate changes as you go.") + '</p>';
  html += '<section class="sw-sec" id="sw-website" style="border-top:0;margin-top:0;padding-top:0">' + swWebsiteHtml() + '</section>';
  // industry tiles
  var tiles = '<p class="sw-lead">' + swT("Escolha o mais próximo. A foto de capa e as perguntas seguem daí.", "Pick the closest one. Your cover photo and questions follow from it.") + '</p><div class="sw-tiles">';
  SW.d.catalog.forEach(function(c) {
    tiles += '<button type="button" class="sw-tile" data-act="cat" data-v="' + swEsc(c.key) + '" aria-pressed="' + (cat === c.key) + '"' + swH("brand", 5) +
      ' style="background-image:url(' + swEsc(WORKER_URL + "/api/hero-gallery/" + c.photo_key + ".jpg") + ')"><i>' + SW_CHECK + '</i><span>' + swEsc(swCatLabel(c)) + '</span></button>';
  });
  tiles += '<button type="button" class="sw-tile other" data-act="cat" data-v="other" aria-pressed="' + (cat === "other") + '"' + swH("brand", 5) + '><i>' + SW_CHECK + '</i><span>' + swT("Outro", "Something else") + '</span></button></div>';
  html += sec("industry", swT("Que tipo de trabalho você faz?", "What kind of work do you do?"), tiles);
  html += sec("name", swT("Qual é o nome do seu negócio?", "What is your business called?"),
    '<p class="sw-lead">' + swT("Os clientes veem isso no topo de cada orçamento, contrato e fatura.", "Customers see this at the top of every estimate, contract and invoice.") + '</p><label class="sw-l" for="swName">' + swT("Nome do negócio", "Business name") + '</label><input id="swName" type="text" maxlength="60" autocomplete="organization" data-bind="name"' + swH("brand", 6) + ' value="' + swEsc(s.legal_name) + '" placeholder="' + swT("Por exemplo, Silva Pools LLC", "For example, Silva Pools LLC") + '">');
  var ph = s.has_logo ? '<div class="sw-ph"><img alt="' + swT("Seu logo", "Your logo") + '" src="' + swEsc(WORKER_URL + "/api/clients/" + clientId + "/logo-image?ts=" + SW.logoTs) + '"></div>' : '<div class="sw-ph empty"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#a8a298" stroke-width="1.6" stroke-linecap="round"><path d="M12 16V5M7 9l5-5 5 5M5 20h14"/></svg></div>';
  html += sec("logo", swT("Adicione o seu logo", "Add your logo"),
    '<p class="sw-lead">' + swT("Uma foto ou arquivo do seu celular. Escolhemos as cores a partir dele.", "A photo or file from your phone. We pick your colors from it next.") + '</p>' +
    (SW.upErr ? swCallout(swT("Esse arquivo não funcionou", "That file did not work"), SW.upErr, "brand", 4, true) : '') +
    '<div class="sw-drop">' + ph + '<div><b>' + (s.has_logo ? swT("Seu logo foi adicionado", "Your logo is added") : swT("Nenhum logo ainda", "No logo added yet")) + '</b><p class="sw-fine" style="margin:2px 0 0">PNG, JPG ' + swT("ou", "or") + ' WebP</p>' +
    '<label class="sw-file" for="swLogoFile"' + swH("brand", 7) + '>' + (s.has_logo ? swT("Escolher outro arquivo", "Choose a different file") : swT("Escolher um arquivo", "Choose a file")) + '</label></div></div>' +
    '<input id="swLogoFile" type="file" accept="image/png,image/jpeg,image/webp" hidden data-bind="logofile"' + swH("brand", 7) + '>');
  html += sec("colors", swT("Escolha as suas cores", "Pick your colors"),
    '<p class="sw-lead">' + (SW.swatches.length ? swT("Escolhidas a partir do seu logo. O orçamento muda quando você toca.", "Picked from your logo. The estimate changes as you tap.") : swT("Adicione o logo acima e escolhemos as cores, ou escolha as suas.", "Add your logo above and we pick colors from it, or choose your own.")) + '</p>' +
    '<div class="sw-row"><label class="sw-l">' + swT("Cor principal", "Main color") + '</label>' + swSwRow("brand_primary", false) + '</div>' +
    '<div class="sw-row"><label class="sw-l">' + swT("Cor de destaque", "Accent color") + '</label>' + swSwRow("brand_accent", true) + '</div>');
  html += sec("cover", swT("Escolha a foto de capa", "Choose your cover photo"),
    '<p class="sw-lead">' + swT("A foto no topo de todo documento que o seu cliente abre.", "The photo across the top of every document your customer opens.") + '</p><div class="sw-pick" data-help-default="setup-wizard#brand">' + gmHeroPickerHtml() + '</div>');
  html += sec("review", swT("Seu link de avaliação do Google", "Your Google review link"),
    '<p class="sw-lead">' + swT("Opcional. Os clientes tocam nele para deixar uma avaliação.", "Optional. Customers tap it to leave you a review.") + '</p><label class="sw-l" for="swReview">' + swT("Link de avaliação", "Review link") + '</label><input id="swReview" type="text" inputmode="url" autocomplete="off" data-bind="review"' + swH("brand", 9) + ' value="' + swEsc(s.google_review_link || "") + '" placeholder="' + swT("Cole o seu link de avaliação do Google", "Paste your Google review link") + '">' +
    swCallout(swT("Você pode mudar tudo depois", "You can change all of this later"), swT("Tudo desta etapa fica em Configurações, a qualquer hora.", "Everything in this stage is in Settings, any time."), "brand", 5));
  return { html: html, need: need, ok: need.length === 0 };
}
function swSwRow(key, withNone) {
  var h = '<div class="sw-sws">', cur = SW.doc[key] || null;
  SW.swatches.forEach(function(c) { h += '<button type="button" class="sw-sw" data-act="sw" data-k="' + key + '" data-c="' + c + '" style="background:' + c + '" aria-label="' + swT("Cor ", "Color ") + c + '" aria-pressed="' + (cur === c) + '"' + swH("brand", 8) + '></button>'; });
  if (withNone) { h += '<button type="button" class="sw-sw" data-act="sw" data-k="' + key + '" data-c="" style="background:#2b2f36" aria-label="' + swT("Cinza neutro", "Neutral gray") + '" aria-pressed="' + (!cur) + '"' + swH("brand", 8) + '></button>'; }
  h += '<label class="sw-own"' + swH("brand", 8) + '><input type="color" data-bind="color" data-k="' + key + '"' + swH("brand", 8) + ' value="' + (cur || "#2b2f36") + '" aria-label="' + swT("Escolha a sua própria cor", "Choose your own color") + '">' + swT("Outra", "Your own") + '</label></div>';
  return h;
}
var SW_WEBLAB = { name: ["Nome do negócio", "Business name"], logo: ["Logo", "Logo"], phone: ["Telefone", "Phone"], addr: ["Endereço", "Address"], cat: ["Tipo de trabalho", "Kind of work"], review: ["Link de avaliação do Google", "Google review link"] };
function swWebsiteHtml() {
  var w = SW.web, a = SW.d.answers;
  var h = '<h2 class="sw-h">' + swT("Comece pelo seu site", "Start from your website") + '</h2><p class="sw-lead">' + swT("Opcional. A Apex lê o seu site, mostra o que achou e você escolhe o que usar. O que não achar fica em branco para você.", "Optional. Apex reads your site, shows what it found, and you choose what to use. Anything it cannot find stays blank for you.") + '</p>';
  h += '<label class="sw-l" for="swWebUrl">' + swT("Seu site", "Your website") + '</label><div class="sw-linkrow"><input id="swWebUrl" type="text" inputmode="url" autocomplete="url" data-bind="weburl"' + swH("brand", 2) + ' value="' + swEsc(w.url) + '" placeholder="' + swT("Por exemplo, suaempresa.com", "For example, yourcompany.com") + '">' +
    '<button type="button" class="sw-btn solid" data-act="web-read"' + swH("brand", 3) + (w.st === "reading" ? " disabled" : "") + '>' + (w.st === "reading" ? swT("Lendo o seu site", "Reading your site") : swT("Preencher o que der", "Fill in what you can")) + '</button></div>';
  if (w.st === "error") { h += swCallout(swT("A Apex não conseguiu ler esse site", "Apex could not read that site"), w.err || swT("Confira o endereço ou preencha o resto você mesmo.", "Check the address, or fill in the rest yourself."), "brand", 6, true); }
  if (w.st === "found" || w.st === "applied") {
    var f = w.res.found, keys = ["name", "logo", "phone", "addr", "cat", "review"].filter(function(k) { return f[k]; });
    var miss = ["name", "logo", "phone", "addr", "review"].filter(function(k) { return !f[k]; }).map(function(k) { return SW_WEBLAB[k][isEn() ? 1 : 0].toLowerCase(); });
    h += '<div class="sw-web"><b>' + (w.st === "applied" ? swT("Preenchido. Você ainda pode mudar tudo abaixo.", "Filled in. You can still change anything below.") : (keys.length ? swT("Isto é o que a Apex achou. Desmarque o que não quiser.", "Here is what Apex found. Untick anything you do not want.") : swT("A Apex leu o site mas não achou nada que possa usar.", "Apex read your site but found nothing it could use."))) + '</b>';
    keys.forEach(function(k) {
      var v;
      if (k === "logo") { v = '<img class="sw-wlogo" alt="' + swT("Logo encontrado no seu site", "Logo found on your site") + '" src="' + swEsc(w.logoBlob || "") + '">'; }
      else if (k === "cat") { v = swEsc(f.cat.map(function(c) { var cc = swCat(c); return cc ? swCatLabel(cc) : c; }).join(", ")); }
      else { v = swEsc(f[k]); }
      h += '<label class="sw-wrow"><input type="checkbox" data-bind="webuse" data-k="' + k + '"' + (w.use[k] !== 0 ? " checked" : "") + (w.st === "applied" ? " disabled" : "") + swH("brand", 4) + '><span><i>' + SW_WEBLAB[k][isEn() ? 1 : 0] + '</i>' + v + '</span></label>';
    });
    if (f.cat && f.cat.length > 1 && w.st === "found") {
      h += '<div class="sw-row" style="margin-top:12px"><label class="sw-l">' + swT("Qual é o seu trabalho principal?", "Which one is your main work?") + '</label><div class="sw-chips">';
      f.cat.forEach(function(c) { var cc = swCat(c); h += '<button type="button" class="sw-chip" data-act="web-main" data-v="' + swEsc(c) + '" aria-pressed="' + ((w.main || f.cat[0]) === c) + '"' + swH("brand", 4) + '>' + swEsc(cc ? swCatLabel(cc) : c) + '</button>'; });
      h += '</div></div>';
    }
    h += '<p class="sw-fine">' + swT("Não achamos, então você preenche abaixo: ", "Not found, so you fill them in below: ") + (miss.length ? miss.join(", ") : swT("nada", "nothing")) + '. ' + swT("Número da licença e horários nunca estão em um site.", "License number and hours are never on a website.") + '</p>';
    if (w.st === "found" && keys.length) { h += '<button type="button" class="sw-btn solid" style="margin-top:12px" data-act="web-apply"' + swH("brand", 4) + '>' + swT("Usar os itens marcados", "Use the ticked items") + '</button>'; }
    h += '</div>';
  }
  return h;
}

// Colors from the logo: bucket the pixels, drop near white, near black and grey, keep the most common.
function swColorsFrom(src, cb) {
  var im = new Image(); im.crossOrigin = "anonymous";
  im.onload = function() {
    var out = [];
    try {
      var c = document.createElement("canvas"), w = 48, hh = 48; c.width = w; c.height = hh;
      var x = c.getContext("2d"); x.drawImage(im, 0, 0, w, hh);
      var d = x.getImageData(0, 0, w, hh).data, m = {};
      for (var i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 128) { continue; }
        var r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if ((mx > 235 && mn > 225) || mx < 30 || mx - mn < 28) { continue; }
        var k = [r >> 5, g >> 5, b >> 5].join(","); m[k] = m[k] || { n: 0, r: 0, g: 0, b: 0 }; m[k].n++; m[k].r += r; m[k].g += g; m[k].b += b;
      }
      var arr = Object.keys(m).map(function(k) { var o = m[k]; return { n: o.n, r: o.r / o.n, g: o.g / o.n, b: o.b / o.n }; }).sort(function(p, q) { return q.n - p.n; });
      arr.forEach(function(o) {
        var hex = "#" + [o.r, o.g, o.b].map(function(v) { return ("0" + Math.round(v).toString(16)).slice(-2); }).join("");
        var far = out.every(function(p) { var a1 = parseInt(p.slice(1, 3), 16) - o.r, b1 = parseInt(p.slice(3, 5), 16) - o.g, c1 = parseInt(p.slice(5, 7), 16) - o.b; return Math.sqrt(a1 * a1 + b1 * b1 + c1 * c1) > 70; });
        if (far && out.length < 4) { out.push(hex); }
      });
    } catch (e) { out = []; }
    if (!out.length) { out = ["#2b2f36", "#1f3a5f", "#3d4a3a", "#5a4636"]; }   // a black, white or grey logo: quiet neutrals
    cb(out);
  };
  im.onerror = function() { cb(["#2b2f36", "#1f3a5f", "#3d4a3a", "#5a4636"]); };
  im.src = src;
}
function swUploadLogo(file) {
  SW.upErr = "";
  if (["image/png", "image/jpeg", "image/webp"].indexOf(file.type) < 0) { SW.upErr = swT("Use um arquivo PNG, JPG ou WebP.", "Use a PNG, JPG or WebP file."); swRender(); return Promise.resolve(); }
  if (file.size > 5 * 1024 * 1024) { SW.upErr = swT("Esse arquivo passa de 5 MB. Escolha um menor.", "That file is over 5 MB. Choose a smaller one."); swRender(); return Promise.resolve(); }
  var fd = new FormData(); fd.append("logo", file);
  return swSave("logo", function() {
    return apiFetch("/api/clients/" + clientId + "/logo", { method: "POST", formData: fd }).then(function(res) {
      return res.json().then(function(dd) { if (!res.ok) { throw new Error(dd.error || ("HTTP " + res.status)); } return dd; });
    });
  }).then(function() {
    SW.doc.has_logo = true; SW.logoTs = Date.now(); gmDocLogoTs = SW.logoTs;
    if (typeof loadPortalLogo === "function") { loadPortalLogo(); }
    var url = URL.createObjectURL(file);
    swColorsFrom(url, function(c) {
      SW.swatches = c;
      var p = SW.doc.brand_primary ? Promise.resolve() : swSaveQuiet("colors", function() { return swDocPut({ brand_primary: c[0], brand_accent: c[0] }); }).then(function() { SW.doc.brand_primary = c[0]; SW.doc.brand_accent = c[0]; });
      Promise.resolve(p).catch(function() {}).then(function() { SW.doc.brand_primary = SW.doc.brand_primary || c[0]; SW.doc.brand_accent = SW.doc.brand_accent || c[0]; swRender(); });
    });
  }).catch(function(e) { SW.upErr = e.message; swRender(); });
}
function swWebApply() {
  var w = SW.web, f = w.res.found, u = w.use;
  function on(k) { return f[k] && u[k] !== 0; }
  var jobs = [];
  if (on("name")) { SW.doc.legal_name = f.name; jobs.push(swSaveQuiet("name", function() { return swDocPut({ legal_name: f.name }); })); }
  if (on("review")) { SW.doc.google_review_link = f.review; jobs.push(swSaveQuiet("review", function() { return swDocPut({ google_review_link: f.review }); })); }
  if (on("phone") || on("addr")) {
    var body = {}; if (on("phone")) { body.phone = f.phone; SW.doc.phone = f.phone; } if (on("addr")) { body.address = f.addr; SW.doc.address = f.addr; }
    jobs.push(swSaveQuiet("business", function() { return gmApi("wizard/business", { method: "PUT", body: body }); }));
  }
  if (on("cat")) { jobs.push(swPickCat((w.main && f.cat.indexOf(w.main) !== -1) ? w.main : f.cat[0], true)); }
  if (on("logo") && w.logoBlobObj) { jobs.push(swUploadLogo(new File([w.logoBlobObj], "logo." + (w.logoBlobObj.type === "image/png" ? "png" : "jpg"), { type: w.logoBlobObj.type }))); }
  w.st = "applied";
  Promise.all(jobs).then(function() { swRender(); });
  swRender();
}
function swWebRead() {
  var w = SW.web, u = (w.url || "").trim();
  if (!u) { w.st = "error"; w.err = swT("Digite o endereço do seu site primeiro.", "Type your website address first."); swRender(); return; }
  w.st = "reading"; w.use = {}; w.logoBlob = null; w.logoBlobObj = null; swRender();
  gmApi("wizard/website", { method: "POST", body: { url: u } }).then(function(r) {
    w.res = r; w.st = "found"; swAnswer({ website_url: u }).catch(function() {});
    if (r.found.logo) {
      return apiFetch("/api/clients/" + clientId + "/gm/wizard/logo-proxy?u=" + encodeURIComponent(r.found.logo)).then(function(res) { return res.ok ? res.blob() : null; }).then(function(bl) {
        if (bl) { w.logoBlobObj = bl; w.logoBlob = URL.createObjectURL(bl); } else { delete r.found.logo; }
      });
    }
  }).catch(function(e) { w.st = "error"; w.err = e.message; }).then(function() { swRender(); });
}
function swPickCat(key, keepCover) {
  var a = SW.d.answers, changed = a.cat !== key;
  a.cat = key; if (changed) { a.subs = []; }
  var jobs = [swSaveQuiet("work", function() { return gmApi("wizard/work", { method: "PUT", body: { cat: key, subs: changed ? [] : (a.subs || []), other_text: key === "other" ? (a.other_text || "") : "" } }); })];
  var c = swCat(key);
  // The cover is pre selected from the industry unless the owner already chose their own photo.
  if (c && c.photo_key && (!SW.doc.hero_gallery_key && !SW.doc.has_hero || (changed && !keepCover && SW.doc.hero_gallery_key))) {
    jobs.push(swSaveQuiet("cover", function() { return gmApi("doc-hero-choice", { method: "PUT", body: { gallery_key: c.photo_key } }).then(function(r) {
      var keep = SW.doc; SW.doc = Object.assign({}, keep, r.settings || {}, { prefill: keep.prefill, has_logo: keep.has_logo, has_hero: keep.has_hero, link_slug: keep.link_slug }); SW.doc.hero_gallery_key = c.photo_key; gmDocSettings = SW.doc;
      if (typeof gmHeroUiFromSettings === "function") { gmHeroUi = gmHeroUiFromSettings(); }
    }); }));
  }
  return Promise.all(jobs).then(function() { if (SW.open && SW.stage === 1) { swRender(); } });
}

// ── Stage 2: your business ────────────────────────────────────────────────
function swField(label, bind, type, ph, val, extra, n) {
  return '<div class="sw-row"><label class="sw-l" for="swf-' + bind + '">' + label + '</label><input id="swf-' + bind + '" type="' + type + '" data-bind="' + bind + '"' + swH(extra.stage, n) + ' value="' + swEsc(val) + '" placeholder="' + swEsc(ph) + '" ' + (extra.attr || "") + '></div>';
}
function swBusiness() {
  var cs = swCs(), v = cs.values || {}, d = SW.doc;
  var entity = /limited liability/i.test(v.business_entity_type || "") ? "llc" : (/sole/i.test(v.business_entity_type || "") ? "sole" : "");
  var h = '<h1>' + swT("Seu negócio", "Your business") + '</h1><p class="sw-lead">' + swT("Os clientes veem isso nos orçamentos e contratos. Preencha uma vez e a Apex usa em todo lugar.", "Customers see this on estimates and contracts. Fill it in once and Apex uses it everywhere.") + '</p>';
  h += '<div class="sw-row"><label class="sw-l" for="swState">' + swT("Em que estado você trabalha?", "Where do you work?") + '</label><select id="swState" data-bind="state"' + swH("business", 1) + '><option value="">' + swT("Escolha o estado", "Choose your state") + '</option>';
  ((SW.cs && SW.cs.states) || []).forEach(function(s) { h += '<option value="' + swEsc(s.code) + '"' + (s.code === v.business_state ? " selected" : "") + '>' + swEsc(s.name) + '</option>'; });
  h += '</select></div>';
  h += '<div class="sw-row"><div class="sw-l">' + swT("Como o seu negócio é registrado?", "How is your business set up?") + '</div><div class="sw-chips"><button type="button" class="sw-chip" data-act="entity" data-v="llc" aria-pressed="' + (entity === "llc") + '"' + swH("business", 2) + '>LLC</button><button type="button" class="sw-chip" data-act="entity" data-v="sole" aria-pressed="' + (entity === "sole") + '"' + swH("business", 2) + '>' + swT("Empresário(a) individual", "Sole owner") + '</button></div></div>';
  h += swField(swT("Telefone ou WhatsApp", "Phone or WhatsApp number"), "phone", "tel", swT("Por exemplo, 813 555 0123", "For example, 813 555 0123"), d.phone || "", { stage: "business", attr: 'autocomplete="tel"' }, 3);
  h += swField(swT("Endereço do negócio", "Business address"), "address", "text", swT("Rua, cidade, estado e CEP", "Street, city, state and zip"), d.address || "", { stage: "business", attr: 'autocomplete="street-address"' }, 4);
  h += swField(swT("Nome fantasia (opcional)", "Doing business as (optional)"), "dba", "text", swT("Só se os clientes conhecem você por outro nome", "Only if your customers know you by another name"), v.business_dba || "", { stage: "business", attr: "" }, 5);
  h += '<div class="sw-row"><div class="sw-l">' + swT("Idioma que você usa com a Apex", "Language you use with Apex") + '</div><div class="sw-chips"><button type="button" class="sw-chip" data-act="lang" data-v="en" aria-pressed="' + isEn() + '"' + swH("business", 6) + '>English</button><button type="button" class="sw-chip" data-act="lang" data-v="pt" aria-pressed="' + (!isEn()) + '"' + swH("business", 6) + '>Português</button></div></div>';
  var need = [];
  if (!v.business_state) { need.push(swT("estado", "state")); } if (!entity) { need.push(swT("como o negócio é registrado", "how your business is set up")); }
  if (!(d.phone || "").trim()) { need.push(swT("telefone", "phone")); } if (!(d.address || "").trim()) { need.push(swT("endereço", "address")); }
  return { html: h, need: need, ok: need.length === 0 };
}

// ── Stage 3: what you do ──────────────────────────────────────────────────
function swWork() {
  var a = SW.d.answers, cat = a.cat, c = swCat(cat);
  var h = '<h1>' + swT("O que você faz", "What you do") + '</h1><p class="sw-lead">' + swT("Toque em tudo o que você faz. A Apex só pergunta o que serve para você.", "Tap everything you do. Apex only asks about what applies to you.") + '</p>';
  if (!cat) { return { html: h + swCallout(swT("Escolha o seu ramo primeiro", "Choose your kind of work first"), swT("Volte à etapa Sua marca e toque no seu ramo.", "Go back to Your brand and tap your kind of work."), "work", 1), need: [swT("o seu ramo (etapa 1)", "your kind of work (stage 1)")], ok: false }; }
  if (cat === "other") {
    h += '<div class="sw-row"><label class="sw-l" for="swOther">' + swT("Conte o que você faz", "Tell us what you do") + '</label><input id="swOther" type="text" maxlength="200" data-bind="other"' + swH("work", 2) + ' value="' + swEsc(a.other_text || "") + '" placeholder="' + swT("Por exemplo, fazenda de árvores de Natal", "For example, Christmas tree farm") + '"></div>';
    h += swCallout(swT("Vamos configurar para você", "We will set this up for you"), swT("O seu tipo de trabalho é novo para a Apex. A nossa equipe é avisada e vai adicionar o que você precisa. Você pode continuar agora.", "Your kind of work is new to Apex. Our team is alerted and will add what you need. You can keep going now."), "work", 2);
    return { html: h, need: [swT("o que você faz", "what you do")], ok: !!(a.other_text || "").trim() };
  }
  h += '<div class="sw-row"><div class="sw-l">' + swT("Seu trabalho", "Your work") + '</div><div class="sw-chips">';
  c.subtaps.forEach(function(s) { h += '<button type="button" class="sw-chip" data-act="sub" data-v="' + swEsc(s.key) + '" aria-pressed="' + ((a.subs || []).indexOf(s.key) > -1) + '"' + swH("work", 1) + '>' + swEsc(isEn() ? s.en : s.pt) + '</button>'; });
  h += '</div></div>';
  return { html: h, need: [swT("pelo menos um tipo de trabalho", "at least one kind of work")], ok: (a.subs || []).length > 0 };
}

// ── Stage 4: your license (the Worker decides; this only draws) ───────────
// The note under a license line, in the owner's language. A note with no Portuguese yet
// shows a plain label first, so English never appears alone inside a Portuguese screen.
function swNoteHtml(x) {
  if (!x.note) { return ""; }
  if (isEn()) { return '<p>' + swEsc(x.note) + '</p>'; }
  if (x.note_pt) { return '<p>' + swEsc(x.note_pt) + '</p>'; }
  return '<p class="sw-fine">' + swT("Detalhes em inglês:", "Details in English:") + '</p><p lang="en">' + swEsc(x.note) + '</p>';
}
function swLicenseFetch() {
  var a = SW.d.answers, st = swCs().values.business_state;
  var key = [st, a.cat, (a.subs || []).join(",")].join("|");
  if (SW.licKey === key || SW.licBusy) { return; }
  SW.licKey = key; SW.licBusy = true; SW.lic = null;
  gmApi("wizard/license?state=" + encodeURIComponent(st || "") + "&cat=" + encodeURIComponent(a.cat || "") + "&subs=" + encodeURIComponent((a.subs || []).join(","))).then(function(r) { SW.lic = r; }).catch(function(e) { SW.lic = { ok: false, reason: "error", message: e.message }; })
    .then(function() { SW.licBusy = false; if (SW.open && SW.stage === 4) { swRender(); } });
}
function swLicNumbersHtml() {
  var d = SW.doc, list = (d.license_numbers && d.license_numbers.length) ? d.license_numbers : [""];
  var h = '<div class="sw-row"><div class="sw-l">' + swT("Números de licença", "License numbers") + '</div>';
  list.forEach(function(x, i) {
    h += '<div class="sw-licrow"><input type="text" data-bind="lic" data-i="' + i + '" value="' + swEsc(x) + '" placeholder="' + swT("Número da licença", "License number") + '" aria-label="' + swT("Número da licença ", "License number ") + (i + 1) + '"' + swH("license", 1) + '>' +
      (list.length > 1 ? '<button type="button" class="sw-chip" data-act="rmlic" data-i="' + i + '"' + swH("license", 2) + '>' + swT("Remover", "Remove") + '</button>' : '') + '</div>';
  });
  if (list.length < 10) { h += '<button type="button" class="sw-link" data-act="addlic"' + swH("license", 2) + '>' + swT("Adicionar outra licença", "Add another license") + '</button>'; }
  h += '</div>';
  return h;
}
function swNoLicHtml() {
  return '<label class="sw-tick"><input type="checkbox" data-bind="nolic"' + (SW.doc.license_not_required ? " checked" : "") + swH("license", 3) + '><span>' + swT("O meu trabalho não precisa de licença estadual", "My work does not need a state license") + '</span></label>';
}
function swLicense() {
  var d = SW.doc, st = swCs().values.business_state, a = SW.d.answers;
  var nums = (d.license_numbers || []).filter(function(x) { return String(x).trim(); }).length;
  var okLic = nums > 0 || d.license_not_required === true;
  var h = '<h1>' + swT("Sua licença", "Your license") + '</h1>';
  if (!st || !a.cat || (a.cat !== "other" && !(a.subs || []).length)) {
    h += swCallout(swT("Falta uma resposta antes", "An earlier answer is needed first"), swT("Informe o estado e o que você faz nas etapas anteriores. A Apex confere a regra do seu estado com isso.", "Give your state and your kind of work in the earlier stages. Apex checks your state's rule with them."), "license", 1);
    return { html: h, need: [swT("estado e tipo de trabalho", "state and kind of work")], ok: false };
  }
  swLicenseFetch();
  if (!SW.lic) { return { html: h + '<p class="sw-lead">' + swT("A Apex está conferindo a regra do seu estado…", "Apex is checking your state's rule…") + '</p>', need: [swT("a regra do estado", "the state's rule")], ok: false }; }
  var r = SW.lic;
  if (!r.ok) {
    // Safe screen: never a stale copy. The owner can still state the license or that none is needed.
    h += swCallout(swT("A Apex não conseguiu conferir a regra do seu estado", "Apex could not check your state's rule"), swT("Você pode informar o número da sua licença, ou marcar que o seu trabalho não precisa de licença estadual.", "You can give your license number, or tick that your work does not need a state license."), "license", 1, true) + swLicNumbersHtml() + swNoLicHtml();
    return { html: h, need: [swT("um número de licença, ou marcar que não precisa", "a license number, or tick that you need none")], ok: okLic };
  }
  h += '<p class="sw-lead">' + swT("A Apex conferiu o que ", "Apex checked what ") + swEsc(r.state_name) + swT(" exige para cada tipo de trabalho que você tocou.", " requires for each kind of work you tapped.") + '</p>';
  var names = r.items.filter(function(x) { return x.kind === "need"; }).map(function(x) { return isEn() ? x.name_en : x.name_pt; }).join(", ");
  var list = '<div>';
  r.items.forEach(function(x) {
    list += '<div class="sw-lt"><b>' + swEsc(swCap(isEn() ? x.name_en : x.name_pt)) + '</b><span class="sw-ls ' + (x.kind === "need" || x.kind === "threshold" ? "need" : x.kind === "unsure" ? "unsure" : "") + '">' + swEsc(isEn() ? x.label_en : x.label_pt) + '</span>' +
      swNoteHtml(x) + ((x.confidence === "LOW" || x.confidence === "MEDIUM") ? '<p>' + swT("Confiança: ", "Confidence: ") + (x.confidence === "LOW" ? swT("baixa", "low") : swT("média", "medium")) + swT(". Confirme com o conselho do seu estado.", ". Check with your state board.") + '</p>' : '') + '</div>';
  });
  list += '</div>';
  var showLic = a.lic_show || nums > 0;
  var link = showLic ? swLicNumbersHtml() : '<button type="button" class="sw-link" data-act="showlic"' + swH("license", 4) + '>' + swT("Eu tenho uma licença mesmo assim. Adicionar.", "I hold a license anyway. Add it.") + '</button>';
  var local = swT(" A sua cidade ou condado ainda pode pedir um registro comercial local.", " Your city or county may still ask for a local business tax receipt.");
  var need = [], ok = true;
  if (r.summary === "need") {
    h += swCallout(r.state_name + swT(" exige licença ou registro para: ", " requires a license or registration for: ") + names, swT("Informe o número para ele sair nos seus contratos. Você pode informar mais de um. Se você não tem nenhum, marque a caixa abaixo.", "Add the number so it prints on your contracts. You can add more than one. If you hold none, tick the box below."), "license", 1) + list + swLicNumbersHtml() + swNoLicHtml();
    ok = okLic; need = [swT("um número de licença, ou marcar que não precisa", "a license number, or tick that you need none")];
  } else if (r.summary === "threshold") {
    h += swCallout(swT("Pode ser preciso licença em trabalhos maiores", "A license may be needed on bigger jobs"), swT("Neste estado, a licença só é exigida acima de um valor do trabalho. Informe o número se você tiver.", "In this state, a license is needed only above a set job amount. Add your number if you hold one."), "license", 1) + list + link;
  } else if (r.summary === "unsure") {
    h += swCallout(swT("A Apex não conseguiu confirmar tudo", "Apex could not confirm every item"), swT("A regra não está clara. Confirme com o conselho do seu estado. Informe o número se você tiver.", "The rule is not clear. Check with your state board. Add your number if you hold one."), "license", 1) + list + swLicNumbersHtml();
  } else {
    h += swCallout(swT("Não precisa de licença estadual", "No state license needed"), swT("Para o que você tocou, este estado não tem licença estadual.", "For what you tapped, this state has no state license.") + local, "license", 1) + list + link;
    // No state license for this work: Continue is the owner's statement of it, so Start is never stopped later for a missing license answer.
    if (!okLic) { h += '<p class="sw-fine" id="swLicAuto">' + swT("Ao tocar em Continuar, você diz que o seu trabalho não precisa de licença estadual.", "By tapping Continue, you say your work does not need a state license.") + '</p>'; SW.licAutoTick = true; } else { SW.licAutoTick = false; }
  }
  if (r.unmapped && r.unmapped.length) { h += '<p class="sw-fine">' + swT("A Apex ainda não tem regra de licença para parte do que você tocou.", "Apex has no license rule yet for part of what you tapped.") + '</p>'; }
  return { html: h, need: need, ok: ok };
}

// ── Stage 5: your hours ───────────────────────────────────────────────────
var SW_PAY_STEP = { valid: 2, late: 4, grace: 4, margin: 5 };
var SW_HOURS_STEP = { start: 2, end: 2, dur: 3, notice: 4 };
function swStepper(id, label, min, max, disMinus, disPlus) {
  return '<span class="sw-ctl" data-id="' + id + '"><button type="button" data-act="step" data-id="' + id + '" data-d="-1" aria-label="' + swT("Menos", "Less") + '"' + (disMinus ? " disabled" : "") + (SW_HOURS_STEP[id] ? swH("hours", SW_HOURS_STEP[id]) : swH(SW_STAGES[SW.stage - 1].key, SW.stage === 6 ? (SW_PAY_STEP[id] || 2) : 1)) + '>&#8722;</button><span>' + label + '</span><button type="button" data-act="step" data-id="' + id + '" data-d="1" aria-label="' + swT("Mais", "More") + '"' + (disPlus ? " disabled" : "") + (SW_HOURS_STEP[id] ? swH("hours", SW_HOURS_STEP[id]) : swH(SW_STAGES[SW.stage - 1].key, SW.stage === 6 ? (SW_PAY_STEP[id] || 2) : 1)) + '>+</button></span>';
}
function swBk() { var b = SW.bk || {}; return { days: (b.work_days && b.work_days.length) ? b.work_days : SW.d.defaults.work_days, start: b.day_start || SW.d.defaults.day_start, end: b.day_end || SW.d.defaults.day_end, dur: b.duration_min || SW.d.defaults.duration_min, notice: (b.min_notice_hours === undefined || b.min_notice_hours === null) ? SW.d.defaults.min_notice_hours : b.min_notice_hours }; }
function swHours() {
  var b = swBk(), s = swHour(b.start), e = swHour(b.end);
  var h = '<h1>' + swT("Seus horários", "Your hours") + '</h1><p class="sw-lead">' + swT("Perguntamos uma vez. A Apex usa nos contratos, no link de agendamento e no diário.", "Asked once. Apex uses it for your contracts, your booking link and your daily log.") + '</p>';
  h += '<div class="sw-row"><div class="sw-l">' + swT("Dias em que você trabalha", "Days you work") + '</div><div class="sw-days" role="group" aria-label="' + swT("Dias de trabalho", "Work days") + '">';
  for (var i = 0; i < 7; i++) { var order = [1, 2, 3, 4, 5, 6, 0][i]; h += '<button type="button" class="sw-day" data-act="day" data-v="' + order + '" aria-pressed="' + (b.days.indexOf(order) > -1) + '" aria-label="' + (isEn() ? SW_DAYS_EN[order] : SW_DAYS_PT[order]) + '"' + swH("hours", 1) + '>' + (isEn() ? SW_DAY_LETTER_EN : SW_DAY_LETTER_PT)[order] + '</button>'; }
  h += '</div></div>';
  h += '<div class="sw-row sw-sentr"><span>' + swT("Das", "From") + '</span>' + swStepper("start", swFmtHour(s), 5, 12, s <= 5, s >= 12) + '<span>' + swT("às", "to") + '</span>' + swStepper("end", swFmtHour(e), 13, 22, e <= 13, e >= 22) + '</div>';
  h += '<div class="sw-row"><div class="sw-l">' + swT("Duração de cada agendamento", "Length of each booking") + '</div>' + swStepper("dur", b.dur + " " + swT("minutos", "minutes"), 30, 240, b.dur <= 30, b.dur >= 240) + '</div>';
  h += '<div class="sw-row"><div class="sw-l">' + swT("Os clientes agendam com pelo menos", "Customers must book at least") + '</div>' + swStepper("notice", b.notice + " " + swT("horas de antecedência", "hours ahead"), 0, 72, b.notice <= 0, b.notice >= 72) + '<p class="sw-fine">' + swT("O link de agendamento usa estes mesmos dias e horários. Os clientes só agendam dentro deles.", "Your booking link uses these same days and hours. Customers can only book inside them.") + '</p></div>';
  h += swCallout(swT("Tempo bloqueado ainda não existe", "Blocked time is not available yet"), swT("O agendamento da Apex ainda não lê horários bloqueados, por isso não oferecemos esse campo aqui. Os clientes só conseguem agendar dentro dos dias e horários acima. Para fechar um horário, tire o dia ou mude a hora.", "Apex booking does not read blocked time yet, so this is not offered here. Customers can only book inside the days and hours above. To close a time, take the day off or change the hours."), "hours", 1);
  return { html: h, need: [swT("pelo menos um dia", "at least one day")], ok: b.days.length > 0 };
}
function swHoursSave() {
  var b = swBk();
  SW.bk = Object.assign({}, SW.bk || {}, { work_days: b.days, day_start: b.start, day_end: b.end, duration_min: b.dur, min_notice_hours: b.notice, exists: true });
  swTyped("hours", function() { swSaveQuiet("hours", function() { return gmApi("wizard/hours", { method: "PUT", body: { work_days: b.days, day_start: b.start, day_end: b.end, duration_min: b.dur, min_notice_hours: b.notice } }); }); });
}

// ── Stage 6: how you get paid ─────────────────────────────────────────────
function swLoadStripe(force) {
  if (SW.stripe && !force) { return; }
  if (SW.stripeBusy) { return; }
  SW.stripeBusy = true;
  gmApi("stripe/status").then(function(d) { SW.stripe = d || { available: false, connected: false }; gmStripeStatus = SW.stripe; }).catch(function(e) { SW.stripe = { available: false, connected: false, error: e.message }; })
    .then(function() { SW.stripeBusy = false; if (SW.open && SW.stage === 6) { swRender(); } });
}
function swStripeHtml() {
  var st = SW.stripe, d = SW.doc;
  if (!st) { swLoadStripe(false); return '<div class="sw-card block"><p>' + swT("Verificando o Stripe…", "Checking Stripe…") + '</p></div>'; }
  var h = '<div class="sw-card block">';
  if (!st.available) {
    // Card payments are not switched on for Apex yet: today's pasted link stays.
    var det = (d.payment_methods && d.payment_methods.card_link) || "";
    h += '<b>' + swT("Link de pagamento com cartão", "Card payment link") + '</b><p>' + swT("Cole o seu link de pagamento com cartão. Ele aparece nas suas faturas.", "Paste your card payment link. It appears on your invoices.") + '</p><input type="text" data-bind="cardlink"' + swH("payments", 6) + ' value="' + swEsc(det) + '" placeholder="https://" aria-label="' + swT("Link de pagamento", "Payment link") + '">';
  } else if (!st.connected) {
    h += '<b>' + swT("Conecte a sua própria conta Stripe", "Connect your own Stripe account") + '</b><p>' + swT("Cada fatura ganha um botão para o cliente pagar com cartão, com o valor já preenchido. O dinheiro vai direto para a sua conta Stripe, e o Stripe cobra a taxa dele de você. A Apex não processa nem recebe pagamentos. O sistema da Apex lê os pagamentos feitos nas suas faturas da Apex e o status da sua conta Stripe, para marcá-las como pagas.", "Every invoice gets a button so the customer can pay by card, with the amount already filled in. The money goes straight to your Stripe account, and Stripe charges its fee to you. Apex does not process or receive payments. The Apex system reads the payments made on your Apex invoices and the status of your Stripe account, so it can mark invoices paid.") + '</p>' +
      '<label class="sw-agree"><input type="checkbox" data-bind="stripeagree"' + (SW.stripeAgree ? " checked" : "") + swH("payments", 7) + '><span>' + gmStripeAgreeHtml() + '</span></label>' +
      '<button type="button" class="sw-btn solid" data-act="stripe-connect"' + swH("payments", 8) + (SW.stripeAgree ? "" : " disabled") + '>' + swT("Conectar o Stripe", "Connect Stripe") + '</button><p class="sw-fine">' + swT("O Stripe abre em uma janela separada. Quando terminar, você volta para a Apex.", "Stripe opens in a separate window. When you are done, you come back to Apex.") + '</p>';
  } else if (!st.charges_enabled) {
    h += '<b>' + swT("Termine a configuração do Stripe", "Finish setting up Stripe") + '</b><p>' + swT("O cadastro no Stripe ainda não terminou. Continue para liberar o pagamento com cartão.", "Stripe setup is not finished yet. Continue to turn on card payments.") + '</p><div class="sw-chips"><button type="button" class="sw-btn solid" data-act="stripe-connect"' + swH("payments", 8) + '>' + swT("Continuar no Stripe", "Continue on Stripe") + '</button><button type="button" class="sw-btn" style="margin-top:0" data-act="stripe-refresh"' + swH("payments", 9) + '>' + swT("Atualizar status", "Refresh status") + '</button></div>';
  } else {
    h += '<b>' + swT("Stripe conectado", "Stripe connected") + '</b><p>' + swT("As faturas já mostram o botão de pagamento com cartão, e o pagamento é registrado automaticamente.", "Invoices now show the card payment button, and the payment is recorded automatically.") + '</p>';
    if (st.reaccept_needed) {
      h += '<div class="sw-callout err">' + SW_INFO + '<div><b>' + swT("Os Termos foram atualizados", "The Terms were updated") + '</b><span>' + swT("Revise e concorde novamente.", "Please review and agree again.") + '</span></div></div>' +
        '<label class="sw-agree"><input type="checkbox" data-bind="reaccept"' + (SW.reaccept ? " checked" : "") + swH("payments", 10) + '><span>' + gmStripeAgreeHtml() + '</span></label><button type="button" class="sw-btn solid" data-act="stripe-reaccept"' + swH("payments", 10) + (SW.reaccept ? "" : " disabled") + '>' + swT("Concordo", "I agree") + '</button>';
    }
    h += '<p class="sw-fine">' + swT("Quer receber cartão presencialmente no iPhone? O Tap to Pay é explicado no Aprenda, em Pagamentos.", "Want to take cards in person on your iPhone? Tap to Pay is explained in Aprenda, under Payments.") + ' <button type="button" class="sw-link" style="min-height:44px" data-act="tap-help"' + swH("payments", 11) + '>' + swT("Abrir o Aprenda", "Open Aprenda") + '</button></p>';
  }
  return h + '</div>';
}
function swPayments() {
  var d = SW.doc, pm = d.payment_methods || {}, cs = swCs();
  var h = '<h1>' + swT("Como você recebe", "How you get paid") + '</h1><p class="sw-lead">' + swT("Toque em cada forma de pagamento que os clientes podem usar.", "Tap every way your customers can pay you.") + '</p>';
  h += '<div class="sw-row"><div class="sw-l">' + swT("Formas de pagamento", "Payment methods") + '</div><div class="sw-chips">';
  SW_PAY.forEach(function(m) { h += '<button type="button" class="sw-chip" data-act="pay" data-v="' + m[0] + '" aria-pressed="' + (Object.prototype.hasOwnProperty.call(pm, m[0])) + '"' + swH("payments", 1) + '>' + swT(m[1], m[2]) + '</button>'; });
  h += '</div></div>';
  if (Object.prototype.hasOwnProperty.call(pm, "card_link")) { h += swStripeHtml(); }
  var vd = d.estimate_valid_days === null || d.estimate_valid_days === undefined ? SW.d.defaults.estimate_valid_days : d.estimate_valid_days;
  h += '<div class="sw-row"><div class="sw-l">' + swT("Seus orçamentos valem por", "Your estimates stay valid for") + '</div>' + swStepper("valid", vd + " " + swT("dias", "days"), 7, 90, vd <= 7, vd >= 90) + '</div>';
  var td = String(d.default_terms_days || 0);
  h += '<div class="sw-row"><label class="sw-l" for="swTerms">' + swT("Prazo de pagamento", "Payment terms") + '</label><select id="swTerms" data-bind="terms"' + swH("payments", 3) + '>' + SW_TERMS.map(function(t) { return '<option value="' + t[0] + '"' + (t[0] === td ? " selected" : "") + '>' + swT(t[1], t[2]) + '</option>'; }).join("") + '</select></div>';
  var presets = d.schedule_presets || [];
  if (presets.length) {
    var cur = SW.d.answers.schedule_pick || (presets[0] && presets[0].name);
    h += '<div class="sw-row"><label class="sw-l" for="swSched">' + swT("Parcelamento de pagamento", "Payment schedule") + '</label><select id="swSched" data-bind="sched"' + swH("payments", 3) + '>' + presets.map(function(p) { return '<option value="' + swEsc(p.name) + '"' + (p.name === cur ? " selected" : "") + '>' + swEsc(p.name) + '</option>'; }).join("") + '</select><p class="sw-fine">' + swT("Os modelos ficam em Configurações, onde você pode editar.", "The templates are in Settings, where you can edit them.") + '</p></div>';
  }
  var late = d.late_fee_annual_pct === null || d.late_fee_annual_pct === undefined ? 0 : d.late_fee_annual_pct, grace = d.late_fee_grace_days === null || d.late_fee_grace_days === undefined ? 0 : d.late_fee_grace_days;
  h += '<div class="sw-row sw-sentr"><span>' + swT("Juros por atraso", "Late fee") + '</span>' + swStepper("late", late + " " + swT("% ao ano", "percent a year"), 0, 18, late <= 0, late >= 18) + '<span>' + swT("depois de", "after") + '</span>' + swStepper("grace", grace + " " + swT("dias", "days"), 0, 30, grace <= 0, grace >= 30) + '</div><p class="sw-fine">' + swT("Um só valor: vale para a fatura e para o contrato.", "One value: it applies to the invoice and to the contract.") + '</p>';
  var mm = d.min_margin_pct === null || d.min_margin_pct === undefined ? 0 : d.min_margin_pct;
  h += '<div class="sw-row"><div class="sw-l">' + swT("Menor margem de lucro que você aceita", "Smallest profit margin you accept") + '</div>' + swStepper("margin", mm + " " + swT("%", "percent"), 0, 60, mm <= 0, mm >= 60) + '<p class="sw-fine">' + swT("A Apex avisa quando um orçamento fica abaixo disso. 0 quer dizer sem aviso.", "Apex warns you when an estimate falls under this. 0 means no warning.") + '</p></div>';
  return { html: h, need: [swT("pelo menos uma forma de pagamento", "at least one payment method")], ok: Object.keys(pm).length > 0 };
}
function swPaySave() {
  var pm = SW.doc.payment_methods || {};
  swTyped("pay", function() { swSaveQuiet("payments", function() { return swDocPut({ payment_methods: pm }); }); });
}
function swStripeConnect() {
  if (!SW.stripeAgree && !(SW.stripe && SW.stripe.connected)) { return; }
  swFlush();
  // Everything is saved to the server BEFORE Stripe opens, and the stage with it.
  swSave("before-stripe", function() { return swStageSave(6); }).then(function() {
    return gmApi("stripe/connect", { method: "POST", body: { accepted: !!SW.stripeAgree, language: isEn() ? "en" : "pt" } });
  }).then(function(d) {
    if (!d || !d.url) { throw new Error(swT("O Stripe não respondeu.", "Stripe did not answer.")); }
    if (gmInApp()) { apexOpenExternal(d.url); SW.stripe = { available: true, connected: true, charges_enabled: false }; swRender(); swWireResume(); return; }
    window.location.href = d.url;
  }).catch(function(e) { SW.saveErr = e.message; swStatusRender(); });
}
var swResumeWired = false;
function swWireResume() {
  if (swResumeWired || !gmInApp()) { return; }
  try {
    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
      window.Capacitor.Plugins.App.addListener("appStateChange", function(state) { if (state && state.isActive && SW.open && SW.stage === 6) { swLoad().then(function() { swLoadStripe(true); swRender(); }); } });
      swResumeWired = true;
    }
  } catch (e) { /* no App plugin: the Refresh status button still works */ }
}

// ── Stage 7: how you work ─────────────────────────────────────────────────
function swHowGet() {
  var d = swCs().defaults || {}, v = swCs().values || {}, a = SW.d.answers.how || {};
  return {
    warranty: a.warranty !== undefined ? a.warranty : (d.C11 === "C11-B" ? 24 : 12),
    holdback: a.holdback !== undefined ? a.holdback : (d.C12 === "C12-C" ? (parseInt(v.retainage_percent, 10) || 5) : 0),
    permits: a.permits || (/actual amount/i.test(v.permit_fee_treatment || "") ? "bill" : "include"),
    debris: a.debris || (/each work day/i.test(v.debris_frequency || "") ? "daily" : /week/i.test(v.debris_frequency || "") ? "weekly" : "end"),
    materials: a.materials || (d.C10 === "C10-D" ? "customer" : "mine"),
    photos: a.photos || (d.C18 === "C18-A" ? "ask" : "yes"),
    title: a.title !== undefined ? a.title : (v.company_signer_title || "Owner"),
    source: swCs().source || "apex"
  };
}
function swSelHow(id, opts, val) {
  var h = '<select class="sw-sel" data-bind="how" data-id="' + id + '" aria-label="' + swT("Escolha", "Choose") + '"' + swH("how", 2) + '>';
  opts.forEach(function(o) { h += '<option value="' + o[0] + '"' + (o[0] === String(val) ? " selected" : "") + '>' + swT(o[1], o[2]) + '</option>'; });
  return h + '</select>';
}
function swHow() {
  if (swCMode()) {
    var hn = '<h1>' + swT("O seu contrato", "Your contract") + '</h1>';
    return { html: hn + swContractActions(), need: [], ok: true };
  }
  var w = swHowGet(), cs = swCs(), v = cs.values || {};
  var h = '<h1>' + swT("É assim que você trabalha", "This is how you work") + '</h1><p class="sw-lead">' + swT("Leia cada linha. Mude um número ou uma escolha se não estiver certo. Já vem preenchido.", "Read each line. Change a number or choice if it is not right. It is already filled in.") + '</p>';
  h += '<div class="sw-sent">' + swT("O seu trabalho tem garantia de ", "Your work is under warranty for ") + swSelHow("warranty", [["12", "12 meses", "12 months"], ["24", "24 meses", "24 months"]], w.warranty) + '.</div>';
  h += '<div class="sw-sent">' + swT("Você retém ", "You hold back ") + swStepper("holdback", w.holdback + " " + swT("%", "percent"), 0, 10, w.holdback <= 0, w.holdback >= 10) + swT(" até o trabalho terminar.", " until the job is finished.") + '</div>';
  h += '<div class="sw-sent">' + swT("Licenças da obra: ", "Permits: ") + swSelHow("permits", [["include", "Eu tiro as licenças e incluo as taxas", "I pull permits and include the fees"], ["bill", "Eu tiro as licenças e cobro as taxas", "I pull permits and bill the fees"]], w.permits) + '</div>';
  h += '<div class="sw-sent">' + swT("Entulho: ", "Debris: ") + swSelHow("debris", [["daily", "Retiro no fim de cada dia de trabalho", "I remove it at the end of each work day"], ["weekly", "Retiro toda semana", "I remove it every week"], ["end", "Retiro quando o trabalho termina", "I remove it when the job is finished"]], w.debris) + '</div>';
  h += '<div class="sw-sent">' + swT("Materiais: ", "Materials: ") + swSelHow("materials", [["mine", "Eu forneço os materiais", "I supply the materials"], ["choose", "Eu forneço os materiais, e o cliente escolhe alguns itens", "I supply the materials, and the customer chooses some items"], ["customer", "O cliente compra parte dos materiais", "The customer buys some of the materials"]], w.materials) + '</div>';
  h += '<div class="sw-sent">' + swT("Fotos: ", "Photos: ") + swSelHow("photos", [["yes", "Você pode usar fotos do trabalho pronto", "You may use photos of the finished job"], ["ask", "Pergunte antes de usar qualquer foto", "Ask me before using any photos"]], w.photos) + '</div>';
  // Insurance: the questions come from the Worker, for this business's state.
  var sb = (SW.cs && SW.cs.state_biz) || {}, keys = Object.keys(sb);
  if (keys.length) {
    h += '<div class="sw-row" style="margin-top:14px"><div class="sw-l">' + swT("Seguro", "Insurance") + '</div><p class="sw-fine" style="margin:-4px 0 10px">' + swT("Toque no que se aplica ao seu negócio.", "Tap what applies to your business.") + '</p>';
    keys.forEach(function(k) {
      var q = sb[k], cur = v[q.key] || "";
      h += '<div class="sw-l" style="font-weight:500">' + swEsc(isEn() ? q.en : q.pt) + '</div><div class="sw-chips" style="margin-bottom:12px">';
      (q.options || []).forEach(function(o) { h += '<button type="button" class="sw-chip" data-act="ins" data-k="' + swEsc(q.key) + '" data-v="' + swEsc(o.v) + '" aria-pressed="' + (cur === o.v) + '"' + swH("how", 3) + '>' + swEsc(isEn() ? o.en : o.pt) + '</button>'; });
      h += '</div>';
    });
    h += '</div>';
  }
  h += '<div class="sw-sent">' + swT("Você assina os contratos como: ", "You sign contracts as: ") + swSelHow("title", [["Owner", "Owner", "Owner"], ["President", "President", "President"], ["Manager", "Manager", "Manager"], ["Member", "Member", "Member"]], w.title) + '</div>';
  h += '<div class="sw-sent">' + swT("O seu contrato: ", "Your contract: ") + swSelHow("source", [["apex", "Modelo da Apex", "Apex template"], ["client", "Meu próprio contrato", "My own contract"]], w.source) + '</div>';
  if (w.source === "client") { h += swOwnContractHtml(); }
  h += swCallout(swT("Sobre os termos legais do seu contrato", "About the legal terms in your contract"), swT("O seu contrato parte do modelo padrão da Apex, com os prazos e números dele. A Apex não é um escritório de advocacia e não dá aconselhamento jurídico. Na última página você escolhe como conferir o contrato antes de usar.", "Your contract starts from Apex's standard template, including its notice periods and deadline numbers. Apex is not a law firm and does not give legal advice. On the last page you choose how to check the contract before you use it."), "how", 4);
  return { html: h, need: [], ok: true };
}
// "My own contract": the first step checks the last. If it is not available the screen says so here.
function swOwnContractHtml() {
  var oc = (SW.cs && SW.cs.own_contract) || {}, tpl = SW.ownTpl;
  var h = '<div class="sw-row">';
  if (oc.available === false) {
    return h + swCallout(swT("Ainda não está disponível", "Not available yet"), swT("O seu próprio contrato ainda não está disponível. Use o modelo da Apex por enquanto.", "My own contract is not available yet. Use the Apex template for now."), "how", 5, true) + '</div>';
  }
  if (!tpl) { swLoadOwnTemplates(); return h + '<p class="sw-fine">' + swT("Carregando…", "Loading…") + '</p></div>'; }
  var last = tpl[0];
  h += '<p class="sw-fine" id="swOwnAi">' + swT("Um sistema de inteligência artificial (Claude, da Anthropic) lê este arquivo para organizar as cláusulas. Você revisa o resultado e confirma que ele corresponde ao seu contrato original.", "An artificial intelligence system (Claude, by Anthropic) reads this file to organize the clauses. You review the result and confirm it matches your original contract.") + '</p>';
  h += '<div class="sw-l">' + swT("Um advogado já revisou este contrato?", "Has a lawyer reviewed this contract?") + '</div><div class="sw-chips"><button type="button" class="sw-chip" data-act="lawyer" data-v="yes" aria-pressed="' + (SW.lawyer === "yes") + '"' + swH("how", 5) + '>' + swT("Sim", "Yes") + '</button><button type="button" class="sw-chip" data-act="lawyer" data-v="no" aria-pressed="' + (SW.lawyer === "no") + '"' + swH("how", 5) + '>' + swT("Não", "No") + '</button></div>';
  h += '<input id="swOwnFile" type="file" accept="application/pdf" hidden data-bind="ownfile"' + swH("how", 5) + '><label class="sw-file" for="swOwnFile"' + swH("how", 5) + (SW.lawyer && !SW.ownBusy ? "" : ' style="opacity:.4"') + '>' + (SW.ownBusy ? swT("Lendo o contrato…", "Reading the contract…") : swT("Enviar o PDF do meu contrato", "Upload my contract PDF")) + '</label>';
  if (!SW.lawyer) { h += '<p class="sw-fine">' + swT("Responda a pergunta acima primeiro.", "Answer the question above first.") + '</p>'; }
  if (SW.ownErr) { h += swCallout(swT("Não funcionou", "That did not work"), SW.ownErr, "how", 5, true); }
  if (last) {
    var m = last.mapping || {}, found = (m.areas || []).filter(function(x) { return x.excerpt; });
    h += '<div class="sw-card block" style="margin-top:12px"><b>' + swEsc(last.original_name || "") + '</b><p>' + (last.status === "reviewed" ? swT("Confirmado por você. Este contrato é usado nas cláusulas abaixo.", "Confirmed by you. This contract is used for the clauses below.") : swT("Aguardando a sua confirmação. Até confirmar, vale o modelo da Apex.", "Waiting for your confirmation. Until you confirm, the Apex template is used.")) + '</p>' +
      '<p>' + found.length + swT(" áreas do contrato foram encontradas. As outras ficam com a escolha padrão da Apex.", " contract areas were found. The others keep Apex's standard choice.") + '</p>';
    found.forEach(function(x) { h += '<div class="sw-lt"><b>' + swEsc(x.name) + '</b><p>' + swEsc(String(x.excerpt).slice(0, 260)) + '</p></div>'; });
    if (last.status === "pending_review") { h += '<button type="button" class="sw-btn solid" style="margin-top:12px" data-act="own-confirm"' + swH("how", 6) + '>' + swT("Confirmar que corresponde ao meu contrato", "Confirm it matches my contract") + '</button>'; }
    h += '</div>';
  }
  return h + '</div>';
}
function swLoadOwnTemplates() {
  if (SW.ownLoading) { return; }
  SW.ownLoading = true;
  gmApi("contract-own-templates").then(function(d) { SW.ownTpl = d.templates || []; }).catch(function(e) { SW.ownTpl = []; SW.ownErr = e.message; }).then(function() { SW.ownLoading = false; if (SW.open && SW.stage === 7) { swRender(); } });
}
function swHowSave(patch) {
  SW.d.answers.how = Object.assign({}, SW.d.answers.how || {}, patch.local || {});
  var body = patch.server;
  swSaveQuiet("how", function() { return gmApi("wizard/how", { method: "PUT", body: body }).then(function(r) { if (r && r.settings) { SW.cs.settings = r.settings; } return gmApi("wizard", { method: "PUT", body: { answers: { how: SW.d.answers.how } } }); }); });
}

// ── Stage 8: connections ──────────────────────────────────────────────────
function swLoadTt() {
  if (SW.tt || SW.ttLoading) { return; }
  SW.ttLoading = true;
  gmApi("thumbtack/status").then(function(d) { SW.tt = d || { available: false, connected: false }; }).catch(function() { SW.tt = { available: false, connected: false, error: true }; }).then(function() { SW.ttLoading = false; if (SW.open && SW.stage === 8) { swRender(); } });
}
function swLogoTile(brand, letter) {
  // Brand logos are served from the Worker or storage (never bundled in the app). A letter tile shows until one is there.
  return '<span class="sw-lg"><img alt="" data-brand="' + brand + '" src="' + swEsc(WORKER_URL + "/api/brand-logo/" + brand) + '" onerror="this.remove()"><em>' + letter + '</em></span>';
}
function swConnections() {
  swLoadTt();
  var bk = SW.bk || {}, on = bk.exists !== undefined ? !!bk.enabled : true;
  var lang = (SW.d.answers.ref_lang) || (isEn() ? "en" : "pt");
  var h = '<h1>' + swT("Conexões", "Connections") + '</h1><p class="sw-lead">' + swT("Opcional. Conecte agora ou depois em Configurações.", "Optional. Connect now or later in Settings.") + '</p>';
  var tt = SW.tt;
  h += '<div class="sw-card">' + swLogoTile("thumbtack", "T") + '<div style="flex:1"><b>Thumbtack</b><p>' + swT("Todos os seus leads do Thumbtack em um só lugar. Você pode pedir uma avaliação a cada cliente pelo lead.", "All your Thumbtack leads in one place. You can ask each customer for a review from the lead.") + '</p></div>' +
    (!tt ? '<span class="sw-soon">…</span>' : (tt.connected ? '<span class="sw-soon">' + swT("Conectado", "Connected") + '</span>' : (tt.available === false ? '<span class="sw-soon">' + swT("Em breve", "Coming soon") + '</span>' : '<button type="button" class="sw-chip" data-act="tt-connect"' + swH("connections", 1) + (SW.ttBusy ? " disabled" : "") + '>' + swT("Conectar", "Connect") + '</button>'))) + '</div>';
  h += '<div class="sw-card soon">' + swLogoTile("meta", "M") + '<div style="flex:1"><b>' + swT("Facebook e Instagram", "Facebook and Instagram") + '</b><p>' + swT("Traga os leads dos seus anúncios do Facebook e Instagram para a Apex.", "Pull the leads from your Facebook and Instagram ads into Apex.") + '</p></div><span class="sw-soon">' + swT("Em breve", "Coming soon") + '</span></div>';
  h += '<div class="sw-card">' + swLogoTile("booking", "A") + '<div style="flex:1"><b>' + swT("Agendamento online", "Online booking") + '</b><p>' + swT("Os clientes agendam uma visita pelo seu link, dentro dos horários que você definiu. Cada agendamento vira um lead.", "Customers book a visit from your link, inside the hours you set. Each booking becomes a lead.") + '</p></div><button type="button" class="sw-chip" data-act="booking" aria-pressed="' + on + '"' + swH("connections", 2) + '>' + (on ? swT("Ligado", "On") : swT("Desligado", "Off")) + '</button></div>';
  h += '<div class="sw-row"><div class="sw-l">' + swT("Idioma da sua página de indicação", "Language of your referral page") + '</div><div class="sw-chips"><button type="button" class="sw-chip" data-act="reflang" data-v="en" aria-pressed="' + (lang === "en") + '"' + swH("connections", 3) + '>English</button><button type="button" class="sw-chip" data-act="reflang" data-v="pt" aria-pressed="' + (lang === "pt") + '"' + swH("connections", 3) + '>Português</button></div></div>';
  return { html: h, need: [], ok: true };
}

// ── Stage 9: your team ────────────────────────────────────────────────────
function swSwapPeopleWrap(on) {
  var s = swEl("peopleCardWrap"), w = swEl("swPeopleWrap");
  if (on) { if (s && w && s !== w) { s.id = "peopleCardWrapSettings"; } if (w) { w.id = "peopleCardWrap"; } }
  else { var mine = swEl("peopleCardWrap"), orig = swEl("peopleCardWrapSettings"); if (mine && mine.getAttribute("data-sw") === "1") { mine.id = "swPeopleWrap"; } if (orig) { orig.id = "peopleCardWrap"; } }
}
function swRestorePeopleWrap() { swSwapPeopleWrap(false); }
function swTeam() {
  var a = SW.d.answers, mode = a.team_mode || "";
  var h = '<h1>' + swT("Sua equipe", "Your team") + '</h1><p class="sw-lead">' + swT("Você trabalha sozinho ou com pessoas que ajudam?", "Do you work alone, or with people who help you?") + '</p>';
  h += '<div class="sw-row"><div class="sw-l">' + swT("Eu trabalho", "I work") + '</div><div class="sw-chips"><button type="button" class="sw-chip" data-act="team" data-v="alone" aria-pressed="' + (mode === "alone") + '"' + swH("team", 1) + '>' + swT("Sozinho(a)", "Alone") + '</button><button type="button" class="sw-chip" data-act="team" data-v="team" aria-pressed="' + (mode === "team") + '"' + swH("team", 1) + '>' + swT("Com uma equipe", "With a team") + '</button></div></div>';
  if (mode === "alone" && !swCMode()) { h += swCallout(swT("Você assina os seus contratos", "You sign your own contracts"), swT("Você pode adicionar pessoas a qualquer hora em Configurações, Pessoas e acessos.", "You can add people any time in Settings, People and access."), "team", 1); }
  var after = null;
  if (mode === "team") {
    h += '<div id="swPeopleWrap" data-sw="1" data-help-default="setup-wizard#team"><p class="sw-fine">' + swT("Carregando…", "Loading…") + '</p></div>';
    if (!swCMode()) { h += '<div id="swSigners">' + swSignersHtml() + '</div>'; }
    after = function() {
      swSwapPeopleWrap(true); var w = swEl("peopleCardWrap"); if (w) { w.setAttribute("data-sw", "1"); }
      // The signer chips list the people the card shows, so they are drawn again once the card has loaded.
      if (typeof portalPeopleLoad === "function") { portalPeopleLoad().then(function() { var sg = swEl("swSigners"); if (sg && SW.stage === 9) { sg.innerHTML = swSignersHtml(); } }); }
    };
  }
  return { html: h, need: [swT("se você trabalha sozinho ou com equipe", "whether you work alone or with a team")], ok: !!mode, after: after };
}
function swSignersHtml() {
  var cs = swCs(), list = cs.signers || [], d = SW.signerDraft || { name: "", phone: "" };
  var people = (typeof peopleState !== "undefined" && peopleState.list) ? peopleState.list.filter(function(p) { return p.role !== "client"; }) : [];
  var h = '<div class="sw-row"><div class="sw-l">' + swT("Quem pode assinar contratos", "Who can sign contracts") + '</div><p class="sw-fine" style="margin:-4px 0 10px">' + swT("Você pode assinar sozinho, ou deixar a sua equipe assinar para você não precisar. Cada pessoa que assina precisa de um telefone.", "You can sign yourself, or allow your people to sign so you do not have to. Each person who signs needs a phone number.") + '</p><div class="sw-chips">';
  h += '<button type="button" class="sw-chip" aria-pressed="true" disabled' + swH("team", 2) + '>' + swT("Eu", "Me") + '</button>';
  list.forEach(function(x, i) { h += '<button type="button" class="sw-chip" data-act="signer-rm" data-i="' + i + '" aria-pressed="true"' + swH("team", 2) + '>' + swEsc(x.name) + ' ×</button>'; });
  people.forEach(function(p) {
    if (list.some(function(x) { return x.name === p.name; })) { return; }
    h += '<button type="button" class="sw-chip" data-act="signer-pick" data-n="' + swEsc(p.name) + '" aria-pressed="false"' + swH("team", 2) + '>' + swEsc(p.name) + '</button>';
  });
  h += '</div><div class="sw-licrow" style="margin-top:12px"><input type="text" data-bind="sname" value="' + swEsc(d.name) + '" placeholder="' + swT("Nome", "Name") + '" aria-label="' + swT("Nome de quem assina", "Name of the signer") + '"' + swH("team", 2) + '>' +
    '<input type="tel" data-bind="sphone" value="' + swEsc(d.phone) + '" placeholder="' + swT("Telefone", "Phone") + '" aria-label="' + swT("Telefone de quem assina", "Signer phone") + '"' + swH("team", 2) + '></div>' +
    '<button type="button" class="sw-btn" data-act="signer-add"' + swH("team", 2) + '>' + swT("Adicionar quem assina", "Add a signer") + '</button>' + (SW.signerErr ? '<p class="sw-fine" style="color:var(--sw-err)">' + swEsc(SW.signerErr) + '</p>' : '') + '</div>';
  return h;
}

// ── Stage 10: link in bio ─────────────────────────────────────────────────
function swBio() {
  var slug = SW.doc.link_slug, h = '<h1>' + swT("Seu link na bio", "Your link in bio") + '</h1><p class="sw-lead">' + swT("Os clientes que acham você no Instagram chegam nesta página e mandam um pedido. Copie o link para o perfil do Instagram.", "Customers who find you on Instagram land on this page and send you a request. Copy the link into your Instagram profile.") + '</p>';
  if (!slug) { return { html: h + swCallout(swT("O link ainda não foi criado", "Your link is not made yet"), swT("Tente de novo em instantes.", "Try again in a moment."), "bio", 1, true), need: [], ok: true }; }
  var rel = "link.html?p=" + encodeURIComponent(slug), full = "https://apex.resonateai.online/" + rel;
  h += '<div class="sw-phone"><iframe src="' + swEsc(rel + "&t=" + SW.logoTs) + '" title="' + swT("Sua página de link na bio", "Your link in bio page") + '" loading="lazy"></iframe></div>';
  h += '<div class="sw-row"><label class="sw-l" for="swBioLink">' + swT("Seu link", "Your link") + '</label><div class="sw-linkrow"><input id="swBioLink" type="text" readonly value="' + swEsc(full) + '" data-bind="biolink"' + swH("bio", 1) + '><button type="button" class="sw-btn solid" data-act="copybio"' + swH("bio", 1) + '>' + (SW.copied ? swT("Copiado", "Copied") : swT("Copiar link", "Copy link")) + '</button></div></div>';
  h += swCallout(swT("Você acha de novo depois", "You can find it again"), swT("Em Configurações, Marketing, a qualquer hora. O guia no Aprenda mostra onde.", "Settings, Marketing, any time. Your guide in Aprenda shows where."), "bio", 1);
  return { html: h, need: [], ok: true };
}

// ── Stage 11: review ──────────────────────────────────────────────────────
// Review labels: the state by its name and the business kind in the owner's language
// (the stored value stays the English words the contract prints).
function swStateName(code) {
  if (!code) { return swT("Não preenchido", "Not set"); }
  var st = ((SW.cs && SW.cs.states) || []).filter(function(x) { return x.code === code; })[0];
  return st ? st.name : code;
}
function swEntityLabel(raw) {
  if (/limited liability/i.test(raw || "")) { return "LLC"; }
  if (/sole/i.test(raw || "")) { return swT("Empresário individual", "Sole proprietorship"); }
  return "";
}
function swReviewStage() {
  var d = SW.doc, a = SW.d.answers, cs = swCs(), v = cs.values || {}, b = swBk();
  var cat = swCat(a.cat);
  var days = b.days.slice().sort().map(function(x) { return (isEn() ? SW_DAYS_EN : SW_DAYS_PT)[x].slice(0, 3); }).join(", ");
  var nums = (d.license_numbers || []).filter(function(x) { return String(x).trim(); });
  var pm = Object.keys(d.payment_methods || {}).map(function(k) { var m = SW_PAY.filter(function(p) { return p[0] === k; })[0]; return m ? swT(m[1], m[2]) : k; });
  var w = swHowGet();
  var lines = [
    [swT("Negócio", "Business"), d.legal_name || swT("Não preenchido", "Not set"), 1],
    [swT("Tipo de trabalho", "Kind of work"), a.cat === "other" ? (a.other_text || "") : ((cat ? swCatLabel(cat) : swT("Não preenchido", "Not set")) + ((a.subs || []).length ? ": " + a.subs.map(function(k) { var s = cat && cat.subtaps.filter(function(t) { return t.key === k; })[0]; return s ? (isEn() ? s.en : s.pt) : k; }).join(", ") : "")), 3],
    [swT("Estado e tipo", "State and type"), swStateName(v.business_state) + (swEntityLabel(v.business_entity_type) ? ", " + swEntityLabel(v.business_entity_type) : ""), 2],
    [swT("Telefone", "Phone"), d.phone || swT("Não preenchido", "Not set"), 2],
    [swT("Licença", "License"), d.license_not_required ? swT("Não precisa de licença estadual", "No state license needed") : (nums.join(", ") || swT("Nenhuma informada", "None added")), 4],
    [swT("Dias e horários", "Work days and hours"), days + ", " + swFmtHHMM(b.start) + " " + swT("às", "to") + " " + swFmtHHMM(b.end), 5],
    [swT("Pagamentos", "Payments"), (pm.join(", ") || swT("Nenhum", "None")) + (SW.stripe && SW.stripe.connected && Object.prototype.hasOwnProperty.call(d.payment_methods || {}, "card_link") ? swT(", Stripe conectado", ", Stripe connected") : ""), 6],
    [swT("Orçamentos valem", "Estimates valid"), (d.estimate_valid_days || SW.d.defaults.estimate_valid_days) + " " + swT("dias", "days"), 6],
    swCMode() ? [swT("Contrato", "Contract"), swT("Ainda não disponível na Apex", "Not available in Apex yet"), 7] :
    [swT("Como você trabalha", "How you work"), w.warranty + " " + swT("meses de garantia", "month warranty") + ", " + swT("juros por atraso ", "late fee ") + (d.late_fee_annual_pct || 0) + swT("% ao ano", " percent a year"), 7],
    [swT("Equipe", "Team"), a.team_mode === "team" ? swT("Com uma equipe", "With a team") : (a.team_mode === "alone" ? swT("Sozinho(a)", "Alone") : swT("Não preenchido", "Not set")), 9],
    [swT("Link na bio", "Link in bio"), d.link_slug ? swT("Pronto para copiar", "Ready to copy") : swT("Ainda não criado", "Not made yet"), 10]
  ];
  var h = '<h1>' + swT("Revisão", "Review") + '</h1><p class="sw-lead">' + swT("Leia tudo. Toque em Mudar no que não estiver certo.", "Read it over. Tap Change on anything that is not right.") + '</p><div>';
  lines.forEach(function(l) { h += '<div class="sw-rl"><div><span class="sw-rk">' + swEsc(l[0]) + '</span><span class="sw-rv">' + swEsc(l[1]) + '</span></div><button type="button" class="sw-link" data-act="jump" data-i="' + l[2] + '"' + swH("review", 1) + '>' + swT("Mudar", "Change") + '</button></div>'; });
  h += '</div>';
  var noContract = !!swCMode() || (SW.d.contract && SW.d.contract.available === false);
  if (noContract) {
    h += '<div style="margin-top:26px">' + swContractActions() + '</div>';
  } else if (SW.contractFresh) {
    h += '<div style="margin-top:26px"><p class="sw-lead" style="margin:0 0 6px">' + swT("Recomendamos que um advogado confira o seu contrato antes de você usá-lo. A Apex não dá aconselhamento jurídico. Você pode começar agora.", "We recommend that a lawyer checks your contract before you use it. Apex does not give legal advice. You can start now.") + '</p>' +
      '<div class="sw-chips"><button type="button" class="sw-link" data-act="clauses"' + swH("review", 2) + '>' + swT("Revisar cláusula por cláusula", "Review clause by clause") + '</button><button type="button" class="sw-link" data-act="lawyer-pdf"' + swH("review", 3) + (SW.pdfBusy ? " disabled" : "") + '>' + (SW.pdfBusy ? swT("Preparando o PDF…", "Preparing the PDF…") : swT("Exportar um PDF para o meu advogado", "Export a PDF for my lawyer")) + '</button></div>' +
      (SW.pdfErr ? '<p class="sw-fine" style="color:var(--sw-err)">' + swEsc(SW.pdfErr) + '</p>' : '') + '</div>';
  }
  if (SW.finishErr) { h += swCallout(swT("Não deu para começar", "Could not start"), SW.finishErr, "review", 4, true); }
  return { html: h, need: [], ok: true };
}

// ── Events ─────────────────────────────────────────────────────────────────
function swSetStep(id, dir) {
  var d = SW.doc, b = swBk();
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  if (id === "start") { var s = clamp(swHour(b.start) + dir, 5, 12); SW.bk = Object.assign({}, SW.bk, { day_start: swHHMM(s) }); swHoursSave(); }
  else if (id === "end") { var e = clamp(swHour(b.end) + dir, 13, 22); SW.bk = Object.assign({}, SW.bk, { day_end: swHHMM(e) }); swHoursSave(); }
  else if (id === "dur") { SW.bk = Object.assign({}, SW.bk, { duration_min: clamp(b.dur + dir * 30, 30, 240) }); swHoursSave(); }
  else if (id === "notice") { SW.bk = Object.assign({}, SW.bk, { min_notice_hours: clamp(b.notice + dir, 0, 72) }); swHoursSave(); }
  else if (id === "valid") { var vd = clamp((d.estimate_valid_days === null || d.estimate_valid_days === undefined ? SW.d.defaults.estimate_valid_days : d.estimate_valid_days) + dir, 7, 90); d.estimate_valid_days = vd; swTyped("valid", function() { swSaveQuiet("valid", function() { return swDocPut({ estimate_valid_days: vd }); }); }); }
  else if (id === "late") { var lf = clamp((d.late_fee_annual_pct || 0) + dir, 0, 18); d.late_fee_annual_pct = lf; swTyped("late", function() { swSaveQuiet("late", function() { return swDocPut({ late_fee_annual_pct: lf, late_fee_grace_days: d.late_fee_grace_days === null || d.late_fee_grace_days === undefined ? 0 : d.late_fee_grace_days }); }); }); }
  else if (id === "grace") { var gd = clamp((d.late_fee_grace_days || 0) + dir, 0, 30); d.late_fee_grace_days = gd; swTyped("grace", function() { swSaveQuiet("grace", function() { return swDocPut({ late_fee_grace_days: gd }); }); }); }
  else if (id === "margin") { var mg = clamp((d.min_margin_pct || 0) + dir, 0, 60); d.min_margin_pct = mg; swTyped("margin", function() { swSaveQuiet("margin", function() { return swDocPut({ min_margin_pct: mg }); }); }); }
  else if (id === "holdback") { var hb = clamp(swHowGet().holdback + dir, 0, 10); swHowSave({ local: { holdback: hb }, server: { holdback_pct: hb } }); }
  swRender();
}
function swNext() {
  swFlush();
  if (SW.stage === 11) { swFinish(); return; }
  if (SW.stage === 4 && SW.licAutoTick && SW.doc && SW.doc.license_not_required !== true && !((SW.doc.license_numbers || []).filter(function(x) { return String(x).trim(); }).length)) {
    SW.doc.license_not_required = true;
    swSaveQuiet("nolic", function() { return swDocPut({ license_not_required: true }); }).then(function() { swRefreshStatus(); });
  }
  swGo(SW.stage + 1);
}
function swFinish() {
  SW.finishing = true; SW.finishErr = ""; swRender();
  swSave("finish", function() { return gmApi("wizard/finish", { method: "POST", body: {} }); }).then(function() {
    SW.finishing = false; swClose();
    if (typeof gmToast === "function") { gmToast(swT("Tudo pronto. Bom trabalho!", "You are all set. Good work!")); }
    if (typeof gmDocSettings !== "undefined") { gmDocSettings = null; }
  }).catch(function(e) { SW.finishing = false; SW.finishErr = e.message; swRender(); });
}
function swBind(root) {
  root.addEventListener("click", function(ev) {
    var t = ev.target; if (!t || !t.closest) { return; }
    var el = t.closest("[data-act]"); if (!el || !root.contains(el)) { return; }
    var act = el.getAttribute("data-act"), v = el.getAttribute("data-v"), a = SW.d ? SW.d.answers : null;
    if (act === "close") { swClose(); return; }
    if (act === "reload") { swOpen(SW.stage); return; }
    if (act === "back") { swGo(SW.stage - 1); return; }
    if (act === "next") { swNext(); return; }
    if (act === "retry-save") { if (SW.saveRetry) { var fn = SW.saveRetry; swSaveQuiet("retry", fn); } return; }
    if (act === "jump") { swGo(parseInt(el.getAttribute("data-i"), 10)); return; }
    if (act === "web-read") { swWebRead(); return; }
    if (act === "web-apply") { swWebApply(); return; }
    if (act === "web-main") { SW.web.main = v; swRender(); return; }
    if (act === "cat") { swPickCat(v, false).then(function() { swRender(); }); swRender(); return; }
    if (act === "sw") { var c = el.getAttribute("data-c") || null, k = el.getAttribute("data-k"); SW.doc[k] = c; var body = {}; body[k] = c; swSaveQuiet("color", function() { return swDocPut(body); }); swRender(); return; }
    if (act === "entity") { var vv = swCs().values; vv.business_entity_type = v === "llc" ? "limited liability company" : "sole proprietorship"; swSaveQuiet("entity", function() { return gmApi("wizard/business", { method: "PUT", body: { entity: v } }); }); swRender(); return; }
    if (act === "lang") { if ((v === "en") !== isEn() && typeof toggleLang === "function") {
        // The estimate screens redraw on a language change. Give them back their own state first, take ours after.
        var keepS = gmDocSettings, keepD = gmDocDraft; gmDocSettings = null; gmDocDraft = null;
        try { toggleLang(); } catch (eL) { console.error("language switch: " + eL.message); }
        gmDocSettings = keepS; gmDocDraft = keepD;
      } swSaveQuiet("language", function() { return gmApi("wizard/business", { method: "PUT", body: { language: v } }); }); swRender(); return; }
    if (act === "sub") {
      var i = a.subs.indexOf(v); if (i > -1) { a.subs.splice(i, 1); } else { a.subs.push(v); }
      SW.licKey = ""; swSaveQuiet("work", function() { return gmApi("wizard/work", { method: "PUT", body: { cat: a.cat, subs: a.subs } }); }); swRender(); return;
    }
    if (act === "showlic") { a.lic_show = true; swAnswer({ lic_show: true }).catch(function() {}); swRender(); return; }
    if (act === "addlic") { var L = SW.doc.license_numbers || []; if (!L.length) { L = [""]; } L.push(""); SW.doc.license_numbers = L; swRender(); return; }
    if (act === "rmlic") { var L2 = SW.doc.license_numbers || []; L2.splice(parseInt(el.getAttribute("data-i"), 10), 1); SW.doc.license_numbers = L2; swSaveLic(); swRender(); return; }
    if (act === "day") {
      var b = swBk(), dv = parseInt(v, 10), ix = b.days.indexOf(dv), days = b.days.slice();
      if (ix > -1) { if (days.length > 1) { days.splice(ix, 1); } } else { days.push(dv); }
      SW.bk = Object.assign({}, SW.bk, { work_days: days.sort() }); swHoursSave(); swRender(); return;
    }
    if (act === "step") { swSetStep(el.getAttribute("data-id"), parseInt(el.getAttribute("data-d"), 10)); return; }
    if (act === "pay") {
      var pm = Object.assign({}, SW.doc.payment_methods || {});
      if (Object.prototype.hasOwnProperty.call(pm, v)) { delete pm[v]; } else { pm[v] = ""; }
      SW.doc.payment_methods = pm; swPaySave(); swRender(); return;
    }
    if (act === "stripe-connect") { swStripeConnect(); return; }
    if (act === "stripe-refresh") { swLoadStripe(true); return; }
    if (act === "stripe-reaccept") {
      swSaveQuiet("reaccept", function() { return gmApi("stripe/reaccept", { method: "POST", body: { accepted: true, language: isEn() ? "en" : "pt" } }).then(function() { SW.reaccept = false; swLoadStripe(true); }); }); return;
    }
    if (act === "tap-help") { swFlush(); swSaveQuiet("stage", function() { return swStageSave(6); }).then(function() { window.location.href = "help.html"; }); return; }
    if (act === "ins") { var iv = swCs().values; iv[el.getAttribute("data-k")] = v; var ib = {}; ib[el.getAttribute("data-k")] = v; swHowSave({ local: {}, server: { insurance: ib } }); swRender(); return; }
    if (act === "lawyer") { SW.lawyer = v; swRender(); return; }
    if (act === "own-confirm") {
      var tpl = (SW.ownTpl || [])[0]; if (!tpl) { return; }
      swSaveQuiet("own-confirm", function() { return gmApi("contract-own-templates/" + encodeURIComponent(tpl.id) + "/reviewed", { method: "POST" }).then(function() { SW.ownTpl = null; return gmApi("contract-settings").then(function(d) { SW.cs = d; }); })}).then(function() { swRender(); }); return;
    }
    if (act === "tt-connect") { SW.ttBusy = true; swFlush(); swSave("before-thumbtack", function() { return swStageSave(8); }).then(function() { return gmApi("thumbtack/connect", { method: "POST", body: {} }); }).then(function(d) { if (!d || !d.url || String(d.url).indexOf("https://") !== 0) { throw new Error(swT("O Thumbtack não respondeu.", "Thumbtack did not answer.")); } if (gmInApp()) { apexOpenExternal(d.url); SW.ttBusy = false; swRender(); } else { window.location.href = d.url; } }).catch(function(e) { SW.ttBusy = false; SW.saveErr = e.message; swStatusRender(); swRender(); }); return; }
    if (act === "booking") { var bk = SW.bk || {}, cur = bk.exists !== undefined ? !!bk.enabled : true; SW.bk = Object.assign({}, bk, { enabled: !cur, exists: true }); swSaveQuiet("booking", function() { return gmApi("booking-settings", { method: "PUT", body: { enabled: !cur } }); }); swRender(); return; }
    if (act === "reflang") { a.ref_lang = v; swSaveQuiet("reflang", function() { return apiFetch("/api/clients/" + clientId + "/referral-settings", { method: "PUT", body: { language: v } }).then(function(r) { if (!r.ok) { throw new Error("HTTP " + r.status); } return gmApi("wizard", { method: "PUT", body: { answers: { ref_lang: v } } }); }); }); swRender(); return; }
    if (act === "team") { a.team_mode = v; swAnswer({ team_mode: v }).catch(function() {}); swRender(); return; }
    if (act === "signer-pick") { SW.signerDraft = { name: el.getAttribute("data-n"), phone: "" }; SW.signerErr = ""; swRender(); return; }
    if (act === "signer-rm") { var sl = (swCs().signers || []).slice(); sl.splice(parseInt(el.getAttribute("data-i"), 10), 1); swSignersSave(sl); return; }
    if (act === "signer-add") {
      var sd = SW.signerDraft || { name: "", phone: "" };
      if (!String(sd.name).trim()) { SW.signerErr = swT("Escreva o nome.", "Type the name."); swRender(); return; }
      if (String(sd.phone).replace(/\D/g, "").length < 10) { SW.signerErr = swT("Escreva o telefone com 10 números.", "Type the phone number with 10 digits."); swRender(); return; }
      var nl = (swCs().signers || []).slice(); nl.push({ name: String(sd.name).trim(), phone: String(sd.phone).trim() }); SW.signerDraft = { name: "", phone: "" }; SW.signerErr = ""; swSignersSave(nl); return;
    }
    if (act === "copybio") { var inp = swEl("swBioLink"); try { navigator.clipboard.writeText(inp.value); SW.copied = true; } catch (e) { if (inp) { inp.select(); } } swRender(); return; }
    if (act === "cn-ask") { SW.reqOpen = true; SW.reqErr = ""; swRender(); var rn = swEl("swReqNote"); if (rn && rn.focus) { rn.focus(); } return; }
    if (act === "cn-send") {
      if (SW.reqBusy) { return; }
      SW.reqBusy = true; SW.reqErr = ""; swRender();
      gmApi("wizard/contract-request", { method: "POST", body: { note: SW.reqNote || "" } }).then(function(d) {
        SW.reqDone = true; SW.reqOpen = false;
        if (d && d.would_send) { console.log("[test run] would send: " + JSON.stringify(d.would_send)); }
      }).catch(function(e) { SW.reqErr = e.message; }).then(function() { SW.reqBusy = false; swRender(); });
      return;
    }
    if (act === "clauses") { swOpenClauses(); return; }
    if (act === "lawyer-pdf") { swLawyerPdf(); return; }
  });
  function onField(ev) {
    var t = ev.target; if (!t || !t.getAttribute) { return; }
    var bind = t.getAttribute("data-bind"); if (!bind) { return; }
    var d = SW.doc, a = SW.d ? SW.d.answers : null;
    if (bind === "reqnote") { SW.reqNote = t.value; return; }
    if (bind === "weburl") { SW.web.url = t.value; return; }
    if (bind === "sname" || bind === "sphone") { SW.signerDraft = SW.signerDraft || { name: "", phone: "" }; SW.signerDraft[bind === "sname" ? "name" : "phone"] = t.value; return; }
    if (bind === "webuse") { SW.web.use[t.getAttribute("data-k")] = t.checked ? 1 : 0; return; }
    if (bind === "logofile") { if (t.files && t.files[0]) { swUploadLogo(t.files[0]); t.value = ""; } return; }
    if (bind === "name") { d.legal_name = t.value; var nv = t.value; swTyped("name", function() { swSaveQuiet("name", function() { return swDocPut({ legal_name: nv }); }); }); swRefreshHero(); swGate(); return; }
    if (bind === "review") { d.google_review_link = t.value; var rv = t.value; swTyped("review", function() { swSaveQuiet("review", function() { return swDocPut({ google_review_link: rv || null }); }); }); return; }
    if (bind === "color") { var ck = t.getAttribute("data-k"); d[ck] = t.value; if (ev.type === "change") { var cb = {}; cb[ck] = t.value; swSaveQuiet("color", function() { return swDocPut(cb); }); swRender(); } else { swRefreshHero(); } return; }
    if (bind === "state") { swCs().values.business_state = t.value; SW.licKey = ""; swSaveQuiet("state", function() { return gmApi("wizard/business", { method: "PUT", body: { state: t.value } }); }); swGate(); return; }
    if (bind === "phone" || bind === "address") { d[bind] = t.value; var pv = t.value, pb = {}; pb[bind] = pv; swTyped("biz-" + bind, function() { swSaveQuiet("business", function() { return gmApi("wizard/business", { method: "PUT", body: pb }); }); }); swGate(); return; }
    if (bind === "dba") { swCs().values.business_dba = t.value; var dv = t.value; swTyped("dba", function() { swSaveQuiet("dba", function() { return gmApi("wizard/business", { method: "PUT", body: { dba: dv } }); }); }); return; }
    if (bind === "other") { a.other_text = t.value; var ov = t.value; swTyped("other", function() { swSaveQuiet("other", function() { return gmApi("wizard/work", { method: "PUT", body: { cat: "other", subs: [], other_text: ov } }).then(function() { if (ov.trim().length > 2) { return gmApi("wizard/other-work", { method: "POST", body: { text: ov } }); } }); }); }); swGate(); return; }
    if (bind === "lic") { var li = parseInt(t.getAttribute("data-i"), 10), L = (d.license_numbers && d.license_numbers.length) ? d.license_numbers.slice() : [""]; L[li] = t.value; d.license_numbers = L; swTyped("lic", swSaveLic); swGate(); return; }
    if (bind === "nolic") { d.license_not_required = t.checked; var nb = { license_not_required: t.checked }; swSaveQuiet("nolic", function() { return swDocPut(nb); }).then(function() { swRefreshStatus(); }); swRender(); return; }
    if (bind === "terms") { d.default_terms_days = parseInt(t.value, 10); var tv = d.default_terms_days; swSaveQuiet("terms", function() { return swDocPut({ default_terms_days: tv }); }); return; }
    if (bind === "sched") { a.schedule_pick = t.value; swAnswer({ schedule_pick: t.value }).catch(function() {}); return; }
    if (bind === "cardlink") { var pm = Object.assign({}, d.payment_methods || {}); pm.card_link = t.value; d.payment_methods = pm; swPaySave(); return; }
    if (bind === "stripeagree") { SW.stripeAgree = t.checked; swRender(); return; }
    if (bind === "reaccept") { SW.reaccept = t.checked; swRender(); return; }
    if (bind === "how") { swHowChange(t.getAttribute("data-id"), t.value); return; }
    if (bind === "ownfile") { if (t.files && t.files[0]) { swOwnUpload(t.files[0]); t.value = ""; } return; }
  }
  root.addEventListener("input", onField);
  root.addEventListener("change", onField);
}
function swSaveLic() {
  var L = (SW.doc.license_numbers || []).map(function(x) { return String(x).trim(); }).filter(Boolean);
  swSaveQuiet("license", function() { return swDocPut({ license_numbers: L }); }).then(function() { swRefreshStatus(); });
}
function swHowChange(id, val) {
  var map = {
    warranty: function() { var n = parseInt(val, 10); return { local: { warranty: n }, server: { warranty_months: n } }; },
    permits: function() { return { local: { permits: val }, server: { permits: val } }; },
    debris: function() { return { local: { debris: val }, server: { debris: val } }; },
    materials: function() { return { local: { materials: val }, server: { materials: val } }; },
    photos: function() { return { local: { photos: val }, server: { photos: val } }; },
    title: function() { return { local: { title: val }, server: { signer_title: val } }; },
    source: function() { return { local: {}, server: { source: val } }; }
  };
  if (!map[id]) { return; }
  var p = map[id]();
  if (id === "source") {
    // Choosing "My own contract" only saves once the upload is confirmed. Until then the template stays Apex's.
    if (val === "client") { swCs().source = "client"; swRender(); return; }
    swCs().source = "apex";
  }
  swHowSave(p);
  if (id === "source") { swRender(); }
}
function swOwnUpload(file) {
  if (!SW.lawyer) { return; }
  if (file.size > 10 * 1024 * 1024) { SW.ownErr = swT("Arquivo muito grande (limite 10 MB).", "File too large (10 MB limit)."); swRender(); return; }
  SW.ownBusy = true; SW.ownErr = ""; swRender();
  var fd = new FormData(); fd.append("file", file); fd.append("lawyer_reviewed", SW.lawyer);
  gmApi("contract-own-templates", { method: "POST", formData: fd }).then(function() { SW.ownTpl = null; }).catch(function(e) { SW.ownErr = e.message; }).then(function() { SW.ownBusy = false; swRender(); });
}
function swSignersSave(list) {
  swCs().signers = list;
  swSaveQuiet("signers", function() { return gmApi("contract-settings", { method: "PUT", body: { signers: list } }); });
  swRender();
}
// The existing contract clause screen: Settings, Contracts. The standard choice
// is marked there and the other options are visible.
function swOpenClauses() {
  swFlush();
  swSaveQuiet("stage", function() { return swStageSave(11); }).then(function() {
    swClose();
    if (typeof switchTab === "function") { try { switchTab("gmestimates"); } catch (e) {} }
    // The clause screen draws after its data loads, so look for it for a few seconds.
    var tries = 0, look = setInterval(function() {
      var c = document.getElementById("gmConCleaningAreas") || document.getElementById("gmConSettingsCard"); tries++;
      if (c && c.scrollIntoView) { c.scrollIntoView({ block: "start" }); }
      if ((c && tries > 3) || tries > 20) { clearInterval(look); }
    }, 500);
  });
}
// The lawyer PDF: the whole standard contract with the owner's own values
// filled in, from the server's PDF path.
function swLawyerPdf() {
  if (SW.pdfBusy) { return; }
  SW.pdfBusy = true; SW.pdfErr = ""; swRender();
  gmApi("wizard/lawyer-pdf", { method: "POST", body: {} }).then(function(d) {
    if (d && d.available === false) { SW.d.contract = { available: false, kinds: [] }; return; }
    if (!d || !d.url) { throw new Error(swT("O PDF não ficou pronto.", "The PDF was not ready.")); }
    if (gmInApp()) { apexOpenExternal(d.url); } else { var lk = document.createElement("a"); lk.href = d.url; lk.target = "_blank"; lk.rel = "noopener"; document.body.appendChild(lk); lk.click(); document.body.removeChild(lk); }
  }).catch(function(e) { SW.pdfErr = e.message; }).then(function() { SW.pdfBusy = false; swRender(); });
}

// ── The "Finish your setup" card, and the automatic open for new sign ups ─
function swFinishCardRender() {
  var host = swEl("swFinishHost");
  if (!host) {
    var main = document.querySelector(".portal-main") || document.querySelector("main") || document.body;
    host = document.createElement("div"); host.id = "swFinishHost";
    main.insertBefore(host, main.firstChild);
  }
  var info = SW.summary;
  if (!info || !info.missing || !info.missing.length || SW.open) { host.innerHTML = ""; return; }
  var names = info.missing.map(function(k) { var s = SW_STAGES.filter(function(x) { return x.key === k; })[0]; return s ? swT(s.pt, s.en) : k; });
  host.innerHTML = '<div class="sw-finish-card"><b>' + swT("Termine a sua configuração", "Finish your setup") + '</b><p>' + swT("Falta: ", "Still to do: ") + swEsc(names.join(", ")) + '.</p><button type="button" id="swFinishBtn" data-help="setup-wizard#review#1">' + swT("Continuar", "Continue") + '</button></div>';
  var btn = swEl("swFinishBtn");
  if (btn) { btn.onclick = function() { var first = info.missing[0], idx = SW_STAGES.map(function(s) { return s.key; }).indexOf(first); swOpen(idx + 1); }; }
}
function swInit() {
  if (typeof gmApi !== "function" || typeof clientId === "undefined" || !clientId) { return; }
  if (typeof isSeller === "function" && isSeller()) { return; }
  if (typeof isStaffSession === "function" && isStaffSession() && !(typeof PREVIEW_AS !== "undefined" && PREVIEW_AS)) { return; }
  swPatchHeroRepaint();
  var qs = (window.location.search || "");
  var fromStripe = /[?&]stripe=(return|refresh)/.test(qs);
  gmApi("wizard").then(function(d) {
    SW.summary = d; swNoneFlag(d.contract);
    swFinishCardRender();
    if (fromStripe) {
      try { history.replaceState(null, "", window.location.pathname); } catch (e) {}
      SW.stripe = null; swOpen(6);
    } else if (d.auto) { swOpen(d.stage || 1); }
  }).catch(function(e) { console.error("wizard init: " + e.message); });
}
// Opens the contract settings stage when a contract is attempted without settings.
function swNeedContractSettings() { swOpen(7); }

// Create the overlay once the page has loaded (init calls ride on window.onload).
var swPrevOnload = window.onload;
window.onload = function() { if (typeof swPrevOnload === "function") { swPrevOnload.apply(this, arguments); } swRoot(); };
