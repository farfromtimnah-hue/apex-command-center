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
  // A SECOND Rafael, and not the same person: this one is the cabinet maker at
  // a closed client. Pr. Rafa is the Rafael in MY PURE FILTER. The owners
  // column is free text and cannot tell them apart, which is the whole reason
  // a shared first name has to come back ambiguous.
  { id: "elev",  name: "ELEVATE PRIME",         owners: "Rafael & Kenia" },
  // Adriana Nascimento really is on two client rows in production.
  { id: "inter", name: "INTERLOCK EXPRESS CONSTRUCTION LLC", owners: "Adriana Nascimento; Guilherme Porto" },
  { id: "adri",  name: "ADRIANA GOURMET CUISINE LLC",        owners: "Adriana Nascimento" },
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

// "Rafael" names an owner on TWO client rows -- Pr. Rafa at MY PURE FILTER and
// an unrelated cabinet maker at ELEVATE PRIME. An earlier version of this file
// asserted "confident MY PURE FILTER" and passed only because the fixture held
// 3 of the 38 real clients and ELEVATE PRIME was not among them. Verified
// against the full production roster: the live matcher returns ambiguous.
r = voiceResolveVerdict({ client_hint: "Rafael", is_personal: false }, roster);
t('"Rafael" -> two different people -> ambiguous', r.verdict, "ambiguous");
t("   ...attaches nothing", r.client_id, null);

// Same shape, a different real collision.
r = voiceResolveVerdict({ client_hint: "Adriana", is_personal: false }, roster);
t('"Adriana" -> on two client rows -> ambiguous', r.verdict, "ambiguous");

console.log(fails ? `\n${fails} FAILED` : "\nAll checks passed. NOTE: this fixture is a SUBSET of the 38 real\nclients, chosen for the known collisions. Passing here is not proof\nagainst the full roster -- re-check against D1 when owners change.");
process.exit(fails?1:0);
