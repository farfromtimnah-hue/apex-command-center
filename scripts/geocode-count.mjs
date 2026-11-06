// geocode-count: READ ONLY. Where does each active project's weather location
// come from, and which projects need a person to look? It asks the owner only
// route GET /api/clients/:id/gm/geocode-count and prints the answer. It sends
// one GET and nothing else; it never writes.
//
//   APEX_TOKEN=<a signed in owner's session token> node scripts/geocode-count.mjs <client id>
//
// The token comes from the environment (never from a file in the repo). Use the
// TEST client's token for tests; read a real client only through its owner or
// the admin preview, never with a token minted for it.
const API = process.env.APEX_API || "https://apex-api.farfromtimnah.workers.dev";
const clientId = process.argv[2];
const token = process.env.APEX_TOKEN;

if (!clientId || !/^[a-z0-9][a-z0-9-]{2,80}$/.test(clientId)) {
  console.error("Usage: APEX_TOKEN=... node scripts/geocode-count.mjs <client id>");
  process.exit(2);
}
if (!token) {
  console.error("APEX_TOKEN is not set.");
  process.exit(2);
}

const res = await fetch(API + "/api/clients/" + encodeURIComponent(clientId) + "/gm/geocode-count", {
  method: "GET",
  headers: { Authorization: "Bearer " + token }
});
if (res.status === 401) { console.error("Not signed in (401)."); process.exit(1); }
if (res.status === 403) { console.error("Not allowed (403): owner only."); process.exit(1); }
if (!res.ok) { console.error("Request failed (" + res.status + ")."); process.exit(1); }
const c = await res.json();

console.log("Active projects (Em andamento): " + c.active_total);
console.log("Own coordinates:                       " + c.own_coordinates);
console.log("Coordinates only through the lead:     " + c.lead_coordinates_only);
console.log("Located only approximately (zip/town): " + c.approximate_only);
console.log("Own address, no coordinates:           " + c.own_address_no_coordinates);
console.log("Lead has an address, no coordinates:   " + c.lead_address_no_coordinates);
console.log("No address anywhere:                   " + c.no_address_anywhere);
if (c.needs_attention && c.needs_attention.length) {
  console.log("\nNeed attention:");
  c.needs_attention.forEach(function (p) { console.log("  - " + p.name + "  [" + p.reason + "]"); });
}
