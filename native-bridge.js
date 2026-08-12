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

// --- Admin session persistence -----------------------------------------------

// The client token survives a force-quit because the Preferences mirror above
// covers its localStorage keys. The ADMIN session did not: Firebase's JS SDK
// keeps its session under its own storage keys, and WKWebView does not persist
// those reliably, so Nicole/Alice/Rafa had to sign in with Google again after
// every force-quit.
//
// The fix does NOT mirror Firebase's storage keys. Those names are internal
// (firebase:authUser:<apiKey>:[DEFAULT]) and would break on an SDK upgrade.
//
// Instead it uses what the plugin already gives us. Because skipNativeAuth is
// false, the NATIVE Firebase iOS SDK performs the sign-in and stores its
// session in the iOS keychain, which survives force-quit by design. So the
// session is already durable on disk - only the JS SDK forgets it. On launch we
// ask the native side whether a user is still signed in and, if the JS SDK has
// none, rebuild the JS session from the native ID token. onAuthStateChanged
// then fires exactly as it does after a fresh sign-in, so all 32 call sites and
// the Worker ID-token flow are untouched.

// Rebuilds the JS SDK session from the native one. Resolves true if a session
// was restored, false if there was nothing to restore. Never rejects: a failed
// restore must land the user on the login page, not on a broken page.
function apexRestoreFirebaseSession(firebaseSdk) {
  var plugin = apexFirebaseAuthPlugin();
  if (!apexIsNative() || !plugin) { return Promise.resolve(false); }
  if (!firebaseSdk || !firebaseSdk.auth) { return Promise.resolve(false); }

  // Already signed in on the JS side - nothing to do. This is the common case
  // on in-app navigation between pages.
  try {
    if (firebaseSdk.auth().currentUser) { return Promise.resolve(false); }
  } catch (e) {
    return Promise.resolve(false);
  }

  return plugin.getCurrentUser().then(function (res) {
    if (!res || !res.user) { return false; }
    // A native user exists. Get a fresh Firebase ID token for it.
    return plugin.getIdToken().then(function (tokenRes) {
      var token = tokenRes && tokenRes.token ? tokenRes.token : null;
      if (!token) { return false; }
      // The ID token is a Google-issued OIDC credential for this Firebase
      // project, so it goes back into the JS SDK as a GoogleAuthProvider
      // credential - the same shape apexNativeGoogleSignIn builds after an
      // interactive sign-in. No new auth path: this is the existing one
      // replayed from a session the user already established.
      var jsCred = firebaseSdk.auth.GoogleAuthProvider.credential(token);
      return firebaseSdk.auth().signInWithCredential(jsCred).then(function () {
        return true;
      });
    });
  }).catch(function () {
    // Expired/revoked native session, or the plugin is unavailable. Fall
    // through to the normal signed-out state and let the user sign in.
    return false;
  });
}

// A real sign-out must clear the NATIVE session too. Without this the keychain
// copy would survive and the restore above would resurrect a user who had just
// signed out - the same rule the client-token mirror already follows.
//
// Every one of the 15 handleSignOut() implementations across the app funnels
// through firebase auth().signOut(), so wrapping that one method covers them
// all without editing 15 files or changing any call site.
function apexInstallSignOutHook(firebaseSdk) {
  var plugin = apexFirebaseAuthPlugin();
  if (!apexIsNative() || !plugin) { return; }
  if (!firebaseSdk || !firebaseSdk.auth) { return; }

  var authInstance;
  try {
    authInstance = firebaseSdk.auth();
  } catch (e) {
    return;
  }
  if (!authInstance || typeof authInstance.signOut !== "function") { return; }
  if (authInstance.apexSignOutHooked) { return; }
  authInstance.apexSignOutHooked = true;

  var origSignOut = authInstance.signOut;
  authInstance.signOut = function () {
    var args = arguments;
    var self = this;
    // Native first. If it fails we still sign out of the JS SDK rather than
    // trapping the user in a session they asked to leave, but the failure is
    // logged instead of swallowed.
    return plugin.signOut().catch(function (e) {
      if (window.console && console.error) {
        console.error("Native sign-out failed:", e);
      }
    }).then(function () {
      // Biometric unlock state belongs to the signed-in session. Clearing it
      // means the next user has to authenticate rather than inheriting an
      // unlocked app.
      apexUnlockCleared = apexClearUnlock();
      // The session is gone, so the next cold launch must not raise a cover
      // for it. Left set, the login page would sit behind a lock the user
      // cannot clear.
      apexNativeSessionPresent = false;
      apexSetNativeSessionHint(false);
      return apexUnlockCleared.then(function () {
        return origSignOut.apply(self, args);
      });
    });
  };
}

// --- Biometric unlock --------------------------------------------------------

// With the admin session now persisting, the app reopens straight into a CRM
// full of client leads, pipeline values and financial data. The threat is an
// unlocked phone left on a table, not a rep switching apps mid-call - so this
// gates VIEWING a persisted session behind Face ID / Touch ID.
//
// It is NOT a login method. It never creates, replaces or bypasses a session:
// with no session there is nothing to unlock and the user goes to the login
// page as usual. Google sign-in and the client token flow are untouched.

// 15 minutes. Long enough that the OpenPhone hand-off - tap "Ligar", talk,
// come back - never prompts, which is the core workflow of this app. Short
// enough that a phone left on a table is covered.
var APEX_UNLOCK_GRACE_MS = 15 * 60 * 1000;

// Where the unlock timestamp lives. Preferences (native UserDefaults) rather
// than localStorage: it must survive the WebView storage eviction that the
// whole auth mirror above exists to work around.
var APEX_UNLOCK_KEY = "apex_unlock_at";

// The app is mid-sign-in. The biometric prompt must never fire on top of the
// Google OAuth sheet - the sign-in itself triggers a background/resume cycle,
// and prompting there would deadlock the login this is meant to protect.
var apexSignInInFlight = false;
var apexUnlockInFlight = false;

function apexBiometricPlugin() {
  if (!window.Capacitor || !window.Capacitor.Plugins) { return null; }
  return window.Capacitor.Plugins.BiometricAuthNative || null;
}

// Called by index.html around the Google sign-in so the resume that the OAuth
// sheet causes cannot raise a Face ID prompt on top of it.
function apexSetSignInInFlight(v) {
  apexSignInInFlight = !!v;
}

// MONOTONIC TIME, deliberately not a calendar value.
//
// The grace period is an elapsed DURATION, so it must not be computed from
// wall-clock dates. Date.now() and performance.timeOrigin are both wall-clock
// derived and move when the clock is corrected by NTP, when the user edits the
// clock, or across a DST boundary - any of which could either expire the unlock
// early or, far worse, extend it well past 15 minutes. This project has already
// shipped four bugs from local-vs-UTC date math; none of that machinery belongs
// anywhere near a security timer.
//
// The web platform's only monotonic clock is performance.now(), and it restarts
// on every page navigation - which this app does constantly. A JS-only timer
// would therefore have to either re-prompt on every page click (unusable) or
// compare wall-clock values (unsafe).
//
// So the reading comes from the native side: ApexUptimePlugin returns
// ProcessInfo.systemUptime, milliseconds since the device booted. It counts
// forward only, ignores every clock change, and lives in the OS rather than the
// WebView - so it survives both page navigation and backgrounding. "15 minutes
// since unlock" therefore means 15 real minutes no matter what happens to the
// calendar.
function apexUptimePlugin() {
  if (!window.Capacitor || !window.Capacitor.Plugins) { return null; }
  return window.Capacitor.Plugins.ApexUptime || null;
}

// Resolves to milliseconds since boot, or null if the clock is unavailable.
// A null reading means the grace period cannot be evaluated safely, and every
// caller treats that as "locked" rather than guessing with a calendar value.
function apexMonotonicMs() {
  var plugin = apexUptimePlugin();
  if (!plugin) { return Promise.resolve(null); }
  return plugin.now().then(function (res) {
    if (!res || typeof res.ms !== "number") { return null; }
    return Math.round(res.ms);
  }).catch(function () {
    return null;
  });
}

// Records a successful unlock as a boot-relative reading. Stored in
// Preferences (native UserDefaults) so it survives both page navigation and
// the WebView storage eviction the auth mirror above exists to work around.
function apexMarkUnlocked() {
  var prefs = apexPrefs();
  if (!prefs) { return Promise.resolve(); }
  return apexMonotonicMs().then(function (ms) {
    if (ms === null) { return; }
    // The promise is RETURNED, not fired and forgotten. Preferences.set is
    // async, and not awaiting it let the page navigate before the record
    // landed - the next page then found no unlock and prompted for Face ID a
    // second time. Observed on the device going from index to dashboard.
    return prefs.set({ key: APEX_UNLOCK_KEY, value: String(ms) }).catch(function () {
      // Unlock still succeeded for this resume; worst case the next one
      // prompts again, which fails safe.
    });
  });
}

// Drops any unlock record from a previous run. The promise is RETURNED, not
// fired and forgotten: nothing awaited it before, so apexUnlockIsFresh() could
// read the PREVIOUS run's timestamp before the remove landed and open the app
// with no prompt at all. An Xcode rebuild reproduces this every time - it
// replaces the app but leaves native UserDefaults intact, so the stale unlock
// survives - and a post-install first launch takes the same path.
// Callers must chain off this before any freshness read.
function apexClearUnlock() {
  var prefs = apexPrefs();
  if (!prefs) { return Promise.resolve(); }
  try {
    return Promise.resolve(prefs.remove({ key: APEX_UNLOCK_KEY })).catch(function () {
      // A failed remove means the stale record may still be there. Treat the
      // grace period as unusable for this launch rather than trusting it.
      apexUnlockReadable = false;
    });
  } catch (e) {
    // Same reasoning as the catch above: fail safe, do not trust the record.
    apexUnlockReadable = false;
    return Promise.resolve();
  }
}

// Gate for the grace period. False means "a stale unlock may be readable, so
// do not honour freshness on this launch" - it fails closed into a prompt.
var apexUnlockReadable = true;

// Resolves once the cold-launch clear has landed. Every freshness read waits on
// this, so no read can race the remove.
var apexUnlockCleared = Promise.resolve();

// Resolves true when a previous unlock is still inside the grace window.
//
// Elapsed time is measured against the STORED reading and the deadline is
// fixed at the moment of unlock, so repeatedly backgrounding and foregrounding
// cannot extend the window - which is the property the brief called for.
//
// A cold launch after a REBOOT yields a smaller uptime than the stored value,
// giving a negative elapsed time, which is treated as locked. A cold launch
// without a reboot is handled by apexClearUnlock() at startup, so a killed and
// relaunched app always re-prompts.
function apexUnlockIsFresh() {
  var prefs = apexPrefs();
  if (!prefs) { return Promise.resolve(false); }

  // Wait for the cold-launch clear before reading. Without this the read could
  // return the previous run's timestamp and skip the prompt entirely.
  return apexUnlockCleared.then(function () {
    if (!apexUnlockReadable) { return null; }
    return prefs.get({ key: APEX_UNLOCK_KEY });
  }).then(function (res) {
    var raw = res && res.value ? res.value : null;
    if (!raw) { return false; }
    var at = parseInt(raw, 10);
    if (isNaN(at)) { return false; }

    return apexMonotonicMs().then(function (nowMs) {
      // No trustworthy clock means no trustworthy grace period.
      if (nowMs === null) { return false; }
      var elapsed = nowMs - at;
      // Negative means the device rebooted (uptime reset) or the record was
      // tampered with. Either way, require authentication.
      if (elapsed < 0) { return false; }
      return elapsed < APEX_UNLOCK_GRACE_MS;
    });
  }).catch(function () {
    return false;
  });
}

// The opaque cover that hides the CRM while locked. Injected rather than added
// to every page's markup, for the same reason the safe-area CSS is: 25 pages,
// nine of which do not even link mobile.css.
//
// It is added synchronously during parse so there is never a frame in which
// lead data is painted before the lock appears.
var APEX_LOCK_ID = "apex-biometric-lock";

function apexShowLock() {
  if (document.getElementById(APEX_LOCK_ID)) { return; }
  var el = document.createElement("div");
  el.id = APEX_LOCK_ID;
  el.setAttribute("role", "presentation");
  el.style.cssText = [
    "position:fixed", "inset:0", "z-index:2147483647",
    "background:#141210",
    "display:flex", "align-items:center", "justify-content:center",
    "flex-direction:column", "gap:18px"
  ].join(";");

  // No branding for the first second: the OS presents its own Face ID sheet on
  // top, and a half-second of branding behind it reads as a flash. A plain
  // field is calmer.
  //
  // That reasoning holds for half a second, not for twenty. The first launch
  // after a fresh install is slow for ordinary reasons - iOS finishing the
  // install, WebView cold start, nothing cached - and that is not a defect to
  // chase. But a bare dark field for that long is indistinguishable from a
  // broken app: Nicole assumed exactly that and put the phone down, and a
  // client with no one to ask will do the same. So the mark fades in only if
  // the cover has been up longer than a second: the fast path still looks
  // clean, and a slow one says "locked", not "dead".
  var mark = document.createElement("div");
  mark.id = "apex-biometric-mark";
  mark.textContent = "APEX";
  mark.style.cssText = [
    "font-family:'Inter',sans-serif", "font-size:15px", "font-weight:700",
    "letter-spacing:3px", "color:#C9A43A",
    "opacity:0", "transition:opacity 400ms ease"
  ].join(";");

  var sub = document.createElement("div");
  sub.id = "apex-biometric-sub";
  sub.textContent = "Bloqueado / Locked";
  sub.style.cssText = [
    "font-family:'Inter',sans-serif", "font-size:12px", "letter-spacing:0.6px",
    "color:#7A7168", "margin-top:-8px",
    "opacity:0", "transition:opacity 400ms ease"
  ].join(";");

  // window.setTimeout, not a CSS animation-delay: the element is removed the
  // instant the unlock lands, so on the fast path this never fires at all.
  var reveal = window.setTimeout(function () {
    mark.style.opacity = "1";
    sub.style.opacity = "1";
  }, 1000);
  el.setAttribute("data-apex-reveal-timer", String(reveal));

  var btn = document.createElement("button");
  btn.id = "apex-biometric-retry";
  btn.type = "button";
  btn.textContent = "Desbloquear / Unlock";
  btn.style.cssText = [
    "background:transparent", "border:1.5px solid #C9A43A", "color:#C9A43A",
    "font-family:'Inter',sans-serif", "font-size:14px", "font-weight:700",
    "letter-spacing:0.8px", "padding:14px 26px", "border-radius:10px",
    "min-height:48px", "cursor:pointer", "display:none"
  ].join(";");
  btn.onclick = function () { apexRunUnlock(true); };

  el.appendChild(mark);
  el.appendChild(sub);
  el.appendChild(btn);
  // During head parse document.body does not exist yet - on dashboard.html
  // this file runs at line 5 and <body> opens at line 622 - so the cover is
  // appended to <html> instead. Verified in a browser that a fixed, full-inset
  // element parented to <html> before <body> is parsed still covers the page
  // and still wins the hit test at the content's coordinates, so this is a
  // real cover and not merely an early one.
  (document.body || document.documentElement).appendChild(el);
}

function apexHideLock() {
  var el = document.getElementById(APEX_LOCK_ID);
  if (!el) { return; }
  // Drop the reveal timer with the element, so a cover removed inside the
  // first second cannot fire a callback against a detached node.
  var t = el.getAttribute("data-apex-reveal-timer");
  if (t) { window.clearTimeout(parseInt(t, 10)); }
  if (el.parentNode) { el.parentNode.removeChild(el); }
}

// Reveals the manual retry button. Reached when the user cancels the sheet or
// authentication fails - the app stays covered, but there is a way back in
// without force-quitting.
function apexShowRetry() {
  var btn = document.getElementById("apex-biometric-retry");
  if (btn) { btn.style.display = "block"; }
}

// Is there anything worth locking? With no session there is nothing to protect
// and the user is headed for the login page anyway, so prompting would be
// pure friction. Covers BOTH session kinds: the admin Firebase session and the
// client token.
function apexHasSession() {
  try {
    if (window.localStorage.getItem("apex_client_token")) { return true; }
  } catch (e) {
    // fall through to the Firebase check
  }
  // The Firebase JS session may not be restored yet at this point, so the
  // native session is the authoritative signal on a cold launch.
  //
  // apexNativeSessionHint() covers the window BEFORE getCurrentUser() has
  // answered: on a cold launch the flag from the previous run is the only
  // synchronous evidence an admin session exists, and without it this returns
  // false and the prompt never fires. If the hint turns out to be stale the
  // bootstrap clears it and hides the cover, so the cost of trusting it is a
  // brief cover on an unlocked app - the cheap direction to be wrong in.
  return apexNativeSessionPresent || apexNativeSessionHint();
}

// Set by the startup restore so apexHasSession() can answer synchronously.
var apexNativeSessionPresent = false;

// A durable, SYNCHRONOUSLY readable marker that an admin session existed on the
// last run.
//
// The admin session itself is deliberately not mirrored into localStorage - it
// lives in the iOS keychain and is only discoverable through the async
// getCurrentUser(). That async-ness is exactly what left the dashboard
// uncovered on a cold launch: the cover could not go up until a plugin round
// trip finished, and the page painted meanwhile.
//
// So we record only the FACT that a session exists, in the same cookie
// snapshot the auth mirror already uses (it survives force-quit, unlike
// sessionStorage, and is readable during head parse, unlike Preferences). It
// holds no credential - just a flag - so the keychain remains the only place a
// real session lives.
var APEX_ADMIN_HINT_KEY = "apex_admin_session";

function apexNativeSessionHint() {
  return apexReadSnapshot(APEX_ADMIN_HINT_KEY) === "1";
}

// Written when a native session is confirmed, cleared on sign-out. A stale
// "1" is harmless: it raises the cover on a launch with no session, and the
// bootstrap hides it again the moment getCurrentUser() reports nobody. The
// reverse mistake - a missing marker - is the one that exposes data, so this
// errs toward covering.
function apexSetNativeSessionHint(present) {
  apexMirrorSnapshot(APEX_ADMIN_HINT_KEY, present ? "1" : null);
}

// Runs the biometric prompt. `manual` is true when the user tapped Unlock.
function apexRunUnlock(manual) {
  var plugin = apexBiometricPlugin();
  if (!plugin) {
    // No plugin: nothing can be verified, so do not strand the user behind a
    // cover they cannot clear.
    apexHideLock();
    return Promise.resolve(true);
  }
  // Guard against the plugin renaming its methods on an upgrade. Without this
  // a missing method is just a rejected promise, which is indistinguishable
  // from a failed authentication and easy to mistake for working code.
  if (typeof plugin.internalAuthenticate !== "function" ||
      typeof plugin.checkBiometry !== "function") {
    if (window.console && console.error) {
      console.error("Biometric plugin API changed - lock cannot run.");
    }
    apexShowLock();
    apexShowRetry();
    return Promise.resolve(false);
  }

  if (apexUnlockInFlight && !manual) { return Promise.resolve(false); }
  apexUnlockInFlight = true;

  return plugin.checkBiometry().then(function (info) {
    // deviceIsSecure is false when there is neither biometrics NOR a passcode.
    // Locking such a device would lock the owner out of their own tool with no
    // way to authenticate, so the app opens normally. This is the explicit
    // "do not lock anyone out" requirement, not an oversight.
    if (!info || (!info.isAvailable && !info.deviceIsSecure)) {
      apexHideLock();
      apexUnlockInFlight = false;
      return true;
    }

    // internalAuthenticate, NOT authenticate. The plugin's authenticate() is a
    // JS-side wrapper that exists only in the bundled ESM module; the method
    // actually registered on the native plugin is internalAuthenticate, and
    // this app reaches the plugin through Capacitor.Plugins directly because it
    // has no bundler. Calling the wrapper name here silently rejected with
    // "not implemented", which the catch below turned into a fail-open - the
    // app opened with no prompt at all. Verified on the device.
    return plugin.internalAuthenticate({
      reason: "Unlock Apex Command Center",
      cancelTitle: "Cancelar",
      // The passcode fallback. With biometrics unavailable, failed, or
      // locked out after too many attempts, iOS falls back to the device
      // passcode - never to no authentication at all.
      allowDeviceCredential: true,
      iosFallbackTitle: "Usar senha / Use passcode"
    }).then(function () {
      // The lock is lifted only AFTER the unlock is durably stored. Hiding it
      // first would let a fast navigation start a new page before Preferences
      // had the record, and that page would prompt again - observed on the
      // device as a second Face ID prompt going from index to dashboard.
      return apexMarkUnlocked().then(function () {
        apexHideLock();
        apexUnlockInFlight = false;
        return true;
      });
    }).catch(function (err) {
      // Cancelled or failed. The app stays covered; the retry button gives a
      // way back in. Logged rather than swallowed.
      if (window.console && console.warn) {
        console.warn("Biometric unlock failed:", err && err.message ? err.message : err);
      }
      apexShowRetry();
      apexUnlockInFlight = false;
      return false;
    });
  }).catch(function (err) {
    // checkBiometry itself failed, or a plugin method was missing. This must
    // FAIL CLOSED: an earlier version failed open here, and a single wrong
    // method name (authenticate vs internalAuthenticate) silently disabled the
    // entire lock while still looking like it worked. The cover stays up and
    // the retry button is offered.
    //
    // This cannot strand a user who has no way to authenticate: the
    // deviceIsSecure branch above already lets those devices straight through
    // BEFORE any prompt is attempted, so reaching here means the device does
    // have biometrics or a passcode.
    if (window.console && console.error) {
      console.error("Biometric check failed:", err && err.message ? err.message : err);
    }
    apexShowRetry();
    apexUnlockInFlight = false;
    return false;
  });
}

// Decides whether this resume needs the prompt, then runs it.
function apexMaybeLock() {
  // Never prompt on top of the Google OAuth sheet. Signing in necessarily
  // backgrounds and resumes the app, and prompting there would deadlock the
  // very login this is meant to protect.
  if (apexSignInInFlight) { return; }
  // apexHasSession() is synchronous BY DESIGN (see apexNativeSessionPresent),
  // so "is there anything to protect" is answered without awaiting anything.
  if (!apexHasSession()) { return; }

  // COVER FIRST, ASK QUESTIONS AFTER.
  //
  // This used to await apexUnlockIsFresh() - a round trip through native
  // Preferences AND the uptime plugin - and only then raise the cover.
  // Everything the page rendered during that round trip was visible with no
  // cover at all.
  //
  // The proof is a screenshot taken while the iOS "Face Not Recognized / Usar
  // senha / Cancelar" sheet was on screen - i.e. authentication had NOT
  // succeeded - with the dashboard fully readable behind it: the greeting,
  // PENDENTES/RESUMIDOS counts, and two real client records. Whether some
  // OTHER launch painted after a very fast legitimate unlock is unknown and
  // does not matter here; that one frame is sufficient on its own.
  //
  // The cover now goes up synchronously and comes back down if the grace
  // period turns out to be fresh. A brief cover on an unlocked app is
  // harmless; a brief exposure of client data is not.
  apexShowLock();

  apexUnlockIsFresh().then(function (fresh) {
    if (fresh) { apexHideLock(); return; }
    apexRunUnlock(false);
  }).catch(function () {
    // Freshness unknown - stay covered and prompt. Fails closed.
    apexRunUnlock(false);
  });
}

// Wires the resume listener and performs the cold-launch lock.
function apexInstallBiometricLock() {
  if (!apexIsNative()) { return; }
  if (!apexBiometricPlugin()) { return; }

  // A cold launch must always re-prompt, so any unlock left over from the
  // previous run is dropped BEFORE it can be read. The promise is kept in
  // apexUnlockCleared and every freshness read chains off it - firing this and
  // forgetting it let apexMaybeLock() read a stale timestamp and open the app
  // with no prompt at all (reproduced by any Xcode rebuild, and by the
  // post-install first launch on a client's phone).
  apexUnlockCleared = apexClearUnlock();

  var appPlugin = (window.Capacitor.Plugins || {}).App;
  if (appPlugin && appPlugin.addListener) {
    appPlugin.addListener("appStateChange", function (state) {
      if (state && state.isActive) { apexMaybeLock(); }
    });
  }
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

  // COLD-LAUNCH LOCK. Put the cover up before any page content can paint, so
  // there is never a frame showing lead data to whoever picked the phone up.
  // Only when a session actually exists: with none, the user is headed to the
  // login page and locking would be pure friction.
  //
  // Both session kinds are covered synchronously here.
  //
  // The client token is readable synchronously (the restore above just ran).
  //
  // The ADMIN case used to be left to apexBootstrapNativeSession, which raises
  // the cover only after the Firebase SDK has loaded, the initializeApp hook
  // has fired, AND getCurrentUser() has resolved. On dashboard.html this file
  // runs at line 5 while initializeApp is on line 1226, so the entire dashboard
  // - header, counts, client rows - painted in that window with no cover. That
  // is precisely the reported exposure, and an admin session is the case
  // Nicole's screenshot was taken from.
  //
  // apexNativeSessionHint() reads the mirrored auth key that the restore above
  // just wrote, so the admin session is known synchronously too. Raising the
  // cover here is safe even if it turns out there is no session: the bootstrap
  // and the resume path both hide it again once that is established.
  var coverRaised = false;
  try {
    if (apexBiometricPlugin() &&
        (window.localStorage.getItem("apex_client_token") || apexNativeSessionHint())) {
      apexShowLock();
      coverRaised = true;
    }
  } catch (e) {
    // No storage - nothing to protect that we can see from here.
  }

  apexInstallBiometricLock();

  // Raising the cover is not enough on its own - something has to actually run
  // the prompt, or the app sits behind a dark field with no way through. The
  // cold launch previously relied on apexBootstrapNativeSession to do that,
  // which only runs on pages that initialise Firebase; a client-token launch
  // therefore covered and never prompted. Drive the unlock here instead, once
  // the stale-unlock clear has landed so the grace period cannot be read from
  // the previous run.
  if (coverRaised) {
    apexUnlockCleared.then(function () {
      apexMaybeLock();
    });
  }
}

// Restores the admin session and applies the cold-launch lock for it.
//
// Separate from apexInitNativeBridge because it needs the Firebase JS SDK,
// which is loaded per-page AFTER this file. index.html calls this once the SDK
// is initialized; pages that have no Firebase simply never call it and keep
// their existing client-token behaviour.
function apexBootstrapNativeSession(firebaseSdk) {
  if (!apexIsNative()) { return Promise.resolve(false); }

  apexInstallSignOutHook(firebaseSdk);

  var plugin = apexFirebaseAuthPlugin();
  if (!plugin) { return Promise.resolve(false); }

  // Ask the native side first. If a session exists, cover the screen BEFORE
  // restoring it, so the restore cannot briefly reveal the app.
  return plugin.getCurrentUser().then(function (res) {
    if (!res || !res.user) {
      // No admin session. Clear the hint so the next cold launch does not
      // raise a cover for a session that no longer exists, and take down any
      // cover this launch raised on the strength of a stale hint.
      apexSetNativeSessionHint(false);
      if (!apexHasSession()) { apexHideLock(); }
      return false;
    }
    apexNativeSessionPresent = true;
    // Record the session for the NEXT cold launch, so the cover can go up
    // during head parse instead of waiting on this round trip.
    apexSetNativeSessionHint(true);
    if (apexBiometricPlugin()) {
      apexShowLock();
      apexMaybeLock();
    }
    return apexRestoreFirebaseSession(firebaseSdk);
  }).catch(function () {
    // Unknown session state. Leave any cover in place and leave the hint
    // alone - both fail toward protecting data rather than exposing it.
    return false;
  });
}

// Runs immediately, not on window.onload: page code reads the auth keys during
// initial parse, so waiting for load would restore them after the first read.
apexInitNativeBridge();

// SELF-BOOTSTRAP FOR THE INNER PAGES.
//
// index.html calls apexBootstrapNativeSession itself, right where it owns the
// SDK. The other 23 pages each call firebase.initializeApp() inside their own
// init(), and every one of them redirects to index.html when onAuthStateChanged
// reports no user - so after a force-quit they would bounce an admin to the
// login page before the native session could be restored.
//
// Editing 23 init() functions would mean 23 chances to get it wrong, so instead
// the restore is hooked onto initializeApp itself: whichever page calls it, the
// native session is restored immediately afterwards, before that page's
// onAuthStateChanged has a signed-out state to react to. One mechanism, no page
// edits, and a no-op in a browser because the whole thing is behind
// apexIsNative().
(function () {
  if (!apexIsNative()) { return; }

  var installed = false;

  function hookInitializeApp() {
    if (installed) { return true; }
    if (typeof window.firebase === "undefined" || !window.firebase) { return false; }
    if (typeof window.firebase.initializeApp !== "function") { return false; }

    var orig = window.firebase.initializeApp;
    window.firebase.initializeApp = function () {
      var app = orig.apply(window.firebase, arguments);
      try {
        apexBootstrapNativeSession(window.firebase);
      } catch (e) {
        // A failed restore must not stop the page initializing; the user
        // simply lands on the login page as they did before.
      }
      return app;
    };
    installed = true;
    return true;
  }

  // The SDK <script> tags sit at the END of every page, while this file loads
  // in <head>, so firebase does not exist yet. Poll briefly rather than wait
  // for DOMContentLoaded: the pages call initializeApp from inline scripts that
  // can run before that event, and the hook has to be in place first.
  if (hookInitializeApp()) { return; }
  var tries = 0;
  var timer = window.setInterval(function () {
    tries = tries + 1;
    if (hookInitializeApp() || tries > 600) { window.clearInterval(timer); }
  }, 10);
}());
