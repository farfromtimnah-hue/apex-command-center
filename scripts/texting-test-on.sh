#!/bin/bash
# TEST MODE ON: admin meeting texts and booking-link texts on, test client active. Turn off with texting-test-off.sh.
export CLOUDFLARE_ACCOUNT_ID=b52dcd8983e33e42355f98649193e20c
cd "$(dirname "$0")/.." || exit 1
npx wrangler deploy --var TWILIO_MESSAGING_SERVICE_SID:MGc14bc35fd5618ff4e8367767feb67a73 --var REMINDER_TEXTS_ENABLED:1 --var REMINDER_TEXTS_ADMIN_MEETINGS:1 --var REMINDER_TEXTS_BOOKING_LINK:1 2>&1 | grep -E "Current Version ID|error"
npx wrangler d1 execute apex-command-center --remote --command "UPDATE clients SET status='active' WHERE id='test-client-temp-001'" 2>&1 | grep -E "changes|error"
