// Builds the HTML for the three seller-material PDFs.
//
// Design notes, since "premium" was the explicit ask and the constraints pull
// against each other:
//
//   * The client logo is a dark navy square crest. The pages are WHITE and the
//     logo sits on a small contained navy plate in the header — a dark
//     full-bleed would be unprintable and would drink a rep's ink, so the brand
//     colour appears as accent rules and rails instead of as background.
//   * The logo is passed in as a data URI by the caller, which reads it from R2
//     at logos/<client_id>.<ext> off clients.logo_url. Nothing here knows which
//     client it is rendering — no hardcoded JM path.
//   * `break-inside: avoid` on every message card is the load-bearing rule: a
//     WhatsApp opener split across a page break is unusable, because the rep is
//     copying it as one block.
//   * Body text is 12.5pt with generous leading. These get opened one-handed on
//     a phone in someone's backyard, not read at a desk.
//   * Emoji render as real colour glyphs through the system emoji font; Chrome
//     embeds them as images in the PDF. `font-variant-emoji` and an explicit
//     "Apple Color Emoji" first in the stack keep them from falling back to
//     monochrome boxes.

// "Apple Color Emoji" must come LAST. Putting an emoji font first makes Chrome
// attempt it for Latin text too and fall back glyph-by-glyph, which wrecks the
// text metrics — words end up spaced as though the line were justified. Latin
// resolves from the UI font, and only the emoji codepoints (which no earlier
// family covers) reach the emoji font at the end.
const FONT_STACK = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif, "Apple Color Emoji"';
const SERIF = 'Georgia, "Times New Roman", serif, "Apple Color Emoji"';

const NAVY = "#0e2340";
const GOLD = "#c98434";
const INK = "#1b2733";
const MUTED = "#6b7885";
const RULE = "#e3e8ee";

function esc(s) {
    return String(s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Message bodies carry meaningful blank lines (paragraph breaks in WhatsApp).
// Escape first, then convert newlines — never the reverse, or the <br> would be
// escaped into visible markup.
function bodyHtml(text) {
    return esc(text).replace(/\n/g, "<br>");
}

function baseCss() {
    return `
    @page {
      size: Letter;
      /* Top margin reserves the running header's band on EVERY page. A
         padding-top on the flow only clears it once, at the very top, so
         pages 2+ ran their body text straight under the header. The header
         is 74px + 9px padding-bottom ~= 22mm; 30mm leaves breathing room
         under the rule before text starts. */
      margin: 30mm 15mm 16mm 15mm;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: ${FONT_STACK};
      color: ${INK};
      font-size: 12.5pt;
      line-height: 1.62;
      -webkit-font-smoothing: antialiased;
      /* NO font-variant-emoji here. ASCII digits 0-9 are dual-presentation
         codepoints (they are the base characters of the keycap emoji), so
         setting that property to "emoji" forces them through the emoji font and
         "30 dias" renders as "3 0  dias" with the digits in a mismatched face.
         The emoji in the copy already carry explicit emoji presentation of
         their own, so they need no help from this property. */
      /* Ragged right, explicitly. Justified body copy at this measure opens
         rivers between words and is harder to read on a phone. */
      text-align: left;
      word-spacing: normal;
      letter-spacing: normal;
      /* Lining figures so Georgia's oldstyle digits do not sit below the
         baseline in the day badges and card numbers. */
      font-variant-numeric: lining;
    }

    /* ── Running header ──────────────────────────────────────────────────
       position: fixed inside an @page context repeats on EVERY page, which
       is what puts the client logo at the top of each one without hand-
       placing it per page. The space it occupies is reserved by the @page
       TOP MARGIN, not by padding on the flow -- padding only clears the
       header once, at the top of the document, so pages 2+ used to run
       their body text straight underneath it. */
    .runhead {
      position: fixed;
      /* Negative top pulls the header UP into the @page top margin that was
         reserved for it, so it sits in the margin band rather than in the
         content area where it would overlap the flow. */
      top: -16mm; left: 0; right: 0;
      height: 74px;
      display: flex;
      align-items: center;
      gap: 13px;
      border-bottom: 2px solid ${NAVY};
      padding-bottom: 9px;
    }
    .runhead .plate {
      width: 52px; height: 52px;
      flex: 0 0 52px;
      background: ${NAVY};
      border-radius: 7px;
      display: flex; align-items: center; justify-content: center;
      overflow: hidden;
    }
    .runhead .plate img { width: 100%; height: 100%; object-fit: contain; display: block; }
    .runhead .brand { line-height: 1.25; }
    .runhead .brand .name {
      font-family: ${SERIF};
      font-size: 13.5pt;
      letter-spacing: .045em;
      color: ${NAVY};
      font-weight: 700;
    }
    .runhead .brand .kicker {
      font-size: 7.8pt;
      letter-spacing: .17em;
      text-transform: uppercase;
      color: ${GOLD};
      font-weight: 700;
    }
    .runhead .doclabel {
      margin-left: auto;
      font-size: 8pt;
      letter-spacing: .13em;
      text-transform: uppercase;
      color: ${MUTED};
      text-align: right;
      max-width: 46%;
    }

    /* No padding-top: the @page top margin now reserves the header band on
       every page. Padding here would only indent page 1 and double-space it. */
    .sheet { padding-top: 0; }

    /* ── Title block, first page only ─────────────────────────────────── */
    .title-wrap { margin-bottom: 26px; }
    .eyebrow {
      font-size: 8.4pt; letter-spacing: .2em; text-transform: uppercase;
      color: ${GOLD}; font-weight: 700; margin-bottom: 7px;
    }
    h1 {
      font-family: ${SERIF};
      font-size: 27pt; line-height: 1.15; margin: 0 0 10px;
      color: ${NAVY}; font-weight: 700; letter-spacing: -.005em;
    }
    .standfirst {
      font-size: 11pt; color: ${MUTED}; margin: 0;
      max-width: 82%; line-height: 1.5;
    }
    .rule-gold { height: 3px; width: 62px; background: ${GOLD}; margin: 16px 0 0; border-radius: 2px; }

    /* ── Message card ─────────────────────────────────────────────────────
       break-inside: avoid keeps a full WhatsApp message on one page. */
    .card {
      break-inside: avoid;
      page-break-inside: avoid;
      margin: 0 0 22px;
      border: 1px solid ${RULE};
      border-left: 4px solid ${GOLD};
      border-radius: 9px;
      padding: 17px 20px 19px;
      background: #fcfdfe;
    }
    .card-head {
      display: flex; align-items: baseline; gap: 9px;
      margin-bottom: 3px;
    }
    .card-num {
      font-family: ${SERIF}; font-size: 15pt; font-weight: 700;
      color: ${GOLD}; line-height: 1;
    }
    .card-title {
      font-size: 13pt; font-weight: 700; color: ${NAVY}; letter-spacing: -.005em;
    }
    .chip {
      margin-left: auto;
      font-size: 7.6pt; letter-spacing: .1em; text-transform: uppercase;
      color: ${NAVY}; background: #eef2f7;
      border-radius: 999px; padding: 3px 9px; font-weight: 700;
      white-space: nowrap;
    }
    .pick {
      font-size: 9.6pt; color: ${MUTED}; font-style: italic;
      margin: 0 0 12px; padding-bottom: 11px; border-bottom: 1px dashed ${RULE};
    }
    .msg {
      margin: 0;
      white-space: normal;
      font-size: 12.5pt;
      line-height: 1.66;
    }

    /* ── Objection pairs ──────────────────────────────────────────────── */
    .obj {
      break-inside: avoid; page-break-inside: avoid;
      margin: 0 0 20px; border: 1px solid ${RULE}; border-radius: 9px;
      overflow: hidden;
    }
    .obj-q {
      background: ${NAVY}; color: #fff;
      padding: 12px 18px;
      font-size: 12.5pt; font-weight: 700;
      display: flex; align-items: baseline; gap: 9px;
    }
    .obj-q .qn {
      font-family: ${SERIF}; color: ${GOLD}; font-size: 12pt;
    }
    .obj-a { padding: 15px 18px 17px; background: #fff; }
    .obj-a .lbl {
      font-size: 7.8pt; letter-spacing: .15em; text-transform: uppercase;
      color: ${GOLD}; font-weight: 700; display: block; margin-bottom: 6px;
    }
    .obj-a p { margin: 0; font-size: 12.2pt; line-height: 1.6; }

    /* ── Cadence timeline ─────────────────────────────────────────────── */
    .tl { margin: 0; padding: 0; list-style: none; }
    .tl li {
      break-inside: avoid; page-break-inside: avoid;
      display: flex; gap: 16px; align-items: flex-start;
      padding: 0 0 18px; position: relative;
    }
    /* The connecting rail. Drawn on the marker column so it lines up with the
       centre of each day badge; the last item stops it so it does not dangle. */
    .tl li:not(:last-child)::before {
      content: "";
      position: absolute;
      left: 33px; top: 44px; bottom: 0;
      width: 2px; background: ${RULE};
    }
    .tl .day {
      flex: 0 0 68px;
      background: ${NAVY}; color: #fff;
      border-radius: 8px; text-align: center;
      padding: 8px 4px 9px;
      position: relative; z-index: 1;
    }
    .tl .day .d1 {
      display: block; font-size: 7.2pt; letter-spacing: .14em;
      text-transform: uppercase; color: ${GOLD}; font-weight: 700;
    }
    .tl .day .d2 {
      display: block; font-family: ${SERIF}; font-size: 17pt;
      font-weight: 700; line-height: 1.1;
    }
    .tl .what {
      padding-top: 7px; font-size: 12.2pt; line-height: 1.55;
      border-bottom: 1px solid ${RULE}; padding-bottom: 16px; flex: 1;
    }
    .tl li:last-child .what { border-bottom: none; }

    .foot {
      margin-top: 26px; padding-top: 12px; border-top: 1px solid ${RULE};
      font-size: 9pt; color: ${MUTED}; line-height: 1.5;
    }
    .foot strong { color: ${NAVY}; }
  `;
}

function header(clientName, logoDataUri, docLabel) {
    var plate = logoDataUri
        ? '<div class="plate"><img src="' + logoDataUri + '" alt=""></div>'
        : "";
    return '<div class="runhead">' + plate +
        '<div class="brand">' +
        '<div class="kicker">Materiais do Vendedor</div>' +
        '<div class="name">' + esc(clientName) + '</div>' +
        '</div>' +
        '<div class="doclabel">' + esc(docLabel) + '</div>' +
        '</div>';
}

function page(opts) {
    return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
        '<title>' + esc(opts.title) + '</title>' +
        '<style>' + baseCss() + '</style></head><body>' +
        header(opts.clientName, opts.logo, opts.docLabel) +
        '<div class="sheet">' +
        '<div class="title-wrap">' +
        '<div class="eyebrow">' + esc(opts.eyebrow) + '</div>' +
        '<h1>' + esc(opts.title) + '</h1>' +
        '<p class="standfirst">' + esc(opts.standfirst) + '</p>' +
        '<div class="rule-gold"></div>' +
        '</div>' +
        opts.body +
        '</div></body></html>';
}

export function renderScripts(c) {
    var body = "";
    c.messages.forEach(function(m) {
        body += '<div class="card">' +
            '<div class="card-head">' +
            '<span class="card-num">' + esc(m.n) + '</span>' +
            '<span class="card-title">' + esc(m.title) + '</span>' +
            '<span class="chip">' + esc(m.channel) + '</span>' +
            '</div>' +
            '<p class="pick">' + esc(m.pick) + '</p>' +
            '<p class="msg">' + bodyHtml(m.body) + '</p>' +
            '</div>';
    });
    body += '<div class="card">' +
        '<div class="card-head">' +
        '<span class="card-num">04</span>' +
        '<span class="card-title">' + esc(c.instagram.title) + '</span>' +
        '<span class="chip">' + esc(c.instagram.channel) + '</span>' +
        '</div>' +
        '<p class="pick">Para publicar no seu perfil — alcança todo mundo de uma vez.</p>' +
        '<p class="msg">' + bodyHtml(c.instagram.body) + '</p>' +
        '</div>';
    body += '<p class="foot"><strong>[NOME]</strong> — troque pelo primeiro nome da pessoa antes de enviar.</p>';

    return page({
        clientName: c.clientName, logo: c.logo,
        docLabel: "Scripts de Abordagem",
        eyebrow: "Primeiro contato",
        title: "Scripts de Abordagem",
        standfirst: "As três primeiras mensagens são o mesmo anúncio em tons diferentes. " +
            "Escolha pelo quanto você conhece a pessoa — não envie as três para o mesmo contato.",
        body: body
    });
}

export function renderObjections(c) {
    var body = "";
    c.objections.forEach(function(o) {
        body += '<div class="obj">' +
            '<div class="obj-q"><span class="qn">' + esc(o.n) + '</span>' +
            '<span>&ldquo;' + esc(o.objection) + '&rdquo;</span></div>' +
            '<div class="obj-a"><span class="lbl">Resposta</span>' +
            '<p>' + esc(o.response) + '</p></div>' +
            '</div>';
    });
    body += '<p class="foot">Responda com calma e sempre volte para o mesmo pedido: ' +
        '<strong>a visita e o estimate gratuito</strong>.</p>';

    return page({
        clientName: c.clientName, logo: c.logo,
        docLabel: "Objeções",
        eyebrow: "Quando ouvir um não",
        title: "Objeções",
        standfirst: "As quatro objeções mais comuns e como responder sem pressionar.",
        body: body
    });
}

export function renderCadence(c) {
    var body = '<ul class="tl">';
    c.cadence.forEach(function(step) {
        // "DIA 01" → the word and the number are styled separately, so the
        // badge reads as a unit at a glance on a phone.
        var parts = String(step.day).split(/\s+/);
        body += '<li>' +
            '<div class="day"><span class="d1">' + esc(parts[0]) + '</span>' +
            '<span class="d2">' + esc(parts[1] || "") + '</span></div>' +
            '<div class="what">' + esc(step.text) + '</div>' +
            '</li>';
    });
    body += '</ul>';
    body += '<p class="foot">Referência de consulta — <strong>o acompanhamento é manual</strong>. ' +
        'Marque você mesmo o próximo contato depois de cada toque.</p>';

    return page({
        clientName: c.clientName, logo: c.logo,
        docLabel: "Cadência de Follow-Up",
        eyebrow: "Depois da visita",
        title: "Cadência de Follow-Up",
        standfirst: "Seis toques em 30 dias. A maioria das vendas acontece depois do terceiro contato — " +
            "a cadência existe para você não parar no segundo.",
        body: body
    });
}
