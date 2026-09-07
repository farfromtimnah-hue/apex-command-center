// The three-verdict matcher behind voice booking.
//
//   node scripts/test-voice-matcher.mjs
//
// Two rules here are the whole point and are easy to regress into a guess:
//
//   1. A name shared by two clients is AMBIGUOUS, never a guess. Marcelo
//      Diniz owns both GATOR OUTDOOR LIVING and MY PURE FILTER, so
//      "Marcelinho" cannot resolve to one of them -- and Brazilian
//      diminutives mean the spoken form rarely matches the stored one.
//   2. Party/wedding/birthday/shower vocabulary means PERSONAL even when an
//      owner name matches. "Cha de panela Iasmin" is a bridal shower and
//      Iasmin really is an owner of PRODUWALL, so a matcher that only looked
//      at names would file a bridal shower as a client meeting.
//
// The roster below is the REAL owners strings out of production D1, not a
// convenient fixture -- "Marcelo Diniz, Neicy Diniz e Heri" is what the
// matcher actually has to cope with.
import { readFileSync } from "fs";
const src = readFileSync("worker/index.js", "utf8");
const i = src.indexOf("function voiceResolveVerdict");
const j = src.indexOf("async function handlePostSessionsVoice");
const voiceResolveVerdict = eval(src.slice(i, j) + "; voiceResolveVerdict");

// The REAL production owners strings, verbatim from D1.
const roster = [
  { id: "gator", name: "GATOR OUTDOOR LIVING", owners: "Marcelo Diniz, Neicy Diniz e Heri" },
  { id: "pure",  name: "MY PURE FILTER",       owners: "Marcelo Diniz, Heri e Rafael" },
  { id: "produ", name: "PRODUWALL",            owners: "Nicolas & Iasmin" },
];

let fails = 0;
const t = (l, a, e) => { const ok = JSON.stringify(a)===JSON.stringify(e); if(!ok) fails++;
  console.log((ok?"PASS  ":"FAIL  ")+l+(ok?"":`\n   expected ${JSON.stringify(e)} got ${JSON.stringify(a)}`)); };

// The spec's headline case, against real data.
let r = voiceResolveVerdict({ client_hint: "Marcelinho", is_personal: false }, roster);
t('"Marcelinho" -> owns 2 companies -> ambiguous', r.verdict, "ambiguous");
t("   ...names no client", r.client_id, null);
t("   ...says why", r.reason, "name_matches_2_clients");

r = voiceResolveVerdict({ client_hint: "Marcelo", is_personal: false }, roster);
t('"Marcelo" (full name) is also ambiguous', r.verdict, "ambiguous");

// The bridal shower: Iasmin IS an owner of PRODUWALL, and it is still personal.
r = voiceResolveVerdict({ client_hint: "Iasmin", is_personal: true }, roster);
t('"Cha de panela Iasmin" -> personal, not PRODUWALL', r.verdict, "not_client");
t("   ...and attaches nothing", r.client_id, null);

// Without the party vocabulary, Iasmin resolves to her one company.
r = voiceResolveVerdict({ client_hint: "Iasmin", is_personal: false }, roster);
t('"reuniao com Iasmin" -> confident PRODUWALL', r.verdict, "confident");
t("   ...attaches PRODUWALL", r.client_id, "produ");

// A business name spoken directly.
r = voiceResolveVerdict({ client_hint: "Gator Outdoor", is_personal: false }, roster);
t('"Gator Outdoor" -> confident', r.verdict, "confident");
t("   ...attaches Gator", r.client_id, "gator");

// Rafael is an owner of My Pure Filter only.
r = voiceResolveVerdict({ client_hint: "Rafael", is_personal: false }, roster);
t('"Rafael" -> confident My Pure Filter', r.verdict, "confident");

console.log(fails ? `\n${fails} FAILED` : "\nAll checks passed against real production owners data");
process.exit(fails?1:0);
