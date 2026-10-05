// Sending Apex's own invoice: the message, the link that goes in it, and the
// steps. ONE copy, loaded by finance-new.html (the invoice rows) and by
// apex-invoice-view.html (staff review mode). Moved here from finance-new.html
// on 2026-10-04 so the two pages cannot drift apart; the message a client
// receives is character for character what finance-new.html built before.
// scripts/test-apex-invoice-send.mjs compares the two.
//
// Nothing here knows which page it is on. Each page hands in what it has:
//   deps.apiFetch(path, opts)     the page's signed-in fetch
//   deps.templates()              the prefetched message templates (or null)
//   deps.clientLinkEnabled()      true when the master switch is ON
//   deps.isEn()                   true for English
//   deps.fmtCents(cents)          $1,234.56
//   deps.toast(text)              how the page tells the person something
//   deps.onSent()                 called after the invoice is recorded as sent
//   deps.confirm                  false skips the question before sending
//   deps.onMarkFailed(e)          optional; replaces the default "could not be
//                                 marked sent" message
(function(root) {
  var FALLBACK_TEMPLATE = "Ola! Segue a fatura para sua aprovacao:\n{invoiceLink}";

  // The staff-era link. This is the link that goes out while the master
  // switch is OFF.
  //
  // The parameter name is invoice_id on purpose. With ?id= the template found
  // nothing, took its LOCAL FALLBACK branch and rendered a static demo file
  // (another client's name, no total). That is what was seen on JM Luxury
  // Pool's INV-000018.
  function staffLink(inv) {
    return "https://apex.resonateai.online/templates/apex-invoice-template-DRAFT.html?v=1787770400&invoice_id=" +
      encodeURIComponent(inv.id) + "&src=finance-new";
  }

  function templateFor(deps) {
    var all = deps && deps.templates ? deps.templates() : null;
    return (all && all.invoice_send) || FALLBACK_TEMPLATE;
  }

  function buildMessage(tpl, link) {
    return tpl.split("{invoiceLink}").join(link);
  }

  function waUrlFor(inv, message) {
    return "https://wa.me/" +
      (inv.client_whatsapp ? String(inv.client_whatsapp).replace(/[^0-9]/g, "") : "") +
      "?text=" + encodeURIComponent(message);
  }

  // The client's link when the master switch is ON, null when it is OFF or
  // anything fails (the caller then keeps the link it always used).
  function clientLinkForSend(invoiceId, deps) {
    if (deps.clientLinkEnabled() !== true) { return Promise.resolve(null); }
    return deps.apiFetch("/api/finance-new/invoices/" + invoiceId + "/client-link", { method: "POST" })
      .then(function(r) { return r.json().catch(function() { return {}; }); })
      .then(function(d) { return (d && !d.error && d.link_enabled === true && d.link) ? d.link : null; })
      .catch(function() { return null; });
  }

  // THE POPUP-BLOCKER FIX.
  //
  // window.open() runs SYNCHRONOUSLY here, inside the click, before any await
  // or .then(). A popup opened after an async hop has lost the user-gesture
  // context and is silently blocked -- which has produced both a dead button
  // and a white screen on this app before. Message templates are prefetched at
  // page load for exactly this reason, so nothing has to be awaited before the
  // window exists.
  function sendWhatsApp(inv, deps) {
    if (!inv) { return; }
    var invoiceId = inv.id;

    // CONFIRM BEFORE SENDING (the invoice rows). Sending is irreversible from
    // the client's point of view -- the message is in their WhatsApp -- and it
    // flips the invoice to 'sent'. INV-000018 went out before anyone had
    // previewed it because this button was the only one on the row. The
    // confirm names the client and the amount so a mis-click on the wrong row
    // is caught too. The review page passes confirm: false: there the person
    // is looking at the invoice itself.
    //
    // Deliberately BEFORE window.open: confirm() is synchronous and preserves
    // the user-gesture context, so the popup-blocker fix below still holds.
    if (deps.confirm !== false) {
      var who = inv.client_name || "";
      var amount = deps.fmtCents(inv.amount_cents);
      var ask = deps.isEn()
        ? "Send invoice " + inv.number + " (" + amount + ") to " + who + " on WhatsApp now?"
        : "Enviar a fatura " + inv.number + " (" + amount + ") para " + who + " no WhatsApp agora?";
      if (!window.confirm(ask)) { return; }
    }

    var waWindow = window.open("", "_blank");

    var invoiceLink = staffLink(inv);
    var tpl = templateFor(deps);
    var message = buildMessage(tpl, invoiceLink);
    var waUrl = waUrlFor(inv, message);

    // 'sent' records that she pressed the button. There is no email path.
    //
    // ORDER MATTERS, AND IT USED TO BE WRONG. This fetch ran AFTER the
    // WhatsApp handoff, and handing off to another app can suspend or tear
    // down this page before an in-flight request finishes -- the same way
    // the Contact Log recorded nothing for months. Paired with an empty
    // `.catch(function(){})` that threw the failure away, the result was an
    // invoice that stayed in draft with nothing on screen saying why:
    // INV-000031 (JM, $2,000) sat there after Alice had sent it AND the
    // client had paid it, and she could not mark it paid because only a
    // 'sent' invoice can be.
    //
    // The request is fired FIRST, while the page is certainly still alive,
    // and WhatsApp opens once it has been sent. The blank window is already
    // open from the click, so the popup-blocker fix still holds -- opening
    // it up front is exactly what makes this reordering safe.
    function openWhatsApp() {
      if (waWindow) { waWindow.location.href = waUrl; }
      else { window.open(waUrl, "_blank"); }
    }

    deps.apiFetch("/api/finance-new/invoices/" + invoiceId + "/mark-sent", { method: "POST" })
      .then(function(r) { return r.json().catch(function() { return {}; }); })
      .then(function(d) {
        if (d && d.error) { throw new Error(d.error); }
        // Master switch ON (and only then): the message carries the
        // client's public link in place of the staff one. Asked for AFTER
        // mark-sent, because pay links exist only for a sent invoice. With
        // the switch OFF this resolves null at once and nothing changes.
        return clientLinkForSend(invoiceId, deps);
      })
      .then(function(clientLink) {
        if (clientLink) {
          message = buildMessage(tpl, clientLink);
          waUrl = waUrlFor(inv, message);
        }
        openWhatsApp();
        deps.onSent();
      })
      .catch(function(e) {
        // WhatsApp opens EITHER WAY. Failing to record the status must never
        // stop her sending the invoice -- that would turn a bookkeeping
        // problem into a client-facing one. She is told what did not happen
        // and which button fixes it.
        openWhatsApp();
        if (deps.onMarkFailed) { deps.onMarkFailed(e); return; }
        deps.toast(deps.isEn()
          ? "Sent on WhatsApp, but it could not be marked sent: " +
            (e.message || "unknown error") + ". Use \"Mark sent\" on the row."
          : "Enviada no WhatsApp, mas nao foi possivel marcar como enviada: " +
            (e.message || "erro desconhecido") + ". Use \"Marcar enviada\" na linha.");
      });
  }

  // Mark an invoice sent WITHOUT going through WhatsApp.
  //
  // The send button was the only route to 'sent', and it is welded to
  // WhatsApp: it builds https://wa.me/<number> from the client record. JM
  // LUXURY POOLS has NO whatsapp and NO phone on file, so that URL is
  // built with an empty number and goes nowhere -- and the invoice can
  // never leave draft, which blocks marking it paid. Alice sends plenty of
  // invoices another way; recording that must not depend on one channel.
  //
  // inv may be null (the row was not found); the question then names only
  // the id, as it always did.
  function markSentOnly(invoiceId, inv, deps) {
    var who = inv ? (inv.client_name || "") : "";
    var amount = inv ? deps.fmtCents(inv.amount_cents) : "";
    var num = inv ? inv.number : invoiceId;
    // Same confirm discipline as the WhatsApp path: naming the client and
    // the amount is what makes a mis-click on the wrong row catchable.
    var ask = deps.isEn()
      ? "Mark invoice " + num + " (" + amount + ") to " + who +
        " as sent? Use this when it was already sent some other way."
      : "Marcar a fatura " + num + " (" + amount + ") para " + who +
        " como enviada? Use quando ela ja foi enviada de outra forma.";
    if (!window.confirm(ask)) { return; }

    deps.apiFetch("/api/finance-new/invoices/" + invoiceId + "/mark-sent", { method: "POST" })
      .then(function(r) { return r.json().catch(function() { return {}; }); })
      .then(function(d) {
        if (d && d.error) { throw new Error(d.error); }
        deps.toast(deps.isEn() ? "Marked as sent." : "Marcada como enviada.");
        deps.onSent();
      })
      .catch(function(e) {
        deps.toast((deps.isEn() ? "Could not mark sent: " : "Nao foi possivel marcar como enviada: ") +
              (e.message || "erro"));
      });
  }

  var api = {
    FALLBACK_TEMPLATE: FALLBACK_TEMPLATE,
    staffLink: staffLink,
    templateFor: templateFor,
    buildMessage: buildMessage,
    waUrlFor: waUrlFor,
    clientLinkForSend: clientLinkForSend,
    sendWhatsApp: sendWhatsApp,
    markSentOnly: markSentOnly
  };
  root.ApexInvoiceSend = api;
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
})(typeof window !== "undefined" ? window : this);
