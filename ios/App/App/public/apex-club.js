    // ── Role gate ────────────────────────────────────────────────────────
    // Set by apex-club.html once the role is known. Rafa sees the events
    // list, the registration link, the guest list (names, plus-ones,
    // WhatsApp buttons), Pessoas and Copiar lista -- never P&L, any payment
    // or Zelle tool or badge or amount received, nor create/edit/delete.
    function clubIsMoneyRole() {
      var role = window.CLUB_ROLE || "alice";
      return role === "alice" || role === "developer";
    }

    // ── Apex Club event P&L ─────────────────────────────────────────────
    //
    // "Evento de julho: -$181" first, detail under it. The confirmed number
    // is the headline; anything still only suggested is shown separately and
    // never folded into it, because a P&L that quietly includes guesses is
    // worse than one that admits what it does not know.
    // The month the picker opens on: the month of the NEWEST event, whether
    // or not any payment has been matched to it yet. (It used to prefer
    // events with confirmed transactions, which opened July while October's
    // registrations were already coming in.)
    //
    // Not the current month -- events run roughly monthly, so "now" lands her
    // on a blank screen in any gap month, which reads as the feature being
    // broken. Not a hardcoded date either, which goes stale the moment the
    // next dinner happens. Derived from the data every time.
    //
    // Falls back to the current month only when there are no events at all.
    function newestEventMonth() {
      var pool = CLUB_EVENTS;
      if (!pool.length) { return new Date().toISOString().slice(0, 7); }

      var newest = pool[0].event.event_date;
      pool.forEach(function(e) {
        if (e.event.event_date > newest) { newest = e.event.event_date; }
      });
      return String(newest).slice(0, 7);
    }

    function initEventMonth() {
      var el = document.getElementById("eventMonth");
      if (el && !el.value) { el.value = newestEventMonth(); }
      renderClub();
    }

    // Hero tiles: confirmed guests (seats) and registrations, summed across
    // the event(s) shown for the selected month -- the same rsvp.going and
    // rsvp.going_rows figures already rendered on each event card, never a
    // new computation.
    function updateClubHeroTiles(shown) {
      var guestsEl = document.getElementById("clubHeroGuests");
      var regsEl = document.getElementById("clubHeroRegs");
      if (!guestsEl || !regsEl) { return; }
      var going = 0, goingRows = 0;
      (shown || []).forEach(function(e) {
        var r = e.rsvp || {};
        going += r.going || 0;
        goingRows += r.going_rows || 0;
      });
      guestsEl.textContent = going;
      regsEl.textContent = goingRows;
    }

    function renderClub() {
      var body = document.getElementById("clubBody");
      if (!body) { return; }

      var empty = document.getElementById("clubEmpty");
      if (!CLUB_EVENTS.length) {
        body.innerHTML = "";
        empty.hidden = false;
        updateClubHeroTiles([]);
        return;
      }
      empty.hidden = true;

      // One month at a time. Before the picker has a value (first paint, or
      // a render triggered by the language toggle) show everything rather
      // than nothing.
      var monthEl = document.getElementById("eventMonth");
      var month = monthEl && monthEl.value ? monthEl.value : null;
      var shown = month
        ? CLUB_EVENTS.filter(function(e) { return String(e.event.event_date).slice(0, 7) === month; })
        : CLUB_EVENTS;

      // Newest first. The worker already orders by event_date DESC, but the
      // most recent event is the one she is actually working, so sort here
      // too rather than depending on the endpoint's order staying that way.
      shown = shown.slice().sort(function(a, b) {
        return String(a.event.event_date) < String(b.event.event_date) ? 1 : -1;
      });

      updateClubHeroTiles(shown);

      // A gap month is a normal state, not an error -- Apex Club is roughly
      // monthly, not strictly. Say so plainly and leave the picker available
      // so she can step to a month that did have one.
      if (!shown.length) {
        body.innerHTML =
          '<div class="club-event"><div class="club-detail" style="margin-top:0">' +
            '<span class="show-pt">Nenhum evento neste m&ecirc;s. Escolha outro m&ecirc;s acima.</span>' +
            '<span class="show-en">No event this month. Pick another month above.</span>' +
          "</div></div>";
        applyFinBilingualAttrs();
        return;
      }

      // The newest event on screen is the one being worked; its guest list
      // opens. Older ones collapse, or a year of forty-guest dinners makes
      // this page scroll forever. Once she toggles one, her choice wins.
      var newestId = shown.length ? shown[0].event.id : null;
      // Stamped so the toggle can resolve the default without recomputing
      // the sort.
      body.setAttribute("data-newest", newestId || "");

      body.innerHTML = shown.map(function(e, idx) {
        var c = e.confirmed;
        var net = c.net_cents;

        var ev = e.event;
        var flyerUrl = ev.flyer_r2_key
          ? (WORKER_URL + "/api/club/flyer/" + ev.id)
          : null;

        // Cropped band across the top of the card, plus a small full-aspect
        // thumbnail beside the title. Same image, two jobs: the band gives
        // the card its identity, the thumbnail keeps the flyer readable.
        var hero = flyerUrl
          ? '<div class="club-hero-wrap"><img class="club-hero" src="' + flyerUrl + '" alt=""></div>'
          : "";

        // The verdict (net P&L). Rafa never sees profit and loss, any
        // payment or amount received -- the event name alone stands in.
        var verdict = clubIsMoneyRole()
          ? '<div class="club-verdict' + (net > 0 ? " is-up" : "") + '">' +
              esc(ev.name) + ": " + (net > 0 ? "+" : "") + fmtCents(net) +
            "</div>"
          : '<div class="club-verdict">' + esc(ev.name) + "</div>";

        // What the event actually is, from its own fields rather than a
        // hardcoded line -- prices vary per event now. Price is money, so
        // it is left out of Rafa's meta line.
        var metaBits = [];
        if (ev.event_date) { metaBits.push(fmtDate(ev.event_date) + (ev.start_time ? " &middot; " + esc(ev.start_time) : "")); }
        if (ev.venue)      { metaBits.push(esc(ev.venue)); }
        if (ev.speakers)   { metaBits.push(esc(ev.speakers)); }
        var evPaid = clubEventCharged(ev);
        if (clubIsMoneyRole()) {
          var priceBit = t("Sem cobran&ccedil;a pela Apex", "Not charged by Apex");
          if (evPaid) {
            priceBit = fmtCents(ev.price_single_cents) + (isEn() ? " per person" : " por pessoa");
            if (ev.price_couple_cents) {
              priceBit += " &middot; " + fmtCents(ev.price_couple_cents) + (isEn() ? " per couple" : " por casal");
            }
          }
          metaBits.push(priceBit);
        }

        var head =
          '<div class="club-head">' +
            (flyerUrl
              ? '<img class="club-thumb" src="' + flyerUrl + '" alt="" onclick="window.open(\'' + flyerUrl + '\',\'_blank\')">'
              : "") +
            '<div class="club-headmain">' + verdict +
              '<div class="club-meta">' + metaBits.join("<br>") + "</div>" +
            "</div>" +
            (clubIsMoneyRole()
              ? '<button class="btn btn-sm" onclick="openClubEvModal(\'' + ev.id + '\')">' +
                '<span class="show-pt">Editar</span><span class="show-en">Edit</span></button>'
              : "") +
          "</div>";

        // P&L detail: Rafa never sees income/expense or card receipts.
        // Task 2.2: nobody has joined yet reads as a plain statement, not
        // "$0.00 from 0 people" (which sounds like a reporting glitch).
        var joinedLine = c.people === 0
          ? '<span class="show-pt">Ningu&eacute;m entrou ainda</span><span class="show-en">No one has joined yet</span>'
          : '<span class="show-pt">Entrou ' + fmtCents(c.income_cents) +
              " de " + c.people + " pessoa" + (c.people === 1 ? "" : "s") + "</span>" +
            '<span class="show-en">In ' + fmtCents(c.income_cents) +
              " from " + c.people + " " + (c.people === 1 ? "person" : "people") + "</span>";
        var detail = !clubIsMoneyRole() ? "" :
          '<div class="club-detail">' +
            joinedLine +
            '<span class="show-pt">' + (c.people === 0 ? "" : " &middot; ") + "saiu " + fmtCents(c.expense_cents) + "</span>" +
            '<span class="show-en">' + (c.people === 0 ? "" : " &middot; ") + "out " + fmtCents(c.expense_cents) + "</span>" +
          "</div>" +
          // Card receipts, their own labeled lines (already inside the
          // in / out figures above). Absent when nobody paid by card.
          (e.card_count
            ? '<div class="club-detail">' +
                t("Cartão (Stripe)", "Card (Stripe)") + ": " + fmtCents(e.card_received_cents) + " (" + e.card_count + ")" +
                " &middot; " + t("Taxa do Stripe", "Stripe fee") + ": " + fmtCents(e.card_fee_cents) +
              "</div>"
            : "");

        // Outstanding suggestions, with what the number would become. Framed
        // as a question, never applied on her behalf. Money tooling: never
        // shown to Rafa.
        var sug = "";
        if (clubIsMoneyRole() && e.suggestions.length) {
          sug =
            '<div class="club-suggest">' +
              '<div class="club-suggest-head">' +
                '<span class="show-pt">' + e.suggestions.length +
                  " lan&ccedil;amento(s) podem ser deste evento &mdash; se confirmar tudo: " +
                  (e.projected.net_cents >= 0 ? "+" : "") + fmtCents(e.projected.net_cents) + "</span>" +
                '<span class="show-en">' + e.suggestions.length +
                  " transaction(s) may belong to this event &mdash; if you confirm all: " +
                  (e.projected.net_cents >= 0 ? "+" : "") + fmtCents(e.projected.net_cents) + "</span>" +
              "</div>" +
              e.suggestions.map(function(s) {
                var why = s.why === "memo"
                  ? (isEn() ? "memo says so" : "o memo indica")
                  : (isEn() ? "matches a ticket price" : "bate com o valor do ingresso");
                return '<div class="club-sug-row">' +
                  '<span class="grow">' + fmtDate(s.date) + " &middot; " +
                    esc((s.memo || s.description || "").slice(0, 40)) +
                    ' <span class="tag-meta">(' + why + ")</span></span>" +
                  "<b>" + fmtCents(s.amount_cents) + "</b>" +
                  '<button data-help="admin-apex-club#club#4" class="btn btn-sm btn-gold" onclick="confirmClubTxn(\'' + e.event.id +
                    "','" + s.transaction_id + "','" + s.side + "'," + s.people + ')">' +
                    '<span class="show-pt">&Eacute; deste evento</span>' +
                    '<span class="show-en">Belongs here</span></button>' +
                  // The other half of the question. Without it the only move
                  // is "yes", so anything that merely looks like a ticket sits
                  // here through every refresh with no way to clear it.
                  '<button data-help="admin-apex-club#club#4" class="btn btn-sm" onclick="dismissClubTxn(\'' + e.event.id +
                    "','" + s.transaction_id + '\')">' +
                    '<span class="show-pt">N&atilde;o &eacute;</span>' +
                    '<span class="show-en">Not this one</span></button>' +
                  "</div>";
              }).join("") +
            "</div>";
        }

        // Dismissed rows, collapsed. Kept reachable rather than gone, so a
        // wrong no costs one click to undo -- and so the count is visible
        // instead of the list just quietly getting shorter. Money tooling:
        // never shown to Rafa.
        var dis = "";
        var dl = (e.dismissed || []);
        if (clubIsMoneyRole() && dl.length) {
          var open = CLUB_SHOW_DISMISSED[e.event.id];
          dis =
            '<div class="club-dismissed">' +
              '<button data-help="admin-apex-club#club#4" class="club-dismissed-toggle" onclick="toggleClubDismissed(\'' + e.event.id + '\')">' +
                '<span class="show-pt">' + dl.length + " marcado(s) como n&atilde;o sendo deste evento &mdash; " +
                  (open ? "ocultar" : "mostrar") + "</span>" +
                '<span class="show-en">' + dl.length + " marked as not this event &mdash; " +
                  (open ? "hide" : "show") + "</span>" +
              "</button>" +
              (open
                ? dl.map(function(s) {
                    return '<div class="club-sug-row">' +
                      '<span class="grow">' + fmtDate(s.date) + " &middot; " +
                        esc((s.memo || s.description || "").slice(0, 40)) + "</span>" +
                      "<b>" + fmtCents(s.amount_cents) + "</b>" +
                      '<button data-help="admin-apex-club#club#4" class="btn btn-sm" onclick="undismissClubTxn(\'' + e.event.id +
                        "','" + s.transaction_id + '\')">' +
                        '<span class="show-pt">Desfazer</span>' +
                        '<span class="show-en">Undo</span></button>' +
                      "</div>";
                  }).join("")
                : "") +
            "</div>";
        }

        // ── Guest list. This is the FOOD COUNT and the reason the public
        // page exists. It counts SEATS, not rows: a plus one is two people
        // at the table on one registration. --------------------------------
        var regs = e.registrations || [];
        var r = e.rsvp || {};
        var guests = "";
        var regUrl = e.register_link || (PUBLIC_BASE + "/club.html?e=" + ev.id);

        var guestRows = regs.map(function (g) {
          var isNext = g.rsvp_state === "next_time";
          var waText = buildClubWhatsAppText(ev, g);
          // Plus-one: name and number, or a "faltando" chip with an Adicionar
          // sheet, shown to Alice, Rafa and the developer alike.
          var plusOneLine = "";
          if (g.plus_one) {
            plusOneLine = g.plus_one_name && g.plus_one_phone
              ? '<div class="guest-plusone">' + t("Acompanhante: ", "Plus one: ") + esc(g.plus_one_name) + " · " + esc(g.plus_one_phone) +
                ' <a data-help="admin-apex-club#club#5" class="gbtn wa" href="https://wa.me/' + esc(g.plus_one_phone) + "?text=" +
                encodeURIComponent(buildClubWhatsAppText(ev, Object.assign({}, g, { name: g.plus_one_name }))) +
                '" target="_blank" rel="noopener">WhatsApp</a> ' +
                clubMsgEditBtn(g.id, "plus") +
                ' <button data-help="admin-apex-club#club#5" class="gbtn" onclick="openPlusOneSheet(\'' + g.id + '\')">' + t("Editar", "Edit") + "</button></div>"
              : '<div class="guest-plusone"><span class="chip-missing">' + t("Acompanhante: faltando", "Plus one: missing") + '</span>' +
                ' <button data-help="admin-apex-club#club#5" class="gbtn" onclick="openPlusOneSheet(\'' + g.id + '\')">' + t("Adicionar", "Add") + "</button></div>";
          }
          return '<div class="guest-row' + (isNext ? " is-next" : "") + '">' +
            '<span class="guest-name">' + esc(g.name) +
              (g.plus_one ? '<span class="plus">+1</span>' : "") +
              (isNext ? ' <span class="tag-meta">(' + (isEn() ? "next time" : "pr&oacute;xima") + ")</span>" : "") +
              (g.company ? '<span class="guest-company">' + esc(g.company) + "</span>" : "") +
              (evPaid ? clubPayBadge(g) + clubZelleReview(g) : "") +
              plusOneLine +
            "</span>" +
            '<span class="guest-tools">' +
              '<a data-help="admin-apex-club#club#4" class="gbtn wa" href="https://wa.me/' + esc(g.phone) + "?text=" +
                encodeURIComponent(waText) + '" target="_blank" rel="noopener" ' +
                'onclick="markClubConfirmed(\'' + g.id + '\')" ' + clubTip("Abrir o WhatsApp com a mensagem de confirma&ccedil;&atilde;o deste convidado", "Open WhatsApp with this guest&#39;s confirmation message") + '>WhatsApp</a>' +
              clubMsgEditBtn(g.id, "guest") +
              (clubIsMoneyRole()
                ? '<button data-help="admin-apex-club#club#5" class="gbtn' + (g.plus_one ? " on" : "") + '" onclick="toggleClubPlusOne(\'' + g.id + '\',' + (g.plus_one ? "true" : "false") + ')" ' + clubTip("Traz mais uma pessoa (conta dois lugares)", "Bringing one more person (counts as two seats)") + '>+1</button>' +
                  '<button data-help="admin-apex-club#club#4" class="gbtn' + (isNext ? " on" : "") + '" onclick="toggleClubNextTime(\'' + g.id + '\',' + (isNext ? "true" : "false") + ')" ' +
                    clubTip("N&atilde;o vem desta vez; vem na pr&oacute;xima", "Not coming this time; coming to the next one") + '>&rarr;</button>' +
                  '<button data-help="admin-apex-club#club#4" class="gbtn' + (g.attended === 1 ? " on" : "") + '" onclick="setClubAttended(\'' + g.id + '\',' + (g.attended === 1 ? "null" : "1") + ')" ' +
                    clubTip("Veio ao evento", "Came to the event") + '>&check;</button>' +
                  '<button data-help="admin-apex-club#club#4" class="gbtn' + (g.attended === 0 ? " on" : "") + '" onclick="setClubAttended(\'' + g.id + '\',' + (g.attended === 0 ? "null" : "0") + ')" ' +
                    clubTip("N&atilde;o veio", "Did not show up") + '>&times;</button>' +
                  (evPaid ? clubPayTools(g) : "")
                : "") +
            "</span></div>";
        }).join("");

        // Open by default only on the newest event. CLUB_SHOW_GUESTS holds
        // an explicit choice once she clicks, which then overrides the
        // default in either direction.
        var guestsOpen = CLUB_SHOW_GUESTS.hasOwnProperty(ev.id)
          ? CLUB_SHOW_GUESTS[ev.id]
          : (ev.id === newestId);

        guests =
          '<div class="club-guests">' +
            '<div class="club-count">' +
              '<span class="n">' + (r.going || 0) + "</span> " +
              (isEn() ? (r.going === 1 ? "person coming" : "people coming")
                      : (r.going === 1 ? "pessoa confirmada" : "pessoas confirmadas")) +
              (regs.length
                ? ' <button data-help="admin-apex-club#club#3" class="club-guests-toggle" onclick="toggleClubGuests(\'' + ev.id + '\')">' +
                    (guestsOpen ? t("ocultar lista", "hide list") : t("ver lista", "show list")) +
                  "</button>"
                : "") +
            "</div>" +
            '<div class="club-count-sub">' +
              (isEn()
                ? (r.going_rows || 0) + " registration(s)" +
                  (r.next_time ? " &middot; " + r.next_time + " coming next time" : "") +
                  (r.attended ? " &middot; " + r.attended + " came" : "") +
                  (r.no_show ? " &middot; " + r.no_show + " no-show" : "")
                : (r.going_rows || 0) + " inscri&ccedil;&atilde;o(&otilde;es)" +
                  (r.next_time ? " &middot; " + r.next_time + " na pr&oacute;xima" : "") +
                  (r.attended ? " &middot; " + r.attended + " vieram" : "") +
                  (r.no_show ? " &middot; " + r.no_show + " n&atilde;o vieram" : "")) +
            "</div>" +
            (regs.length
              ? (guestsOpen ? guestRows : "")
              : '<div class="club-count-sub" style="margin:0">' +
                  (isEn() ? "Nobody has signed up yet. Share the link."
                          : "Ningu&eacute;m se inscreveu ainda. Compartilhe o link.") +
                "</div>") +
            (regs.length
              ? '<div class="club-people-bar">' +
                  '<button data-help="admin-apex-club#club#3" class="btn btn-sm" onclick="toggleClubPeople(\'' + ev.id + '\')">' + t("Pessoas", "People") + "</button>" +
                  '<button data-help="admin-apex-club#club#6" class="btn btn-sm" onclick="copyClubPeopleList(\'' + ev.id + '\')">' + t("Copiar lista", "Copy list") + "</button>" +
                "</div>" +
                '<div class="club-people" id="clubPeople-' + ev.id + '" hidden>' + clubPeopleRows(ev, regs) + "</div>"
              : "") +
            // The link is the whole growth path -- it has to be trivially
            // copyable, and Share opens the native sheet straight to WhatsApp.
            '<div class="club-link">' +
              "<code>" + esc(regUrl) + "</code>" +
              '<button class="btn btn-sm" onclick="copyClubLink(\'' + ev.id + '\')">' +
                '<span class="show-pt">Copiar</span><span class="show-en">Copy</span></button>' +
              '<button data-help="admin-apex-club#club#6" class="btn btn-sm btn-gold" onclick="shareClubLink(\'' + ev.id + '\')">' +
                '<span class="show-pt">Compartilhar</span><span class="show-en">Share</span></button>' +
            "</div>" +
          "</div>";

        return '<div class="club-event">' + hero + head + detail + guests + sug + dis + "</div>";
      }).join("");

      applyFinBilingualAttrs();
    }

    // ── "Pessoas": one row per person going (the guest, and a plus-one as
    // its own row), each with its own WhatsApp button filled with that
    // person's own name and number, reusing the exact template the guest's
    // own button already fills (buildClubWhatsAppText). The plus-one's
    // button opens WhatsApp but marks no state -- only the guest's own
    // button does that, same as today.
    function clubPeopleRows(ev, regs) {
        var rows = [];
        regs.forEach(function (g) {
            if (g.rsvp_state !== "going") { return; }
            rows.push({ name: g.name, phone: g.phone, isPlusOne: false, regId: g.id, guest: g });
            if (g.plus_one && g.plus_one_name && g.plus_one_phone) {
                rows.push({ name: g.plus_one_name, phone: g.plus_one_phone, isPlusOne: true, of: g.name, regId: g.id, guest: g });
            }
        });
        return rows.map(function (p) {
            var waText = buildClubWhatsAppText(ev, Object.assign({}, p.guest, { name: p.name }));
            var label = p.isPlusOne ? t("Acompanhante de ", "Plus one of ") + esc(p.of) : esc(p.name);
            return '<div class="guest-row">' +
                '<span class="guest-name">' + label + "</span>" +
                '<span class="guest-tools">' +
                  '<a data-help="admin-apex-club#club#4" class="gbtn wa" href="https://wa.me/' + esc(p.phone) + "?text=" + encodeURIComponent(waText) + '" target="_blank" rel="noopener"' +
                    (p.isPlusOne ? "" : ' onclick="markClubConfirmed(\'' + p.regId + '\')"') + ">WhatsApp</a>" +
                  clubMsgEditBtn(p.regId, p.isPlusOne ? "plus" : "guest") +
                "</span></div>";
        }).join("") || '<div class="club-count-sub">' + t("Ninguém confirmado ainda.", "Nobody confirmed yet.") + "</div>";
    }

    function toggleClubPeople(eventId) {
        var el = document.getElementById("clubPeople-" + eventId);
        if (el) { el.hidden = !el.hidden; }
    }

    // "Nome, numero", guests first then plus-ones, no duplicates by number,
    // only registrations that are going.
    function copyClubPeopleList(eventId) {
        var e = null;
        for (var i = 0; i < CLUB_EVENTS.length; i++) {
            if (CLUB_EVENTS[i].event.id === eventId) { e = CLUB_EVENTS[i]; break; }
        }
        if (!e) { return; }
        var regs = (e.registrations || []).filter(function (g) { return g.rsvp_state === "going"; });
        var seenPhones = {};
        var lines = [];
        regs.forEach(function (g) {
            if (seenPhones[g.phone]) { return; }
            seenPhones[g.phone] = true;
            lines.push(g.name + ", " + g.phone);
        });
        regs.forEach(function (g) {
            if (!g.plus_one || !g.plus_one_name || !g.plus_one_phone) { return; }
            if (seenPhones[g.plus_one_phone]) { return; }
            seenPhones[g.plus_one_phone] = true;
            lines.push(g.plus_one_name + ", " + g.plus_one_phone);
        });
        copyTextToClipboard(lines.join("\n")).then(function () {
            toast(lines.length + " " + t("pessoas", "people"));
        });
    }

    // ── Edit the WhatsApp message for ONE send ───────────────────────────
    // "Editar msg" next to each WhatsApp button opens an on-page sheet (never
    // a browser pop-up) with the exact text buildClubWhatsAppText gives that
    // person. The edit is for this one send only: nothing is saved, the
    // Settings template is untouched, closing the sheet throws it away.
    // Opening WhatsApp from here marks the guest confirmed exactly as the
    // plain button does; a plus-one's marks nothing, same as today.
    var CLUB_MSG = null;
    function clubMsgEditBtn(regId, kind) {
      return ' <button data-help="admin-settings-pictures-message#pics#3" class="gbtn" onclick="openClubMsgEdit(\'' + regId + '\',\'' + kind + '\')" ' +
        clubTip("Editar a mensagem antes de abrir o WhatsApp", "Edit the message before opening WhatsApp") + ">" +
        t("Editar msg", "Edit msg") + "</button>";
    }
    function clubMsgFind(regId, kind) {
      var found = null;
      CLUB_EVENTS.forEach(function (e) {
        (e.registrations || []).forEach(function (g) {
          if (!found && g.id === regId) { found = { ev: e.event || e, g: g }; }
        });
      });
      if (!found) { return null; }
      var isPlus = kind === "plus";
      var guest = isPlus ? Object.assign({}, found.g, { name: found.g.plus_one_name }) : found.g;
      return {
        regId: regId, isPlus: isPlus, ev: found.ev, guest: guest,
        name: isPlus ? found.g.plus_one_name : found.g.name,
        phone: isPlus ? found.g.plus_one_phone : found.g.phone,
        text: buildClubWhatsAppText(found.ev, guest)
      };
    }
    function openClubMsgEdit(regId, kind) {
      var m = clubMsgFind(regId, kind);
      if (!m) { return; }
      CLUB_MSG = m;
      document.getElementById("cmWho").textContent = (m.name || "") + " · " + (m.phone || "");
      document.getElementById("cmText").value = m.text;
      var digits = String(m.phone || "").replace(/\D/g, "");
      var bad = digits.length < 10;
      var errEl = document.getElementById("cmErr");
      errEl.textContent = bad ? t("Este contato não tem um número de WhatsApp válido.", "This contact has no valid WhatsApp number.") : "";
      errEl.hidden = !bad;
      document.getElementById("cmOpenBtn").disabled = bad;
      document.getElementById("clubMsgOverlay").hidden = false;
    }
    function closeClubMsgEdit() {
      document.getElementById("clubMsgOverlay").hidden = true;
      CLUB_MSG = null;
    }
    function resetClubMsgEdit() {
      if (CLUB_MSG) { document.getElementById("cmText").value = CLUB_MSG.text; }
    }
    function openClubMsgWhatsApp() {
      if (!CLUB_MSG) { return; }
      var digits = String(CLUB_MSG.phone || "").replace(/\D/g, "");
      var text = document.getElementById("cmText").value;
      var errEl = document.getElementById("cmErr");
      if (digits.length < 10) { return; }
      if (!text.trim()) { errEl.textContent = t("Escreva a mensagem.", "Write the message."); errEl.hidden = false; return; }
      var a = document.createElement("a");
      a.href = "https://wa.me/" + digits + "?text=" + encodeURIComponent(text);
      a.target = "_blank"; a.rel = "noopener";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      if (!CLUB_MSG.isPlus) { markClubConfirmed(CLUB_MSG.regId); }
      closeClubMsgEdit();
    }

    // Plus-one Adicionar/Editar sheet: an on-page sheet (never a browser
    // pop-up), saving through the same registration edit route the Worker
    // already validates (POST .../registrations/:id).
    var CLUB_PLUSONE_REG_ID = null;
    function openPlusOneSheet(regId) {
        CLUB_PLUSONE_REG_ID = regId;
        var g = null;
        for (var i = 0; i < CLUB_EVENTS.length && !g; i++) {
            (CLUB_EVENTS[i].registrations || []).forEach(function (r) { if (r.id === regId) { g = r; } });
        }
        var nameEl = document.getElementById("poName"), phoneEl = document.getElementById("poPhone");
        if (nameEl)  { nameEl.value = g ? (g.plus_one_name || "") : ""; }
        if (phoneEl) { phoneEl.value = g ? (g.plus_one_phone || "") : ""; }
        var errEl = document.getElementById("poErr");
        if (errEl) { errEl.hidden = true; }
        var ov = document.getElementById("plusOneOverlay");
        if (ov) { ov.hidden = false; }
    }
    function closePlusOneSheet() {
        var ov = document.getElementById("plusOneOverlay");
        if (ov) { ov.hidden = true; }
        CLUB_PLUSONE_REG_ID = null;
    }
    function savePlusOneSheet() {
        var name = document.getElementById("poName").value.trim();
        var phone = document.getElementById("poPhone").value.trim();
        var errEl = document.getElementById("poErr");
        if (name.length < 2) { errEl.textContent = t("Escreva o nome do acompanhante.", "Write the plus one's name."); errEl.hidden = false; return; }
        if (phone.replace(/\D/g, "").length < 10) { errEl.textContent = t("Escreva um número de WhatsApp válido.", "Write a valid WhatsApp number."); errEl.hidden = false; return; }
        apiFetch("/api/finance-new/club/registrations/" + CLUB_PLUSONE_REG_ID, {
            method: "POST", body: { plus_one_name: name, plus_one_phone: phone }
        }).then(function (r) { return r.json(); })
          .then(function (d) {
              if (d.error) { errEl.textContent = d.error; errEl.hidden = false; return; }
              closePlusOneSheet();
              loadClub();
          })
          .catch(function () { errEl.textContent = t("Erro", "Error"); errEl.hidden = false; });
    }

    function setHtml(id, html) {
      var el = document.getElementById(id);
      if (el) { el.innerHTML = html; }
    }

    // The WhatsApp confirmation template Alice can edit in Settings. Loaded
    // once; a failure is silent because buildClubWhatsAppText falls back to
    // a plain message rather than producing an empty draft.
    function loadBusinessSettings() {
      return apiFetch("/api/business/settings")
        .then(function(r) { return r.json(); })
        .then(function(d) { BUSINESS_SETTINGS = (d && d.settings) || null; })
        .catch(function() {});
    }

    // Apex Club nights sitting on the calendar with no registration page.
    // Loaded alongside the events so the gap surfaces itself in Alice's
    // workflow rather than waiting to be noticed.
    var CLUB_UNLINKED = [];

    function loadClubUnlinked() {
      return apiFetch("/api/finance-new/club/unlinked")
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(d) {
          CLUB_UNLINKED = (d && d.sessions) || [];
          renderClubUnlinked();
        })
        .catch(function() {});
    }

    function renderClubUnlinked() {
      var box = document.getElementById("clubUnlinked");
      if (!box) { return; }
      if (!CLUB_UNLINKED.length) { box.hidden = true; box.innerHTML = ""; return; }

      box.hidden = false;
      box.innerHTML = CLUB_UNLINKED.map(function(s) {
        return '<div class="club-unlinked-row">' +
          '<div class="grow">' +
            "<b>" + esc(s.client_name || "Apex Club") + "</b> &middot; " + fmtDate(s.date) +
            '<div class="club-unlinked-sub">' +
              '<span class="show-pt">Está no calendário, mas ainda não tem página de inscrição.</span>' +
              '<span class="show-en">On the calendar, but has no registration page yet.</span>' +
            "</div>" +
          "</div>" +
          '<button data-help="admin-apex-club#club#8" class="btn btn-sm btn-gold" onclick="setUpClubFromSession(\'' + s.id + '\')">' +
            '<span class="show-pt">Configurar</span>' +
            '<span class="show-en">Set up</span>' +
          "</button>" +
        "</div>";
      }).join("");
      applyFinBilingualAttrs();
    }

    // Creates the club event from what the calendar entry already knows, then
    // opens the edit modal for the parts Google could never have asked for:
    // price, flyer, speakers.
    function setUpClubFromSession(sessionId) {
      var s = null;
      for (var i = 0; i < CLUB_UNLINKED.length; i++) {
        if (CLUB_UNLINKED[i].id === sessionId) { s = CLUB_UNLINKED[i]; break; }
      }
      if (!s) { return; }

      apiFetch("/api/finance-new/club/events", {
        method: "POST",
        body: {
          name: (s.client_name || "Apex Club").trim(),
          event_date: s.date,
          start_time: s.time ? fmtTime12(s.time) : null,
          venue: s.location || null,
          session_id: s.id
        }
      })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d.error) { toast(d.error); return; }
          var el = document.getElementById("eventMonth");
          if (el && s.date) { el.value = String(s.date).slice(0, 7); }
          // Reload, then open the modal so she lands straight on the fields
          // that are still missing.
          // Refresh both lists, then open the modal on the new event so she
          // lands straight on the fields that are still missing. Calls the
          // two loaders directly rather than loadClub(), which would re-enter
          // loadClubUnlinked and loop.
          return apiFetch("/api/finance-new/club/events")
            .then(function(r2) { return r2.json(); })
            .then(function(d2) {
              CLUB_EVENTS = (d2 && d2.events) || [];
              renderClub();
              return loadClubUnlinked();
            })
            .then(function() {
              if (d.event && d.event.id) { openClubEvModal(d.event.id); }
            });
        })
        .catch(function() { toast(t("Erro", "Error")); });
    }

    // "19:30" -> "7:30 PM". The calendar stores 24h; the event carries the
    // string that gets printed on the registration page.
    function fmtTime12(hhmm) {
      var p = String(hhmm || "").split(":");
      if (p.length < 2) { return null; }
      var h = parseInt(p[0], 10), m = p[1];
      if (!isFinite(h)) { return null; }
      var ap = h >= 12 ? "PM" : "AM";
      var h12 = h % 12; if (h12 === 0) { h12 = 12; }
      return h12 + ":" + m + " " + ap;
    }

    // ── Add someone by hand (bottom of the page) ─────────────────────────
    function agFillLabels() {
      var set = function (id, ph) { var e = document.getElementById(id); if (e) { e.placeholder = ph; } };
      set("agName", t("Nome", "Name"));
      set("agPhone", t("WhatsApp (com DDD)", "WhatsApp number"));
      set("agCompany", t("Empresa (opcional)", "Company (optional)"));
      set("agPlusOneName", t("Nome do acompanhante", "Plus-one name"));
      set("agPlusOnePhone", t("WhatsApp do acompanhante", "Plus-one WhatsApp"));
    }
    function agRenderEvents() {
      var card = document.getElementById("clubAddGuestCard");
      var sel = document.getElementById("agEvent");
      if (!card || !sel) { return; }
      if (!CLUB_EVENTS.length) { card.hidden = true; return; }
      var keep = sel.value;
      var html = "";
      for (var i = 0; i < CLUB_EVENTS.length; i++) {
        var ev = CLUB_EVENTS[i].event || CLUB_EVENTS[i];
        var dd = String(ev.event_date || "").split("-");
        var shown = dd.length === 3 ? (dd[1] + "/" + dd[2] + "/" + dd[0]) : "";
        html += '<option value="' + ev.id + '">' + String(ev.name || "").replace(/</g, "&lt;") + (shown ? " - " + shown : "") + "</option>";
      }
      sel.innerHTML = html;
      if (keep) { sel.value = keep; }
      if (!sel.value && sel.options.length) { sel.selectedIndex = 0; }
      agFillLabels();
      card.hidden = false;
    }
    function agTogglePlusOne() {
      var on = document.getElementById("agPlusOne").checked;
      var box = document.getElementById("agPlusOneFields");
      if (box) { box.hidden = !on; box.style.display = on ? "flex" : "none"; }
    }
    function saveAddGuest() {
      var st = document.getElementById("agStatus");
      var btn = document.getElementById("agSaveBtn");
      var val = function (id) { var e = document.getElementById(id); return e ? e.value : ""; };
      var plus = document.getElementById("agPlusOne").checked;
      if (btn) { btn.disabled = true; }
      if (st) { st.textContent = ""; }
      apiFetch("/api/finance-new/club/registrations", { method: "POST", body: {
        event_id: val("agEvent"), name: val("agName"), phone: val("agPhone"), company: val("agCompany"),
        plus_one: plus, plus_one_name: val("agPlusOneName"), plus_one_phone: val("agPlusOnePhone")
      } }).then(function (r) { return r.json(); }).then(function (d) {
        if (btn) { btn.disabled = false; }
        if (d.error) { if (st) { st.textContent = t(d.error_pt || d.error, d.error_en || d.error); } return; }
        var nm = val("agName");
        ["agName", "agPhone", "agCompany", "agPlusOneName", "agPlusOnePhone"].forEach(function (id) { var e = document.getElementById(id); if (e) { e.value = ""; } });
        document.getElementById("agPlusOne").checked = false;
        agTogglePlusOne();
        if (st) { st.textContent = d.updated_existing ? t(nm + " j\u00e1 estava na lista; dados atualizados.", nm + " was already on the list; details updated.") : t(nm + " foi adicionado(a).", nm + " was added."); }
        loadClub();
      }).catch(function () {
        if (btn) { btn.disabled = false; }
        if (st) { st.textContent = t("N\u00e3o foi poss\u00edvel adicionar. Tente de novo.", "Could not add. Please try again."); }
      });
    }
    document.addEventListener("apex:langchange", function () { agFillLabels(); });

    function loadClub() {
      loadBusinessSettings();
      loadClubUnlinked();
      return apiFetch("/api/finance-new/club/events")
        .then(function(r) { return r.json(); })
        .then(function(d) {
          CLUB_EVENTS = (d && d.events) || [];
          renderClub();
          agRenderEvents();
        })
        .catch(function() {});
    }

    function confirmClubTxn(eventId, txnId, side, people) {
      apiFetch("/api/finance-new/club/confirm", {
        method: "POST",
        body: { event_id: eventId, items: [{ transaction_id: txnId, side: side, people: people }] }
      })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d.error) { toast(d.error); return; }
          loadClub();
        })
        .catch(function() { toast(t("Erro", "Error")); });
    }

    // "Not this one." Scoped to THIS event on purpose -- she can say a payment
    // is not the July dinner from what is on screen; she cannot say it is
    // never Apex Club. The transaction is not touched and stays in Categorias
    // waiting to be filed wherever it actually belongs.
    function dismissClubTxn(eventId, txnId) {
      apiFetch("/api/finance-new/club/confirm", {
        method: "POST",
        body: { event_id: eventId, items: [{ transaction_id: txnId, dismiss: true }] }
      })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d.error) { toast(d.error); return; }
          toast(t("Removido deste evento", "Removed from this event"));
          loadClub();
        })
        .catch(function() { toast(t("Erro", "Error")); });
    }

    function undismissClubTxn(eventId, txnId) {
      apiFetch("/api/finance-new/club/confirm", {
        method: "POST",
        body: { event_id: eventId, items: [{ transaction_id: txnId, undismiss: true }] }
      })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d.error) { toast(d.error); return; }
          loadClub();
        })
        .catch(function() { toast(t("Erro", "Error")); });
    }

    function toggleClubGuests(eventId) {
      // Read the CURRENT state (default included) before flipping, so the
      // first click on a collapsed past event opens it rather than being
      // swallowed by an undefined.
      var body = document.getElementById("clubBody");
      var open = CLUB_SHOW_GUESTS.hasOwnProperty(eventId)
        ? CLUB_SHOW_GUESTS[eventId]
        : (body && body.getAttribute("data-newest") === eventId);
      CLUB_SHOW_GUESTS[eventId] = !open;
      renderClub();
    }

    function toggleClubDismissed(eventId) {
      CLUB_SHOW_DISMISSED[eventId] = !CLUB_SHOW_DISMISSED[eventId];
      renderClub();
    }

    // ── Event create / edit ─────────────────────────────────────────────
    //
    // This replaced two chained prompt boxes. The old flow asked for a
    // name, then a date, with no way to see what it would ask before
    // answering, no price field at all, and no cancel once started.
    var CLUB_EV_EDITING = null;   // event id, or null when creating

    function createClubEvent() { openClubEvModal(null); }

    function openClubEvModal(eventId) {
      CLUB_EV_EDITING = eventId || null;
      var e = null;
      if (eventId) {
        for (var i = 0; i < CLUB_EVENTS.length; i++) {
          if (CLUB_EVENTS[i].event.id === eventId) { e = CLUB_EVENTS[i].event; break; }
        }
      }

      setHtml("clubEvTitle", e
        ? '<span class="show-pt">Editar evento</span><span class="show-en">Edit event</span>'
        : '<span class="show-pt">Novo evento</span><span class="show-en">New event</span>');

      document.getElementById("evName").value        = e ? (e.name || "") : "";
      document.getElementById("evDate").value        = e ? (e.event_date || "") : "";
      document.getElementById("evTime").value        = e ? (e.start_time || "") : "";
      document.getElementById("evVenue").value       = e ? (e.venue || "") : "";
      document.getElementById("evSpeakers").value    = e ? (e.speakers || "") : "";
      document.getElementById("evNotes").value       = e ? (e.notes || "") : "";
      document.getElementById("evWinStart").value    = e ? (e.window_start || "") : "";
      document.getElementById("evWinEnd").value      = e ? (e.window_end || "") : "";

      // Shown in dollars, stored in cents. A NEW event starts with the price
      // boxes EMPTY (no default): empty means Apex is not charging. An
      // existing one shows its own saved price, and blank when it has none.
      var evHasPrice = clubEventCharged(e);
      document.getElementById("evPriceSingle").value = evHasPrice ? centsToInput(e.price_single_cents) : "";
      document.getElementById("evPriceCouple").value = evHasPrice ? centsToInput(e.price_couple_cents) : "";

      // Card prices: ticked only when this event already has one.
      var hasCard = !!(evHasPrice && e.price_card_single_cents !== null && e.price_card_single_cents !== undefined);
      var cs = document.getElementById("evPriceCardSingle"), cc = document.getElementById("evPriceCardCouple");
      document.getElementById("evCardOn").checked = hasCard;
      cs.value = hasCard ? centsToInput(e.price_card_single_cents) : "";
      cc.value = hasCard ? centsToInput(e.price_card_couple_cents) : "";
      // A stored price counts as typed: it is never overwritten by the prefill.
      if (hasCard) { cs.setAttribute("data-touched", "1"); cc.setAttribute("data-touched", "1"); }
      else { cs.removeAttribute("data-touched"); cc.removeAttribute("data-touched"); }
      evCardApply();
      evPriceApply();

      document.getElementById("evDeleteBtn").hidden = !e;
      document.getElementById("clubEvErr").hidden = true;
      document.getElementById("evWindowRow").hidden = true;
      setEvMoreLabel();

      document.getElementById("clubEvOverlay").hidden = false;
      applyFinBilingualAttrs();
    }

    function closeClubEvModal() {
      document.getElementById("clubEvOverlay").hidden = true;
      CLUB_EV_EDITING = null;
    }

    function toggleEvWindow() {
      var row = document.getElementById("evWindowRow");
      row.hidden = !row.hidden;
      setEvMoreLabel();
    }

    function setEvMoreLabel() {
      var open = !document.getElementById("evWindowRow").hidden;
      document.getElementById("evMoreBtn").textContent = open
        ? t("Ocultar janela de pagamentos", "Hide payment window")
        : t("Ajustar janela de pagamentos", "Adjust payment window");
    }

    function centsToInput(c) {
      if (c === null || c === undefined || c === "") { return ""; }
      return (c / 100).toFixed(2);
    }

    // The default card price for a Zelle price: Stripe's 2.9% + 30 cents
    // grossed up, rounded UP to a whole dollar (5000 gives 5200, 7500 gives
    // 7800). MIRRORS clubCardPriceFromZelle in the Worker; keep them equal.
    function clubCardPriceFromZelle(zelleCents) {
      var z = Number(zelleCents) || 0;
      if (z <= 0) { return null; }
      return Math.ceil((z + 30) / 0.971 / 100) * 100;
    }
    // An Apex Club event either has a price per person (a positive number
    // of cents) or has none: then Apex collects nothing for it and nothing
    // on this page asks about a payment. There is no default price.
    function clubEventCharged(ev) {
      return !!ev && Number(ev.price_single_cents) > 0;
    }
    // The couple price and the "accept card" tick only make sense with a
    // price per person. With the box empty (or 0) they are disabled and
    // cleared, and one muted line says why.
    function evPriceApply() {
      var singleEl = document.getElementById("evPriceSingle");
      var coupleEl = document.getElementById("evPriceCouple");
      var cardOn = document.getElementById("evCardOn");
      var help = document.getElementById("evNoPriceHelp");
      if (!singleEl || !coupleEl || !cardOn) { return; }
      var cents = dollarsToCents(singleEl.value);
      var none = cents === null || isNaN(cents);
      coupleEl.disabled = none;
      cardOn.disabled = none;
      if (help) { help.hidden = !none; }
      if (none) {
        coupleEl.value = "";
        if (cardOn.checked) { cardOn.checked = false; }
        var cs = document.getElementById("evPriceCardSingle"), cc = document.getElementById("evPriceCardCouple");
        if (cs) { cs.value = ""; cs.removeAttribute("data-touched"); }
        if (cc) { cc.value = ""; cc.removeAttribute("data-touched"); }
        evCardApply();
      }
    }
    // Shows or hides the card fields and relabels the two existing price
    // fields as "Zelle price" while card is ticked.
    function evCardApply() {
      var on = document.getElementById("evCardOn").checked;
      document.getElementById("evCardSingleWrap").hidden = !on;
      document.getElementById("evCardCoupleWrap").hidden = !on;
      document.getElementById("evCardHelp").hidden = !on;
      setHtml("evLblSingle", on
        ? '<span class="show-pt">Pre&ccedil;o no Zelle (individual)</span><span class="show-en">Zelle price (single)</span>'
        : '<span class="show-pt">Valor por pessoa</span><span class="show-en">Price per person</span>');
      setHtml("evLblCouple", on
        ? '<span class="show-pt">Pre&ccedil;o no Zelle (casal)</span><span class="show-en">Zelle price (couple)</span>'
        : '<span class="show-pt">Valor por casal</span><span class="show-en">Price per couple</span>');
    }
    // Fills the card prices from the Zelle prices. force = she just ticked
    // the box; otherwise only a field she has not typed in follows along.
    function evCardPrefill(force) {
      if (!document.getElementById("evCardOn").checked) { return; }
      var pairs = [["evPriceSingle", "evPriceCardSingle"], ["evPriceCouple", "evPriceCardCouple"]];
      for (var i = 0; i < pairs.length; i++) {
        var card = document.getElementById(pairs[i][1]);
        if (!force && card.getAttribute("data-touched") === "1") { continue; }
        if (force && card.value.trim()) { continue; }
        var z = dollarsToCents(document.getElementById(pairs[i][0]).value);
        var c = (z === null || isNaN(z)) ? null : clubCardPriceFromZelle(z);
        card.value = c === null ? "" : centsToInput(c);
      }
    }
    function evCardToggle() {
      evCardApply();
      evCardPrefill(true);
    }

    // "80", "80.00", "$80", "80,00" -> 8000. Returns null for blank, which
    // is meaningful for the couple price (this event has no couple rate).
    function dollarsToCents(raw) {
      var s = String(raw == null ? "" : raw).trim().replace(/[^0-9.,]/g, "").replace(",", ".");
      if (!s) { return null; }
      var n = parseFloat(s);
      if (!isFinite(n) || n <= 0) { return NaN; }
      return Math.round(n * 100);
    }

    // The price-per-person box: blank and 0 both mean "no price" (0). A
    // positive amount gives its cents. Anything else is NaN.
    function clubSinglePriceCents(raw) {
      var s = String(raw == null ? "" : raw).trim().replace(/[^0-9.,]/g, "").replace(",", ".");
      if (!s) { return 0; }
      var n = parseFloat(s);
      if (!isFinite(n) || n < 0) { return NaN; }
      return Math.round(n * 100);
    }

    function saveClubEvent() {
      var name = document.getElementById("evName").value.trim();
      var date = document.getElementById("evDate").value.trim();

      if (!name) { return evErr(t("Dê um nome ao evento.", "Give the event a name.")); }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { return evErr(t("Escolha uma data.", "Pick a date.")); }

      // Empty or 0 = no price: Apex is not charging for this event. Saved as
      // 0 with the couple and card prices NULL. Never a default.
      var single = clubSinglePriceCents(document.getElementById("evPriceSingle").value);
      if (isNaN(single)) {
        return evErr(t("Valor por pessoa precisa ser um número, ou vazio.", "Price per person must be a number, or blank."));
      }
      var couple = null;
      if (single > 0) {
        couple = dollarsToCents(document.getElementById("evPriceCouple").value);
        if (isNaN(couple)) {
          return evErr(t("Valor por casal precisa ser um número, ou vazio.", "Price per couple must be a number, or blank."));
        }
      }

      // Card prices: sent as NULL when the box is unticked (card not offered).
      var cardSingle = null, cardCouple = null;
      if (single > 0 && document.getElementById("evCardOn").checked) {
        cardSingle = dollarsToCents(document.getElementById("evPriceCardSingle").value);
        if (cardSingle === null || isNaN(cardSingle)) {
          return evErr(t("Preço no cartão (individual) precisa ser um número.", "Card price (single) must be a number."));
        }
        cardCouple = dollarsToCents(document.getElementById("evPriceCardCouple").value);
        if (isNaN(cardCouple)) {
          return evErr(t("Preço no cartão (casal) precisa ser um número, ou vazio.", "Card price (couple) must be a number, or blank."));
        }
      }

      var body = {
        name: name,
        event_date: date,
        start_time: document.getElementById("evTime").value.trim() || null,
        venue: document.getElementById("evVenue").value.trim() || null,
        speakers: document.getElementById("evSpeakers").value.trim() || null,
        notes: document.getElementById("evNotes").value.trim() || null,
        price_single_cents: single,
        price_couple_cents: couple,
        price_card_single_cents: cardSingle,
        price_card_couple_cents: cardCouple
      };
      var ws = document.getElementById("evWinStart").value.trim();
      var we = document.getElementById("evWinEnd").value.trim();
      if (ws) { body.window_start = ws; }
      if (we) { body.window_end = we; }

      var url = CLUB_EV_EDITING
        ? "/api/finance-new/club/events/" + CLUB_EV_EDITING
        : "/api/finance-new/club/events";

      apiFetch(url, { method: CLUB_EV_EDITING ? "PUT" : "POST", body: body })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d.error) { return evErr(d.error); }
          // Jump the picker to the event's month, or saving one outside the
          // current view looks like it did nothing.
          var el = document.getElementById("eventMonth");
          if (el) { el.value = date.slice(0, 7); }
          closeClubEvModal();
          loadClub();
        })
        .catch(function() { evErr(t("Erro", "Error")); });
    }

    function evErr(msg) {
      var el = document.getElementById("clubEvErr");
      el.textContent = msg;
      el.hidden = false;
    }

    function deleteClubEvent() {
      if (!CLUB_EV_EDITING) { return; }
      // Deleting removes the RSVPs and the confirmations with it. The
      // TRANSACTIONS survive -- this un-files the money, it does not erase
      // it -- but the guest list is gone for good, so it is worth a stop.
      pageDialog({
        message: t(
          "Excluir este evento? A lista de inscritos ser\u00e1 perdida. Os lan\u00e7amentos no banco n\u00e3o s\u00e3o apagados.",
          "Delete this event? The guest list will be lost. Bank transactions are not deleted."
        ),
        yes: t("Sim, excluir o evento", "Yes, delete the event"),
        keep: t("Manter o evento", "Keep the event"),
        onYes: function() {

        apiFetch("/api/finance-new/club/events/" + CLUB_EV_EDITING, { method: "DELETE" })
          .then(function(r) { return r.json(); })
          .then(function(d) {
            if (d.error) { return evErr(d.error); }
            closeClubEvModal();
            loadClub();
          })
          .catch(function() { evErr(t("Erro", "Error")); });
        }
      });
    }

    // ── Guest list actions ──────────────────────────────────────────────

    function updateClubReg(regId, body) {
      return apiFetch("/api/finance-new/club/registrations/" + regId, { method: "POST", body: body })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d.error) { toast(d.error); return; }
          loadClub();
        })
        .catch(function() { toast(t("Erro", "Error")); });
    }

    function toggleClubPlusOne(regId, isOn)  { updateClubReg(regId, { plus_one: !isOn }); }
    function toggleClubNextTime(regId, isOn) { updateClubReg(regId, { rsvp_state: isOn ? "going" : "next_time" }); }
    function setClubAttended(regId, val)     { updateClubReg(regId, { attended: val }); }

    // Stamped when she opens the WhatsApp thread. It records that the
    // message was STARTED, not that it was sent -- wa.me hands off to
    // WhatsApp and nothing comes back.
    function markClubConfirmed(regId) {
      apiFetch("/api/finance-new/club/registrations/" + regId, {
        method: "POST", body: { confirmed: true }
      }).catch(function() {});
    }

    // Fills the Settings template. Falls back to a plain message if none is
    // set, so a missing template never produces an empty WhatsApp draft.
    // ── Apex Club payments on the guest list ─────────────────────────────
    // Shown only with the Apex Club payments switch ON, or to the developer.
    function clubPayVisible() {
      if (!clubIsMoneyRole()) { return false; }
      return APX_SWITCHES.club_pay_enabled === true || APX_SWITCHES.role === "developer";
    }
    // One badge per guest, or nothing.
    function clubPayBadge(g) {
      if (!clubPayVisible()) { return ""; }
      var label = "", cls = "pay-badge";
      if (g.paid_at) {
        cls += " ok";
        label = g.paid_method === "card" ? t("Pago cartão", "Paid by card")
              : g.paid_method === "zelle" ? t("Pago Zelle", "Paid by Zelle")
              : t("Pago manual", "Paid manually");
      } else if (g.zelle_state === "review") { cls += " warn"; label = t("Conferir Zelle", "Check Zelle"); }
      else if (g.zelle_state === "mismatch") { cls += " warn"; label = t("Valor diferente", "Different amount"); }
      else if (g.zelle_conf) {
        // Waiting for the bank feed; after 5 days it is called out.
        var days = g.zelle_conf_at ? (Date.now() - new Date(String(g.zelle_conf_at).replace(" ", "T") + (/[Zz]$/.test(g.zelle_conf_at) ? "" : "Z")).getTime()) / 86400000 : 0;
        if (days > 5) { cls += " warn"; label = t("Confirmação não encontrada", "Confirmation not found"); }
        else { label = t("Aguardando banco", "Waiting for bank"); }
      }
      return label ? '<span class="' + cls + '">' + label + "</span>" : "";
    }
    // A guest whose Zelle number needs Alice's eyes (review or mismatch): the
    // deposit found for it, and the two answers.
    function clubZelleReview(g) {
      if (!clubPayVisible() || g.paid_at || (g.zelle_state !== "review" && g.zelle_state !== "mismatch")) { return ""; }
      var c = g.zelle_candidate;
      var info = c
        ? esc(c.payer || "Zelle") + " &middot; " + fmtCents(c.amount_cents) + " &middot; " + fmtDate(c.date) +
          (g.zelle_state === "mismatch" ? " (" + t("esperado", "expected") + " " + fmtCents(c.expected_cents) + ")" : "")
        : "Conf# " + esc(g.zelle_conf || "");
      return '<span class="zelle-review">' + info + " " +
        '<button data-help="admin-apex-club#club#4" class="gbtn" onclick="clubZelleDecide(\'' + g.id + '\', \'confirm-zelle\')">' + t("Confirmar", "Confirm") + "</button>" +
        '<button data-help="admin-apex-club#club#4" class="gbtn" onclick="clubZelleDecide(\'' + g.id + '\', \'reject-zelle\')">' + t("Não é este", "Not this one") + "</button>" +
        "</span>";
    }
    function clubZelleDecide(regId, action) {
      apiFetch("/api/finance-new/club/registrations/" + regId + "/" + action, { method: "POST" })
        .then(function(r) { return r.json().catch(function() { return {}; }); })
        .then(function(d) {
          if (d && d.error) { toast(d.error); return; }
          loadClub();
        })
        .catch(function() { toast(t("Erro", "Error")); });
    }
    // What a guest-row button does, shown at once on hover or keyboard focus
    // (the browser's own title tooltip waits about a second and never shows
    // on a touch screen). Returns the attributes for the button's tag.
    function clubTip(pt, en) {
      var text = isEn() ? en : pt;
      return 'data-tip="' + text + '" aria-label="' + text + '"';
    }
    function clubPayTools(g) {
      if (!clubPayVisible()) { return ""; }
      var h = '<button data-help="admin-apex-club#club#4" class="gbtn" onclick="copyClubPayLink(\'' + g.id + '\')" ' + clubTip("Copiar o link da p&aacute;gina de pagamento deste convidado", "Copy the link to this guest&#39;s payment page") + '>' + t("Copiar link de pagamento", "Copy payment link") + "</button>";
      if (!g.paid_at) {
        h += '<button data-help="admin-apex-club#club#4" class="gbtn" onclick="markClubPaid(\'' + g.id + '\', true)" ' + clubTip("Marcar como pago &agrave; m&atilde;o (dinheiro ou outro meio)", "Mark as paid by hand (cash or another way)") + '>' + t("Marcar como pago", "Mark as paid") + "</button>";
      } else if (g.paid_method === "manual") {
        // The same button, lit: tapping it again takes the manual mark back.
        h += '<button data-help="admin-apex-club#club#4" class="gbtn on" onclick="markClubPaid(\'' + g.id + '\', false)" ' + clubTip("Marcado como pago &agrave; m&atilde;o. Toque para desfazer", "Marked as paid by hand. Tap to undo") + '>' + t("Marcar como pago", "Mark as paid") + "</button>";
      }
      return h;
    }
    function copyClubPayLink(regId) {
      apiFetch("/api/finance-new/club/registrations/" + regId + "/pay-link", { method: "POST" })
        .then(function(r) { return r.json().catch(function() { return {}; }); })
        .then(function(d) {
          if (!d || d.error || !d.url) { throw new Error((d && d.error) || "erro"); }
          return copyTextToClipboard(d.url).then(function() { toast(t("Link copiado.", "Link copied.")); });
        })
        .catch(function(e) { toast(t("Não foi possível copiar o link: ", "Could not copy the link: ") + (e.message || "")); });
    }
    function markClubPaid(regId, paid) {
      apiFetch("/api/finance-new/club/registrations/" + regId + "/mark-paid", { method: "POST", body: { paid: paid } })
        .then(function(r) { return r.json().catch(function() { return {}; }); })
        .then(function(d) {
          if (d && d.error) { toast(d.error); return; }
          loadClub();
        })
        .catch(function() { toast(t("Erro", "Error")); });
    }

    // Removes the payment lines from a message template: any line with the
    // {valor} placeholder, the word Zelle, or a payment word (pagamento,
    // pagar, pague, payment, pay link). Blank lines left doubled by a removed
    // line are closed up.
    function clubDropPaymentLines(tpl) {
      var kept = String(tpl || "").split("\n").filter(function(line) {
        return !/\{valor\}|zelle|pagamento|pagar|pague|payment|pay link/i.test(line);
      });
      return kept.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");
    }

    function buildClubWhatsAppText(ev, guest) {
      var tpl = (BUSINESS_SETTINGS && BUSINESS_SETTINGS.club_confirm_template) || "";
      if (!tpl) {
        tpl = "Oi {nome}! Confirmando sua presença no {evento}, dia {data} às {hora}, em {local}.";
      }
      // An event Apex does not charge for: every line of the template that
      // carries the price, Zelle or a payment is left out. Every other line
      // goes out exactly as written.
      var charged = clubEventCharged(ev);
      if (!charged) { tpl = clubDropPaymentLines(tpl); }
      // The Zelle side, worked out here as it always was. The Worker's
      // clubPriceFor() is the one source of truth for what a guest owes.
      var price = "";
      if (charged) {
        price = fmtCents(ev.price_single_cents);
        if (guest && guest.plus_one && ev.price_couple_cents) { price = fmtCents(ev.price_couple_cents); }
      }

      return tpl
        .replace(/\{nome\}/g,   (guest && guest.name ? String(guest.name).split(" ")[0] : ""))
        .replace(/\{evento\}/g, ev.name || "Apex Club")
        .replace(/\{data\}/g,   fmtDate(ev.event_date))
        .replace(/\{hora\}/g,   ev.start_time || "")
        .replace(/\{local\}/g,  ev.venue || "")
        .replace(/\{valor\}/g,  price);
    }

    // ── Registration link ───────────────────────────────────────────────

    function clubRegUrl(eventId) {
      var match = CLUB_EVENTS.filter(function (e) { return e.event && e.event.id === eventId; })[0];
      return (match && match.register_link) || (PUBLIC_BASE + "/club.html?e=" + eventId);
    }

    function copyClubLink(eventId) {
      var url = clubRegUrl(eventId);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url)
          .then(function() { toast(t("Link copiado", "Link copied")); })
          .catch(function() { promptCopyFallback(url); });
      } else {
        promptCopyFallback(url);
      }
    }

    function promptCopyFallback(url) {
      pageDialog({
        message: t("Copie o link:", "Copy the link:"),
        field: { value: url, readonly: true },
        keep: t("Fechar", "Close")
      });
    }

    function shareClubLink(eventId) {
      var url = clubRegUrl(eventId);
      if (navigator.share) {
        navigator.share({ title: "Apex Club", url: url }).catch(function() {});
      } else {
        window.open("https://wa.me/?text=" + encodeURIComponent(url), "_blank");
      }
    }
