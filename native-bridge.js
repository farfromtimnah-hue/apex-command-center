// native-bridge.js — Capacitor compatibility shim for the iOS wrapper.
//
// This file is a NO-OP in a normal browser. apex.resonateai.online stays live
// for everyone not on the iOS app, so every native path below is gated on
// apexIsNative() and the web behaviour is left exactly as it was.
//
// It does four things, and deliberately nothing else:
//
// 1. AUTH MIRROR. A Capacitor WKWebView has its own storage container,
//    separate from Safari, and iOS treats WebView localStorage as evictable
//    under memory pressure. So a user who is logged in can be silently logged
//    out at random. Every write to the auth keys is mirrored into Capacitor
//    Preferences (native UserDefaults, not evictable), and at startup the keys
//    are restored into localStorage if localStorage has lost them.
//
//    This is a mirror-and-restore shim. It does NOT rewrite the auth logic:
//    all 64 existing read/write sites across the app keep using localStorage
//    exactly as they do today and are untouched.
//
// 2. DIAL TARGET. An iOS PWA cannot launch a custom URL scheme, which is the
//    whole reason the native wrapper exists. Inside Capacitor the call buttons
//    hand OpenPhone's scheme to the OS instead of tel:.
//
// 3. SAFE AREA. A WKWebView draws under the status bar and the home indicator,
//    which a browser tab does not. The header therefore sits beneath the clock
//    and the sign-out and language controls become untappable. The insets are
//    injected as a stylesheet HERE, gated on apexIsNative(), rather than added
//    to the shared CSS: the header rules live in per-page inline <style> blocks
//    on 24 pages, nine pages do not even link mobile.css, and bare env() in a
//    shared stylesheet would also apply in a browser. This file is the one
//    thing every page loads and already owns the native check.
//
// 4. GOOGLE SIGN-IN. signInWithPopup cannot work in the WKWebView: the origin
//    is capacitor://localhost, and Google refuses OAuth in embedded webviews
//    as policy, which no Firebase setting overrides. Inside Capacitor the
//    admin sign-in runs through the native Google SDK instead, and the
//    resulting credential is handed to the SAME Firebase JS SDK session the
//    web uses. Downstream is therefore identical: every onAuthStateChanged
//    call site and the existing ID-token flow to the Worker keep working
//    unchanged, and the browser keeps using signInWithPopup untouched.
//
// Loaded FIRST in <head>, synchronously (no defer): the restore must finish
// before any page code reads a token. The report pages read
// apex_client_token at module scope, so a deferred script would be too late.

var APEX_AUTH_KEYS = ["apex_client_token", "apex_client_id", "apex_client_name", "apexLeadLayout"];

function apexIsNative() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

function apexPrefs() {
  if (!window.Capacitor || !window.Capacitor.Plugins) { return null; }
  return window.Capacitor.Plugins.Preferences || null;
}

// Mirror one key into native Preferences. Fire-and-forget: a failed mirror
// must never block or break the localStorage write that already succeeded.
function apexMirrorKey(key, value) {
  var prefs = apexPrefs();
  if (!prefs) { return; }
  try {
    if (value === null || typeof value === "undefined") {
      prefs.remove({ key: key });
    } else {
      prefs.set({ key: key, value: String(value) });
    }
  } catch (e) {
    // Preferences unavailable — localStorage still holds the value.
  }
  apexMirrorSnapshot(key, value);
}

// The Preferences API is Promise-based, but the app reads its auth keys
// SYNCHRONOUSLY during initial parse — index.html decides whether to
// auto-login at parse time, and the report pages read the token at module
// scope. An async-only restore therefore lands AFTER the gate has already
// concluded the user is logged out, which is the exact failure this shim
// exists to prevent.
//
// So the mirror is written twice: to Preferences (durable, survives eviction)
// and to a cookie snapshot (readable synchronously at startup). Cookies live
// in WKWebView's own store, which is NOT the evictable localStorage bucket,
// so the snapshot generally survives the eviction that loses localStorage.
// Preferences remains the source of truth and repairs the snapshot if the
// cookie is ever lost too.
var APEX_SNAP_PREFIX = "apexsnap_";

function apexMirrorSnapshot(key, value) {
  try {
    if (value === null || typeof value === "undefined") {
      document.cookie = APEX_SNAP_PREFIX + key + "=; max-age=0; path=/";
    } else {
      document.cookie = APEX_SNAP_PREFIX + key + "=" + encodeURIComponent(String(value)) +
        "; max-age=31536000; path=/";
    }
  } catch (e) {
    // Cookies unavailable — Preferences still holds the durable copy.
  }
}

function apexReadSnapshot(key) {
  try {
    var name = APEX_SNAP_PREFIX + key + "=";
    var parts = String(document.cookie || "").split(";");
    var i, p;
    for (i = 0; i < parts.length; i++) {
      p = parts[i];
      while (p.charAt(0) === " ") { p = p.substring(1); }
      if (p.indexOf(name) === 0) { return decodeURIComponent(p.substring(name.length)); }
    }
  } catch (e) {
    return null;
  }
  return null;
}

// Synchronous half of the restore. Runs before any page code reads a key.
function apexRestoreAuthSync() {
  var i, key, snap;
  for (i = 0; i < APEX_AUTH_KEYS.length; i++) {
    key = APEX_AUTH_KEYS[i];
    if (window.localStorage.getItem(key) !== null) { continue; }
    snap = apexReadSnapshot(key);
    if (snap !== null) { window.localStorage.setItem(key, snap); }
  }
}

// Wrap setItem/removeItem/clear so that any existing auth write anywhere in
// the app also lands in Preferences, without changing a single call site.
// Non-auth keys pass straight through untouched.
function apexInstallMirror() {
  var proto = window.localStorage;
  if (!proto) { return; }

  var origSet = proto.setItem;
  var origRemove = proto.removeItem;
  var origClear = proto.clear;

  proto.setItem = function (key, value) {
    origSet.call(proto, key, value);
    if (APEX_AUTH_KEYS.indexOf(key) !== -1) { apexMirrorKey(key, value); }
  };

  proto.removeItem = function (key) {
    origRemove.call(proto, key);
    // A real logout must clear the native copy too, otherwise the next
    // launch would restore the token the user just signed out of.
    if (APEX_AUTH_KEYS.indexOf(key) !== -1) { apexMirrorKey(key, null); }
  };

  proto.clear = function () {
    origClear.call(proto);
    var i;
    for (i = 0; i < APEX_AUTH_KEYS.length; i++) { apexMirrorKey(APEX_AUTH_KEYS[i], null); }
  };
}

// Restore evicted keys at startup. Only fills keys localStorage is MISSING —
// a value already present in localStorage is the fresher one and always wins,
// so this can never clobber a newer login with a stale native copy.
function apexRestoreAuth(done) {
  var prefs = apexPrefs();
  if (!prefs) { if (done) { done(); } return; }

  var pending = APEX_AUTH_KEYS.length;
  var i;

  function settle() {
    pending = pending - 1;
    if (pending <= 0 && done) { done(); }
  }

  for (i = 0; i < APEX_AUTH_KEYS.length; i++) {
    (function (key) {
      if (window.localStorage.getItem(key) !== null) { settle(); return; }
      try {
        prefs.get({ key: key }).then(function (res) {
          if (res && res.value !== null && typeof res.value !== "undefined") {
            window.localStorage.setItem(key, res.value);
            // Repair the synchronous snapshot so the NEXT launch can restore
            // this key without waiting on a Promise.
            apexMirrorSnapshot(key, res.value);
          }
          settle();
        }).catch(function () { settle(); });
      } catch (e) { settle(); }
    })(APEX_AUTH_KEYS[i]);
  }
}

// --- Dial target -----------------------------------------------------------

// Normalize to the same digits gm.js's gmWaDigits() produces (strip non-digits,
// prepend "1" for a 10-digit US number) and prefix "+" for E.164.
function apexDialDigits(tel) {
  var digits = String(tel || "").replace(/\D/g, "");
  if (digits.length === 10) { digits = "1" + digits; }
  return digits;
}

// The OpenPhone scheme. The company rebranded to Quo but the scheme is still
// literally "openphone". No "from" parameter: with it omitted OpenPhone uses
// the currently selected number, and there is no OpenPhone number to set yet.
function apexOpenPhoneUrl(tel) {
  var digits = apexDialDigits(tel);
  if (!digits) { return ""; }
  return "openphone://dial?number=" + encodeURIComponent("+" + digits) + "&action=call";
}

// The URL the Call button should use. tel: in a browser, openphone:// in the
// app. Every call site routes through here so there is one rule, not three.
function apexCallHref(tel) {
  if (!tel) { return ""; }
  if (apexIsNative()) { return apexOpenPhoneUrl(tel); }
  return "tel:" + String(tel).replace(/[^\d+]/g, "");
}

// window.open is blocked more aggressively in WKWebView than in Safari. Inside
// Capacitor, hand the URL to the OS directly so WhatsApp still opens.
function apexOpenExternal(url) {
  if (!url) { return true; }
  if (apexIsNative()) {
    try {
      if (window.Capacitor.Plugins && window.Capacitor.Plugins.Browser) {
        window.Capacitor.Plugins.Browser.open({ url: url });
        return true;
      }
    } catch (e) {
      // fall through to a direct assignment
    }
    window.location.href = url;
    return true;
  }
  return !!window.open(url, "_blank");
}

// --- Google sign-in ----------------------------------------------------------

// Admin accounts (Nicole, Alice, Rafa) have no email/password path - Google is
// the only way in - so this is what gates handing the app to anyone else.
//
// The web keeps signInWithPopup. Only the native branch is new, and it is
// deliberately shaped so that everything AFTER sign-in is identical on both:
// the native SDK returns a Google idToken/accessToken, that is turned into a
// standard firebase.auth.GoogleAuthProvider credential, and signInWithCredential
// puts it into the ordinary Firebase JS session. From that point the JS SDK
// holds a normal signed-in user, so onAuthStateChanged fires as usual and
// user.getIdToken() returns the same Firebase ID token the Worker already
// accepts. No new login path, no weakened check, no Worker change.

function apexFirebaseAuthPlugin() {
  if (!window.Capacitor || !window.Capacitor.Plugins) { return null; }
  return window.Capacitor.Plugins.FirebaseAuthentication || null;
}

// True only when the native flow is both needed and actually available.
// If the plugin is missing, this returns false and the caller falls back to
// the web popup rather than dead-ending the only admin login route.
function apexCanNativeGoogle() {
  return !!(apexIsNative() && apexFirebaseAuthPlugin());
}

// Runs the native Google flow and mirrors the result into the Firebase JS SDK.
// Returns a Promise resolving to the JS SDK's UserCredential, so the caller
// can treat it exactly like a signInWithPopup() result.
//
// firebaseSdk is passed in rather than read off window: index.html owns the
// initialized SDK and its own availability guard, and this file must not
// assume Firebase loaded at all.
function apexNativeGoogleSignIn(firebaseSdk) {
  var plugin = apexFirebaseAuthPlugin();
  if (!plugin) {
    return Promise.reject(new Error("Native sign-in unavailable"));
  }
  if (!firebaseSdk || !firebaseSdk.auth) {
    return Promise.reject(new Error("Firebase SDK unavailable"));
  }

  return plugin.signInWithGoogle().then(function (result) {
    var cred = result && result.credential ? result.credential : null;
    // idToken is what signInWithCredential needs. The plugin returns it on
    // iOS for Google; without it there is nothing to hand to the JS SDK, and
    // failing loudly here is better than leaving a half-signed-in state where
    // the native layer has a user and the JS SDK does not.
    if (!cred || !cred.idToken) {
      throw new Error("No Google credential returned");
    }
    var jsCred = firebaseSdk.auth.GoogleAuthProvider.credential(
      cred.idToken,
      cred.accessToken || null
    );
    return firebaseSdk.auth().signInWithCredential(jsCred);
  });
}

// --- Safe area ---------------------------------------------------------------

// Marks the document as running inside the native shell. Everything below is
// scoped under this class so a browser can never match any of it, even if the
// stylesheet were somehow served to one.
var APEX_NATIVE_CLASS = "apex-native";

// The header is `position: sticky; top: 0` on the report pages and portal, and
// an in-flow `flex-shrink: 0` bar on the dashboard-family pages. In both cases
// it is the first thing under the status bar, so top padding on the header is
// the correct fix for every page shape.
//
// Height needs care. Every page sets `box-sizing: border-box` globally, so on
// the pages that declare a fixed `height: 64px` the added top padding would be
// taken OUT of the 64px instead of growing the bar - the logo would be squashed
// against the status bar rather than pushed below it. So height is released to
// auto and re-imposed as a min-height that includes the inset.
//
// The base height differs by page family (64px on the app pages, 56px on the
// reports), so it is read from a variable with a 64px default and the report
// pages' bare 56px header overrides it. Reading the page's own declared height
// is not possible in CSS, hence the variable.
//
// Both header selectors are covered because the two families disagree:
// #appHeader on the dashboard family, a bare <header> on index/portal/reports.
// Scoping the bare `header` under .apex-native keeps it from reaching any
// other <header> a page might grow later on the web.
function apexSafeAreaCss() {
  return "" +
    "html." + APEX_NATIVE_CLASS + " #appHeader," +
    "html." + APEX_NATIVE_CLASS + " body > header {" +
      "--apex-hdr-h: 64px;" +
      "padding-top: env(safe-area-inset-top);" +
      "height: auto;" +
      "min-height: calc(var(--apex-hdr-h) + env(safe-area-inset-top));" +
      "box-sizing: border-box;" +
    "}" +
    // The report pages run a shorter 56px bar with its own 10px vertical
    // padding. Without this they would gain 8px of dead height. They are told
    // apart by carrying a .header-title, which no app-page header has.
    "html." + APEX_NATIVE_CLASS + " body > header:has(.header-title) {" +
      "--apex-hdr-h: 56px;" +
      "padding-top: calc(10px + env(safe-area-inset-top));" +
    "}" +
    // The dock and the FAB already reserve env(safe-area-inset-bottom) in
    // mobile.css and gm.css, but nine report pages never link mobile.css. This
    // is a native-only floor under the home indicator for anything fixed to the
    // bottom of those pages, and is a no-op where the reserve already exists.
    "html." + APEX_NATIVE_CLASS + " #mobile-tab-bar {" +
      "padding-bottom: env(safe-area-inset-bottom);" +
    "}";
}

// Injected rather than linked so there is exactly one native check and no
// second stylesheet for the web build to accidentally pick up.
function apexInstallSafeArea() {
  var doc = document.documentElement;
  if (!doc) { return; }
  doc.classList.add(APEX_NATIVE_CLASS);

  var style = document.createElement("style");
  style.id = "apex-safe-area";
  style.textContent = apexSafeAreaCss();

  // This runs during parse from <head>, so document.head exists but <body>
  // does not. Appending to head also puts these rules BEFORE each page's
  // inline <style>, which would lose the cascade at equal specificity - so
  // the selectors above carry an extra html. qualifier to outrank them.
  var head = document.head || doc;
  head.appendChild(style);
}

function apexInitNativeBridge() {
  if (!apexIsNative()) { return; }   // no-op in a normal browser

  // Before the storage gate below: the header fix is pure CSS and must land
  // even in a WebView where localStorage is unavailable, otherwise a user in
  // that state gets an app they cannot sign out of.
  try {
    apexInstallSafeArea();
  } catch (e) {
    // A failed inset injection must not take the auth mirror down with it.
  }

  // Storage can be unavailable (disabled or throwing) in a WebView. This runs
  // during parse, so an exception here would break the whole page.
  try {
    if (!window.localStorage) { return; }
  } catch (e) {
    return;
  }
  apexInstallMirror();
  // Sync first so the auth gate sees the keys, then the async pass repairs
  // anything the cookie snapshot lost.
  apexRestoreAuthSync();
  apexRestoreAuth(null);
}

// Runs immediately, not on window.onload: page code reads the auth keys during
// initial parse, so waiting for load would restore them after the first read.
apexInitNativeBridge();
