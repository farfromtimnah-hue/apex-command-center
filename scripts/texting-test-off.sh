#!/bin/bash
# NOTE: since 2026-11-15 the committed wrangler.toml has texts ON, so this redeploys the LIVE config and closes the test client. To switch texts OFF, set the four reminder vars empty in wrangler.toml, commit, then run this.
export CLOUDFLARE_ACCOUNT_ID=b52dcd8983e33e42355f98649193e20c
cd "$(dirname "$0")/.." || exit 1
git status --short | grep -v '^??' && { echo "Uncommitted changes: stop and look."; exit 1; }
npx wrangler deploy 2>&1 | grep -E "Current Version ID|REMINDER_TEXTS|TWILIO_MESSAGING|error"
npx wrangler d1 execute apex-command-center --remote --command "UPDATE clients SET status='closed' WHERE id='test-client-temp-001'" 2>&1 | grep -E "changes|error"
