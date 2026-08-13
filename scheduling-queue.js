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
    var waited = r.business_hours_waiting || 0;

    var stale = booked
      ? (isEn ? "Scheduled" : "Agendado")
      : agoLabel(waited, isEn, { pt: "enviado", en: "sent" });

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

  // ── WhatsApp send: NEVER auto-dial ───────────────────────────────────────
  // The message text is built, then Alice picks the recipient from the contact
  // list. Each client has a WhatsApp group with co-owners, so she must control
  // who receives it. Matches the existing sendInvoiceWhatsApp pattern.
  function openContactPicker(ctx, row, data, kind) {
    var isEn = ctx.isEn();
    var overlay = document.createElement("div");
    overlay.className = "sq-overlay";

    var contacts = data.contacts || [];
    var html = ['<div class="sq-modal">'];
    html.push("<h3>" + (isEn ? "Send to which contact?" : "Enviar para qual contato?") + "</h3>");
    html.push('<p class="sq-modal-sub">' + esc(row.client_name) + "</p>");
    html.push('<pre class="sq-preview">' + esc(data.message) + "</pre>");

    if (!contacts.length) {
      html.push('<p class="sq-modal-sub">' +
        (isEn ? "No number on file. Copy the message and send it from WhatsApp."
              : "Nenhum número cadastrado. Copie a mensagem e envie pelo WhatsApp.") + "</p>");
      html.push('<button type="button" class="sq-btn sq-btn-gold" data-copy="1">' +
        (isEn ? "Copy message" : "Copiar mensagem") + "</button>");
    } else {
      for (var i = 0; i < contacts.length; i++) {
        html.push('<button type="button" class="sq-btn sq-contact" data-num="' + esc(contacts[i].number) + '">' +
          esc(contacts[i].label) + " &middot; " + esc(contacts[i].number) + "</button>");
      }
    }
    html.push('<button type="button" class="sq-btn" data-close="1">' + (isEn ? "Cancel" : "Cancelar") + "</button>");
    html.push("</div>");
    overlay.innerHTML = html.join("");
    document.body.appendChild(overlay);

    function close() { if (overlay.parentNode) { overlay.parentNode.removeChild(overlay); } }

    overlay.addEventListener("click", function (ev) {
      if (ev.target === overlay || ev.target.getAttribute("data-close")) { return close(); }

      if (ev.target.getAttribute("data-copy")) {
        if (navigator.clipboard) { navigator.clipboard.writeText(data.message); }
        markSent(ctx, row, kind);
        return close();
      }

      var num = ev.target.getAttribute("data-num");
      if (!num) { return; }
      // Opened synchronously inside the click so the popup blocker allows it —
      // same reason documented on sendInvoiceWhatsApp.
      var url = "https://wa.me/" + String(num).replace(/[^0-9]/g, "") +
                "?text=" + encodeURIComponent(data.message);
      window.open(url, "_blank");
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
      .then(function (data) { openContactPicker(ctx, row, data, kind); })
      .catch(function () {});
  }

  // Skip REQUIRES a confirm and a reason. Without a reason nobody can later
  // tell a one-off skip from a client quietly disengaging — and it must never
  // be a single accidental click.
  function doSkip(ctx, row) {
    var isEn = ctx.isEn();
    var ask = isEn
      ? "Skip " + row.client_name + " this week?"
      : "Pular " + row.client_name + " esta semana?";
    if (!window.confirm(ask)) { return; }

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
  // outside the offered slots, so this asks for a raw date+time rather than
  // presenting the computed list.
  function doManual(ctx, row) {
    var isEn = ctx.isEn();
    var date = window.prompt(isEn ? "Date (YYYY-MM-DD):" : "Data (AAAA-MM-DD):", row.week_start || "");
    if (!date) { return; }
    var time = window.prompt(isEn ? "Time (HH:MM, 24h):" : "Horário (HH:MM, 24h):", "14:00");
    if (!time) { return; }

    ctx.apiFetch("/api/scheduling/requests/" + row.id + "/manual", {
      method: "POST", body: { date: date, time: time }
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (res) {
        if (!res.ok) {
          window.alert(isEn ? "That time is already taken." : "Esse horário já está ocupado.");
          return;
        }
        load(ctx);
      })
      .catch(function () {});
  }

  function doReschedule(ctx, row) {
    var isEn = ctx.isEn();
    var ask = isEn
      ? "Generate a fresh link for " + row.client_name + "? The old link stops working."
      : "Gerar um link novo para " + row.client_name + "? O link antigo para de funcionar.";
    if (!window.confirm(ask)) { return; }
    ctx.apiFetch("/api/scheduling/requests/" + row.id + "/reschedule", { method: "POST" })
      .then(function () { load(ctx); })
      .catch(function () {});
  }

  function render(ctx, rows, neverScheduled) {
    var host = document.getElementById(ctx.containerId);
    if (!host) { return; }   // null check on every getElementById
    var isEn = ctx.isEn();

    if (!rows.length) {
      host.innerHTML = '<div class="sq-empty">' +
        (isEn ? "No scheduling requests waiting." : "Nenhum pedido de horário aguardando.") + "</div>";
      return;
    }

    var sorted = sortQueue(rows);
    var html = [];
    for (var i = 0; i < sorted.length; i++) { html.push(rowHtml(sorted[i], isEn)); }

    if (neverScheduled && neverScheduled.length) {
      html.push('<div class="sq-never">' +
        esc(isEn ? "Never scheduled: " + neverScheduled.length : "Nunca agendados: " + neverScheduled.length) +
        "</div>");
    }
    host.innerHTML = html.join("");

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
        // Derive the "cobrado há N horas" age client-side from the stored UTC
        // timestamp. formatDateTimeUTC's sibling logic: a bare D1 timestamp
        // carries no zone designator, so it needs the Z before parsing.
        for (var i = 0; i < rows.length; i++) {
          if (rows[i].followup_sent_at) {
            var s = String(rows[i].followup_sent_at).replace(" ", "T").split(".")[0];
            if (!/[Zz]|[+-]\d\d:?\d\d$/.test(s)) { s += "Z"; }
            var then = new Date(s).getTime();
            rows[i].followup_hours_ago = isNaN(then) ? 0 : Math.floor((Date.now() - then) / 3600000);
          }
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
