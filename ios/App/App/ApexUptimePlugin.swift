import Foundation
import Capacitor
import WebKit

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

    // Deliberately NO WKNavigationDelegate overrides in this class. Their exact
    // signatures belong to the Capacitor version in use (8.5.0 via SPM, sources
    // not vendored here), and a wrong `override` is a COMPILE error rather than
    // a degraded log. The JS side stamps HEAD-PARSE / NAVIGATE-AWAY into the
    // same native timeline, so the document chain is still visible.

    // NATIVE-SIDE JS ERROR CAPTURE.
    //
    // "⚡️ JS Eval error A JavaScript exception occurred" is all Capacitor
    // prints (CapacitorBridge.swift:643/659), and every downstream symptom --
    // no WIRE-INIT, no WIRE-POLL, no replay block, hasListeners=false forever --
    // is consistent with a script dying early. The actual message, file, line
    // and stack have to come from somewhere else.
    //
    // This is deliberately BELOW the page's own inline hook, not instead of it:
    //   - injected at .atDocumentStart, so it is installed before ANY page
    //     script, including one that throws on its first line;
    //   - delivered over a WKScriptMessageHandler straight to NSLog, so it does
    //     not depend on the Capacitor plugin bridge existing yet -- which is
    //     exactly the thing that may not have happened when the error fires;
    //   - forMainFrameOnly false, so an error in a subframe is caught too.
    // INJECTED FROM webView(with:configuration:), NOT webViewConfiguration(for:).
    //
    // The previous attempt overrode webViewConfiguration(for:) and added the
    // user script there. It produced ZERO output on device, and the reason is
    // one line of Capacitor's own code:
    //
    //   let webConfig = webViewConfiguration(for: configuration)   // :295
    //   webConfig.setURLSchemeHandler(...)                         // :296
    //   webConfig.userContentController = delegationHandler.contentController  // :297
    //
    // Line 297 REPLACES the whole content controller immediately after calling
    // the override, so every user script and message handler added there is
    // discarded before the WebView is created. That hook could never have
    // fired. webView(with:configuration:) (:154) is called on the NEXT line
    // with the final configuration, so anything added here survives.
    override open func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        NSLog("[APEXTRACE] BRIDGE webView(with:configuration:) called - installing JS error hook")
        let config = configuration

        let js = """
        (function () {
          function send(kind, detail) {
            try {
              window.webkit.messageHandlers.apexJSError.postMessage(kind + ' | ' + detail);
            } catch (e) {}
          }
          window.addEventListener('error', function (ev) {
            if (ev && ev.target && ev.target !== window && ev.target.tagName) {
              send('RESOURCE', ev.target.tagName + ' failed: ' + (ev.target.src || ev.target.href || '?'));
              return;
            }
            var e = ev && ev.error;
            send('ERROR', (ev && ev.message ? ev.message : '?') +
              ' @ ' + (ev && ev.filename ? ev.filename : '?') +
              ':' + (ev && ev.lineno !== undefined ? ev.lineno : '?') +
              ':' + (ev && ev.colno !== undefined ? ev.colno : '?') +
              ' | stack=' + (e && e.stack ? String(e.stack).slice(0, 500) : 'none'));
          }, true);
          window.addEventListener('unhandledrejection', function (ev) {
            var r = ev && ev.reason;
            send('REJECTION', (r && r.message ? r.message : String(r)) +
              ' | stack=' + (r && r.stack ? String(r.stack).slice(0, 500) : 'none'));
          });
          send('HOOK', 'native error hook installed at documentStart on ' + window.location.href);
        })();
        """
        let script = WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: false)
        config.userContentController.addUserScript(script)
        // Remove first: this method can be called more than once, and adding a
        // duplicate handler name is a hard crash rather than a warning.
        config.userContentController.removeScriptMessageHandler(forName: "apexJSError")
        config.userContentController.add(ApexJSErrorHandler.shared, name: "apexJSError")

        return super.webView(with: frame, configuration: config)
    }
}

// Receives the messages posted by the injected hook above and writes them into
// the same native timeline as everything else.
final class ApexJSErrorHandler: NSObject, WKScriptMessageHandler {
    static let shared = ApexJSErrorHandler()

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        let body = String(describing: message.body)
        ApexLockCover.shared.trace("JSERROR \(body)")
    }

}
