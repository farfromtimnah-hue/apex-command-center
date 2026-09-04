import UIKit
import UserNotifications
import Capacitor
// Present only while @capacitor-firebase/authentication is installed, which
// is what pulls in FirebaseCore. Kept conditional so that removing the plugin
// again (as this branch did while waiting on GoogleService-Info.plist) does
// not break the build.
#if canImport(FirebaseCore)
import FirebaseCore
#endif

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Required for willPresent below to ever be called.
        UNUserNotificationCenter.current().delegate = self
        // @capacitor-firebase/authentication requires the Firebase iOS SDK to be
        // configured before any of its methods run.
        //
        // The presence check is deliberate. FirebaseApp.configure() raises an
        // uncaught 'com.firebase.core' exception when GoogleService-Info.plist
        // is missing from the bundle, which would turn a missing config file
        // into a crash on launch for EVERY user, including the client accounts
        // that never touch Google sign-in and whose password login does not
        // need Firebase at all.
        //
        // NOTE: this guard alone is NOT sufficient to survive a missing plist.
        // The plugin's own initializer runs
        // `if FirebaseApp.app() == nil { FirebaseApp.configure() }`
        // (FirebaseAuthentication.swift:26), so when this guard declines to
        // configure, the plugin configures anyway and crashes. Verified on the
        // iPhone 17 simulator: SIGABRT on launch with exactly that exception.
        // The plist is therefore a hard prerequisite for shipping the plugin at
        // all - it is not an optional enhancement that degrades gracefully.
        //
        // Configuring HERE rather than leaving it to the plugin is still the
        // right order: this runs at didFinishLaunchingWithOptions, before any
        // plugin method can be called, which is what the Firebase iOS SDK asks
        // for. The plugin's own call then becomes the no-op branch.
        #if canImport(FirebaseCore)
        if Bundle.main.url(forResource: "GoogleService-Info", withExtension: "plist") != nil {
            FirebaseApp.configure()
        }
        #endif
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }

    // ── APNs delivery, required for push to work at all ──────────────────────
    //
    // iOS hands the device token to the APP DELEGATE, not to the plugin. The
    // Capacitor push plugin listens for these two NotificationCenter names and
    // forwards them to JS; without these methods the plugin's register() call
    // succeeds, Apple issues a token, and it is delivered to nobody.
    //
    // Seen on device 2026-09-03: permission granted, "PUSH already granted ->
    // register()" logged, and then silence - no registration callback, no
    // error, and apns_device_tokens stayed empty. Capacitor does not add these
    // for you.
    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(
            name: .capacitorDidRegisterForRemoteNotifications,
            object: deviceToken)
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(
            name: .capacitorDidFailToRegisterForRemoteNotifications,
            object: error)
    }


    // Show notifications while the app is OPEN.
    //
    // iOS suppresses banners for the foreground app by default, so a
    // notification arrived, was accepted by APNs, and displayed nothing -
    // verified on device 2026-09-03: the same push showed on the home screen
    // and was invisible with Apex in front.
    //
    // Alice and Rafa live in this app during the working day, which is exactly
    // when an invoice draft or a meeting reminder matters most. Suppressing it
    // then defeats the point of building push at all.
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler:
                                    @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound, .badge])
    }

}
