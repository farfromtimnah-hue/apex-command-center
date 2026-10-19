// Passkey login pages: index.html's passkey button (native and browser
// branches), invite-login.html's states, the portal's People and access card
// and the invite WhatsApp message. Functions are cut from the real files
// (never rewritten copies) and run against fakes: no network, no real
// Capacitor, no real WebAuthn.
//
//   node scripts/test-passkey-pages.mjs
import { readFileSync } from "node:fs";
import { build as buildWorker, baseStubs } from "./fixtures/d1-shim.mjs";

let fail = 0, pass = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (c) { pass++; } else { fail++; } };
const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");

const INDEX = read("index.html"), BRIDGE = read("native-bridge.js"), INVITE = read("invite-login.html"),
  PORTAL = read("portal.html"), CLIENT = read("client.html");

// A function at any indentation, to its closing brace at the same indentation.
function fnSrc(name, src) {
  const re = new RegExp("\\n([ \\t]*)(async )?function " + name + "\\(");
  const m = re.exec(src);
  if (!m) { throw new Error("function not found: " + name); }
  const start = m.index + 1;
  const end = src.indexOf("\n" + m[1] + "}", start);
  return src.slice(start, end + m[1].length + 2);
}
// A "var NAME = <expr>;" at any indentation, by bracket matching.
function varSrc(name, src) {
  const re = new RegExp("\\n[ \\t]*var " + name + " =");
  const m = re.exec(src);
  if (!m) { throw new Error("var not found: " + name); }
  let i = m.index + m[0].length, depth = 0, q = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === "\\") { i++; continue; } if (c === q) { q = null; } continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === "(" || c === "[" || c === "{") { depth++; }
    if (c === ")" || c === "]" || c === "}") { depth--; }
    if (c === ";" && depth === 0) { break; }
  }
  return src.slice(m.index + 1, i + 1);
}
function make(srcs, stubs, names, vars) {
  const stubNames = Object.keys(stubs);
  const body = (vars || []).map(([n, s]) => varSrc(n, s)).join("\n") + "\n" +
    names.map(([n, s]) => fnSrc(n, s)).join("\n") + "\nreturn { " + names.map(([n]) => n).join(", ") + " };";
  return new Function(...stubNames, body)(...stubNames.map((k) => stubs[k]));
}
const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle() { for (let i = 0; i < 10; i++) { await tick(); } }

function el(id) {
  return { id, hidden: false, disabled: false, innerHTML: "", textContent: "", className: "", value: "", dataset: {}, focus() {} };
}
function jsonRes(status, data) { return { ok: status < 300, status, json: async () => data }; }

// ── index.html + native-bridge.js ─────────────────────────────────────────
function indexWorld(o) {
  const els = { passkeyLoginBtn: el("passkeyLoginBtn"), statusMsg: el("statusMsg") };
  els.passkeyLoginBtn.hidden = true;
  const calls = { fetch: [], plugin: [], get: [], stored: {}, href: null };
  const plugin = o.plugin === null ? null : {
    isSupported: async () => ({ supported: o.supported !== false }),
    signIn: async (a) => { calls.plugin.push(a); if (o.pluginError) { const e = new Error("x"); e.code = o.pluginError; throw e; } return { credential: { id: "cid", rawId: "cid", type: "public-key", response: { authenticatorData: "YQ", clientDataJSON: "Yg", signature: "Yw", userHandle: "ZA" } } }; }
  };
  const win = {
    Capacitor: o.native ? { isNativePlatform: () => true, Plugins: { ApexPasskey: plugin } } : undefined,
    PublicKeyCredential: o.noWebAuthn ? undefined : function () {},
    location: { set href(v) { calls.href = v; }, get href() { return calls.href; } }
  };
  const nav = {
    credentials: {
      get: async (arg) => {
        calls.get.push(arg);
        if (o.getError) { const e = new Error("no"); e.name = o.getError; throw e; }
        const buf = (s) => new TextEncoder().encode(s).buffer;
        return { id: "bid", rawId: buf("bid"), type: "public-key", response: { authenticatorData: buf("a"), clientDataJSON: buf("b"), signature: buf("c"), userHandle: buf("d") }, getClientExtensionResults: () => ({}) };
      }
    }
  };
  const fetch = async (url, init) => {
    calls.fetch.push({ url, init });
    if (/\/status$/.test(url)) { return jsonRes(200, { enabled: o.enabled !== false }); }
    if (/\/start$/.test(url)) { return jsonRes(200, { options: { challenge: "Y2hhbGxlbmdl", rpId: "apex.resonateai.online" }, rp_id: "apex.resonateai.online" }); }
    if (/\/finish$/.test(url)) { return o.finishFail ? jsonRes(401, { error_pt: "Não foi possível entrar com passkey.", error_en: "Could not sign in with passkey." }) : jsonRes(200, { token: "capt_abc", client_id: "c1", client_name: "Acme", must_change_password: false }); }
    return jsonRes(404, {});
  };
  const document = {
    getElementById: (id) => els[id] || null,
    body: { classList: { contains: (c) => c === (o.lang === "en" ? "lang-en" : "lang-pt") } }
  };
  const stubs = {
    window: win, navigator: nav, fetch, document, WORKER_URL: "https://w.test",
    localStorage: { setItem: (k, v) => { calls.stored[k] = v; } },
    atob: (s) => Buffer.from(s, "base64").toString("binary"), btoa: (s) => Buffer.from(s, "binary").toString("base64")
  };
  const F = make([], stubs, [
    ["apexIsNative", BRIDGE], ["apexPasskeyPlugin", BRIDGE], ["apexB64urlToBuf", BRIDGE], ["apexBufToB64url", BRIDGE],
    ["apexPasskeySupported", BRIDGE], ["apexPasskeyError", BRIDGE], ["apexPasskeyGetAssertion", BRIDGE],
    ["passkeyText", INDEX], ["setStatus", INDEX], ["passkeyInitButton", INDEX], ["handlePasskeyLogin", INDEX]
  ], [["PASSKEY_ERROR_TEXT", INDEX]]);
  return { F, els, calls };
}

{
  let w = indexWorld({ enabled: false });
  await w.F.passkeyInitButton();
  ok(w.els.passkeyLoginBtn.hidden === true, "index: passkey button hidden when the status route says disabled");
  w = indexWorld({ enabled: true, native: true, supported: false });
  await w.F.passkeyInitButton();
  ok(w.els.passkeyLoginBtn.hidden === true, "index: hidden in the app when the plugin says unsupported");
  w = indexWorld({ enabled: true, native: true, plugin: null });
  await w.F.passkeyInitButton();
  ok(w.els.passkeyLoginBtn.hidden === true, "index: hidden in the app when the plugin is missing (older build)");
  w = indexWorld({ enabled: true, native: true, supported: true });
  await w.F.passkeyInitButton();
  ok(w.els.passkeyLoginBtn.hidden === false, "index: shown in the app when enabled and supported");
  w = indexWorld({ enabled: true });
  await w.F.passkeyInitButton();
  ok(w.els.passkeyLoginBtn.hidden === false, "index: shown in a browser when enabled");
  ok(/class="btn-client-login btn-passkey" id="passkeyLoginBtn" hidden/.test(INDEX) && /Entrar com passkey/.test(INDEX) && /Sign in with passkey/.test(INDEX),
    "index: the button ships hidden in the markup, bilingual, in the existing outline style");
  ok(INDEX.indexOf('id="passkeyLoginBtn"') > INDEX.indexOf('id="clientLoginForm"'), "index: the button sits below the existing login boxes");

  // Native branch.
  w = indexWorld({ enabled: true, native: true });
  await w.F.handlePasskeyLogin();
  ok(w.calls.plugin.length === 1 && w.calls.plugin[0].rpId === "apex.resonateai.online" && w.calls.plugin[0].challenge === "Y2hhbGxlbmdl", "index (app): calls ApexPasskey.signIn with rpId and the base64url challenge from start");
  const fin = w.calls.fetch.filter((c) => /\/finish$/.test(c.url))[0];
  const sent = fin && JSON.parse(JSON.parse(fin.init.body).credential);
  ok(sent && sent.id === "cid" && sent.response.signature === "Yw", "index (app): posts the plugin's credential to /finish as a JSON string");
  ok(w.calls.stored.apex_client_token === "capt_abc" && w.calls.stored.apex_client_id === "c1" && w.calls.stored.apex_client_name === "Acme" && w.calls.href === "portal.html", "index: stores the session exactly like handleClientLogin and opens portal.html");
  ok(w.calls.get.length === 0, "index (app): navigator.credentials.get is NOT used inside the app");

  // Browser branch.
  w = indexWorld({ enabled: true });
  await w.F.handlePasskeyLogin();
  ok(w.calls.get.length === 1 && w.calls.get[0].publicKey.rpId === "apex.resonateai.online" && w.calls.get[0].publicKey.challenge instanceof ArrayBuffer && new TextDecoder().decode(w.calls.get[0].publicKey.challenge) === "challenge", "index (browser): navigator.credentials.get with the decoded challenge and rpId");
  const fin2 = JSON.parse(JSON.parse(w.calls.fetch.filter((c) => /\/finish$/.test(c.url))[0].init.body).credential);
  ok(fin2.rawId === "Ymlk" && fin2.response.authenticatorData === "YQ" && fin2.response.clientDataJSON === "Yg" && fin2.type === "public-key", "index (browser): credential sent base64url-encoded");
  ok(w.calls.plugin.length === 0 && w.calls.href === "portal.html", "index (browser): no plugin call, signs in");

  // No passkey on the device.
  w = indexWorld({ enabled: true, native: true, pluginError: "no_credentials" });
  await w.F.handlePasskeyLogin();
  ok(w.els.statusMsg.textContent === "Nenhuma passkey neste aparelho. Peça um novo link de convite." && w.calls.href === null, "index (app, PT): no passkey -> 'Nenhuma passkey neste aparelho. Peça um novo link de convite.'");
  w = indexWorld({ enabled: true, getError: "NotAllowedError", lang: "en" });
  await w.F.handlePasskeyLogin();
  ok(w.els.statusMsg.textContent === "No passkey on this device. Ask for a new invite link.", "index (browser, EN): no passkey -> 'No passkey on this device. Ask for a new invite link.'");
  ok(w.els.passkeyLoginBtn.disabled === false, "index: the button is usable again after a failure");
  w = indexWorld({ enabled: true, finishFail: true, lang: "en" });
  await w.F.handlePasskeyLogin();
  ok(w.els.statusMsg.textContent === "Could not sign in with passkey." && !w.calls.stored.apex_client_token, "index: a server refusal shows its own message and stores nothing");
}

// ── invite-login.html ─────────────────────────────────────────────────────
const INVITE_IDS = ["viewLoading", "viewInvalid", "viewUnsupported", "viewInvite", "greeting", "businessLine", "roleChip", "maskedLine",
  "stepSend", "stepCode", "stepPasskey", "inviteStatus", "sendBtn", "resendBtn", "codeInput", "verifyBtn", "passkeyBtn"];
function inviteWorld(o) {
  const els = {};
  INVITE_IDS.forEach((id) => { els[id] = el(id); });
  const cls = new Set(["lang-pt"]);
  const calls = { fetch: [] };
  const fetch = async (url, init) => {
    calls.fetch.push({ url, init });
    if (/\/info\?t=/.test(url)) {
      return o.info ? jsonRes(200, o.info) : jsonRes(404, { error: "Not found" });
    }
    return jsonRes(404, {});
  };
  const stubs = {
    window: { PublicKeyCredential: o.noWebAuthn ? undefined : function () {}, location: { search: o.search === undefined ? "?t=" + "a".repeat(43) : o.search } },
    navigator: { language: o.navLang || "pt-BR", credentials: { create: async () => null } },
    document: { getElementById: (id) => els[id] || null, body: { classList: { contains: (c) => cls.has(c), add: (c) => cls.add(c), remove: (...cs) => cs.forEach((c) => cls.delete(c)) } }, documentElement: {} },
    fetch, setInterval: () => 1, clearInterval: () => {}, encodeURIComponent, decodeURIComponent
  };
  const F = make([], stubs, ["inviteIsEn", "inviteDefaultLang", "inviteSetLang", "inviteToggleLang", "inviteEsc", "inviteBi", "inviteShow",
    "inviteStatus", "inviteStep", "inviteRenderInfo", "inviteRenderResend", "inviteStartCooldown", "inviteSupported", "inviteInit"].map((n) => [n, INVITE]),
    [["WORKER_URL", INVITE], ["inviteToken", INVITE], ["inviteInfo", INVITE], ["inviteOptions", INVITE], ["inviteCooldownTimer", INVITE], ["inviteCooldownLeft", INVITE]]);
  return { F, els, cls, calls };
}
const visible = (els, id) => els[id].hidden === false;
const INFO = { name: "Pat", business_name: "Acme Pools", role_label: { pt: "Equipe sem acesso ao financeiro", en: "Staff without finance access" }, masked_phone: "••• •••• 1234", expires_at: "2026-10-21T00:00:00Z", code_sent: false, resend_in: 0 };
{
  let w = inviteWorld({ info: INFO, navLang: "pt-BR" });
  await w.F.inviteInit();
  ok(visible(w.els, "viewInvite") && !visible(w.els, "viewInvalid") && w.cls.has("lang-pt"), "invite: valid link shows the invite, Portuguese for a pt device");
  ok(/Olá, Pat!/.test(w.els.greeting.innerHTML) && /Hi, Pat!/.test(w.els.greeting.innerHTML), "invite: greeting by first name in both languages");
  ok(/Acme Pools/.test(w.els.businessLine.innerHTML) && /Equipe sem acesso ao financeiro/.test(w.els.roleChip.innerHTML) && /Staff without finance access/.test(w.els.roleChip.innerHTML), "invite: business name and role label (PT and EN)");
  ok(w.els.maskedLine.innerHTML.indexOf("Vamos enviar um código por SMS para ••• •••• 1234") !== -1 && w.els.maskedLine.innerHTML.indexOf("We will text a code to ••• •••• 1234") !== -1, "invite: 'Vamos enviar um código por SMS para ••• •••• 1234' / 'We will text a code to ••• •••• 1234'");
  ok(visible(w.els, "stepSend") && !visible(w.els, "stepCode") && !visible(w.els, "stepPasskey"), "invite: starts at the send-code step");
  w = inviteWorld({ info: INFO, navLang: "en-US" });
  await w.F.inviteInit();
  ok(w.cls.has("lang-pt") && !w.cls.has("lang-en"), "invite: Portuguese first even on a non-pt device language");
  w.F.inviteToggleLang();
  ok(w.cls.has("lang-en"), "invite: the toggle switches language");
  for (const label of ["expired", "used", "replaced", "bad token"]) {
    const x = inviteWorld({ info: null });
    await x.F.inviteInit();
    ok(visible(x.els, "viewInvalid") && !visible(x.els, "viewInvite"), "invite: " + label + " link (server 404) shows the friendly expired page");
  }
  const x = inviteWorld({ info: null, search: "" });
  await x.F.inviteInit();
  ok(visible(x.els, "viewInvalid") && x.calls.fetch.length === 0, "invite: no ?t= shows the expired page without calling the server");
  ok(INVITE.indexOf("Este link expirou ou já foi usado. Peça um novo link para quem convidou você.") !== -1 &&
     INVITE.indexOf("This link has expired or was already used. Ask whoever invited you for a new link.") !== -1, "invite: the expired page text, both languages");
  const u = inviteWorld({ info: INFO, noWebAuthn: true });
  await u.F.inviteInit();
  ok(visible(u.els, "viewUnsupported") && /Safari ou no Chrome/.test(INVITE) && /Safari or Chrome, on a phone or laptop/.test(INVITE), "invite: a browser without passkeys is told to open the link in Safari or Chrome on a phone or laptop");
  ok(/autocomplete="one-time-code"/.test(INVITE) && /inputmode="numeric"/.test(INVITE) && /Criar sua passkey/.test(INVITE) && /Create your passkey/.test(INVITE), "invite: 6-digit one-time-code input and the 'Criar sua passkey / Create your passkey' step");
  ok(INVITE.indexOf("localStorage.setItem(\"apex_client_token\", r.data.token)") !== -1 && INVITE.indexOf("window.location.href = \"portal.html\"") !== -1, "invite: stores the session like handleClientLogin and opens portal.html");
}

// ── portal.html People and access ──────────────────────────────────────────
{
  const owner = make([], { isEn: () => false, escHtml: (s) => String(s), formatDate: (s) => s, window: {}, gmToast: () => {} },
    [["peopleRoleChoices", PORTAL]], [["PEOPLE_ROLES", PORTAL]]);
  ok(owner.peopleRoleChoices(true).length === 4 && owner.peopleRoleChoices(false).length === 3 && owner.peopleRoleChoices(false).every((r) => r.key !== "partner"), "people: role choices 4 for an owner, 3 for a partner (no Partner)");
  // Render the whole card both ways.
  const src = varSrc("PEOPLE_ROLES", PORTAL) + "\n" + varSrc("peopleState", PORTAL) + "\n" + varSrc("lossState", PORTAL) + "\n" +
    ["peopleRoleChoices", "peopleRoleLabel", "peopleStatusChip", "peopleCardHtml", "peopleLinkCardHtml", "peopleSendWhatsapp",
      "lossCardHtml", "lossWhenLabel"].map((n) => fnSrc(n, PORTAL)).join("\n") +
    "\nreturn { st: function() { return peopleState; }, html: peopleCardHtml, send: peopleSendWhatsapp, lossSt: function() { return lossState; } };";
  const opened = [];
  const P = new Function("isEn", "escHtml", "formatDate", "window", "gmToast", src)(() => false, (s) => String(s == null ? "" : s), (s) => s, { open: (u) => { opened.push(u); return {}; } }, () => {});
  P.st().list = [{ id: "p1", name: "Pat", role: "staff", status: "active", masked_phone: "••• •••• 1234", last_passkey_login_at: "2026-10-18T10:00:00Z" }];
  P.st().canPartner = true;
  const hOwner = P.html();
  P.st().canPartner = false;
  const hPartner = P.html();
  const count = (h) => (h.match(/data-role="/g) || []).length;
  ok(count(hOwner) === 4 && count(hPartner) === 3 && hPartner.indexOf('data-role="partner"') === -1, "people card: 4 role buttons for the owner, 3 for a partner");
  ok(/Pessoas e acessos/.test(hOwner) && /Sócio\(a\) ou assistente executivo\(a\)/.test(hOwner) && /Equipe com acesso ao financeiro/.test(hOwner) && /Equipe sem acesso ao financeiro/.test(hOwner) && /Vendedor\(a\)/.test(hOwner), "people card: Portuguese labels with accents");
  ok(/Estados Unidos \(\+1\)/.test(hOwner) && /Brasil \(\+55\)/.test(hOwner) && (hOwner.match(/<option /g) || []).length === 2, "people card: country selector limited to +1 and +55");
  // Change A/C wording: the plain re-invite button became "Novo aparelho
  // (manter os atuais)" (purpose 'add'), and the single device-loss button
  // ("Aparelho perdido, trocado ou saída") replaced a separate "new link"
  // action for the lost/replaced/leaving cases.
  ok(/Ativo/.test(hOwner) && /Novo aparelho \(manter os atuais\)/.test(hOwner) && /Aparelho perdido, trocado ou saída/.test(hOwner) &&
    /Desativar/.test(hOwner) && /1234/.test(hOwner), "people card: status chip, masked phone, add-device/loss and disable buttons");

  // The WhatsApp message, built by the REAL Worker wording.
  const W = buildWorker(["passkeyInviteMessage", "passkeyInviteMessageFor", "passkeyFirstName"], ["PASSKEY_APP_STORE_URL"], baseStubs);
  const link = "https://apex.resonateai.online/invite-login.html?t=" + "b".repeat(43);
  const msg = W.passkeyInviteMessageFor(null, { name: "Pat Lee", inviter: "Maria", business: "Acme Pools", link }, false);
  P.st().lastInvite = { invite_url: link, message: msg, whatsapp_digits: "14075551234", person: { name: "Pat Lee" } };
  P.send();
  const u = new URL(opened[0]);
  const text = u.searchParams.get("text");
  ok(u.origin + u.pathname === "https://wa.me/14075551234", "WhatsApp: opens wa.me/<digits> of the person");
  ok(text.indexOf(link) !== -1 && /72 horas/.test(text) && /72 hours/.test(text), "WhatsApp: the message carries the link and the 72-hour note");
  ok(text.indexOf("apps.apple.com") === -1, "WhatsApp: not-ready wording has no app link");
  ok(/Copiar link/.test(P.html()) && /Enviar pelo WhatsApp/.test(P.html()), "people card: link card with 'Copiar link' and 'Enviar pelo WhatsApp'");
  ok(PORTAL.indexOf("var waTab = window.open(waUrl, \"_blank\");") !== -1 && fnSrc("peopleSendWhatsapp", PORTAL).indexOf(".then(") === -1, "WhatsApp: window.open is synchronous in the click (no await before it)");
  // client.html owner card uses the same synchronous open.
  ok(fnSrc("ownerInviteWhatsapp", CLIENT).indexOf(".then(") === -1 && /Enviar novo login \(link\)/.test(CLIENT) && /Send new login \(link\)/.test(CLIENT), "client.html: 'Enviar novo login (link)' button and a synchronous WhatsApp open");
}

// ── portal.html tabs per role (strip, dock and gear all build from portalTabs) ──
{
  const i = PORTAL.indexOf("var PORTAL_TABS = ["), j = PORTAL.indexOf("function populateMobileDock()", i);
  const g = {
    isLead: () => false, anyIncompleteAssigned: () => false, anyPendingEntries: () => false, gmAttentionBadgeCount: () => 0,
    ritmoDeprioritized: () => false, document: { addEventListener() {}, getElementById() { return null; } },
    window: { addEventListener() {}, innerWidth: 400 }, localStorage: { getItem: () => null, setItem() {} }, clientId: "c1"
  };
  let sellerFlag = false;
  g.isSeller = () => sellerFlag;
  const body = PORTAL.slice(i, j) + "\nreturn { setRole: function(r) { portalLoginRole = r; }, portalTabs: portalTabs, portalGearTabs: portalGearTabs, portalGroups: portalGroups, STAFF_TABS: STAFF_TABS, STAFF_FINANCE_TABS: STAFF_FINANCE_TABS, PORTAL_TABS: PORTAL_TABS };";
  const T = new Function(...Object.keys(g), body)(...Object.values(g));
  const tabs = () => T.portalTabs().map((t) => t.tab);
  T.setRole("client");
  const ownerTabs = tabs();
  ok(ownerTabs.indexOf("worksched") !== -1 && T.portalGearTabs().length === 1, "portal owner: full list with the gear (Ajustes)");
  T.setRole("partner");
  ok(JSON.stringify(tabs()) === JSON.stringify(ownerTabs) && T.portalGearTabs().length === 1, "portal partner: the owner's full list, gear shown");
  T.setRole("staff_finance");
  ok(tabs().indexOf("worksched") === -1 && T.portalGearTabs().length === 0 && tabs().indexOf("gmfinance") !== -1 && tabs().indexOf("gminvoices") !== -1, "portal staff_finance: no Settings / gear; Finance and Invoices kept");
  T.setRole("staff");
  ok(["worksched", "gmfinance", "gminvoices", "analytics", "goals"].every((k) => tabs().indexOf(k) === -1) && T.portalGearTabs().length === 0 && tabs().indexOf("gmcrm") !== -1 && tabs().indexOf("home") !== -1, "portal staff: no Settings, Finance, Invoices, Analytics or Ritmo; Pipeline and Home kept");
  ok(T.STAFF_FINANCE_TABS.length === T.PORTAL_TABS.length - 1, "STAFF_FINANCE_TABS is derived from PORTAL_TABS (one fewer: Ajustes)");
  ok(/var STAFF_FINANCE_TABS = PORTAL_TABS\.map/.test(PORTAL) && /var STAFF_TABS = STAFF_FINANCE_TABS\.filter/.test(PORTAL), "staff lists are derived by filter, not hand-copied");
  ok(/if \(isStaffSession\(\) && portalRoleTabList\(\)\.indexOf\(tab\) === -1/.test(PORTAL), "portal: a staff deep link to a hidden tab is redirected (switchTab safety net)");
  T.setRole("client");
  sellerFlag = true;
  ok(JSON.stringify(tabs()) === JSON.stringify(["gmcrm", "gmjobs", "gmpricing", "gmestimates", "gmcontracts", "gmcalendar", "documents"].filter((k) => ownerTabs.indexOf(k) !== -1)), "portal seller: unchanged SELLER_TABS");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
