// Guards against session replay, analytics and ad tracking tools, and against
// any request to Google's font servers (each visitor's IP address would go to
// Google). Why it matters:
//   - California's wiretap law has been used against session replay scripts,
//     at up to 5,000 dollars per violation.
//   - A Munich court (2022) awarded a visitor 100 euros because a page loaded
//     Google Fonts from Google's servers.
// Apex has none of these today and this test keeps it that way.
//
// It matches DOMAINS and LOADER NAMES, never common words: the word "plausible"
// appears in comments and must not match, only plausible.io does.
//
//   node scripts/test-no-session-replay.mjs
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, extname, relative } from "node:path";

let fail = 0, pass = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (c) { pass++; } else { fail++; } };

const root = new URL("../", import.meta.url).pathname;

// name, regex. Every regex needs a domain or a loader call shape.
export const BANNED = [
  ["hotjar", /hotjar/i],
  ["fullstory", /fullstory/i],
  ["clarity.ms", /clarity\.ms/i],
  ["logrocket", /logrocket/i],
  ["mouseflow", /mouseflow/i],
  ["smartlook", /smartlook/i],
  ["crazyegg", /crazyegg/i],
  ["luckyorange", /luckyorange/i],
  ["inspectlet", /inspectlet/i],
  ["sessioncam", /sessioncam/i],
  ["heap", /heapanalytics\.com|\bheap\s*\.\s*(load|track|identify|addUserProperties)\s*\(/i],
  ["posthog", /posthog/i],
  ["googletagmanager.com", /googletagmanager\.com/i],
  ["google-analytics.com", /google-analytics\.com/i],
  ["gtag function", /\bgtag\s*\(/],
  ["mixpanel", /mixpanel/i],
  ["segment.com", /segment\.com|segment\.io/i],
  ["plausible.io", /plausible\.io/i],
  ["facebook pixel fbq", /\bfbq\s*\(|connect\.facebook\.net[^"'\s]*fbevents/i],
  ["fonts.googleapis.com", /fonts\.googleapis\.com/i],
  ["fonts.gstatic.com", /fonts\.gstatic\.com/i]
];

export function scanText(text) {
  const hits = [];
  BANNED.forEach(([name, re]) => { if (re.test(text)) { hits.push(name); } });
  return hits;
}

// ---- 1. the scanner itself, on planted fixtures ----
const PLANTED = [
  ['<script src="https://static.hotjar.com/c/hotjar-123.js"></script>', "hotjar"],
  ['<script src="https://edge.fullstory.com/s/fs.js"></script>', "fullstory"],
  ['<script src="https://www.clarity.ms/tag/abc"></script>', "clarity.ms"],
  ['import LogRocket from "logrocket";', "logrocket"],
  ['<script src="https://cdn.mouseflow.com/projects/x.js"></script>', "mouseflow"],
  ['<script src="https://web-sdk.smartlook.com/recorder.js"></script>', "smartlook"],
  ['<script src="//script.crazyegg.com/pages/scripts/1.js"></script>', "crazyegg"],
  ['<script src="//cdn.luckyorange.com/w.js"></script>', "luckyorange"],
  ['<script src="https://cdn.inspectlet.com/inspectlet.js"></script>', "inspectlet"],
  ['<script src="//d2oh4tlt9mrke9.cloudfront.net/sessioncam.js"></script>', "sessioncam"],
  ['<script src="https://cdn.heapanalytics.com/js/heap-1.js"></script>', "heap"],
  ['heap.load("123");', "heap"],
  ['!function(t,e){posthog.init("phc_x")}', "posthog"],
  ['<script src="https://www.googletagmanager.com/gtm.js?id=GTM-X"></script>', "googletagmanager.com"],
  ['<script src="https://www.google-analytics.com/analytics.js"></script>', "google-analytics.com"],
  ['window.dataLayer = []; function f(){}; gtag("config", "G-X");', "gtag function"],
  ['mixpanel.init("token");', "mixpanel"],
  ['<script src="https://cdn.segment.com/analytics.js/v1/x/analytics.min.js"></script>', "segment.com"],
  ['<script defer data-domain="x.com" src="https://plausible.io/js/script.js"></script>', "plausible.io"],
  ['fbq("init", "123"); fbq("track", "PageView");', "facebook pixel fbq"],
  ['<link href="https://fonts.googleapis.com/css2?family=Inter&display=swap" rel="stylesheet">', "fonts.googleapis.com"],
  ['<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>', "fonts.gstatic.com"],
  ['@import url("https://fonts.googleapis.com/css2?family=Inter");', "fonts.googleapis.com"]
];
PLANTED.forEach(([text, name]) => {
  ok(scanText(text).indexOf(name) !== -1, "scanner catches a planted " + name);
});
const BENIGN = [
  "// a plausible reason: the number is plausible",
  "the heap of the problem; heapsort; a pile or heap of leaves",
  "var segmentOfWork = 1; // segment of the report; segments.length",
  "function clarityOfPurpose() {} // clarity matters",
  "/* we do not use mixing or posting */ var posting = 1;",
  "gtagless = 1; var fbqless = 2;",
  "font-family: 'Inter', sans-serif; src: url('/fonts/inter-var-latin.woff2') format('woff2');"
];
BENIGN.forEach((text, i) => {
  ok(scanText(text).length === 0, "scanner ignores common words and own-server fonts (case " + (i + 1) + ")");
});

// ---- 2. the repo ----
function walk(dir, recursive, out) {
  readdirSync(dir).forEach((name) => {
    if (name === "node_modules" || name === ".git" || name === "build") { return; }
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (recursive) { walk(p, true, out); } return; }
    const ext = extname(name).toLowerCase();
    if (ext === ".html" || ext === ".js") { out.push(p); }
  });
  return out;
}
const files = [];
walk(root, false, files);                                   // repo root, top level only
if (existsSync(join(root, "www"))) { walk(join(root, "www"), true, files); }
if (existsSync(join(root, "ios/App/App/public"))) { walk(join(root, "ios/App/App/public"), true, files); }
files.push(join(root, "worker/index.js"));

ok(files.length > 100, "the scan covers the repo root, www/, the iOS mirror and the Worker (" + files.length + " files)");
const found = [];
files.forEach((f) => {
  const text = readFileSync(f, "utf8");
  scanText(text).forEach((name) => found.push(relative(root, f) + "  ->  " + name));
});
ok(found.length === 0, "no session replay, tracking tool or Google font request in the repo (" + found.length + " found)");
found.slice(0, 12).forEach((l) => console.log("      " + l));
if (found.length > 12) { console.log("      ... and " + (found.length - 12) + " more"); }

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
