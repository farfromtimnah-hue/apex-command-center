-- APNs device tokens for the native iOS app.
--
-- SEPARATE FROM push_subscriptions ON PURPOSE. A web-push subscription is an
-- endpoint URL plus two crypto keys and is sent by POSTing to that endpoint
-- with a VAPID JWT. An APNs token is a 64-hex-char device identifier sent to
-- Apple's own host with a completely different JWT (ES256, signed with the .p8,
-- carrying key id and team id). Nothing about the two is interchangeable, and
-- forcing them into one table would mean a nullable half on every row.
--
-- token is the PRIMARY KEY: iOS reissues a token per install, and the same
-- device reinstalling must replace its old row rather than accumulate.
-- user_email joins to users the same way push_subscriptions does, so
-- pushToUsers can fan out to both transports off one email list.
--
-- environment records which APNs host the token belongs to. A token minted by
-- a debug build only works against api.sandbox.push.apple.com; a TestFlight or
-- App Store token only works against api.push.apple.com. Sending to the wrong
-- host returns BadDeviceToken, which looks exactly like a revoked token and
-- would silently delete a perfectly good row.
CREATE TABLE IF NOT EXISTS apns_device_tokens (
  token         TEXT PRIMARY KEY,
  user_email    TEXT NOT NULL,
  environment   TEXT NOT NULL DEFAULT 'production',
  bundle_id     TEXT,
  device_model  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_sent_at  TEXT,
  last_error    TEXT
);

CREATE INDEX IF NOT EXISTS idx_apns_tokens_email ON apns_device_tokens(user_email);
