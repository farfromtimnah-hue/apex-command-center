# Learn (Aprenda): how to write a guide

People see this feature as **Aprenda** in Portuguese and **Learn** in English.
The guides live in one file, `help/guides.json`. The pictures live in
`help/img/guides/`. The apps fetch both from the live site, so a new guide goes
out with a normal push and never needs an iPhone build.

The feature is switched off. It turns on when `enabled` in `help-config.js`
changes from `false` to `true` (and the same line in
`ios/App/App/public/help-config.js`). Before that, apply
`migrations/help_gaps.sql` and then `migrations/help_gaps_audience.sql`, once each.

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
  "audience": "client",
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
- `audience`: which side of Apex the guide is for. `"admin"` is the staff app
  (the people who work at Apex). `"client"` is the client portal (the owners who
  are Apex clients). The field is optional: a guide with no `audience` counts as
  `"client"`. Any other value is rejected by the check. Ids stay unique across
  both sides, so two guides on different sides can never share an id (give a
  pair on the same topic different ids, for example `invoice` and
  `admin-invoice`). See "The two sides" below.
- `title` and `summary`: shown on the cards. Keep the summary to one short line.
- `keywords`: words a person might type. The search uses them. Write the
  everyday words, in both languages.
- `video`: `null` (no video at all), or one entry per language:
  `{ "pt": { "src": "https://.../receipt-pt.mp4", "poster": "https://.../receipt-pt.jpg" }, "en": null }`.
  A language is `null` when it has no video. A language that is missing counts
  as no video too. The "Assistir ao vídeo" / "Watch the video" button shows only
  in a language that has a video.
  - `src`: the video file. Required, and it must start with `https://`. Use a
    short `.mp4`. It plays right inside the page (the person taps the button and
    it starts), never in a new window.
  - `poster`: the still picture shown on the button before the video starts.
    Optional. If you give one it must start with `https://`. With no poster the
    button shows a plain dark panel.
  - The old plain form still works: a language can be just an `https://` text,
    which means `{ "src": that text }` with no poster.
  - An address that does not start with `https://` is rejected by the check, and
    the page never uses it.
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

## The two sides

Every guide belongs to one side. A person who asks from the admin side gets admin
guides only. A client gets client guides only, and never sees anything about
sides: no button, no tag, no word.

- The client portal page (`portal.html`) starts on the client side. Every other
  page starts on the admin side. Staff who preview the portal through the Dev,
  Client or Seller views are still on `portal.html`, so they start on the client
  side.
- Only staff (the roles alice, rafa, developer and seller, decided by the Worker
  from the signed in user) get one small button to look at the other side. It
  reads "Ver guias do cliente" on the admin side and "Voltar aos guias do
  administrador" on the client side. The choice is not remembered: it starts
  over every time the sheet opens or help.html loads. Staff also see a small tag
  on each guide ("Lado administrador" or "Lado cliente").
- The sheet links to the full library as `help.html?audience=admin` or
  `help.html?audience=client`. For staff that is the starting side; any other
  value is ignored, and a person who is not staff always stays on client.
- A link to one guide (`help.html?guide=ID`) opens that guide on either side, and
  for staff it also sets the starting side to the guide's own side.
- The guide files are public. The sides keep people from being shown the wrong
  help by mistake. They are not a secret.
- A screen overview (`pages`) shows only its guides that are on the person's
  current side. If none are left, the overview is left out.
- A side with no guides shows "Os guias deste lado estão sendo preparados."
  (staff) or "Os guias estão sendo preparados." (a client).
- The `help_gaps` table has an `audience` column (`migrations/help_gaps_audience.sql`):
  apply it before the Worker deploy that writes to it.

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
that step. `lang` can be `pt` or `en`. Only plain ids are accepted. For staff,
`&audience=admin` or `&audience=client` picks the starting side.

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
