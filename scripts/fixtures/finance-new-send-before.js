function invoiceLinkFor(inv) {
      return "https://apex.resonateai.online/templates/apex-invoice-template-DRAFT.html?v=1787770400&invoice_id=" +
        encodeURIComponent(inv.id) + "&src=finance-new";
    }

function apxClientLinkForSend(invoiceId) {
      if (APX_SWITCHES.client_invoice_link_enabled !== true) { return Promise.resolve(null); }
      return apiFetch("/api/finance-new/invoices/" + invoiceId + "/client-link", { method: "POST" })
        .then(function(r) { return r.json().catch(function() { return {}; }); })
        .then(function(d) { return (d && !d.error && d.link_enabled === true && d.link) ? d.link : null; })
        .catch(function() { return null; });
    }

function sendInvoiceWhatsApp(invoiceId) {
      var inv = null;
      for (var i = 0; i < INVOICES.length; i++) {
        if (INVOICES[i].id === invoiceId) { inv = INVOICES[i]; }
      }
      if (!inv) { return; }

      // CONFIRM BEFORE SENDING. Sending is irreversible from the client's
      // point of view -- the message is in their WhatsApp -- and it flips the
      // invoice to 'sent'. INV-000018 went out before anyone had previewed it
      // because this button was the only one on the row. The confirm names the
      // client and the amount so a mis-click on the wrong row is caught too.
      //
      // Deliberately BEFORE window.open: confirm() is synchronous and preserves
      // the user-gesture context, so the popup-blocker fix below still holds.
      var who = inv.client_name || "";
      var amount = fmtCents(inv.amount_cents);
      var ask = isEn()
        ? "Send invoice " + inv.number + " (" + amount + ") to " + who + " on WhatsApp now?"
        : "Enviar a fatura " + inv.number + " (" + amount + ") para " + who + " no WhatsApp agora?";
      if (!window.confirm(ask)) { return; }

      var waWindow = window.open("", "_blank");
      if (!inv) { if (waWindow) { waWindow.close(); } return; }

      var invoiceLink = invoiceLinkFor(inv);
      var tpl = (MESSAGE_TEMPLATES && MESSAGE_TEMPLATES.invoice_send) ||
        "Ola! Segue a fatura para sua aprovacao:\n{invoiceLink}";
      var message = tpl.split("{invoiceLink}").join(invoiceLink);
      var waUrl = "https://wa.me/" +
        (inv.client_whatsapp ? String(inv.client_whatsapp).replace(/[^0-9]/g, "") : "") +
        "?text=" + encodeURIComponent(message);

      // 'sent' records that she pressed the button. There is no email path.
      //
      // ⚠️ ORDER MATTERS, AND IT USED TO BE WRONG. This fetch ran AFTER the
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

      apiFetch("/api/finance-new/invoices/" + invoiceId + "/mark-sent", { method: "POST" })
        .then(function(r) { return r.json().catch(function() { return {}; }); })
        .then(function(d) {
          if (d && d.error) { throw new Error(d.error); }
          // Master switch ON (and only then): the message carries the
          // client's public link in place of the staff one. Asked for AFTER
          // mark-sent, because pay links exist only for a sent invoice. With
          // the switch OFF this resolves null at once and nothing changes.
          return apxClientLinkForSend(invoiceId);
        })
        .then(function(clientLink) {
          if (clientLink) {
            message = tpl.split("{invoiceLink}").join(clientLink);
            waUrl = "https://wa.me/" +
              (inv.client_whatsapp ? String(inv.client_whatsapp).replace(/[^0-9]/g, "") : "") +
              "?text=" + encodeURIComponent(message);
          }
          openWhatsApp();
          loadInvoices();
        })
        .catch(function(e) {
          // WhatsApp opens EITHER WAY. Failing to record the status must never
          // stop her sending the invoice -- that would turn a bookkeeping
          // problem into a client-facing one. She is told what did not happen
          // and which button fixes it.
          openWhatsApp();
          toast(isEn()
            ? "Sent on WhatsApp, but it could not be marked sent: " +
              (e.message || "unknown error") + ". Use \"Mark sent\" on the row."
            : "Enviada no WhatsApp, mas nao foi possivel marcar como enviada: " +
              (e.message || "erro desconhecido") + ". Use \"Marcar enviada\" na linha.");
        });
    }

function markInvoiceSentOnly(invoiceId) {
      var inv = null;
      for (var i = 0; i < (INVOICES || []).length; i++) {
        if (INVOICES[i].id === invoiceId) { inv = INVOICES[i]; break; }
      }
      var who = inv ? (inv.client_name || "") : "";
      var amount = inv ? fmtCents(inv.amount_cents) : "";
      var num = inv ? inv.number : invoiceId;
      // Same confirm discipline as the WhatsApp path: naming the client and
      // the amount is what makes a mis-click on the wrong row catchable.
      var ask = isEn()
        ? "Mark invoice " + num + " (" + amount + ") to " + who +
          " as sent? Use this when it was already sent some other way."
        : "Marcar a fatura " + num + " (" + amount + ") para " + who +
          " como enviada? Use quando ela ja foi enviada de outra forma.";
      if (!window.confirm(ask)) { return; }

      apiFetch("/api/finance-new/invoices/" + invoiceId + "/mark-sent", { method: "POST" })
        .then(function(r) { return r.json().catch(function() { return {}; }); })
        .then(function(d) {
          if (d && d.error) { throw new Error(d.error); }
          toast(isEn() ? "Marked as sent." : "Marcada como enviada.");
          loadInvoices();
        })
        .catch(function(e) {
          toast((isEn() ? "Could not mark sent: " : "Nao foi possivel marcar como enviada: ") +
                (e.message || "erro"));
        });
    }
