// Proves gmRedactEventsForSeller keeps every slot but strips identity off
// leads that are not this seller's. Built 2026-09-08 alongside the change
// that opened gm/events to sellers -- that route has NO row filter of its
// own, so this function is the whole protection.
import fs from "fs";

const src = fs.readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
const start = src.indexOf("function gmRedactEventsForSeller");
if (start === -1) { console.error("FAIL: gmRedactEventsForSeller not found"); process.exit(1); }
const end = src.indexOf("\nasync function gmDerivedLeadEvents", start);
const fn = src.slice(start, end);
const gmRedactEventsForSeller = new Function(fn + "; return gmRedactEventsForSeller;")();

const events = [
  { kind: "lead", source: "lead", id: "lead:L1:estimate", lead_id: "L1", date: "2026-09-10",
    start_time: "14:00", all_day: false, title: "MARIA SILVA", stage: "Negociação",
    servico: "Roof replacement", location: "123 Oak St, Tampa", vendedor: "Ana", editable: false },
  { kind: "lead", source: "lead", id: "lead:L2:estimate", lead_id: "L2", date: "2026-09-11",
    start_time: "09:30", all_day: false, title: "JOHN DOE", stage: "Estimate",
    servico: "Deck", location: "9 Pine Ave", vendedor: "Anderson", editable: false },
  { kind: "own", id: "E1", title: "Site visit", date: "2026-09-12", start_time: "11:00",
    location: "500 Bay St", description: "bring samples", lead_id: "L1", assigned_to: null, editable: true },
  { kind: "own", id: "E2", title: "Team meeting", date: "2026-09-13", start_time: "08:00",
    location: "Office", description: "internal", lead_id: null, assigned_to: "Ana", editable: true },
  { kind: "club", id: "C1", title: "Apex Club — September", date: "2026-09-15", all_day: true }
];
const leadOwners = { L1: "Ana", L2: "Anderson" };

const out = gmRedactEventsForSeller(events, "Ana", leadOwners);
let failed = 0;
const check = (name, cond) => { console.log((cond ? "  ok   " : "  FAIL ") + name); if (!cond) failed++; };

console.log("Seller 'Ana' viewing the calendar:\n");

check("every event still returned (no slot disappears)", out.length === events.length);
check("own lead keeps the customer name", out[0].title === "MARIA SILVA");
check("own lead keeps the address", out[0].location === "123 Oak St, Tampa");

const other = out[1];
check("other seller's lead is marked redacted", other.redacted === true);
check("other seller's customer NAME is gone", other.title === null);
check("other seller's ADDRESS is gone", other.location === undefined);
check("other seller's SERVICE is gone", other.servico === undefined);
check("other seller's STAGE is gone", other.stage === undefined);
check("other seller's lead_id is gone (chip cannot be opened)", other.lead_id === undefined);
check("other seller's slot KEEPS the date", other.date === "2026-09-11");
check("other seller's slot KEEPS the time", other.start_time === "09:30");

check("own manual event inherits lead owner and stays visible", out[2].title === "Site visit");
check("manual event assigned to me stays visible", out[3].title === "Team meeting");
check("club invite passes through untouched", out[4].title === "Apex Club — September");

const leaked = JSON.stringify(out).includes("JOHN DOE") || JSON.stringify(out).includes("Pine Ave");
check("NOTHING about the other seller's lead survives in the payload", !leaked);

console.log("\n" + (failed ? failed + " FAILED" : "All checks passed."));
process.exit(failed ? 1 : 0);
