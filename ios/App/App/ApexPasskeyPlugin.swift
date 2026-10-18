import Foundation
import UIKit
import Capacitor
import AuthenticationServices

// ---------------------------------------------------------------------------
// Passkey sign-in for the iPhone app (passkey login build, Build C).
//
// WHY A NATIVE PLUGIN: the app's pages run from capacitor://localhost, so a
// browser WebAuthn call inside the WebView cannot use the relying party
// apex.resonateai.online. Apple's AuthenticationServices can, as long as the
// app carries the Associated Domains entitlement
// "webcredentials:apex.resonateai.online" and the site serves
// /.well-known/apple-app-site-association naming this app. The passkey itself
// is CREATED on the website (invite-login.html); iCloud Keychain makes it
// available here.
//
// Methods exposed to JS (index.html via native-bridge.js):
//   isSupported()               -> { supported } (iOS 16 or newer, no network)
//   signIn({ rpId, challenge }) -> { credential } where challenge is the
//                                  base64url challenge from the options the
//                                  Worker returned (POST /api/passkey-login/start)
//
// The credential is the PublicKeyCredential JSON Stytch's
// POST /v1/webauthn/authenticate expects in public_key_credential (the page
// JSON-stringifies it): id, rawId, type "public-key", response
// { authenticatorData, clientDataJSON, signature, userHandle }, every binary
// value base64url (the Worker asked Stytch for use_base64_url_encoding).
//
// Rejection codes (distinct, read by native-bridge.js):
//   user_cancelled   the person dismissed Apple's sheet
//   no_credentials   no passkey for apex.resonateai.online on this device
//   not_associated   the app's domain association is missing or not verified
//   unsupported_os   older than iOS 16
//   failed           anything else (bad input, a request already running, ...)
//
// NEVER LOGS the challenge or the assertion.
// ---------------------------------------------------------------------------

@objc(ApexPasskeyPlugin)
public class ApexPasskeyPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ApexPasskeyPlugin"
    public let jsName = "ApexPasskey"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise)
    ]

    // ASAuthorizationController does NOT retain its delegate or presentation
    // provider, so both are held here for the life of one request.
    private var controller: ASAuthorizationController?
    private var handler: ApexPasskeyRequestHandler?

    @objc func isSupported(_ call: CAPPluginCall) {
        if #available(iOS 16.0, *) {
            call.resolve(["supported": true])
        } else {
            call.resolve(["supported": false])
        }
    }

    @objc func signIn(_ call: CAPPluginCall) {
        guard #available(iOS 16.0, *) else {
            call.reject("passkeys need iOS 16 or newer", "unsupported_os")
            return
        }
        guard let rpId = call.getString("rpId"), !rpId.isEmpty else {
            call.reject("no relying party id given", "failed")
            return
        }
        guard let challengeB64 = call.getString("challenge"),
              let challenge = ApexPasskeyPlugin.dataFromBase64url(challengeB64), !challenge.isEmpty else {
            call.reject("no usable challenge given", "failed")
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if self.controller != nil {
                call.reject("a passkey request is already running", "failed")
                return
            }
            let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpId)
            let request = provider.createCredentialAssertionRequest(challenge: challenge)
            let controller = ASAuthorizationController(authorizationRequests: [request])
            let handler = ApexPasskeyRequestHandler(call: call, anchor: self.presentationAnchor()) { [weak self] in
                self?.controller = nil
                self?.handler = nil
            }
            controller.delegate = handler
            controller.presentationContextProvider = handler
            self.controller = controller
            self.handler = handler
            handler.startedAt = Date()
            // No passkey on this device for this domain: fail fast instead of
            // offering the "use a phone nearby" QR flow, so the login page can
            // say "ask for a new invite link" right away.
            controller.performRequests(options: .preferImmediatelyAvailableCredentials)
        }
    }

    // The key window of the foreground scene; the bridge's own window as a
    // fallback.
    private func presentationAnchor() -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        for scene in scenes where scene.activationState == .foregroundActive {
            if let key = scene.windows.first(where: { $0.isKeyWindow }) { return key }
        }
        for scene in scenes {
            if let any = scene.windows.first { return any }
        }
        return ASPresentationAnchor()
    }

    static func dataFromBase64url(_ s: String) -> Data? {
        var b = s.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b.count % 4 != 0 { b += "=" }
        return Data(base64Encoded: b)
    }

    static func base64url(_ d: Data) -> String {
        return d.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

// One request's delegate and presentation provider. Resolves or rejects the
// call exactly once, then tells the plugin to drop its references.
class ApexPasskeyRequestHandler: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    private var call: CAPPluginCall?
    private let anchor: ASPresentationAnchor
    private let done: () -> Void
    var startedAt = Date()

    init(call: CAPPluginCall, anchor: ASPresentationAnchor, done: @escaping () -> Void) {
        self.call = call
        self.anchor = anchor
        self.done = done
    }

    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        return anchor
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let call = call else { return }
        self.call = nil
        defer { done() }
        guard let assertion = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion else {
            call.reject("unexpected credential type", "failed")
            return
        }
        let id = ApexPasskeyPlugin.base64url(assertion.credentialID)
        let response: [String: Any] = [
            "authenticatorData": ApexPasskeyPlugin.base64url(assertion.rawAuthenticatorData ?? Data()),
            "clientDataJSON": ApexPasskeyPlugin.base64url(assertion.rawClientDataJSON),
            "signature": ApexPasskeyPlugin.base64url(assertion.signature ?? Data()),
            "userHandle": ApexPasskeyPlugin.base64url(assertion.userID ?? Data())
        ]
        let credential: [String: Any] = [
            "id": id,
            "rawId": id,
            "type": "public-key",
            "authenticatorAttachment": "platform",
            "response": response,
            "clientExtensionResults": [String: Any]()
        ]
        call.resolve(["credential": credential])
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        guard let call = call else { return }
        self.call = nil
        defer { done() }
        call.reject(error.localizedDescription, ApexPasskeyRequestHandler.code(for: error, elapsed: Date().timeIntervalSince(startedAt)))
    }

    // Apple deliberately reports "no passkey here" and "the person cancelled"
    // with overlapping codes. With preferImmediatelyAvailableCredentials an
    // empty keychain answers without ever showing the sheet, so a cancel that
    // arrives faster than a person could tap is treated as no_credentials.
    static func code(for error: Error, elapsed: TimeInterval) -> String {
        let ns = error as NSError
        let text = (ns.localizedDescription + " " + String(describing: ns.userInfo)).lowercased()
        if text.contains("not associated") || text.contains("associated domain") || text.contains("is not associated") {
            return "not_associated"
        }
        if ns.domain == ASAuthorizationError.errorDomain {
            switch ns.code {
            case ASAuthorizationError.Code.notInteractive.rawValue:
                return "no_credentials"
            case ASAuthorizationError.Code.canceled.rawValue:
                if text.contains("no credentials") || elapsed < 1.0 { return "no_credentials" }
                return "user_cancelled"
            default:
                return "failed"
            }
        }
        return "failed"
    }
}
