// Voice booking's Google Calendar retry contract.
//
//   node scripts/test-voice-gcal-retry.mjs
//
// Two rules that are easy to regress in opposite directions:
//
//   1. A voice-booked meeting must reach Google AUTOMATICALLY. Alice's desk
//      is for a genuine failure (an expired token, an outage) and never for
//      routine completion -- a meeting whose event succeeded is not flagged
//      at all, or the banner becomes noise nobody reads.
//   2. ONE retry, with a freshly refreshed token. getGoogleAccessToken()
//      exchanges the stored refresh token on every call, so simply calling
//      the attempt again genuinely re-refreshes instead of replaying a token
//      that has already expired. Capped at one: a second failure is a real
//      outage, and retrying harder only delays saving the recording.
//
// The row is inserted either way. Speaking always produces a meeting, so a
// Google failure must never throw away a recording Rafa already made.
import { readFileSync } from "fs";
const src = readFileSync("worker/index.js", "utf8");

let fails = 0;
const t = (l, a, e) => { const ok = JSON.stringify(a)===JSON.stringify(e); if(!ok) fails++;
  console.log((ok?"PASS  ":"FAIL  ")+l+(ok?"":`\n   expected ${JSON.stringify(e)} got ${JSON.stringify(a)}`)); };

const i = src.indexOf("async function attemptVoiceGcal()");
const j = src.indexOf("await env.DB.prepare(", i);
const block = src.slice(i, j);

// Each attempt mints its own token, so the retry really does re-refresh
// rather than replaying an expired one.
t("attempt refreshes the token itself",
  (block.match(/getGoogleAccessToken\(env\)/g) || []).length, 1);

// A fresh conference requestId per attempt, not a replayed one.
t("new requestId per attempt", /createRequest: \{ requestId: crypto\.randomUUID\(\)/.test(block), true);

// Exactly two call sites: the first try and the single retry.
const callSites = (src.match(/await attemptVoiceGcal\(\)/g) || []).length;
t("called exactly twice (one try + one retry)", callSites, 2);

// The retry is gated on the first attempt having produced no event.
t("retry only runs when no event was created", /if \(!voiceEventId\) \{/.test(src), true);

// Success clears any error from the first attempt, so a recovered retry is
// not reported as a failure.
t("a recovered retry clears the earlier error", /voiceGcalError = null;/.test(src), true);

// The row is inserted regardless -- the recording is never thrown away.
const insertIdx = src.indexOf('INSERT INTO sessions (id, client_id, client_name, date, time, end_time, location, ' +
  '" +\n            "session_type, google_meet_link, google_event_id');
t("session row is inserted after the Google attempts", insertIdx > i, true);

console.log(fails ? `\n${fails} FAILED` : "\nRetry contract holds");
process.exit(fails?1:0);
