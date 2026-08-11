-- Apex Club events carry their own details instead of inheriting hardcoded ones.
--
-- WHY: the price was two constants in the worker (APEX_CLUB_PRICE_SINGLE = 5000,
-- APEX_CLUB_PRICE_COUPLE = 7500) and those two numbers WERE the entire income
-- matching rule. Apex Club is not a fixed-price event -- the June night was a
-- churrascaria at roughly $80 a head -- so on any month that is not $50/$75 the
-- suggester silently proposes nothing on the income side and Alice has no idea
-- why the tool went quiet. Price belongs to the event, not to the codebase.
--
-- The rest of these columns are what the promo flyer already says (speakers,
-- venue, time) plus the flyer image itself, so the registration page can be
-- built from the event row rather than hand-written per month.
ALTER TABLE apex_club_events ADD COLUMN price_single_cents INTEGER NOT NULL DEFAULT 5000;

-- Nullable on purpose: some events are per-person only, with no couple rate.
-- NULL means "there is no couple price", which is different from a price of 0.
ALTER TABLE apex_club_events ADD COLUMN price_couple_cents INTEGER;

-- R2 key for the promo image sent out in the WhatsApp groups. Doubles as the
-- hero of the public registration page.
ALTER TABLE apex_club_events ADD COLUMN flyer_r2_key TEXT;

ALTER TABLE apex_club_events ADD COLUMN venue TEXT;
ALTER TABLE apex_club_events ADD COLUMN start_time TEXT;
ALTER TABLE apex_club_events ADD COLUMN speakers TEXT;

-- Whether the public link still accepts RSVPs. Closing registration must not
-- require deleting or hiding the event -- the P&L outlives the sign-up window.
ALTER TABLE apex_club_events ADD COLUMN registration_open INTEGER NOT NULL DEFAULT 1;

-- ---------------------------------------------------------------------------
-- Who said they are coming.
--
-- This is the FOOD COUNT, and it is the whole reason the table exists. Of the
-- nine confirmed July payments, two arrived before the dinner, six on the day
-- itself and one after -- so money cannot be the planning signal, because the
-- caterer is paid days before the money shows up. The RSVP is the only thing
-- that exists in time to be useful.
--
-- Deliberately NOT joined to transactions. Alice does not match guests to
-- payments; the categorization rule detects income by window and price, and
-- the event P&L answers the only money question that matters ("did this
-- dinner make money"). A per-guest payment column would recreate by hand
-- exactly the chase this design exists to remove.
CREATE TABLE IF NOT EXISTS apex_club_registrations (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL REFERENCES apex_club_events(id),
  name          TEXT NOT NULL,
  -- Stored normalized WITH country code. A bare 10-digit US number is a known,
  -- still-open failure mode for WhatsApp sends on the LTC project, and a wa.me
  -- link built from one silently goes nowhere. Normalized at the write path
  -- rather than trusting what someone typed on a phone.
  phone         TEXT NOT NULL,
  -- 'going'     -- signed up, counts toward the food order
  -- 'next_time' -- "vou na próxima": the culturally correct way to bow out.
  --                A hard no is not offered anywhere (see the standing rule in
  --                ltc-ministry-app-status.md), but silence is useless to
  --                Alice -- she cannot tell "not coming" from "hasn't looked
  --                at their phone". This is a promise, not a refusal, and it
  --                takes them off the count.
  rsvp_state    TEXT NOT NULL DEFAULT 'going'
                CHECK (rsvp_state IN ('going','next_time')),
  -- Set when Alice sends the WhatsApp confirmation for this guest.
  confirmed_at  TEXT,
  -- NULL until after the dinner, then 1/0. Tracked so the gap between "said
  -- yes" and "came" becomes a number: that gap is the empty place settings
  -- and the extra books, and after two or three events it is the discount to
  -- apply to the next food order.
  attended      INTEGER,
  source        TEXT NOT NULL DEFAULT 'public',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (event_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_club_reg_event ON apex_club_registrations(event_id);

-- ---------------------------------------------------------------------------
-- The WhatsApp confirmation template, editable by Alice in Settings.
--
-- Placeholders: {nome} {evento} {data} {hora} {local} {valor}
--
-- ⚠️ STANDING RULE -- the message must NEVER offer a direct decline option.
-- This is a Brazilian cultural requirement around indirect refusal, documented
-- in ltc-ministry-app-status.md, and it was already lost once by not carrying
-- forward into a vault. The default below asks for confirmation and frames it
-- as hospitality ("so I can get everything ready for you"), never as an
-- administrative yes/no.
ALTER TABLE business_settings ADD COLUMN club_confirm_template TEXT;

UPDATE business_settings
SET club_confirm_template =
  'Oi {nome}, tudo bem? 😊' || char(10) ||
  'Que bom que você vai estar com a gente no {evento}!' || char(10) || char(10) ||
  '📅 {data} às {hora}' || char(10) ||
  '📍 {local}' || char(10) ||
  'Valor: {valor}' || char(10) || char(10) ||
  'Me confirma sua presença para eu já deixar tudo certinho para você? 🙏'
WHERE id = 1 AND club_confirm_template IS NULL;

-- Weak-signal counter: how many people tapped "add to calendar" on the public
-- registration page. It records the TAP, not that the event reached anyone's
-- calendar -- the .ics leaves the browser and the rest is invisible. Kept only
-- to answer whether the button earns its place. Never read as attendance.
ALTER TABLE apex_club_events ADD COLUMN calendar_clicks INTEGER NOT NULL DEFAULT 0;

-- The Zelle QR decodes to a plain URL:
--   https://enroll.zellepay.com/qr-codes?data=<base64 {name, action, token}>
-- so the same destination can be a TAPPABLE BUTTON. That matters because
-- nearly everyone opens the registration page on the phone they would
-- otherwise have to scan with, and you cannot scan your own screen.
-- Stored rather than hardcoded so it travels with the QR if Apex changes it.
-- Zelle has no amount parameter, so this carries WHO to pay, never how much.
ALTER TABLE business_settings ADD COLUMN zelle_pay_url TEXT;

-- Is this person bringing a spouse/guest? Attendees can bring one, and the
-- couple price already implies it, but nothing captured it -- so the food
-- count silently treated every registration as one seat. A checkbox rather
-- than a number: it is one tap on top of an AutoFilled two-field form, it
-- matches what the couple rate already means, and a rare third guest is
-- something Alice can fix on the list. Counts as 2 seats, never 2 rows.
ALTER TABLE apex_club_registrations ADD COLUMN plus_one INTEGER NOT NULL DEFAULT 0;
