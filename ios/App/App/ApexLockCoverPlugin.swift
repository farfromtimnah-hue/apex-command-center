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
    private static let coverLevel = UIWindow.Level.alert + 1

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
    private let stallSeconds: TimeInterval = 12.0

    // Tap handlers, wired by the plugin to JS events. Native never decides to
    // authenticate or reveal; it only reports the tap.
    var onRetry: (() -> Void)?
    var onSignOut: (() -> Void)?

    // The single vertical stack that owns every element on the cover -- the
    // wordmark from the start, plus the message and buttons once recovery is
    // shown. One stack means nothing on this screen can overlap anything else.
    private var contentStack: UIStackView?
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

    // Raises the cover. Safe to call repeatedly.
    func show(reason: String) {
        if let existing = overlayWindow {
            existing.isHidden = false
            existing.windowLevel = Self.coverLevel
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

        // A quiet wordmark so a slow launch reads as "locked", not "broken".
        let label = UILabel()
        label.text = "APEX"
        label.textColor = UIColor(red: 201.0/255.0, green: 164.0/255.0, blue: 58.0/255.0, alpha: 1.0)
        // Dynamic Type: scales with the user's text size instead of being
        // pinned at 15pt, and the whole stack grows with it.
        label.font = UIFontMetrics(forTextStyle: .footnote)
            .scaledFont(for: UIFont.systemFont(ofSize: 15, weight: .bold))
        label.adjustsFontForContentSizeCategory = true
        label.textAlignment = .center
        label.numberOfLines = 0
        content.addArrangedSubview(label)
        contentStack = content

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
        w.isHidden = true
        w.rootViewController = nil
        overlayWindow = nil
        // Both cleared: the views belonged to the discarded root VC, and a
        // later show() must build a fresh stack rather than append to a dead one.
        recoveryStack = nil
        contentStack = nil
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
                    // POINT 2: the action fired. Distinct from the touch
                    // arriving (logged by ApexTracingButton) and from the JS
                    // listener existing (logged at the notifyListeners call).
                    ApexLockCover.shared.trace("ACTION-FIRED: Unlock  handlerSet=\(ApexLockCover.shared.onRetry != nil)")
                    self?.onRetry?()
                }
            ))
        }
        // Always offered. If authentication genuinely cannot run on this device,
        // signing out is the way forward that does NOT expose data: it clears
        // the session and lands on the login page with nothing to protect.
        buttons.append(Self.makeButton(
            title: "Sair / Sign out",
            action: UIAction { [weak self] _ in
                ApexLockCover.shared.trace("ACTION-FIRED: SignOut  handlerSet=\(ApexLockCover.shared.onSignOut != nil)")
                self?.onSignOut?()
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

    private static func activeWindowScene() -> UIWindowScene? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.first { $0.activationState == .foregroundActive }
            ?? scenes.first { $0.activationState == .foregroundInactive }
            ?? scenes.first
    }
}
