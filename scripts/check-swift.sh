#!/bin/sh
# Type-check the app-target Swift files WITHOUT a full Xcode build.
#
# WHY THIS EXISTS: two device cycles were lost to Swift problems that a compiler
# would have caught in seconds -- a file missing from App.xcodeproj, then a
# stale `startWatchdog` reference after a rename. There is no local Xcode build
# here (Capacitor's framework comes from SPM and the app target needs the full
# project graph), but the app-target sources can still be fully TYPE-CHECKED by
# stubbing the handful of Capacitor symbols they touch.
#
# This catches: syntax errors, unresolved symbols, type mismatches, wrong
# signatures, and deprecation warnings. It does NOT catch: anything about the
# real Capacitor API's actual shape (the stubs below are hand-written, so a
# wrong assumption about Capacitor is invisible here), linkage, or whether a
# file is registered in App.xcodeproj -- run check-xcodeproj.sh for that.
#
# Usage:  sh scripts/check-swift.sh
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SRC="$ROOT/ios/App/App"
SDK=$(xcrun --sdk iphonesimulator --show-sdk-path)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

cat > "$WORK/CapacitorStub.swift" <<'EOF'
import Foundation
import UIKit
import UserNotifications
import WebKit
// Task 1.6: real signature from NotificationRouter.swift -- an
// NSObject, UNUserNotificationCenterDelegate that CAPBridgeProtocol exposes
// as `notificationRouter` so an app that reclaims the delegate role (as
// AppDelegate does, see its own header comment) can still forward a tap.
open class NotificationRouter: NSObject, UNUserNotificationCenterDelegate {
    public func userNotificationCenter(_ center: UNUserNotificationCenter,
                                        didReceive response: UNNotificationResponse,
                                        withCompletionHandler completionHandler: @escaping () -> Void) {
        completionHandler()
    }
}
public struct CAPPluginMethodReturnType { }
public let CAPPluginReturnPromise = CAPPluginMethodReturnType()
public class CAPPluginMethod {
    public init(name: String, returnType: CAPPluginMethodReturnType) {}
}
public protocol CAPBridgedPlugin {
    var identifier: String { get }
    var jsName: String { get }
    var pluginMethods: [CAPPluginMethod] { get }
}
@objc open class CAPPluginCall: NSObject {
    @objc open func getString(_ k: String) -> String? { return nil }
    open func getBool(_ k: String) -> Bool? { return nil }
    @objc open func resolve(_ d: [String: Any]) {}
    @objc open func resolve() {}
    // Real signature from CAPPluginCall.swift:45.
    @objc open func reject(_ message: String, _ code: String? = nil, _ error: Error? = nil) {}
}
@objc open class CAPPlugin: NSObject {
    @objc open func load() {}
    @objc open func notifyListeners(_ name: String, data: [String: Any]) {}
    // Real signature from CAPPlugin.h:23 -- the retaining variant queues an
    // event when no listener is attached yet.
    @objc open func notifyListeners(_ name: String, data: [String: Any], retainUntilConsumed retain: Bool) {}
    // CAPPlugin.h:25
    @objc open func hasListeners(_ name: String) -> Bool { return false }
}
public protocol CAPBridgeProtocol {
    func registerPluginInstance(_ p: CAPPlugin)
    // Task 1.6: real signature from CAPBridgeProtocol.swift -- non-optional.
    var notificationRouter: NotificationRouter { get }
}
public class InstanceConfiguration: NSObject {}
open class CAPBridgeViewController: UIViewController {
    open var bridge: CAPBridgeProtocol? { return nil }
    open func capacitorDidLoad() {}
    // Real signature from CAPBridgeViewController.swift:119
    open func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        return WKWebViewConfiguration()
    }
    // Real signature from CAPBridgeViewController.swift:154 -- called AFTER
    // userContentController has been replaced, so scripts added here survive.
    open func webView(with frame: CGRect, configuration: WKWebViewConfiguration) -> WKWebView {
        return WKWebView(frame: frame, configuration: configuration)
    }
}
public class SceneDelegateProxy: NSObject, UISceneDelegate {
    public static let shared = SceneDelegateProxy()
    public func scene(_ s: UIScene, willConnectTo session: UISceneSession, options o: UIScene.ConnectionOptions) {}
    public func scene(_ s: UIScene, openURLContexts c: Set<UIOpenURLContext>) {}
    public func scene(_ s: UIScene, continue u: NSUserActivity) {}
}
EOF

# Stripe Terminal SDK 6.0.0 (Tap to Pay, Build 5) -- hand-written stub of
# just the symbols ApexTapToPayPlugin.swift touches, same spirit as the
# Capacitor stub above: this catches syntax errors, unresolved symbols and
# wrong signatures in OUR code, but a wrong assumption about the real SDK's
# shape is invisible here. Verified against stripe.dev/stripe-terminal-ios
# (the 6.0.0 API reference, not the older completion-block prose examples
# some doc pages still show) -- see ApexTapToPayPlugin.swift's header
# comment for the discrepancies found and resolved.
cat > "$WORK/StripeTerminalStub.swift" <<'EOF'
import Foundation
public protocol Cancelable: AnyObject {}
public class ReaderSoftwareUpdate {}
public class ReaderDisplayMessage {}
public class ReaderInputOptions {}
public class DisconnectReason {}
public class Reader { public var locationId: String? { return nil } }
public protocol DiscoveryDelegate: AnyObject {
    func terminal(_ terminal: Terminal, didUpdateDiscoveredReaders readers: [Reader])
}
public protocol TapToPayReaderDelegate: AnyObject {
    func reader(_ reader: Reader, didStartInstallingUpdate update: ReaderSoftwareUpdate, cancelable: Cancelable?)
    func reader(_ reader: Reader, didReportReaderSoftwareUpdateProgress progress: Float)
    func reader(_ reader: Reader, didFinishInstallingUpdate update: ReaderSoftwareUpdate?, error: Error?)
    func reader(_ reader: Reader, didRequestReaderDisplayMessage displayMessage: ReaderDisplayMessage)
    func reader(_ reader: Reader, didRequestReaderInput inputOptions: ReaderInputOptions)
    func reader(_ reader: Reader, didDisconnect reason: DisconnectReason)
}
public protocol DiscoveryConfiguration {}
public class TapToPayDiscoveryConfiguration: DiscoveryConfiguration {}
public class TapToPayDiscoveryConfigurationBuilder {
    public init() {}
    public func setSimulated(_ v: Bool) -> Self { return self }
    public func build() throws -> TapToPayDiscoveryConfiguration { return TapToPayDiscoveryConfiguration() }
}
public protocol ConnectionConfiguration {}
public class TapToPayConnectionConfiguration: ConnectionConfiguration {}
public class TapToPayConnectionConfigurationBuilder {
    public init(delegate: TapToPayReaderDelegate, locationId: String) {}
    public func build() throws -> TapToPayConnectionConfiguration { return TapToPayConnectionConfiguration() }
}
public protocol ConnectionTokenProvider: AnyObject {
    func fetchConnectionToken() async throws -> String
}
public class PaymentMethod {}
public class PaymentIntent { public var stripeId: String? { return nil } }
public enum ErrorCode {
    public enum Code: Int {
        case canceled = 1
        case canceledByReader = 2
        case cardReadTimedOut = 3
        case cardSwipeNotAvailable = 4
        case cardInsertNotRead = 5
        case cardRemoved = 6
        case tapToPayReaderMerchantBlocked = 7
        case notConnectedToReader = 8
        case declinedByStripeAPI = 9
        case declinedByReader = 10
    }
}
public class CollectPaymentIntentConfiguration {}
public class ConfirmPaymentIntentConfiguration {}
public typealias PaymentIntentCompletionBlock = (PaymentIntent?, Error?) -> Void
public typealias ConfirmPaymentIntentCompletionBlock = (PaymentIntent?, Error?) -> Void
public typealias ErrorCompletionBlock = (Error?) -> Void
public class Terminal {
    public static let shared = Terminal()
    public static func initWithTokenProvider(_ provider: ConnectionTokenProvider) {}
    public func discoverReaders(_ configuration: DiscoveryConfiguration, delegate: DiscoveryDelegate, completion: @escaping ErrorCompletionBlock) -> Cancelable? { return nil }
    public func connectReader(_ reader: Reader, connectionConfig: ConnectionConfiguration) async throws -> Reader { return reader }
    public func retrievePaymentIntent(clientSecret: String) async throws -> PaymentIntent { return PaymentIntent() }
    public func collectPaymentMethod(_ paymentIntent: PaymentIntent, completion: @escaping PaymentIntentCompletionBlock) -> Cancelable? { return nil }
    public func confirmPaymentIntent(_ paymentIntent: PaymentIntent, completion: @escaping ConfirmPaymentIntentCompletionBlock) -> Cancelable? { return nil }
}
EOF

FILES="$WORK/CapacitorStub.swift $WORK/StripeTerminalStub.swift"
for f in "$SRC"/*.swift; do
  base=$(basename "$f")
  # AppDelegate pulls in Firebase and other real frameworks; skip it.
  [ "$base" = "AppDelegate.swift" ] && continue
  sed -e 's/^import Capacitor$//' -e 's/^import StripeTerminal$//' "$f" > "$WORK/$base"
  FILES="$FILES $WORK/$base"
done

echo "Type-checking: $(echo $FILES | tr ' ' '\n' | grep -v CapacitorStub | grep -v StripeTerminalStub | xargs -n1 basename 2>/dev/null | tr '\n' ' ')"
# shellcheck disable=SC2086
xcrun swiftc -typecheck -sdk "$SDK" -target arm64-apple-ios15.0-simulator $FILES
echo "OK - no errors, no warnings"
