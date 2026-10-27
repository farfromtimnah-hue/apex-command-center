# Learn (Aprenda): how to write a guide

People see this feature as **Aprenda** in Portuguese and **Learn** in English.
The guide TEXT lives in one file, `help/guides.json`. The Worker bundles it, so a
guide edit needs one Worker deploy (`wrangler deploy`), never an iPhone build.

**What is private and what is not (security phase B).**

- Pictures, posters and videos are PRIVATE. They live in the R2 bucket bound as
  `ASSETS`, under the key prefix `help/` (same relative path as in the repo), and
  leave only through the Worker: `GET /api/help/file/<path>` with a signed link
  that lasts 15 minutes. The guide list route mints the links, one per file, only
  for guides the signed in person may see.
- The guide TEXT is still readable by anyone who reads this GitHub repository,
  because the repository is public (`help/guides.json` and its git history). The
  Worker only SERVES the text to the right login. It becomes private only when the
  repository itself is made private (a separate, later move). So never write
  anything secret in guide text.
- Older pictures were committed to the public repository before this change, so
  they stay in git history until that move. Treat them as public.
- Two guides are public on purpose, because they must work before sign in:
  `sign-in-screens` and `invited-person-sign-in` (tag `public`).

**New pictures and videos: never commit them.** Write them to the gitignored
folder `help-private/` instead, with the same shape as before:
`help-private/img/guides/<guide-id>/<name>.pt.jpg` (and `.en.jpg`), and
`help-private/video/<guide-id>-pt.mp4` (+ `.jpg` poster). The `image` paths in
`guides.json` stay `help/img/guides/<guide-id>/<name>.pt.jpg`. Then upload with
`node scripts/help-media-upload.mjs` (safe to run again; it sends only new or
changed files; `--dry-run` shows what it would send, `--check 20` compares byte
sizes of 20 uploaded files). Video `src` and `poster` keep the form
`https://apex.resonateai.online/help/video/<guide-id>-pt.mp4`; the Worker reads
only the path and replaces it with a signed link.

**Who sees a guide.** Every client guide needs a `who` list, and `guides.json` has
a top level `groups` object. See "Who sees a guide" below.

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
- The sides are enforced by the Worker (`GET /api/help/guides` answers from the
  verified login), but the guide text is only as private as the repository (see
  the top of this file).
- A screen overview (`pages`) shows only its guides that are on the person's
  current side. If none are left, the overview is left out.
- A side with no guides shows "Os guias deste lado estão sendo preparados."
  (staff) or "Os guias estão sendo preparados." (a client).
- The `help_gaps` table has an `audience` column (`migrations/help_gaps_audience.sql`):
  apply it before the Worker deploy that writes to it.

## When Apex does not do what the person asks

`POST /api/help/ask` also returns a `kind`, from the same model call:

- `answer`: a guide fits (forced whenever `guide_ids` is not empty).
- `missing_guide`: the feature exists but no guide covers it. The question is
  noted in `help_gaps` so a writer knows which guide to write.
- `new_feature`: Apex does not do it. Nothing is written. The page offers to send
  a suggestion.
- `unclear`: the model is not sure. Nothing is written. The page asks "learn or
  want Apex to do it?". "Aprender" posts the question again with `log_gap: true`
  (no model call) so it is noted as a missing guide.

The model sees the same feature guide the support chat uses (the staff app for
the admin side, the client portal for the client side) in the same cached system
block. Any other `kind` value becomes `unclear`.

`POST /api/help/suggest` (any signed in user) holds a short conversation and then
files one `support_tickets` row with kind `suggestion`. The questions turn the
wish into a function spec the owner can build from, and every ticket says whether
there is enough detail:

- Body: `{transcript, page_key, language, finish}` (staff may also send
  `audience`). The browser keeps the transcript: at most 14 items
  `{role, text}`, each cut to 600 characters, the first one the person's own
  question (3 to 300 characters).
- The model gathers six things: WHAT, TRIGGER, DATA, RESULT, WHO, RULES and
  limits. It sees the same app feature guide as `/api/help/ask`, chosen by the
  same audience rule. It does not ask about importance or how often.
- At most 5 questions (one constant in each file: `HELP_SUGGEST_MAX_QUESTIONS`
  and `HelpCore.SUGGEST_MAX_QUESTIONS`). The server forces the end when 5
  questions were asked, when `finish` is true and one was asked, or when the
  person sent 6 messages. It never asks a sixth.
- The model's final answer is `{done, spec:{what, trigger, data, result, who,
  rules, missing}, reply}`. A field the person did not give is `not said`. The
  server computes the verdict itself (`suggestReadiness`): `ready` when what,
  trigger, data and result are all real; `too_vague` when what or result is not
  said; otherwise `needs_detail`. Any readiness the model sends is dropped.
- `summary_en` holds nine lines: `READINESS`, `SIDE`, `WHAT`, `TRIGGER`, `DATA`,
  `RESULT`, `WHO`, `RULES`, `MISSING` (`helpSuggestSummary`). The Support list
  shows a small verdict label from the first line ("Pronta para construir",
  "Faltam detalhes", "Vaga demais"). Older suggestion tickets have no
  READINESS line and show no label.
- The response to the person is only `{done, question}` or `{done, reply,
  logged}`. It never includes the spec or the verdict. `logged` is true only when
  the ticket was saved; the page shows "Sugestão enviada." only then.
- Identity comes only from the signed in user. No alert is sent.
- Limits: 16 turns per 10 minutes per person and 40 per network address (in
  memory), and the same daily cap as support tickets (10 per person per day).
  A saved suggestion counts toward that cap.
- The pure rules live in `help-core.js` (`cleanTranscript`, `canFinish`,
  `nextSuggestState`, `validateSuggestTurn`, `suggestReadiness`,
  `helpSuggestSummary`); the Worker has twins, tested against the same cases.

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

## Who sees a guide

`groups` (top of the file) names sets of login kinds once:

- `all`: owner, partner, staff_finance, staff, seller.
- `office`: owner, partner, staff_finance, staff.
- `money`: owner, partner, staff_finance.
- `setup`: owner, partner.
- `public`: everyone, signed out too.

A client guide's `who` is a list of group names and single login kinds (`lead`
is never inside a group; name it in `who`). Example: `"who": ["money", "seller"]`.
Admin guides need no `who`: Alice, Rafa and the developer see every guide on both
sides, whatever `who` says. An unknown name hides the guide, and
`node scripts/test-help-system.mjs` fails on it. A new client guide with no `who`
list fails the test too. The login kind comes from the verified session on the
Worker, never from the request. There is no Apex seller login; the word
`apex_seller` is reserved only.

Rules of thumb: Finances, Invoices, Analytics, Pace and the daily log are
`money`. Anything in Ajustes (Settings) is `setup`. Staff without finance see
project cost and profit as part of their view, so project and pricing guides are
`office`. A lead only sees Assigned, Documents, language and sign in guides.

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

The pictures are private (R2, signed links). The guide text in the file is as private as the repository, which is public today: do not put anything secret in it.
