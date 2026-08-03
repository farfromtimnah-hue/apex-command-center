# Item 4 — Importing a Google-created series into Apex's series model

**Status: recommend NOT building the automatic import as specified.**
**Recommend a narrower, safe alternative instead. Nicole's call.**

Written 2026-08-03 after reading the actual rows in production D1. The prompt
explicitly allows this: *"Refusing clearly is acceptable if that proves too
complex — but say so rather than importing something half-working."*

The reason is not complexity. It is that the mechanical step the prompt
specifies — *"replace each row's instance id with the master id"* — would
corrupt real client data, because a premise behind it turns out to be false.

---

## The premise that does not hold

The prompt treats each of the three series as *one Google master = one client*.
Two of the three are not.

Master `ksokvnu3etp208ujfs3qn2dlq0` — the one behind the JM LUXURY POOL rows —
has **four different client names** across its instances:

| Instance date | Time | client_name in Apex | client_id |
|---|---|---|---|
| 2026-07-06 | 19:30 | `RDE - CAROL E LAECIO PRESENCIAL` | NULL |
| 2026-07-13 | 17:30 | `Juliano` | NULL |
| 2026-07-20 | 17:30 | `Rafael e Kenia - Gator` | NULL |
| 2026-07-27 | 17:30 | `Juliano` | NULL |
| 2026-08-17 | 17:30 | `JM LUXURY POOL - RDE` | `cc1b026c…` |
| 2026-08-24 | 17:30 | `JM LUXURY POOL - RDE` | `cc1b026c…` |
| 2026-08-31 | 17:30 | `JM LUXURY POOL - RDE` | `cc1b026c…` |

Note also 2026-07-06 at **19:30**, a different time from the rest — an
occurrence Rafa moved on Google.

Master `0vf6uo74ccuk667j5sbcem5fa9` (METZ) has the same shape, plus a
type change: its July instances are `RDE - METZ` and the July 9 one is
`online_meet` while July 15 and 23 are `in_person`. Only master
`744e69bkrue0nrob0s7l8lbjss` (JONATAS ISRAEL) is genuinely one client
throughout.

**What this means.** These are not three clean client series. They are
recurring *slots* on Rafa's calendar — a standing weekly appointment block —
whose occupant has changed over time, with individual occurrences retitled,
retimed and even switched between Meet and in-person. Google models that
perfectly well: each modified instance is its own exception hanging off the
master.

## Why the specified mechanical step is unsafe

> *"generate a series_id, set it on every row of the series, and replace each
> row's instance id with the master id"*

Applied to `ksokvnu3etp208ujfs3qn2dlq0`, this would:

1. **Destroy the only pointer back to each real Google occurrence.** The
   instance id (`…_20260817T213000Z`) is what identifies one specific dated
   occurrence. Overwrite it with the bare master id and all seven rows point at
   the same Google event. Editing any single occurrence then edits, or is
   ambiguous across, all of them.

2. **Bind four unrelated clients into one Apex "series."** A scope-dialog
   "Edit all" on the JM rows would sweep in Juliano, Carol e Laécio, and
   Gator — three other clients' meetings. That is precisely the class of bug
   that made the double-booking worth chasing in the first place.

3. **Be effectively irreversible.** The instance ids exist nowhere else. Once
   overwritten, reconstructing which row was which occurrence means re-reading
   Google and re-matching by date — and for the retimed 19:30 row, guessing.

The existing code already assumes what this would violate. `handlePatchSessionDetails`
resolves a single-occurrence edit with:

```js
var lookup = await findGoogleInstanceId(accessToken, session.google_event_id, session.date);
```

It looks the instance up *from the master by date*. That works only while
one master maps to one coherent series. It also silently assumes the row's
`date` still matches Google's — which for the moved 19:30 occurrence it does
not.

## The infinite-recurrence problem is real but secondary

The prompt is right that these masters have no `COUNT` and no `UNTIL`, and
right that requiring an end date is a feature. Item 3 now supplies exactly the
mechanism: duration presets that always yield a bounded count.

But writing an `UNTIL` to `ksokvnu3etp208ujfs3qn2dlq0` **ends the shared slot
for every client who has ever occupied it**, not just JM LUXURY POOL. Bounding
that series is not a JM decision.

---

## Recommendation

**Do not build the automatic adopt-a-series import.** Instead:

### 1. Leave the hand-migrated rows exactly as they are (no work)

They are correct and working today. Each occurrence is individually editable
and each carries a valid instance id, so single-occurrence edits already go to
the right Google occurrence. What is missing is only the *series* scope dialog.

### 2. Ship "Convert to an Apex series" as an explicit, per-client, forward-only action

Rather than adopting Google's master, **create a new Apex-owned series** for
the client from a chosen start date, and leave the historical Google rows
untouched:

- Alice opens a JM LUXURY POOL occurrence → **Convert to Apex series**
- She picks a duration (Item 3's presets — always bounded)
- Apex creates **one new Google event** with a real bounded `RRULE`, titled for
  this client, and generates matching rows with a fresh `series_id`
- The old instance rows from the shared slot are **cancelled on Google
  individually**, by instance id, for this client only — never by touching the
  shared master
- Everything from that date forward is a clean, single-client, bounded, fully
  editable Apex series

This gets Nicole what she actually asked for — *"I would rather her be able to
edit it here"* — without ever writing to a master that other clients depend on.
It also matches how the app already works: `handlePostSessionsSchedule` creates
exactly this shape today.

**Cost:** one new endpoint plus a modal. Meaningfully more than the mechanical
rewrite, but it is the version that cannot corrupt anything.

### 3. Prerequisite: confirm the slot interpretation with Rafa

Before any of this, someone should confirm with Rafa that
`ksokvnu3etp208ujfs3qn2dlq0` really is a reused standing slot rather than a
series he considers "JM's". D1 says the former, but D1 only holds the ±7/+30
sync window — Google's master may carry history that changes the reading.

The read-only endpoint answers it without touching anything:

```
GET /api/google/calendar/event/0vf6uo74ccuk667j5sbcem5fa9
GET /api/google/calendar/event/ksokvnu3etp208ujfs3qn2dlq0
GET /api/google/calendar/event/744e69bkrue0nrob0s7l8lbjss
```

Each returns Google's own `recurrence` array, so the real rule — and whether
it has any bound at all — is one call away.

---

## What I did NOT do, and why

- **No rows were modified.** The hand-migration stands as-is, per the prompt.
- **No `series_id` was written**, no instance id overwritten, nothing sent to
  Google. Everything above comes from read-only D1 queries.
- **No backfill of `package_started_at`** for these clients, consistent with
  Item 3.

## If Nicole wants the original import anyway

It is buildable for **JONATAS ISRAEL alone** (`744e69bkrue0nrob0s7l8lbjss`),
the one master that genuinely maps to a single client throughout. Even there
the `UNTIL` write ends the real series on Rafa's calendar, so it needs his
agreement first — which, as the prompt says, is the conversation worth having
regardless.
