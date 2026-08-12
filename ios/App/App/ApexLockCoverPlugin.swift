import Foundation
import UIKit
import Capacitor

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
        CAPPluginMethod(name: "trace", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "dumpTrace", returnType: CAPPluginReturnPromise)
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
        DispatchQueue.main.async {
            call.resolve([
                "visible": ApexLockCover.shared.isVisible,
                // "attached" is not the same as "covering": a cover behind the
                // WebView is visible==true and covering==false, which is exactly
                // the failure this distinguishes.
                "covering": ApexLockCover.shared.isActuallyCovering,
                "sinceLaunchMs": ApexLockCover.shared.millisSinceLaunch()
            ])
        }
    }

    // Lets the JS side write into the SAME native timeline as the native
    // events, so web and native lines interleave in one ordered log instead of
    // two clocks that have to be reconciled by hand.
    @objc func trace(_ call: CAPPluginCall) {
        let message = call.getString("message") ?? ""
        ApexLockCover.shared.trace("JS   " + message)
        call.resolve()
    }

    @objc func dumpTrace(_ call: CAPPluginCall) {
        call.resolve(["log": ApexLockCover.shared.dumpTrace()])
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
    private static let coverLevel = UIWindow.Level.alert + 1

    // Same #141210 the web cover paints, so the handoff between the two layers
    // has no visible seam.
    private static let coverColor = UIColor(red: 20.0/255.0, green: 18.0/255.0, blue: 16.0/255.0, alpha: 1.0)

    // WATCHDOG. A cover that can never be removed is its own outage: if the JS
    // side dies before calling hide(), the app would be permanently dark with
    // no way in. This is the last-resort reveal, and it is the ONLY watchdog in
    // the system now -- the 12s web-layer one was removed precisely because two
    // watchdogs on one resource means the shorter one silently wins.
    private var watchdog: Timer?
    private let watchdogSeconds: TimeInterval = 20.0

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

    // Raises the cover. Safe to call repeatedly.
    func show(reason: String) {
        if let existing = overlayWindow {
            existing.isHidden = false
            existing.windowLevel = Self.coverLevel
            trace("COVER re-shown (reason=\(reason)) \(describeWindows())")
            startWatchdog()
            return
        }

        guard let scene = Self.activeWindowScene() else {
            // No scene yet. Not fatal and not a silent failure: SceneDelegate
            // calls show() again once the scene exists.
            trace("COVER show DEFERRED - no UIWindowScene yet (reason=\(reason))")
            return
        }

        let w = UIWindow(windowScene: scene)
        w.windowLevel = Self.coverLevel
        w.backgroundColor = Self.coverColor
        // Swallow taps aimed at the page underneath.
        w.isUserInteractionEnabled = true

        let host = UIViewController()
        host.view.backgroundColor = Self.coverColor

        // A quiet wordmark so a slow launch reads as "locked", not "broken".
        let label = UILabel()
        label.text = "APEX"
        label.textColor = UIColor(red: 201.0/255.0, green: 164.0/255.0, blue: 58.0/255.0, alpha: 1.0)
        label.font = UIFont.systemFont(ofSize: 15, weight: .bold)
        label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        host.view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: host.view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: host.view.centerYAnchor)
        ])

        w.rootViewController = host
        // makeKeyAndVisible would steal key status from the app window; the
        // cover only needs to be VISIBLE, and taking key could interfere with
        // the biometric sheet's own presentation.
        w.isHidden = false
        overlayWindow = w

        trace("COVER SHOWN (reason=\(reason)) level=\(w.windowLevel.rawValue) \(describeWindows())")
        startWatchdog()
    }

    // The ONLY way the cover comes down.
    func hide(reason: String) {
        cancelWatchdog()
        guard let w = overlayWindow else {
            trace("COVER hide called but no cover present (reason=\(reason))")
            return
        }
        w.isHidden = true
        w.rootViewController = nil
        overlayWindow = nil
        trace("COVER HIDDEN (reason=\(reason))  <-- APP NOW VISIBLE")
    }

    private func startWatchdog() {
        cancelWatchdog()
        watchdog = Timer.scheduledTimer(withTimeInterval: watchdogSeconds, repeats: false) { [weak self] _ in
            guard let self = self else { return }
            guard self.isVisible else { return }
            self.trace("COVER WATCHDOG FIRED after \(Int(self.watchdogSeconds))s - revealing so the app is not bricked")
            self.hide(reason: "native-watchdog")
        }
    }

    private func cancelWatchdog() {
        watchdog?.invalidate()
        watchdog = nil
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

    private static func activeWindowScene() -> UIWindowScene? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.first { $0.activationState == .foregroundActive }
            ?? scenes.first { $0.activationState == .foregroundInactive }
            ?? scenes.first
    }
}
