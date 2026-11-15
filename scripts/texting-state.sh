#!/bin/bash
# Prints the live state of Apex texting: switches, test client, ticked meetings, last sends and replies.
export CLOUDFLARE_ACCOUNT_ID=b52dcd8983e33e42355f98649193e20c
cd "$(dirname "$0")/.." || exit 1
V=$(npx wrangler deployments list 2>&1 | grep -E "^Version\(s\)" | tail -1 | sed -E 's/.*\) ([0-9a-f-]{36}).*/\1/')
echo "Live version: $V"
npx wrangler versions view "$V" 2>&1 | grep -E "REMINDER_TEXTS|TWILIO_MESSAGING_SERVICE_SID"
npx wrangler d1 execute apex-command-center --remote --json --command "SELECT 'test client status' k, status v FROM clients WHERE id='test-client-temp-001' UNION ALL SELECT 'ticked admin meetings from today', count(*) FROM sessions WHERE send_text_reminder=1 AND date >= date('now','-5 hours') UNION ALL SELECT 'opted out numbers', count(*) FROM reminder_text_optouts UNION ALL SELECT 'last send', kind||' '||meeting_at||' sent '||sent_at FROM (SELECT * FROM reminder_text_sends ORDER BY rowid DESC LIMIT 3) UNION ALL SELECT 'last reply', kind||' | '||substr(body,1,40)||' | '||received_at FROM (SELECT * FROM reminder_text_replies ORDER BY rowid DESC LIMIT 4)" 2>&1 | grep -E '"(k|v)"' | paste - - | sed -E 's/ +/ /g'
date
