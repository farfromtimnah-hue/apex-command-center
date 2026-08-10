// native-bridge.js — Capacitor compatibility shim for the iOS wrapper.
//
// This file is a NO-OP in a normal browser. apex.resonateai.online stays live
// for everyone not on the iOS app, so every native path below is gated on
// apexIsNative() and the web behaviour is left exactly as it was.
//
// It does two things, and deliberately nothing else:
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

function apexInitNativeBridge() {
  if (!apexIsNative()) { return; }   // no-op in a normal browser
  apexInstallMirror();
  // Sync first so the auth gate sees the keys, then the async pass repairs
  // anything the cookie snapshot lost.
  apexRestoreAuthSync();
  apexRestoreAuth(null);
}

// Runs immediately, not on window.onload: page code reads the auth keys during
// initial parse, so waiting for load would restore them after the first read.
apexInitNativeBridge();
