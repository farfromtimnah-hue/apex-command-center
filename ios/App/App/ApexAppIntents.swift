import Foundation
import AppIntents

// ---------------------------------------------------------------------------
// App Intents — Siri, Spotlight and Apple Intelligence.
//
// WHY THIS FILE EXISTS
// App Intents is how an app is reachable from Siri, Spotlight and Apple
// Intelligence. An app without it is effectively invisible on those surfaces.
//
// An earlier version of this comment said "iOS 27 retires SiriKit" as fact.
// That could NOT be confirmed on any Apple first-party page — it comes from
// third-party blogs. It changes nothing here (Apex was never on SiriKit, so
// there was never a regression to recover from), but do not repeat it.
//
// This is not a Capacitor plugin and there is no npm package for it — App
// Intents is a native framework, so it lives here beside the other Swift.
//
// WHAT AN INTENT CAN AND CANNOT SEE
// An intent runs OUTSIDE the WebView, in a separate process, and may run while
// the app is not open at all. So it cannot read localStorage and it cannot call
// anything in JS. What it can read is the Capacitor Preferences mirror in
// UserDefaults — the same durable copy ApexLockCoverPlugin uses, under the
// "CapacitorStorage." prefix. That is why the token is fetched the way it is
// below rather than through the bridge.
//
// DELIBERATELY READ-ONLY
// Every intent here answers a question. None of them writes, invoices, cancels
// or sends anything. A voice surface is the wrong place for an irreversible
// action, and Siri mishearing a client name should never be able to cost money.
// ---------------------------------------------------------------------------

@available(iOS 16.0, *)
enum ApexIntentAuth {

    // Mirrors @capacitor/preferences: UserDefaults.standard, keys prefixed
    // "CapacitorStorage.". Same constants ApexLockCoverPlugin verified against
    // the package source — if that prefix ever changes, both break together and
    // this comment is the pointer to why.
    private static let prefsPrefix = "CapacitorStorage."
    private static let tokenKey = "apex_client_token"

    static let apiBase = "https://apex-api.farfromtimnah.workers.dev"

    static func token() -> String? {
        let t = UserDefaults.standard.string(forKey: prefsPrefix + tokenKey)
        guard let t = t, !t.isEmpty else { return nil }
        return t
    }

    /// GET against the Worker with the stored session token.
    /// Throws a spoken-friendly error rather than a technical one: the string
    /// here is what Siri reads out loud.
    static func get(_ path: String) async throws -> [String: Any] {
        guard let token = token() else {
            throw ApexIntentError.notSignedIn
        }
        guard let url = URL(string: apiBase + path) else {
            throw ApexIntentError.unavailable
        }
        var req = URLRequest(url: url)
        req.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        req.timeoutInterval = 12   // Siri gives up long before a default 60s

        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse else {
            throw ApexIntentError.unavailable
        }
        // 401 is the token having expired, which is a different user-facing
        // story from the server being down: one means "open the app", the
        // other means "try later".
        if http.statusCode == 401 || http.statusCode == 403 {
            throw ApexIntentError.notSignedIn
        }
        guard http.statusCode == 200 else {
            throw ApexIntentError.unavailable
        }
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw ApexIntentError.unavailable
        }
        return json
    }

    /// Currency for speech. Siri reads "$84,200" better than "84200".
    static func money(_ cents: Int) -> String {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = "USD"
        f.maximumFractionDigits = (cents % 100 == 0) ? 0 : 2
        return f.string(from: NSNumber(value: Double(cents) / 100.0)) ?? "$0"
    }
}

@available(iOS 16.0, *)
enum ApexIntentError: Error, CustomLocalizedStringResourceConvertible {
    case notSignedIn
    case unavailable

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .notSignedIn:
            return "Open Apex and sign in first, then ask me again."
        case .unavailable:
            return "I couldn't reach Apex just now. Try again in a moment."
        }
    }
}

// ---------------------------------------------------------------------------
// "How much is outstanding?"
//
// The one number an owner wants without opening anything. Sums every invoice
// still sitting at status 'sent' — delivered, invoiced, not yet collected.
// ---------------------------------------------------------------------------

@available(iOS 16.0, *)
struct OutstandingInvoicesIntent: AppIntent {
    static var title: LocalizedStringResource = "Check outstanding invoices"
    static var description = IntentDescription(
        "Ask how much has been invoiced and not yet collected.",
        categoryName: "Finance"
    )

    // No app launch: the whole point is an answer without opening anything.
    static var openAppWhenRun: Bool = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        // Task 1.7: answers for WHOEVER is signed in, scoped by their own
        // session's role server-side (/api/me/outstanding-invoices) --
        // Apex's own outstanding invoices for staff, or the signed-in
        // owner's OWN business balance for a client session. Replaces the
        // old direct call to the admin-only /api/finance-new/invoices,
        // which answered the same Apex-wide number for every role.
        let json = try await ApexIntentAuth.get("/api/me/outstanding-invoices")
        let total = (json["outstanding_cents"] as? Int) ?? 0
        let count = (json["invoice_count"] as? Int) ?? 0

        if count == 0 {
            return .result(dialog: "Nothing outstanding. Everything invoiced has been collected.")
        }

        let amount = ApexIntentAuth.money(total)
        let noun = count == 1 ? "invoice" : "invoices"
        return .result(dialog: "\(amount) outstanding across \(count) \(noun).")
    }
}

// ---------------------------------------------------------------------------
// "What's on my calendar today?"
//
// ⚠️ This reads /api/sessions/calendar, which is the same query that used to
// return archived sessions and put deleted test events on a real calendar.
// Whatever that endpoint returns, this speaks — so a filter bug there is
// audible here.
// ---------------------------------------------------------------------------

@available(iOS 16.0, *)
struct TodayScheduleIntent: AppIntent {
    static var title: LocalizedStringResource = "Check today's Apex schedule"
    static var description = IntentDescription(
        "Ask what meetings are booked today.",
        categoryName: "Schedule"
    )

    static var openAppWhenRun: Bool = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        // Task 1.7: /api/me/today-schedule scopes by the caller's own
        // session role server-side -- every session today for staff, or
        // just the signed-in owner's OWN business's gm_events for a client
        // session. Replaces the old direct call to the admin-only
        // /api/sessions/calendar, which returned every client's sessions
        // unscoped regardless of who was asking.
        let json = try await ApexIntentAuth.get("/api/me/today-schedule")
        let rows = (json["sessions"] as? [[String: Any]]) ?? []

        // Belt and braces on the archived-status bug: filter here too rather
        // than trusting the endpoint alone.
        let live = rows.filter { row in
            let s = (row["status"] as? String) ?? ""
            return s != "archived" && s != "cancelled" && s != "discarded"
        }

        if live.isEmpty {
            return .result(dialog: "Nothing booked today.")
        }

        let first = live.first
        let name = (first?["client_name"] as? String) ?? "a meeting"
        let time = (first?["time"] as? String).map { String($0.prefix(5)) }

        if live.count == 1 {
            if let time = time {
                return .result(dialog: "One meeting today: \(name) at \(time).")
            }
            return .result(dialog: "One meeting today: \(name).")
        }

        if let time = time {
            return .result(dialog: "\(live.count) meetings today. First is \(name) at \(time).")
        }
        return .result(dialog: "\(live.count) meetings today, starting with \(name).")
    }
}

@available(iOS 16.0, *)
extension ISO8601DateFormatter {
    /// yyyy-MM-dd in the DEVICE's timezone, not UTC. The API stores UTC, but
    /// "today" for a person standing in Florida is a local day — asking for the
    /// UTC day after 8pm Eastern would return tomorrow's schedule.
    static let apexDay: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withFullDate]
        f.timeZone = TimeZone.current
        return f
    }()
}

// ---------------------------------------------------------------------------
// The phrases Siri listens for.
//
// Every phrase MUST contain ${applicationName} — Apple rejects shortcuts that
// do not, because a bare phrase would collide across apps.
// ---------------------------------------------------------------------------

@available(iOS 16.0, *)
struct ApexShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: OutstandingInvoicesIntent(),
            phrases: [
                "How much is outstanding in \(.applicationName)",
                "What's outstanding in \(.applicationName)",
                "Check \(.applicationName) invoices"
            ],
            shortTitle: "Outstanding invoices",
            systemImageName: "dollarsign.circle"
        )
        AppShortcut(
            intent: TodayScheduleIntent(),
            phrases: [
                "What's on my \(.applicationName) schedule",
                "What's today in \(.applicationName)",
                "Check my \(.applicationName) calendar"
            ],
            shortTitle: "Today's schedule",
            systemImageName: "calendar"
        )
    }
}
