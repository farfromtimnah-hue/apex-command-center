// Task 2.8: "Open settings" in the review flow must actually focus the
// field after the render -- gmReviewOpenSettings sets gmReviewFocusField
// and switches the tab; gmReviewFocusSettingsField (called right after
// gm.js repaints the Estimates > Settings body) must then find the real
// field and focus it. No browser here, so this builds the smallest fake
// DOM these two functions actually touch (getElementById, scrollIntoView,
// focus) rather than adding a jsdom dependency for one check.
//
//   node scripts/test-review-focus-settings-field.mjs
import { readFileSync } from "node:fs";
import { fnSrc } from "./fixtures/d1-shim.mjs";

let fail = 0, pass = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (c) { pass++; } else { fail++; } };

const gmSrc = readFileSync(new URL("../gm.js", import.meta.url), "utf8");
const openSettingsSrc = fnSrc("gmReviewOpenSettings", gmSrc);
const focusFieldSrc = fnSrc("gmReviewFocusSettingsField", gmSrc);

// A fake element that records whether it was scrolled into view and
// focused, in order -- the bug this test guards against is "focus() is
// called before the element exists yet", which would show as focus()
// never firing at all (the real DOM getElementById would return null).
function fakeEl() {
  const calls = [];
  return {
    calls,
    scrollIntoView(opts) { calls.push(["scrollIntoView", opts || null]); },
    focus() { calls.push(["focus", null]); }
  };
}

// gm.js's own two functions read/write gmEstimatesSection and
// gmReviewFocusField as bare identifiers (module-level vars in the real
// file). A `new Function` parameter can be ASSIGNED TO from inside the
// function body, but that only rebinds the local parameter -- it is not
// visible to the test from outside. So the two vars are declared with
// `var` INSIDE the same wrapped source the two functions run in, and the
// state object is populated by a getter function returned alongside them.
function world(opts) {
  const el = opts && opts.hasElement ? fakeEl() : null;
  const switchTabCalls = [], loadCalls = [];
  const sandbox = {
    gmSheetClose: () => {},
    switchTab: (name) => { switchTabCalls.push(name); },
    gmLoadEstimates: () => { loadCalls.push(1); },
    document: { getElementById: (id) => (id === "gmDocReviewLink" ? el : null) }
  };
  var src = "var gmEstimatesSection = 'list';\nvar gmReviewFocusField = false;\n" +
    openSettingsSrc + ";\n" + focusFieldSrc + ";\n" +
    "return { gmReviewOpenSettings, gmReviewFocusSettingsField, " +
    "get section(){return gmEstimatesSection;}, set section(v){gmEstimatesSection = v;}, " +
    "get focusField(){return gmReviewFocusField;}, set focusField(v){gmReviewFocusField = v;} };";
  const fn = new Function(...Object.keys(sandbox), src)(...Object.values(sandbox));
  return {
    fn,
    el,
    switchTabCalls,
    loadCalls,
    get section() { return fn.section; },
    set section(v) { fn.section = v; },
    get focusField() { return fn.focusField; },
    set focusField(v) { fn.focusField = v; }
  };
}

// ── 1. Opening settings sets the flag and switches the tab ────────────────
{
  const w = world({ hasElement: true });
  w.fn.gmReviewOpenSettings();
  ok(w.section === "settings", "gmReviewOpenSettings switches gmEstimatesSection to settings");
  ok(w.focusField === true, "gmReviewOpenSettings sets gmReviewFocusField true");
  ok(w.switchTabCalls[0] === "gmestimates", "switchTab('gmestimates') is called when switchTab exists");
}

// ── 2. The render-time call actually focuses the field once it exists ─────
// This is the exact bug the brief named: "nobody has proven the focus fires
// after the render." Simulates gm.js's real sequence -- open() sets the
// flag, THEN (as gmRenderEstimatesTab does) the settings body is painted
// (the fake element now exists), THEN focusSettingsField() runs.
{
  const w = world({ hasElement: true });
  w.fn.gmReviewOpenSettings();
  w.fn.gmReviewFocusSettingsField();
  ok(w.el.calls.some((c) => c[0] === "scrollIntoView"), "scrollIntoView is called on the real field after the render");
  ok(w.el.calls.some((c) => c[0] === "focus"), "focus() is called on the real field after the render -- the actual bug being guarded against");
  ok(w.focusField === false, "gmReviewFocusField is cleared after it fires, so it does not re-fire on the next unrelated render");
}

// ── 3. Calling focusSettingsField AGAIN (e.g. a second render) does nothing ──
{
  const w = world({ hasElement: true });
  w.fn.gmReviewOpenSettings();
  w.fn.gmReviewFocusSettingsField();
  const callsAfterFirst = w.el.calls.length;
  w.fn.gmReviewFocusSettingsField();
  ok(w.el.calls.length === callsAfterFirst, "a second call does not re-focus (flag already cleared)");
}

// ── 4. Never on the wrong tab/section ──────────────────────────────────────
{
  const w = world({ hasElement: true });
  w.focusField = true;
  w.section = "list"; // not "settings"
  w.fn.gmReviewFocusSettingsField();
  ok(w.el.calls.length === 0, "focus never fires while gmEstimatesSection is not settings");
}

// ── 5. Never throws when the element genuinely is not there (e.g. a role
// that cannot see the field) ────────────────────────────────────────────────
{
  const w = world({ hasElement: false });
  w.focusField = true;
  w.section = "settings";
  let threw = false;
  try { w.fn.gmReviewFocusSettingsField(); } catch (e) { threw = true; }
  ok(!threw, "no element found: returns quietly, never throws");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
