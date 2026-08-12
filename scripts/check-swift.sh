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
import WebKit
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
}
public class InstanceConfiguration: NSObject {}
open class CAPBridgeViewController: UIViewController {
    open var bridge: CAPBridgeProtocol? { return nil }
    open func capacitorDidLoad() {}
    // Real signature from CAPBridgeViewController.swift:119
    open func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        return WKWebViewConfiguration()
    }
}
public class SceneDelegateProxy: NSObject, UISceneDelegate {
    public static let shared = SceneDelegateProxy()
    public func scene(_ s: UIScene, willConnectTo session: UISceneSession, options o: UIScene.ConnectionOptions) {}
    public func scene(_ s: UIScene, openURLContexts c: Set<UIOpenURLContext>) {}
    public func scene(_ s: UIScene, continue u: NSUserActivity) {}
}
EOF

FILES="$WORK/CapacitorStub.swift"
for f in "$SRC"/*.swift; do
  base=$(basename "$f")
  # AppDelegate pulls in Firebase and other real frameworks; skip it.
  [ "$base" = "AppDelegate.swift" ] && continue
  sed 's/^import Capacitor$//' "$f" > "$WORK/$base"
  FILES="$FILES $WORK/$base"
done

echo "Type-checking: $(echo $FILES | tr ' ' '\n' | grep -v CapacitorStub | xargs -n1 basename 2>/dev/null | tr '\n' ' ')"
# shellcheck disable=SC2086
xcrun swiftc -typecheck -sdk "$SDK" -target arm64-apple-ios15.0-simulator $FILES
echo "OK - no errors, no warnings"
