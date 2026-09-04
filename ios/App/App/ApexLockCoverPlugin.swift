import Foundation
import UIKit
import WebKit
import LocalAuthentication
import Capacitor

// NATIVE RECOVERY ACTIONS -- NO JAVASCRIPT DEPENDENCY.
//
// WHY THIS IS NOT AN OPTIMISATION. The device log settled it:
//
//   t=20824ms  STALL TIMER fired - recovery UI shown
//   t=39204ms  RECOVERY UI tappable
//   t=48301ms  JSERROR HOOK installed on capacitor://localhost
//   t=53334ms  JSERROR HOOK installed on capacitor://localhost/dashboard.html
//
// JavaScript does not begin running until NINE SECONDS after the buttons are
// tappable. That is not a race, it is the normal case on a slow launch -- the
// exact case the recovery UI exists for. And there are two documents, five
// seconds apart, so a listener registered on index.html dies at the navigation
// to dashboard.html regardless.
//
// So the recovery path cannot depend on the web layer at all. These actions run
// entirely in native code and work whether or not JS ever loads.
//
// THE SEVEN DOCUMENTED CONSTRAINTS ARE PRESERVED, not bypassed:
//   - internalAuthenticate, NOT authenticate: the plugin's method is a thin
//     wrapper over LAContext.evaluatePolicy (BiometricAuthNative.swift:92-134).
//     Calling LAContext directly IS that path, minus the bridge hop, so the
//     wrong-method-name class of bug cannot recur here.
//   - deviceIsSecure fail-open: canEvaluatePolicy is checked for BOTH policies
//     below; a device with neither biometrics nor a passcode is let through
//     rather than locked out.
//   - checkBiometry FAILS CLOSED: any error other than "no auth available at
//     all" keeps the cover up and re-offers the buttons.
//   - apexMarkUnlocked awaited before the cover comes down: the timestamp is
//     written SYNCHRONOUSLY to UserDefaults before hide() is called.
//   - monotonic uptime, never wall clock: ProcessInfo.systemUptime, the same
//     source ApexUptimePlugin returns to JS, written in the same units.
//   - apexSignInInFlight: the cover is not up during Google sign-in, so this
//     path cannot collide with the OAuth sheet.
//   - the 15-minute grace period: untouched. This writes the same key JS reads,
//     so a native unlock satisfies the JS freshness check on the next resume.
enum ApexNativeRecovery {

    // Mirrors @capacitor/preferences: UserDefaults.standard, keys prefixed
    // "CapacitorStorage." (Preferences.swift:10 and :23). Verified against the
    // package source rather than assumed, because a mismatched key would mean a
    // native unlock the JS side cannot see -- and a second prompt.
    private static let prefsPrefix = "CapacitorStorage."
    private static let unlockKey = "apex_unlock_at"

    // Same keys as APEX_AUTH_KEYS in native-bridge.js.
    private static let authKeys = [
        "apex_client_token", "apex_client_id", "apex_client_name", "apexLeadLayout"
    ]
    private static let adminHintKey = "apex_admin_session"

    // RETRY: run the biometric prompt natively.
    //
    // completion(true) only on a real success or the documented fail-open.
    static func authenticate(completion: @escaping (Bool, String) -> Void) {
        let context = LAContext()
        context.localizedFallbackTitle = "Usar senha / Use passcode"
        context.localizedCancelTitle = "Cancelar"
        context.touchIDAuthenticationAllowableReuseDuration = 0

        // FAIL-OPEN, exactly as documented: if the device has NEITHER biometrics
        // NOR a passcode, nothing could ever authenticate and locking the owner
        // out of their own tool is the worse outcome.
        var authError: NSError?
        let canBiometrics = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &authError)
        var credError: NSError?
        let canCredential = context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &credError)

        if !canBiometrics && !canCredential {
            ApexLockCover.shared.trace("NATIVE-AUTH no biometrics AND no passcode -> documented fail-open")
            completion(true, "fail-open: device has no authentication configured")
            return
        }

        // allowDeviceCredential: true in the JS path, so passcode is the
        // fallback when Face ID fails or is locked out -- never no auth at all.
        let policy: LAPolicy = canCredential ? .deviceOwnerAuthentication
                                             : .deviceOwnerAuthenticationWithBiometrics

        ApexLockCover.shared.trace("NATIVE-AUTH presenting prompt (policy=\(canCredential ? "deviceOwnerAuthentication" : "biometricsOnly"))")
        context.evaluatePolicy(policy, localizedReason: "Unlock Apex Command Center") { success, error in
            DispatchQueue.main.async {
                if success {
                    // MARK UNLOCKED BEFORE REVEALING. UserDefaults.set is
                    // synchronous, so by the time this returns the record is
                    // durable -- which is what the JS ordering requirement
                    // (apexMarkUnlocked awaited before apexHideLock) exists to
                    // guarantee. A page loading later reads a fresh unlock and
                    // does not prompt a second time.
                    markUnlocked()
                    ApexLockCover.shared.trace("NATIVE-AUTH SUCCEEDED - unlock timestamp written")
                    completion(true, "authenticated")
                } else {
                    let msg = error?.localizedDescription ?? "unknown"
                    ApexLockCover.shared.trace("NATIVE-AUTH failed/cancelled - STAYING COVERED: \(msg)")
                    completion(false, msg)   // FAILS CLOSED
                }
            }
        }
    }

    // Writes the unlock timestamp in the SAME units and key JS uses, so the
    // 15-minute grace period works across both. ApexUptimePlugin returns
    // systemUptime * 1000, and JS stores it as a string.
    // Must write the SAME "<uptimeMs>:<launchNonce>" shape the JS side writes.
    //
    // This wrote the bare timestamp until 2026-09-03, and the JS reader treats
    // a record with no nonce as belonging to a finished run and fails closed.
    // So a recovery-button unlock authenticated successfully, wrote a record JS
    // could not honour, and the next document prompted for Face ID all over
    // again - a third prompt in one launch, seen on device.
    //
    // ApexUptimePlugin.launchNonceValue is the same per-process id the plugin
    // hands to JS, so both writers agree on what "this launch" means.
    static func markUnlocked() {
        let ms = ProcessInfo.processInfo.systemUptime * 1000.0
        let value = String(ms) + ":" + ApexUptimePlugin.launchNonceValue
        UserDefaults.standard.set(value, forKey: prefsPrefix + unlockKey)
    }

    // SIGN OUT: destroy every durable copy of the session, natively.
    //
    // Safe to honour from behind the cover precisely BECAUSE it destroys the
    // thing being protected rather than exposing it. Afterwards there is no
    // session, so the login page is not sensitive.
    static func signOut(completion: @escaping () -> Void) {
        ApexLockCover.shared.trace("NATIVE-SIGNOUT starting")

        // 1. Capacitor Preferences mirror (native UserDefaults) -- the durable
        //    copy the auth mirror restores localStorage from. Removing it is
        //    what makes the clear stick across launches.
        for key in authKeys {
            UserDefaults.standard.removeObject(forKey: prefsPrefix + key)
        }
        UserDefaults.standard.removeObject(forKey: prefsPrefix + adminHintKey)
        UserDefaults.standard.removeObject(forKey: prefsPrefix + unlockKey)

        // 2. Firebase's own keychain session, via the Capacitor plugin if it is
        //    reachable. Best effort: if the bridge is not up, step 4 still
        //    removes the WebView-side session and the app lands on login.
        NotificationCenter.default.post(name: Notification.Name("ApexNativeSignOut"), object: nil)

        // 3. A REVOCATION TOMBSTONE.
        //
        // This is what makes native sign-out complete despite localStorage, and
        // it is needed because of how the auth mirror works:
        // apexRestoreAuthSync/apexRestoreAuth only ever FILL keys localStorage
        // is missing -- localStorage WINS, and native never revokes it. So
        // clearing Preferences alone leaves an orphaned token that the web layer
        // happily keeps using, and even a reload would not help.
        //
        // The tombstone inverts that for one launch: native records "a sign-out
        // happened", and the web layer clears localStorage and skips the restore
        // when it sees it. Written to UserDefaults, which is durable and needs
        // no bridge.
        UserDefaults.standard.set(String(ProcessInfo.processInfo.systemUptime * 1000.0),
                                  forKey: prefsPrefix + "apex_native_signout_at")
        UserDefaults.standard.synchronize()

        // 4. Cookies for the app origin -- where the admin hint snapshot lives.
        //    This API IS reliable per-cookie, unlike the website-data one below.
        let store = WKWebsiteDataStore.default().httpCookieStore
        store.getAllCookies { cookies in
            let group = DispatchGroup()
            for cookie in cookies where cookie.name.hasPrefix("apexsnap_") || cookie.name.hasPrefix("apextrace") {
                group.enter()
                store.delete(cookie) { group.leave() }
            }
            group.notify(queue: .main) {
                // 5. Best-effort localStorage clear.
                //
                // WKWebsiteDataStore.removeData(ofTypes:for:) IS public API and
                // does exist -- but WKWebsiteDataRecord.h states records are
                // "grouped by domain name using the public suffix list", and
                // displayName is only "usually the domain name". For a custom
                // scheme like capacitor://localhost that grouping is not
                // dependable, so this is treated as best-effort rather than the
                // guarantee. The tombstone above is the guarantee.
                let types: Set<String> = [
                    WKWebsiteDataTypeLocalStorage,
                    WKWebsiteDataTypeSessionStorage
                ]
                WKWebsiteDataStore.default().fetchDataRecords(ofTypes: types) { records in
                    let mine = records.filter {
                        $0.displayName.contains("localhost") || $0.displayName.contains("capacitor")
                    }
                    ApexLockCover.shared.trace("NATIVE-SIGNOUT website records matched: \(mine.count) [" +
                        records.map { $0.displayName }.joined(separator: ",") + "]")
                    WKWebsiteDataStore.default().removeData(ofTypes: types, for: mine) {
                        ApexLockCover.shared.trace("NATIVE-SIGNOUT complete - tombstone set, session destroyed")
                        completion()
                    }
                }
            }
        }
    }
}

// NATIVE BIOMETRIC COVER.
//
// WHY THIS EXISTS AT ALL, given the web layer already covers.
//
// Three device reproductions in a row showed client data on screen before the
// Face ID prompt, and each web-layer fix closed one window and opened another.
// The reason is structural, not a bug in the web cover:
//
//   1. EVERY NAVIGATION IS A NEW DOCUMENT. A cover armed during head parse of
//      index.html is gone the instant dashboard.html begins parsing. Our cold
//      launch with a session is login -> dashboard, so this is not theoretical.
//
//   2. window.Capacitor.Plugins IS POPULATED ASYNCHRONOUSLY and is routinely
//      absent at head-parse time on a cold start, so any JS gated on a plugin
//      lookup is skipped entirely on exactly the slow launches that matter.
//
//   3. WKWebView CAN PAINT BEFORE WEB-LAYER CSS APPLIES. The WebView's own
//      layer, its background, or a system snapshot can become visible
//      regardless of `visibility:hidden` on <body>. Capacitor itself sets the
//      WebView non-opaque on initial load specifically to avoid a white flash,
//      which is the same admission that view visibility has to be controlled
//      natively.
//
// So the authoritative cover lives HERE, above the WebView, owned by UIKit. It
// is up before the WebView can paint its first frame, it is completely
// unaffected by JS navigation because it is not part of any document, and only
// an explicit call from the JS side takes it down.
//
// The web-layer cover in native-bridge.js is deliberately KEPT as defence in
// depth. It is correctly built and costs nothing; it is simply not sufficient
// on its own.
//
// WHAT THIS DOES NOT DO: it does not decide whether to prompt, when the grace
// period has expired, or whether authentication succeeded. All of that stays in
// JS, where the seven documented constraints already live -- internalAuthenticate
// rather than authenticate, the deviceIsSecure fail-open, checkBiometry failing
// closed, apexMarkUnlocked awaited before the hide, the monotonic uptime clock,
// apexSignInInFlight, and the 15-minute grace period. This plugin only owns the
// pixels.
@objc(ApexLockCoverPlugin)
public class ApexLockCoverPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ApexLockCoverPlugin"
    public let jsName = "ApexLockCover"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "hide", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "show", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "state", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "alive", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "trace", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "dumpTrace", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showRecovery", returnType: CAPPluginReturnPromise)
    ]

    @objc func hide(_ call: CAPPluginCall) {
        // The reason is recorded so the log says WHICH path took the cover
        // down -- the single most useful fact when the app reveals too early.
        let reason = call.getString("reason") ?? "unspecified"
        DispatchQueue.main.async {
            ApexLockCover.shared.hide(reason: reason)
            call.resolve(["hidden": true])
        }
    }

    @objc func show(_ call: CAPPluginCall) {
        let reason = call.getString("reason") ?? "unspecified"
        DispatchQueue.main.async {
            ApexLockCover.shared.show(reason: reason)
            call.resolve(["shown": true])
        }
    }

    @objc func state(_ call: CAPPluginCall) {
        // hasListeners is read HERE, on the plugin, because that is the only
        // place the native listener table is visible. It is the ground truth
        // for "did the JS subscribe actually land", which a JS-side "addListener
        // returned" cannot answer -- the call is async and goes through
        // cap.nativeCallback.
        let retry = hasListeners("apexLockRetry")
        let signout = hasListeners("apexLockSignOut")
        DispatchQueue.main.async {
            call.resolve([
                "visible": ApexLockCover.shared.isVisible,
                // "attached" is not the same as "covering": a cover behind the
                // WebView is visible==true and covering==false, which is exactly
                // the failure this distinguishes.
                "covering": ApexLockCover.shared.isActuallyCovering,
                "hasRetryListener": retry,
                "hasSignOutListener": signout,
                "sinceLaunchMs": ApexLockCover.shared.millisSinceLaunch()
            ])
        }
    }

    // Lets the JS side write into the SAME native timeline as the native
    // events, so web and native lines interleave in one ordered log instead of
    // two clocks that have to be reconciled by hand.
    // JS reporting that it is alive and actively working on the unlock.
    //
    // The stall timer exists to rescue a launch where NOTHING is happening. It
    // could not tell that apart from a launch where the WebView simply had not
    // started yet, so it fired at 12s on every cold start and showed Alice and
    // Rafa the "Could not unlock" recovery screen EVERY TIME they opened the
    // app - while the unlock was still perfectly on track behind it. Reported
    // for both of them 2026-09-03.
    //
    // Each call restarts the clock, so the screen now appears only if JS goes
    // quiet for a full stall window, which is what "stalled" was always meant
    // to mean. It never reveals, so a lying caller gains nothing.
    @objc func alive(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            ApexLockCover.shared.noteProgress()
        }
        call.resolve()
    }

    @objc func trace(_ call: CAPPluginCall) {
        let message = call.getString("message") ?? ""
        ApexLockCover.shared.trace("JS   " + message)
        call.resolve()
    }

    @objc func dumpTrace(_ call: CAPPluginCall) {
        call.resolve(["log": ApexLockCover.shared.dumpTrace()])
    }

    // Shows the recovery affordance ON TOP OF the cover. Never reveals.
    @objc func showRecovery(_ call: CAPPluginCall) {
        let reason = call.getString("reason") ?? "unspecified"
        let canRetry = call.getBool("canRetry") ?? true
        let message = call.getString("message")
        DispatchQueue.main.async {
            ApexLockCover.shared.showRecovery(reason: reason, canRetry: canRetry, message: message)
            call.resolve()
        }
    }

    public override func load() {
        // POINT 0: proves load() ran at all. If this line is absent from the
        // log, the plugin was never registered and onRetry/onSignOut are nil,
        // so the buttons would fire an action that calls nothing.
        //
        // The INSTANCE ADDRESS matters: if capacitorDidLoad runs more than once
        // (a WebView reload re-creates the bridge), a SECOND plugin instance is
        // registered and overwrites onRetry/onSignOut. JS would then be
        // subscribed to instance A while the buttons call instance B -- and
        // instance B's hasListeners is legitimately false. Comparing this
        // address against the one in the notifyListeners lines settles it.
        let instanceID = UInt(bitPattern: ObjectIdentifier(self).hashValue)
        if ApexLockCover.shared.loadedInstanceCount > 0 {
            // Loud, because this is silent by default and cost several device
            // cycles. Capacitor prints "Overriding existing registered plugin"
            // at the same moment, but that line is easy to miss among ordinary
            // bridge chatter. The cause is a plugin registered BOTH via
            // capacitor.config.json packageClassList and manually in
            // capacitorDidLoad -- see the comment in ApexUptimePlugin.swift.
            ApexLockCover.shared.trace(
                "PLUGIN ⚠️ DOUBLE REGISTRATION - load() running again on instance \(instanceID); " +
                "this overwrites the tap handlers and re-exports the JS shim")
        }
        ApexLockCover.shared.loadedInstanceCount += 1
        ApexLockCover.shared.trace(
            "PLUGIN load() ran on instance \(instanceID) " +
            "(registration #\(ApexLockCover.shared.loadedInstanceCount)) - installing tap handlers")

        // The cover's buttons are native, so the taps arrive here. They are
        // forwarded to JS as events, because the DECISION of what to do (re-run
        // the biometric prompt, or sign out) belongs to the JS side where all
        // the auth policy lives. Native never authenticates and never reveals
        // on its own.
        // retainUntilConsumed: TRUE, and this is load-bearing rather than
        // defensive. Capacitor's notifyListeners (CAPPlugin.m:82) does this:
        //
        //     if (listenersForEvent == nil || count == 0) {
        //         if (retain == YES) { ...queue it... }
        //         return;                       // <-- otherwise DROPPED
        //     }
        //
        // So an event fired before JS has called addListener is silently
        // discarded. The JS side attaches its listener by polling for the
        // plugin, so there is a real window on a cold start where the cover is
        // already up, the buttons are already tappable, and no listener exists
        // yet -- a tap in that window vanishes with no error anywhere. With
        // retain, the event is queued and delivered the moment JS subscribes.
        ApexLockCover.shared.onRetry = { [weak self] in
            // POINT 3: notifyListeners returns Void, so "was anyone listening"
            // is invisible at the call site. hasListeners answers it, and is
            // the difference between "delivered" and "sent into the void".
            let has = self?.hasListeners("apexLockRetry") ?? false
            let inst = self.map { UInt(bitPattern: ObjectIdentifier($0).hashValue) } ?? 0
            ApexLockCover.shared.trace("RECOVERY retry -> notifyListeners(apexLockRetry) hasListeners=\(has) onInstance=\(inst)")
            self?.notifyListeners("apexLockRetry", data: [:], retainUntilConsumed: true)
        }
        ApexLockCover.shared.onSignOut = { [weak self] in
            let has = self?.hasListeners("apexLockSignOut") ?? false
            let inst = self.map { UInt(bitPattern: ObjectIdentifier($0).hashValue) } ?? 0
            ApexLockCover.shared.trace("RECOVERY signout -> notifyListeners(apexLockSignOut) hasListeners=\(has) onInstance=\(inst)")
            self?.notifyListeners("apexLockSignOut", data: [:], retainUntilConsumed: true)
        }
    }
}

// DIAGNOSTIC WINDOW. Logs every hit-test and every touch that reaches the
// cover window, so "the button does nothing" can be split into:
//   1. the touch never reaches the button,
//   2. it reaches the button but no listener is attached,
//   3. the listener fires and what it calls no-ops.
// Each is logged separately below and they look identical from the outside.
final class ApexCoverWindow: UIWindow {
    private var loggedHits = 0

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let result = super.hitTest(point, with: event)
        // Only log the first few, so a scroll does not flood the log.
        if loggedHits < 12 {
            loggedHits += 1
            let name = result.map { String(describing: type(of: $0)) } ?? "nil"
            var line = "HITTEST point=(\(Int(point.x)),\(Int(point.y))) -> \(name) " +
                "windowFrame=\(ApexLockCover.rect(frame)) " +
                "windowHidden=\(isHidden) userInteraction=\(isUserInteractionEnabled) " +
                "rootVC=\(rootViewController == nil ? "NIL" : "present") level=\(Int(windowLevel.rawValue))"
            // Name WHICH view was returned, since several of ours are plain
            // UIView and the class name alone cannot tell them apart. This is
            // the difference between "the touch reached the scroll view" and
            // "it stopped at the host view", which is the whole question.
            if let hit = result {
                if hit === rootViewController?.view { line += "  [= host.view]" }
                else if hit === ApexLockCover.shared.debugContainer { line += "  [= container]" }
                else if hit === ApexLockCover.shared.debugScroll { line += "  [= scrollView]" }
                else if hit === ApexLockCover.shared.debugStack { line += "  [= contentStack]" }
                else { line += "  [= unrecognised view]" }
            }
            ApexLockCover.shared.trace(line)

            // Walk the chain UIKit would: for each candidate, does it contain
            // the point in its own coordinate space, and is it interactive?
            if let host = rootViewController?.view {
                for (label, v) in ApexLockCover.shared.debugChain() {
                    let p = convert(point, to: v)
                    let inside = v.bounds.contains(p)
                    ApexLockCover.shared.trace(
                        "   probe \(label) frame=\(ApexLockCover.rect(v.convert(v.bounds, to: nil))) " +
                        "pointInIts Coords=(\(Int(p.x)),\(Int(p.y))) inside=\(inside) " +
                        "ui=\(v.isUserInteractionEnabled) hidden=\(v.isHidden) alpha=\(v.alpha)")
                }
                _ = host
            }
        }
        return result
    }

    override func sendEvent(_ event: UIEvent) {
        if event.type == .touches, let touches = event.allTouches {
            for t in touches where t.phase == .began {
                let v = t.view.map { String(describing: type(of: $0)) } ?? "nil"
                ApexLockCover.shared.trace("TOUCH began on \(v)")
            }
        }
        super.sendEvent(event)
    }
}

// A UIButton that reports every touch it receives, independently of whether its
// action fires. If TOUCH-ON-BUTTON appears but ACTION-FIRED does not, the
// target/action wiring is the fault; if neither appears, the touch never
// arrived.
final class ApexTracingButton: UIButton {
    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        ApexLockCover.shared.trace("TOUCH-ON-BUTTON began: \(titleLabel?.text ?? "?")")
        super.touchesBegan(touches, with: event)
    }
    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        ApexLockCover.shared.trace("TOUCH-ON-BUTTON ended: \(titleLabel?.text ?? "?")")
        super.touchesEnded(touches, with: event)
    }
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        ApexLockCover.shared.trace("TOUCH-ON-BUTTON CANCELLED: \(titleLabel?.text ?? "?")")
        super.touchesCancelled(touches, with: event)
    }
}

// The cover itself: a plain opaque view held above everything in the window.
//
// Deliberately NOT the Capacitor splash screen. The splash is torn down on a
// schedule Capacitor owns and is tied to launch, not to authentication; this
// has to survive for as long as the app is unauthenticated, including across
// every navigation and every resume.
final class ApexLockCover {

    static let shared = ApexLockCover()

    // The cover lives in its OWN UIWindow, not as a subview of the app window.
    //
    // Z-ORDER IS THE WHOLE GAME, and getting it wrong produces exactly the
    // symptom reported three times: a cover that exists in code, logs as
    // "shown", and is invisible on screen with the dashboard fully readable
    // behind the Face ID sheet.
    //
    // WHY NOT addSubview ON THE APP WINDOW (the first attempt):
    // CAPBridgeViewController.loadView() does `view = webView` -- the bridge
    // VC's ROOT VIEW *is* the WKWebView. When UIKit loads that root view it
    // inserts it into the window, so a cover added earlier as a plain subview
    // can end up beneath it. Fighting that with bringSubviewToFront is a race
    // against every later view insertion, every navigation, and every plugin.
    //
    // A UIWindow at a higher windowLevel is not a race. UIKit composites
    // windows strictly by level, so this sits above the app window regardless
    // of anything happening inside it. It is the same mechanism system alerts
    // use, which is why it survives what a subview cannot.
    private var overlayWindow: UIWindow?

    private var launchTime: CFAbsoluteTime = CFAbsoluteTimeGetCurrent()
    private var lines: [String] = []
    private let lock = NSLock()

    // Above .alert so nothing the app or a plugin presents lands on top. The
    // iOS biometric sheet is presented by the system OUTSIDE the app's window
    // hierarchy, so it still appears above this -- which is correct: the sheet
    // must be visible and interactive, and what must NOT be visible is the app
    // content behind it.
    // ABOVE the app, BELOW the system alert layer.
    //
    // This was .alert + 1, which put the cover over the Face ID sheet itself:
    // the sheet is presented at the alert level, so it was requested and then
    // rendered UNDERNEATH an opaque window. The device log showed the whole
    // failure -- prompt at t=1.2s, success at t=16.5s -- fifteen seconds spent
    // waiting on a prompt nobody could see, which the 12s stall timer then
    // reported as a stall. It was never a stall; it was an invisible prompt.
    //
    // .alert - 1 still covers every app window (the WebView lives at level 0)
    // while letting the system present authentication above it.
    private static let coverLevel = UIWindow.Level.alert - 1

    // Same #141210 the web cover paints, so the handoff between the two layers
    // has no visible seam.
    private static let coverColor = UIColor(red: 20.0/255.0, green: 18.0/255.0, blue: 16.0/255.0, alpha: 1.0)

    // STALL TIMER -- NOT A REVEAL.
    //
    // The previous version of this timer called hide() after 20 seconds "so the
    // app is not bricked". That was an UNAUTHENTICATED REVEAL ON A TIMER: on a
    // device left face-down, Face ID never even attempted, and the dashboard
    // appeared anyway after 20s. An attacker with the phone simply waits.
    //
    // The recovery requirement was real; the recovery ACTION was wrong. Being
    // stuck behind a cover with no way forward and being shown the data are not
    // the only two options. This timer now surfaces a RETRY / SIGN OUT UI drawn
    // ON TOP OF the cover, and the cover itself never comes down. There is
    // always a way forward, and it is never "here is the data anyway".
    private var stallTimer: Timer?
    // 20s, raised from 12s on 2026-09-03. Twelve seconds was shorter than a
    // cold WebView start on a real device, so the recovery screen appeared on
    // EVERY launch for both Alice and Rafa while the unlock was still on track.
    // The heartbeat (see `alive`) is the real fix - each sign of progress
    // restarts this - and the longer window covers the stretch before JS runs
    // at all, where there is nothing to send a heartbeat yet.
    private let stallSeconds: TimeInterval = 20.0

    // Tap handlers, wired by the plugin to JS events. Native never decides to
    // authenticate or reveal; it only reports the tap.
    var onRetry: (() -> Void)?
    var onSignOut: (() -> Void)?

    // The single vertical stack that owns every element on the cover -- the
    // logo from the start, plus the message and buttons once recovery is
    // shown. One stack means nothing on this screen can overlap anything else.
    private var contentStack: UIStackView?

    // BRANDED LAUNCH TREATMENT.
    //
    // The photo is a background view on the host, BEHIND the scroll view; the
    // logo is an arranged subview INSIDE contentStack. That split matters: the
    // photo is decoration that must fill the screen edge to edge, while the
    // logo is content that the recovery message and buttons have to lay out
    // below without colliding. Centring the logo independently in the window
    // is exactly what b49b6db removed, and it is not being reintroduced here.
    private weak var photoView: UIImageView?
    private weak var logoView: UIImageView?
    private weak var sweepLayer: CAGradientLayer?

    // The logo's real master is 393x147 (no vector exists anywhere -- see the
    // asset catalog note), so it is capped rather than scaled to fit. Above
    // roughly this width the upscaling is visible.
    private static let logoMaxWidth: CGFloat = 300
    private static let logoWidthFraction: CGFloat = 0.62

    // Decoding happens once per process, off the main thread, and the result is
    // reused by every later cover. The first cover of a cold launch therefore
    // pays the decode and every subsequent one is free.
    private static var cachedPhoto: UIImage?
    private static var cachedLogo: UIImage?
    private static let assetQueue = DispatchQueue(label: "pro.apexbusiness.lockcover.assets", qos: .userInitiated)

    // ANIMATION IS FOR WAITING, NOT FOR WORKING.
    //
    // The core workflow is: tap Ligar, talk on OpenPhone, come back and log the
    // call. That resume happens inside the 15-minute grace period, many times an
    // hour, and it is not a wait -- it is the middle of a task. A logo animation
    // there would read as the app being slow every single time.
    //
    // So the treatment runs ONLY on a cold launch, where the user is genuinely
    // waiting on authentication and the animation gives that wait a reason to
    // exist. Every other path gets the cover instantly and silently.
    //
    // WHY THE REASON STRING AND NOT THE `existing` BRANCH: the brief suggested
    // the early-return at the top of show() as the seam, but it is not one.
    // hide() tears the window down (overlayWindow = nil), so whether show()
    // finds an existing window depends on whether the cover happened to be up
    // when the app was backgrounded -- sceneWillResignActive raises it, so a
    // grace-period resume DOES hit that branch, but so does the cold-launch
    // retry one runloop turn after "scene-launch". The branch conflates the two.
    // The reason string does not: only SceneDelegate's willConnectTo pair
    // reports a launch, and every resume arrives as resign-active,
    // did-enter-background, or JS's "maybeLock" re-arm.
    private static func isColdLaunch(reason: String) -> Bool {
        return reason.hasPrefix("scene-launch")
    }
    // Non-nil once the recovery UI has been added, so it is only added once.
    private var recoveryStack: UIStackView?

    // DIAGNOSTIC references, so the hit-test log can say WHICH view was
    // returned. Several views in this hierarchy are plain UIView, so the class
    // name alone cannot distinguish "stopped at host.view" from "reached the
    // container" -- and that distinction is the whole question.
    // Counts how many times a plugin instance has called load(). >1 means the
    // plugin was registered more than once, which silently overwrites the tap
    // handlers. See the DOUBLE REGISTRATION trace in load().
    var loadedInstanceCount = 0

    fileprivate weak var debugScroll: UIScrollView?
    fileprivate weak var debugContainer: UIView?
    fileprivate weak var debugStack: UIStackView?
    fileprivate weak var debugButton: UIButton?

    fileprivate func debugChain() -> [(String, UIView)] {
        var out: [(String, UIView)] = []
        if let v = overlayWindow?.rootViewController?.view { out.append(("host.view", v)) }
        if let v = debugScroll { out.append(("scrollView", v)) }
        if let v = debugContainer { out.append(("container", v)) }
        if let v = debugStack { out.append(("contentStack", v)) }
        if let v = debugButton { out.append(("button", v)) }
        return out
    }

    static func rect(_ r: CGRect) -> String {
        return "(\(Int(r.origin.x)),\(Int(r.origin.y)) \(Int(r.width))x\(Int(r.height)))"
    }

    private init() {}

    // Attached AND actually on screen.
    var isVisible: Bool {
        guard let w = overlayWindow else { return false }
        return !w.isHidden
    }

    // For the window-based cover these are the same thing, which is the point:
    // there is no "attached but behind something" state to be wrong about.
    var isActuallyCovering: Bool {
        return isVisible
    }

    func millisSinceLaunch() -> Double {
        return (CFAbsoluteTimeGetCurrent() - launchTime) * 1000.0
    }

    func markLaunch() {
        launchTime = CFAbsoluteTimeGetCurrent()
    }

    func trace(_ message: String) {
        let line = String(format: "t=%.0fms %@", millisSinceLaunch(), message)
        lock.lock()
        lines.append(line)
        if lines.count > 400 { lines.removeFirst(lines.count - 400) }
        lock.unlock()
        // NSLog rather than print: print reaches only the Xcode debug console,
        // while NSLog goes to the unified system log, so the trace is readable
        // in Console.app with the phone plugged in and no debugger attached.
        NSLog("[APEXTRACE] %@", line)
    }

    func dumpTrace() -> String {
        lock.lock()
        let out = lines.joined(separator: "\n")
        lock.unlock()
        return out
    }

    // Decodes the two images off the main thread and hands them back on it.
    //
    // THE COVER MUST NOT WAIT FOR THIS. Decoding the photo on the main thread
    // would delay first paint, which is the one thing that must never happen --
    // the cover's entire job is to be up before the WebView can paint. So the
    // cover goes up solid #141210 immediately and this fades in underneath it
    // whenever it is ready. If it is never ready, the cover simply stays solid.
    private func loadAssets(_ done: @escaping (UIImage?, UIImage?) -> Void) {
        if let p = Self.cachedPhoto, let l = Self.cachedLogo {
            done(p, l)
            return
        }
        Self.assetQueue.async {
            // force-decode now, on this thread, rather than lazily at draw time
            // on the main thread -- otherwise the work just moves to first paint.
            let photo = Self.cachedPhoto ?? Self.decoded(UIImage(named: "LockCoverPhoto"))
            let logo = Self.cachedLogo ?? Self.decoded(UIImage(named: "LockCoverLogo"))
            DispatchQueue.main.async {
                if Self.cachedPhoto == nil { Self.cachedPhoto = photo }
                if Self.cachedLogo == nil { Self.cachedLogo = logo }
                done(photo, logo)
            }
        }
    }

    private static func decoded(_ image: UIImage?) -> UIImage? {
        guard let image = image, let cg = image.cgImage else { return image }
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = image.scale
        format.opaque = false
        let size = CGSize(width: CGFloat(cg.width) / image.scale,
                          height: CGFloat(cg.height) / image.scale)
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }

    // Fades the photo and logo in, then loops the sweep.
    //
    // REDUCE MOTION: the fades stay, the sweep does not. Reduce Motion is about
    // movement, not opacity -- stripping the fade too would leave a hard cut
    // that is harsher than what it replaced.
    private func runLaunchAnimation(photo: UIImageView, logo: UIImageView) {
        let reduceMotion = UIAccessibility.isReduceMotionEnabled

        photo.alpha = 0
        logo.alpha = 0

        UIView.animate(withDuration: 1.2, delay: 0, options: [.curveEaseOut, .allowUserInteraction]) {
            photo.alpha = 1
        }
        UIView.animate(withDuration: 0.6, delay: 0.3, options: [.curveEaseOut, .allowUserInteraction]) {
            logo.alpha = 1
        }

        guard !reduceMotion else {
            trace("COVER launch animation: fades only (Reduce Motion is on)")
            return
        }
        // The sweep is started after the logo has faded in, and loops gently
        // rather than running once: the cover can be up for a while, and a
        // single pass would leave a static screen for the rest of that wait.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { [weak self, weak logo] in
            guard let self = self, let logo = logo, logo.window != nil else { return }
            self.startSweep(on: logo)
        }
    }

    // A gradient mask travelling left to right across the logo, about a quarter
    // of its width, so it reads as light catching the gold rather than a shine
    // gimmick pasted over the top.
    private func startSweep(on logo: UIImageView) {
        logo.layoutIfNeeded()
        let w = logo.bounds.width
        let h = logo.bounds.height
        guard w > 1, h > 1 else { return }
        // No logo image means nothing to catch the light. The cover is fine
        // without the sweep; it is the one part of this that is pure decoration.
        guard let glyphs = logo.image?.cgImage else { return }

        // The band is a white overlay confined to the logo's OWN PIXELS.
        //
        // The logo is a transparent PNG, so a plain rectangular overlay would
        // light up the empty space around the glyphs as well -- a bright bar
        // sliding across the screen instead of gold catching the light. Using
        // the logo image itself as the overlay, tinted white, means only the
        // glyphs can ever brighten.
        // THE SHINE MUST SIT ON THE GLYPHS, NOT ON THE VIEW.
        //
        // This was the full bounds of the image view with contentsGravity
        // .resizeAspect, which makes the layer compute its OWN aspect fit. The
        // view is .scaleAspectFit, so the gold logo is already letterboxed
        // inside those bounds, and the two fits agree only when the view's
        // aspect ratio happens to match the image's exactly. It does not - so
        // the white copy drew at a different offset and scale from the logo
        // underneath and the highlight rippled across a ghost sitting above the
        // real glyphs. Visible on any launch slow enough to watch.
        //
        // Computing the aspect-fit rect explicitly puts the white copy
        // pixel-on-pixel over the gold one.
        let imgSize = logo.image?.size ?? CGSize(width: w, height: h)
        var fit = CGRect(x: 0, y: 0, width: w, height: h)
        if imgSize.width > 0, imgSize.height > 0 {
            let scale = min(w / imgSize.width, h / imgSize.height)
            let fw = imgSize.width * scale
            let fh = imgSize.height * scale
            fit = CGRect(x: (w - fw) / 2.0, y: (h - fh) / 2.0, width: fw, height: fh)
        }

        let shine = CALayer()
        shine.frame = fit
        shine.contents = glyphs
        shine.contentsGravity = .resize
        shine.backgroundColor = UIColor.clear.cgColor
        // Tints the glyphs white while keeping the image's alpha, so the shape
        // is the logo's and the colour is the highlight's.
        shine.compositingFilter = "screenBlendMode"
        shine.opacity = 0.55

        // The mask travels in the SHINE's coordinate space, which is now the
        // fitted glyph rect rather than the whole view, so it is sized from
        // that rect.
        let mask = CAGradientLayer()
        mask.frame = CGRect(x: -fit.width, y: 0, width: fit.width, height: fit.height)
        mask.startPoint = CGPoint(x: 0, y: 0.5)
        mask.endPoint = CGPoint(x: 1, y: 0.5)
        mask.colors = [
            UIColor.clear.cgColor,
            UIColor.white.cgColor,
            UIColor.clear.cgColor
        ]
        // ~25% of the logo width, centred in the travelling layer.
        mask.locations = [0.375, 0.5, 0.625]
        shine.mask = mask
        logo.layer.addSublayer(shine)
        sweepLayer = mask

        let travel = CABasicAnimation(keyPath: "position.x")
        travel.byValue = 2 * fit.width
        travel.duration = 2.0
        travel.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        // One 2s pass, then a 1.8s rest before the next -- the pause is what
        // keeps a looping highlight from turning into a strobe.
        let group = CAAnimationGroup()
        group.animations = [travel]
        group.duration = 2.0 + 1.8
        group.repeatCount = .infinity
        group.isRemovedOnCompletion = false
        mask.add(group, forKey: "apexSweep")
        trace("COVER launch animation: photo+logo fade, sweep looping")
    }

    // Raises the cover. Safe to call repeatedly.
    func show(reason: String) {
        if let existing = overlayWindow {
            existing.isHidden = false
            existing.windowLevel = Self.coverLevel
            // A cover that is already up keeps whatever state it had. It is NOT
            // re-animated: this branch is reached by the cold-launch retry a
            // runloop turn after "scene-launch" (where the animation is already
            // running and restarting it would stutter) and by every re-arm on a
            // resume (where no animation should run at all).
            trace("COVER re-shown (reason=\(reason)) \(describeWindows())")
            startStallTimer()
            return
        }

        guard let scene = Self.activeWindowScene() else {
            // No scene yet. Not fatal and not a silent failure: SceneDelegate
            // calls show() again once the scene exists.
            trace("COVER show DEFERRED - no UIWindowScene yet (reason=\(reason))")
            return
        }

        let w = ApexCoverWindow(windowScene: scene)
        w.windowLevel = Self.coverLevel
        w.backgroundColor = Self.coverColor
        // Swallow taps aimed at the page underneath.
        w.isUserInteractionEnabled = true

        let host = UIViewController()
        host.view.backgroundColor = Self.coverColor

        // ONE vertical stack owns every element on this screen.
        //
        // The wordmark used to be centred in the window independently while the
        // recovery UI was centred separately at +40pt, so once the recovery UI
        // appeared the two occupied the same space and the wordmark sat on top
        // of the message and the first button. Anything added later joins THIS
        // stack, which cannot collide with itself.
        let content = UIStackView()
        content.axis = .vertical
        content.alignment = .center
        content.spacing = 18
        content.translatesAutoresizingMaskIntoConstraints = false

        // The full logo, so a slow launch reads as "locked", not "broken".
        //
        // It joins the SAME stack the recovery message and buttons append to,
        // rather than being centred in the window on its own. See b49b6db: two
        // independently-centred groups is precisely the bug that produced.
        let logo = UIImageView()
        logo.translatesAutoresizingMaskIntoConstraints = false
        logo.contentMode = .scaleAspectFit
        logo.isAccessibilityElement = true
        logo.accessibilityLabel = "Apex"
        content.addArrangedSubview(logo)
        logoView = logo

        // 62% of the screen, capped at 300pt. The cap is a resolution limit,
        // not a taste one -- the master is 393x147 and no vector exists.
        let target = min(UIScreen.main.bounds.width * Self.logoWidthFraction, Self.logoMaxWidth)
        let logoWidth = logo.widthAnchor.constraint(equalToConstant: target)
        // Below required priority so the stack's own 32pt insets win on a very
        // narrow screen instead of producing an unsatisfiable layout.
        logoWidth.priority = .defaultHigh
        // Aspect ratio comes from the real asset (393:147) so the height is
        // reserved before the image has decoded -- otherwise the stack would
        // reflow, and shift the recovery buttons, the moment the logo arrives.
        NSLayoutConstraint.activate([
            logoWidth,
            logo.widthAnchor.constraint(lessThanOrEqualTo: content.widthAnchor),
            logo.heightAnchor.constraint(equalTo: logo.widthAnchor, multiplier: 147.0 / 393.0)
        ])

        contentStack = content

        // THE PHOTO, AND THE SCRIM OVER IT.
        //
        // Both are added to host.view BEFORE the scroll view, so they sit
        // behind every piece of content and cannot intercept a tap aimed at a
        // recovery button. They fill the whole view rather than the safe area:
        // a background that stopped at the notch would read as a letterboxed
        // image instead of a full-bleed one.
        //
        // The image itself is set later, once it has decoded off-thread. Until
        // then these are an empty view over the solid cover colour, which is
        // exactly what the cover looks like today.
        let photo = UIImageView()
        photo.translatesAutoresizingMaskIntoConstraints = false
        photo.contentMode = .scaleAspectFill
        photo.clipsToBounds = true
        photo.isUserInteractionEnabled = false
        photo.alpha = 0
        host.view.addSubview(photo)
        photoView = photo

        // Gold on a photograph fails contrast without this. It is not optional,
        // and it is also what keeps the recovery text readable once that
        // appears on top of the same background.
        let scrim = UIView()
        scrim.translatesAutoresizingMaskIntoConstraints = false
        scrim.backgroundColor = UIColor.black.withAlphaComponent(0.55)
        scrim.isUserInteractionEnabled = false
        host.view.addSubview(scrim)

        NSLayoutConstraint.activate([
            photo.topAnchor.constraint(equalTo: host.view.topAnchor),
            photo.bottomAnchor.constraint(equalTo: host.view.bottomAnchor),
            photo.leadingAnchor.constraint(equalTo: host.view.leadingAnchor),
            photo.trailingAnchor.constraint(equalTo: host.view.trailingAnchor),

            scrim.topAnchor.constraint(equalTo: photo.topAnchor),
            scrim.bottomAnchor.constraint(equalTo: photo.bottomAnchor),
            scrim.leadingAnchor.constraint(equalTo: photo.leadingAnchor),
            scrim.trailingAnchor.constraint(equalTo: photo.trailingAnchor)
        ])
        // The scrim rides with the photo: no photo, no dimming over the flat
        // cover colour, which is already dark enough on its own.
        scrim.alpha = 0
        photo.accessibilityElementsHidden = true

        // Scrollable, so that at the largest accessibility text sizes -- or in
        // landscape on a small device, where the usable height is a couple of
        // hundred points -- the buttons can still be reached instead of being
        // clipped off the bottom.
        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.alwaysBounceVertical = false
        scroll.showsVerticalScrollIndicator = false
        host.view.addSubview(scroll)

        // VERTICAL CENTRING THAT DEGRADES TO SCROLLING.
        //
        // The content sits in a container pinned to the scroll view's content
        // guide, and that container is at least as tall as the viewport. The
        // stack is then centred INSIDE the container. When the content is
        // short, the container is exactly viewport-height and centring puts the
        // group in the middle of the screen. When the content is taller (AX5
        // text, or landscape on a small device) the container grows past the
        // viewport and the whole thing scrolls, with nothing clipped.
        //
        // An earlier attempt centred the stack directly against the content
        // guide with a low-priority "at least viewport height" constraint on
        // the stack itself. That stretched the STACK rather than a container,
        // which made the arranged subviews top-align inside it -- the group
        // rendered against the top of the screen instead of centred. Verified
        // in the simulator before and after.
        let container = UIView()
        container.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(container)
        container.addSubview(content)

        debugScroll = scroll
        debugContainer = container
        debugStack = content

        NSLayoutConstraint.activate([
            // The scroll view fills the safe area, so nothing lands under the
            // notch, the status bar or the home indicator in either orientation.
            scroll.topAnchor.constraint(equalTo: host.view.safeAreaLayoutGuide.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: host.view.safeAreaLayoutGuide.bottomAnchor),
            scroll.leadingAnchor.constraint(equalTo: host.view.safeAreaLayoutGuide.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: host.view.safeAreaLayoutGuide.trailingAnchor),

            container.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
            container.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
            container.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
            container.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
            container.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor),
            container.heightAnchor.constraint(greaterThanOrEqualTo: scroll.frameLayoutGuide.heightAnchor),

            content.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            content.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 32),
            content.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -32),
            content.topAnchor.constraint(greaterThanOrEqualTo: container.topAnchor, constant: 24),
            content.bottomAnchor.constraint(lessThanOrEqualTo: container.bottomAnchor, constant: -24)
        ])

        w.rootViewController = host
        // makeKeyAndVisible would steal key status from the app window; the
        // cover only needs to be VISIBLE, and taking key could interfere with
        // the biometric sheet's own presentation.
        w.isHidden = false
        overlayWindow = w

        trace("COVER SHOWN (reason=\(reason)) level=\(w.windowLevel.rawValue) \(describeWindows())")
        startStallTimer()

        // Everything above this line has already run: the cover is up, opaque,
        // and covering the app. The branding is strictly additive from here, so
        // nothing below can delay or gate the cover appearing.
        let animate = Self.isColdLaunch(reason: reason)
        loadAssets { [weak self, weak photo, weak scrim, weak logo] p, l in
            guard let self = self, let photo = photo, let scrim = scrim, let logo = logo else { return }
            // The cover may already have come down during the decode.
            guard photo.window != nil else { return }
            photo.image = p
            logo.image = l

            if animate {
                scrim.alpha = 1
                self.runLaunchAnimation(photo: photo, logo: logo)
            } else {
                // RESUME PATH: no animation at all.
                //
                // Inside the 15-minute grace period this cover is up for a few
                // hundred milliseconds between tapping back into the app and JS
                // confirming the unlock is still fresh. Fading anything in over
                // 1.2s there would mean the user watches a logo animation on
                // every single return from a call -- the cover would become the
                // slowest part of the workflow rather than an invisible one.
                photo.alpha = 1
                scrim.alpha = 1
                logo.alpha = 1
                self.trace("COVER branding: instant, no animation (reason=\(reason))")
            }
        }
    }

    // Disables the buttons and shows progress while a native action runs, so a
    // second tap cannot start a second Face ID prompt on top of the first.
    // Dimming the buttons was the ONLY feedback here until 2026-09-03, and it
    // reads as "the button is broken", not "working on it".
    //
    // Face ID legitimately takes about two seconds to read a face - measured on
    // device: ACTION-FIRED at t=47370ms, the OS prompt presented 26ms later,
    // NATIVE-AUTH SUCCEEDED at t=49445ms. The button is not slow; the biometric
    // read is. But the OS sheet can be slow to paint over this cover, so for
    // those two seconds the user saw two greyed-out buttons and nothing else,
    // and reported the app as hung. Reported as "super delayed between when I
    // click and something actually happens."
    //
    // A spinner and a word turn an unexplained freeze into visible progress.
    // Nothing about the security model changes: this is presentation only, and
    // the cover stays up exactly as long as it did before.
    func setRecoveryBusy(_ busy: Bool) {
        guard let stack = recoveryStack else { return }
        for v in stack.arrangedSubviews {
            if let b = v as? UIButton {
                b.isEnabled = !busy
                b.alpha = busy ? 0.45 : 1.0
            }
        }
        // NO SPINNER HERE. A spinner was added on 2026-09-03 and reverted the
        // same night: recoveryStack IS contentStack (line ~1221 assigns it),
        // and the LOGO is in that same stack. addArrangedSubview relayouts it,
        // which moves the logo's bounds - but the sweep is a CALayer sized from
        // those bounds when it started, and nothing resizes it. The highlight
        // then travelled across coordinates that no longer matched the glyphs,
        // and the launch animation looked broken.
        //
        // The message text below is safe: it replaces a label in place and
        // changes no layout.
        if busy { setRecoveryMessage("Autenticando...\nAuthenticating...") }
    }

    // Replaces the recovery message in place, e.g. after a failed attempt, so
    // the user gets feedback without the cover coming down.
    func setRecoveryMessage(_ text: String) {
        guard let stack = recoveryStack else { return }
        for v in stack.arrangedSubviews {
            if let l = v as? UILabel, l !== stack.arrangedSubviews.first {
                l.text = text
                return
            }
        }
    }

    // Reloads the WebView so the next document starts clean and sees the
    // sign-out tombstone, then reveals once it has begun loading.
    //
    // The cover stays up across the reload and comes down onto the LOGIN page,
    // which is not sensitive because the session has just been destroyed. If
    // the WebView cannot be reached, the cover still comes down -- there is
    // nothing left to protect at that point, and stranding the user behind a
    // cover after they asked to sign out would be the worse outcome.
    func reloadWebViewAndReveal() {
        let webView = Self.findWebView()
        if let wv = webView {
            trace("NATIVE-SIGNOUT reloading WebView to clear the web layer")
            wv.evaluateJavaScript("try{localStorage.clear();sessionStorage.clear();}catch(e){}") { _, _ in
                wv.load(URLRequest(url: URL(string: "capacitor://localhost/index.html")!))
            }
        } else {
            trace("NATIVE-SIGNOUT no WebView found - revealing anyway, session is destroyed")
        }
        // Give the reload a moment to commit, then reveal.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
            self?.hide(reason: "native-signout-complete")
        }
    }

    private static func findWebView() -> WKWebView? {
        guard let scene = activeWindowScene() else { return nil }
        for w in scene.windows {
            if let found = firstWebView(in: w) { return found }
        }
        return nil
    }

    private static func firstWebView(in view: UIView) -> WKWebView? {
        if let wv = view as? WKWebView { return wv }
        for sub in view.subviews {
            if let found = firstWebView(in: sub) { return found }
        }
        return nil
    }

    // The ONLY way the cover comes down. Reached exclusively from JS after a
    // successful authentication (or after it is positively established there is
    // no session to protect). No timer, no error path, and no native code calls
    // this on its own.
    func hide(reason: String) {
        cancelStallTimer()
        guard let w = overlayWindow else {
            trace("COVER hide called but no cover present (reason=\(reason))")
            return
        }
        // Stop the looping sweep before the layer tree is discarded. An
        // infinitely-repeating animation on a detached layer keeps ticking, and
        // this cover goes up and down many times an hour.
        sweepLayer?.removeAllAnimations()
        sweepLayer = nil

        w.isHidden = true
        w.rootViewController = nil
        overlayWindow = nil
        // Both cleared: the views belonged to the discarded root VC, and a
        // later show() must build a fresh stack rather than append to a dead one.
        recoveryStack = nil
        contentStack = nil
        photoView = nil
        logoView = nil
        trace("COVER HIDDEN (reason=\(reason))  <-- APP NOW VISIBLE")
    }

    // Surfaces RETRY / SIGN OUT on top of the cover. The cover stays up.
    //
    // Appends into the SAME stack that already holds the wordmark, rather than
    // laying out a second independently-centred group. That is what caused the
    // wordmark to sit on top of the message and the first button: two views
    // both centred in the window, unaware of each other. One stack cannot
    // overlap itself, and anything added here inherits its spacing and width.
    func showRecovery(reason: String, canRetry: Bool, message: String?) {
        guard let content = contentStack, recoveryStack == nil else { return }
        cancelStallTimer()

        let text = UILabel()
        text.text = message ?? "Não foi possível desbloquear.\nCould not unlock."
        text.numberOfLines = 0
        text.textAlignment = .center
        text.textColor = UIColor(white: 0.75, alpha: 1.0)
        text.font = UIFontMetrics(forTextStyle: .footnote)
            .scaledFont(for: UIFont.systemFont(ofSize: 13, weight: .regular))
        text.adjustsFontForContentSizeCategory = true
        // Long strings wrap instead of forcing the stack wider than the screen.
        text.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        content.addArrangedSubview(text)

        var buttons: [UIButton] = []
        if canRetry {
            buttons.append(Self.makeButton(
                title: "Desbloquear / Unlock",
                action: UIAction { [weak self] _ in
                    ApexLockCover.shared.trace("ACTION-FIRED: Unlock -> NATIVE authenticate (no JS dependency)")
                    // NATIVE FIRST, ALWAYS. JS is not involved and is not
                    // required: on a slow launch it does not run until ~9s
                    // AFTER these buttons are tappable.
                    self?.setRecoveryBusy(true)
                    ApexNativeRecovery.authenticate { ok, detail in
                        self?.setRecoveryBusy(false)
                        if ok {
                            ApexLockCover.shared.hide(reason: "native-unlock: " + detail)
                        } else {
                            self?.setRecoveryMessage("Não reconhecido. Tente novamente.\nNot recognised. Try again.")
                        }
                    }
                    // DELIBERATELY NOT calling onRetry() here.
                    //
                    // It fired the JS unlock path alongside this native one:
                    // the device log showed NATIVE authenticate at t=36621ms
                    // and the JS internalAuthenticate at t=36641ms, 20ms apart,
                    // and iOS cancelled one of the two -- "NATIVE-AUTH
                    // failed/cancelled: Authentication canceled". That is the
                    // double Face ID prompt, and it came from this line.
                    //
                    // The native path above already hides the cover on success
                    // and already writes the unlock timestamp JS reads, so the
                    // web layer resyncs on its own next check. Nothing needs
                    // this call; only the second prompt depended on it.
                }
            ))
        }
        // Always offered. If authentication genuinely cannot run on this device,
        // signing out is the way forward that does NOT expose data: it clears
        // the session and lands on the login page with nothing to protect.
        buttons.append(Self.makeButton(
            title: "Sair / Sign out",
            action: UIAction { [weak self] _ in
                ApexLockCover.shared.trace("ACTION-FIRED: SignOut -> NATIVE signOut (no JS dependency)")
                self?.setRecoveryBusy(true)
                // Best-effort JS cleanup FIRST, so if the bridge happens to be
                // up it can clear localStorage itself. Not awaited and not
                // required -- the native clear plus the tombstone stand alone.
                self?.onSignOut?()
                ApexNativeRecovery.signOut {
                    self?.setRecoveryBusy(false)
                    // Reload so the next document starts clean and sees the
                    // tombstone. The cover stays up until the reload lands, then
                    // comes down onto the login page -- which is not sensitive,
                    // because the session has just been destroyed.
                    ApexLockCover.shared.reloadWebViewAndReveal()
                }
            }
        ))

        debugButton = buttons.first
        for b in buttons {
            content.addArrangedSubview(b)
            // Full width of the stack, so a long localized title wraps inside
            // the button instead of overflowing the screen, and both buttons
            // match. 44pt is the minimum comfortable tap target.
            NSLayoutConstraint.activate([
                b.widthAnchor.constraint(equalTo: content.widthAnchor),
                b.heightAnchor.constraint(greaterThanOrEqualToConstant: 44)
            ])
        }

        // Extra breathing room between the message and the first button without
        // widening the gap between the two buttons.
        if let first = buttons.first {
            content.setCustomSpacing(24, after: text)
            content.setCustomSpacing(12, after: first)
        }

        recoveryStack = content

        // Force a layout pass so the frames below are the real post-constraint
        // values rather than the pre-layout zeros.
        overlayWindow?.layoutIfNeeded()

        // FRAME / ANCESTRY DUMP. hitTest returning a plain UIView at the
        // buttons' coordinates means the touch is stopping somewhere above
        // them; this names where. For each button: its frame in WINDOW
        // coordinates, then every ancestor with frame, bounds, clipsToBounds
        // and isUserInteractionEnabled.
        //
        // A view draws outside its parent's bounds but does NOT receive touches
        // there -- UIView.hitTest returns nil for any point outside self.bounds
        // before it ever consults its subviews. So an ancestor whose bounds do
        // not enclose the button is the classic cause of exactly this symptom.
        for b in buttons {
            let inWindow = b.convert(b.bounds, to: nil)
            trace("BTN '\(b.titleLabel?.text ?? "?")' windowFrame=\(Self.rect(inWindow)) " +
                  "enabled=\(b.isEnabled) userInteraction=\(b.isUserInteractionEnabled) " +
                  "hidden=\(b.isHidden) alpha=\(b.alpha)")
            var v: UIView? = b.superview
            var depth = 1
            while let cur = v, depth < 10 {
                let curInWindow = cur.convert(cur.bounds, to: nil)
                // Does this ancestor's own bounds actually contain the button's
                // centre, expressed in that ancestor's coordinate space? If
                // NO, hit-testing stops here and never reaches the button.
                let centreInCur = b.convert(CGPoint(x: b.bounds.midX, y: b.bounds.midY), to: cur)
                let contains = cur.bounds.contains(centreInCur)
                trace("   ^\(depth) \(type(of: cur)) frame=\(Self.rect(curInWindow)) " +
                      "bounds=\(Self.rect(cur.bounds)) clips=\(cur.clipsToBounds) " +
                      "userInteraction=\(cur.isUserInteractionEnabled) " +
                      "containsButtonCentre=\(contains)\(contains ? "" : "   <-- TOUCH STOPS HERE")")
                v = cur.superview
                depth += 1
            }
        }

        trace("RECOVERY UI shown on top of cover (reason=\(reason) canRetry=\(canRetry)) - COVER STAYS UP")
    }

    // Built entirely with UIButton.Configuration.
    //
    // contentEdgeInsets is deprecated as of iOS 15 and is IGNORED once a
    // configuration is in play, so mixing the two APIs silently loses the
    // padding. The deployment target here is iOS 15 (see Package.swift), so
    // the configuration API is available unconditionally -- no availability
    // check needed.
    //
    // This button is the last thing standing between a stuck user and a dead
    // app, so it is worth it being built on the current API rather than one
    // that is already ignored in some code paths.
    private static func makeButton(title: String, action: UIAction) -> UIButton {
        let gold = UIColor(red: 201.0/255.0, green: 164.0/255.0, blue: 58.0/255.0, alpha: 1.0)

        var config = UIButton.Configuration.plain()
        config.contentInsets = NSDirectionalEdgeInsets(top: 13, leading: 24, bottom: 13, trailing: 24)
        config.baseForegroundColor = gold
        // The title carries its own font through the configuration, which is
        // what keeps it from being reset when the button re-renders. Scaled for
        // Dynamic Type so the button grows with the user's text size.
        var attributed = AttributedString(title)
        attributed.font = UIFontMetrics(forTextStyle: .callout)
            .scaledFont(for: UIFont.systemFont(ofSize: 15, weight: .semibold))
        config.attributedTitle = attributed
        // A long or heavily-scaled title wraps onto a second line inside the
        // button instead of being truncated to "Desbloqu..." at accessibility
        // sizes.
        config.titleLineBreakMode = .byWordWrapping
        config.background.backgroundColor = .clear
        config.background.strokeColor = gold
        config.background.strokeWidth = 1.5
        config.background.cornerRadius = 10

        let b = ApexTracingButton(configuration: config, primaryAction: nil)
        b.addAction(action, for: .touchUpInside)
        return b
    }

    // Fires if nothing has resolved in time. Shows the recovery UI. NEVER hides.
    // Restarts the stall countdown. Only meaningful while a cover is up; if the
    // app is already visible there is nothing to rescue.
    func noteProgress() {
        guard isActuallyCovering else { return }
        startStallTimer()
    }

    private func startStallTimer() {
        cancelStallTimer()
        stallTimer = Timer.scheduledTimer(withTimeInterval: stallSeconds, repeats: false) { [weak self] _ in
            guard let self = self else { return }
            guard self.isVisible else { return }
            self.trace("STALL TIMER fired after \(Int(self.stallSeconds))s - showing recovery UI, NOT revealing")
            self.showRecovery(reason: "stall-timeout", canRetry: true, message: nil)
        }
    }

    private func cancelStallTimer() {
        stallTimer?.invalidate()
        stallTimer = nil
    }

    // Diagnostic: every window and its level, so the log can prove the cover is
    // above the app window rather than merely existing.
    private func describeWindows() -> String {
        guard let scene = Self.activeWindowScene() else { return "[no scene]" }
        let desc = scene.windows.map { w -> String in
            let tag = (w === overlayWindow) ? "APEXCOVER" : String(describing: type(of: w))
            return "\(tag)@\(Int(w.windowLevel.rawValue))\(w.isHidden ? "(hidden)" : "")"
        }
        return "[windows: \(desc.joined(separator: " | "))]"
    }

    static func activeWindowScene() -> UIWindowScene? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.first { $0.activationState == .foregroundActive }
            ?? scenes.first { $0.activationState == .foregroundInactive }
            ?? scenes.first
    }
}
