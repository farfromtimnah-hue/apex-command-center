# Learn (Aprenda): how to write a guide

People see this feature as **Aprenda** in Portuguese and **Learn** in English.
The guides live in one file, `help/guides.json`. The pictures live in
`help/img/guides/`. The apps fetch both from the live site, so a new guide goes
out with a normal push and never needs an iPhone build.

The feature is switched off. It turns on when `enabled` in `help-config.js`
changes from `false` to `true` (and the same line in
`ios/App/App/public/help-config.js`). Before that, apply
`migrations/help_gaps.sql` once.

## The file in plain words

`guides.json` has three parts:

- `version`: always `1`.
- `guides`: the list of guides. An empty list is valid.
- `pages`: an optional overview for a screen, keyed by the screen name.

Every visible text has two versions, `pt` and `en`. Neither may be empty. Do not
use a long dash or an en dash in any text.

## One guide

```json
{
  "id": "estimate",
  "title":   { "pt": "", "en": "" },
  "summary": { "pt": "", "en": "" },
  "keywords": { "pt": [], "en": [] },
  "video": null,
  "sections": [
    {
      "id": "send",
      "title": { "pt": "", "en": "" },
      "steps": [
        {
          "n": 1,
          "text":  { "pt": "", "en": "" },
          "image": { "pt": "help/img/guides/estimate/send-01.pt.jpg",
                     "en": "help/img/guides/estimate/send-01.en.jpg" }
        }
      ]
    }
  ],
  "buttons": [
    { "labels": { "pt": ["Salvar e enviar"], "en": ["Save and send"] },
      "section": "send", "step": 3 }
  ]
}
```

- `id`, and every section `id`: letters, digits, dash and underscore only.
  Ids must be unique (section ids only need to be unique inside their guide).
- `title` and `summary`: shown on the cards. Keep the summary to one short line.
- `keywords`: words a person might type. The search uses them. Write the
  everyday words, in both languages.
- `video`: `null`, or `{ "pt": "https://...", "en": "https://..." }`. Only
  https addresses are shown.
- `steps`: `n` starts at 1 and counts up inside the section. Label a step with
  the action ("Tap Save and send"), not "Step 1".
- `image`: `null` for a step with no picture. Paths are relative to the site
  root. The red boxes are drawn inside the picture files; the code draws none.
  Make one picture per language.
- `buttons`: connects a button on screen to a step. `labels` are the words on
  the button, in each language (all spellings you want matched). Accents and
  capital letters do not matter. `section` and `step` must exist in this guide.

A button can also name its guide directly in the page with a `data-help`
attribute: `data-help="estimate#send#3"` (guide, section, step; step optional).
That wins over matching by words. A button that must keep its own right click
can carry `data-no-help`.

## A page overview

```json
"pages": {
  "gmestimates": {
    "title":    { "pt": "Orçamentos", "en": "Estimates" },
    "guides":   ["estimate"],
    "overview": { "pt": "", "en": "" }
  }
}
```

The key is the screen name. In the client portal it is the tab name
(`gmcrm`, `gmestimates`, `gminvoices`, `gmjobs`, `gmfinance`, `gmcalendar`,
`gmpricing`, `gmroadmap`, `goals`, `invoices`, `documents`, `tasks`, `analytics`,
and so on). On a staff page it is the file name without `.html` (`dashboard`,
`calendar`, `clients`). A screen with no entry just skips the overview.

## Links to a guide

`help.html?guide=ID&section=SECTION&step=N&lang=pt` opens that guide scrolled to
that step. `lang` can be `pt` or `en`. Only plain ids are accepted.

## Check the file

```
node scripts/test-help-system.mjs
```

The test runs the same checks on the real file: both languages everywhere,
unique ids, every button pointing at a real section and step, every page
pointing at real guides.

To look at the screens before publishing, run a local server from the repo root
and open `help.html?fixture=1` on localhost. It reads the test guides in
`scripts/fixtures/` and changes nothing else.

The pictures and the file are public. Do not put anything private in them.
