// Support panel look (dashboard.html + its iOS twin): the gold outline
// button look (copied from #tellUsPicker .tu-opt), a working active-tab
// indicator on Abertos/Resolvidos, and no leftover popups. Reads both files
// as text -- no browser, no Worker.
//
//   node scripts/test-support-panel-tabs.mjs
import { readFileSync } from "node:fs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };

const FILES = {
  root: "dashboard.html",
  ios: "ios/App/App/public/dashboard.html"
};

const text = {};
for (const [k, path] of Object.entries(FILES)) { text[k] = readFileSync(new URL("../" + path, import.meta.url), "utf8"); }

function loadSupportTicketsFn(src) {
  const i = src.indexOf("function loadSupportTickets(status) {");
  if (i < 0) { throw new Error("loadSupportTickets not found"); }
  // Balance braces from the first "{" to find the matching close.
  let depth = 0, j = i;
  for (; j < src.length; j++) {
    if (src[j] === "{") { depth++; }
    else if (src[j] === "}") { depth--; if (depth === 0) { break; } }
  }
  return src.slice(i, j + 1);
}

for (const [k, path] of Object.entries(FILES)) {
  const src = text[k];
  const fn = loadSupportTicketsFn(src);

  ok(fn.indexOf('getElementById("supportTabOpen")') !== -1, k + ": loadSupportTickets looks up supportTabOpen");
  ok(fn.indexOf('getElementById("supportTabResolved")') !== -1, k + ": loadSupportTickets looks up supportTabResolved");
  ok(/tabOpen\.classList\.toggle\("is-active"/.test(fn), k + ": loadSupportTickets toggles is-active on supportTabOpen");
  ok(/tabResolved\.classList\.toggle\("is-active"/.test(fn), k + ": loadSupportTickets toggles is-active on supportTabResolved");
  ok(/tabOpen\.setAttribute\("aria-pressed"/.test(fn), k + ": loadSupportTickets sets aria-pressed on supportTabOpen");
  ok(/tabResolved\.setAttribute\("aria-pressed"/.test(fn), k + ": loadSupportTickets sets aria-pressed on supportTabResolved");
  ok(/if\s*\(\s*tabOpen\s*\)/.test(fn) && /if\s*\(\s*tabResolved\s*\)/.test(fn), k + ": both tab lookups are null-checked");

  // The scoped CSS block, by its leading comment, through the last of its
  // selectors (#tellUsConvo padding-top) that existed before this build.
  const cssStart = src.indexOf("/* Tell us box + Support panel:");
  const cssEnd = src.indexOf("#tellUsConvo { padding-top: 4px; }", cssStart);
  if (cssStart < 0 || cssEnd < 0) { throw new Error(k + ": scoped CSS block not found"); }
  const css = src.slice(cssStart, cssEnd + "#tellUsConvo { padding-top: 4px; }".length);

  ok(/#tellUsSection \.btn-secondary,\s*#supportPanelSection \.btn-secondary\s*\{[^}]*border:\s*1\.5px solid var\(--gold\)/.test(css),
     k + ": .btn-secondary gets a 1.5px var(--gold) border");
  ok(/\.btn-secondary\.is-active,\s*#supportPanelSection \.btn-secondary\.is-active\s*\{[^}]*background:\s*var\(--gold\);\s*color:\s*#fff/.test(css),
     k + ": .btn-secondary.is-active is background var(--gold) / color #fff for both sections");
  ok(css.indexOf("#tellUsSection .btn-secondary.is-active") !== -1 && css.indexOf("#supportPanelSection .btn-secondary.is-active") !== -1,
     k + ": the is-active rule names both #tellUsSection and #supportPanelSection");
  ok(css.indexOf("gold-dim) }") === -1 && !/\.is-active\s*\{\s*background:\s*var\(--gold-dim\)/.test(css),
     k + ": the old faint gold-dim active rule is gone");
  ok(css.indexOf("#supportPanelSection .tab-row .btn-secondary.is-active { background: var(--gold-dim)") === -1,
     k + ": the exact old selector/rule is gone");
  ok(/:focus-visible\s*\{\s*outline:\s*2px solid var\(--gold\);\s*outline-offset:\s*2px;\s*\}/.test(css),
     k + ": .btn-secondary has a focus-visible outline using var(--gold)");
  ok(/:disabled\s*\{\s*opacity:\s*0\.5;\s*cursor:\s*not-allowed;\s*\}/.test(css),
     k + ": .btn-secondary has a disabled state (opacity 0.5, cursor not-allowed)");

  // Clear resolved: handler and endpoint unchanged.
  ok(src.indexOf('onclick="showClearResolvedConfirm()"') !== -1, k + ": Clear resolved button handler is unchanged");
  ok(src.indexOf("/api/support/tickets/clear-resolved") !== -1, k + ": the clear-resolved API call is unchanged");
  ok(src.indexOf('onclick="confirmClearResolved()"') !== -1, k + ": the confirm button for Clear resolved is unchanged");

  // The mic button kept its id/onclick, only its class changed.
  const micMatch = src.match(/<button class="([^"]*)" id="tellUsMicBtn" onclick="toggleTellUsMic\(\)">/);
  ok(!!micMatch, k + ": tellUsMicBtn keeps its id and onclick");
  ok(!!micMatch && micMatch[1] === "btn-secondary btn-sm", k + ": tellUsMicBtn class changed to btn-secondary btn-sm");

  // The per-ticket "Marcar resolvido" button is built in JS: it must use the
  // same defined gold outline look, not the plain .btn card look.
  ok(/resolveBtn\.className\s*=\s*"btn-secondary btn-sm"/.test(fn), k + ": the per-ticket resolve button uses btn-secondary btn-sm");
  ok(!/resolveBtn\.className\s*=\s*"btn btn-sm"/.test(fn), k + ": the per-ticket resolve button is not the plain btn style");

  // No new browser pop-ups.
  ok(!/\balert\s*\(/.test(fn) && !/\bconfirm\s*\(/.test(fn) && !/\bprompt\s*\(/.test(fn),
     k + ": loadSupportTickets contains no alert/confirm/prompt call");
}

// The CSS block and the loadSupportTickets function text are identical in
// both files.
{
  const cssStartRoot = text.root.indexOf("/* Tell us box + Support panel:");
  const cssEndRoot = text.root.indexOf("#tellUsConvo { padding-top: 4px; }", cssStartRoot) + "#tellUsConvo { padding-top: 4px; }".length;
  const cssRoot = text.root.slice(cssStartRoot, cssEndRoot);
  const cssStartIos = text.ios.indexOf("/* Tell us box + Support panel:");
  const cssEndIos = text.ios.indexOf("#tellUsConvo { padding-top: 4px; }", cssStartIos) + "#tellUsConvo { padding-top: 4px; }".length;
  const cssIos = text.ios.slice(cssStartIos, cssEndIos);
  ok(cssRoot === cssIos, "the scoped CSS block is byte-identical between dashboard.html and the iOS copy");

  const fnRoot = loadSupportTicketsFn(text.root);
  const fnIos = loadSupportTicketsFn(text.ios);
  ok(fnRoot === fnIos, "loadSupportTickets is byte-identical between dashboard.html and the iOS copy");
}

// The iOS-only script tag (native-bridge.js is loaded on both copies here,
// so this checks for the Capacitor bridge detection it wraps instead).
ok(text.ios.indexOf('window.Capacitor') !== -1, "ios copy still has its Capacitor bridge detection after the hand-port");

console.log(fail ? ("\n" + fail + " FAILED") : "\nALL PASS");
process.exit(fail ? 1 : 0);
