# Claude Code — universal rules

> **Note on this file (2026-07-29).** The session that added Rule 23 was asked
> to append it to `knowledge/claude-code-universal-rules.md`. That file did not
> exist anywhere in this repo, in git history, or elsewhere on the machine —
> only the rules quoted in the prompt (4, 12, 18) were known, and their exact
> wording was not. Rather than invent rules 1–22 and pass them off as canon,
> this file was created containing **only Rule 23**, written to the described
> structure (problem → rule → why it exists → the concrete instances).
>
> **If the real rules file exists somewhere else, move Rule 23 into it and
> delete this file.** The numbering assumes 22 existing rules, per the prompt's
> instruction to add "a new numbered rule"; renumber if that is wrong.

---

## Rule 23 — Local calendar dates never come from `toISOString()`

**The problem.** `new Date().toISOString()` is UTC. Anything derived from it —
`.slice(0, 10)` for a date, `.slice(0, 7)` for a month, `.split("T")[0]` — is a
*UTC* calendar date, not the viewer's. West of UTC those disagree every evening.
In Brazil (UTC−3) they diverge daily from 21:00; on the last day of a month, the
**month** rolls too. D1 stores UTC and the app displays Eastern, so the same trap
exists on the read path: slicing a stored timestamp takes its UTC calendar date
literally, *before* any conversion runs.

**The rule.**

1. **Never derive a local calendar date or month from `toISOString()`.** Use the
   project's local-date helpers: `localDateStr()` / `localMonthStr()` in
   `datetime.js` (loaded by every page), or `todayStr()` inside `portal.html`.
2. **Any stored timestamp that reaches a screen goes through the `datetime.js`
   helpers** — `formatDateTime`, `formatDateTimeUTC`, `formatDateUTC`. Never
   `.slice(0, 10)` a raw stored string: the slice happens *before* the
   conversion and takes the UTC calendar date literally. That is exactly what
   `786d0cc` fixed.
3. **`toISOString()` is still correct for a real UTC instant** — a timestamp
   being written to D1, an outbound API payload, a token expiry. The test is
   *what the value means*, not which function produced it: an instant is fine, a
   calendar date is not.
4. **Auditing this means checking seeds and comparisons, not just render
   calls.** A month-picker default or an `if (dueDate < today)` is exactly as
   dangerous as a formatted display — and is where the last three instances
   lived. `scripts/test-local-date-seeds.mjs` enforces this statically across
   every static file.

**Why it exists.** This has now shipped **four times**:

- `1465f5f` and `786d0cc` (2026-07-28) — stored UTC timestamps rendered as local
  dates by slicing before converting.
- `f05bedd` (2026-07-29) — `goalsMonth` seeded from `toISOString()`, while the
  server's `current_month` came from a local date. The two agreed all month
  except the last hours of the final day, which is precisely when the
  next-month-goals row needed to appear. It was suppressed at the exact moment
  it existed to fire.
- `85c7962` (2026-07-29) — `analyticsMonth`, the same seed one line away, plus
  four more: a recurring-invoice start-date default, a tax-summary "generated"
  stamp, a new-session date default, an overdue-task comparison that flagged
  tasks due *today* as overdue every evening, and `isPastEvent()` in
  `calendar.html`, which compared a UTC "today" against a local `session.date`
  and against local `getHours()` **in the same function**.

The 2026-07-28 audit caught the first two and missed the rest because it grepped
for *display formatting* — and these were *seeds*. One convention covering both
would have caught all four.

**Why it keeps getting missed.** The failure is invisible for most of the month.
It appears only in the last hours of the final day, in the evening, for users
west of UTC. It will not show up in casual testing, it will not show up in CI
running at midday UTC, and it will not show up on the developer's machine unless
they happen to look at the wrong hour on the wrong day. **Assume you cannot
reproduce it by clicking around — check it statically.**

**Contributing cause, now fixed.** `datetime.js` had display formatters but no
local-date *seed* helper, and `todayStr()` lived inside `portal.html` where no
other page could reach it. There was nowhere correct to call, so every page
open-coded `toISOString()`. `localDateStr()` / `localMonthStr()` now exist in
`datetime.js` for exactly this.
