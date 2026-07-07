-- Adds access token caching columns to oauth_tokens for the zoho_books row.
-- Lets getZohoAccessToken() reuse a still-valid Zoho access token instead of
-- calling the refresh endpoint on every request.
ALTER TABLE oauth_tokens ADD COLUMN access_token TEXT;
ALTER TABLE oauth_tokens ADD COLUMN access_token_expires_at INTEGER;
