import Foundation
import Capacitor

// A monotonic clock for the biometric unlock grace period.
//
// The grace period is an elapsed DURATION, so it must never be computed from
// wall-clock dates. Date.now() in JS, and everything derived from it
// (including performance.timeOrigin), moves when the clock is corrected by
// NTP, when the user edits the clock, or across a DST boundary. Any of those
// could expire the unlock early or, far worse, extend it well past its window.
//
// The web platform's only monotonic clock, performance.now(), restarts on every
// page navigation, and this app navigates between real HTML pages constantly.
// So a JS-only implementation would have to either re-prompt on every page
// click (unusable) or fall back to wall-clock time (unsafe).
//
// ProcessInfo.systemUptime is seconds since the device booted. It counts
// forward only, is unaffected by any clock change, and lives in the OS rather
// than the WebView - so it survives page navigation, and it survives the app
// being backgrounded. That makes "15 minutes since unlock" mean 15 real
// minutes regardless of what happens to the calendar.
//
// Note: systemUptime does NOT advance while the device is fully powered off,
// and resets on reboot. Both are safe here: a reboot yields a smaller reading
// than the stored one, which the JS side treats as tampering and re-prompts.
@objc(ApexUptimePlugin)
public class ApexUptimePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ApexUptimePlugin"
    public let jsName = "ApexUptime"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "now", returnType: CAPPluginReturnPromise)
    ]

    @objc func now(_ call: CAPPluginCall) {
        // Milliseconds since boot, as a Double. Resolution is far finer than
        // the 15-minute window needs.
        let uptimeMs = ProcessInfo.processInfo.systemUptime * 1000.0
        call.resolve(["ms": uptimeMs])
    }
}

// Capacitor auto-discovers plugins that ship as their own SPM package, but a
// plugin defined in the APP target is not on that list and is never registered
// - it compiles, exports its symbols, and is simply never reachable from JS.
// That failure is silent: window.Capacitor.Plugins.ApexUptime is just
// undefined. Verified on the device, where the plugin produced zero bridge
// traffic until this subclass existed.
//
// Registering it here, where the bridge view controller is created, is the
// supported way to add an app-target plugin.
class ApexBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(ApexUptimePlugin())

        // The native biometric cover. Registered HERE and ONLY here.
        //
        // It was ALSO listed in capacitor.config.json's packageClassList, which
        // Capacitor auto-registers in registerPlugins() (CapacitorBridge.swift:312)
        // BEFORE capacitorDidLoad runs. That produced two instances one
        // millisecond apart, and Capacitor said so plainly in the log:
        // "⚡️ Overriding existing registered plugin ApexLockCoverPlugin".
        //
        // Why that is not merely untidy: registerPluginInstance calls
        // instance.load() and JSExport.exportJS AGAIN
        // (CapacitorBridge.swift:362-364). So load() ran twice, and the second
        // run overwrote ApexLockCover.shared.onRetry/onSignOut with closures
        // capturing the SECOND instance -- which is why every tap logged
        // onInstance=<B>. exportJS also injected the plugin's JS shim and pushed
        // its PluginHeaders entry a second time.
        //
        // I added the packageClassList entry myself, "for consistency", while
        // fixing the missing-from-Xcode-project bug. ApexUptimePlugin has never
        // been in that list and has always worked, which is the evidence that
        // manual registration alone is the correct pattern for an app-target
        // plugin. Do not add either plugin back to packageClassList.
        bridge?.registerPluginInstance(ApexLockCoverPlugin())

        ApexLockCover.shared.trace("BRIDGE capacitorDidLoad - plugins registered, WebView about to load")
    }

    // Deliberately NO WKNavigationDelegate overrides here.
    //
    // Native navigation callbacks would be the authoritative record of the
    // document chain, but their exact signatures belong to the Capacitor
    // version in use (8.5.0 via SPM, sources not vendored in this repo), and a
    // wrong `override` is a COMPILE error rather than a degraded log. The JS
    // side already stamps HEAD-PARSE / NAVIGATE-AWAY into this same native
    // timeline through ApexLockCover.trace, so the chain is still visible in
    // one ordered log -- without risking the build on an unverifiable
    // signature.
}
