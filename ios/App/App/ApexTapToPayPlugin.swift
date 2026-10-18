import Foundation
import UIKit
import Capacitor
import StripeTerminal

// ---------------------------------------------------------------------------
// Tap to Pay on iPhone (Build 5), Stripe Terminal SDK 6.0.0 via SPM
// (https://github.com/stripe/stripe-terminal-ios-spm, exact version 6.0.0).
//
// Methods exposed to JS (gm.js): isSupported(), prepare({ locationId }),
// takePayment({ clientSecret }).
//
// SDK 6.0.0 API SHAPE (verified against stripe.dev/stripe-terminal-ios,
// NOT the older completion-block examples still shown on some prose doc
// pages): connectReader and retrievePaymentIntent are now async throws;
// discoverReaders, collectPaymentMethod and confirmPaymentIntent remain
// completion-block based, each returning a Cancelable?; ConnectionTokenProvider
// is now `func fetchConnectionToken() async throws -> String`, not a
// completion block.
//
// CONNECTION TOKEN: fetchConnectionToken() has no way to be handed a
// pre-fetched token -- the SDK calls it whenever IT decides a fresh one is
// needed. Rather than have Swift call the Worker directly (duplicating the
// URL/auth-header plumbing apiFetch already has in JS), this suspends on a
// continuation, fires a plugin EVENT ("apexTapRequestConnectionToken") that
// gm.js answers by calling POST .../stripe/tap/connection-token itself, and
// resumes when gm.js calls this plugin's provideConnectionToken({ secret }).
// A 15-second timeout resumes with an error rather than hanging the SDK
// forever if JS never answers. The secret is never logged on either side.
//
// Never stores or logs card data: this plugin never sees raw card data at
// all -- the SDK owns the NFC read and the PaymentIntent confirmation
// entirely inside its own process space; the full-screen "hold your card or
// phone near the back of the iPhone" prompt is drawn by the OS/SDK, not by
// this plugin or by gm.js.
// ---------------------------------------------------------------------------

@objc(ApexTapToPayPlugin)
public class ApexTapToPayPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ApexTapToPayPlugin"
    public let jsName = "ApexTapToPay"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "prepare", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takePayment", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "provideConnectionToken", returnType: CAPPluginReturnPromise)
    ]

    // Terminal.initWithTokenProvider may be called only ONCE per process,
    // and only before Terminal.shared is first touched. Guarded here rather
    // than in AppDelegate so the Stripe dependency stays scoped to this
    // plugin -- a build with no Tap to Pay use never touches StripeTerminal.
    private static var didInit = false
    private static let initLock = NSLock()

    // Pending connection-token continuations the SDK is awaiting, keyed by a
    // request id, so provideConnectionToken can resume the exact one it
    // answers even if two requests somehow overlap.
    fileprivate static var pendingTokenContinuations: [String: CheckedContinuation<String, Error>] = [:]
    fileprivate static let pendingLock = NSLock()

    private var discoverCancelable: Cancelable?
    private var connectedReader: Reader?
    private var paymentInFlight = false
    // Retained HERE, not just passed inline to the connection-config builder:
    // TapToPayConnectionConfiguration holds its delegate WEAKLY, so a
    // throwaway instance created inline would be deallocated before the SDK
    // ever called back into it.
    private let readerDelegate = ApexTapReaderDelegate()

    private func ensureInitialized() {
        ApexTapToPayPlugin.initLock.lock()
        defer { ApexTapToPayPlugin.initLock.unlock() }
        ApexTapTokenProvider.shared.plugin = self
        if ApexTapToPayPlugin.didInit { return }
        Terminal.initWithTokenProvider(ApexTapTokenProvider.shared)
        ApexTapToPayPlugin.didInit = true
    }

    // No network, no SDK call: a plain device/OS check so the "Receber no
    // cartão (tap)" button can hide itself before ever touching Stripe. The
    // SDK's own discoverReaders is still the real authority -- this is only
    // a fast, local pre-check.
    @objc func isSupported(_ call: CAPPluginCall) {
        let idiom = UIDevice.current.userInterfaceIdiom
        let isPhone = idiom == .phone
        let osOK: Bool
        if #available(iOS 16.0, *) { osOK = true } else { osOK = false }
        call.resolve(["supported": isPhone && osOK])
    }

    // Discovers the local Tap to Pay reader and connects it to the given
    // Stripe Terminal location. Safe to call again once already connected to
    // the SAME location (resolves immediately); reconnects if the location
    // differs (e.g. a different business was previously prepared).
    @objc func prepare(_ call: CAPPluginCall) {
        guard let locationId = call.getString("locationId"), !locationId.isEmpty else {
            call.reject("no location id given", "missing_location")
            return
        }
        ensureInitialized()

        if let reader = connectedReader, reader.locationId == locationId {
            call.resolve(["connected": true])
            return
        }

        let discoveryConfig: TapToPayDiscoveryConfiguration
        do {
            discoveryConfig = try TapToPayDiscoveryConfigurationBuilder().build()
        } catch {
            call.reject("could not build the discovery configuration", "discovery_config_failed", error)
            return
        }

        let delegate = ApexTapDiscoveryDelegate()
        discoverCancelable = Terminal.shared.discoverReaders(discoveryConfig, delegate: delegate) { [weak self] discoverError in
            guard let self = self else { return }
            if let discoverError = discoverError {
                call.reject("discoverReaders failed", ApexTapToPayPlugin.errorCode(for: discoverError), discoverError)
                return
            }
            guard let reader = delegate.discoveredReader else {
                call.reject("no Tap to Pay reader found on this device", "no_reader_found")
                return
            }
            Task {
                do {
                    let connectionConfig = try TapToPayConnectionConfigurationBuilder(delegate: self.readerDelegate, locationId: locationId).build()
                    let connected = try await Terminal.shared.connectReader(reader, connectionConfig: connectionConfig)
                    self.connectedReader = connected
                    call.resolve(["connected": true])
                } catch {
                    call.reject("connectReader failed", ApexTapToPayPlugin.errorCode(for: error), error)
                }
            }
        }
    }

    // Retrieves the PaymentIntent from the client secret the Worker returned
    // (POST .../stripe/tap/payment-intent), collects the payment method
    // (this is where the full-screen "hold your card or phone near the back
    // of the iPhone" system prompt appears -- entirely owned by the SDK/OS,
    // nothing to build here), and confirms it. Capture is automatic
    // (capture_method on the PaymentIntent, set by the Worker), so a
    // successful confirm already means the money moved; the Worker's own
    // webhook (payment_intent.succeeded, apex_source=tap_to_pay) is what
    // actually records the invoice payment -- this call's job ends at
    // "the SDK confirms the PaymentIntent succeeded".
    @objc func takePayment(_ call: CAPPluginCall) {
        guard let clientSecret = call.getString("clientSecret"), !clientSecret.isEmpty else {
            call.reject("no client secret given", "missing_client_secret")
            return
        }
        guard connectedReader != nil else {
            call.reject("no reader connected -- call prepare() first", "not_connected")
            return
        }
        if paymentInFlight {
            call.reject("a payment is already in progress", "payment_in_progress")
            return
        }
        paymentInFlight = true
        let finish: () -> Void = { [weak self] in self?.paymentInFlight = false }

        Task {
            let paymentIntent: PaymentIntent
            do {
                paymentIntent = try await Terminal.shared.retrievePaymentIntent(clientSecret: clientSecret)
            } catch {
                finish()
                call.reject("retrievePaymentIntent failed", ApexTapToPayPlugin.errorCode(for: error), error)
                return
            }

            // Customer-cancellation stays ON (the SDK default): the cardholder
            // can back out of the Apple sheet, which the SDK reports distinctly
            // from a cancel this app itself requests (.canceledByReader vs
            // .canceled, SDK 6.0.0+) -- see errorCode(for:) below.
            _ = Terminal.shared.collectPaymentMethod(paymentIntent, completion: { collected, collectError in
                if let collectError = collectError {
                    finish()
                    call.reject("collectPaymentMethod failed", ApexTapToPayPlugin.errorCode(for: collectError), collectError)
                    return
                }
                guard let collectedIntent = collected else {
                    finish()
                    call.reject("collectPaymentMethod returned no payment intent", "collect_failed")
                    return
                }
                _ = Terminal.shared.confirmPaymentIntent(collectedIntent, completion: { confirmed, confirmError in
                    finish()
                    if let confirmError = confirmError {
                        call.reject("confirmPaymentIntent failed", ApexTapToPayPlugin.errorCode(for: confirmError), confirmError)
                        return
                    }
                    guard let confirmedIntent = confirmed else {
                        call.reject("confirmPaymentIntent returned no payment intent", "confirm_failed")
                        return
                    }
                    call.resolve([
                        "status": "succeeded",
                        "paymentIntentId": confirmedIntent.stripeId ?? ""
                    ])
                })
            })
        }
    }

    // JS answers a pending "apexTapRequestConnectionToken" event by fetching
    // a fresh secret from the Worker and handing it back here. Never logged.
    @objc func provideConnectionToken(_ call: CAPPluginCall) {
        guard let requestId = call.getString("requestId") else {
            call.reject("no requestId given", "missing_request_id")
            return
        }
        let secret = call.getString("secret")
        let errorMessage = call.getString("error")

        ApexTapToPayPlugin.pendingLock.lock()
        let continuation = ApexTapToPayPlugin.pendingTokenContinuations.removeValue(forKey: requestId)
        ApexTapToPayPlugin.pendingLock.unlock()

        guard let continuation = continuation else {
            // The request already timed out or was already answered; nothing
            // to do, and nothing to treat as an error on the JS side.
            call.resolve()
            return
        }
        if let secret = secret, !secret.isEmpty {
            continuation.resume(returning: secret)
        } else {
            continuation.resume(throwing: NSError(
                domain: "com.apex.taptopay", code: 1001,
                userInfo: [NSLocalizedDescriptionKey: errorMessage ?? "connection token request failed"]))
        }
        call.resolve()
    }

    // Maps an SDK error to a short, stable code the web layer switches on for
    // its bilingual error states. ErrorCode.Code(rawValue:) only succeeds for
    // a code the Stripe Terminal SDK actually defines, so this never needs to
    // guess at the SCPErrorDomain string -- a value that does not construct
    // is simply not a Stripe Terminal error (a plain NSURLError, for
    // instance), and falls through to the network/unknown branch below.
    //
    // .canceled (this app's own Cancelable.cancel()) and .canceledByReader
    // (the cardholder backed out of the Apple sheet, or any other on-reader
    // cancellation -- SDK 6.0.0+) are DISTINCT on purpose: the spec asks for
    // "cancel" and "user cancel on the Apple sheet" to read as different
    // outcomes to the person running the register.
    fileprivate static func errorCode(for error: Error) -> String {
        let nsError = error as NSError
        guard let code = ErrorCode.Code(rawValue: nsError.code) else {
            return (nsError.code == NSURLErrorNotConnectedToInternet) ? "no_network" : "unknown_error"
        }
        switch code {
        case .canceled:
            return "cancelled"
        case .canceledByReader:
            return "cancelled_on_reader"
        case .cardReadTimedOut, .cardSwipeNotAvailable, .cardInsertNotRead, .cardRemoved:
            return "card_read_failed"
        case .tapToPayReaderMerchantBlocked:
            return "too_many_accounts_today"
        case .notConnectedToReader:
            return "not_connected"
        case .declinedByStripeAPI, .declinedByReader:
            return "declined"
        default:
            return "unknown_error"
        }
    }
}

// Discovers exactly one Tap to Pay reader (there is only ever one: the
// device itself) and keeps it so the completion block above can connect it.
private class ApexTapDiscoveryDelegate: NSObject, DiscoveryDelegate {
    var discoveredReader: Reader?
    func terminal(_ terminal: Terminal, didUpdateDiscoveredReaders readers: [Reader]) {
        if discoveredReader == nil { discoveredReader = readers.first }
    }
}

// Required by TapToPayConnectionConfigurationBuilder.init(delegate:locationId:).
// This build does not need its own device-setup progress UI (out of scope
// per the spec); every callback is a documented no-op, matching the bodies
// shown in Stripe's own connect-reader guide -- the SDK still drives its own
// system UI (the full-screen tap prompt, any required reader configuration)
// regardless of what this delegate does.
private class ApexTapReaderDelegate: NSObject, TapToPayReaderDelegate {
    func reader(_ reader: Reader, didStartInstallingUpdate update: ReaderSoftwareUpdate, cancelable: Cancelable?) {}
    func reader(_ reader: Reader, didReportReaderSoftwareUpdateProgress progress: Float) {}
    func reader(_ reader: Reader, didFinishInstallingUpdate update: ReaderSoftwareUpdate?, error: Error?) {}
    func reader(_ reader: Reader, didRequestReaderDisplayMessage displayMessage: ReaderDisplayMessage) {}
    func reader(_ reader: Reader, didRequestReaderInput inputOptions: ReaderInputOptions) {}
    func reader(_ reader: Reader, didDisconnect reason: DisconnectReason) {}
}

// ConnectionTokenProvider (SDK 6.0.0: async throws -> String, not a
// completion block): bridges the SDK's native-only call to the web layer's
// POST .../stripe/tap/connection-token via a plugin event +
// provideConnectionToken (see the file header). A 15-second timeout fails
// closed rather than hanging the SDK forever if JS never answers (app
// backgrounded mid-request, page navigated away, etc).
private class ApexTapTokenProvider: NSObject, ConnectionTokenProvider {
    static let shared = ApexTapTokenProvider()
    weak var plugin: ApexTapToPayPlugin?

    func fetchConnectionToken() async throws -> String {
        let requestId = UUID().uuidString
        guard let plugin = plugin else {
            throw NSError(domain: "com.apex.taptopay", code: 1002,
                           userInfo: [NSLocalizedDescriptionKey: "plugin not available"])
        }
        return try await withCheckedThrowingContinuation { continuation in
            ApexTapToPayPlugin.pendingLock.lock()
            ApexTapToPayPlugin.pendingTokenContinuations[requestId] = continuation
            ApexTapToPayPlugin.pendingLock.unlock()

            plugin.notifyListeners("apexTapRequestConnectionToken", data: ["requestId": requestId])

            DispatchQueue.main.asyncAfter(deadline: .now() + 15.0) {
                ApexTapToPayPlugin.pendingLock.lock()
                let stillPending = ApexTapToPayPlugin.pendingTokenContinuations.removeValue(forKey: requestId)
                ApexTapToPayPlugin.pendingLock.unlock()
                if let stillPending = stillPending {
                    stillPending.resume(throwing: NSError(
                        domain: "com.apex.taptopay", code: 1003,
                        userInfo: [NSLocalizedDescriptionKey: "connection token request timed out"]))
                }
            }
        }
    }
}
