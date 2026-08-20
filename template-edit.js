// Edit any WhatsApp template from the place you are about to send it.
//
// THIS FILE EXISTS BECAUSE OF A SCAR AND A COUNT. There are 8+ templates and
// the list keeps growing; until now the only way to change one was to leave
// what you were doing, open Settings, and scroll a long list to find it --
// at the exact moment you were trying to send a message somewhere else.
//
// TWO DOORS, ONE ROW:
//   1. a pencil next to the send button   -- the discoverable path
//   2. right-click ON the send button      -- the fast path once she knows it
// Both open this same editor, and this editor calls the SAME
// PUT /api/settings/templates/:key that the Settings page calls, writing the
// same message_templates row. No parallel storage, so no drift is possible.
//
// THE SETTINGS PAGE STAYS. Alice and Rafa were taught that is where templates
// are edited and that remains true. This is an ADDITIONAL door, never a
// replacement -- nothing here removes or bypasses that list.
//
// DELIBERATELY NOT BUILT: a long-press / force-touch path. iOS Safari has no
// reliable long-press event, 3D Touch is gone from modern iPhones, and
// Safari's own long-press gesture fires first and wins. Admin work happens
// almost entirely on a computer, and nobody wants to rewrite a message from a
// phone. A gesture that works on three devices out of five is worse than no
// gesture at all.
//
// STYLING: small focused modal, never a page. Alice's file is short,
// scannable, plain language, and NO RED -- errors state what happened without
// shouting.

(function (global) {
  "use strict";

  // ── Template metadata ────────────────────────────────────────────────────
  // Titles and token hints live HERE, not on each page, because this module is
  // what every page now shows. settings.html keeps its own copy for its own
  // list; if a key is ever added, it needs adding in both places, which is why
  // an unknown key degrades gracefully below rather than rendering blank.
  var TITLES = {
    session_in_person:      { pt: "Sessão Presencial",              en: "In-Person Session" },
    session_online:         { pt: "Sessão Online",                  en: "Online Session" },
    client_login:           { pt: "Acesso ao Portal do Cliente",    en: "Client Portal Access" },
    seller_login:           { pt: "Acesso do Vendedor",             en: "Seller Access" },
    invoice_send:           { pt: "Envio de Fatura",                en: "Invoice Send" },
    portal_help_request:    { pt: "Pedido de Ajuda (Portal)",       en: "Help Request (Portal)" },
    resource_send:          { pt: "Envio de Recurso",               en: "Resource Send" },
    partner_referral_share: { pt: "Compartilhar Link de Indicação", en: "Referral Link Share" },
    scheduling_send:        { pt: "Enviar horários",                en: "Send times" },
    scheduling_followup:    { pt: "Cobrar horários",                en: "Scheduling follow-up" },
    reminder_online:        { pt: "Lembrete Online",                en: "Online Reminder" },
    reminder_in_person:     { pt: "Lembrete Presencial",            en: "In-Person Reminder" }
  };

  // Only the tokens each key actually substitutes. Shown as chips so a
  // variable is not deleted by accident, which would silently ship a message
  // with a literal "{invoiceLink}" in it to a paying client.
  var TOKENS = {
    session_in_person:      ["{weekday}", "{date}", "{time}"],
    session_online:         ["{weekday}", "{date}", "{time}", "{meetLink}"],
    client_login:           ["{loginUrl}", "{username}", "{tempPassword}"],
    seller_login:           ["{sellerName}", "{loginUrl}", "{username}", "{tempPassword}"],
    invoice_send:           ["{invoiceLink}"],
    portal_help_request:    ["{clientName}", "{label}"],
    resource_send:          [],
    partner_referral_share: ["{referralUrl}"],
    // {name} is the OWNER name (both owners when there are two), never the
    // company name -- the greeting used to read "Ola, PERFECT!" to paying
    // clients. {link} is the client's own booking link.
    scheduling_send:        ["{name}", "{link}"],
    scheduling_followup:    ["{name}", "{link}"],
    // NO {date} chip on purpose. {when} is the WORD "hoje"/"amanha" -- that is
    // the whole point of the message, and a date chip would let a calendar
    // date get put back in.
    reminder_online:        ["{when}", "{time}", "{meetLink}"],
    reminder_in_person:     ["{when}", "{time}", "{location}"]
  };

  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function isEn() {
    if (global.apexIsEn) { return global.apexIsEn(); }
    return document.body.classList.contains("lang-en");
  }

  function titleFor(key) {
    var t = TITLES[key];
    if (!t) { return key; }
    return isEn() ? t.en : t.pt;
  }

  function closeOverlay(overlay) {
    if (overlay && overlay.parentNode) { overlay.parentNode.removeChild(overlay); }
  }

  // ── The editor ───────────────────────────────────────────────────────────
  // ctx: { apiFetch, key, onSaved }
  function openEditor(ctx) {
    var key = ctx.key;
    var en = isEn();

    var overlay = document.createElement("div");
    overlay.className = "tpl-overlay";
    overlay.innerHTML =
      '<div class="tpl-modal" role="dialog" aria-modal="true">' +
        '<h3 class="tpl-title">' + esc(titleFor(key)) + "</h3>" +
        '<p class="tpl-sub">' +
          (en ? "This is the message sent from here. It saves for everyone."
              : "Esta é a mensagem enviada daqui. Ela vale para todos.") +
        "</p>" +
        '<div class="tpl-body">' +
          '<p class="tpl-loading">' + (en ? "Loading…" : "Carregando…") + "</p>" +
        "</div>" +
      "</div>";
    document.body.appendChild(overlay);

    var body = overlay.querySelector(".tpl-body");

    // Dismiss on backdrop click and on Escape -- a modal you cannot leave is
    // worse than one you never opened.
    overlay.addEventListener("click", function (ev) {
      if (ev.target === overlay) { closeOverlay(overlay); }
    });
    function onKey(ev) {
      if (ev.key === "Escape") {
        closeOverlay(overlay);
        document.removeEventListener("keydown", onKey);
      }
    }
    document.addEventListener("keydown", onKey);

    // Always re-fetch rather than trusting the page's cached copy: someone
    // else may have edited this template on Settings since this page loaded,
    // and overwriting their change with a stale textarea is exactly the drift
    // this module exists to prevent.
    ctx.apiFetch("/api/settings/templates")
      .then(function (res) {
        if (!res.ok) { throw new Error("templates HTTP " + res.status); }
        return res.json();
      })
      .then(function (data) {
        var rows = (data && data.templates) || [];
        var current = null;
        for (var i = 0; i < rows.length; i++) {
          if (rows[i].template_key === key) { current = rows[i]; }
        }
        if (!current) { throw new Error("template '" + key + "' not found"); }
        renderForm(current);
      })
      .catch(function (e) {
        // NEVER a silent catch. This app has repeatedly shipped bugs that were
        // invisible because a failure landed in an empty one.
        console.error("[template-edit] could not load template '" + key + "':", e.message);
        body.innerHTML = '<p class="tpl-msg">' +
          esc(en ? "Could not open this template. Close and try again."
                 : "Não foi possível abrir este modelo. Feche e tente de novo.") + "</p>";
      });

    function renderForm(current) {
      var tokens = TOKENS[key] || [];
      var bits = [];

      bits.push('<textarea class="tpl-textarea" id="tplText" rows="7"></textarea>');

      if (tokens.length) {
        bits.push('<p class="tpl-hint">' +
          (en ? "Keep these exactly as they are — they are filled in automatically:"
              : "Mantenha estas exatamente como estão — são preenchidas automaticamente:") +
          "</p>");
        bits.push('<div class="tpl-tokens">');
        for (var i = 0; i < tokens.length; i++) {
          // Clickable: inserts at the cursor, so a token deleted by accident
          // can be put back without typing the braces correctly from memory.
          bits.push('<button type="button" class="tpl-token" data-token="' +
            esc(tokens[i]) + '">' + esc(tokens[i]) + "</button>");
        }
        bits.push("</div>");
      } else {
        bits.push('<p class="tpl-hint">' +
          (en ? "This message has no variables."
              : "Esta mensagem não usa variáveis.") + "</p>");
      }

      bits.push('<p class="tpl-msg" id="tplMsg" hidden></p>');
      bits.push('<div class="tpl-actions">');
      bits.push('<button type="button" class="tpl-btn tpl-btn-gold" id="tplSave">' +
        (en ? "Save" : "Salvar") + "</button>");
      bits.push('<button type="button" class="tpl-btn" id="tplCancel">' +
        (en ? "Cancel" : "Cancelar") + "</button>");
      bits.push("</div>");

      if (current.updated_by) {
        bits.push('<p class="tpl-meta">' +
          esc((en ? "Last changed by " : "Última alteração por ") + current.updated_by) + "</p>");
      }

      body.innerHTML = bits.join("");

      var ta = document.getElementById("tplText");
      // .value, never innerHTML: the text may contain < or & and must survive
      // a round trip byte for byte.
      if (ta) { ta.value = current.template_text || ""; }

      var msg = document.getElementById("tplMsg");
      function say(text) {
        if (!msg) { return; }
        msg.textContent = text;
        msg.hidden = false;
      }

      body.addEventListener("click", function (ev) {
        var tok = ev.target.getAttribute && ev.target.getAttribute("data-token");
        if (tok && ta) {
          var at = ta.selectionStart;
          var end = ta.selectionEnd;
          ta.value = ta.value.slice(0, at) + tok + ta.value.slice(end);
          ta.focus();
          ta.selectionStart = ta.selectionEnd = at + tok.length;
          return;
        }
        if (ev.target.id === "tplCancel") {
          closeOverlay(overlay);
          document.removeEventListener("keydown", onKey);
          return;
        }
        if (ev.target.id !== "tplSave") { return; }

        var text = ta ? ta.value : "";
        if (!text.trim()) {
          say(en ? "The message cannot be empty." : "A mensagem não pode ficar vazia.");
          return;
        }

        // Warn, do NOT block, on a missing token. She may genuinely want a
        // version without the link; refusing to save would be the module
        // deciding it knows her job better than she does. But a token dropped
        // by accident ships "{invoiceLink}" to a paying client, so it must be
        // said out loud once before it goes through.
        var missing = [];
        for (var m = 0; m < tokens.length; m++) {
          if (text.indexOf(tokens[m]) === -1) { missing.push(tokens[m]); }
        }
        if (missing.length && !ev.target.getAttribute("data-confirmed")) {
          say((en ? "Missing: " : "Faltando: ") + missing.join(", ") + ". " +
              (en ? "Tap Save again to keep it this way."
                  : "Toque em Salvar de novo para manter assim."));
          ev.target.setAttribute("data-confirmed", "1");
          return;
        }

        var btn = ev.target;
        btn.disabled = true;
        ctx.apiFetch("/api/settings/templates/" + encodeURIComponent(key), {
          method: "PUT",
          body: { template_text: text }
        })
          .then(function (res) {
            // Checked, not assumed. Reporting "saved" on a write that did not
            // land is worse than any error: she would go on believing the
            // message changed.
            if (!res.ok) { throw new Error("PUT HTTP " + res.status); }
            return res.json();
          })
          .then(function (saved) {
            closeOverlay(overlay);
            document.removeEventListener("keydown", onKey);
            // Hand the SERVER's copy back to the page so the very next send
            // uses it with no reload. Pages pre-fetch templates into a local
            // cache precisely so the send path never awaits before
            // window.open() -- see the popup-blocker note on each call site --
            // so refreshing that cache is what makes this immediate.
            if (ctx.onSaved) { ctx.onSaved(saved); }
          })
          .catch(function (e) {
            console.error("[template-edit] save failed for '" + key + "':", e.message);
            btn.disabled = false;
            say(en ? "Could not save. Nothing was changed."
                   : "Não foi possível salvar. Nada foi alterado.");
          });
      });

      if (ta) { ta.focus(); }
    }
  }

  // ── Attaching to a send button ───────────────────────────────────────────
  // opts: { button, key, apiFetch, onSaved, pencilInto }
  //
  // Idempotent: pages re-render lists constantly, and attaching twice would
  // stack two pencils and two context handlers on the same button.
  function attach(opts) {
    var btn = opts.button;
    if (!btn || btn.getAttribute("data-tpl-wired")) { return; }
    btn.setAttribute("data-tpl-wired", "1");

    var key = opts.key;
    var ctx = { apiFetch: opts.apiFetch, key: key, onSaved: opts.onSaved };

    // Door 2: right-click the send button itself.
    btn.addEventListener("contextmenu", function (ev) {
      ev.preventDefault();
      openEditor(ctx);
    });
    // A quiet affordance for the gesture nobody would guess at.
    var en = isEn();
    if (!btn.getAttribute("title")) {
      btn.setAttribute("title", en
        ? "Right-click to edit this message"
        : "Clique com o botão direito para editar esta mensagem");
    }

    // Door 1: the pencil. Placed after the button by default; a page can pass
    // pencilInto to put it somewhere its layout prefers.
    var pencil = document.createElement("button");
    pencil.type = "button";
    pencil.className = "tpl-pencil";
    pencil.setAttribute("data-tpl-pencil", key);
    pencil.setAttribute("aria-label", en ? "Edit this message" : "Editar esta mensagem");
    pencil.setAttribute("title", en ? "Edit this message" : "Editar esta mensagem");
    pencil.innerHTML = "&#9998;";   // pencil glyph, no icon font needed
    pencil.onclick = function (ev) {
      ev.preventDefault();
      ev.stopPropagation();   // never let it trigger the send it sits beside
      openEditor(ctx);
    };

    var host = opts.pencilInto || btn.parentNode;
    if (host === btn.parentNode && btn.nextSibling) {
      host.insertBefore(pencil, btn.nextSibling);
    } else if (host) {
      host.appendChild(pencil);
    }
  }

  global.TemplateEdit = {
    attach: attach,
    open: openEditor,
    titleFor: titleFor,
    TOKENS: TOKENS
  };

}(window));
