// Shared "Enviar horarios" queue — ONE component, rendered in TWO places.
//
// THIS FILE EXISTS BECAUSE OF A SCAR. dashboard.html has historically kept its
// own private copies of things that also live in calendar.html, and fixes made
// to one silently miss the other. The month grid hit exactly this and was
// extracted into calendar-grid.js / calendar-grid.css on 2026-08-11. This
// module follows that precedent: calendar.html and dashboard.html both import
// it, neither owns a copy, and there is never a third.
//
// WHAT IS HERE: the queue list, its sort order, the staleness weighting, and
// every row action (Editar / Adicionar horario / Enviar / Cobrar / Reagendar /
// Pular).
//
// WHAT IS DELIBERATELY NOT HERE: the create-request modal, which lives on
// calendar.html because that is where a scheduling request is born. The host
// page supplies an `onEdit` callback so the Editar button can reopen it.
//
// STYLING: Alice is NOT big into colour and red must not be used for urgency.
// Age is carried by BOLD WEIGHT alone — one visual language, matching the
// staleness counter already used on the leads list. A booked row is greyed and
// sinks to the bottom; it stays visible, just out of the way.

(function (global) {
  "use strict";

  var SKIP_REASONS = [
    { key: "vacation",         pt: "Férias",             en: "Vacation" },
    { key: "emergency",        pt: "Emergência",         en: "Emergency" },
    { key: "client_cancelled", pt: "Cliente cancelou",   en: "Client cancelled" }
  ];

  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // Whole hours between a stored D1 timestamp and now.
  //
  // D1 writes UTC with NO zone designator, so the browser would parse the bare
  // string as LOCAL time — a no-op for an Eastern reader and wrong by the
  // offset for everyone else. Appending the "Z" is the same correction
  // formatDateTimeUTC() in datetime.js already documents; without it a row
  // created seconds ago rendered as "1 hour ago".
  function hoursSinceUTC(ts) {
    if (!ts) { return 0; }
    var s = String(ts).replace(" ", "T").split(".")[0];
    if (!/[Zz]|[+-]\d\d:?\d\d$/.test(s)) { s += "Z"; }
    var then = new Date(s).getTime();
    if (isNaN(then)) { return 0; }
    return Math.max(0, Math.floor((Date.now() - then) / 3600000));
  }

  // "enviado há 12 horas" — same phrasing as the leads list, so there is one
  // staleness vocabulary across the app rather than two.
  function agoLabel(hours, isEn, verb) {
    var h = Math.max(0, Math.floor(hours || 0));
    if (isEn) {
      if (h < 1)  { return verb.en + " just now"; }
      if (h < 24) { return verb.en + " " + h + (h === 1 ? " hour ago" : " hours ago"); }
      var d = Math.floor(h / 24);
      return verb.en + " " + d + (d === 1 ? " day ago" : " days ago");
    }
    if (h < 1)  { return verb.pt + " agora"; }
    if (h < 24) { return verb.pt + " há " + h + (h === 1 ? " hora" : " horas"); }
    var dd = Math.floor(h / 24);
    return verb.pt + " há " + dd + (dd === 1 ? " dia" : " dias");
  }

  // Bold intensifies with age. NO RED — weight is the entire mechanism.
  function ageWeight(hours) {
    if (hours >= 24) { return 700; }
    if (hours >= 12) { return 600; }
    return 500;
  }

  // Waiting longest at the TOP. Booked greyed out at the BOTTOM.
  function sortQueue(rows) {
    var copy = rows.slice();
    copy.sort(function (a, b) {
      var aDone = (a.status === "booked") ? 1 : 0;
      var bDone = (b.status === "booked") ? 1 : 0;
      if (aDone !== bDone) { return aDone - bDone; }
      if (aDone === 1) { return String(b.booked_at || "").localeCompare(String(a.booked_at || "")); }
      return (b.business_hours_waiting || 0) - (a.business_hours_waiting || 0);
    });
    return copy;
  }

  function rowHtml(r, isEn) {
    var booked = (r.status === "booked");
    // BOLD tracks business hours (the same clock as the 24-hour follow-up
    // flag), while the TEXT reports real elapsed time. Deliberately different
    // measures: weight answers "how urgent", the label answers "how long ago".
    var waited = r.business_hours_waiting || 0;

    // "sent" is a CLAIM, and it was being made while sent_at was still NULL —
    // telling her she had already contacted someone she had not. Until she
    // actually sends it, the row is only as old as its creation.
    var stale = booked
      ? (isEn ? "Scheduled" : "Agendado")
      : agoLabel(
          r.hours_since_activity,
          isEn,
          r.sent_at ? { pt: "enviado", en: "sent" } : { pt: "criado", en: "created" }
        );

    var bits = ['<div class="sq-row' + (booked ? " sq-done" : "") + '" data-id="' + esc(r.id) + '">'];

    bits.push('<div class="sq-head">');
    bits.push('<span class="sq-name">' + esc(r.client_name) + "</span>");
    bits.push('<span class="sq-age" style="font-weight:' + (booked ? 400 : ageWeight(waited)) + '">' + esc(stale) + "</span>");
    bits.push("</div>");

    var flags = [];
    // "None of these work" is far better data than silence — today silence is
    // indistinguishable from a client simply ignoring her.
    if (r.status === "none_work") {
      flags.push(isEn ? "Client: none of the times work" : "Cliente: nenhum horário funciona");
    }
    // She must be TOLD the client lost a race, or she reads it as being ignored.
    if (r.squeezed_out) {
      flags.push(isEn ? "Lost a slot to another client" : "Perdeu o horário para outro cliente");
    }
    if (!booked && r.needs_followup) {
      flags.push(isEn ? "Waiting over 24 business hours" : "Esperando mais de 24 horas úteis");
    }
    if (r.followup_sent_at) {
      flags.push(agoLabel(r.followup_hours_ago, isEn, { pt: "cobrado", en: "chased" }));
    }
    if (flags.length) {
      bits.push('<div class="sq-flags">' + esc(flags.join("  |  ")) + "</div>");
    }

    var typeLabel = (r.meeting_type === "in_person")
      ? (isEn ? "In person" : "Presencial")
      : (isEn ? "Online" : "Online");
    bits.push('<div class="sq-meta">' + esc(typeLabel + " - " + (r.duration_min || 60) + " min") + "</div>");

    bits.push('<div class="sq-actions">');
    if (booked) {
      bits.push('<button type="button" class="sq-btn" data-act="reschedule">' + (isEn ? "Reschedule" : "Reagendar") + "</button>");
    } else {
      // A real button, not a small pencil.
      bits.push('<button type="button" class="sq-btn" data-act="edit">' + (isEn ? "Edit" : "Editar") + "</button>");
      bits.push('<button type="button" class="sq-btn sq-btn-gold" data-act="send">' + (isEn ? "Send on WhatsApp" : "Enviar via WhatsApp") + "</button>");
      // The counterpart to the 24-business-hour flag: the flag says WHO to
      // chase, this does the chasing — same link, different (softer) message.
      bits.push('<button type="button" class="sq-btn" data-act="followup">' + (isEn ? "Follow up" : "Cobrar") + "</button>");
      bits.push('<button type="button" class="sq-btn" data-act="manual">' + (isEn ? "Add time manually" : "Adicionar horário") + "</button>");
      bits.push('<button type="button" class="sq-btn" data-act="reschedule">' + (isEn ? "New link" : "Reagendar") + "</button>");
      bits.push('<button type="button" class="sq-btn" data-act="skip">' + (isEn ? "Skip this week" : "Pular esta semana") + "</button>");
    }
    bits.push("</div>");
    bits.push("</div>");
    return bits.join("");
  }

  // ── Styled dialogs ───────────────────────────────────────────────────────
  // window.confirm / alert / prompt render a NATIVE browser dialog: it takes
  // the browser's own colours and is titled "apex.resonateai.online says",
  // which reads as something outside the site. Every other dialog in this app
  // is styled, so these are too. Same .sq-overlay/.sq-modal shell as the send
  // preview and the skip-reason picker.

  function closeOverlay(overlay) {
    if (overlay && overlay.parentNode) { overlay.parentNode.removeChild(overlay); }
  }

  // Styled replacement for window.confirm. onYes runs only on confirm.
  function sqConfirm(opts, onYes) {
    var overlay = document.createElement("div");
    overlay.className = "sq-overlay";
    var html = ['<div class="sq-modal">'];
    html.push("<h3>" + esc(opts.title) + "</h3>");
    if (opts.body) { html.push('<p class="sq-modal-sub">' + esc(opts.body) + "</p>"); }
    html.push('<button type="button" class="sq-btn sq-btn-gold" data-yes="1">' + esc(opts.confirmLabel) + "</button>");
    html.push('<button type="button" class="sq-btn" data-close="1">' + esc(opts.cancelLabel) + "</button>");
    html.push("</div>");
    overlay.innerHTML = html.join("");
    document.body.appendChild(overlay);

    overlay.addEventListener("click", function (ev) {
      if (ev.target === overlay || ev.target.getAttribute("data-close")) { return closeOverlay(overlay); }
      if (!ev.target.getAttribute("data-yes")) { return; }
      closeOverlay(overlay);
      onYes();
    });
  }

  // NOTE: there is no sqAlert here on purpose. The one window.alert this file
  // used reported a taken slot, and that message now renders INSIDE the manual
  // modal next to the input she must correct — an alert would have dismissed
  // her half-filled form to deliver it.

  // ── WhatsApp send: NEVER auto-dial, NEVER target a number ────────────────
  // She previews the text, then WhatsApp opens on its own contact list and she
  // picks the recipient. NO number goes into the URL, for two reasons:
  //   1. Each client has a WhatsApp GROUP with co-owners. A number-targeted
  //      link sends to one person and silently bypasses the group.
  //   2. Only a couple of clients have a number on file at all, so a
  //      number-first design falls back to a clipboard copy as the COMMON
  //      case — a dead end that does not open WhatsApp.
  // wa.me/?text= with no number is what finance.html, calendar.html and gm.js
  // already do; this is that same one mechanism, not a second one.
  function openSendPreview(ctx, row, data, kind) {
    var isEn = ctx.isEn();
    var overlay = document.createElement("div");
    overlay.className = "sq-overlay";

    var html = ['<div class="sq-modal">'];
    html.push("<h3>" + (isEn ? "Send on WhatsApp" : "Enviar via WhatsApp") + "</h3>");
    html.push('<p class="sq-modal-sub">' + esc(row.client_name) + "</p>");
    html.push('<pre class="sq-preview">' + esc(data.message) + "</pre>");
    html.push('<p class="sq-modal-sub">' +
      (isEn ? "WhatsApp opens so you can pick the contact or group."
            : "O WhatsApp abre para você escolher o contato ou grupo.") + "</p>");
    html.push('<button type="button" class="sq-btn sq-btn-gold" data-send="1">' +
      (isEn ? "Open WhatsApp" : "Abrir o WhatsApp") + "</button>");
    html.push('<button type="button" class="sq-btn" data-close="1">' + (isEn ? "Cancel" : "Cancelar") + "</button>");
    html.push("</div>");
    overlay.innerHTML = html.join("");
    document.body.appendChild(overlay);

    function close() { if (overlay.parentNode) { overlay.parentNode.removeChild(overlay); } }

    overlay.addEventListener("click", function (ev) {
      if (ev.target === overlay || ev.target.getAttribute("data-close")) { return close(); }
      if (!ev.target.getAttribute("data-send")) { return; }
      // Opened synchronously inside the click so the popup blocker allows it —
      // same reason documented on sendInvoiceWhatsApp.
      window.open("https://wa.me/?text=" + encodeURIComponent(data.message), "_blank");
      markSent(ctx, row, kind);
      close();
    });
  }

  function markSent(ctx, row, kind) {
    ctx.apiFetch("/api/scheduling/requests/" + row.id + "/sent", {
      method: "POST", body: { kind: kind }
    }).then(function () { load(ctx); }).catch(function () {});
  }

  function doSend(ctx, row, kind) {
    // ?kind=followup returns the nudge template carrying the SAME link. A fresh
    // link would break the one the client may already have open.
    ctx.apiFetch("/api/scheduling/message/" + row.id + (kind === "followup" ? "?kind=followup" : ""))
      .then(function (r) { return r.json(); })
      .then(function (data) { openSendPreview(ctx, row, data, kind); })
      // NOT a bare catch. An empty one here swallowed a ReferenceError after
      // this function was renamed, and the Enviar button did nothing at all —
      // no modal, no error, exactly the silent-failure shape this whole pass
      // is about. If the send cannot open, say so.
      .catch(function (e) {
        console.error("[sched] could not open the WhatsApp preview:", e && e.message);
      });
  }

  // Skip REQUIRES a confirm and a reason. Without a reason nobody can later
  // tell a one-off skip from a client quietly disengaging — and it must never
  // be a single accidental click.
  function doSkip(ctx, row) {
    var isEn = ctx.isEn();
    sqConfirm({
      title: isEn ? "Skip " + row.client_name + " this week?"
                  : "Pular " + row.client_name + " esta semana?",
      body: isEn ? "You will be asked why on the next step."
                 : "Na próxima etapa você diz o motivo.",
      confirmLabel: isEn ? "Skip this week" : "Pular esta semana",
      cancelLabel: isEn ? "Cancel" : "Cancelar"
    }, function () { doSkipReason(ctx, row); });
  }

  function doSkipReason(ctx, row) {
    var isEn = ctx.isEn();
    var overlay = document.createElement("div");
    overlay.className = "sq-overlay";
    var html = ['<div class="sq-modal">'];
    html.push("<h3>" + (isEn ? "Why?" : "Por quê?") + "</h3>");
    html.push('<p class="sq-modal-sub">' +
      (isEn ? "One tap. This is how a one-off skip stays distinguishable from a client disengaging."
            : "Um toque. É assim que um pulo pontual não se confunde com um cliente se afastando.") + "</p>");
    for (var i = 0; i < SKIP_REASONS.length; i++) {
      html.push('<button type="button" class="sq-btn" data-reason="' + SKIP_REASONS[i].key + '">' +
        esc(isEn ? SKIP_REASONS[i].en : SKIP_REASONS[i].pt) + "</button>");
    }
    html.push('<button type="button" class="sq-btn" data-close="1">' + (isEn ? "Cancel" : "Cancelar") + "</button>");
    html.push("</div>");
    overlay.innerHTML = html.join("");
    document.body.appendChild(overlay);

    overlay.addEventListener("click", function (ev) {
      if (ev.target === overlay || ev.target.getAttribute("data-close")) {
        if (overlay.parentNode) { overlay.parentNode.removeChild(overlay); }
        return;
      }
      var reason = ev.target.getAttribute("data-reason");
      if (!reason) { return; }
      if (overlay.parentNode) { overlay.parentNode.removeChild(overlay); }
      ctx.apiFetch("/api/scheduling/requests/" + row.id + "/skip", {
        method: "POST", body: { reason: reason }
      }).then(function () { load(ctx); }).catch(function () {});
    });
  }

  // Override path: a client who WhatsApps a time directly. Must accept a time
  // outside the offered slots, so this collects a raw date+time rather than
  // presenting the computed list.
  //
  // Real inputs, not prompts. The two prompts this replaces also asked for the
  // WRONG formats — "YYYY-MM-DD" and "HH:MM, 24h" — while the whole site
  // displays MM/DD/YYYY and 12-hour AM/PM at Pastor Rafael's request. The
  // inputs submit their native ISO values (which is what the API wants) and the
  // echo line below them renders through formatDate/formatTime, so what she
  // reads back is always in the site's format.
  function doManual(ctx, row) {
    var isEn = ctx.isEn();
    var overlay = document.createElement("div");
    overlay.className = "sq-overlay";

    var html = ['<div class="sq-modal">'];
    html.push("<h3>" + (isEn ? "Add time manually" : "Adicionar horário") + "</h3>");
    html.push('<p class="sq-modal-sub">' + esc(row.client_name) + "</p>");
    html.push('<p class="sq-modal-sub">' +
      (isEn ? "Use this when the client sends a time directly."
            : "Use quando o cliente mandar um horário direto.") + "</p>");
    html.push('<label class="sq-field-label">' + (isEn ? "Date" : "Data") + "</label>");
    html.push('<input type="date" class="sq-input" id="sqManualDate" value="' + esc(row.week_start || "") + '">');
    html.push('<label class="sq-field-label">' + (isEn ? "Time" : "Horário") + "</label>");
    html.push('<input type="time" class="sq-input" id="sqManualTime" value="14:00" step="900">');
    html.push('<p class="sq-modal-sub" id="sqManualEcho"></p>');
    html.push('<p class="sq-modal-sub sq-error" id="sqManualErr" hidden></p>');
    html.push('<button type="button" class="sq-btn sq-btn-gold" data-save="1">' +
      (isEn ? "Save time" : "Salvar horário") + "</button>");
    html.push('<button type="button" class="sq-btn" data-close="1">' + (isEn ? "Cancel" : "Cancelar") + "</button>");
    html.push("</div>");
    overlay.innerHTML = html.join("");
    document.body.appendChild(overlay);

    var dateEl = document.getElementById("sqManualDate");
    var timeEl = document.getElementById("sqManualTime");
    var echoEl = document.getElementById("sqManualEcho");
    var errEl  = document.getElementById("sqManualErr");

    // Echo in the site's formats, via the shared datetime.js helpers.
    function renderEcho() {
      if (!echoEl || !dateEl || !timeEl) { return; }
      if (!dateEl.value || !timeEl.value) { echoEl.textContent = ""; return; }
      var d = (typeof formatDate === "function") ? formatDate(dateEl.value) : dateEl.value;
      var t = (typeof formatTime === "function") ? formatTime(timeEl.value) : timeEl.value;
      echoEl.textContent = (isEn ? "Scheduling for " : "Agendando para ") + d + " " + t;
    }
    if (dateEl) { dateEl.addEventListener("change", renderEcho); }
    if (timeEl) { timeEl.addEventListener("change", renderEcho); }
    renderEcho();

    overlay.addEventListener("click", function (ev) {
      if (ev.target === overlay || ev.target.getAttribute("data-close")) { return closeOverlay(overlay); }
      if (!ev.target.getAttribute("data-save")) { return; }
      if (!dateEl || !timeEl || !dateEl.value || !timeEl.value) { return; }

      ctx.apiFetch("/api/scheduling/requests/" + row.id + "/manual", {
        method: "POST", body: { date: dateEl.value, time: timeEl.value }
      })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
        .then(function (res) {
          if (!res.ok) {
            // Kept INSIDE the modal: her input is still on screen to correct,
            // where a separate alert would have thrown it away.
            if (errEl) {
              errEl.textContent = isEn ? "That time is already taken." : "Esse horário já está ocupado.";
              errEl.hidden = false;
            }
            return;
          }
          closeOverlay(overlay);
          load(ctx);
        })
        .catch(function () {});
    });
  }

  function doReschedule(ctx, row) {
    var isEn = ctx.isEn();
    sqConfirm({
      title: isEn ? "Generate a fresh link for " + row.client_name + "?"
                  : "Gerar um link novo para " + row.client_name + "?",
      body: isEn ? "The old link stops working."
                 : "O link antigo para de funcionar.",
      confirmLabel: isEn ? "Generate new link" : "Gerar link novo",
      cancelLabel: isEn ? "Cancel" : "Cancelar"
    }, function () {
      ctx.apiFetch("/api/scheduling/requests/" + row.id + "/reschedule", { method: "POST" })
        .then(function () { load(ctx); })
        .catch(function () {});
    });
  }

  function render(ctx, rows, neverScheduled) {
    var host = document.getElementById(ctx.containerId);
    if (!host) { return; }   // null check on every getElementById
    var isEn = ctx.isEn();

    // The host page may wrap the list in a titled block. An empty queue hides
    // the WHOLE block, heading included — otherwise "Waiting on a time" sits
    // over blank space and reads as a load failure.
    var block = ctx.blockId ? document.getElementById(ctx.blockId) : null;

    if (!rows.length) {
      if (block) { block.hidden = true; }
      host.innerHTML = '<div class="sq-empty">' +
        (isEn ? "No scheduling requests waiting." : "Nenhum pedido de horário aguardando.") + "</div>";
      return;
    }
    if (block) { block.hidden = false; }

    var sorted = sortQueue(rows);
    var html = [];
    for (var i = 0; i < sorted.length; i++) { html.push(rowHtml(sorted[i], isEn)); }

    if (neverScheduled && neverScheduled.length) {
      html.push('<div class="sq-never">' +
        esc(isEn ? "Never scheduled: " + neverScheduled.length : "Nunca agendados: " + neverScheduled.length) +
        "</div>");
    }
    host.innerHTML = html.join("");

    // Edit-in-place: a pencil beside each Enviar/Cobrar, and right-click on
    // the button itself. Re-attached after every render because this list
    // rebuilds its own innerHTML; TemplateEdit.attach() is idempotent, so the
    // rows that survive a re-render do not collect a second pencil.
    //
    // These two messages go through the SAME PUT the Settings page uses, and
    // the worker reads them from message_templates -- so what she edits here
    // is what the next send builds, with no reload and no second copy.
    if (global.TemplateEdit) {
      var sendBtns = host.querySelectorAll('[data-act="send"]');
      for (var s = 0; s < sendBtns.length; s++) {
        global.TemplateEdit.attach({
          button: sendBtns[s], key: "scheduling_send", apiFetch: ctx.apiFetch
        });
      }
      var followBtns = host.querySelectorAll('[data-act="followup"]');
      for (var f = 0; f < followBtns.length; f++) {
        global.TemplateEdit.attach({
          button: followBtns[f], key: "scheduling_followup", apiFetch: ctx.apiFetch
        });
      }
    }

    host.onclick = function (ev) {
      var btn = ev.target;
      var act = btn.getAttribute && btn.getAttribute("data-act");
      if (!act) { return; }
      var rowEl = btn.closest ? btn.closest(".sq-row") : null;
      if (!rowEl) { return; }
      var id = rowEl.getAttribute("data-id");
      var row = null;
      for (var k = 0; k < rows.length; k++) { if (rows[k].id === id) { row = rows[k]; } }
      if (!row) { return; }

      if (act === "send")       { return doSend(ctx, row, "invite"); }
      if (act === "followup")   { return doSend(ctx, row, "followup"); }
      if (act === "skip")       { return doSkip(ctx, row); }
      if (act === "manual")     { return doManual(ctx, row); }
      if (act === "reschedule") { return doReschedule(ctx, row); }
      if (act === "edit" && ctx.onEdit) { return ctx.onEdit(row); }
    };
  }

  function load(ctx) {
    return ctx.apiFetch("/api/scheduling/queue")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var rows = data.queue || [];
        for (var i = 0; i < rows.length; i++) {
          if (rows[i].followup_sent_at) {
            rows[i].followup_hours_ago = hoursSinceUTC(rows[i].followup_sent_at);
          }
          // The age the row actually SHOWS. Measured from sent_at once she has
          // sent it, from created_at before that — the label and the clock must
          // describe the same event.
          //
          // NOT business_hours_waiting: that is deliberately weighted (a link
          // sent Friday does not age over the weekend) and drives the 24-hour
          // follow-up flag. Reusing it as a wall-clock age is what made a row
          // created 16 seconds earlier read "sent 1 hour ago".
          rows[i].hours_since_activity = hoursSinceUTC(rows[i].sent_at || rows[i].created_at);
        }
        render(ctx, rows, data.never_scheduled);
        return rows;
      })
      .catch(function () { return []; });
  }

  global.SchedulingQueue = {
    // ctx: { containerId, apiFetch, isEn, onEdit }
    init: function (ctx) { return load(ctx); },
    reload: function (ctx) { return load(ctx); }
  };

}(window));
