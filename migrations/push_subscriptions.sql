-- Web Push subscriptions.
--
-- WHY WEB PUSH AND NOT NATIVE: an installed home-screen PWA gets real push
-- notifications on iOS 16.4+ with no Apple Developer account. Native push in
-- the Capacitor wrapper needs the paid $99/year program and APNs. This path
-- costs nothing and works today; the wrapper can gain native push later
-- without changing anything here.
--
-- Three conditions iOS enforces and the client must respect:
--   1. The PWA must be installed via Share -> Add to Home Screen. Push does
--      not work in a plain Safari tab.
--   2. The permission prompt must fire from a real user TAP. Asking on page
--      load is rejected outright and cannot be retried.
--   3. iOS 16.4 or later.
--
-- One row per browser/device, not per person: the same user can install on a
-- phone and a laptop and should get both.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           TEXT PRIMARY KEY,
  -- Who this device belongs to, so a notification can be aimed at a role
  -- rather than broadcast to everyone.
  user_email   TEXT NOT NULL,
  -- The push service endpoint. UNIQUE because re-subscribing on the same
  -- device returns the same endpoint, and a duplicate would send twice.
  endpoint     TEXT NOT NULL UNIQUE,
  -- Encryption material from the browser's PushSubscription.
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,
  user_agent   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  -- Stamped when the push service rejects the subscription (404/410). A dead
  -- subscription is deleted rather than retried forever.
  last_error   TEXT,
  last_sent_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_push_subs_email ON push_subscriptions(user_email);

-- What has already been announced, so a daily check does not re-notify about
-- the same thing every single day. Keyed by a caller-supplied string.
CREATE TABLE IF NOT EXISTS push_sent_log (
  dedupe_key TEXT PRIMARY KEY,
  sent_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
