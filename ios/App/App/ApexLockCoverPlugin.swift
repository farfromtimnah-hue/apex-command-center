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

    private var coverView: UIView?
    private weak var hostWindow: UIWindow?
    private var launchTime: CFAbsoluteTime = CFAbsoluteTimeGetCurrent()
    private var lines: [String] = []
    private let lock = NSLock()

    // WATCHDOG. A cover that can never be removed is its own outage: if the JS
    // side dies before it can call hide(), the app would be permanently black
    // with no way in. This is the native mirror of the 12s web watchdog.
    //
    // 20s, deliberately longer than the web one, so on a normal slow launch the
    // web layer resolves first and this never fires. If it DOES fire, the
    // in-document lock UI (if the web layer got that far) is still on top, so a
    // genuinely locked session is not thereby exposed -- and the log records it
    // loudly as an abnormal reveal.
    private var watchdog: Timer?
    private let watchdogSeconds: TimeInterval = 20.0

    private init() {}

    var isVisible: Bool {
        return coverView != nil && coverView?.superview != nil
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
        // NSLog rather than print: print goes only to the Xcode debug console,
        // while NSLog reaches the unified system log, so the trace is readable
        // in Console.app with the phone plugged in and no debugger attached.
        NSLog("[APEXTRACE] %@", line)
    }

    func dumpTrace() -> String {
        lock.lock()
        let out = lines.joined(separator: "\n")
        lock.unlock()
        return out
    }

    // Installs the cover into the window. Safe to call repeatedly.
    func show(reason: String) {
        guard let window = hostWindow ?? Self.keyWindow() else {
            trace("COVER show FAILED - no window yet (reason=\(reason))")
            return
        }
        hostWindow = window

        if let existing = coverView, existing.superview != nil {
            window.bringSubviewToFront(existing)
            trace("COVER already up, re-raised (reason=\(reason))")
            return
        }

        let view = UIView(frame: window.bounds)
        // Same #141210 the web cover paints, so the handoff between the two is
        // invisible -- no flash of a different shade at the seam.
        view.backgroundColor = UIColor(red: 20.0/255.0, green: 18.0/255.0, blue: 16.0/255.0, alpha: 1.0)
        view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.isUserInteractionEnabled = true   // swallow taps aimed at the page underneath
        view.accessibilityViewIsModal = true

        // A quiet wordmark, matching the web cover, so a slow launch reads as
        // "locked" rather than "broken".
        let label = UILabel()
        label.text = "APEX"
        label.textColor = UIColor(red: 201.0/255.0, green: 164.0/255.0, blue: 58.0/255.0, alpha: 1.0)
        label.font = UIFont.systemFont(ofSize: 15, weight: .bold)
        label.textAlignment = .center
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])

        window.addSubview(view)
        window.bringSubviewToFront(view)
        coverView = view
        trace("COVER SHOWN (reason=\(reason))")

        startWatchdog()
    }

    // The ONLY way the cover comes down.
    func hide(reason: String) {
        cancelWatchdog()
        guard let view = coverView else {
            trace("COVER hide called but no cover present (reason=\(reason))")
            return
        }
        view.removeFromSuperview()
        coverView = nil
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

    // Attaches to a window created after the cover was first requested.
    func attach(to window: UIWindow) {
        hostWindow = window
    }

    private static func keyWindow() -> UIWindow? {
        return UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow } ??
            UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap { $0.windows }
                .first
    }
}
