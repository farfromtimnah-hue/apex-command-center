import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        ApexLockCover.shared.markLaunch()
        ApexLockCover.shared.trace("SCENE willConnectTo - creating window")

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = ApexBridgeViewController()
        window?.makeKeyAndVisible()

        // THE COVER GOES UP HERE, before the WebView can paint its first frame.
        //
        // This is the whole point of the native layer: the window exists and is
        // key, but the WKWebView underneath has not rendered anything yet. The
        // cover is a sibling view in the window, not part of any document, so no
        // navigation can remove it and no async plugin registration gates it.
        //
        // It is raised UNCONDITIONALLY. Whether there is a session to protect is
        // not knowable here -- the admin session lives in the keychain and is
        // only readable asynchronously -- and "unknown" must mean "covered".
        // The JS side calls hide() once it has positively established either
        // that authentication succeeded or that there is no session at all.
        ApexLockCover.shared.attach(to: window!)
        ApexLockCover.shared.show(reason: "scene-launch")

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    // Re-cover when the app is backgrounded, so the app-switcher snapshot and
    // the next resume cannot show content before the prompt. This is also the
    // F2 app-switcher fix: it must live in SceneDelegate, because a
    // UISceneDelegate-based app never receives the AppDelegate lifecycle
    // callbacks at all.
    func sceneWillResignActive(_ scene: UIScene) {
        ApexLockCover.shared.trace("SCENE willResignActive - covering for app switcher")
        ApexLockCover.shared.show(reason: "resign-active")
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        // Deliberately does NOT hide: the JS resume path decides whether the
        // grace period lets this through, and calls hide() if so.
        ApexLockCover.shared.trace("SCENE didBecomeActive")
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
