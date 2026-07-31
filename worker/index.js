// Apex Command Center — Cloudflare Worker

var FIREBASE_CERTS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
var CLAUDE_API_URL     = "https://api.anthropic.com/v1/messages";
var CLAUDE_MODEL       = "claude-sonnet-4-6";

var CORS_HEADERS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function jsonOk(data) {
    var headers = Object.assign({}, CORS_HEADERS, { "Content-Type": "application/json" });
    return new Response(JSON.stringify(data), { status: 200, headers: headers });
}

function jsonErr(message, status) {
    var headers = Object.assign({}, CORS_HEADERS, { "Content-Type": "application/json" });
    return new Response(JSON.stringify({ error: message }), { status: status || 400, headers: headers });
}

// ---------------------------------------------------------------------------
// Firebase JWT verification (RS256)
// ---------------------------------------------------------------------------

function base64urlToArrayBuffer(str) {
    var base64 = str.replace(/-/g, "+").replace(/_/g, "/");
    var pad = (4 - base64.length % 4) % 4;
    for (var i = 0; i < pad; i++) { base64 += "="; }
    var binary = atob(base64);
    var buf = new Uint8Array(binary.length);
    for (var j = 0; j < binary.length; j++) { buf[j] = binary.charCodeAt(j); }
    return buf.buffer;
}

function decodeJwtPart(part) {
    return JSON.parse(new TextDecoder().decode(base64urlToArrayBuffer(part)));
}

async function verifyFirebaseToken(token, projectId) {
    var parts = token.split(".");
    if (parts.length !== 3) { throw new Error("Malformed JWT"); }

    var header  = decodeJwtPart(parts[0]);
    var payload = decodeJwtPart(parts[1]);

    var now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < now) { throw new Error("Token expired"); }
    if (payload.iss !== "https://securetoken.google.com/" + projectId) { throw new Error("Invalid issuer"); }
    if (payload.aud !== projectId) { throw new Error("Invalid audience"); }
    if (!payload.sub) { throw new Error("Missing subject"); }

    var keysRes  = await fetch(FIREBASE_CERTS_URL, { cf: { cacheTtl: 3600 } });
    var keysJson = await keysRes.json();

    var jwk = null;
    for (var i = 0; i < keysJson.keys.length; i++) {
        if (keysJson.keys[i].kid === header.kid) { jwk = keysJson.keys[i]; break; }
    }
    if (!jwk) { throw new Error("Signing key not found"); }

    var pubKey = await crypto.subtle.importKey(
        "jwk", jwk,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false, ["verify"]
    );

    var sigBuf  = base64urlToArrayBuffer(parts[2]);
    var dataBuf = new TextEncoder().encode(parts[0] + "." + parts[1]);
    var valid   = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", pubKey, sigBuf, dataBuf);
    if (!valid) { throw new Error("Signature invalid"); }

    return payload;
}

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

// Resolved once per request (the client-role gate in fetch() authenticates
// before the handler does; without the cache every admin request would verify
// the Firebase signature twice).
var AUTH_CACHE = new WeakMap();

async function authenticate(request, env) {
    if (AUTH_CACHE.has(request)) { return AUTH_CACHE.get(request); }
    var user = await authenticateInner(request, env);
    AUTH_CACHE.set(request, user);
    return user;
}

async function authenticateInner(request, env) {
    var auth = request.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) { return null; }
    var token = auth.slice(7);
    // Opaque client-portal tokens (username/password logins) — Firebase JWTs
    // never start with this prefix, so the existing flow is untouched.
    if (token.indexOf("capt_") === 0) {
        return authenticateClientToken(token, env);
    }
    var payload = await verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID);
    var row = await env.DB.prepare("SELECT role, display_name, avatar_url, client_id FROM users WHERE email = ?")
        .bind(payload.email).first();
    if (!row) { return null; }
    return {
        email: payload.email, role: row.role,
        display_name: row.display_name ?? null, avatar_url: row.avatar_url ?? null,
        client_id: row.client_id ?? null,
        // Google-linked client accounts never go through the forced change
        must_change_password: false,
        auth_method: "google"
    };
}

async function sha256Hex(str) {
    var buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    var bytes = new Uint8Array(buf);
    var out = "";
    for (var i = 0; i < bytes.length; i++) { out += bytes[i].toString(16).padStart(2, "0"); }
    return out;
}

async function authenticateClientToken(token, env) {
    var tokenHash = await sha256Hex(token);
    var row = await env.DB.prepare(
        "SELECT t.client_id, t.username, t.expires_at, l.must_change_password, c.name AS client_name " +
        "FROM client_auth_tokens t " +
        "JOIN client_logins l ON l.client_id = t.client_id " +
        "LEFT JOIN clients c ON c.id = t.client_id " +
        "WHERE t.token_hash = ?"
    ).bind(tokenHash).first();
    if (!row) { return null; }
    if (!row.expires_at || row.expires_at <= new Date().toISOString()) { return null; }
    return {
        email: null, role: "client",
        display_name: row.client_name || row.username, avatar_url: null,
        client_id: row.client_id, username: row.username,
        must_change_password: !!row.must_change_password,
        auth_method: "password", token_hash: tokenHash
    };
}

// Admin roles pass for any client; a client-role user only for their own.
// Developer preview-as (?previewAs=<client_id>, LTC's getSelfSubmission
// pattern) needs no extra branch here: the developer role already passes for
// reads, and every preview WRITE is rejected earlier by the read-only gate in
// fetch() (see "Developer preview-as is READ-ONLY").
function requireClientAccess(user, clientId) {
    if (!user) { return false; }
    if (user.role === "alice" || user.role === "rafa" || user.role === "developer") { return true; }
    return user.role === "client" && !!user.client_id && user.client_id === clientId;
}

// The preview client id when (and only when) the caller is a developer with a
// ?previewAs= query param. Null for every other caller — alice, rafa, and the
// real client path never see a different identity.
function devPreviewClientId(user, request) {
    if (!user || user.role !== "developer") { return null; }
    var pa = new URL(request.url).searchParams.get("previewAs");
    return pa || null;
}

function isAdminRole(user) {
    return !!user && (user.role === "alice" || user.role === "rafa" || user.role === "developer");
}

// ---------------------------------------------------------------------------
// LEAD PIPELINE (Apex's own sales pipeline over clients.status = 'lead')
//
// DATA TIER NOTE: unrelated to gm_leads (the CLIENT's own customers, one tier
// below). Same word, different tier — never join or conflate them.
//
// The ladder is fixed and never configurable. Terminal outcomes are NOT stages:
// they change clients.status instead ('active' with a package, or 'lead_dormant')
// and the record leaves the Leads tab, so lead_stage stops applying.
// ---------------------------------------------------------------------------

var LEAD_STAGES = ["Lead", "Contato inicial", "Raio X enviado", "Raio X recebido", "Agendamento"];

// ---------------------------------------------------------------------------
// CLIENT SOURCE — where a client came from, kept for their whole lifecycle.
//
// Set on the lead and carried through conversion untouched: a client who came
// from a partner in January is still a partner referral after they convert.
// NULL is a valid, meaningful value — genuinely unknown, never a guess.
//
// A CONSTRAINED set, not free text, because this is what future source-
// attribution metrics group by (share of clients per source, conversion rate
// per source, which partners actually convert). Kept short on purpose; the
// specifics go in the free-text source_detail alongside it.
//
// 'partner' is the one type that does NOT use source_detail: it pairs with
// clients.referred_by_partner_id, which stays authoritative, and the partner's
// name is resolved by join against apex_partners at read time. Attribution is
// by record, never by matching a typed name — the same rule the gm_leads
// partner field and the Apex Partner tab already follow.
// ---------------------------------------------------------------------------

var CLIENT_SOURCE_TYPES = [
    "partner",          // an Apex referral partner (apex_partners row)
    "referral_client",  // an existing client sent them; name goes in detail
    "direct",           // Rafa/Alice already knew them, or they reached out
    "event",            // met at an event: Apex Club, a talk, a trade show
    "social",           // Instagram, LinkedIn, YouTube, an ad
    "other"             // fits nowhere above; detail explains
];

// Contact-log vocabularies. Both lists are FINAL — do not extend either.
var LEAD_CONTACT_METHODS = ["WhatsApp", "Phone call", "Email", "In person", "Text message"];
var LEAD_CONTACT_RESULTS = ["No response", "Answered", "Left voicemail", "Rescheduled", "Not interested"];

function leadStageIndex(stage) {
    var i = LEAD_STAGES.indexOf(stage || "Lead");
    return i < 0 ? 0 : i;
}

// The display name to record as the actor for a server-side write, following
// the convention set by client_assessments.activated_by, lead_contact_log
// .logged_by, resources.created_by and clients.next_step_set_by: the human's
// DISPLAY NAME, never a user id, always derived from the authenticated user
// rather than from anything in the request body.
function actorName(user) {
    if (!user) { return null; }
    return user.display_name || user.role || null;
}

// Auto-advance a lead's stage as a side effect of a real action elsewhere
// (first contact logged, X-Ray assigned/submitted, session scheduled).
//
// Deliberately FORWARD-ONLY and non-throwing:
//   - forward-only, so re-running an action (a second session, a re-submitted
//     X-Ray) can never drag a lead backwards down the ladder;
//   - only touches status='lead' rows, so scheduling a session for a real
//     active client is a no-op;
//   - never throws, because it is a side effect of the caller's real work —
//     a stage bump must not fail an X-Ray submission or a calendar booking.
//
// ATTRIBUTION: `actor` is the display name of the person whose action
// triggered this bump, and `source` is the machine token naming that action
// ('auto:session_scheduled' and friends — see migrations/
// lead_pipeline_actor_attribution.sql). Every call site has an authenticated
// user in hand, so both are always passable; the parameters stay optional only
// so a future caller without a user degrades to NULL rather than throwing.
//
// The pair records that a HUMAN's deliberate action moved the lead while the
// stage change itself was automatic — the exact distinction whose absence made
// one such move impossible to attribute after the fact.
async function advanceLeadStage(env, clientId, targetStage, actor, source) {
    if (!clientId) { return; }
    try {
        var row = await env.DB.prepare(
            "SELECT status, lead_stage FROM clients WHERE id = ?"
        ).bind(clientId).first();
        if (!row || (row.status || "") !== "lead") { return; }
        if (leadStageIndex(row.lead_stage) >= leadStageIndex(targetStage)) { return; }
        // The early return above is what keeps stage_changed_at honest: this
        // line is only ever reached when the stage genuinely moves, so the
        // "days in stage" clock never resets on a re-run of the same action.
        //
        // It is what keeps the ATTRIBUTION honest too, and for the same
        // reason: the three columns describe the last REAL change together, so
        // a no-op re-run must not overwrite them with today's actor. A second
        // session booked by Rafa on a lead already at "Agendamento" leaves
        // Alice's name on the move that actually happened.
        await env.DB.prepare(
            "UPDATE clients SET lead_stage = ?, stage_changed_at = datetime('now'), " +
            "stage_changed_by = ?, stage_change_source = ? WHERE id = ?"
        ).bind(targetStage, actor || null, source || null, clientId).run();
    } catch (e) {
        // Swallow: never let a stage bump break the action that triggered it.
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/role
// ---------------------------------------------------------------------------

async function handleGetRole(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        return jsonOk({
            role: user.role, email: user.email, display_name: user.display_name, avatar_url: user.avatar_url,
            client_id: user.client_id || null,
            must_change_password: !!user.must_change_password,
            auth_method: user.auth_method || "google"
        });
    } catch (e) {
        return jsonErr("Auth failed: " + e.message, 401);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/sessions/inbox
// Returns all sessions with status = 'inbox', newest first. Alice/developer only.
// ---------------------------------------------------------------------------

async function handleGetSessionsInbox(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var res = await env.DB.prepare(
            "SELECT id, client_name, client_id, date, status, raw_transcript, created_at " +
            "FROM sessions WHERE status = 'inbox' ORDER BY created_at DESC"
        ).all();

        return jsonOk({ sessions: res.results });
    } catch (e) {
        return jsonErr("Error fetching inbox: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/sessions/:id/discard
// Soft-deletes an inbox session by setting status to 'discarded'.
// ---------------------------------------------------------------------------

async function handlePostSessionDiscard(sessionId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var session = await env.DB.prepare("SELECT id FROM sessions WHERE id = ?")
            .bind(sessionId).first();
        if (!session) { return jsonErr("Session not found", 404); }

        await env.DB.prepare("UPDATE sessions SET status = 'discarded' WHERE id = ?")
            .bind(sessionId).run();

        return jsonOk({ ok: true, session_id: sessionId, status: "discarded" });
    } catch (e) {
        return jsonErr("Error discarding session: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/sessions/:id/assign-client
// Body: { client_id: string }
// Assigns a client to an inbox session before summarizing.
// ---------------------------------------------------------------------------

async function handlePostSessionAssignClient(sessionId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var body = await request.json();
        if (!body.client_id) { return jsonErr("client_id is required", 400); }

        var client = await env.DB.prepare("SELECT id, name FROM clients WHERE id = ?")
            .bind(body.client_id).first();
        if (!client) { return jsonErr("Client not found", 404); }

        await env.DB.prepare(
            "UPDATE sessions SET client_id = ?, client_name = ?, status = 'pending' WHERE id = ? AND status = 'inbox'"
        ).bind(body.client_id, client.name, sessionId).run();

        return jsonOk({ ok: true, client_id: body.client_id, client_name: client.name });
    } catch (e) {
        return jsonErr("Error assigning client: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/fireflies/webhook
// No Firebase auth — called directly by Fireflies.
// Verifies HMAC-SHA256 of the raw body against X-Hub-Signature using FIREFLIES_WEBHOOK_SECRET.
// ---------------------------------------------------------------------------

// Call the Fireflies GraphQL API using the FIREFLIES_API_KEY worker secret.
async function firefliesGraphQL(env, query, variables) {
    var apiKey = (env.FIREFLIES_API_KEY || "").trim();
    if (!apiKey) { throw new Error("FIREFLIES_API_KEY secret is not set"); }
    var res = await fetch("https://api.fireflies.ai/graphql", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + apiKey
        },
        body: JSON.stringify({ query: query, variables: variables || {} })
    });
    var body = await res.json().catch(function() { return null; });
    if (!res.ok || !body || body.errors) {
        var msg = body && body.errors ? body.errors.map(function(e){ return e.message; }).join("; ")
                                      : "HTTP " + res.status;
        throw new Error("Fireflies API error: " + msg);
    }
    return body.data;
}

// Fetch one transcript by ID and flatten it to the fields the sessions table needs.
async function fetchFirefliesTranscript(env, transcriptId) {
    var data = await firefliesGraphQL(env,
        "query Transcript($id: String!) { transcript(id: $id) { " +
        "id title date duration organizer_email meeting_link " +
        "sentences { speaker_name text } " +
        "summary { overview action_items } } }",
        { id: transcriptId }
    );
    var t = data && data.transcript;
    if (!t) { return null; }

    var text = "";
    if (Array.isArray(t.sentences)) {
        text = t.sentences.map(function(s) {
            return (s.speaker_name ? s.speaker_name + ": " : "") + (s.text || "");
        }).join("\n");
    }
    if (!text && t.summary && t.summary.overview) { text = t.summary.overview; }

    return {
        id: t.id,
        title: t.title || "Fireflies Meeting",
        date: t.date || null,           // epoch milliseconds
        duration: t.duration || null,   // minutes
        organizer_email: t.organizer_email || null,
        meeting_link: t.meeting_link || null,
        transcript_text: text,
        // Diagnostic only -- real incident 2026-07-23: every single manual
        // pull failed with "no content yet" across a real multi-day backlog
        // (not just the newest meeting), which the generic error message
        // couldn't distinguish from a real per-meeting processing delay.
        _debug_sentences_count: Array.isArray(t.sentences) ? t.sentences.length : null,
        _debug_has_summary: !!(t.summary && t.summary.overview)
    };
}

// Ad-hoc Meet calls with no named calendar event come back from Fireflies
// with a title that's either the raw Meet URL or just its code fragment
// (e.g. "khn-tuwk-dye") -- both unusable for display. Detects that shape.
function isUglyFirefliesTitle(title) {
    if (!title) { return true; }
    var t = String(title).trim();
    if (/meet\.google\.com/i.test(t)) { return true; }
    if (/^[a-z]{3,4}-[a-z]{3,4}-[a-z]{3,4}$/i.test(t)) { return true; }
    return false;
}

// Tries to find a better title for a Fireflies transcript by matching it
// against a real calendar event: first Apex-created sessions already in D1
// (matched by google_event_id), then a live lookup of Rafa's Google Calendar
// for events outside Apex's own tracking (matched by time-window overlap,
// and Meet link when available). Returns the matched title, or null.
async function findCalendarTitleForFireflies(env, meta) {
    if (!meta.date) { return null; }
    var startMs = Number(meta.date);
    if (isNaN(startMs)) { return null; }
    var durationMs = (meta.duration ? Number(meta.duration) : 30) * 60000;
    var endMs = startMs + durationMs;
    // 10-minute tolerance on each side to absorb clock drift / late starts.
    var windowStart = startMs - 10 * 60000;
    var windowEnd   = endMs   + 10 * 60000;

    // 1) Apex-created sessions already in D1, same day, overlapping time.
    var dayStr = firefliesDateToYMD(meta.date);
    var dayRows = await env.DB.prepare(
        "SELECT client_name, time, google_meet_link FROM sessions " +
        "WHERE date = ? AND client_name IS NOT NULL AND client_name != '' AND status != 'discarded' AND status != 'cancelled'"
    ).bind(dayStr).all();

    for (var i = 0; i < dayRows.results.length; i++) {
        var row = dayRows.results[i];
        if (isUglyFirefliesTitle(row.client_name)) { continue; }
        if (meta.meeting_link && row.google_meet_link && row.google_meet_link === meta.meeting_link) {
            return row.client_name;
        }
        if (row.time) {
            var rowStartMs = new Date(dayStr + "T" + row.time.slice(0,5) + ":00").getTime();
            if (!isNaN(rowStartMs) && rowStartMs >= windowStart && rowStartMs <= windowEnd) {
                return row.client_name;
            }
        }
    }

    // 2) Live Google Calendar lookup for named events Apex never created.
    try {
        var items = await listGoogleCalendarEvents(
            env,
            new Date(windowStart).toISOString(),
            new Date(windowEnd).toISOString()
        );
        for (var j = 0; j < items.length; j++) {
            var ev = items[j];
            if (!ev.summary || ev.status === "cancelled") { continue; }
            var evStart = ev.start && ev.start.dateTime;
            if (!evStart) { continue; }
            var evStartMs = new Date(evStart).getTime();
            if (isNaN(evStartMs)) { continue; }

            var evMeetLink = extractGoogleEventMeetLink(ev);
            if (meta.meeting_link && evMeetLink && evMeetLink === meta.meeting_link) {
                return ev.summary;
            }
            if (evStartMs >= windowStart && evStartMs <= windowEnd) {
                return ev.summary;
            }
        }
    } catch (e) {
        // Google not connected, or the call failed -- fall back to no match.
        // Never let this block ingestion of the transcript itself.
    }

    return null;
}

function firefliesDateToYMD(dateVal) {
    var etFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
    var dateStr = etFormatter.format(new Date());
    if (dateVal !== null && dateVal !== undefined && dateVal !== "") {
        try {
            var n = typeof dateVal === "number" ? dateVal : Number(dateVal);
            // Fireflies returns epoch ms; also accept epoch seconds and ISO strings
            var d = isNaN(n) ? new Date(dateVal) : new Date(n < 1e12 ? n * 1000 : n);
            if (!isNaN(d.getTime())) { dateStr = etFormatter.format(d); }
        } catch(e) { /* use today */ }
    }
    return dateStr;
}

// Insert a Fireflies transcript into the sessions inbox (deduped by fireflies_id).
// Returns { session_id, duplicate }.
async function ingestFirefliesTranscript(env, meta) {
    var existing = await env.DB.prepare(
        "SELECT id FROM sessions WHERE task_completions LIKE ? LIMIT 1"
    ).bind('%"fireflies_id":"' + meta.id + '"%').first();
    if (existing) { return { session_id: existing.id, duplicate: true }; }

    var displayTitle = meta.title;
    if (isUglyFirefliesTitle(displayTitle)) {
        var matchedTitle = await findCalendarTitleForFireflies(env, meta);
        if (matchedTitle) { displayTitle = matchedTitle; }
    }

    var sessionId = crypto.randomUUID();
    var fireflyMeta = JSON.stringify({ fireflies_id: meta.id });
    await env.DB.prepare(
        // created_by 'fireflies', not a person: this row is created by the
        // transcript-ingestion machine, and naming it honestly is the point.
        "INSERT INTO sessions (id, client_name, date, status, raw_transcript, task_completions, created_at, created_by) " +
        "VALUES (?, ?, ?, 'inbox', ?, ?, datetime('now'), 'fireflies')"
    ).bind(sessionId, displayTitle, firefliesDateToYMD(meta.date), meta.transcript_text, fireflyMeta).run();
    return { session_id: sessionId, duplicate: false };
}

async function handleFirefliesWebhook(request, env) {
    try {
        var rawBody = await request.text();

        // HMAC verification against Fireflies' X-Hub-Signature header (sha256=<hex>).
        var secret = (env.FIREFLIES_WEBHOOK_SECRET || "").trim();
        if (!secret) {
            console.log("Fireflies webhook rejected: FIREFLIES_WEBHOOK_SECRET not set");
            return jsonErr("Webhook secret not configured", 401);
        }
        var sigHeader = request.headers.get("X-Hub-Signature") || "";
        var key = await crypto.subtle.importKey(
            "raw",
            new TextEncoder().encode(secret),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"]
        );
        var sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
        var sigHex = "sha256=" + Array.from(new Uint8Array(sig))
            .map(function(b) { return b.toString(16).padStart(2, "0"); }).join("");
        if (sigHex !== sigHeader) {
            console.log("Fireflies webhook signature mismatch — expected " + sigHex + " got " + sigHeader);
            return jsonErr("Signature mismatch", 401);
        }

        var payload;
        try { payload = JSON.parse(rawBody); } catch(e) { return jsonErr("Invalid JSON", 400); }

        console.log("Fireflies webhook raw payload: " + JSON.stringify(payload));

        // Fireflies "Transcription completed" webhooks carry only
        // { meetingId, eventType, clientReferenceId } — never the transcript itself.
        // V2 (Developer Settings) payloads use snake_case meeting_id and event: "meeting.transcribed" instead.
        var meetingId  = payload.meetingId || payload.meeting_id || payload.id || null;
        var eventType  = payload.eventType || payload.event || "";
        if (!meetingId) {
            console.log("Fireflies webhook: no meetingId in payload — skipped. Payload keys: " + Object.keys(payload).join(","));
            return jsonOk({ ok: true, note: "No meetingId — skipped" });
        }
        var eventTypeLower = eventType.toLowerCase();
        if (eventType && eventTypeLower.indexOf("transcription") === -1 && eventTypeLower.indexOf("transcribed") === -1) {
            console.log("Fireflies webhook: ignoring eventType '" + eventType + "' for " + meetingId);
            return jsonOk({ ok: true, note: "Ignored eventType: " + eventType });
        }

        var meta;
        var inlineTranscript = payload.transcript || payload.summary || null;
        if (inlineTranscript) {
            // Back-compat / test path: payload carried the transcript inline
            meta = {
                id: meetingId,
                title: payload.title || payload.meeting_title || "Fireflies Meeting",
                date: payload.date || payload.start_time || null,
                transcript_text: inlineTranscript
            };
        } else {
            console.log("Fireflies webhook: fetching transcript " + meetingId + " from Fireflies API");
            meta = await fetchFirefliesTranscript(env, meetingId);
            if (!meta) {
                console.log("Fireflies webhook: transcript " + meetingId + " not found via API");
                return jsonErr("Transcript not found in Fireflies: " + meetingId, 404);
            }
            if (!meta.transcript_text) {
                console.log("Fireflies webhook: transcript " + meetingId + " has no sentences yet");
                return jsonErr("Transcript " + meetingId + " has no content yet", 422);
            }
        }

        var result = await ingestFirefliesTranscript(env, meta);
        console.log("Fireflies webhook: " + (result.duplicate ? "duplicate" : "ingested") +
                    " meeting " + meetingId + " -> session " + result.session_id);
        return jsonOk({ ok: true, session_id: result.session_id, duplicate: result.duplicate });
    } catch (e) {
        console.log("Fireflies webhook error: " + e.message);
        return jsonErr("Webhook error: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/fireflies/transcripts
// Lists the API-key owner's recent Fireflies transcripts (manual-pull picker).
// ---------------------------------------------------------------------------

async function handleGetFirefliesTranscripts(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }

        // Bumped from 15 -- real incident 2026-07-23: Fireflies kept
        // recording during a storage-cap outage (see #5 in the 07-18/19
        // session summary), so more than 15 meetings can realistically be
        // sitting unpulled when the account gets upgraded and this list is
        // checked again.
        var data = await firefliesGraphQL(env,
            "query Transcripts($limit: Int) { transcripts(limit: $limit) { " +
            "id title date duration organizer_email } }",
            { limit: 50 }
        );

        var dismissedRows = await env.DB.prepare(
            "SELECT transcript_id FROM fireflies_dismissed_transcripts"
        ).all();
        var dismissed = {};
        for (var d = 0; d < dismissedRows.results.length; d++) {
            dismissed[dismissedRows.results[d].transcript_id] = true;
        }

        // Flag which transcripts are already imported (fireflies_id stored
        // inside sessions.task_completions, see ingestFirefliesTranscript)
        // so the manual-pull picker can show this BEFORE a click, not only
        // after -- real gap found 2026-07-23: Nicole couldn't tell what was
        // safe to pull without importing everything and reading each
        // button's after-the-fact "Already imported" result.
        var importedRows = await env.DB.prepare(
            "SELECT task_completions FROM sessions WHERE task_completions LIKE '%fireflies_id%'"
        ).all();
        var imported = {};
        for (var ir = 0; ir < importedRows.results.length; ir++) {
            try {
                var tc = JSON.parse(importedRows.results[ir].task_completions);
                if (tc && tc.fireflies_id) { imported[tc.fireflies_id] = true; }
            } catch (pe) { /* ignore malformed rows */ }
        }

        var list = (data && data.transcripts || [])
            .filter(function(t) { return !dismissed[t.id]; })
            .map(function(t) {
                return {
                    id: t.id,
                    title: t.title || "Untitled meeting",
                    date: firefliesDateToYMD(t.date),
                    duration_min: t.duration ? Math.round(t.duration) : null,
                    organizer_email: t.organizer_email || null,
                    already_imported: !!imported[t.id]
                };
            });
        return jsonOk({ transcripts: list });
    } catch (e) {
        return jsonErr("Error listing Fireflies transcripts: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/fireflies/dismiss
// Body: { transcript_id }. Hides a transcript from future
// GET /api/fireflies/transcripts results. Does not touch Fireflies' own
// data or delete anything already imported into D1 -- purely a local filter.
// ---------------------------------------------------------------------------

async function handlePostFirefliesDismiss(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }

        var body = await request.json().catch(function() { return null; });
        var transcriptId = body && (body.transcript_id || body.id);
        if (!transcriptId) { return jsonErr("Missing transcript_id", 400); }

        await env.DB.prepare(
            "INSERT OR IGNORE INTO fireflies_dismissed_transcripts (transcript_id, dismissed_by) VALUES (?, ?)"
        ).bind(transcriptId, user.email).run();

        return jsonOk({ ok: true, transcript_id: transcriptId });
    } catch (e) {
        return jsonErr("Error dismissing transcript: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/fireflies/pull
// Body: { transcript_id }. Fetches the transcript from the Fireflies API and
// ingests it into the sessions inbox — same pipeline as the webhook.
// ---------------------------------------------------------------------------

async function handlePostFirefliesPull(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }

        var body = await request.json().catch(function() { return null; });
        var transcriptId = body && (body.transcript_id || body.id);
        if (!transcriptId) { return jsonErr("Missing transcript_id", 400); }

        var meta = await fetchFirefliesTranscript(env, transcriptId);
        if (!meta) { return jsonErr("Transcript not found in Fireflies: " + transcriptId, 404); }
        if (!meta.transcript_text) {
            return jsonErr("Transcript has no content yet (sentences: " + meta._debug_sentences_count +
                ", has_summary: " + meta._debug_has_summary + ") — Fireflies may still be processing it, " +
                "or check the Fireflies account/plan state directly if this happens on an older meeting too", 422);
        }

        var result = await ingestFirefliesTranscript(env, meta);
        return jsonOk({
            ok: true,
            session_id: result.session_id,
            duplicate: result.duplicate,
            title: meta.title,
            date: firefliesDateToYMD(meta.date)
        });
    } catch (e) {
        return jsonErr("Error pulling Fireflies transcript: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/sessions
// ---------------------------------------------------------------------------

async function handleGetSessions(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }

        var url = new URL(request.url);
        var clientIdFilter = url.searchParams.get("client_id");

        var stmt;
        if (clientIdFilter) {
            // Cancelled sessions ARE returned here (unlike the unfiltered
            // list): a client's own history must show that a meeting was
            // booked and cancelled -- that is the whole point of keeping the
            // status='cancelled' row instead of hard-deleting it. Calendar
            // views and active lists still exclude them.
            stmt = env.DB.prepare(
                "SELECT id, client_name, client_id, date, status, summary_json, pdf_data, task_completions, approved_at, created_at, " +
                "raw_transcript IS NOT NULL as has_transcript " +
                "FROM sessions WHERE status != 'archived' AND meeting_category != 'event' AND client_id = ? ORDER BY created_at DESC"
            ).bind(clientIdFilter);
        } else {
            stmt = env.DB.prepare(
                "SELECT id, client_name, client_id, date, status, summary_json, pdf_data, task_completions, approved_at, created_at, " +
                "raw_transcript IS NOT NULL as has_transcript " +
                // Event entries (conferences, Apex Club) are not client
                // sessions -- keep them out of the summarize/transcript list.
                "FROM sessions WHERE status != 'archived' AND status != 'cancelled' AND meeting_category != 'event' ORDER BY created_at DESC"
            );
        }

        var res = await stmt.all();
        return jsonOk({ sessions: res.results });
    } catch (e) {
        return jsonErr("Error fetching sessions: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/sessions/:id/transcript
// Returns just the raw_transcript text for one session (kept off the list
// endpoint since transcripts can run tens of thousands of characters).
// ---------------------------------------------------------------------------

async function handleGetSessionTranscript(sessionId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }

        var row = await env.DB.prepare(
            "SELECT raw_transcript FROM sessions WHERE id = ?"
        ).bind(sessionId).first();
        if (!row) { return jsonErr("Session not found", 404); }

        return jsonOk({ raw_transcript: row.raw_transcript || null });
    } catch (e) {
        return jsonErr("Error fetching transcript: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: PATCH /api/sessions/:id/task-completions
// Body: { completions: object }  — e.g. { "rafa_0": true, "client_1": false }
// Merges the incoming completions object into the existing task_completions JSON for this session.
// ---------------------------------------------------------------------------

async function handlePatchSessionTaskCompletions(sessionId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }

        var body = await request.json();
        if (!body || typeof body.completions !== "object") {
            return jsonErr("Missing completions object", 400);
        }

        // Load existing completions
        var row = await env.DB.prepare(
            "SELECT task_completions FROM sessions WHERE id = ?"
        ).bind(sessionId).first();
        if (!row) { return jsonErr("Session not found", 404); }

        var existing = {};
        if (row.task_completions) {
            try { existing = JSON.parse(row.task_completions); } catch(e) { existing = {}; }
        }

        // Merge incoming keys
        var keys = Object.keys(body.completions);
        for (var i = 0; i < keys.length; i++) {
            existing[keys[i]] = body.completions[keys[i]];
        }

        await env.DB.prepare(
            "UPDATE sessions SET task_completions = ? WHERE id = ?"
        ).bind(JSON.stringify(existing), sessionId).run();

        return jsonOk({ ok: true });
    } catch (e) {
        return jsonErr("Error updating task completions: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Strategic-report section configuration
// sessions.section_config (JSON, nullable). Null = default config below.
// Cover and Executive Summary are mandatory and never appear in this config.
// ---------------------------------------------------------------------------

var STANDARD_SECTION_KEYS = [
    "business_diagnosis", "recommendations", "client_actions",
    "consultant_followups", "next_session_focus", "swot",
    "swot_synthesis", "thirty_day_plan", "thirty_day_goals"
];

function defaultSectionConfig() {
    var sections = [];
    for (var i = 0; i < STANDARD_SECTION_KEYS.length; i++) {
        sections.push({ key: STANDARD_SECTION_KEYS[i], enabled: true, order: i + 1 });
    }
    return { sections: sections, custom_sections: [] };
}

function parseSectionConfig(raw) {
    if (!raw) { return defaultSectionConfig(); }
    try {
        var cfg = JSON.parse(raw);
        if (!cfg || !Array.isArray(cfg.sections)) { return defaultSectionConfig(); }
        if (!Array.isArray(cfg.custom_sections)) { cfg.custom_sections = []; }
        return cfg;
    } catch (e) {
        return defaultSectionConfig();
    }
}

// Ordered array of section keys to render (enabled standard keys + enabled
// custom section ids, sorted by order). The template reads this as the one
// source of truth for what pages to build and in what order.
function computeActiveSections(cfg) {
    var entries = [];
    var i;
    for (i = 0; i < cfg.sections.length; i++) {
        if (cfg.sections[i].enabled) {
            entries.push({ key: cfg.sections[i].key, order: cfg.sections[i].order });
        }
    }
    for (i = 0; i < cfg.custom_sections.length; i++) {
        if (cfg.custom_sections[i].enabled) {
            entries.push({ key: cfg.custom_sections[i].id, order: cfg.custom_sections[i].order });
        }
    }
    entries.sort(function (a, b) { return a.order - b.order; });
    return entries.map(function (e) { return e.key; });
}

// Enabled custom sections as [{id, title, body, bullets}] (PT), pulling content
// from summary_json.custom_section_content keyed by custom section id.
function computeCustomSectionsForPdf(cfg, customContent) {
    var out = [];
    for (var i = 0; i < cfg.custom_sections.length; i++) {
        var cs = cfg.custom_sections[i];
        if (!cs.enabled) { continue; }
        var content = customContent && customContent[cs.id] ? customContent[cs.id] : null;
        var pt = content && content.pt ? content.pt : null;
        out.push({
            id:      cs.id,
            title:   (pt && pt.title)  ? pt.title  : (cs.title_pt || ""),
            body:    (pt && pt.body)   ? pt.body   : "",
            bullets: (pt && Array.isArray(pt.bullets)) ? pt.bullets : []
        });
    }
    return out;
}

// Recompute active_sections + custom_sections inside a pdf_data object from the
// current section_config, so config changes made after summarize reach the
// template (which renders straight from sessions.pdf_data).
function applySectionConfigToPdfData(pdfData, cfg, customContent) {
    pdfData.active_sections = computeActiveSections(cfg);
    pdfData.custom_sections = computeCustomSectionsForPdf(cfg, customContent);
    return pdfData;
}

// ---------------------------------------------------------------------------
// Route: GET /api/sessions/:id/section-config
// Returns the stored config, or the default all-enabled config if null.
// ---------------------------------------------------------------------------

async function handleGetSessionSectionConfig(sessionId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }

        var row = await env.DB.prepare(
            "SELECT section_config FROM sessions WHERE id = ?"
        ).bind(sessionId).first();
        if (!row) { return jsonErr("Session not found", 404); }

        return jsonOk({ section_config: parseSectionConfig(row.section_config) });
    } catch (e) {
        return jsonErr("Error fetching section config: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/sessions/:id/pdf-data
// Returns the session's current, live pdf_data -- used by "Gerar PDF" to
// read fresh data at generate-time instead of trusting an in-memory session
// object that may have been loaded before a section-config edit. Real bug
// (2026-07-23): Pra. Alice unchecked a report section right before
// generating, but the PDF still included it -- root cause was
// handleGeneratePdf (sessions.html) reading session.pdf_data off a session
// object captured in a closure when the page's action buttons were first
// rendered, never refreshed after a later section-config save even though
// the server-side pdf_data was already correctly updated by then.
// ---------------------------------------------------------------------------

async function handleGetSessionPdfData(sessionId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }

        var row = await env.DB.prepare(
            "SELECT pdf_data, summary_json FROM sessions WHERE id = ?"
        ).bind(sessionId).first();
        if (!row) { return jsonErr("Session not found", 404); }

        var pdfData = row.pdf_data;
        if (!pdfData && row.summary_json) {
            try {
                var summary = JSON.parse(row.summary_json);
                pdfData = summary && summary.pdf_data ? JSON.stringify(summary.pdf_data) : null;
            } catch (e) { pdfData = null; }
        }

        return jsonOk({ pdf_data: pdfData ? JSON.parse(pdfData) : null });
    } catch (e) {
        return jsonErr("Error fetching pdf data: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: PUT /api/sessions/:id/section-config
// Body: { section_config: { sections: [...], custom_sections: [...] } }
// Also refreshes active_sections/custom_sections inside any existing pdf_data
// so the report template picks up the change without re-running the AI.
// ---------------------------------------------------------------------------

async function handlePutSessionSectionConfig(sessionId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var body = await request.json();
        var cfg = body && body.section_config ? body.section_config : null;
        if (!cfg || !Array.isArray(cfg.sections)) {
            return jsonErr("section_config with a sections array is required", 400);
        }
        if (!Array.isArray(cfg.custom_sections)) { cfg.custom_sections = []; }

        var i;
        for (i = 0; i < cfg.sections.length; i++) {
            var s = cfg.sections[i];
            if (!s || typeof s.key !== "string" || !s.key) { return jsonErr("Each section needs a key", 400); }
            if (typeof s.enabled !== "boolean")            { return jsonErr("Section '" + s.key + "': enabled must be a boolean", 400); }
            if (typeof s.order !== "number")               { return jsonErr("Section '" + s.key + "': order must be a number", 400); }
        }
        for (i = 0; i < cfg.custom_sections.length; i++) {
            var cs = cfg.custom_sections[i];
            if (!cs || typeof cs.id !== "string" || !cs.id)                    { return jsonErr("Each custom section needs an id", 400); }
            if (typeof cs.title_pt !== "string" || !cs.title_pt.trim())        { return jsonErr("Custom section '" + cs.id + "': title_pt is required", 400); }
            if (typeof cs.description !== "string" || !cs.description.trim()) { return jsonErr("Custom section '" + cs.id + "': description is required", 400); }
            if (typeof cs.enabled !== "boolean")                               { return jsonErr("Custom section '" + cs.id + "': enabled must be a boolean", 400); }
            if (typeof cs.order !== "number")                                  { return jsonErr("Custom section '" + cs.id + "': order must be a number", 400); }
        }

        var session = await env.DB.prepare(
            "SELECT pdf_data, summary_json FROM sessions WHERE id = ?"
        ).bind(sessionId).first();
        if (!session) { return jsonErr("Session not found", 404); }

        // Refresh the rendered-section keys inside existing pdf_data, if any.
        // pdf_data is the single source of truth the report template renders
        // from, so if it exists it MUST stay in sync with section_config here —
        // a parse failure is surfaced as an error rather than silently leaving
        // pdf_data.active_sections stale (this was the root cause of unchecked
        // sections still appearing in the PDF).
        var newPdfDataStr = null;
        if (session.pdf_data) {
            var pdfData = JSON.parse(session.pdf_data);
            var customContent = null;
            try {
                var summary = session.summary_json ? JSON.parse(session.summary_json) : null;
                customContent = summary ? summary.custom_section_content : null;
            } catch (se) { customContent = null; }
            applySectionConfigToPdfData(pdfData, cfg, customContent);
            newPdfDataStr = JSON.stringify(pdfData);
        }

        if (newPdfDataStr) {
            await env.DB.prepare(
                "UPDATE sessions SET section_config = ?, pdf_data = ? WHERE id = ?"
            ).bind(JSON.stringify(cfg), newPdfDataStr, sessionId).run();
            var cfgDocId = crypto.randomUUID();
            await env.DB.prepare(
                "INSERT INTO documents (id, session_id, pdf_data) VALUES (?, ?, ?) " +
                "ON CONFLICT(session_id) DO UPDATE SET pdf_data = excluded.pdf_data"
            ).bind(cfgDocId, sessionId, newPdfDataStr).run();
        } else {
            await env.DB.prepare(
                "UPDATE sessions SET section_config = ? WHERE id = ?"
            ).bind(JSON.stringify(cfg), sessionId).run();
        }

        return jsonOk({ ok: true, section_config: cfg });
    } catch (e) {
        return jsonErr("Error saving section config: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/transcript
// Body: { client_id: string, client_name?: string, transcript: string, date?: string (YYYY-MM-DD) }
// client_id is the real relationship; client_name is display fallback (resolved from clients table if omitted).
// ---------------------------------------------------------------------------

async function handlePostTranscript(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var body = await request.json();
        if (!body.transcript) { return jsonErr("transcript is required", 400); }
        if (!body.client_id && !body.client_name) {
            return jsonErr("client_id or client_name is required", 400);
        }

        var clientName = body.client_name || null;
        var clientId   = body.client_id   || null;

        // If client_id provided without client_name, look up the display name
        if (clientId && !clientName) {
            var client = await env.DB.prepare("SELECT name FROM clients WHERE id = ?")
                .bind(clientId).first();
            if (client) { clientName = client.name; }
        }
        if (!clientName) { return jsonErr("client not found", 404); }

        var sessionId   = crypto.randomUUID();
        var sessionDate = body.date || new Date().toISOString().split("T")[0];

        await env.DB.prepare(
            "INSERT INTO sessions (id, client_name, client_id, date, status, raw_transcript, created_by) VALUES (?, ?, ?, ?, 'pending', ?, ?)"
        ).bind(sessionId, clientName, clientId, sessionDate, body.transcript, actorName(user)).run();

        return jsonOk({ session_id: sessionId, client_name: clientName, client_id: clientId, date: sessionDate });
    } catch (e) {
        return jsonErr("Error: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/summarize
// Body: { session_id: string }
// ---------------------------------------------------------------------------

var SUMMARY_SYSTEM = "You are a documentation assistant for Apex Business & Leadership consulting. " +
    "Produce bilingual (Portuguese and English) structured session summaries. " +
    "Respond ONLY with a valid JSON object — no markdown fences, no commentary.";

// Maps each of the 4 gateable internal-review keys (summary_json) to the
// checkbox (section_config) key that must be enabled for it to be generated.
// discussion_overview and client_profile_updates have no checkbox and are
// always generated, alongside the mandatory Cover/Executive Summary.
var REVIEW_KEY_TO_SECTION_KEY = {
    recommendations:      "recommendations",
    client_action_items:  "client_actions",
    rafa_followups:       "consultant_followups",
    next_session_focus:   "next_session_focus"
};

function isSectionEnabled(cfg, key) {
    for (var i = 0; i < cfg.sections.length; i++) {
        if (cfg.sections[i].key === key) { return !!cfg.sections[i].enabled; }
    }
    return false;
}

// SUMMARY_PROMPT is split into two independent Claude calls (review keys +
// pdf_data/structured sections) that run concurrently via Promise.all in
// handlePostSummarize. A single call requesting all 9 sections plus pdf_data
// routinely ran past Cloudflare's 120s edge Proxy Read Timeout (524), since
// wall time — not max_tokens — is the real ceiling for HTTP-triggered Workers.
// Splitting keeps each call's generation scope small enough to finish well
// under that ceiling, and running them in parallel keeps total wall time at
// roughly max(callA, callB) instead of their sum.
// Each builder only requests a key when its section_config checkbox is enabled.
// Cover/Executive Summary equivalents (discussion_overview, client_profile_updates,
// executive_summary, headline_insights, document_title) have no checkbox and
// are always requested.

function reviewKeysForConfig(cfg) {
    var reviewKeys = ["discussion_overview", "client_profile_updates"];
    var reviewKeyOrder = ["discussion_overview", "recommendations", "client_action_items",
        "rafa_followups", "next_session_focus", "client_profile_updates"];
    for (var i = 0; i < reviewKeyOrder.length; i++) {
        var k = reviewKeyOrder[i];
        if (reviewKeys.indexOf(k) !== -1) { continue; }
        var sectionKey = REVIEW_KEY_TO_SECTION_KEY[k];
        if (sectionKey && isSectionEnabled(cfg, sectionKey)) { reviewKeys.push(k); }
    }
    // Restore canonical order
    return reviewKeyOrder.filter(function (k) { return reviewKeys.indexOf(k) !== -1; });
}

// Call A: internal-review keys only (short bilingual text blobs).
function buildReviewPrompt(cfg, reviewKeys) {
    var prompt = "Generate the internal-review portion of a session summary for the transcript below.\n\n" +
        "Respond with a JSON object containing exactly " + reviewKeys.length + " top-level keys.\n\n";
    prompt += "Each key is for internal review only, and must be an object with 'pt' and 'en' string fields:\n" +
        "  " + reviewKeys.join(", ") + "\n\n";
    prompt += "Rules: be concise but complete — 2-5 sentences per field.\n" +
        "If the transcript lacks enough detail for a field, infer a reasonable conservative entry — do not leave fields empty.\n" +
        "Do not include any keys other than the ones listed above.\n";
    return prompt;
}

// Call B: pdf_data (client-facing deliverable) + the 3 heavier structured sections.
function buildPdfPrompt(cfg) {
    var wantBusinessDiagnosis = isSectionEnabled(cfg, "business_diagnosis");
    var wantSwotSynthesis     = isSectionEnabled(cfg, "swot_synthesis");
    var wantThirtyDayGoals    = isSectionEnabled(cfg, "thirty_day_goals");
    var wantRecommendations   = isSectionEnabled(cfg, "recommendations");
    var wantClientActions     = isSectionEnabled(cfg, "client_actions");
    var wantConsultantFollowups = isSectionEnabled(cfg, "consultant_followups");
    var wantNextSessionFocus  = isSectionEnabled(cfg, "next_session_focus");
    var wantSwot              = isSectionEnabled(cfg, "swot");
    var wantThirtyDayPlan     = isSectionEnabled(cfg, "thirty_day_plan");

    var structuredKeys = [];
    if (wantBusinessDiagnosis) { structuredKeys.push("business_diagnosis"); }
    if (wantSwotSynthesis)     { structuredKeys.push("swot_synthesis"); }
    if (wantThirtyDayGoals)    { structuredKeys.push("thirty_day_goals"); }

    var totalKeys = structuredKeys.length + 1; // +1 for pdf_data

    var prompt = "Generate the client-facing deliverable portion of a session summary for the transcript below.\n\n" +
        "Respond with a JSON object containing exactly " + totalKeys + " top-level keys.\n\n";

    if (structuredKeys.length > 0) {
        prompt += "The following are structured sections. Each must be an object with 'pt' and 'en' fields, where pt and en\n" +
            "hold the SAME structure (pt in Brazilian Portuguese, en in English — translate descriptions; keep\n" +
            "dimension/area names and level values EXACTLY as specified, in Portuguese, in BOTH languages):\n";
        if (wantBusinessDiagnosis) {
            prompt += "  business_diagnosis: pt/en are each an array of exactly 10 rows, one per business dimension,\n" +
                "    in exactly this order: \"Produto/Serviço\", \"Fundadores\", \"Experiência do Cliente\",\n" +
                "    \"Time Operacional\", \"Time Comercial\", \"Marketing & Presença Digital\", \"Infraestrutura\",\n" +
                "    \"Documentação Legal\", \"Sistemas de Gestão\", \"Parcerias\".\n" +
                "    Each row: {\"dimension\": \"<fixed name above>\", \"situation\": \"1 short sentence describing the\n" +
                "    client's current situation in that dimension, extracted from the transcript\", \"level\": one of\n" +
                "    exactly \"FORTE\", \"MÉDIO\", \"FRACO\", \"CRÍTICO\" — your assessment from the transcript content}\n";
        }
        if (wantSwotSynthesis) {
            prompt += "  swot_synthesis: pt/en are each an object with exactly 3 string fields, each a short analytical\n" +
                "    paragraph (2-3 sentences) cross-referencing the SWOT quadrants you produced:\n" +
                "    {\"forca_oportunidade\": \"how the strengths enable capturing the opportunities\",\n" +
                "     \"fraqueza_ameaca\": \"the biggest combined risk where weaknesses meet threats\",\n" +
                "     \"forca_ameaca\": \"how the strengths defend against the threats\"}\n";
        }
        if (wantThirtyDayGoals) {
            prompt += "  thirty_day_goals: pt/en are each an array of exactly 7 rows, one per area, in exactly this order:\n" +
                "    \"Operacional\", \"Comercial\", \"Marketing\", \"Parcerias\", \"Infraestrutura\", \"Legal\", \"Sistemas\".\n" +
                "    Each row: {\"area\": \"<fixed name above>\", \"meta\": \"a concrete 30-day goal for that area derived\n" +
                "    from the transcript\", \"indicador\": \"a measurable success indicator for that goal\"}\n";
        }
        prompt += "\n";
    }

    prompt += "The final key is 'pdf_data' — a client-facing deliverable written entirely in Brazilian Portuguese.\n" +
        "pdf_data must be an object with exactly these fields:\n" +
        "  document_title: always the exact string \"Relatorio\\nEstrategico\" (use \\n between the two words)\n" +
        "  executive_summary: string, 2-4 sentences summarizing the session\n" +
        "  headline_insights: array of 2-4 objects: [{\"title\": \"...\", \"body\": \"1-2 sentences\"}]\n";
    if (wantRecommendations) {
        prompt += "  recommendations: array of 2-4 objects: [{\"number\": \"01\", \"title\": \"...\", \"body\": \"1-2 sentences\"}]\n";
    }
    if (wantClientActions) {
        prompt += "  client_actions: array of 2-4 objects: [{\"text\": \"...\", \"due\": \"DD Mon\"}] (abbreviated Portuguese month, e.g. '20 Jun')\n";
    }
    if (wantConsultantFollowups) {
        prompt += "  consultant_followups: array of 2-4 objects: [{\"text\": \"...\", \"due\": \"DD Mon\"}]\n";
    }
    if (wantNextSessionFocus) {
        prompt += "  next_session_focus_points: array of 2-4 objects: [{\"number\": \"01\", \"text\": \"...\"}]\n";
    }
    if (wantSwot) {
        prompt += "  swot: {\"strengths\": [2-4 strings], \"weaknesses\": [2-4 strings], \"opportunities\": [2-4 strings], \"threats\": [2-4 strings]}\n";
    }
    if (wantThirtyDayPlan) {
        prompt += "  thirty_day_plan: array of exactly 4 week objects:\n" +
            "    [{\"week_label\": \"SEMANA 1\", \"week_title\": \"short theme\", \"items\": [{\"text\": \"...\", \"owner\": \"CLIENTE\"}]}]\n" +
            "    owner must be exactly 'CLIENTE' or 'CONSULTOR' (uppercase, no other values)\n";
    }
    if (wantBusinessDiagnosis) {
        prompt += "  business_diagnosis: identical structure and content to the 'pt' side of top-level business_diagnosis\n";
    }
    if (wantSwotSynthesis) {
        prompt += "  swot_synthesis: identical structure and content to the 'pt' side of top-level swot_synthesis\n";
    }
    if (wantThirtyDayGoals) {
        prompt += "  thirty_day_goals: identical structure and content to the 'pt' side of top-level thirty_day_goals\n";
    }
    prompt += "\nRules: 2-4 items per array unless stated otherwise.";
    if (wantThirtyDayPlan) { prompt += " Exactly 4 week entries in thirty_day_plan."; }
    if (wantBusinessDiagnosis) { prompt += " Exactly 10 rows in business_diagnosis, in the fixed order given."; }
    if (wantThirtyDayGoals) { prompt += " Exactly 7 rows in thirty_day_goals, in the fixed order given."; }
    prompt += "\nIf the transcript lacks enough detail for a field, infer a reasonable conservative entry — do not leave arrays empty.\n" +
        "Do not include any keys other than the ones listed above.\n";

    return prompt;
}

// Instruction block appended to SUMMARY_PROMPT when the session's section_config
// defines custom sections. Asks for one more top-level key, custom_section_content,
// keyed by custom section id.
function buildCustomSectionsPrompt(customSections) {
    var enabled = (customSections || []).filter(function (cs) { return cs && cs.enabled; });
    if (enabled.length === 0) { return ""; }
    var block = "\nAdditionally, include one more top-level key: 'custom_section_content'.\n" +
        "It must be an object with exactly " + enabled.length + " key(s), one per custom section id below.\n" +
        "Each value must be an object with 'pt' and 'en' fields; each of those is an object shaped as\n" +
        "{\"title\": \"<the exact title given>\", \"body\": \"1-3 sentence paragraph grounded in the transcript\",\n" +
        " \"bullets\": [2-5 short strings]}. Write pt in Brazilian Portuguese and en in English.\n";
    for (var i = 0; i < enabled.length; i++) {
        var cs = enabled[i];
        var titleEn = cs.title_en && cs.title_en.trim() ? cs.title_en : cs.title_pt;
        block += "\nCustom section id \"" + cs.id + "\":\n" +
            "  pt title must be exactly \"" + cs.title_pt + "\"; en title must be exactly \"" + titleEn + "\".\n" +
            "  What this section should cover: " + cs.description + "\n";
    }
    return block;
}

async function handlePostSummarize(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var body = await request.json();
        if (!body.session_id) { return jsonErr("session_id is required", 400); }

        var session = await env.DB.prepare("SELECT * FROM sessions WHERE id = ?")
            .bind(body.session_id).first();
        if (!session)              { return jsonErr("Session not found", 404); }
        if (!session.raw_transcript) { return jsonErr("No transcript for this session", 400); }

        // Only sections whose checkbox is enabled are requested from the model.
        // The summary is generated via two concurrent Claude calls instead of one —
        // internal-review keys in call A, pdf_data + structured sections (+ custom
        // sections, merged into pdf_data) in call B — so total wall time is roughly
        // max(A, B) instead of their sum. A single 9-section call routinely exceeded
        // Cloudflare's 120s edge Proxy Read Timeout and surfaced as a 524.
        var sectionCfg = parseSectionConfig(session.section_config);
        var reviewKeys = reviewKeysForConfig(sectionCfg);
        var transcriptBlock = "\nTranscript:\n" + session.raw_transcript;
        var reviewPromptText = buildReviewPrompt(sectionCfg, reviewKeys) + transcriptBlock;
        var pdfPromptText = buildPdfPrompt(sectionCfg) +
            buildCustomSectionsPrompt(sectionCfg.custom_sections) +
            transcriptBlock;

        function callClaude(promptText, maxTokens) {
            return fetch(CLAUDE_API_URL, {
                method: "POST",
                headers: {
                    "Content-Type":      "application/json",
                    "x-api-key":         env.CLAUDE_API_KEY,
                    "anthropic-version": "2023-06-01"
                },
                body: JSON.stringify({
                    model:      CLAUDE_MODEL,
                    max_tokens: maxTokens,
                    system:     SUMMARY_SYSTEM,
                    messages:   [{ role: "user", content: promptText }]
                })
            });
        }

        var claudeResults = await Promise.all([
            callClaude(reviewPromptText, 4096),
            callClaude(pdfPromptText, 8192)
        ]);
        var reviewRes = claudeResults[0];
        var pdfRes    = claudeResults[1];

        if (!reviewRes.ok) {
            var reviewErr = await reviewRes.text();
            return jsonErr("Claude API error: " + reviewErr, 502);
        }
        if (!pdfRes.ok) {
            var pdfErr = await pdfRes.text();
            return jsonErr("Claude API error: " + pdfErr, 502);
        }

        function parseClaudeJson(claudeData) {
            var rawText = claudeData.content[0].text.trim();
            try {
                return JSON.parse(rawText);
            } catch (parseErr) {
                var match = rawText.match(/\{[\s\S]*\}/);
                if (!match) { throw new Error("Could not parse Claude response as JSON"); }
                return JSON.parse(match[0]);
            }
        }

        var reviewData, pdfDataRaw;
        try {
            reviewData = parseClaudeJson(await reviewRes.json());
            pdfDataRaw = parseClaudeJson(await pdfRes.json());
        } catch (parseErr) {
            return jsonErr(parseErr.message, 500);
        }

        // Merge both calls' results into the single summaryJson shape the rest
        // of this handler (and the frontend) already expects.
        var summaryJson = Object.assign({}, reviewData, pdfDataRaw);

        var pdfData = summaryJson.pdf_data || null;

        // Safety net: if the model put the three structured sections only at the top level,
        // copy their PT side into pdf_data so the report template always receives them.
        if (pdfData) {
            if (!pdfData.business_diagnosis && summaryJson.business_diagnosis) {
                pdfData.business_diagnosis = summaryJson.business_diagnosis.pt || null;
            }
            if (!pdfData.swot_synthesis && summaryJson.swot_synthesis) {
                pdfData.swot_synthesis = summaryJson.swot_synthesis.pt || null;
            }
            if (!pdfData.thirty_day_goals && summaryJson.thirty_day_goals) {
                pdfData.thirty_day_goals = summaryJson.thirty_day_goals.pt || null;
            }
            // Section ordering/visibility + custom-section pages, computed
            // server-side so the template renders straight from pdf_data.
            applySectionConfigToPdfData(pdfData, sectionCfg, summaryJson.custom_section_content || null);
        }

        // Update sessions: keep full summary_json for dashboard compat, write pdf_data to its own column
        await env.DB.prepare(
            "UPDATE sessions SET summary_json = ?, pdf_data = ?, status = 'summarized' WHERE id = ?"
        ).bind(JSON.stringify(summaryJson), pdfData ? JSON.stringify(pdfData) : null, body.session_id).run();

        // Write 6 text keys + 3 structured sections to session_summaries
        var ss = summaryJson;
        // Structured sections are stored as JSON strings per language
        var sectionJson = function (sec, lang) {
            return sec && sec[lang] !== undefined && sec[lang] !== null ? JSON.stringify(sec[lang]) : null;
        };
        var summaryId = crypto.randomUUID();
        await env.DB.prepare(
            "INSERT INTO session_summaries " +
            "(id, session_id, summary_pt, summary_en, recommendations_pt, recommendations_en, " +
            "client_action_items_pt, client_action_items_en, rafa_followups_pt, rafa_followups_en, " +
            "next_session_focus_pt, next_session_focus_en, client_profile_updates_pt, client_profile_updates_en, " +
            "business_diagnosis_pt, business_diagnosis_en, swot_synthesis_pt, swot_synthesis_en, " +
            "thirty_day_goals_pt, thirty_day_goals_en) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
            "ON CONFLICT(session_id) DO UPDATE SET " +
            "summary_pt = excluded.summary_pt, summary_en = excluded.summary_en, " +
            "recommendations_pt = excluded.recommendations_pt, recommendations_en = excluded.recommendations_en, " +
            "client_action_items_pt = excluded.client_action_items_pt, client_action_items_en = excluded.client_action_items_en, " +
            "rafa_followups_pt = excluded.rafa_followups_pt, rafa_followups_en = excluded.rafa_followups_en, " +
            "next_session_focus_pt = excluded.next_session_focus_pt, next_session_focus_en = excluded.next_session_focus_en, " +
            "client_profile_updates_pt = excluded.client_profile_updates_pt, client_profile_updates_en = excluded.client_profile_updates_en, " +
            "business_diagnosis_pt = excluded.business_diagnosis_pt, business_diagnosis_en = excluded.business_diagnosis_en, " +
            "swot_synthesis_pt = excluded.swot_synthesis_pt, swot_synthesis_en = excluded.swot_synthesis_en, " +
            "thirty_day_goals_pt = excluded.thirty_day_goals_pt, thirty_day_goals_en = excluded.thirty_day_goals_en"
        ).bind(
            summaryId, body.session_id,
            ss.discussion_overview   ? ss.discussion_overview.pt   : null,
            ss.discussion_overview   ? ss.discussion_overview.en   : null,
            ss.recommendations       ? ss.recommendations.pt       : null,
            ss.recommendations       ? ss.recommendations.en       : null,
            ss.client_action_items   ? ss.client_action_items.pt   : null,
            ss.client_action_items   ? ss.client_action_items.en   : null,
            ss.rafa_followups        ? ss.rafa_followups.pt        : null,
            ss.rafa_followups        ? ss.rafa_followups.en        : null,
            ss.next_session_focus    ? ss.next_session_focus.pt    : null,
            ss.next_session_focus    ? ss.next_session_focus.en    : null,
            ss.client_profile_updates ? ss.client_profile_updates.pt : null,
            ss.client_profile_updates ? ss.client_profile_updates.en : null,
            sectionJson(ss.business_diagnosis, "pt"),
            sectionJson(ss.business_diagnosis, "en"),
            sectionJson(ss.swot_synthesis, "pt"),
            sectionJson(ss.swot_synthesis, "en"),
            sectionJson(ss.thirty_day_goals, "pt"),
            sectionJson(ss.thirty_day_goals, "en")
        ).run();

        // Write pdf_data to documents table (verbatim, no transformation)
        if (pdfData) {
            var docId = crypto.randomUUID();
            await env.DB.prepare(
                "INSERT INTO documents (id, session_id, pdf_data) VALUES (?, ?, ?) " +
                "ON CONFLICT(session_id) DO UPDATE SET pdf_data = excluded.pdf_data"
            ).bind(docId, body.session_id, JSON.stringify(pdfData)).run();
        }

        return jsonOk({ session_id: body.session_id, summary: summaryJson });
    } catch (e) {
        return jsonErr("Error: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/approve
// Body: { session_id: string, edited_summary?: object }
// ---------------------------------------------------------------------------

async function handlePostApprove(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var body = await request.json();
        if (!body.session_id) { return jsonErr("session_id is required", 400); }

        var session = await env.DB.prepare("SELECT * FROM sessions WHERE id = ?")
            .bind(body.session_id).first();
        if (!session) { return jsonErr("Session not found", 404); }

        var summaryToStore = body.edited_summary
            ? JSON.stringify(body.edited_summary)
            : session.summary_json;
        var approvedAt = new Date().toISOString();

        // Rebuild the template-facing pdf_data from the approved summary so review edits
        // (including business_diagnosis, swot_synthesis, thirty_day_goals) reach the PDF.
        var approvedPdfData = null;
        try {
            var approvedSummary = summaryToStore ? JSON.parse(summaryToStore) : null;
            if (approvedSummary && approvedSummary.pdf_data) {
                approvedPdfData = approvedSummary.pdf_data;
                if (!approvedPdfData.business_diagnosis && approvedSummary.business_diagnosis) {
                    approvedPdfData.business_diagnosis = approvedSummary.business_diagnosis.pt || null;
                }
                if (!approvedPdfData.swot_synthesis && approvedSummary.swot_synthesis) {
                    approvedPdfData.swot_synthesis = approvedSummary.swot_synthesis.pt || null;
                }
                if (!approvedPdfData.thirty_day_goals && approvedSummary.thirty_day_goals) {
                    approvedPdfData.thirty_day_goals = approvedSummary.thirty_day_goals.pt || null;
                }
                // Preserve section ordering/visibility + custom-section pages,
                // recomputed from the session's current section_config.
                applySectionConfigToPdfData(
                    approvedPdfData,
                    parseSectionConfig(session.section_config),
                    approvedSummary.custom_section_content || null
                );
            }
        } catch (pdfErr) { approvedPdfData = null; }

        if (approvedPdfData) {
            await env.DB.prepare(
                "UPDATE sessions SET status = 'approved', approved_at = ?, summary_json = ?, pdf_data = ? WHERE id = ?"
            ).bind(approvedAt, summaryToStore, JSON.stringify(approvedPdfData), body.session_id).run();

            var approvedDocId = crypto.randomUUID();
            await env.DB.prepare(
                "INSERT INTO documents (id, session_id, pdf_data) VALUES (?, ?, ?) " +
                "ON CONFLICT(session_id) DO UPDATE SET pdf_data = excluded.pdf_data"
            ).bind(approvedDocId, body.session_id, JSON.stringify(approvedPdfData)).run();
        } else {
            await env.DB.prepare(
                "UPDATE sessions SET status = 'approved', approved_at = ?, summary_json = ? WHERE id = ?"
            ).bind(approvedAt, summaryToStore, body.session_id).run();
        }

        // TODO: generate branded PDF from summary_json and deliver to client
        // Integration point: call a PDF-generation service or email provider here.

        return jsonOk({ session_id: body.session_id, approved_at: approvedAt, status: "approved" });
    } catch (e) {
        return jsonErr("Error: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/clients
// ---------------------------------------------------------------------------

async function handleGetClients(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }

        var res = await env.DB.prepare(
            "SELECT id, name, owners, industry, location, logo_url, profile_pt, profile_en, " +
            "package, status, phone, email, whatsapp, payment_method, contacts, zoho_customer_id, consolidated, lead_stage, created_at " +
            "FROM clients ORDER BY name ASC"
        ).all();

        return jsonOk({ clients: res.results });
    } catch (e) {
        return jsonErr("Error fetching clients: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/clients
// Body: { name, owners?, industry?, location?, logo_url?, profile_pt?, profile_en? }
// ---------------------------------------------------------------------------

async function handlePostClients(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var body = await request.json();
        if (!body.name) { return jsonErr("name is required", 400); }

        var clientId = crypto.randomUUID();
        await env.DB.prepare(
            "INSERT INTO clients " +
            "(id, name, owners, industry, location, logo_url, profile_pt, profile_en, package, status, phone, email, whatsapp, contacts, lead_stage) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(
            clientId,
            body.name,
            body.owners     || null,
            body.industry   || null,
            body.location   || null,
            body.logo_url   || null,
            body.profile_pt || null,
            body.profile_en || null,
            body.package    || null,
            body.status     || "active",
            body.phone      || null,
            body.email      || null,
            body.whatsapp   || null,
            body.contacts   || null,
            // New leads start at the first stage; anything else has no pipeline.
            (body.status === "lead") ? "Lead" : null
        ).run();

        var result = { client_id: clientId, name: body.name };

        // Auto-create a matching Zoho contact. A Zoho failure must never block
        // client creation -- surfaced as a warning on the response instead.
        try {
            var zohoAuth = await getZohoAccessToken(env);
            var contactRes = await zohoBankingFetch(zohoAuth, "POST", "contacts", {
                contact_name: body.name
            });
            if (contactRes.ok && contactRes.data.contact && contactRes.data.contact.contact_id) {
                var zohoCustomerId = String(contactRes.data.contact.contact_id);
                await env.DB.prepare("UPDATE clients SET zoho_customer_id = ? WHERE id = ?")
                    .bind(zohoCustomerId, clientId).run();
                result.zoho_customer_id = zohoCustomerId;
            } else {
                result.zoho_warning = "Client created, but Zoho contact creation failed: " +
                    (contactRes.data && (contactRes.data.message || JSON.stringify(contactRes.data)));
            }
        } catch (zohoErr) {
            result.zoho_warning = "Client created, but Zoho contact creation failed: " + zohoErr.message;
        }

        return jsonOk(result);
    } catch (e) {
        return jsonErr("Error: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/clients/:id  — single client, all columns
// ---------------------------------------------------------------------------

async function handleGetClient(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }

        // source_type / source_detail / referred_by_partner_id describe where
        // this record came from, and travel with it for its whole lifecycle —
        // set on the lead, still true after conversion. The partner NAME is
        // resolved by LEFT JOIN rather than stored on the client, the same rule
        // the Apex Partner tab follows for its counts: attribution is by
        // record, so a renamed partner renames everywhere at once and a deleted
        // one leaves the name NULL instead of a stale string.
        var client = await env.DB.prepare(
            "SELECT c.id, c.name, c.owners, c.industry, c.location, c.logo_url, c.profile_pt, c.profile_en, " +
            "c.package, c.status, c.phone, c.email, c.whatsapp, c.payment_method, c.contacts, c.consolidated, c.lead_stage, " +
            "c.stage_changed_at, c.stage_changed_by, c.stage_change_source, " +
            "c.next_step, c.next_step_set_by, c.next_step_set_at, " +
            "c.source_type, c.source_detail, c.referred_by_partner_id, p.name AS referred_by_partner_name, " +
            "c.created_at FROM clients c " +
            "LEFT JOIN apex_partners p ON p.id = c.referred_by_partner_id " +
            "WHERE c.id = ?"
        ).bind(id).first();

        if (!client) { return jsonErr("Client not found", 404); }
        return jsonOk({ client: client });
    } catch (e) {
        return jsonErr("Error fetching client: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/clients/:id/contacts
// Returns contacts array parsed from the contacts JSON column.
// ---------------------------------------------------------------------------

async function handleGetClientContacts(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }

        var row = await env.DB.prepare("SELECT contacts FROM clients WHERE id = ?").bind(id).first();
        if (!row) { return jsonErr("Client not found", 404); }

        var contacts = [];
        if (row.contacts) {
            try { contacts = JSON.parse(row.contacts); } catch(e) { contacts = []; }
        }
        return jsonOk({ contacts: contacts });
    } catch (e) {
        return jsonErr("Error fetching contacts: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/clients/:id/notes  — all notes, newest first
// ---------------------------------------------------------------------------

async function handleGetClientNotes(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }

        var res = await env.DB.prepare(
            "SELECT id, client_id, content, created_by, created_at FROM client_notes " +
            "WHERE client_id = ? ORDER BY created_at DESC"
        ).bind(id).all();

        return jsonOk({ notes: res.results });
    } catch (e) {
        return jsonErr("Error fetching notes: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/clients/:id/notes
// Body: { content: string }  (also accepts note_text for spec compat)
// created_by is derived from the authenticated user's role — never trusted from client
// ---------------------------------------------------------------------------

async function handlePostClientNote(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }

        var body = await request.json();
        var content = ((body.content || body.note_text || "")).trim();
        if (!content) { return jsonErr("content is required", 400); }

        var createdBy = user.role === "alice" ? "Alice" : user.role === "rafa" ? "Rafa" : "Dev";

        var noteId = crypto.randomUUID();
        await env.DB.prepare(
            "INSERT INTO client_notes (id, client_id, content, created_by) VALUES (?, ?, ?, ?)"
        ).bind(noteId, id, content, createdBy).run();

        var note = await env.DB.prepare(
            "SELECT id, client_id, content, created_by, created_at FROM client_notes WHERE id = ?"
        ).bind(noteId).first();

        return jsonOk({ note: note });
    } catch (e) {
        return jsonErr("Error saving note: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/clients/:id/contact-log — outreach attempts, newest first
//
// Distinct from /notes (client_notes): that is a general note about the client,
// this is one specific outreach attempt. Both exist independently.
// ---------------------------------------------------------------------------

async function handleGetLeadContactLog(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!isAdminRole(user)) { return jsonErr("Forbidden", 403); }

        var res = await env.DB.prepare(
            // rowid breaks ties: datetime('now') is second-resolution, so two
            // entries logged in the same second would otherwise have an
            // undefined order. rowid preserves true insertion order.
            "SELECT id, client_id, method, result, notes, logged_by, logged_at FROM lead_contact_log " +
            "WHERE client_id = ? ORDER BY logged_at DESC, rowid DESC"
        ).bind(id).all();

        return jsonOk({ entries: res.results });
    } catch (e) {
        return jsonErr("Error fetching contact log: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/clients/:id/contact-log
// Body: { method, result, notes? }
//
// notes is optional on EVERY entry regardless of method/result — never gated.
// logged_by/logged_at are server-set from the authenticated user, matching the
// client_notes convention. Logging the FIRST attempt for a lead auto-advances
// the stage to "Contato inicial".
// ---------------------------------------------------------------------------

async function handlePostLeadContactLog(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!isAdminRole(user)) { return jsonErr("Forbidden", 403); }

        var body = await request.json();
        var method = (body.method || "").trim();
        var result = (body.result || "").trim();
        if (LEAD_CONTACT_METHODS.indexOf(method) < 0) { return jsonErr("Invalid method", 400); }
        if (LEAD_CONTACT_RESULTS.indexOf(result) < 0) { return jsonErr("Invalid result", 400); }

        var notes = (body.notes || "").trim() || null;
        var loggedBy = user.role === "alice" ? "Alice" : user.role === "rafa" ? "Rafa" : "Dev";

        var entryId = crypto.randomUUID();
        await env.DB.prepare(
            "INSERT INTO lead_contact_log (id, client_id, method, result, notes, logged_by) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(entryId, id, method, result, notes, loggedBy).run();

        // First contact logged → "Contato inicial" (forward-only, lead-only).
        await advanceLeadStage(env, id, "Contato inicial", actorName(user), "auto:contact_logged");

        var entry = await env.DB.prepare(
            "SELECT id, client_id, method, result, notes, logged_by, logged_at FROM lead_contact_log WHERE id = ?"
        ).bind(entryId).first();

        var client = await env.DB.prepare("SELECT lead_stage FROM clients WHERE id = ?").bind(id).first();

        return jsonOk({ entry: entry, lead_stage: client ? client.lead_stage : null });
    } catch (e) {
        return jsonErr("Error saving contact log entry: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/clients/:id/lead-pipeline
//
// Everything the lead detail view needs that it cannot infer from the client
// row: the "Raio X enviado" three-step checklist status, and the system facts
// used to detect a conflicting manual stage override.
//
// The checklist reports REAL completion state read from the same tables the
// underlying features write to — it never stores its own copy:
//   1. portal login created  -> client_logins row exists
//   2. X-Ray assigned        -> client_assessments row exists
//   3. credentials sent      -> see caveat below
//
// CAVEAT (credentials_sent): sending the login happens entirely client-side —
// sendLoginViaWhatsapp() opens wa.me in a new tab and nothing is ever written
// back to D1. There is no server-side record that the WhatsApp message was
// actually sent, so this step is reported from whether the password has been
// generated and not yet changed. It answers "credentials exist to send",
// not "Alice pressed send". Making it exact would need a new column stamped
// on send, which is outside this build's scope.
// ---------------------------------------------------------------------------

async function handleGetLeadPipeline(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!isAdminRole(user)) { return jsonErr("Forbidden", 403); }

        var login = await env.DB.prepare(
            "SELECT username, password_changed_at FROM client_logins WHERE client_id = ?"
        ).bind(id).first();

        var assessment = await env.DB.prepare(
            "SELECT status, completed_at FROM client_assessments WHERE client_id = ? AND assessment_type = 'business_xray'"
        ).bind(id).first();

        var session = await env.DB.prepare(
            "SELECT id, date, time FROM sessions WHERE client_id = ? AND status != 'cancelled' ORDER BY date DESC LIMIT 1"
        ).bind(id).first();

        var contactCount = await env.DB.prepare(
            "SELECT COUNT(*) AS n FROM lead_contact_log WHERE client_id = ?"
        ).bind(id).first();

        return jsonOk({
            checklist: {
                login_created:    !!login,
                xray_assigned:    !!assessment,
                credentials_sent: !!login
            },
            facts: {
                has_contact_log:  !!(contactCount && contactCount.n > 0),
                xray_assigned:    !!assessment,
                xray_completed:   !!(assessment && assessment.status === "completed"),
                has_session:      !!session,
                session_date:     session ? session.date : null
            }
        });
    } catch (e) {
        return jsonErr("Error fetching lead pipeline state: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: PATCH /api/clients/:id/lead-stage
// Body: { stage }  — manual override from the lead's detail view.
//
// Manual override ALWAYS wins: the warning about conflicting system facts is
// raised in the UI (inform-never-block), and by the time this is called the
// user has already chosen to proceed. The server records the choice rather
// than second-guessing it.
// ---------------------------------------------------------------------------

async function handlePatchLeadStage(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!isAdminRole(user)) { return jsonErr("Forbidden", 403); }

        var body = await request.json();
        var stage = (body.stage || "").trim();
        if (LEAD_STAGES.indexOf(stage) < 0) { return jsonErr("Invalid stage", 400); }

        var client = await env.DB.prepare(
            "SELECT id, status, lead_stage, stage_changed_at, stage_changed_by, stage_change_source FROM clients WHERE id = ?"
        ).bind(id).first();
        if (!client) { return jsonErr("Client not found", 404); }
        if ((client.status || "") !== "lead") { return jsonErr("Not a lead", 400); }

        // Re-selecting the stage the lead is already on is a no-op, NOT a
        // reset of the "days in stage" clock. A lead sitting on "Agendamento"
        // for 12 days that Alice re-picks from the dropdown is still 12 days
        // in — stage_changed_at answers "when did it last MOVE", so it is only
        // stamped when the value actually changes. A NULL lead_stage reads as
        // the first stage ("Lead"), matching leadStageIndex().
        // A no-op re-pick leaves the attribution alone for the same reason it
        // leaves the clock alone: all three columns describe the last change
        // that actually happened.
        var currentStage = client.lead_stage || "Lead";
        if (currentStage === stage) {
            return jsonOk({
                lead_stage: stage,
                stage_changed_at: client.stage_changed_at || null,
                stage_changed_by: client.stage_changed_by || null,
                stage_change_source: client.stage_change_source || null,
                unchanged: true
            });
        }

        // source 'manual' is what separates a deliberate pick from an
        // automatic advance in the UI. Written in the SAME statement as the
        // stage and the clock so the four can never drift apart.
        await env.DB.prepare(
            "UPDATE clients SET lead_stage = ?, stage_changed_at = datetime('now'), " +
            "stage_changed_by = ?, stage_change_source = 'manual' WHERE id = ?"
        ).bind(stage, actorName(user), id).run();

        var stamped = await env.DB.prepare(
            "SELECT stage_changed_at, stage_changed_by, stage_change_source FROM clients WHERE id = ?"
        ).bind(id).first();
        return jsonOk({
            lead_stage: stage,
            stage_changed_at: stamped ? stamped.stage_changed_at : null,
            stage_changed_by: stamped ? stamped.stage_changed_by : null,
            stage_change_source: stamped ? stamped.stage_change_source : null
        });
    } catch (e) {
        return jsonErr("Error updating lead stage: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: PATCH /api/clients/:id/lead-next-step
// Body: { next_step }  — the one "what happens next" line on a lead.
//
// Attribution is the point of this field: on a hard lead, Rafa needs to see
// what Alice committed to (and vice versa). So next_step_set_by and
// next_step_set_at are stamped SERVER-SIDE from the authenticated user on every
// write and written in the SAME statement as the value — the three can never
// drift apart, and a client cannot forge authorship.
//
// Both Alice and Rafa (any isAdminRole) may edit, including overwriting each
// other's text. That is deliberate and not a gap: the whole reason the field
// carries attribution is that either of them can step in on the other's lead,
// and the display then simply shows who touched it last.
//
// Sending an empty string CLEARS the field — and clears the attribution with
// it, since "set by Rafa" attached to no next step would be noise.
// ---------------------------------------------------------------------------

async function handlePatchLeadNextStep(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!isAdminRole(user)) { return jsonErr("Forbidden", 403); }

        var body = await request.json();
        var nextStep = (body.next_step || "").trim();

        var client = await env.DB.prepare("SELECT id FROM clients WHERE id = ?").bind(id).first();
        if (!client) { return jsonErr("Client not found", 404); }

        if (!nextStep) {
            // Clearing takes the attribution with it — see above.
            await env.DB.prepare(
                "UPDATE clients SET next_step = NULL, next_step_set_by = NULL, next_step_set_at = NULL WHERE id = ?"
            ).bind(id).run();
            return jsonOk({ next_step: null, next_step_set_by: null, next_step_set_at: null });
        }

        // Same display-name derivation as lead_contact_log.logged_by.
        var setBy = user.role === "alice" ? "Alice" : user.role === "rafa" ? "Rafa" : "Dev";

        await env.DB.prepare(
            "UPDATE clients SET next_step = ?, next_step_set_by = ?, next_step_set_at = datetime('now') WHERE id = ?"
        ).bind(nextStep, setBy, id).run();

        var row = await env.DB.prepare(
            "SELECT next_step, next_step_set_by, next_step_set_at FROM clients WHERE id = ?"
        ).bind(id).first();

        return jsonOk({
            next_step:        row ? row.next_step : nextStep,
            next_step_set_by: row ? row.next_step_set_by : setBy,
            next_step_set_at: row ? row.next_step_set_at : null
        });
    } catch (e) {
        return jsonErr("Error updating next step: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/clients/:id/lead-outcome
// Body: { outcome: 'converted' | 'dormant', package? }
//
// ONE code path for both terminal outcomes. The Outcome Control and setting a
// terminal state from the stage control are two entry points into this single
// handler — deliberately not two implementations of the same rule.
//
//   converted -> status='active' (package required), lead_stage cleared;
//                the record leaves the Leads tab and becomes a normal client.
//   dormant   -> status='lead_dormant', lead_stage cleared; shown in
//                Consolidados under "Leads para reativar". NOT "lost" — Rafa
//                works this list to revive them.
//
// lead_stage is nulled in both cases: the record is no longer a live lead, so
// a stale stage would misrepresent it if it were ever reopened.
// ---------------------------------------------------------------------------

async function handlePostLeadOutcome(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!isAdminRole(user)) { return jsonErr("Forbidden", 403); }

        var body = await request.json();
        var outcome = (body.outcome || "").trim();

        var client = await env.DB.prepare("SELECT id, status FROM clients WHERE id = ?").bind(id).first();
        if (!client) { return jsonErr("Client not found", 404); }

        if (outcome === "converted") {
            var pkg = (body.package || "").trim();
            if (!pkg) { return jsonErr("A package is required to convert a lead into a client", 400); }
            await env.DB.prepare(
                "UPDATE clients SET status = 'active', package = ?, lead_stage = NULL WHERE id = ?"
            ).bind(pkg, id).run();
            return jsonOk({ status: "active", package: pkg });
        }

        if (outcome === "dormant") {
            await env.DB.prepare(
                "UPDATE clients SET status = 'lead_dormant', lead_stage = NULL WHERE id = ?"
            ).bind(id).run();
            return jsonOk({ status: "lead_dormant" });
        }

        return jsonErr("Unknown outcome", 400);
    } catch (e) {
        return jsonErr("Error saving lead outcome: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/clients/:id/documents/latest
// Returns the most recent document for this client (via session JOIN).
// Chose a dedicated lightweight route over extending sessions response to keep
// session payloads lean — client profile only needs "does a doc exist?" as a
// separate concern from the session list.
// ---------------------------------------------------------------------------

async function handleGetClientLatestDocument(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }

        var doc = await env.DB.prepare(
            "SELECT d.id, d.session_id, d.created_at " +
            "FROM documents d " +
            "JOIN sessions s ON s.id = d.session_id " +
            "WHERE s.client_id = ? " +
            "ORDER BY d.created_at DESC LIMIT 1"
        ).bind(id).first();

        return jsonOk({ document: doc || null });
    } catch (e) {
        return jsonErr("Error fetching document: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/clients/:id/documents
// Combined Documents list for the client profile: auto-generated session
// reports (rendered client-side from sessions.pdf_data, same as the existing
// per-session "Gerar PDF" button — no R2 file behind these) plus manually
// uploaded files (client_documents, R2-backed). Merged and sorted newest
// first so both kinds show in one list, tagged by `kind`.
// ---------------------------------------------------------------------------

async function handleGetClientDocuments(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }

        var generatedRows = await env.DB.prepare(
            "SELECT id, client_name, date, pdf_data, approved_at, created_at " +
            "FROM sessions WHERE client_id = ? AND pdf_data IS NOT NULL " +
            "ORDER BY date DESC"
        ).bind(id).all();

        var uploadedRows = await env.DB.prepare(
            "SELECT id, title, file_name, content_type, uploaded_by, created_at " +
            "FROM client_documents WHERE client_id = ? ORDER BY created_at DESC"
        ).bind(id).all();

        var generated = (generatedRows.results || []).map(function(s) {
            return {
                kind: "generated",
                id: s.id,
                session_id: s.id,
                title: s.client_name + " — " + s.date,
                date: s.approved_at || s.created_at,
                pdf_data: s.pdf_data
            };
        });

        var uploaded = (uploadedRows.results || []).map(function(d) {
            return {
                kind: "uploaded",
                id: d.id,
                title: d.title,
                file_name: d.file_name,
                content_type: d.content_type,
                uploaded_by: d.uploaded_by,
                date: d.created_at
            };
        });

        var combined = generated.concat(uploaded).sort(function(a, b) {
            return (b.date || "").localeCompare(a.date || "");
        });

        return jsonOk({ documents: combined });
    } catch (e) {
        return jsonErr("Error fetching documents: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/clients/:id/documents
// Manual upload of an existing file (old proposal, meeting summary, etc.)
// into the client's Documents section. Body: multipart/form-data with a
// 'file' field and optional 'title' field. Stored in R2 under
// client-documents/<clientId>/<uuid>.<ext>, same hardening pattern as
// resource file uploads (storeResourceFile / RESOURCE_FILE_TYPES).
// alice / rafa / developer only.
// ---------------------------------------------------------------------------

async function handlePostClientDocument(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!canEditResources(user)) { return jsonErr("Forbidden", 403); }

        var client = await env.DB.prepare("SELECT id FROM clients WHERE id = ?").bind(id).first();
        if (!client) { return jsonErr("Client not found", 404); }

        var form = await request.formData();
        var file = form.get("file");
        if (!file || typeof file.arrayBuffer !== "function") { return jsonErr("file is required", 400); }

        var ext = RESOURCE_FILE_TYPES[file.type];
        if (!ext) { return jsonErr("Invalid file type. Upload a PDF, image, Word/Excel document, CSV, or text file.", 400); }

        var MAX_BYTES = 20 * 1024 * 1024;
        var buf = await file.arrayBuffer();
        if (buf.byteLength > MAX_BYTES) {
            return jsonErr("File too large. Maximum size is 20 MB.", 400);
        }

        var titleField = form.get("title");
        var title = (typeof titleField === "string" && titleField.trim()) ? titleField.trim() : (file.name || ("document." + ext));

        var docId = crypto.randomUUID();
        var key = "client-documents/" + id + "/" + docId + "." + ext;

        await env.ASSETS.put(key, buf, {
            httpMetadata: { contentType: file.type }
        });

        await env.DB.prepare(
            "INSERT INTO client_documents (id, client_id, title, file_name, file_url, content_type, uploaded_by) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).bind(
            docId, id, title, file.name || ("document." + ext), key, file.type,
            user.display_name || user.role
        ).run();

        var row = await env.DB.prepare("SELECT * FROM client_documents WHERE id = ?").bind(docId).first();
        return jsonOk({ document: row });
    } catch (e) {
        return jsonErr("Error uploading document: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: DELETE /api/clients/:id/documents/:docId
// Deletes an uploaded client document (R2 object + client_documents row).
// Uploaded documents only — generated documents (session PDFs) have no
// client_documents row and are out of scope. alice / rafa / developer only.
// ---------------------------------------------------------------------------

async function handleDeleteClientDocument(id, docId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!canEditResources(user)) { return jsonErr("Forbidden", 403); }

        var row = await env.DB.prepare(
            "SELECT file_url FROM client_documents WHERE id = ? AND client_id = ?"
        ).bind(docId, id).first();
        if (!row) { return jsonErr("Document not found", 404); }

        if (!/^client-documents\/[A-Za-z0-9_-]+\/[A-Za-z0-9-]+\.[a-z0-9]+$/.test(row.file_url)) {
            return jsonErr("Document not found", 404);
        }

        await env.ASSETS.delete(row.file_url);

        await env.DB.prepare(
            "DELETE FROM client_documents WHERE id = ? AND client_id = ?"
        ).bind(docId, id).run();

        return jsonOk({ deleted: true });
    } catch (e) {
        return jsonErr("Error deleting document: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/clients/:id/documents/:docId/file
// Serves an uploaded client document from R2 — no raw R2 paths exposed to
// the frontend. Same safe-serving pattern as GET /api/resources/:id/file.
// ---------------------------------------------------------------------------

async function handleGetClientDocumentFile(id, docId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }

        var row = await env.DB.prepare(
            "SELECT file_url, file_name, content_type FROM client_documents WHERE id = ? AND client_id = ?"
        ).bind(docId, id).first();
        if (!row) { return new Response(null, { status: 404, headers: CORS_HEADERS }); }

        if (!/^client-documents\/[A-Za-z0-9_-]+\/[A-Za-z0-9-]+\.[a-z0-9]+$/.test(row.file_url)) {
            return new Response(null, { status: 404, headers: CORS_HEADERS });
        }

        var obj = await env.ASSETS.get(row.file_url);
        if (!obj) { return new Response(null, { status: 404, headers: CORS_HEADERS }); }

        var stored = obj.httpMetadata && obj.httpMetadata.contentType;
        var ct = RESOURCE_FILE_TYPES[stored] ? stored : "application/octet-stream";
        var safeName = String(row.file_name || "document").replace(/[^\w. -]/g, "_");
        var fileHeaders = Object.assign({}, CORS_HEADERS, {
            "Content-Type": ct,
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": "inline; filename=\"" + safeName + "\"",
            "Cache-Control": "private, max-age=3600"
        });
        return new Response(obj.body, { status: 200, headers: fileHeaders });
    } catch (e) {
        return jsonErr("Error fetching document file: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/clients/:id/logo
// Body: multipart/form-data with 'logo' file field (JPG, PNG, GIF, WebP only)
// alice / developer only; stores in R2; updates clients.logo_url with the key
// ---------------------------------------------------------------------------

async function handlePostClientLogo(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        // Admin roles for any client; a client-role user may update their own
        // logo from the portal (same record the admin side shows — stays in sync).
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        if (user.role === "client" && user.client_id !== id) { return jsonErr("Forbidden", 403); }

        var form = await request.formData();
        var file = form.get("logo");
        if (!file || typeof file.arrayBuffer !== "function") { return jsonErr("logo file is required", 400); }

        var allowed = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
        if (allowed.indexOf(file.type) === -1) {
            return jsonErr("Invalid file type. Upload a JPG, PNG, GIF, or WebP image.", 400);
        }

        var ext = (file.type === "image/png") ? "png"
                : (file.type === "image/gif") ? "gif"
                : (file.type === "image/webp") ? "webp"
                : "jpg";
        var key = "logos/" + id + "." + ext;

        await env.ASSETS.put(key, await file.arrayBuffer(), {
            httpMetadata: { contentType: file.type }
        });

        await env.DB.prepare("UPDATE clients SET logo_url = ? WHERE id = ?")
            .bind(key, id).run();

        return jsonOk({ logo_key: key });
    } catch (e) {
        return jsonErr("Error uploading logo: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/clients/:id/logo-image
// Serves the client logo from R2 — no raw R2 paths exposed to frontend.
// Auth-free: logos are non-sensitive image assets referenced by client UUID.
// ---------------------------------------------------------------------------

async function handleGetClientLogoImage(id, request, env) {
    try {
        var client = await env.DB.prepare("SELECT logo_url FROM clients WHERE id = ?")
            .bind(id).first();

        if (!client || !client.logo_url) {
            return new Response(null, { status: 404, headers: CORS_HEADERS });
        }

        if (!/^logos\/[A-Za-z0-9_-]+\.(png|jpe?g|gif|webp)$/.test(client.logo_url)) {
            return new Response(null, { status: 404, headers: CORS_HEADERS });
        }

        var obj = await env.ASSETS.get(client.logo_url);
        if (!obj) {
            return new Response(null, { status: 404, headers: CORS_HEADERS });
        }

        var allowedTypes = { "image/jpeg": 1, "image/png": 1, "image/gif": 1, "image/webp": 1 };
        var stored = obj.httpMetadata && obj.httpMetadata.contentType;
        var ct = allowedTypes[stored] ? stored : "image/jpeg";
        var imgHeaders = Object.assign({}, CORS_HEADERS, {
            "Content-Type": ct,
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": "inline; filename=\"logo\"",
            "Cache-Control": "public, max-age=86400"
        });
        return new Response(obj.body, { status: 200, headers: imgHeaders });
    } catch (e) {
        return jsonErr("Error fetching logo: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: PATCH /api/clients/:id
// Body: { payment_method?: string }
// alice / developer only; updates specific client fields
// ---------------------------------------------------------------------------

async function handlePatchClient(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var body = await request.json();
        var updated = false;

        // Update each recognized field individually so we don't need dynamic binding
        if (body.hasOwnProperty("payment_method")) {
            await env.DB.prepare("UPDATE clients SET payment_method = ? WHERE id = ?")
                .bind(body.payment_method || null, id).run();
            updated = true;
        }
        if (body.hasOwnProperty("contacts")) {
            await env.DB.prepare("UPDATE clients SET contacts = ? WHERE id = ?")
                .bind(body.contacts || null, id).run();
            updated = true;
        }
        if (body.hasOwnProperty("name") && body.name) {
            await env.DB.prepare("UPDATE clients SET name = ? WHERE id = ?")
                .bind(body.name, id).run();
            updated = true;
        }
        if (body.hasOwnProperty("owners")) {
            await env.DB.prepare("UPDATE clients SET owners = ? WHERE id = ?")
                .bind(body.owners || null, id).run();
            updated = true;
        }
        if (body.hasOwnProperty("industry")) {
            await env.DB.prepare("UPDATE clients SET industry = ? WHERE id = ?")
                .bind(body.industry || null, id).run();
            updated = true;
        }
        if (body.hasOwnProperty("location")) {
            await env.DB.prepare("UPDATE clients SET location = ? WHERE id = ?")
                .bind(body.location || null, id).run();
            updated = true;
        }
        if (body.hasOwnProperty("phone")) {
            await env.DB.prepare("UPDATE clients SET phone = ? WHERE id = ?")
                .bind(body.phone || null, id).run();
            updated = true;
        }
        if (body.hasOwnProperty("email")) {
            await env.DB.prepare("UPDATE clients SET email = ? WHERE id = ?")
                .bind(body.email || null, id).run();
            updated = true;
        }
        if (body.hasOwnProperty("whatsapp")) {
            await env.DB.prepare("UPDATE clients SET whatsapp = ? WHERE id = ?")
                .bind(body.whatsapp || null, id).run();
            updated = true;
        }
        if (body.hasOwnProperty("package")) {
            await env.DB.prepare("UPDATE clients SET package = ? WHERE id = ?")
                .bind(body.package || null, id).run();
            updated = true;
        }
        if (body.hasOwnProperty("status")) {
            await env.DB.prepare("UPDATE clients SET status = ? WHERE id = ?")
                .bind(body.status || null, id).run();
            updated = true;
        }
        if (body.hasOwnProperty("consolidated")) {
            await env.DB.prepare("UPDATE clients SET consolidated = ? WHERE id = ?")
                .bind(body.consolidated ? 1 : 0, id).run();
            updated = true;
        }

        // ── Source: where this client came from ──────────────────────────────
        //
        // The three source columns are written TOGETHER rather than one at a
        // time, because they are only meaningful as a set: 'partner' with no
        // partner id is unattributed, and a partner id left behind after the
        // type changes to 'social' is a lie the Partner tab would still count.
        // So a source edit always rewrites all three.
        if (body.hasOwnProperty("source_type")) {
            var srcType = body.source_type || null;
            if (srcType !== null && CLIENT_SOURCE_TYPES.indexOf(srcType) === -1) {
                return jsonErr("Origem inválida / Invalid source type", 400);
            }

            var srcPartnerId = null;
            var srcDetail = null;

            if (srcType === "partner") {
                // Attribution is BY RECORD, never by typed name — the id must
                // resolve to a real apex_partners row or the edit is rejected
                // rather than silently stored as a dangling pointer.
                srcPartnerId = body.referred_by_partner_id || null;
                if (!srcPartnerId) {
                    return jsonErr("Selecione um parceiro / Select a partner", 400);
                }
                var partnerRow = await env.DB.prepare(
                    "SELECT id FROM apex_partners WHERE id = ?"
                ).bind(srcPartnerId).first();
                if (!partnerRow) { return jsonErr("Parceiro não encontrado / Partner not found", 404); }
                // source_detail stays NULL for partners: the name is resolved by
                // join at read time and must never be duplicated here.
            } else if (srcType !== null) {
                srcDetail = body.hasOwnProperty("source_detail") && body.source_detail
                    ? String(body.source_detail).slice(0, 500)
                    : null;
            }
            // srcType === null clears all three — "unknown" is a real answer.

            await env.DB.prepare(
                "UPDATE clients SET source_type = ?, source_detail = ?, referred_by_partner_id = ? WHERE id = ?"
            ).bind(srcType, srcDetail, srcPartnerId, id).run();
            updated = true;
        }

        return jsonOk({ updated: updated });
    } catch (e) {
        return jsonErr("Error updating client: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/clients/:id/digital-presence
// ---------------------------------------------------------------------------

async function handleGetDigitalPresence(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }

        var row = await env.DB.prepare("SELECT digital_presence FROM clients WHERE id = ?").bind(id).first();
        if (!row) { return jsonErr("Client not found", 404); }

        var data = null;
        if (row.digital_presence) {
            try { data = JSON.parse(row.digital_presence); } catch(e) { data = null; }
        }
        return jsonOk({ digital_presence: data || {} });
    } catch (e) {
        return jsonErr("Error fetching digital presence: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: PATCH /api/clients/:id/digital-presence
// Body: { platform: string, url?: string, notes?: [{date, working, needs_improvement}] }
// Merges into the existing digital_presence JSON object.
// ---------------------------------------------------------------------------

async function handlePatchDigitalPresence(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var body = await request.json();
        if (!body.platform) { return jsonErr("platform is required", 400); }

        var row = await env.DB.prepare("SELECT digital_presence FROM clients WHERE id = ?").bind(id).first();
        if (!row) { return jsonErr("Client not found", 404); }

        var existing = {};
        if (row.digital_presence) {
            try { existing = JSON.parse(row.digital_presence); } catch(e) { existing = {}; }
        }

        if (!existing[body.platform]) { existing[body.platform] = {}; }
        if (body.hasOwnProperty("url")) {
            var safeUrl = null;
            if (body.url) {
                try {
                    var parsed = new URL(body.url);
                    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
                        safeUrl = body.url;
                    }
                } catch(e) { /* reject invalid URLs */ }
            }
            existing[body.platform].url = safeUrl;
        }
        if (body.hasOwnProperty("notes")) { existing[body.platform].notes = body.notes || []; }

        await env.DB.prepare("UPDATE clients SET digital_presence = ? WHERE id = ?")
            .bind(JSON.stringify(existing), id).run();

        return jsonOk({ digital_presence: existing });
    } catch (e) {
        return jsonErr("Error updating digital presence: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/clients/:id/tasks
// Returns tasks for this client, optionally filtered by ?type=client|consultant
// ---------------------------------------------------------------------------

async function handleGetClientTasks(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }

        var url = new URL(request.url);
        var typeFilter = url.searchParams.get("type");

        var stmt;
        if (typeFilter) {
            stmt = env.DB.prepare(
                "SELECT id, client_id, type, description, due_date, status, created_at " +
                "FROM tasks WHERE client_id = ? AND type = ? ORDER BY due_date ASC, created_at ASC"
            ).bind(id, typeFilter);
        } else {
            stmt = env.DB.prepare(
                "SELECT id, client_id, type, description, due_date, status, created_at " +
                "FROM tasks WHERE client_id = ? ORDER BY type ASC, due_date ASC, created_at ASC"
            ).bind(id);
        }

        var res = await stmt.all();
        return jsonOk({ tasks: res.results });
    } catch (e) {
        return jsonErr("Error fetching tasks: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/clients/:id/tasks
// Body: { type: "client"|"consultant", description: string, due_date?: string }
// ---------------------------------------------------------------------------

async function handlePostClientTask(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var body = await request.json();
        if (!body.description) { return jsonErr("description is required", 400); }
        if (body.type !== "client" && body.type !== "consultant") {
            return jsonErr("type must be client or consultant", 400);
        }

        var taskId = crypto.randomUUID();
        await env.DB.prepare(
            "INSERT INTO tasks (id, client_id, type, description, due_date, status) VALUES (?, ?, ?, ?, ?, 'pending')"
        ).bind(taskId, id, body.type, body.description, body.due_date || null).run();

        var task = await env.DB.prepare(
            "SELECT id, client_id, type, description, due_date, status, created_at FROM tasks WHERE id = ?"
        ).bind(taskId).first();

        return jsonOk({ task: task });
    } catch (e) {
        return jsonErr("Error creating task: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: PATCH /api/tasks/:id
// Body: { status?: string }
// Any authenticated user can toggle task status (done/pending).
// ---------------------------------------------------------------------------

async function handlePatchTask(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }

        var body = await request.json();
        if (!body.hasOwnProperty("status")) { return jsonErr("status is required", 400); }

        var allowed = ["pending", "done"];
        if (allowed.indexOf(body.status) === -1) { return jsonErr("status must be pending or done", 400); }

        // Verify the task exists and caller has access via their role
        var task = await env.DB.prepare("SELECT id, client_id FROM tasks WHERE id = ?").bind(id).first();
        if (!task) { return jsonErr("Task not found", 404); }
        // Only alice, rafa, and developer can mutate tasks (same gate as task creation and client writes)
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        await env.DB.prepare("UPDATE tasks SET status = ? WHERE id = ?")
            .bind(body.status, id).run();

        return jsonOk({ ok: true, status: body.status });
    } catch (e) {
        return jsonErr("Error updating task: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/sessions/schedule
// Body: { client_id, date, time, session_type, notes, meeting_category?,
//         end_time?, location?, event_name?, recur_frequency?, recur_count? }
// session_type: 'online_meet' | 'in_person'
// meeting_category: 'client' (default) | 'prospective' | 'event'
// 'event' entries (conferences, Apex Club) have no client: client_id is
// stored NULL and event_name lands in the NOT NULL client_name column.
// end_time is stored as a plain "HH:MM" (the Google Calendar sync path
// stores full ISO datetimes in the same column -- readers handle both).
// recur_frequency/recur_count expand a series into N rows linked by a
// series_id in one POST. online_meet series additionally create ONE Google
// Calendar event carrying a native RRULE (shared Meet link; Google
// generates the instances). Count is hard-capped at 26.
// ---------------------------------------------------------------------------

var RECUR_FREQUENCIES = ["weekly", "biweekly", "monthly"];

// Date of occurrence #index (0-based). UTC-only arithmetic so Florida DST
// switches can never shift a date; monthly clamps to the last day of short
// months (the 31st in a 30-day month stays in that month).
function recurOccurrenceDate(dateStr, freq, index) {
    var p = dateStr.split("-");
    var y = parseInt(p[0], 10), m = parseInt(p[1], 10), d = parseInt(p[2], 10);
    var out;
    if (freq === "monthly") {
        var target = new Date(Date.UTC(y, m - 1 + index, 1));
        var lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
        out = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, lastDay)));
    } else {
        var step = freq === "biweekly" ? 14 : 7;
        out = new Date(Date.UTC(y, m - 1, d + step * index));
    }
    function pad2(n) { return n < 10 ? "0" + n : "" + n; }
    return out.getUTCFullYear() + "-" + pad2(out.getUTCMonth() + 1) + "-" + pad2(out.getUTCDate());
}

async function handlePostSessionsSchedule(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }

        var body = await request.json();
        if (!body.date)         { return jsonErr("date is required", 400); }
        if (!body.time)         { return jsonErr("time is required", 400); }
        if (body.session_type !== "online_meet" && body.session_type !== "in_person") {
            return jsonErr("session_type must be online_meet or in_person", 400);
        }
        var meetingCategory = "client";
        if (body.meeting_category === "prospective") { meetingCategory = "prospective"; }
        if (body.meeting_category === "event")       { meetingCategory = "event"; }

        var endTime = null;
        if (body.end_time) {
            if (!/^\d{2}:\d{2}$/.test(body.end_time)) { return jsonErr("end_time must be HH:MM", 400); }
            endTime = body.end_time;
        }
        var location = body.location || null;

        var clientId, clientName, sessionType;
        if (meetingCategory === "event") {
            if (!body.event_name) { return jsonErr("event_name is required for events", 400); }
            clientId    = null;
            clientName  = body.event_name;
            sessionType = "in_person"; // events never get a Google Meet link
        } else {
            if (!body.client_id) { return jsonErr("client_id is required", 400); }
            var client = await env.DB.prepare("SELECT id, name FROM clients WHERE id = ?")
                .bind(body.client_id).first();
            if (!client) { return jsonErr("Client not found", 404); }
            clientId    = body.client_id;
            clientName  = client.name;
            sessionType = body.session_type;
        }

        var meetLink = null;
        if (sessionType === "online_meet") {
          meetLink = body.google_meet_link || "[PENDING_GOOGLE_API]";
        }

        // Recurrence expansion: N linked rows sharing a series_id. The 26 cap
        // is a guard shared with the frontend.
        var recurCount = 1;
        var recurFreq  = null;
        if (body.recur_count !== undefined && body.recur_count !== null) {
            if (meetingCategory === "event") { return jsonErr("Events cannot recur", 400); }
            recurCount = parseInt(body.recur_count, 10);
            if (isNaN(recurCount) || recurCount < 2 || recurCount > 26) {
                return jsonErr("recur_count must be between 2 and 26", 400);
            }
            recurFreq = body.recur_frequency;
            if (RECUR_FREQUENCIES.indexOf(recurFreq) === -1) {
                return jsonErr("recur_frequency must be weekly, biweekly or monthly", 400);
            }
        }

        var seriesId      = recurFreq ? crypto.randomUUID() : null;
        var googleEventId = body.google_event_id || null;
        var gcalError     = null;

        // Recurring online series: ONE Google Calendar event carrying a
        // native RRULE (Google generates the instances; the whole series
        // shares one Meet link), then N local rows below. One API call, so
        // there is no per-occurrence partial-failure problem. If Google
        // fails, the rows are still created with the placeholder link so the
        // series exists and is repairable from the detail modal; the
        // WhatsApp 409 guard keeps the placeholder away from clients.
        if (recurFreq && sessionType === "online_meet") {
            var seriesEndHHMM = endTime || plusOneHourHHMM(body.time);
            var seriesTitle = meetingCategory === "prospective" ? clientName : clientName + " - RDE";
            var attendeeEmail = meetingCategory === "event" ? null : await lookupClientAttendeeEmail(env, clientId);
            try {
                var seriesToken = await getGoogleAccessToken(env);
                var seriesEventBody = {
                    summary: seriesTitle,
                    start: { dateTime: body.date + "T" + body.time + ":00", timeZone: APEX_TIMEZONE },
                    end:   { dateTime: body.date + "T" + seriesEndHHMM + ":00", timeZone: APEX_TIMEZONE },
                    recurrence: [buildRecurrenceRule(recurFreq, recurCount)],
                    conferenceData: {
                        createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } }
                    }
                };
                if (attendeeEmail) { seriesEventBody.attendees = [{ email: attendeeEmail }]; }
                var seriesRes = await googleCalendarApiCall(seriesToken, "POST", "/events?conferenceDataVersion=1", seriesEventBody);
                if (seriesRes.ok && seriesRes.data) {
                    googleEventId = seriesRes.data.id;
                    var seriesMeet = extractGoogleEventMeetLink(seriesRes.data);
                    if (seriesMeet) { meetLink = seriesMeet; }
                } else {
                    gcalError = googleApiErrMessage(seriesRes);
                }
            } catch (seriesErr) {
                gcalError = seriesErr.message;
            }
        }

        var sessionIds = [];
        for (var i = 0; i < recurCount; i++) {
            var occDate = recurFreq ? recurOccurrenceDate(body.date, recurFreq, i) : body.date;
            var sessionId = crypto.randomUUID();
            await env.DB.prepare(
                "INSERT INTO sessions (id, client_id, client_name, date, time, end_time, location, session_type, google_meet_link, google_event_id, calendar_provider, status, raw_transcript, meeting_category, series_id, created_by) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'apex', 'scheduled', ?, ?, ?, ?)"
            ).bind(sessionId, clientId, clientName, occDate, body.time, endTime, location, sessionType, meetLink, googleEventId, body.notes || null, meetingCategory, seriesId, actorName(user)).run();
            sessionIds.push(sessionId);
        }

        // Session scheduled for a lead → "Agendamento" (no-op for real clients).
        await advanceLeadStage(env, clientId, "Agendamento", actorName(user), "auto:session_scheduled");

        var session = await env.DB.prepare(
            "SELECT id, client_id, client_name, date, time, end_time, location, session_type, google_meet_link, status, whatsapp_sent_at, meeting_category, series_id, created_at " +
            "FROM sessions WHERE id = ?"
        ).bind(sessionIds[0]).first();

        return jsonOk({ session: session, sessions_created: sessionIds.length, series_id: seriesId, gcal_error: gcalError });
    } catch (e) {
        return jsonErr("Error scheduling session: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/sessions/calendar
// Query: month (YYYY-MM)
// Returns all sessions for the given month.
// ---------------------------------------------------------------------------

async function handleGetSessionsCalendar(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }

        var url   = new URL(request.url);
        var month = url.searchParams.get("month");
        if (!month || !/^\d{4}-\d{2}$/.test(month)) {
            return jsonErr("month query param required (format: YYYY-MM)", 400);
        }

        var res = await env.DB.prepare(
            "SELECT id, client_id, client_name, date, time, session_type, status, google_meet_link, whatsapp_sent_at, " +
            "google_event_id, calendar_provider, html_link, end_time, location, attendees, raw_transcript, pdf_data, meeting_category, series_id " +
            "FROM sessions WHERE date LIKE ? AND status != 'discarded' AND status != 'cancelled' ORDER BY date ASC, time ASC"
        ).bind(month + "-%").all();

        var sessions = res.results.map(function(row) {
            return {
                id:                 row.id,
                client_id:          row.client_id,
                client_name:        row.client_name,
                date:               row.date,
                time:               row.time,
                session_type:       row.session_type,
                status:             row.status,
                google_meet_link:   row.google_meet_link,
                whatsapp_sent_at:   row.whatsapp_sent_at,
                google_event_id:    row.google_event_id,
                calendar_provider:  row.calendar_provider,
                html_link:          row.html_link,
                end_time:           row.end_time,
                location:           row.location,
                attendees:          row.attendees ? JSON.parse(row.attendees) : null,
                has_transcript:     !!row.raw_transcript,
                has_pdf:            !!row.pdf_data,
                meeting_category:   row.meeting_category || "client",
                series_id:          row.series_id || null,
                // Notes live in raw_transcript until a real transcript
                // replaces them -- only expose while still just notes.
                notes:              row.status === "scheduled" ? (row.raw_transcript || null) : null
            };
        });

        return jsonOk({ sessions: sessions });
    } catch (e) {
        return jsonErr("Error fetching calendar: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/sessions/match-for-event
// Query: date (YYYY-MM-DD, required), time (HH:MM, optional), meet_link
//        (optional), exclude_id (optional -- the calendar event's own
//        session row id, if any, so a row never matches itself).
//
// Finds a session row elsewhere in D1 that captured a transcript/PDF for a
// given calendar event but isn't the same row -- this happens whenever
// Fireflies ingests a transcript as its own inbox row (see
// ingestFirefliesTranscript) rather than attaching it to the calendar
// event's row directly. Uses the same time-window + Meet-link overlap
// matching as findCalendarTitleForFireflies (Fireflies title-matching,
// calendar-events sync-back phase 2), just walked in the opposite
// direction: from a known calendar event to a candidate session row.
// Returns the best-matching row's transcript/PDF availability, or
// { match: null } if nothing was captured for this event.
// ---------------------------------------------------------------------------

async function handleGetSessionsMatchForEvent(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }

        var url       = new URL(request.url);
        var dateStr   = url.searchParams.get("date");
        var timeStr   = url.searchParams.get("time");
        var meetLink  = url.searchParams.get("meet_link");
        var excludeId = url.searchParams.get("exclude_id");
        if (!dateStr) { return jsonErr("date query param required (format: YYYY-MM-DD)", 400); }

        // 10-minute tolerance on each side, same as the Fireflies matcher.
        var windowStartMs = null;
        var windowEndMs   = null;
        if (timeStr) {
            var baseMs = new Date(dateStr + "T" + timeStr.slice(0,5) + ":00").getTime();
            if (!isNaN(baseMs)) {
                windowStartMs = baseMs - 10 * 60000;
                windowEndMs   = baseMs + 40 * 60000; // default 30-min meeting + 10-min tolerance
            }
        }

        var dayRows = await env.DB.prepare(
            "SELECT id, client_name, time, google_meet_link, raw_transcript, pdf_data, status " +
            "FROM sessions WHERE date = ? AND status != 'discarded' AND status != 'cancelled'"
        ).bind(dateStr).all();

        var best = null;
        for (var i = 0; i < dayRows.results.length; i++) {
            var row = dayRows.results[i];
            if (excludeId && row.id === excludeId) { continue; }
            if (!row.raw_transcript && !row.pdf_data) { continue; } // only candidates that captured something

            if (meetLink && row.google_meet_link && row.google_meet_link === meetLink) {
                best = row;
                break;
            }
            if (windowStartMs !== null && row.time) {
                var rowMs = new Date(dateStr + "T" + row.time.slice(0,5) + ":00").getTime();
                if (!isNaN(rowMs) && rowMs >= windowStartMs && rowMs <= windowEndMs) {
                    best = row;
                    break;
                }
            }
        }

        if (!best) { return jsonOk({ match: null }); }

        return jsonOk({
            match: {
                session_id:     best.id,
                client_name:    best.client_name,
                has_transcript: !!best.raw_transcript,
                has_pdf:        !!best.pdf_data,
                status:         best.status
            }
        });
    } catch (e) {
        return jsonErr("Error matching session for event: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/sessions/:id/whatsapp
// Generates a prefilled WhatsApp URL and updates whatsapp_sent_at.
// ---------------------------------------------------------------------------

var WEEKDAYS_PT = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

var DEFAULT_WHATSAPP_TEMPLATES = {
    session_in_person: "Olá! Sua sessão de consultoria está agendada para {weekday}, {date} às {time}.",
    session_online: "Olá! Sua sessão de consultoria está agendada para {weekday}, {date} às {time}. Acesse aqui: {meetLink}",
    portal_help_request: "Oi Rafa! Aqui é {clientName}. Preciso de ajuda com \"{label}\" no Portal Apex. Os números estão na sua aba de tarefas.",
    partner_referral_share: "Peça um orçamento por este link: {referralUrl}"
};

async function handlePostSessionWhatsapp(sessionId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }

        var session = await env.DB.prepare(
            "SELECT id, client_id, client_name, date, time, session_type, google_meet_link, status, meeting_category " +
            "FROM sessions WHERE id = ?"
        ).bind(sessionId).first();
        if (!session) { return jsonErr("Session not found", 404); }

        // Event entries (conferences, Apex Club) are not client sessions --
        // there is no client to message.
        if (session.meeting_category === "event") {
            return jsonErr("Event entries have no client to send WhatsApp to.", 400);
        }

        // Guard: an online_meet session with no real Meet link yet (still
        // the "[PENDING_GOOGLE_API]" placeholder stored when calendar-event
        // creation failed, or genuinely null) must never go out over
        // WhatsApp -- confirmed 2026-07-22 a real client received the
        // literal placeholder string in their message. The recurring-series
        // flow in calendar.html now deliberately saves placeholder rows when
        // a Meet-link creation fails mid-series (repairable via the detail
        // modal's Generate Meet link button), so this guard is what keeps
        // those rows -- and any other caller's -- away from clients.
        if (session.session_type !== "in_person" &&
            (!session.google_meet_link || session.google_meet_link === "[PENDING_GOOGLE_API]")) {
            return jsonErr("This session has no Google Meet link yet -- reconnect Google Calendar (add-user.html) and re-create the event before sending.", 409);
        }

        var d       = new Date(session.date + "T12:00:00");
        var weekday = WEEKDAYS_PT[d.getDay()];
        // American format (MM/DD/YYYY) -- this string goes to real clients,
        // matching the app-wide display convention shipped in datetime.js.
        var dateParts = session.date.split("-");
        var dateFormatted = dateParts[1] + "/" + dateParts[2] + "/" + dateParts[0];
        var time    = session.time || "";

        var templateKey = session.session_type === "in_person" ? "session_in_person" : "session_online";
        var templateRow = await env.DB.prepare(
            "SELECT template_text FROM message_templates WHERE template_key = ?"
        ).bind(templateKey).first();
        var templateText = (templateRow && templateRow.template_text) ? templateRow.template_text : DEFAULT_WHATSAPP_TEMPLATES[templateKey];
        var meetLink = session.google_meet_link || "";
        var message = templateText
            .split("{weekday}").join(weekday)
            .split("{date}").join(dateFormatted)
            .split("{time}").join(time)
            .split("{meetLink}").join(meetLink);

        var whatsappUrl = "https://wa.me/?text=" + encodeURIComponent(message);
        var sentAt      = new Date().toISOString();

        await env.DB.prepare("UPDATE sessions SET whatsapp_sent_at = ? WHERE id = ?")
            .bind(sentAt, sessionId).run();

        return jsonOk({ whatsapp_url: whatsappUrl, whatsapp_sent_at: sentAt });
    } catch (e) {
        return jsonErr("Error generating WhatsApp URL: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: PATCH /api/sessions/:id/meet-link
// Body: { google_meet_link, google_event_id? }
// Attaches a Google Meet link to an EXISTING session -- every other code
// path only ever sets google_meet_link at creation time, which left
// sessions stuck on the "[PENDING_GOOGLE_API]" placeholder unrepairable
// from the UI (a July 2026 incident left at least one such row live).
// The calendar detail modal's "Generate Meet link" button calls this after
// creating the calendar event. Refuses to store the placeholder itself:
// this route exists to replace it, never to write it.
// ---------------------------------------------------------------------------

async function handlePatchSessionMeetLink(sessionId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var body = await request.json();
        var meetLink = body.google_meet_link;
        if (!meetLink || typeof meetLink !== "string") {
            return jsonErr("google_meet_link is required", 400);
        }
        if (meetLink === "[PENDING_GOOGLE_API]") {
            return jsonErr("Refusing to store the placeholder link", 400);
        }

        var session = await env.DB.prepare(
            "SELECT id FROM sessions WHERE id = ?"
        ).bind(sessionId).first();
        if (!session) { return jsonErr("Session not found", 404); }

        await env.DB.prepare(
            "UPDATE sessions SET google_meet_link = ?, google_event_id = ? WHERE id = ?"
        ).bind(meetLink, body.google_event_id || null, sessionId).run();

        return jsonOk({ ok: true, google_meet_link: meetLink, google_event_id: body.google_event_id || null });
    } catch (e) {
        return jsonErr("Error updating Meet link: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Shared helpers for the session-mutation routes (cancel/reschedule/edit)
// and the RRULE-based recurring scheduling.
// ---------------------------------------------------------------------------

var ATTENDEE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The business operates from Florida. Every Google Calendar payload sends
// naive local wall-clock datetimes plus this IANA zone -- never a fixed UTC
// offset, so recurring instances stay at the same local time across DST.
// (A previous hardcoded "America/Sao_Paulo" here landed events an hour off:
// Sao Paulo has no DST and sits at UTC-3 while Florida summer is UTC-4.)
var APEX_TIMEZONE = "America/New_York";

// Minimal Google Calendar API call against the primary calendar. Returns
// { ok, status, data } -- never throws on HTTP errors (callers decide what
// a 404 means); throws only on timeout/network failure.
async function googleCalendarApiCall(accessToken, method, path, body) {
    var controller = new AbortController();
    var timer = setTimeout(function() { controller.abort(); }, 15000);
    var res;
    try {
        res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary" + path, {
            method: method,
            headers: { "Authorization": "Bearer " + accessToken, "Content-Type": "application/json" },
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal
        });
    } finally {
        clearTimeout(timer);
    }
    var data = null;
    if (res.status !== 204) {
        try { data = await res.json(); } catch (e) { data = null; }
    }
    return { ok: res.ok, status: res.status, data: data };
}

function googleApiErrMessage(result) {
    if (result.data && result.data.error && result.data.error.message) {
        return "Google Calendar API error: " + result.data.error.message;
    }
    return "Google Calendar API error (HTTP " + result.status + ")";
}

// Resolves the concrete instance id of ONE occurrence of a recurring Google
// event (series rows all store the master event id). Matched by the
// occurrence's stored D1 date.
// Returns { ok, instanceId, error }:
//   ok:true,  instanceId:string -> the instance to operate on
//   ok:true,  instanceId:null   -> Google VERIFIABLY has no instance on that
//                                  date (lookup succeeded, or the master is
//                                  404/410-gone) -- the occurrence is already
//                                  off the calendar
//   ok:false                    -> the lookup itself failed; callers must NOT
//                                  treat this as "already gone" and must not
//                                  change Apex state on the strength of it
async function findGoogleInstanceId(accessToken, masterEventId, dateStr) {
    var result;
    try {
        result = await googleCalendarApiCall(accessToken, "GET",
            "/events/" + encodeURIComponent(masterEventId) + "/instances?maxResults=60", null);
    } catch (e) {
        return { ok: false, instanceId: null, error: e.message };
    }
    if (result.status === 404 || result.status === 410) { return { ok: true, instanceId: null, error: null }; }
    if (!result.ok || !result.data || !result.data.items) {
        return { ok: false, instanceId: null, error: googleApiErrMessage(result) };
    }
    for (var i = 0; i < result.data.items.length; i++) {
        var inst = result.data.items[i];
        var startVal = inst.start && (inst.start.dateTime || inst.start.date);
        if (startVal && startVal.slice(0, 10) === dateStr) { return { ok: true, instanceId: inst.id, error: null }; }
    }
    return { ok: true, instanceId: null, error: null };
}

// Shared scope resolution for the cancel and reschedule routes: the series
// rows this session belongs to (active only), its position, and the derived
// cadence. ONE implementation so the two routes can never drift on which
// rows are "in scope". Returns null for non-series sessions.
async function loadSeriesContext(env, session) {
    if (!session.series_id) { return null; }
    var sr = await env.DB.prepare(
        "SELECT id, date, time, end_time, status FROM sessions WHERE series_id = ? AND status != 'cancelled' ORDER BY date ASC"
    ).bind(session.series_id).all();
    var rows = sr.results;
    var idx = -1;
    var dates = [];
    for (var i = 0; i < rows.length; i++) {
        dates.push(rows[i].date);
        if (rows[i].id === session.id) { idx = i; }
    }
    return { rows: rows, thisIdx: idx, freq: deriveSeriesFrequency(dates) };
}

// Maps the app's frequency options onto a native Google RRULE:
// weekly -> FREQ=WEEKLY, biweekly -> FREQ=WEEKLY;INTERVAL=2,
// monthly -> FREQ=MONTHLY. COUNT carries the occurrence count.
function buildRecurrenceRule(freq, count) {
    if (freq === "monthly")  { return "RRULE:FREQ=MONTHLY;COUNT=" + count; }
    if (freq === "biweekly") { return "RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=" + count; }
    return "RRULE:FREQ=WEEKLY;COUNT=" + count;
}

// Cadence of a stored series, derived from the dates of its OWN rows (these
// were generated by recurOccurrenceDate, so the gap is deterministic -- this
// is not the forbidden cross-meeting client/time/spacing heuristic).
// Single-row series fall back to weekly; nothing is left to derive from and
// nothing after this occurrence exists to move anyway.
function deriveSeriesFrequency(dates) {
    if (dates.length < 2) { return "weekly"; }
    var a = new Date(dates[0] + "T00:00:00Z").getTime();
    var b = new Date(dates[1] + "T00:00:00Z").getTime();
    var gap = Math.round((b - a) / 86400000);
    if (gap >= 21) { return "monthly"; }
    if (gap >= 10) { return "biweekly"; }
    return "weekly";
}

function addDaysToDateStr(dateStr, days) {
    var p = dateStr.split("-");
    var out = new Date(Date.UTC(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10) + days));
    function pad2(n) { return n < 10 ? "0" + n : "" + n; }
    return out.getUTCFullYear() + "-" + pad2(out.getUTCMonth() + 1) + "-" + pad2(out.getUTCDate());
}

function daysBetweenDateStr(fromStr, toStr) {
    var a = new Date(fromStr + "T00:00:00Z").getTime();
    var b = new Date(toStr + "T00:00:00Z").getTime();
    return Math.round((b - a) / 86400000);
}

function plusOneHourHHMM(hhmm) {
    var p = hhmm.split(":");
    var h = parseInt(p[0], 10) + 1;
    if (h > 23) { h = 23; }
    return (h < 10 ? "0" + h : "" + h) + ":" + p[1];
}

// end_time carries two shapes in D1 ("HH:MM" from the app, full ISO from the
// Google sync) -- normalize on read, never migrate stored values.
function endTimeHHMMFromRow(endVal) {
    if (!endVal) { return null; }
    if (endVal.indexOf("T") !== -1) { return endVal.slice(11, 16); }
    return endVal.slice(0, 5);
}

// The client's email as a Google Calendar attendee, only when the client
// record actually carries one that looks like an email (a malformed address
// would send a real invite to a stranger). Missing email = no attendee, no
// warning -- most clients have none on file and that is expected.
async function lookupClientAttendeeEmail(env, clientId) {
    if (!clientId) { return null; }
    var row = await env.DB.prepare("SELECT email FROM clients WHERE id = ?").bind(clientId).first();
    var email = row && row.email ? String(row.email).trim() : "";
    return ATTENDEE_EMAIL_RE.test(email) ? email : null;
}

// ---------------------------------------------------------------------------
// Route: POST /api/sessions/:id/cancel
// Body: { mode: "mistake" | "cancelled", scope?: "single"|"following"|"all" }
//   "mistake"   -> hard-deletes the session row(s) (nothing real happened)
//   "cancelled" -> keeps the row(s) with status='cancelled' (business history)
// scope (series sessions only; non-series always behave as 'single'):
//   'single'    -> this occurrence: delete its Google instance (or the master
//                  itself when this is the last active row using it)
//   'following' -> truncate the master's RRULE with UNTIL just before this
//                  occurrence, then remove this row and every later one
//   'all'       -> delete the Google master (all instances) and every row
// Externally-synced ('google_external') sessions are refused: they belong to
// Google. Legacy 'google'/'manual' rows are Apex-side history -- deletable,
// but no Google call is ever made for them.
//
// ORDERING IS THE CONTRACT HERE: Google is authoritative. The D1 change runs
// ONLY after the Google operation verifiably succeeded (or returned 404/410,
// which means the event is already gone -- the desired end state). On any
// other Google failure this returns ok:false / google_event_removed:false
// WITHOUT touching D1, so Apex and the client's calendar can never silently
// disagree about whether a meeting exists.
// ---------------------------------------------------------------------------

async function handlePostSessionCancel(sessionId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var body = await request.json();
        var mode = body.mode;
        if (mode !== "mistake" && mode !== "cancelled") {
            return jsonErr("mode must be 'mistake' or 'cancelled'", 400);
        }
        var scope = body.scope || "single";
        if (scope !== "single" && scope !== "following" && scope !== "all") {
            return jsonErr("scope must be single, following or all", 400);
        }

        var session = await env.DB.prepare(
            "SELECT id, google_event_id, calendar_provider, series_id, date, status FROM sessions WHERE id = ?"
        ).bind(sessionId).first();
        if (!session) { return jsonErr("Session not found", 404); }

        if (session.calendar_provider === "google_external") {
            return jsonErr("Externally-synced Google Calendar events cannot be cancelled from Apex -- remove them in Google Calendar itself.", 400);
        }

        var series = await loadSeriesContext(env, session);
        if (!series || series.thisIdx === -1) { scope = "single"; }
        // "Following" from the first occurrence IS the whole series.
        if (scope === "following" && series && series.thisIdx === 0) { scope = "all"; }

        var scopeRows = [session];
        if (scope === "all")       { scopeRows = series.rows; }
        if (scope === "following") { scopeRows = series.rows.slice(series.thisIdx); }

        // Phase 1: Google. Any outcome other than verified-removed /
        // verified-already-gone returns WITHOUT touching D1.
        var googleRemoved = null; // null = no Google event involved at all
        function googleFailed(msg) {
            return jsonOk({ ok: false, google_event_removed: false, google_error: msg });
        }
        if (session.calendar_provider === "apex" && session.google_event_id) {
            var accessToken;
            try {
                accessToken = await getGoogleAccessToken(env);
            } catch (tokenErr) {
                return googleFailed(tokenErr.message);
            }

            var targetEventId = session.google_event_id; // master (or standalone event)
            if (scope === "single" && session.series_id) {
                // Series rows share the master recurring event: while other
                // rows still use this google_event_id, delete only this
                // occurrence's instance, not the whole series.
                var siblings = await env.DB.prepare(
                    "SELECT COUNT(*) AS n FROM sessions WHERE google_event_id = ? AND id != ? AND status != 'cancelled'"
                ).bind(session.google_event_id, sessionId).first();
                if (siblings && siblings.n > 0) {
                    var lookup = await findGoogleInstanceId(accessToken, session.google_event_id, session.date);
                    if (!lookup.ok) { return googleFailed(lookup.error); }
                    targetEventId = lookup.instanceId; // null -> verifiably already gone
                }
            }

            if (scope === "following") {
                // Same truncation Google's own UI performs: strip COUNT/UNTIL
                // from the master's rule, add UNTIL just before this occurrence.
                var masterRes;
                try {
                    masterRes = await googleCalendarApiCall(accessToken, "GET",
                        "/events/" + encodeURIComponent(session.google_event_id), null);
                } catch (mErr) { return googleFailed(mErr.message); }
                if (masterRes.status === 404 || masterRes.status === 410) {
                    googleRemoved = true; // whole series already gone
                } else if (!masterRes.ok || !masterRes.data) {
                    return googleFailed(googleApiErrMessage(masterRes));
                } else {
                    var oldRule = (masterRes.data.recurrence && masterRes.data.recurrence[0]) || buildRecurrenceRule(series.freq, series.rows.length);
                    var truncated = oldRule
                        .replace(/;COUNT=\d+/i, "")
                        .replace(/;UNTIL=[0-9TZ]+/i, "")
                        + ";UNTIL=" + addDaysToDateStr(session.date, -1).split("-").join("") + "T235959Z";
                    var truncRes;
                    try {
                        truncRes = await googleCalendarApiCall(accessToken, "PATCH",
                            "/events/" + encodeURIComponent(session.google_event_id), { recurrence: [truncated] });
                    } catch (tErr) { return googleFailed(tErr.message); }
                    if (truncRes.ok || truncRes.status === 404 || truncRes.status === 410) {
                        googleRemoved = true;
                    } else {
                        return googleFailed(googleApiErrMessage(truncRes));
                    }
                }
            } else if (!targetEventId) {
                googleRemoved = true; // verified: no instance on that date
            } else {
                // 'single' and 'all' are both one DELETE: the instance id for
                // a shared occurrence, the master id otherwise.
                var delRes;
                try {
                    delRes = await googleCalendarApiCall(accessToken, "DELETE",
                        "/events/" + encodeURIComponent(targetEventId), null);
                } catch (delErr) { return googleFailed(delErr.message); }
                if (delRes.ok || delRes.status === 404 || delRes.status === 410) {
                    googleRemoved = true;
                } else {
                    return googleFailed(googleApiErrMessage(delRes));
                }
            }
        }

        // Phase 2: D1 -- reached only when Google verifiably succeeded (or
        // there was no Google event to remove).
        for (var i = 0; i < scopeRows.length; i++) {
            if (mode === "mistake") {
                await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(scopeRows[i].id).run();
            } else {
                await env.DB.prepare("UPDATE sessions SET status = 'cancelled' WHERE id = ?").bind(scopeRows[i].id).run();
            }
        }

        return jsonOk({ ok: true, mode: mode, scope: scope, updated: scopeRows.length, google_event_removed: googleRemoved, google_error: null });
    } catch (e) {
        return jsonErr("Error cancelling session: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/sessions/:id/reschedule
// Body: { date, time, end_time?, scope? }  scope: 'single'|'following'|'all'
// Apex-created sessions only. PATCHes the existing Google event (preserving
// the Meet link; Google notifies attendees) instead of delete+recreate.
// Series semantics mirror Google Calendar's own UI:
//   'single'    -> move one instance (resolved via the instances endpoint)
//   'following' -> truncate the master's RRULE with UNTIL just before this
//                  occurrence, then create a NEW recurring event for the
//                  remainder (this is how Google's own UI implements it --
//                  there is no native this-and-following API operation)
//   'all'       -> move the master's start; Google regenerates instances,
//                  and the local rows are regenerated the same way
// Google failures other than 404/410 abort BEFORE any D1 change so Apex and
// the client's calendar can never silently disagree about a meeting time.
// ---------------------------------------------------------------------------

async function handlePostSessionReschedule(sessionId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var body = await request.json();
        if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) { return jsonErr("date must be YYYY-MM-DD", 400); }
        if (!body.time || !/^\d{2}:\d{2}$/.test(body.time))       { return jsonErr("time must be HH:MM", 400); }
        var newEnd = null;
        if (body.end_time) {
            if (!/^\d{2}:\d{2}$/.test(body.end_time)) { return jsonErr("end_time must be HH:MM", 400); }
            if (body.end_time <= body.time) { return jsonErr("end_time must be after time", 400); }
            newEnd = body.end_time;
        }
        var scope = body.scope || "single";
        if (scope !== "single" && scope !== "following" && scope !== "all") {
            return jsonErr("scope must be single, following or all", 400);
        }

        var session = await env.DB.prepare(
            "SELECT id, client_name, date, time, end_time, session_type, google_event_id, calendar_provider, series_id, status " +
            "FROM sessions WHERE id = ?"
        ).bind(sessionId).first();
        if (!session) { return jsonErr("Session not found", 404); }
        if (session.calendar_provider === "google_external") {
            return jsonErr("Externally-synced Google Calendar events cannot be rescheduled from Apex -- change them in Google Calendar itself.", 400);
        }
        if (session.calendar_provider !== "apex") {
            return jsonErr("Legacy sessions are read-only history and cannot be rescheduled.", 400);
        }

        // The Google event PATCH needs an end; default to start-plus-one-hour
        // (same convention as event creation) when none was given or stored.
        var googleEndHHMM = newEnd || endTimeHHMMFromRow(session.end_time);
        if (!googleEndHHMM || googleEndHHMM <= body.time) { googleEndHHMM = plusOneHourHHMM(body.time); }

        var hasGoogle = session.calendar_provider === "apex" && !!session.google_event_id;
        var accessToken = null;
        if (hasGoogle) {
            try {
                accessToken = await getGoogleAccessToken(env);
            } catch (tokenErr) {
                // Refuse rather than diverge: an Apex-side move with the
                // Google event stuck at the old time would show the client a
                // wrong calendar while Apex believes it moved.
                return jsonErr("Cannot reschedule while Google Calendar is not connected: " + tokenErr.message, 502);
            }
        }

        var googleWarning = null;
        var startDT = { dateTime: body.date + "T" + body.time + ":00", timeZone: APEX_TIMEZONE };
        var endDT   = { dateTime: body.date + "T" + googleEndHHMM + ":00", timeZone: APEX_TIMEZONE };

        // Load the series rows once for any series-aware path (same shared
        // resolver the cancel route uses).
        var series = await loadSeriesContext(env, session);
        var seriesRows = series ? series.rows : null;
        var seriesFreq = series ? series.freq : null;
        var thisIdx    = series ? series.thisIdx : -1;
        if (!session.series_id || thisIdx === -1) { scope = "single"; }
        // "Following" from the first occurrence IS the whole series.
        if (scope === "following" && thisIdx === 0) { scope = "all"; }

        if (scope === "single") {
            if (hasGoogle) {
                var targetId = session.google_event_id;
                if (session.series_id) {
                    var others = await env.DB.prepare(
                        "SELECT COUNT(*) AS n FROM sessions WHERE google_event_id = ? AND id != ? AND status != 'cancelled'"
                    ).bind(session.google_event_id, sessionId).first();
                    if (others && others.n > 0) {
                        var lookup = await findGoogleInstanceId(accessToken, session.google_event_id, session.date);
                        // Lookup FAILURE is not "already gone" -- refuse to
                        // move the Apex side while Google's state is unknown.
                        if (!lookup.ok) { return jsonErr(lookup.error, 502); }
                        targetId = lookup.instanceId;
                        if (!targetId) { googleWarning = "No matching Google Calendar instance was found for this occurrence -- only the Apex side was updated."; }
                    }
                }
                if (targetId) {
                    var patchRes = await googleCalendarApiCall(accessToken, "PATCH",
                        "/events/" + encodeURIComponent(targetId), { start: startDT, end: endDT });
                    if (!patchRes.ok) {
                        if (patchRes.status === 404 || patchRes.status === 410) {
                            googleWarning = "The Google Calendar event no longer exists -- only the Apex side was updated.";
                        } else {
                            return jsonErr(googleApiErrMessage(patchRes), 502);
                        }
                    }
                }
            }
            await env.DB.prepare(
                "UPDATE sessions SET date = ?, time = ?, end_time = ? WHERE id = ?"
            ).bind(body.date, body.time, newEnd, sessionId).run();
            return jsonOk({ ok: true, scope: "single", updated: 1, google_warning: googleWarning });
        }

        if (scope === "following") {
            var followingRows = seriesRows.slice(thisIdx);
            var newMasterId = session.google_event_id;
            var newMeetLink = null;
            if (hasGoogle) {
                var masterRes = await googleCalendarApiCall(accessToken, "GET",
                    "/events/" + encodeURIComponent(session.google_event_id), null);
                if (!masterRes.ok) {
                    if (masterRes.status === 404 || masterRes.status === 410) {
                        googleWarning = "The Google Calendar series no longer exists -- only the Apex side was updated.";
                        newMasterId = null;
                    } else {
                        return jsonErr(googleApiErrMessage(masterRes), 502);
                    }
                } else {
                    var master = masterRes.data;
                    // Truncate the original rule the way Google's UI does:
                    // strip COUNT/UNTIL, add UNTIL just before this occurrence.
                    var oldRule = (master.recurrence && master.recurrence[0]) || buildRecurrenceRule(seriesFreq, seriesRows.length);
                    var truncated = oldRule
                        .replace(/;COUNT=\d+/i, "")
                        .replace(/;UNTIL=[0-9TZ]+/i, "")
                        + ";UNTIL=" + addDaysToDateStr(session.date, -1).split("-").join("") + "T235959Z";
                    var truncRes = await googleCalendarApiCall(accessToken, "PATCH",
                        "/events/" + encodeURIComponent(session.google_event_id), { recurrence: [truncated] });
                    if (!truncRes.ok && truncRes.status !== 404 && truncRes.status !== 410) {
                        return jsonErr(googleApiErrMessage(truncRes), 502);
                    }
                    var newEventBody = {
                        summary:     master.summary || session.client_name,
                        description: master.description || undefined,
                        location:    master.location || undefined,
                        start: startDT,
                        end:   endDT,
                        recurrence: [buildRecurrenceRule(seriesFreq, followingRows.length)]
                    };
                    if (master.attendees && master.attendees.length) {
                        newEventBody.attendees = master.attendees.map(function(a) { return { email: a.email }; });
                    }
                    if (session.session_type === "online_meet") {
                        newEventBody.conferenceData = {
                            createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } }
                        };
                    }
                    var createRes = await googleCalendarApiCall(accessToken, "POST",
                        "/events?conferenceDataVersion=1", newEventBody);
                    if (!createRes.ok || !createRes.data) {
                        return jsonErr(googleApiErrMessage(createRes), 502);
                    }
                    newMasterId = createRes.data.id;
                    newMeetLink = extractGoogleEventMeetLink(createRes.data);
                }
            }
            for (var fi = 0; fi < followingRows.length; fi++) {
                var occDateF = recurOccurrenceDate(body.date, seriesFreq, fi);
                if (newMeetLink) {
                    await env.DB.prepare(
                        "UPDATE sessions SET date = ?, time = ?, end_time = ?, google_event_id = ?, google_meet_link = ? WHERE id = ?"
                    ).bind(occDateF, body.time, newEnd, newMasterId, newMeetLink, followingRows[fi].id).run();
                } else {
                    await env.DB.prepare(
                        "UPDATE sessions SET date = ?, time = ?, end_time = ?, google_event_id = ? WHERE id = ?"
                    ).bind(occDateF, body.time, newEnd, newMasterId, followingRows[fi].id).run();
                }
            }
            return jsonOk({ ok: true, scope: "following", updated: followingRows.length, google_warning: googleWarning });
        }

        // scope === "all": shift the whole series by this occurrence's delta.
        var deltaDays = daysBetweenDateStr(session.date, body.date);
        var newFirstDate = addDaysToDateStr(seriesRows ? seriesRows[0].date : session.date, deltaDays);
        if (hasGoogle) {
            var allStart = { dateTime: newFirstDate + "T" + body.time + ":00", timeZone: APEX_TIMEZONE };
            var allEnd   = { dateTime: newFirstDate + "T" + googleEndHHMM + ":00", timeZone: APEX_TIMEZONE };
            var allRes = await googleCalendarApiCall(accessToken, "PATCH",
                "/events/" + encodeURIComponent(session.google_event_id), { start: allStart, end: allEnd });
            if (!allRes.ok) {
                if (allRes.status === 404 || allRes.status === 410) {
                    googleWarning = "The Google Calendar event no longer exists -- only the Apex side was updated.";
                } else {
                    return jsonErr(googleApiErrMessage(allRes), 502);
                }
            }
        }
        var rowsToMove = seriesRows || [ { id: session.id } ];
        for (var ai = 0; ai < rowsToMove.length; ai++) {
            var occDateA = seriesRows ? recurOccurrenceDate(newFirstDate, seriesFreq, ai) : body.date;
            await env.DB.prepare(
                "UPDATE sessions SET date = ?, time = ?, end_time = ? WHERE id = ?"
            ).bind(occDateA, body.time, newEnd, rowsToMove[ai].id).run();
        }
        return jsonOk({ ok: true, scope: "all", updated: rowsToMove.length, google_warning: googleWarning });
    } catch (e) {
        return jsonErr("Error rescheduling session: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: PATCH /api/sessions/:id
// Body: { location?, notes?, end_time? } -- only supplied fields change.
// Edit of location / notes / end time. Apex-created sessions only (legacy
// rows are read-only history; external rows belong to Google).
// Google side: an end-time change PATCHes the event's end so the calendar
// duration stays right; a location change PATCHes the event's location so
// the client's own calendar entry carries the address.
// Notes live in raw_transcript for scheduled sessions (that is where the
// schedule route writes them) -- refuse to touch that column once a real
// transcript may have replaced them.
// ---------------------------------------------------------------------------

async function handlePatchSessionDetails(sessionId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var body = await request.json();
        var hasLocation = Object.prototype.hasOwnProperty.call(body, "location");
        var hasNotes    = Object.prototype.hasOwnProperty.call(body, "notes");
        var hasEnd      = Object.prototype.hasOwnProperty.call(body, "end_time");
        if (!hasLocation && !hasNotes && !hasEnd) {
            return jsonErr("Nothing to update -- provide location, notes and/or end_time", 400);
        }

        var session = await env.DB.prepare(
            "SELECT id, date, time, end_time, location, session_type, google_event_id, calendar_provider, series_id, status " +
            "FROM sessions WHERE id = ?"
        ).bind(sessionId).first();
        if (!session) { return jsonErr("Session not found", 404); }
        if (session.calendar_provider === "google_external") {
            return jsonErr("Externally-synced Google Calendar events cannot be edited from Apex.", 400);
        }
        if (session.calendar_provider !== "apex") {
            return jsonErr("Legacy sessions are read-only history and cannot be edited.", 400);
        }

        var newLocation = hasLocation ? ((body.location && String(body.location).trim()) || null) : session.location;
        var newEnd = null;
        if (hasEnd && body.end_time) {
            if (!/^\d{2}:\d{2}$/.test(body.end_time)) { return jsonErr("end_time must be HH:MM", 400); }
            if (session.time && body.end_time <= session.time.slice(0, 5)) {
                return jsonErr("end_time must be after the session's start time", 400);
            }
            newEnd = body.end_time;
        }
        if (hasNotes && session.status !== "scheduled") {
            return jsonErr("Notes can only be edited while the session is still scheduled.", 400);
        }

        // Google event PATCH when the change affects the calendar entry.
        var googleWarning = null;
        var patchBody = {};
        if (hasEnd && newEnd && session.time) {
            patchBody.end = { dateTime: session.date + "T" + newEnd + ":00", timeZone: APEX_TIMEZONE };
        }
        if (hasLocation) {
            patchBody.location = newLocation || "";
        }
        if (session.google_event_id && (patchBody.end || hasLocation)) {
            var accessToken = null;
            try {
                accessToken = await getGoogleAccessToken(env);
            } catch (tokenErr) {
                return jsonErr("Cannot edit while Google Calendar is not connected: " + tokenErr.message, 502);
            }
            var targetId = session.google_event_id;
            if (session.series_id) {
                var others = await env.DB.prepare(
                    "SELECT COUNT(*) AS n FROM sessions WHERE google_event_id = ? AND id != ? AND status != 'cancelled'"
                ).bind(session.google_event_id, sessionId).first();
                if (others && others.n > 0) {
                    var lookup = await findGoogleInstanceId(accessToken, session.google_event_id, session.date);
                    if (!lookup.ok) { return jsonErr(lookup.error, 502); }
                    targetId = lookup.instanceId;
                    if (!targetId) { googleWarning = "No matching Google Calendar instance was found -- only the Apex side was updated."; }
                }
            }
            if (targetId) {
                var patchRes = await googleCalendarApiCall(accessToken, "PATCH",
                    "/events/" + encodeURIComponent(targetId), patchBody);
                if (!patchRes.ok) {
                    if (patchRes.status === 404 || patchRes.status === 410) {
                        googleWarning = "The Google Calendar event no longer exists -- only the Apex side was updated.";
                    } else {
                        return jsonErr(googleApiErrMessage(patchRes), 502);
                    }
                }
            }
        }

        var sets = [];
        var binds = [];
        if (hasLocation) { sets.push("location = ?");       binds.push(newLocation); }
        if (hasEnd)      { sets.push("end_time = ?");       binds.push(newEnd); }
        if (hasNotes)    { sets.push("raw_transcript = ?"); binds.push((body.notes && String(body.notes).trim()) || null); }
        binds.push(sessionId);
        var stmt = env.DB.prepare("UPDATE sessions SET " + sets.join(", ") + " WHERE id = ?");
        await stmt.bind.apply(stmt, binds).run();

        return jsonOk({ ok: true, google_warning: googleWarning });
    } catch (e) {
        return jsonErr("Error editing session: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/google/oauth/start
// Auth: developer only. Returns Google OAuth authorization URL as JSON.
// ---------------------------------------------------------------------------

async function handleGoogleOAuthStart(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        // Generate a cryptographically-random state value and store it server-side
        // (bound to the initiating developer) so the callback can verify it.
        // Expires in 10 minutes — enough for the consent screen, short enough to limit replay window.
        var state     = crypto.randomUUID();
        var expiresAt = Math.floor(Date.now() / 1000) + 600;

        await env.DB.prepare(
            "INSERT INTO oauth_state (state, initiated_by, expires_at) VALUES (?, ?, ?)"
        ).bind(state, user.email, expiresAt).run();

        // Purge any expired state rows to keep the table tidy
        await env.DB.prepare(
            "DELETE FROM oauth_state WHERE expires_at < ?"
        ).bind(Math.floor(Date.now() / 1000)).run();

        var params = new URLSearchParams();
        params.set("client_id",     env.GOOGLE_CALENDAR_CLIENT_ID);
        params.set("redirect_uri",  "https://apex-api.farfromtimnah.workers.dev/api/google/oauth/callback");
        params.set("response_type", "code");
        params.set("scope",         "https://www.googleapis.com/auth/calendar");
        params.set("access_type",   "offline");
        params.set("prompt",        "consent");
        params.set("state",         state);

        var authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString();
        return jsonOk({ auth_url: authUrl });
    } catch (e) {
        return jsonErr("Error building OAuth URL: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/google/oauth/callback
// No auth — called by Google after user consent. Exchanges code for tokens.
// ---------------------------------------------------------------------------

async function handleGoogleOAuthCallback(request, env) {
    try {
        var url   = new URL(request.url);
        var code  = url.searchParams.get("code");
        var state = url.searchParams.get("state");
        if (!code)  { return jsonErr("Missing code parameter", 400); }
        if (!state) { return jsonErr("Missing state parameter", 400); }

        // Verify state: must exist in D1, must not be expired, delete on first use (no replay)
        var stateRow = await env.DB.prepare(
            "SELECT initiated_by, expires_at FROM oauth_state WHERE state = ?"
        ).bind(state).first();

        if (!stateRow) { return jsonErr("Invalid or unknown state parameter", 400); }

        await env.DB.prepare("DELETE FROM oauth_state WHERE state = ?").bind(state).run();

        if (stateRow.expires_at < Math.floor(Date.now() / 1000)) {
            return jsonErr("OAuth state expired -- please start the flow again", 400);
        }

        var controller = new AbortController();
        var timer = setTimeout(function() { controller.abort(); }, 15000);

        var tokenRes;
        try {
            tokenRes = await fetch("https://oauth2.googleapis.com/token", {
                method:  "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body:    new URLSearchParams({
                    code:          code,
                    client_id:     env.GOOGLE_CALENDAR_CLIENT_ID,
                    client_secret: env.GOOGLE_CALENDAR_CLIENT_SECRET,
                    redirect_uri:  "https://apex-api.farfromtimnah.workers.dev/api/google/oauth/callback",
                    grant_type:    "authorization_code"
                }).toString(),
                signal: controller.signal
            });
        } finally {
            clearTimeout(timer);
        }

        var tokenData = await tokenRes.json();
        if (!tokenRes.ok) {
            return jsonErr("Token exchange failed: " + (tokenData.error_description || tokenData.error || "unknown"), 502);
        }

        var refreshToken = tokenData.refresh_token;
        if (!refreshToken) {
            return jsonErr("No refresh token returned -- ensure prompt=consent was set", 400);
        }

        var scope = tokenData.scope || null;

        await env.DB.prepare(
            "INSERT OR REPLACE INTO oauth_tokens (id, refresh_token, scope, updated_at) VALUES ('google_calendar', ?, ?, datetime('now'))"
        ).bind(refreshToken, scope).run();

        return jsonOk({ ok: true, message: "Google Calendar connected successfully" });
    } catch (e) {
        if (e.name === "AbortError") { return jsonErr("Token exchange timed out", 504); }
        return jsonErr("OAuth callback error: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/google/oauth/status
// Auth: developer, alice, or rafa. Returns { connected: true/false } — never the token.
// ---------------------------------------------------------------------------

async function handleGoogleOAuthStatus(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "developer" && user.role !== "alice" && user.role !== "rafa") { return jsonErr("Forbidden", 403); }

        var row = await env.DB.prepare(
            "SELECT id FROM oauth_tokens WHERE id = 'google_calendar'"
        ).first();

        return jsonOk({ connected: !!row });
    } catch (e) {
        return jsonErr("Error checking OAuth status: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Shared helper: exchanges the stored google_calendar refresh token for a
// fresh access token. Used by every handler that calls the Calendar API.
// Access tokens are never cached/stored -- only the refresh token persists.
// Returns the access token string, or throws with a descriptive message.
// ---------------------------------------------------------------------------

async function getGoogleAccessToken(env) {
    var tokenRow = await env.DB.prepare(
        "SELECT refresh_token FROM oauth_tokens WHERE id = 'google_calendar'"
    ).first();
    if (!tokenRow) { throw new Error("Google Calendar not connected"); }

    var controller = new AbortController();
    var timer = setTimeout(function() { controller.abort(); }, 15000);

    var refreshRes;
    try {
        refreshRes = await fetch("https://oauth2.googleapis.com/token", {
            method:  "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body:    new URLSearchParams({
                client_id:     env.GOOGLE_CALENDAR_CLIENT_ID,
                client_secret: env.GOOGLE_CALENDAR_CLIENT_SECRET,
                refresh_token: tokenRow.refresh_token,
                grant_type:    "refresh_token"
            }).toString(),
            signal: controller.signal
        });
    } finally {
        clearTimeout(timer);
    }

    var refreshData = await refreshRes.json();
    if (!refreshRes.ok) {
        throw new Error("Failed to refresh access token: " + (refreshData.error_description || refreshData.error || "unknown"));
    }
    return refreshData.access_token;
}

// ---------------------------------------------------------------------------
// Route: POST /api/google/calendar/event
// Auth: any role. Creates a Google Calendar event using stored refresh token.
// Access token is used in memory only and never stored or returned.
// ---------------------------------------------------------------------------

async function handlePostGoogleCalendarEvent(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }

        var body = await request.json();
        if (!body.summary)        { return jsonErr("summary is required", 400); }
        if (!body.start_datetime) { return jsonErr("start_datetime is required", 400); }
        if (!body.end_datetime)   { return jsonErr("end_datetime is required", 400); }

        var accessToken;
        try {
            accessToken = await getGoogleAccessToken(env);
        } catch (tokenErr) {
            var code = tokenErr.message === "Google Calendar not connected" ? 400 : 502;
            return jsonErr(tokenErr.message, code);
        }

        // Build event body
        var eventBody = {
            summary:     body.summary,
            description: body.description || undefined,
            start: { dateTime: body.start_datetime, timeZone: APEX_TIMEZONE },
            end:   { dateTime: body.end_datetime,   timeZone: APEX_TIMEZONE }
        };

        if (body.add_meet_link) {
            eventBody.conferenceData = {
                createRequest: {
                    requestId: crypto.randomUUID(),
                    conferenceSolutionKey: { type: "hangoutsMeet" }
                }
            };
        }

        // Optional single attendee (the client's email, when their record has
        // one) -- validated because a malformed address would send a real
        // Google invite to a stranger.
        if (body.attendee_email) {
            var attendeeEmail = String(body.attendee_email).trim();
            if (!ATTENDEE_EMAIL_RE.test(attendeeEmail)) {
                return jsonErr("attendee_email is not a valid email address", 400);
            }
            eventBody.attendees = [{ email: attendeeEmail }];
        }

        var calUrl = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
        if (body.add_meet_link) { calUrl += "?conferenceDataVersion=1"; }

        var calController = new AbortController();
        var calTimer = setTimeout(function() { calController.abort(); }, 15000);

        var calRes;
        try {
            calRes = await fetch(calUrl, {
                method:  "POST",
                headers: {
                    "Authorization": "Bearer " + accessToken,
                    "Content-Type":  "application/json"
                },
                body:   JSON.stringify(eventBody),
                signal: calController.signal
            });
        } finally {
            clearTimeout(calTimer);
        }

        // Discard accessToken — it is never stored
        accessToken = null;

        var calData = await calRes.json();
        if (!calRes.ok) {
            return jsonErr("Google Calendar API error: " + (calData.error && calData.error.message ? calData.error.message : JSON.stringify(calData)), calRes.status);
        }

        var meetLink = null;
        if (calData.conferenceData && calData.conferenceData.entryPoints && calData.conferenceData.entryPoints[0]) {
            meetLink = calData.conferenceData.entryPoints[0].uri || null;
        }

        return jsonOk({
            google_event_id:  calData.id,
            google_meet_link: meetLink,
            html_link:        calData.htmlLink
        });
    } catch (e) {
        if (e.name === "AbortError") { return jsonErr("Google API request timed out", 504); }
        return jsonErr("Error creating calendar event: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Shared helper: fetches raw events from Rafa's primary Google Calendar for
// a given [timeMin, timeMax] ISO window. Returns Google's raw event objects
// (not filtered against D1) -- callers decide what to do with them. Used by
// both the calendar sync-back route and the Fireflies title-matcher.
// ---------------------------------------------------------------------------

async function listGoogleCalendarEvents(env, timeMinISO, timeMaxISO) {
    var accessToken = await getGoogleAccessToken(env);

    var params = new URLSearchParams();
    params.set("timeMin", timeMinISO);
    params.set("timeMax", timeMaxISO);
    params.set("singleEvents", "true");
    params.set("orderBy", "startTime");
    params.set("maxResults", "250");

    var listController = new AbortController();
    var listTimer = setTimeout(function() { listController.abort(); }, 15000);

    var listRes;
    try {
        listRes = await fetch(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events?" + params.toString(),
            { headers: { "Authorization": "Bearer " + accessToken }, signal: listController.signal }
        );
    } finally {
        clearTimeout(listTimer);
    }

    var listData = await listRes.json();
    if (!listRes.ok) {
        throw new Error("Google Calendar API error: " + (listData.error && listData.error.message ? listData.error.message : JSON.stringify(listData)));
    }
    return listData.items || [];
}

function extractGoogleEventMeetLink(ev) {
    if (ev.conferenceData && ev.conferenceData.entryPoints && ev.conferenceData.entryPoints[0]) {
        return ev.conferenceData.entryPoints[0].uri || null;
    }
    if (ev.hangoutLink) { return ev.hangoutLink; }
    return null;
}

// ---------------------------------------------------------------------------
// Route: GET /api/google/calendar/events
// Auth: any role. Lists events from Rafa's primary Google Calendar (-7d to
// +30d from today) using the stored refresh token, persists any event not
// already known to D1 (matched by google_event_id) as a real `sessions` row
// with calendar_provider='google_external', and returns the full set of
// externally-sourced rows currently in that window (from D1, not the live
// Google response) so the rest of the app can query them uniformly via the
// normal sessions table instead of calendar.html being a special case.
// Persistence happens on every call (i.e. every calendar.html page load) --
// there is no background sync; this route is the sync trigger.
// ---------------------------------------------------------------------------

async function handleGetGoogleCalendarEvents(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }

        var now     = Date.now();
        var timeMin = new Date(now - 7  * 86400000).toISOString();
        var timeMax = new Date(now + 30 * 86400000).toISOString();

        var items;
        try {
            items = await listGoogleCalendarEvents(env, timeMin, timeMax);
        } catch (listErr) {
            var code = listErr.message === "Google Calendar not connected" ? 400 : 502;
            return jsonErr(listErr.message, code);
        }

        // Pull every google_event_id already known to D1 -- along with the
        // synced fields and calendar_provider -- so we can (a) avoid inserting
        // duplicates, (b) refresh externally-sourced rows when Rafa edits the
        // event on the Google Calendar side, and (c) never overwrite
        // Apex-created sessions (any calendar_provider other than
        // 'google_external').
        var knownRows = await env.DB.prepare(
            "SELECT id, google_event_id, calendar_provider, client_name, date, time, session_type, " +
            "google_meet_link, html_link, end_time, attendees " +
            "FROM sessions WHERE google_event_id IS NOT NULL AND google_event_id != ''"
        ).all();
        var known = {};
        for (var k = 0; k < knownRows.results.length; k++) {
            known[knownRows.results[k].google_event_id] = knownRows.results[k];
        }

        for (var i = 0; i < items.length; i++) {
            var ev = items[i];
            if (!ev.id) { continue; }
            if (ev.status === "cancelled") { continue; }

            // Instances of a recurring event Apex itself created must never be
            // filed as new external events. The list call runs with
            // singleEvents=true, so an Apex-created RRULE series comes back as
            // N instances whose ids ("<masterId>_20260726T140000Z") never
            // equal the master id Apex stored. Google marks every such
            // instance with recurringEventId = the master's id (Events
            // resource, Calendar API v3) -- when that parent is a known
            // non-external row, the series is Apex-owned and the instance is
            // already represented by Apex's own session rows.
            if (ev.recurringEventId && known[ev.recurringEventId] &&
                known[ev.recurringEventId].calendar_provider !== "google_external") {
                continue;
            }

            var startVal = (ev.start && (ev.start.dateTime || ev.start.date)) || null;
            var endVal   = (ev.end   && (ev.end.dateTime   || ev.end.date))   || null;
            if (!startVal) { continue; }

            var isAllDay = !(ev.start && ev.start.dateTime);
            var datePart = isAllDay ? startVal : startVal.slice(0, 10);
            var timePart = isAllDay ? null     : startVal.slice(11, 16);
            var meetLink = extractGoogleEventMeetLink(ev);
            var sessionType = meetLink ? "online_meet" : "in_person";
            var title = ev.summary || "(No title)";
            var htmlLink = ev.htmlLink || null;
            var attendeesJson = null;
            if (ev.attendees && ev.attendees.length) {
                attendeesJson = JSON.stringify(ev.attendees.map(function(a) {
                    return { email: a.email || null, name: a.displayName || null, response_status: a.responseStatus || null };
                }));
            }

            var existing = known[ev.id];
            if (existing) {
                // Only reconcile events we originally synced from Google. Apex-created
                // sessions that happen to carry a google_event_id are left untouched.
                if (existing.calendar_provider !== "google_external") { continue; }

                var changed =
                    (existing.client_name      || null) !== (title         || null) ||
                    (existing.date             || null) !== (datePart      || null) ||
                    (existing.time             || null) !== (timePart      || null) ||
                    (existing.session_type     || null) !== (sessionType   || null) ||
                    (existing.google_meet_link || null) !== (meetLink      || null) ||
                    (existing.html_link        || null) !== (htmlLink      || null) ||
                    (existing.end_time         || null) !== (endVal        || null) ||
                    (existing.attendees        || null) !== (attendeesJson || null);

                if (changed) {
                    await env.DB.prepare(
                        "UPDATE sessions SET client_name = ?, date = ?, time = ?, session_type = ?, " +
                        "google_meet_link = ?, html_link = ?, end_time = ?, attendees = ? " +
                        "WHERE id = ?"
                    ).bind(
                        title,
                        datePart,
                        timePart,
                        sessionType,
                        meetLink,
                        htmlLink,
                        endVal,
                        attendeesJson,
                        existing.id
                    ).run();
                }
                continue;
            }

            await env.DB.prepare(
                // created_by 'google_calendar': mirrored in from an external
                // calendar, so no Apex person created it. Named rather than
                // left NULL, which stays reserved for genuinely unknown rows.
                "INSERT INTO sessions (id, client_name, date, time, session_type, google_meet_link, google_event_id, calendar_provider, status, html_link, end_time, attendees, created_by) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?, 'google_external', 'scheduled', ?, ?, ?, 'google_calendar')"
            ).bind(
                crypto.randomUUID(),
                title,
                datePart,
                timePart,
                sessionType,
                meetLink,
                ev.id,
                htmlLink,
                endVal,
                attendeesJson
            ).run();
            // Guard against dupes within the same Google page of results. Mark it
            // as an external row so a repeated id in this batch is treated as an
            // already-synced event, not re-inserted.
            known[ev.id] = { id: null, calendar_provider: "google_external" };
        }

        // Return every externally-sourced row currently in D1 for this window,
        // read back from the table (not the live fetch) so this endpoint
        // reflects persisted state.
        var minDate = timeMin.slice(0, 10);
        var maxDate = timeMax.slice(0, 10);
        var extRows = await env.DB.prepare(
            "SELECT id, client_name, date, time, session_type, google_meet_link, google_event_id, html_link, end_time, status, attendees " +
            "FROM sessions WHERE calendar_provider = 'google_external' AND date >= ? AND date <= ? " +
            "ORDER BY date ASC, time ASC"
        ).bind(minDate, maxDate).all();

        var externalEvents = extRows.results.map(function(row) {
            return {
                id:               row.id,
                google_event_id:  row.google_event_id,
                title:            row.client_name,
                date:             row.date,
                time:             row.time,
                end:              row.end_time,
                google_meet_link: row.google_meet_link,
                html_link:        row.html_link,
                status:           row.status,
                attendees:        row.attendees ? JSON.parse(row.attendees) : null,
                source:           "external"
            };
        });

        return jsonOk({ events: externalEvents });
    } catch (e) {
        if (e.name === "AbortError") { return jsonErr("Google API request timed out", 504); }
        return jsonErr("Error listing calendar events: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/zoho/oauth/start
// Auth: developer only. Returns Zoho OAuth authorization URL as JSON.
// ---------------------------------------------------------------------------

async function handleZohoOAuthStart(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var state     = crypto.randomUUID();
        var expiresAt = Math.floor(Date.now() / 1000) + 600;

        await env.DB.prepare(
            "INSERT INTO oauth_state (state, initiated_by, expires_at) VALUES (?, ?, ?)"
        ).bind(state, user.email, expiresAt).run();

        await env.DB.prepare(
            "DELETE FROM oauth_state WHERE expires_at < ?"
        ).bind(Math.floor(Date.now() / 1000)).run();

        var params = new URLSearchParams();
        params.set("client_id",     env.ZOHO_BOOKS_CLIENT_ID);
        params.set("redirect_uri",  "https://apex-api.farfromtimnah.workers.dev/api/zoho/oauth/callback");
        params.set("response_type", "code");
        params.set("access_type",   "offline");
        params.set("prompt",        "consent");
        params.set("scope",         "ZohoBooks.invoices.ALL,ZohoBooks.contacts.ALL,ZohoBooks.expenses.ALL,ZohoBooks.customerpayments.ALL,ZohoBooks.settings.READ,ZohoBooks.accountants.ALL,ZohoBooks.banking.ALL");
        params.set("state",         state);

        var authUrl = "https://accounts.zoho.com/oauth/v2/auth?" + params.toString();
        return jsonOk({ auth_url: authUrl });
    } catch (e) {
        return jsonErr("Error building Zoho OAuth URL: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/zoho/oauth/callback
// No auth -- called by Zoho after user consent. Exchanges code for tokens,
// then fetches and stores the organization_id alongside the refresh_token.
// ---------------------------------------------------------------------------

async function handleZohoOAuthCallback(request, env) {
    try {
        var url   = new URL(request.url);
        var code  = url.searchParams.get("code");
        var state = url.searchParams.get("state");
        if (!code)  { return jsonErr("Missing code parameter", 400); }
        if (!state) { return jsonErr("Missing state parameter", 400); }

        var stateRow = await env.DB.prepare(
            "SELECT initiated_by, expires_at FROM oauth_state WHERE state = ?"
        ).bind(state).first();

        if (!stateRow) { return jsonErr("Invalid or unknown state parameter", 400); }

        await env.DB.prepare("DELETE FROM oauth_state WHERE state = ?").bind(state).run();

        if (stateRow.expires_at < Math.floor(Date.now() / 1000)) {
            return jsonErr("OAuth state expired -- please start the flow again", 400);
        }

        var tokenController = new AbortController();
        var tokenTimer = setTimeout(function() { tokenController.abort(); }, 15000);

        var tokenRes;
        try {
            tokenRes = await fetch("https://accounts.zoho.com/oauth/v2/token", {
                method:  "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body:    new URLSearchParams({
                    code:          code,
                    client_id:     env.ZOHO_BOOKS_CLIENT_ID,
                    client_secret: env.ZOHO_BOOKS_CLIENT_SECRET,
                    redirect_uri:  "https://apex-api.farfromtimnah.workers.dev/api/zoho/oauth/callback",
                    grant_type:    "authorization_code"
                }).toString(),
                signal: tokenController.signal
            });
        } finally {
            clearTimeout(tokenTimer);
        }

        var tokenData = await tokenRes.json();
        if (!tokenRes.ok) {
            return jsonErr("Zoho token exchange failed: " + (tokenData.error_description || tokenData.error || "unknown"), 502);
        }

        var refreshToken = tokenData.refresh_token;
        if (!refreshToken) {
            return jsonErr("No refresh token returned -- ensure access_type=offline was set", 400);
        }

        var accessToken = tokenData.access_token;
        if (!accessToken) {
            return jsonErr("No access token returned from Zoho", 400);
        }

        // Fetch organization_id -- required for every future Zoho Books API call
        var orgController = new AbortController();
        var orgTimer = setTimeout(function() { orgController.abort(); }, 15000);

        var orgRes;
        try {
            orgRes = await fetch("https://www.zohoapis.com/books/v3/organizations", {
                method:  "GET",
                headers: { "Authorization": "Zoho-oauthtoken " + accessToken },
                signal:  orgController.signal
            });
        } finally {
            clearTimeout(orgTimer);
        }

        var orgData = await orgRes.json();
        if (!orgRes.ok) {
            return jsonErr("Failed to fetch Zoho organizations: " + (orgData.message || JSON.stringify(orgData)), 502);
        }

        var organizations = orgData.organizations;
        if (!organizations || !organizations.length) {
            return jsonErr("No Zoho organizations found for this account", 400);
        }

        var organizationId = organizations[0].organization_id;
        if (!organizationId) {
            return jsonErr("organization_id missing from Zoho organizations response", 400);
        }

        await env.DB.prepare(
            "INSERT OR REPLACE INTO oauth_tokens (id, refresh_token, organization_id, updated_at) VALUES ('zoho_books', ?, ?, datetime('now'))"
        ).bind(refreshToken, String(organizationId)).run();

        return jsonOk({ ok: true, message: "Zoho Books connected successfully" });
    } catch (e) {
        if (e.name === "AbortError") { return jsonErr("Zoho request timed out", 504); }
        return jsonErr("Zoho OAuth callback error: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/zoho/oauth/status
// Auth: developer or alice. Returns { connected: true/false } -- never the token.
// ---------------------------------------------------------------------------

async function handleZohoOAuthStatus(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "developer" && user.role !== "alice") { return jsonErr("Forbidden", 403); }

        var row = await env.DB.prepare(
            "SELECT id FROM oauth_tokens WHERE id = 'zoho_books'"
        ).first();

        return jsonOk({ connected: !!row });
    } catch (e) {
        return jsonErr("Error checking Zoho OAuth status: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Helper: getZohoAccessToken(env)
// Reads stored refresh_token and organization_id for id='zoho_books'. If a
// cached access_token is present and still has more than 120 seconds of
// validity left (Zoho access tokens last 3600 seconds), returns it directly
// with no network call. Otherwise exchanges the refresh_token for a fresh
// access_token and caches it (with its expiry) back onto the same row.
// Returns { access_token, organization_id } or throws on failure.
// ---------------------------------------------------------------------------

async function getZohoAccessToken(env) {
    var row = await env.DB.prepare(
        "SELECT refresh_token, organization_id, access_token, access_token_expires_at FROM oauth_tokens WHERE id = 'zoho_books'"
    ).first();

    if (!row || !row.refresh_token) {
        throw new Error("Zoho Books not connected -- complete OAuth flow first");
    }
    if (!row.organization_id) {
        throw new Error("Zoho organization_id not stored -- reconnect via OAuth flow");
    }

    var nowSeconds = Math.floor(Date.now() / 1000);
    if (row.access_token && row.access_token_expires_at && (row.access_token_expires_at - nowSeconds) > 120) {
        return { access_token: row.access_token, organization_id: row.organization_id };
    }

    var controller = new AbortController();
    var timer = setTimeout(function() { controller.abort(); }, 15000);

    var refreshRes;
    try {
        refreshRes = await fetch("https://accounts.zoho.com/oauth/v2/token", {
            method:  "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body:    new URLSearchParams({
                client_id:     env.ZOHO_BOOKS_CLIENT_ID,
                client_secret: env.ZOHO_BOOKS_CLIENT_SECRET,
                refresh_token: row.refresh_token,
                grant_type:    "refresh_token"
            }).toString(),
            signal: controller.signal
        });
    } finally {
        clearTimeout(timer);
    }

    var refreshData = await refreshRes.json();
    if (!refreshRes.ok) {
        throw new Error("Zoho token refresh failed: " + (refreshData.error_description || refreshData.error || "unknown"));
    }

    var accessToken = refreshData.access_token;
    if (!accessToken) {
        throw new Error("Zoho refresh response did not include access_token");
    }

    var expiresIn = refreshData.expires_in || 3600;
    var expiresAt = nowSeconds + expiresIn;

    await env.DB.prepare(
        "UPDATE oauth_tokens SET access_token = ?, access_token_expires_at = ? WHERE id = 'zoho_books'"
    ).bind(accessToken, expiresAt).run();

    return { access_token: accessToken, organization_id: row.organization_id };
}

// ---------------------------------------------------------------------------
// Route: GET /api/users  — alice / rafa / developer only, list all users
// ---------------------------------------------------------------------------

async function handleGetUsers(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var res = await env.DB.prepare("SELECT email, role, display_name, avatar_url FROM users ORDER BY email ASC").all();
        return jsonOk({ users: res.results });
    } catch (e) {
        return jsonErr("Error fetching users: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/users  — developer only, add or update a user
// Body: { email: string, role: string }  role must be alice | rafa | developer
// Uses INSERT OR REPLACE so re-adding an existing email updates its role.
// ---------------------------------------------------------------------------

async function handlePostUsers(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var body = await request.json();
        if (!body.email) { return jsonErr("email is required", 400); }
        if (!body.role)  { return jsonErr("role is required", 400); }

        var validRoles = ["alice", "rafa", "developer"];
        if (validRoles.indexOf(body.role) === -1) {
            return jsonErr("role must be one of: alice, rafa, developer", 400);
        }

        var email = body.email.trim().toLowerCase();
        if (!email) { return jsonErr("email is required", 400); }

        await env.DB.prepare("INSERT OR REPLACE INTO users (email, role) VALUES (?, ?)")
            .bind(email, body.role).run();

        return jsonOk({ email: email, role: body.role });
    } catch (e) {
        return jsonErr("Error saving user: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: DELETE /api/users/:email  — developer only, remove a user
// ---------------------------------------------------------------------------

async function handleDeleteUser(email, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var decoded = decodeURIComponent(email);
        var res = await env.DB.prepare("DELETE FROM users WHERE email = ?").bind(decoded).run();
        if (res.changes === 0) { return jsonErr("User not found", 404); }
        return jsonOk({ deleted: decoded });
    } catch (e) {
        return jsonErr("Error deleting user: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/tasks/consultant
// Query: scope=today|week
// Returns consultant tasks across all clients, scoped by date window.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Route: GET /api/me/profile
// Returns the current user's display_name and avatar_url.
// ---------------------------------------------------------------------------

async function handleGetMyProfile(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }

        var row = await env.DB.prepare("SELECT display_name, avatar_url FROM users WHERE email = ?")
            .bind(user.email).first();

        return jsonOk({
            email:        user.email,
            display_name: (row && row.display_name) ? row.display_name : null,
            avatar_url:   (row && row.avatar_url)   ? row.avatar_url   : null
        });
    } catch (e) {
        return jsonErr("Error fetching profile: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: PATCH /api/me/profile
// Body: { display_name?: string }
// Any authenticated user may update their own display name.
// ---------------------------------------------------------------------------

async function handlePatchMyProfile(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }

        var body = await request.json();
        if (!body.display_name && body.display_name !== "") { return jsonErr("display_name is required", 400); }

        var name = body.display_name.trim();
        if (name.length > 100) { return jsonErr("display_name must be 100 characters or fewer", 400); }

        await env.DB.prepare("UPDATE users SET display_name = ? WHERE email = ?")
            .bind(name || null, user.email).run();

        return jsonOk({ display_name: name || null });
    } catch (e) {
        return jsonErr("Error updating profile: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/me/avatar
// Body: multipart/form-data with field "avatar" (image file)
// Uploads avatar to R2 under avatars/<email>.<ext>, stores key in users.avatar_url.
// ---------------------------------------------------------------------------

async function handlePostMyAvatar(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }

        var form = await request.formData();
        var file = form.get("avatar");
        if (!file || typeof file.arrayBuffer !== "function") { return jsonErr("avatar file is required", 400); }

        var allowed = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
        if (allowed.indexOf(file.type) === -1) {
            return jsonErr("Invalid file type. Upload a JPG, PNG, GIF, or WebP image.", 400);
        }

        var ext = (file.type === "image/png")  ? "png"
                : (file.type === "image/gif")  ? "gif"
                : (file.type === "image/webp") ? "webp"
                : "jpg";

        var safeEmail = user.email.replace(/[^a-zA-Z0-9._-]/g, "_");
        var key = "avatars/" + safeEmail + "." + ext;

        await env.ASSETS.put(key, await file.arrayBuffer(), {
            httpMetadata: { contentType: file.type }
        });

        await env.DB.prepare("UPDATE users SET avatar_url = ? WHERE email = ?")
            .bind(key, user.email).run();

        return jsonOk({ avatar_key: key });
    } catch (e) {
        return jsonErr("Error uploading avatar: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/users/:email/avatar
// Admin avatar upload — allows alice/rafa/developer to set any user's picture.
// Body: multipart/form-data with field "avatar" (image file)
// ---------------------------------------------------------------------------

async function handlePostUserAvatar(email, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }

        var allowed_roles = ["alice", "rafa", "developer"];
        if (allowed_roles.indexOf(user.role) === -1) { return jsonErr("Forbidden", 403); }

        var decoded = decodeURIComponent(email);

        var form = await request.formData();
        var file = form.get("avatar");
        if (!file || typeof file.arrayBuffer !== "function") { return jsonErr("avatar file is required", 400); }

        var allowed = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
        if (allowed.indexOf(file.type) === -1) {
            return jsonErr("Invalid file type. Upload a JPG, PNG, GIF, or WebP image.", 400);
        }

        var ext = (file.type === "image/png")  ? "png"
                : (file.type === "image/gif")  ? "gif"
                : (file.type === "image/webp") ? "webp"
                : "jpg";

        var safeEmail = decoded.replace(/[^a-zA-Z0-9._-]/g, "_");
        var key = "avatars/" + safeEmail + "." + ext;

        await env.ASSETS.put(key, await file.arrayBuffer(), {
            httpMetadata: { contentType: file.type }
        });

        await env.DB.prepare("UPDATE users SET avatar_url = ? WHERE email = ?")
            .bind(key, decoded).run();

        return jsonOk({ avatar_key: key });
    } catch (e) {
        return jsonErr("Error uploading avatar: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/me/avatar-image
// Serves the caller's own avatar from R2.
// ---------------------------------------------------------------------------

async function handleGetMyAvatarImage(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }

        var row = await env.DB.prepare("SELECT avatar_url FROM users WHERE email = ?")
            .bind(user.email).first();

        if (!row || !row.avatar_url) {
            return new Response(null, { status: 404, headers: CORS_HEADERS });
        }

        if (!/^avatars\/[A-Za-z0-9_.@-]+\.(png|jpe?g|gif|webp)$/.test(row.avatar_url)) {
            return new Response(null, { status: 404, headers: CORS_HEADERS });
        }

        var obj = await env.ASSETS.get(row.avatar_url);
        if (!obj) {
            return new Response(null, { status: 404, headers: CORS_HEADERS });
        }

        var allowedTypes = { "image/jpeg": 1, "image/png": 1, "image/gif": 1, "image/webp": 1 };
        var stored = obj.httpMetadata && obj.httpMetadata.contentType;
        var ct = allowedTypes[stored] ? stored : "image/jpeg";
        var imgHeaders = Object.assign({}, CORS_HEADERS, {
            "Content-Type": ct,
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": "inline; filename=\"avatar\"",
            "Cache-Control": "public, max-age=86400"
        });
        return new Response(obj.body, { status: 200, headers: imgHeaders });
    } catch (e) {
        return jsonErr("Error fetching avatar: " + e.message, 500);
    }
}

async function handleGetConsultantTasks(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var url   = new URL(request.url);
        var scope = url.searchParams.get("scope");
        if (scope !== "today" && scope !== "week") {
            return jsonErr("scope must be today or week", 400);
        }

        var today = new Date().toISOString().split("T")[0];

        var stmt;
        if (scope === "today") {
            stmt = env.DB.prepare(
                "SELECT t.id, t.client_id, c.name as client_name, t.type, " +
                "t.description, t.due_date, t.status, t.created_at " +
                "FROM tasks t JOIN clients c ON t.client_id = c.id " +
                "WHERE t.type = 'consultant' AND t.due_date = ? " +
                "ORDER BY t.due_date ASC"
            ).bind(today);
        } else {
            // Compute Sunday-to-Saturday week boundaries using same logic as calendar.html getWeekDateStrings()
            var now = new Date();
            var dayOfWeek = now.getDay(); // 0=Sunday
            var sunday = new Date(now);
            sunday.setDate(now.getDate() - dayOfWeek);
            var saturday = new Date(sunday);
            saturday.setDate(sunday.getDate() + 6);
            var weekStart = sunday.toISOString().split("T")[0];
            var weekEnd   = saturday.toISOString().split("T")[0];

            stmt = env.DB.prepare(
                "SELECT t.id, t.client_id, c.name as client_name, t.type, " +
                "t.description, t.due_date, t.status, t.created_at " +
                "FROM tasks t JOIN clients c ON t.client_id = c.id " +
                "WHERE t.type = 'consultant' AND t.due_date >= ? AND t.due_date <= ? " +
                "ORDER BY t.due_date ASC"
            ).bind(weekStart, weekEnd);
        }

        var res = await stmt.all();
        return jsonOk({ tasks: res.results });
    } catch (e) {
        return jsonErr("Error fetching consultant tasks: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/tasks/consultant/overdue
// Returns all overdue consultant tasks (pending, due_date < today).
// ---------------------------------------------------------------------------

async function handleGetConsultantTasksOverdue(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var today = new Date().toISOString().split("T")[0];

        var res = await env.DB.prepare(
            "SELECT t.id, t.client_id, c.name as client_name, t.type, " +
            "t.description, t.due_date, t.status, t.created_at " +
            "FROM tasks t JOIN clients c ON t.client_id = c.id " +
            "WHERE t.type = 'consultant' AND t.status = 'pending' AND t.due_date < ? " +
            "ORDER BY t.due_date ASC"
        ).bind(today).all();

        return jsonOk({ tasks: res.results, count: res.results.length });
    } catch (e) {
        return jsonErr("Error fetching overdue consultant tasks: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/settings/templates
// Auth: alice / rafa / developer only.
// ---------------------------------------------------------------------------

async function handleGetSettingsTemplates(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var res = await env.DB.prepare(
            "SELECT template_key, template_text, updated_at, updated_by FROM message_templates ORDER BY template_key"
        ).all();

        return jsonOk({ templates: res.results });
    } catch (e) {
        return jsonErr("Error fetching templates: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: PUT /api/settings/templates/:key
// Auth: alice / rafa / developer only.
// ---------------------------------------------------------------------------

async function handlePutSettingsTemplate(key, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var body = await request.json();
        if (!body.template_text || !body.template_text.trim()) {
            return jsonErr("template_text is required", 400);
        }

        var existing = await env.DB.prepare(
            "SELECT template_key FROM message_templates WHERE template_key = ?"
        ).bind(key).first();
        if (!existing) { return jsonErr("Template not found", 404); }

        var updatedAt = new Date().toISOString();
        await env.DB.prepare(
            "UPDATE message_templates SET template_text = ?, updated_at = ?, updated_by = ? WHERE template_key = ?"
        ).bind(body.template_text, updatedAt, user.email, key).run();

        var updated = await env.DB.prepare(
            "SELECT template_key, template_text, updated_at, updated_by FROM message_templates WHERE template_key = ?"
        ).bind(key).first();

        return jsonOk(updated);
    } catch (e) {
        return jsonErr("Error updating template: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/settings/packages
// Auth: alice / rafa / developer only.
// ---------------------------------------------------------------------------

async function handleGetSettingsPackages(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var res = await env.DB.prepare(
            "SELECT id, short_name, full_name, audience, included_items, is_popular, sort_order, " +
            "base_price, has_payment_plan, installment_count, installment_amount, " +
            "upfront_price, installment_total_price, default_installment_count, default_installment_amount " +
            "FROM packages ORDER BY sort_order ASC, short_name ASC"
        ).all();

        var pkgs = res.results.map(function(row) {
            var items = [];
            if (row.included_items) {
                try { items = JSON.parse(row.included_items); } catch(e) { items = []; }
            }
            return {
                id:                 row.id,
                short_name:         row.short_name,
                full_name:          row.full_name,
                audience:           row.audience,
                included_items:     items,
                is_popular:         !!row.is_popular,
                sort_order:         row.sort_order,
                base_price:         row.base_price ?? null,
                has_payment_plan:   !!row.has_payment_plan,
                installment_count:  row.installment_count ?? null,
                installment_amount: row.installment_amount ?? null,
                upfront_price:              row.upfront_price ?? null,
                installment_total_price:    row.installment_total_price ?? null,
                default_installment_count:  row.default_installment_count ?? null,
                default_installment_amount: row.default_installment_amount ?? null
            };
        });

        return jsonOk({ packages: pkgs });
    } catch (e) {
        return jsonErr("Error fetching packages: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/settings/packages
// Body: { short_name, full_name, audience?, included_items? (array), is_popular? (boolean), sort_order?,
//         upfront_price?, installment_total_price?, default_installment_count?, default_installment_amount? }
// Auth: alice / rafa / developer only.
// ---------------------------------------------------------------------------

async function handlePostSettingsPackages(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var body = await request.json();
        if (!body.short_name || !body.short_name.trim()) { return jsonErr("short_name is required", 400); }
        if (!body.full_name  || !body.full_name.trim())  { return jsonErr("full_name is required", 400); }

        var sortOrder = body.sort_order;
        if (sortOrder === undefined || sortOrder === null) {
            var maxRow = await env.DB.prepare(
                "SELECT MAX(sort_order) AS max_sort FROM packages"
            ).first();
            sortOrder = (maxRow && maxRow.max_sort !== null) ? maxRow.max_sort + 1 : 1;
        }

        var includedItems = Array.isArray(body.included_items) ? body.included_items : [];
        var isPopular     = body.is_popular ? 1 : 0;
        var basePrice     = (body.base_price !== undefined && body.base_price !== null && body.base_price !== "") ? parseFloat(body.base_price) : null;
        var hasPaymentPlan = body.has_payment_plan ? 1 : 0;
        var installmentCount  = (hasPaymentPlan && body.installment_count  !== undefined && body.installment_count  !== null) ? parseInt(body.installment_count,  10) : null;
        var installmentAmount = (hasPaymentPlan && body.installment_amount !== undefined && body.installment_amount !== null) ? parseFloat(body.installment_amount) : null;
        var upfrontPrice           = (body.upfront_price           !== undefined && body.upfront_price           !== null && body.upfront_price           !== "") ? parseFloat(body.upfront_price)           : null;
        var installmentTotalPrice  = (body.installment_total_price !== undefined && body.installment_total_price !== null && body.installment_total_price !== "") ? parseFloat(body.installment_total_price)  : null;
        var defaultInstallmentCount  = (body.default_installment_count  !== undefined && body.default_installment_count  !== null && body.default_installment_count  !== "") ? parseInt(body.default_installment_count,  10) : null;
        var defaultInstallmentAmount = (body.default_installment_amount !== undefined && body.default_installment_amount !== null && body.default_installment_amount !== "") ? parseFloat(body.default_installment_amount) : null;

        var pkgId = crypto.randomUUID();
        await env.DB.prepare(
            "INSERT INTO packages (id, name, short_name, full_name, audience, included_items, is_popular, sort_order, base_price, has_payment_plan, installment_count, installment_amount, " +
            "upfront_price, installment_total_price, default_installment_count, default_installment_amount) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(
            pkgId,
            body.short_name.trim(),
            body.short_name.trim(),
            body.full_name.trim(),
            body.audience || null,
            JSON.stringify(includedItems),
            isPopular,
            sortOrder,
            basePrice,
            hasPaymentPlan,
            installmentCount,
            installmentAmount,
            upfrontPrice,
            installmentTotalPrice,
            defaultInstallmentCount,
            defaultInstallmentAmount
        ).run();

        var row = await env.DB.prepare(
            "SELECT id, short_name, full_name, audience, included_items, is_popular, sort_order, " +
            "base_price, has_payment_plan, installment_count, installment_amount, " +
            "upfront_price, installment_total_price, default_installment_count, default_installment_amount FROM packages WHERE id = ?"
        ).bind(pkgId).first();

        var items = [];
        if (row.included_items) {
            try { items = JSON.parse(row.included_items); } catch(e) { items = []; }
        }

        return jsonOk({ package: {
            id:                 row.id,
            short_name:         row.short_name,
            full_name:          row.full_name,
            audience:           row.audience,
            included_items:     items,
            is_popular:         !!row.is_popular,
            sort_order:         row.sort_order,
            base_price:         row.base_price ?? null,
            has_payment_plan:   !!row.has_payment_plan,
            installment_count:  row.installment_count ?? null,
            installment_amount: row.installment_amount ?? null,
            upfront_price:              row.upfront_price ?? null,
            installment_total_price:    row.installment_total_price ?? null,
            default_installment_count:  row.default_installment_count ?? null,
            default_installment_amount: row.default_installment_amount ?? null
        }});
    } catch (e) {
        return jsonErr("Error creating package: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: PUT /api/settings/packages/:id
// Body: any subset of { short_name, full_name, audience, included_items (array), is_popular (boolean), sort_order,
//         base_price, has_payment_plan, installment_count, installment_amount,
//         upfront_price, installment_total_price, default_installment_count, default_installment_amount }
// Auth: alice / rafa / developer only.
// ---------------------------------------------------------------------------

async function handlePutSettingsPackage(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var existing = await env.DB.prepare(
            "SELECT id FROM packages WHERE id = ?"
        ).bind(id).first();
        if (!existing) { return jsonErr("Package not found", 404); }

        var body = await request.json();
        if (body.hasOwnProperty("short_name") && (!body.short_name || !body.short_name.trim())) {
            return jsonErr("short_name must not be blank", 400);
        }
        if (body.hasOwnProperty("full_name") && (!body.full_name || !body.full_name.trim())) {
            return jsonErr("full_name must not be blank", 400);
        }

        if (body.hasOwnProperty("short_name")) {
            await env.DB.prepare("UPDATE packages SET short_name = ?, name = ? WHERE id = ?")
                .bind(body.short_name.trim(), body.short_name.trim(), id).run();
        }
        if (body.hasOwnProperty("full_name")) {
            await env.DB.prepare("UPDATE packages SET full_name = ? WHERE id = ?")
                .bind(body.full_name.trim(), id).run();
        }
        if (body.hasOwnProperty("audience")) {
            await env.DB.prepare("UPDATE packages SET audience = ? WHERE id = ?")
                .bind(body.audience || null, id).run();
        }
        if (body.hasOwnProperty("included_items")) {
            var items = Array.isArray(body.included_items) ? body.included_items : [];
            await env.DB.prepare("UPDATE packages SET included_items = ? WHERE id = ?")
                .bind(JSON.stringify(items), id).run();
        }
        if (body.hasOwnProperty("is_popular")) {
            await env.DB.prepare("UPDATE packages SET is_popular = ? WHERE id = ?")
                .bind(body.is_popular ? 1 : 0, id).run();
        }
        if (body.hasOwnProperty("sort_order")) {
            await env.DB.prepare("UPDATE packages SET sort_order = ? WHERE id = ?")
                .bind(body.sort_order, id).run();
        }
        if (body.hasOwnProperty("base_price")) {
            var bp = (body.base_price !== null && body.base_price !== "") ? parseFloat(body.base_price) : null;
            await env.DB.prepare("UPDATE packages SET base_price = ? WHERE id = ?")
                .bind(isNaN(bp) ? null : bp, id).run();
        }
        if (body.hasOwnProperty("has_payment_plan")) {
            await env.DB.prepare("UPDATE packages SET has_payment_plan = ? WHERE id = ?")
                .bind(body.has_payment_plan ? 1 : 0, id).run();
        }
        if (body.hasOwnProperty("installment_count")) {
            var ic = (body.installment_count !== null && body.installment_count !== "") ? parseInt(body.installment_count, 10) : null;
            await env.DB.prepare("UPDATE packages SET installment_count = ? WHERE id = ?")
                .bind((ic !== null && !isNaN(ic)) ? ic : null, id).run();
        }
        if (body.hasOwnProperty("installment_amount")) {
            var ia = (body.installment_amount !== null && body.installment_amount !== "") ? parseFloat(body.installment_amount) : null;
            await env.DB.prepare("UPDATE packages SET installment_amount = ? WHERE id = ?")
                .bind((ia !== null && !isNaN(ia)) ? ia : null, id).run();
        }
        if (body.hasOwnProperty("upfront_price")) {
            var up = (body.upfront_price !== null && body.upfront_price !== "") ? parseFloat(body.upfront_price) : null;
            await env.DB.prepare("UPDATE packages SET upfront_price = ? WHERE id = ?")
                .bind((up !== null && !isNaN(up)) ? up : null, id).run();
        }
        if (body.hasOwnProperty("installment_total_price")) {
            var itp = (body.installment_total_price !== null && body.installment_total_price !== "") ? parseFloat(body.installment_total_price) : null;
            await env.DB.prepare("UPDATE packages SET installment_total_price = ? WHERE id = ?")
                .bind((itp !== null && !isNaN(itp)) ? itp : null, id).run();
        }
        if (body.hasOwnProperty("default_installment_count")) {
            var dic = (body.default_installment_count !== null && body.default_installment_count !== "") ? parseInt(body.default_installment_count, 10) : null;
            await env.DB.prepare("UPDATE packages SET default_installment_count = ? WHERE id = ?")
                .bind((dic !== null && !isNaN(dic)) ? dic : null, id).run();
        }
        if (body.hasOwnProperty("default_installment_amount")) {
            var dia = (body.default_installment_amount !== null && body.default_installment_amount !== "") ? parseFloat(body.default_installment_amount) : null;
            await env.DB.prepare("UPDATE packages SET default_installment_amount = ? WHERE id = ?")
                .bind((dia !== null && !isNaN(dia)) ? dia : null, id).run();
        }

        var row = await env.DB.prepare(
            "SELECT id, short_name, full_name, audience, included_items, is_popular, sort_order, " +
            "base_price, has_payment_plan, installment_count, installment_amount, " +
            "upfront_price, installment_total_price, default_installment_count, default_installment_amount FROM packages WHERE id = ?"
        ).bind(id).first();

        var updatedItems = [];
        if (row.included_items) {
            try { updatedItems = JSON.parse(row.included_items); } catch(e) { updatedItems = []; }
        }

        return jsonOk({ package: {
            id:                 row.id,
            short_name:         row.short_name,
            full_name:          row.full_name,
            audience:           row.audience,
            included_items:     updatedItems,
            is_popular:         !!row.is_popular,
            sort_order:         row.sort_order,
            base_price:         row.base_price ?? null,
            has_payment_plan:   !!row.has_payment_plan,
            installment_count:  row.installment_count ?? null,
            installment_amount: row.installment_amount ?? null,
            upfront_price:              row.upfront_price ?? null,
            installment_total_price:    row.installment_total_price ?? null,
            default_installment_count:  row.default_installment_count ?? null,
            default_installment_amount: row.default_installment_amount ?? null
        }});
    } catch (e) {
        return jsonErr("Error updating package: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: DELETE /api/settings/packages/:id
// Auth: alice / rafa / developer only.
// Note: clients already assigned this package keep their stored text value in
// clients.package (it is a plain text field, not a foreign key) — deleting a
// package only removes it as a future selectable option; does not touch clients.
// ---------------------------------------------------------------------------

async function handleDeleteSettingsPackage(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var existing = await env.DB.prepare(
            "SELECT id FROM packages WHERE id = ?"
        ).bind(id).first();
        if (!existing) { return jsonErr("Package not found", 404); }

        await env.DB.prepare("DELETE FROM packages WHERE id = ?").bind(id).run();

        return jsonOk({ ok: true, id: id });
    } catch (e) {
        return jsonErr("Error deleting package: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/business/settings
// Returns the single-row business_settings record (Zelle QR key + Stripe link).
// Auth: alice / rafa / developer only.
// ---------------------------------------------------------------------------

async function handleGetBusinessSettings(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var row = await env.DB.prepare(
            "SELECT zelle_qr_r2_key, stripe_payment_link, updated_at FROM business_settings WHERE id = 1"
        ).first();

        return jsonOk({ settings: row || { zelle_qr_r2_key: null, stripe_payment_link: null, updated_at: null } });
    } catch (e) {
        return jsonErr("Error fetching business settings: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: PATCH /api/business/settings
// Updates the Stripe payment link on the single-row business_settings record.
// Auth: alice / rafa / developer only.
// ---------------------------------------------------------------------------

async function handlePatchBusinessSettings(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var body = await request.json();
        var updated = false;

        if (body.hasOwnProperty("stripe_payment_link")) {
            var link = body.stripe_payment_link ? body.stripe_payment_link.trim() : null;
            if (link && !/^https?:\/\/.+/.test(link)) {
                return jsonErr("stripe_payment_link must be a valid URL", 400);
            }
            await env.DB.prepare(
                "UPDATE business_settings SET stripe_payment_link = ?, updated_at = ? WHERE id = 1"
            ).bind(link || null, new Date().toISOString()).run();
            updated = true;
        }

        return jsonOk({ updated: updated });
    } catch (e) {
        return jsonErr("Error updating business settings: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/business/qr
// Body: multipart/form-data with 'qr' file field (JPG, PNG, GIF, WebP only)
// Stores the Apex Zelle QR code in R2 and saves the key in business_settings.
// Auth: alice / rafa / developer only.
// ---------------------------------------------------------------------------

async function handlePostBusinessQr(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var form = await request.formData();
        var file = form.get("qr");
        if (!file || typeof file.arrayBuffer !== "function") { return jsonErr("qr file is required", 400); }

        var allowed = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
        if (allowed.indexOf(file.type) === -1) {
            return jsonErr("Invalid file type. Upload a JPG, PNG, GIF, or WebP image.", 400);
        }

        var MAX_BYTES = 2 * 1024 * 1024;
        var buf = await file.arrayBuffer();
        if (buf.byteLength > MAX_BYTES) {
            return jsonErr("File too large. Maximum size is 2 MB.", 400);
        }

        // Magic-byte validation
        var header = new Uint8Array(buf.slice(0, 12));
        var isPng  = header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47;
        var isJpg  = header[0] === 0xFF && header[1] === 0xD8;
        var isGif  = header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46;
        var isWebp = header[8] === 0x57 && header[9] === 0x45 && header[10] === 0x42 && header[11] === 0x50;
        if (!isPng && !isJpg && !isGif && !isWebp) {
            return jsonErr("File content does not match a supported image format.", 400);
        }

        var ext = isPng ? "png" : isGif ? "gif" : isWebp ? "webp" : "jpg";
        var key = "business/zelle-qr." + ext;

        await env.ASSETS.put(key, buf, { httpMetadata: { contentType: file.type } });

        await env.DB.prepare(
            "UPDATE business_settings SET zelle_qr_r2_key = ?, updated_at = ? WHERE id = 1"
        ).bind(key, new Date().toISOString()).run();

        return jsonOk({ qr_key: key });
    } catch (e) {
        return jsonErr("Error uploading QR code: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/business/qr-image
// Serves the business-wide Zelle QR code from R2.
// Auth-free: non-sensitive image asset (will be embedded in invoice PDFs).
// ---------------------------------------------------------------------------

async function handleGetBusinessQrImage(request, env) {
    try {
        var row = await env.DB.prepare(
            "SELECT zelle_qr_r2_key FROM business_settings WHERE id = 1"
        ).first();

        if (!row || !row.zelle_qr_r2_key) {
            return new Response(null, { status: 404, headers: CORS_HEADERS });
        }

        if (!/^business\/zelle-qr\.(png|jpe?g|gif|webp)$/.test(row.zelle_qr_r2_key)) {
            return new Response(null, { status: 404, headers: CORS_HEADERS });
        }

        var obj = await env.ASSETS.get(row.zelle_qr_r2_key);
        if (!obj) {
            return new Response(null, { status: 404, headers: CORS_HEADERS });
        }

        var allowedTypes = { "image/jpeg": 1, "image/png": 1, "image/gif": 1, "image/webp": 1 };
        var stored = obj.httpMetadata && obj.httpMetadata.contentType;
        var ct = allowedTypes[stored] ? stored : "image/png";
        var imgHeaders = Object.assign({}, CORS_HEADERS, {
            "Content-Type": ct,
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": "inline; filename=\"zelle-qr\"",
            "Cache-Control": "public, max-age=86400"
        });
        return new Response(obj.body, { status: 200, headers: imgHeaders });
    } catch (e) {
        return jsonErr("Error fetching QR code: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/users/:email/avatar-image
// Serves a user's avatar from R2 by email — no auth required so <img> tags work.
// ---------------------------------------------------------------------------

async function handleGetUserAvatarImage(email, request, env) {
    try {
        var decoded = decodeURIComponent(email);
        var row = await env.DB.prepare("SELECT avatar_url FROM users WHERE email = ?")
            .bind(decoded).first();

        if (!row || !row.avatar_url) {
            return new Response(null, { status: 404, headers: CORS_HEADERS });
        }

        if (!/^avatars\/[A-Za-z0-9_.@-]+\.(png|jpe?g|gif|webp)$/.test(row.avatar_url)) {
            return new Response(null, { status: 404, headers: CORS_HEADERS });
        }

        var obj = await env.ASSETS.get(row.avatar_url);
        if (!obj) {
            return new Response(null, { status: 404, headers: CORS_HEADERS });
        }

        var allowedTypes = { "image/jpeg": 1, "image/png": 1, "image/gif": 1, "image/webp": 1 };
        var stored = obj.httpMetadata && obj.httpMetadata.contentType;
        var ct = allowedTypes[stored] ? stored : "image/jpeg";
        var imgHeaders = Object.assign({}, CORS_HEADERS, {
            "Content-Type": ct,
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": "inline; filename=\"avatar\"",
            "Cache-Control": "public, max-age=86400"
        });
        return new Response(obj.body, { status: 200, headers: imgHeaders });
    } catch (e) {
        return jsonErr("Error fetching avatar: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Resource Hub (Documents page) — resources library + client assignment/send
// tracking. Tables: resources, client_resources, resource_categories
// (see migrations/resources.sql).
// ---------------------------------------------------------------------------

var RESOURCE_TYPES = ["contact", "file", "link"];

function canEditResources(user) {
    return user.role === "alice" || user.role === "rafa" || user.role === "developer";
}

// Inserts a category typed via the "Other" option so the dropdown self-extends.
async function ensureResourceCategory(env, category) {
    await env.DB.prepare(
        "INSERT OR IGNORE INTO resource_categories (name, sort_order) VALUES (?, " +
        "(SELECT COALESCE(MAX(sort_order), 0) + 1 FROM resource_categories))"
    ).bind(category).run();
}

// ---------------------------------------------------------------------------
// Route: GET /api/resources
// Returns the full resource library, the live category list, and the count of
// pending (unsent) client_resources rows for the Documents hero tile.
// ---------------------------------------------------------------------------

async function handleGetResources(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }

        var resources = await env.DB.prepare(
            "SELECT * FROM resources ORDER BY created_at DESC"
        ).all();
        var categories = await env.DB.prepare(
            "SELECT name FROM resource_categories ORDER BY sort_order"
        ).all();
        var pending = await env.DB.prepare(
            "SELECT COUNT(*) AS n FROM client_resources WHERE whatsapp_sent_at IS NULL"
        ).first();

        return jsonOk({
            resources:     resources.results,
            categories:    categories.results.map(function (r) { return r.name; }),
            pending_sends: pending ? pending.n : 0
        });
    } catch (e) {
        return jsonErr("Error fetching resources: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Shared field extraction for resource create/edit. Accepts either JSON
// (contact/link) or multipart/form-data with an optional 'file' field (file).
// Returns { fields, file } — file is null for JSON bodies.
// ---------------------------------------------------------------------------

var RESOURCE_FILE_TYPES = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png",
    "image/gif": "gif", "image/webp": "webp",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "text/plain": "txt", "text/csv": "csv"
};

async function readResourceBody(request) {
    var contentType = request.headers.get("Content-Type") || "";
    if (contentType.indexOf("multipart/form-data") !== -1) {
        var form = await request.formData();
        var fields = {};
        var names = ["category", "resource_type", "title", "description",
                     "contact_name", "contact_phone", "contact_email", "url"];
        for (var i = 0; i < names.length; i++) {
            var v = form.get(names[i]);
            fields[names[i]] = (typeof v === "string" && v.trim()) ? v.trim() : null;
        }
        var file = form.get("file");
        if (file && typeof file.arrayBuffer !== "function") { file = null; }
        return { fields: fields, file: file || null };
    }
    var body = await request.json();
    return { fields: body, file: null };
}

function validateResourceFields(fields) {
    if (!fields.title || !String(fields.title).trim()) { return "title is required"; }
    if (!fields.category || !String(fields.category).trim()) { return "category is required"; }
    if (RESOURCE_TYPES.indexOf(fields.resource_type) === -1) {
        return "resource_type must be one of: " + RESOURCE_TYPES.join(", ");
    }
    if (fields.resource_type === "link" && !fields.url) { return "url is required for link resources"; }
    return null;
}

async function storeResourceFile(env, resourceId, file) {
    var ext = RESOURCE_FILE_TYPES[file.type];
    if (!ext) { throw new Error("Invalid file type. Upload a PDF, image, Word/Excel document, CSV, or text file."); }
    var key = "resources/" + resourceId + "." + ext;
    await env.ASSETS.put(key, await file.arrayBuffer(), {
        httpMetadata: { contentType: file.type }
    });
    return { key: key, name: file.name || ("resource." + ext) };
}

// ---------------------------------------------------------------------------
// Route: POST /api/resources
// Creates a resource. JSON for contact/link; multipart/form-data with a 'file'
// field for file resources (stored in R2 under resources/<id>.<ext>).
// New categories (typed via "Other") are added to resource_categories live.
// alice / rafa / developer only.
// ---------------------------------------------------------------------------

async function handlePostResource(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!canEditResources(user)) { return jsonErr("Forbidden", 403); }

        var parsed = await readResourceBody(request);
        var f = parsed.fields;
        var err = validateResourceFields(f);
        if (err) { return jsonErr(err, 400); }
        if (f.resource_type === "file" && !parsed.file) {
            return jsonErr("file is required for file resources", 400);
        }

        var id = crypto.randomUUID();
        var fileUrl = null, fileName = null;
        if (parsed.file) {
            var stored = await storeResourceFile(env, id, parsed.file);
            fileUrl  = stored.key;
            fileName = stored.name;
        }

        await ensureResourceCategory(env, String(f.category).trim());

        await env.DB.prepare(
            "INSERT INTO resources (id, category, resource_type, title, description, " +
            "contact_name, contact_phone, contact_email, file_url, file_name, url, created_by) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(
            id, String(f.category).trim(), f.resource_type, String(f.title).trim(),
            f.description || null, f.contact_name || null, f.contact_phone || null,
            f.contact_email || null, fileUrl, fileName, f.url || null,
            user.display_name || user.role
        ).run();

        var row = await env.DB.prepare("SELECT * FROM resources WHERE id = ?").bind(id).first();
        return jsonOk({ resource: row });
    } catch (e) {
        return jsonErr("Error creating resource: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: PUT /api/resources/:id
// Edits a resource. Same body rules as POST; a new file replaces the stored
// one, otherwise the existing file is kept. alice / rafa / developer only.
// ---------------------------------------------------------------------------

async function handlePutResource(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!canEditResources(user)) { return jsonErr("Forbidden", 403); }

        var existing = await env.DB.prepare("SELECT * FROM resources WHERE id = ?").bind(id).first();
        if (!existing) { return jsonErr("Resource not found", 404); }

        var parsed = await readResourceBody(request);
        var f = parsed.fields;
        var err = validateResourceFields(f);
        if (err) { return jsonErr(err, 400); }
        if (f.resource_type === "file" && !parsed.file && !existing.file_url) {
            return jsonErr("file is required for file resources", 400);
        }

        var fileUrl = existing.file_url, fileName = existing.file_name;
        if (parsed.file) {
            var stored = await storeResourceFile(env, id, parsed.file);
            fileUrl  = stored.key;
            fileName = stored.name;
        }
        if (f.resource_type !== "file") { fileUrl = null; fileName = null; }

        await ensureResourceCategory(env, String(f.category).trim());

        await env.DB.prepare(
            "UPDATE resources SET category = ?, resource_type = ?, title = ?, description = ?, " +
            "contact_name = ?, contact_phone = ?, contact_email = ?, file_url = ?, file_name = ?, url = ? " +
            "WHERE id = ?"
        ).bind(
            String(f.category).trim(), f.resource_type, String(f.title).trim(),
            f.description || null, f.contact_name || null, f.contact_phone || null,
            f.contact_email || null, fileUrl, fileName, f.url || null, id
        ).run();

        var row = await env.DB.prepare("SELECT * FROM resources WHERE id = ?").bind(id).first();
        return jsonOk({ resource: row });
    } catch (e) {
        return jsonErr("Error updating resource: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/resources/:id/file
// Serves a file-type resource from R2 — no raw R2 paths exposed to frontend.
// Auth-free like logo-image: keyed by unguessable UUID, so the same URL can be
// shared with a client via WhatsApp.
// ---------------------------------------------------------------------------

async function handleGetResourceFile(id, request, env) {
    try {
        var row = await env.DB.prepare("SELECT file_url, file_name FROM resources WHERE id = ?")
            .bind(id).first();
        if (!row || !row.file_url) {
            return new Response(null, { status: 404, headers: CORS_HEADERS });
        }
        if (!/^resources\/[A-Za-z0-9-]+\.[a-z0-9]+$/.test(row.file_url)) {
            return new Response(null, { status: 404, headers: CORS_HEADERS });
        }

        var obj = await env.ASSETS.get(row.file_url);
        if (!obj) {
            return new Response(null, { status: 404, headers: CORS_HEADERS });
        }

        var stored = obj.httpMetadata && obj.httpMetadata.contentType;
        var ct = RESOURCE_FILE_TYPES[stored] ? stored : "application/octet-stream";
        var safeName = String(row.file_name || "resource").replace(/[^\w. -]/g, "_");
        var fileHeaders = Object.assign({}, CORS_HEADERS, {
            "Content-Type": ct,
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": "inline; filename=\"" + safeName + "\"",
            "Cache-Control": "public, max-age=86400"
        });
        return new Response(obj.body, { status: 200, headers: fileHeaders });
    } catch (e) {
        return jsonErr("Error fetching resource file: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/clients/:id/resources
// All resources attached to a client (pending + sent), newest assignment first.
// ---------------------------------------------------------------------------

async function handleGetClientResources(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }

        var rows = await env.DB.prepare(
            "SELECT cr.id, cr.client_id, cr.resource_id, cr.assigned_at, cr.assigned_by, " +
            "cr.whatsapp_sent_at, cr.sent_by, " +
            "r.category, r.resource_type, r.title, r.description, " +
            "r.contact_name, r.contact_phone, r.contact_email, r.file_url, r.file_name, r.url " +
            "FROM client_resources cr " +
            "JOIN resources r ON r.id = cr.resource_id " +
            "WHERE cr.client_id = ? " +
            "ORDER BY cr.assigned_at DESC"
        ).bind(id).all();

        return jsonOk({ client_resources: rows.results });
    } catch (e) {
        return jsonErr("Error fetching client resources: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/clients/:id/resources
// Body: { resource_id }
// Attaches an existing hub resource to a client (creates a pending
// client_resources row). alice / rafa / developer only.
// ---------------------------------------------------------------------------

async function handlePostClientResource(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!canEditResources(user)) { return jsonErr("Forbidden", 403); }

        var body = await request.json();
        if (!body.resource_id) { return jsonErr("resource_id is required", 400); }

        var client = await env.DB.prepare("SELECT id FROM clients WHERE id = ?").bind(id).first();
        if (!client) { return jsonErr("Client not found", 404); }
        var resource = await env.DB.prepare("SELECT id FROM resources WHERE id = ?").bind(body.resource_id).first();
        if (!resource) { return jsonErr("Resource not found", 404); }

        var dup = await env.DB.prepare(
            "SELECT id FROM client_resources WHERE client_id = ? AND resource_id = ? AND whatsapp_sent_at IS NULL"
        ).bind(id, body.resource_id).first();
        if (dup) { return jsonErr("This resource is already pending for this client", 409); }

        var crId = crypto.randomUUID();
        await env.DB.prepare(
            "INSERT INTO client_resources (id, client_id, resource_id, assigned_by) VALUES (?, ?, ?, ?)"
        ).bind(crId, id, body.resource_id, user.display_name || user.role).run();

        var row = await env.DB.prepare("SELECT * FROM client_resources WHERE id = ?").bind(crId).first();
        return jsonOk({ client_resource: row });
    } catch (e) {
        return jsonErr("Error attaching resource: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/client-resources/pending
// All unsent assignments across all clients, joined with resource details and
// the client's name/WhatsApp — feeds the pending strip on the Clients page.
// ---------------------------------------------------------------------------

async function handleGetClientResourcesPending(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }

        var rows = await env.DB.prepare(
            "SELECT cr.id, cr.client_id, cr.resource_id, cr.assigned_at, cr.assigned_by, " +
            "c.name AS client_name, c.whatsapp AS client_whatsapp, c.phone AS client_phone, " +
            "r.category, r.resource_type, r.title, r.description, " +
            "r.contact_name, r.contact_phone, r.contact_email, r.file_url, r.file_name, r.url " +
            "FROM client_resources cr " +
            "JOIN resources r ON r.id = cr.resource_id " +
            "JOIN clients c ON c.id = cr.client_id " +
            "WHERE cr.whatsapp_sent_at IS NULL " +
            "ORDER BY cr.assigned_at ASC"
        ).all();

        return jsonOk({ pending: rows.results });
    } catch (e) {
        return jsonErr("Error fetching pending resource sends: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/client-resources/progress
// Feeds the Overview "X/Y resources sent" daily bar. Returns the current
// unsent count plus raw recent sent timestamps — the browser decides which of
// those fall on "today" in the user's own timezone (denominator = unsent +
// sent today, numerator = sent today; resets naturally at local midnight).
// ---------------------------------------------------------------------------

async function handleGetClientResourcesProgress(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }

        var unsent = await env.DB.prepare(
            "SELECT COUNT(*) AS n FROM client_resources WHERE whatsapp_sent_at IS NULL"
        ).first();
        var recent = await env.DB.prepare(
            "SELECT whatsapp_sent_at FROM client_resources " +
            "WHERE whatsapp_sent_at IS NOT NULL AND whatsapp_sent_at >= datetime('now', '-2 days')"
        ).all();

        return jsonOk({
            unsent: unsent ? unsent.n : 0,
            recent_sent_timestamps: recent.results.map(function (r) { return r.whatsapp_sent_at; })
        });
    } catch (e) {
        return jsonErr("Error fetching resource progress: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/client-resources/:id/mark-sent
// Records the WhatsApp send: sets whatsapp_sent_at + sent_by (the permanent
// checkmark). The frontend opens wa.me synchronously BEFORE calling this, so
// window.open is never separated from the click (popup-block lesson).
// alice / rafa / developer only.
// ---------------------------------------------------------------------------

async function handlePostClientResourceMarkSent(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!canEditResources(user)) { return jsonErr("Forbidden", 403); }

        var row = await env.DB.prepare("SELECT id, whatsapp_sent_at FROM client_resources WHERE id = ?")
            .bind(id).first();
        if (!row) { return jsonErr("Assignment not found", 404); }
        if (row.whatsapp_sent_at) { return jsonErr("Already marked as sent", 409); }

        var sentAt = new Date().toISOString();
        await env.DB.prepare(
            "UPDATE client_resources SET whatsapp_sent_at = ?, sent_by = ? WHERE id = ?"
        ).bind(sentAt, user.display_name || user.role, id).run();

        return jsonOk({ id: id, whatsapp_sent_at: sentAt, sent_by: user.display_name || user.role });
    } catch (e) {
        return jsonErr("Error marking resource as sent: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/clients/:id/growth
// All monthly growth entries for a client, oldest month first (the frontend
// compounds them sequentially, so order matters).
// ---------------------------------------------------------------------------

async function handleGetClientGrowth(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }

        var rows = await env.DB.prepare(
            "SELECT id, client_id, month_label, growth_percent, entered_by, entered_at, raw_json " +
            "FROM client_growth_entries WHERE client_id = ? ORDER BY month_label ASC"
        ).bind(id).all();

        return jsonOk({ growth_entries: rows.results });
    } catch (e) {
        return jsonErr("Error fetching growth entries: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/clients/:id/growth
// Body: { month_label: 'YYYY-MM', growth_percent: number, raw_json?: object|null }
// raw_json carries the baseline/current revenue line items the percentage was
// derived from (see migrations/client_growth_entries_raw_json.sql for shape);
// omitted or null means a percent-only entry and clears any stored raw data.
// Upserts the client's growth entry for that month (one per client per month;
// re-submitting a month corrects it). alice / rafa / developer only.
// ---------------------------------------------------------------------------

async function handlePostClientGrowth(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var body = await request.json();
        var monthLabel = (body.month_label || "").trim();
        if (!/^\d{4}-\d{2}$/.test(monthLabel)) { return jsonErr("month_label must be YYYY-MM", 400); }
        var pct = Number(body.growth_percent);
        if (body.growth_percent === null || body.growth_percent === undefined || body.growth_percent === "" || isNaN(pct)) {
            return jsonErr("growth_percent must be a number", 400);
        }

        var rawJson = null;
        if (body.raw_json !== null && body.raw_json !== undefined) {
            if (typeof body.raw_json !== "object" || Array.isArray(body.raw_json)) {
                return jsonErr("raw_json must be an object", 400);
            }
            rawJson = JSON.stringify(body.raw_json);
            if (rawJson.length > 20000) { return jsonErr("raw_json too large", 400); }
        }

        var client = await env.DB.prepare("SELECT id FROM clients WHERE id = ?").bind(id).first();
        if (!client) { return jsonErr("Client not found", 404); }

        var enteredBy = user.display_name || user.role;
        await env.DB.prepare(
            "INSERT INTO client_growth_entries (id, client_id, month_label, growth_percent, entered_by, raw_json) " +
            "VALUES (?, ?, ?, ?, ?, ?) " +
            "ON CONFLICT (client_id, month_label) DO UPDATE SET " +
            "growth_percent = excluded.growth_percent, entered_by = excluded.entered_by, " +
            "raw_json = excluded.raw_json, entered_at = datetime('now')"
        ).bind(crypto.randomUUID(), id, monthLabel, pct, enteredBy, rawJson).run();

        var row = await env.DB.prepare(
            "SELECT id, client_id, month_label, growth_percent, entered_by, entered_at, raw_json " +
            "FROM client_growth_entries WHERE client_id = ? AND month_label = ?"
        ).bind(id, monthLabel).first();
        return jsonOk({ growth_entry: row });
    } catch (e) {
        return jsonErr("Error saving growth entry: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/clients/:id/package-terms
// Returns the client's real payment-terms record, or terms: null if none set.
// ---------------------------------------------------------------------------

async function handleGetClientPackageTerms(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var row = await env.DB.prepare(
            "SELECT client_id, package_id, pricing_option, base_total, discount_type, discount_value, " +
            "discount_note, adjusted_total, split_mode, installment_count, installment_amount, " +
            "custom_installments, recurrence_unit, recurrence_interval, recurrence_never_ends, " +
            "is_new_client, updated_at FROM client_package_terms WHERE client_id = ?"
        ).bind(id).first();

        if (!row) { return jsonOk({ terms: null }); }

        var customInstallments = [];
        if (row.custom_installments) {
            try { customInstallments = JSON.parse(row.custom_installments); } catch(e) { customInstallments = []; }
        }

        return jsonOk({ terms: {
            client_id:              row.client_id,
            package_id:             row.package_id,
            pricing_option:         row.pricing_option,
            base_total:             row.base_total,
            discount_type:          row.discount_type,
            discount_value:         row.discount_value,
            discount_note:          row.discount_note,
            adjusted_total:         row.adjusted_total,
            split_mode:             row.split_mode,
            installment_count:      row.installment_count,
            installment_amount:     row.installment_amount,
            custom_installments:    customInstallments,
            recurrence_unit:        row.recurrence_unit,
            recurrence_interval:    row.recurrence_interval,
            recurrence_never_ends:  !!row.recurrence_never_ends,
            is_new_client:          !!row.is_new_client,
            updated_at:             row.updated_at
        }});
    } catch (e) {
        return jsonErr("Error fetching package terms: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: PUT /api/clients/:id/package-terms
// Body: { package_id, pricing_option, base_total, discount_type?, discount_value?,
//         discount_note?, split_mode, installment_count?, installment_amount?,
//         custom_installments? (array), recurrence_unit?, recurrence_interval?,
//         recurrence_never_ends?, is_new_client }
// adjusted_total is always recomputed server-side from base_total + discount —
// never trusted from the client, same defensive pattern as other financial
// computations in this file (e.g. computeRecurringEndDate).
// Also updates clients.package (plain text field) to keep it in sync.
// alice / rafa / developer only.
// ---------------------------------------------------------------------------

async function handlePutClientPackageTerms(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var client = await env.DB.prepare("SELECT id FROM clients WHERE id = ?").bind(id).first();
        if (!client) { return jsonErr("Client not found", 404); }

        var body = await request.json();

        var baseTotal = Number(body.base_total);
        if (body.base_total === null || body.base_total === undefined || body.base_total === "" || isNaN(baseTotal)) {
            return jsonErr("base_total must be a number", 400);
        }

        var discountType = body.discount_type || null;
        if (discountType !== null && discountType !== "flat" && discountType !== "percent") {
            return jsonErr("discount_type must be 'flat', 'percent', or null", 400);
        }

        var discountValue = null;
        if (discountType) {
            discountValue = Number(body.discount_value);
            if (body.discount_value === null || body.discount_value === undefined || body.discount_value === "" || isNaN(discountValue)) {
                return jsonErr("discount_value must be a number when discount_type is set", 400);
            }
            if (discountValue < 0) { return jsonErr("discount_value must be non-negative", 400); }
            if (discountType === "percent" && discountValue > 100) { return jsonErr("percent discount_value must be between 0 and 100", 400); }
        }

        // Server-computed — never trust a client-submitted adjusted_total.
        var adjustedTotal = baseTotal;
        if (discountType === "flat") { adjustedTotal = baseTotal - discountValue; }
        else if (discountType === "percent") { adjustedTotal = baseTotal - (baseTotal * discountValue / 100); }
        if (adjustedTotal < 0) { adjustedTotal = 0; }

        var splitMode = (body.split_mode === "custom") ? "custom" : "even";

        var installmentCount = null;
        var installmentAmount = null;
        var customInstallments = null;
        if (splitMode === "even") {
            installmentCount = (body.installment_count !== null && body.installment_count !== undefined && body.installment_count !== "")
                ? parseInt(body.installment_count, 10) : null;
            installmentAmount = (body.installment_amount !== null && body.installment_amount !== undefined && body.installment_amount !== "")
                ? parseFloat(body.installment_amount) : null;
        } else {
            var custom = Array.isArray(body.custom_installments) ? body.custom_installments : [];
            customInstallments = JSON.stringify(custom);
        }

        var recurrenceUnit = body.recurrence_unit || null;
        var recurrenceInterval = (body.recurrence_interval !== null && body.recurrence_interval !== undefined && body.recurrence_interval !== "")
            ? parseInt(body.recurrence_interval, 10) : null;
        var recurrenceNeverEnds = body.recurrence_never_ends ? 1 : 0;
        var isNewClient = body.is_new_client ? 1 : 0;

        var pkgRow = null;
        if (body.package_id) {
            pkgRow = await env.DB.prepare("SELECT id, short_name FROM packages WHERE id = ?").bind(body.package_id).first();
        }

        await env.DB.prepare(
            "INSERT INTO client_package_terms (client_id, package_id, pricing_option, base_total, " +
            "discount_type, discount_value, discount_note, adjusted_total, split_mode, " +
            "installment_count, installment_amount, custom_installments, recurrence_unit, " +
            "recurrence_interval, recurrence_never_ends, is_new_client, updated_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now')) " +
            "ON CONFLICT (client_id) DO UPDATE SET " +
            "package_id = excluded.package_id, pricing_option = excluded.pricing_option, " +
            "base_total = excluded.base_total, discount_type = excluded.discount_type, " +
            "discount_value = excluded.discount_value, discount_note = excluded.discount_note, " +
            "adjusted_total = excluded.adjusted_total, split_mode = excluded.split_mode, " +
            "installment_count = excluded.installment_count, installment_amount = excluded.installment_amount, " +
            "custom_installments = excluded.custom_installments, recurrence_unit = excluded.recurrence_unit, " +
            "recurrence_interval = excluded.recurrence_interval, recurrence_never_ends = excluded.recurrence_never_ends, " +
            "is_new_client = excluded.is_new_client, updated_at = datetime('now')"
        ).bind(
            id,
            body.package_id || null,
            body.pricing_option || null,
            baseTotal,
            discountType,
            discountValue,
            body.discount_note || null,
            adjustedTotal,
            splitMode,
            installmentCount,
            installmentAmount,
            customInstallments,
            recurrenceUnit,
            recurrenceInterval,
            recurrenceNeverEnds,
            isNewClient
        ).run();

        // Keep clients.package (plain text) in sync so existing readers don't break.
        if (pkgRow) {
            await env.DB.prepare("UPDATE clients SET package = ? WHERE id = ?")
                .bind(pkgRow.short_name, id).run();
        }

        var saved = await env.DB.prepare(
            "SELECT client_id, package_id, pricing_option, base_total, discount_type, discount_value, " +
            "discount_note, adjusted_total, split_mode, installment_count, installment_amount, " +
            "custom_installments, recurrence_unit, recurrence_interval, recurrence_never_ends, " +
            "is_new_client, updated_at FROM client_package_terms WHERE client_id = ?"
        ).bind(id).first();

        var savedCustom = [];
        if (saved.custom_installments) {
            try { savedCustom = JSON.parse(saved.custom_installments); } catch(e) { savedCustom = []; }
        }

        return jsonOk({ terms: {
            client_id:              saved.client_id,
            package_id:             saved.package_id,
            pricing_option:         saved.pricing_option,
            base_total:             saved.base_total,
            discount_type:          saved.discount_type,
            discount_value:         saved.discount_value,
            discount_note:          saved.discount_note,
            adjusted_total:         saved.adjusted_total,
            split_mode:             saved.split_mode,
            installment_count:      saved.installment_count,
            installment_amount:     saved.installment_amount,
            custom_installments:    savedCustom,
            recurrence_unit:        saved.recurrence_unit,
            recurrence_interval:    saved.recurrence_interval,
            recurrence_never_ends:  !!saved.recurrence_never_ends,
            is_new_client:          !!saved.is_new_client,
            updated_at:             saved.updated_at
        }});
    } catch (e) {
        return jsonErr("Error saving package terms: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/sales/growth-ranking?month=YYYY-MM
// All ACTIVE clients with their growth entry for the given month (null when
// not yet entered), sorted by growth_percent descending — feeds the Sales
// Dashboard ranking chart. Top-3 is derived from this order, never stored.
// ---------------------------------------------------------------------------

async function handleGetSalesGrowthRanking(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }

        var url = new URL(request.url);
        var month = url.searchParams.get("month") || "";
        if (!/^\d{4}-\d{2}$/.test(month)) { return jsonErr("month must be YYYY-MM", 400); }

        var rows = await env.DB.prepare(
            "SELECT c.id AS client_id, c.name, g.growth_percent, g.entered_by, g.entered_at " +
            "FROM clients c " +
            "LEFT JOIN client_growth_entries g ON g.client_id = c.id AND g.month_label = ? " +
            "WHERE c.status = 'active' " +
            "ORDER BY (g.growth_percent IS NULL) ASC, g.growth_percent DESC, c.name ASC"
        ).bind(month).all();

        return jsonOk({ month: month, ranking: rows.results });
    } catch (e) {
        return jsonErr("Error fetching growth ranking: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/finance/statement-upload
// Accepts a CSV or plain-text bank statement plus an account_id (which Zoho
// bank/cash account these lines belong to), sends the file to Claude to
// parse, then creates each parsed line as a real Zoho Books bank transaction
// via POST banktransactions -- NOT the local D1 bank_transactions table,
// which is legacy/orphaned (see handleGetFinanceOverview). Once created in
// Zoho, these transactions immediately show up in the Reconcile tab's
// Uncategorized folder like any other live-synced line -- no separate
// confirm/ignore step, since Reconcile already reads live Zoho data.
// Zoho transaction_type values used here: "deposit" for income lines (income
// is the closest analog to a manually-recorded incoming payment) and
// "card_payment" for expense lines (a generic non-transfer outgoing
// transaction type) -- confirmed live 2026-07-16 that "deposit" and
// "card_payment" are both accepted transaction_type values by this Zoho
// Books org; if the org later rejects either value, this mapping is the
// first thing to check against Zoho's exact enum.
// ---------------------------------------------------------------------------

async function handlePostFinanceStatementUpload(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var formData = await request.formData();
        var file = formData.get("statement");
        if (!file) { return jsonErr("statement field is required", 400); }
        var accountId = formData.get("account_id");
        if (!accountId) { return jsonErr("account_id is required (which Zoho bank account these lines belong to)", 400); }

        var text = await file.text();
        if (!text || !text.trim()) { return jsonErr("File is empty", 400); }

        var claudeRes = await fetch(CLAUDE_API_URL, {
            method: "POST",
            headers: {
                "Content-Type":      "application/json",
                "x-api-key":         env.CLAUDE_API_KEY,
                "anthropic-version": "2023-06-01"
            },
            body: JSON.stringify({
                model:      CLAUDE_MODEL,
                max_tokens: 4096,
                messages:   [{
                    role: "user",
                    content: "Parse the following bank statement and return ONLY a JSON array of transaction objects. Each object must have exactly these fields: date (YYYY-MM-DD string), description (string, original text), amount (positive number, always positive), transaction_type (string: income or expense), suggested_category (short Portuguese label such as Receita de Cliente, Assinatura, Despesa Operacional, Pessoal, Transferencia, Imposto, Marketing, Aluguel, Servicos, or similar based on the description), confidence (string: alta, media, or baixa). Return ONLY the JSON array with no markdown, no explanation, no extra text. Bank statement:\n\n" + text
                }]
            })
        });

        if (!claudeRes.ok) {
            var claudeErr = await claudeRes.text();
            return jsonErr("Claude API error: " + claudeErr, 502);
        }

        var claudeData = await claudeRes.json();
        var rawText    = claudeData.content[0].text.trim();

        var parsed;
        try {
            parsed = JSON.parse(rawText);
        } catch (parseErr) {
            var arrMatch = rawText.match(/\[[\s\S]*\]/);
            if (!arrMatch) {
                var objMatch = rawText.match(/\{[\s\S]*\}/);
                if (!objMatch) { return jsonErr("Could not parse Claude response as JSON", 500); }
                parsed = JSON.parse(objMatch[0]);
            } else {
                parsed = JSON.parse(arrMatch[0]);
            }
        }
        if (!Array.isArray(parsed)) { parsed = [parsed]; }

        var zohoAuth;
        try {
            zohoAuth = await getZohoAccessToken(env);
        } catch (e) {
            return jsonErr("Zoho auth error: " + e.message, 502);
        }

        var inserted = [];
        var failures = [];
        for (var i = 0; i < parsed.length; i++) {
            var t = parsed[i];
            if (!t.date || !t.description || t.amount === undefined) { continue; }
            var isIncome = (t.transaction_type === "income");
            var amt = Math.abs(parseFloat(t.amount) || 0);

            var createBody = {
                account_id:       accountId,
                date:             t.date,
                transaction_type: isIncome ? "deposit" : "card_payment",
                amount:           amt,
                description:      t.description
            };
            var createRes = await zohoBankingFetch(zohoAuth, "POST", "banktransactions", createBody);
            if (!createRes.ok) {
                failures.push({ description: t.description, date: t.date, error: createRes.data.message || JSON.stringify(createRes.data) });
                continue;
            }
            var createdTxn = createRes.data.banktransaction || {};
            inserted.push({
                transaction_id: createdTxn.transaction_id,
                transaction_date: t.date,
                description: t.description,
                amount: amt,
                transaction_type: isIncome ? "income" : "expense",
                suggested_category: t.suggested_category || "Outro",
                confidence: (t.confidence === "alta" || t.confidence === "baixa") ? t.confidence : "media"
            });
        }

        return jsonOk({ transactions: inserted, count: inserted.length, failures: failures });
    } catch (e) {
        if (e.name === "AbortError") { return jsonErr("Zoho request timed out", 504); }
        return jsonErr("Error processing statement: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Shared helper: aggregateZohoTransactions(zohoAuth, fromDate, toDate)
// Pulls every categorized bank transaction (all active accounts) from Zoho
// Books for the given date range and sums income vs expense, and per-category
// (by category/account name Zoho attaches to each categorized line). This is
// the same live-proven call shape as handleGetFinanceReconciliation
// (banktransactions?account_id=...&filter_by=Status.Categorized) — reused here
// instead of a separate P&L report call so the dashboard, chart, and category
// tallies all agree with what Reconcile itself shows.
// Zoho's own transaction income/expense sign follows transaction_type
// (deposit/sales_without_invoices/interest_income/other_income => income;
// everything else categorized => expense), matching the existing isDeposit
// convention already used on the frontend.
// ---------------------------------------------------------------------------

var RECON_INCOME_TYPES = ["deposit", "sales_without_invoices", "interest_income", "other_income"];

async function aggregateZohoTransactions(zohoAuth, fromDate, toDate) {
    var acctRes = await zohoBankingFetch(zohoAuth, "GET", "bankaccounts");
    if (!acctRes.ok) {
        throw new Error("Zoho bank accounts error: " + (acctRes.data.message || JSON.stringify(acctRes.data)));
    }
    var accts = acctRes.data.bankaccounts || [];
    var accountIds = [];
    for (var a = 0; a < accts.length; a++) {
        if (accts[a].is_active) { accountIds.push(accts[a].account_id); }
    }

    // NOTE: filtering by date is done client-side below (not via a Zoho query
    // param) because Zoho's exact date-range param name for this endpoint
    // could not be confirmed against live docs -- filtering post-fetch on the
    // `date` field Zoho already returns is guaranteed correct regardless.
    var transactions = [];
    for (var i = 0; i < accountIds.length; i++) {
        var txRes = await zohoBankingFetch(zohoAuth, "GET",
            "banktransactions?account_id=" + encodeURIComponent(accountIds[i]) +
            "&filter_by=Status.Categorized&per_page=200");
        if (!txRes.ok) {
            throw new Error("Zoho bank transactions error: " + (txRes.data.message || JSON.stringify(txRes.data)));
        }
        var raw = txRes.data.banktransactions || [];
        for (var t = 0; t < raw.length; t++) {
            var d = raw[t].date || "";
            if (d >= fromDate && d <= toDate) { transactions.push(raw[t]); }
        }
    }
    return transactions;
}

// Zoho's `debit_or_credit` field is the reliable direction signal on
// banktransactions regardless of categorization status: "debit" = money
// coming into this bank account (income), "credit" = money going out
// (expense). Confirmed against live uncategorized transactions on
// 2026-07-16 -- e.g. "Zelle payment from AMANDA BRAGA..." => debit,
// "Zelle payment to Alice Corsino..." => credit. `transaction_type` is
// only populated with a specific value (deposit/sales_without_invoices/etc)
// once a transaction has been categorized in Zoho -- for uncategorized
// transactions it is literally the string "uncategorized", which never
// matched RECON_INCOME_TYPES and caused every uncategorized transaction
// to render as an expense regardless of actual direction.
function classifyZohoTxnAmount(txn) {
    var isIncome = txn.debit_or_credit
        ? txn.debit_or_credit === "debit"
        : RECON_INCOME_TYPES.indexOf(txn.transaction_type) !== -1;
    var amt = Math.abs(parseFloat(txn.amount) || 0);
    return { isIncome: isIncome, amount: amt };
}

// ---------------------------------------------------------------------------
// Route: GET /api/finance/overview
// Returns aggregated stats for the current calendar month, sourced live from
// Zoho Books categorized bank transactions (source of truth = Zoho, not the
// legacy local bank_transactions table -- see progress.md for why).
// ---------------------------------------------------------------------------

async function handleGetFinanceOverview(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var now = new Date();
        var year  = now.getFullYear();
        var month = now.getMonth() + 1;
        var mm    = month < 10 ? "0" + month : "" + month;
        var prefix = year + "-" + mm;
        var daysInMonth = new Date(year, month, 0).getDate();
        var fromDate = prefix + "-01";
        var toDate   = prefix + "-" + (daysInMonth < 10 ? "0" + daysInMonth : "" + daysInMonth);

        var zohoAuth;
        try {
            zohoAuth = await getZohoAccessToken(env);
        } catch (e) {
            return jsonErr("Zoho auth error: " + e.message, 502);
        }

        var txns;
        try {
            txns = await aggregateZohoTransactions(zohoAuth, fromDate, toDate);
        } catch (e) {
            return jsonErr(e.message, 502);
        }

        var income = 0, expenses = 0;
        for (var i = 0; i < txns.length; i++) {
            var c = classifyZohoTxnAmount(txns[i]);
            if (c.isIncome) { income += c.amount; } else { expenses += c.amount; }
        }
        var net = income - expenses;

        return jsonOk({ income: income, expenses: expenses, net: net, month: prefix });
    } catch (e) {
        if (e.name === "AbortError") { return jsonErr("Zoho request timed out", 504); }
        return jsonErr("Error fetching overview: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/finance/chart?months=6
// Returns categorized Zoho bank transactions grouped by month and type for
// the last N months (source of truth = Zoho, see handleGetFinanceOverview).
// ---------------------------------------------------------------------------

async function handleGetFinanceChart(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var url    = new URL(request.url);
        var months = parseInt(url.searchParams.get("months") || "6", 10);
        if (isNaN(months) || months < 1 || months > 24) { months = 6; }

        // Build list of YYYY-MM strings for the last N months
        var now   = new Date();
        var labels = [];
        for (var i = months - 1; i >= 0; i--) {
            var d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
            var yr  = d.getFullYear();
            var mo  = d.getMonth() + 1;
            var mm  = mo < 10 ? "0" + mo : "" + mo;
            labels.push(yr + "-" + mm);
        }

        var rangeStart = labels[0] + "-01";
        var lastLabelDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        var rangeEndDay = lastLabelDate.getDate();
        var rangeEnd = labels[labels.length - 1] + "-" + (rangeEndDay < 10 ? "0" + rangeEndDay : "" + rangeEndDay);

        var zohoAuth;
        try {
            zohoAuth = await getZohoAccessToken(env);
        } catch (e) {
            return jsonErr("Zoho auth error: " + e.message, 502);
        }

        var txns;
        try {
            txns = await aggregateZohoTransactions(zohoAuth, rangeStart, rangeEnd);
        } catch (e) {
            return jsonErr(e.message, 502);
        }

        var byMonth = {};
        for (var j = 0; j < txns.length; j++) {
            var txn = txns[j];
            var txnMonth = (txn.date || "").slice(0, 7);
            if (!byMonth[txnMonth]) { byMonth[txnMonth] = { income: 0, expenses: 0 }; }
            var c = classifyZohoTxnAmount(txn);
            if (c.isIncome) { byMonth[txnMonth].income += c.amount; } else { byMonth[txnMonth].expenses += c.amount; }
        }

        var data = [];
        for (var k = 0; k < labels.length; k++) {
            var lbl = labels[k];
            data.push({
                month:    lbl,
                income:   byMonth[lbl] ? byMonth[lbl].income   : 0,
                expenses: byMonth[lbl] ? byMonth[lbl].expenses : 0
            });
        }

        return jsonOk({ data: data });
    } catch (e) {
        if (e.name === "AbortError") { return jsonErr("Zoho request timed out", 504); }
        return jsonErr("Error fetching chart data: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Routes: GET/POST /api/finance/subscriptions
//         PUT/DELETE /api/finance/subscriptions/:id
// ---------------------------------------------------------------------------

async function handleGetFinanceSubscriptions(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var res = await env.DB.prepare(
            "SELECT * FROM subscriptions ORDER BY next_renewal_date ASC"
        ).all();

        return jsonOk({ subscriptions: res.results });
    } catch (e) {
        return jsonErr("Error fetching subscriptions: " + e.message, 500);
    }
}

async function handlePostFinanceSubscriptions(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var body = await request.json();
        if (!body.service_name || !body.service_name.trim()) { return jsonErr("service_name is required", 400); }
        if (body.monthly_cost === undefined || body.monthly_cost === null) { return jsonErr("monthly_cost is required", 400); }
        if (!body.next_renewal_date) { return jsonErr("next_renewal_date is required", 400); }
        if (body.manage_url && !/^https?:\/\//i.test(body.manage_url)) { return jsonErr("manage_url must start with http:// or https://", 400); }

        var id = crypto.randomUUID();
        await env.DB.prepare(
            "INSERT INTO subscriptions (id, service_name, monthly_cost, next_renewal_date, manage_url, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))"
        ).bind(id, body.service_name.trim(), parseFloat(body.monthly_cost) || 0, body.next_renewal_date, body.manage_url || null).run();

        return jsonOk({ subscription: { id: id, service_name: body.service_name.trim(), monthly_cost: parseFloat(body.monthly_cost) || 0, next_renewal_date: body.next_renewal_date, manage_url: body.manage_url || null } });
    } catch (e) {
        return jsonErr("Error creating subscription: " + e.message, 500);
    }
}

async function handlePutFinanceSubscription(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var existing = await env.DB.prepare("SELECT id FROM subscriptions WHERE id = ?").bind(id).first();
        if (!existing) { return jsonErr("Subscription not found", 404); }

        var body = await request.json();
        if (body.hasOwnProperty("service_name") && body.service_name && body.service_name.trim()) {
            await env.DB.prepare("UPDATE subscriptions SET service_name = ? WHERE id = ?").bind(body.service_name.trim(), id).run();
        }
        if (body.hasOwnProperty("monthly_cost") && body.monthly_cost !== undefined) {
            await env.DB.prepare("UPDATE subscriptions SET monthly_cost = ? WHERE id = ?").bind(parseFloat(body.monthly_cost) || 0, id).run();
        }
        if (body.hasOwnProperty("next_renewal_date") && body.next_renewal_date) {
            await env.DB.prepare("UPDATE subscriptions SET next_renewal_date = ? WHERE id = ?").bind(body.next_renewal_date, id).run();
        }
        if (body.hasOwnProperty("manage_url")) {
            if (body.manage_url && !/^https?:\/\//i.test(body.manage_url)) { return jsonErr("manage_url must start with http:// or https://", 400); }
            await env.DB.prepare("UPDATE subscriptions SET manage_url = ? WHERE id = ?").bind(body.manage_url || null, id).run();
        }

        var row = await env.DB.prepare("SELECT * FROM subscriptions WHERE id = ?").bind(id).first();
        return jsonOk({ subscription: row });
    } catch (e) {
        return jsonErr("Error updating subscription: " + e.message, 500);
    }
}

async function handleDeleteFinanceSubscription(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var existing = await env.DB.prepare("SELECT id FROM subscriptions WHERE id = ?").bind(id).first();
        if (!existing) { return jsonErr("Subscription not found", 404); }

        await env.DB.prepare("DELETE FROM subscriptions WHERE id = ?").bind(id).run();
        return jsonOk({ ok: true, id: id });
    } catch (e) {
        return jsonErr("Error deleting subscription: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/invoices?status=unpaid|paid
// Returns a simplified list of invoices filtered by status from Zoho Books.
// Auth: alice / rafa / developer only.
// ---------------------------------------------------------------------------

async function handleGetInvoices(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var url = new URL(request.url);
        var status = url.searchParams.get("status") || "unpaid";

        var zohoAuth;
        try {
            zohoAuth = await getZohoAccessToken(env);
        } catch (e) {
            return jsonErr("Zoho auth error: " + e.message, 502);
        }

        // Zoho only accepts one status value at a time, so fetch each status separately and merge
        var statusesToFetch = (status === "paid")   ? ["paid"] :
                              (status === "draft")  ? ["draft"] :
                              (status === "unpaid") ? ["sent", "overdue"] :
                                                     ["sent", "overdue"];

        async function fetchOneStatus(zohoStatus) {
            var zohoListUrl = "https://www.zohoapis.com/books/v3/invoices" +
                "?organization_id=" + zohoAuth.organization_id +
                "&status=" + zohoStatus +
                "&per_page=100&sort_column=date&sort_order=D";
            var ctrl = new AbortController();
            var timer = setTimeout(function() { ctrl.abort(); }, 15000);
            var res;
            try {
                res = await fetch(zohoListUrl, {
                    method: "GET",
                    headers: { "Authorization": "Zoho-oauthtoken " + zohoAuth.access_token },
                    signal: ctrl.signal
                });
            } finally {
                clearTimeout(timer);
            }
            var data = await res.json();
            if (!res.ok || data.code !== 0) {
                throw new Error("Zoho invoices error (status=" + zohoStatus + " http=" + res.status + "): " + (data.message || JSON.stringify(data)));
            }
            return data.invoices || [];
        }

        var allRaw = [];
        for (var si = 0; si < statusesToFetch.length; si++) {
            var batch = await fetchOneStatus(statusesToFetch[si]);
            for (var bi = 0; bi < batch.length; bi++) { allRaw.push(batch[bi]); }
        }

        var simplified = [];
        for (var i = 0; i < allRaw.length; i++) {
            var inv = allRaw[i];
            simplified.push({
                invoice_id:     inv.invoice_id,
                invoice_number: inv.invoice_number,
                customer_name:  inv.customer_name,
                total:          inv.total,
                due_date:       inv.due_date,
                status:         inv.status
            });
        }

        return jsonOk({ invoices: simplified, status_filter: status });
    } catch (e) {
        if (e.name === "AbortError") { return jsonErr("Zoho request timed out", 504); }
        return jsonErr("Error fetching invoices: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/invoices/:zoho_invoice_id/package-check
// Looks up the invoice's customer in Zoho, resolves the matching D1 client via
// zoho_customer_id, then checks whether that client's package has a base_price set.
// Returns { ok: true, has_price: bool, package_name: string|null }
// Auth: alice / rafa / developer.
// ---------------------------------------------------------------------------

async function handleGetInvoicePackageCheck(zohoInvoiceId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var zohoAuth;
        try {
            zohoAuth = await getZohoAccessToken(env);
        } catch (e) {
            return jsonErr("Zoho auth error: " + e.message, 502);
        }

        // Fetch the invoice from Zoho to get customer_id
        var invUrl = "https://www.zohoapis.com/books/v3/invoices/" + zohoInvoiceId +
            "?organization_id=" + zohoAuth.organization_id;
        var ctrl = new AbortController();
        var timer = setTimeout(function() { ctrl.abort(); }, 15000);
        var invRes;
        try {
            invRes = await fetch(invUrl, {
                headers: { "Authorization": "Zoho-oauthtoken " + zohoAuth.access_token },
                signal: ctrl.signal
            });
        } finally {
            clearTimeout(timer);
        }
        var invData = await invRes.json();
        if (!invRes.ok || invData.code !== 0) {
            return jsonErr("Zoho invoice fetch failed: " + (invData.message || JSON.stringify(invData)), 502);
        }

        var zohoCustomerId = invData.invoice && invData.invoice.customer_id;
        if (!zohoCustomerId) {
            return jsonOk({ ok: true, has_price: false, package_name: null });
        }

        // Resolve D1 client via zoho_customer_id
        var clientRow = await env.DB.prepare(
            "SELECT package FROM clients WHERE zoho_customer_id = ?"
        ).bind(String(zohoCustomerId)).first();

        if (!clientRow || !clientRow.package) {
            return jsonOk({ ok: true, has_price: false, package_name: null });
        }

        var packageShortName = clientRow.package;

        // Look up the package's pricing (base_price is the legacy column;
        // upfront_price / installment_total_price are used by the newer packages)
        var pkgRow = await env.DB.prepare(
            "SELECT short_name, full_name, base_price, upfront_price, installment_total_price FROM packages WHERE short_name = ?"
        ).bind(packageShortName).first();

        if (!pkgRow) {
            return jsonOk({ ok: true, has_price: false, package_name: packageShortName });
        }

        var hasPrice = (pkgRow.base_price !== null && pkgRow.base_price !== undefined) ||
            (pkgRow.upfront_price !== null && pkgRow.upfront_price !== undefined) ||
            (pkgRow.installment_total_price !== null && pkgRow.installment_total_price !== undefined);

        return jsonOk({
            ok:           true,
            has_price:    hasPrice,
            package_name: pkgRow.short_name
        });
    } catch (e) {
        if (e.name === "AbortError") { return jsonErr("Zoho request timed out", 504); }
        return jsonErr("Error checking package pricing: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/invoices/:zoho_invoice_id/mark-sent
// Calls Zoho's "Mark as Sent" action, which changes invoice status from
// draft → sent without emailing the client. Auth: alice / rafa / developer.
// ---------------------------------------------------------------------------

async function handlePostInvoiceMarkSent(zohoInvoiceId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var zohoAuth;
        try {
            zohoAuth = await getZohoAccessToken(env);
        } catch (e) {
            return jsonErr("Zoho auth error: " + e.message, 502);
        }

        var markUrl = "https://www.zohoapis.com/books/v3/invoices/" + zohoInvoiceId +
            "/status/sent?organization_id=" + zohoAuth.organization_id;

        var ctrl  = new AbortController();
        var timer = setTimeout(function() { ctrl.abort(); }, 15000);
        var res;
        try {
            res = await fetch(markUrl, {
                method:  "POST",
                headers: { "Authorization": "Zoho-oauthtoken " + zohoAuth.access_token },
                signal:  ctrl.signal
            });
        } finally {
            clearTimeout(timer);
        }

        var data = await res.json();
        if (!res.ok || data.code !== 0) {
            return jsonErr("Zoho mark-sent failed: " + (data.message || JSON.stringify(data)), 502);
        }

        return jsonOk({ ok: true, invoice_id: zohoInvoiceId, message: data.message || "Marked as sent" });
    } catch (e) {
        if (e.name === "AbortError") { return jsonErr("Zoho request timed out", 504); }
        return jsonErr("Error marking invoice as sent: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/invoices/:zoho_invoice_id/items
// Returns the raw editable line items for a draft invoice (native in-app
// editor). Only allowed while the invoice is still a draft.
// Auth: alice / rafa / developer.
// ---------------------------------------------------------------------------

async function handleGetInvoiceItems(zohoInvoiceId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var zohoAuth;
        try {
            zohoAuth = await getZohoAccessToken(env);
        } catch (e) {
            return jsonErr("Zoho auth error: " + e.message, 502);
        }

        var invUrl = "https://www.zohoapis.com/books/v3/invoices/" + zohoInvoiceId +
            "?organization_id=" + zohoAuth.organization_id;
        var ctrl = new AbortController();
        var timer = setTimeout(function() { ctrl.abort(); }, 15000);
        var res;
        try {
            res = await fetch(invUrl, {
                headers: { "Authorization": "Zoho-oauthtoken " + zohoAuth.access_token },
                signal: ctrl.signal
            });
        } finally {
            clearTimeout(timer);
        }
        var data = await res.json();
        if (!res.ok || data.code !== 0) {
            return jsonErr("Zoho invoice fetch failed: " + (data.message || JSON.stringify(data)), 502);
        }

        var inv = data.invoice;
        if (inv.status !== "draft") {
            return jsonErr("Invoice is not a draft; line items can only be edited while in draft status", 400);
        }

        var lineItems = (inv.line_items || []).map(function(li) {
            return {
                line_item_id: li.line_item_id,
                name:         li.name || "",
                description:  li.description || "",
                quantity:     li.quantity !== undefined ? li.quantity : 1,
                rate:         li.rate !== undefined ? li.rate : 0
            };
        });

        return jsonOk({
            ok:             true,
            invoice_id:     inv.invoice_id,
            invoice_number: inv.invoice_number,
            status:         inv.status,
            line_items:     lineItems
        });
    } catch (e) {
        if (e.name === "AbortError") { return jsonErr("Zoho request timed out", 504); }
        return jsonErr("Error fetching invoice items: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: PUT /api/invoices/:zoho_invoice_id/items
// Updates a draft invoice's line items in Zoho Books. Body: { line_items: [...] }
// Only allowed while the invoice is still a draft (checked server-side).
// Auth: alice / rafa / developer.
// ---------------------------------------------------------------------------

async function handlePutInvoiceItems(zohoInvoiceId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var body = await request.json();
        var lineItems = body && body.line_items;
        if (!Array.isArray(lineItems) || lineItems.length === 0) {
            return jsonErr("line_items array is required", 400);
        }
        for (var i = 0; i < lineItems.length; i++) {
            if (!lineItems[i].name) { return jsonErr("Each line item requires a name", 400); }
        }

        var zohoAuth;
        try {
            zohoAuth = await getZohoAccessToken(env);
        } catch (e) {
            return jsonErr("Zoho auth error: " + e.message, 502);
        }

        // Confirm the invoice is still a draft before allowing an edit.
        var invUrl = "https://www.zohoapis.com/books/v3/invoices/" + zohoInvoiceId +
            "?organization_id=" + zohoAuth.organization_id;
        var checkCtrl = new AbortController();
        var checkTimer = setTimeout(function() { checkCtrl.abort(); }, 15000);
        var checkRes;
        try {
            checkRes = await fetch(invUrl, {
                headers: { "Authorization": "Zoho-oauthtoken " + zohoAuth.access_token },
                signal: checkCtrl.signal
            });
        } finally {
            clearTimeout(checkTimer);
        }
        var checkData = await checkRes.json();
        if (!checkRes.ok || checkData.code !== 0) {
            return jsonErr("Zoho invoice fetch failed: " + (checkData.message || JSON.stringify(checkData)), 502);
        }
        if (checkData.invoice.status !== "draft") {
            return jsonErr("Invoice is not a draft; line items can only be edited while in draft status", 400);
        }

        var updatePayload = {
            line_items: lineItems.map(function(li) {
                var out = {
                    name:        li.name,
                    description: li.description || "",
                    quantity:    li.quantity !== undefined ? li.quantity : 1,
                    rate:        li.rate !== undefined ? li.rate : 0
                };
                if (li.line_item_id) { out.line_item_id = li.line_item_id; }
                return out;
            })
        };

        var updCtrl = new AbortController();
        var updTimer = setTimeout(function() { updCtrl.abort(); }, 15000);
        var updRes;
        try {
            updRes = await fetch(invUrl, {
                method:  "PUT",
                headers: {
                    "Authorization": "Zoho-oauthtoken " + zohoAuth.access_token,
                    "Content-Type":  "application/json"
                },
                body:    JSON.stringify(updatePayload),
                signal:  updCtrl.signal
            });
        } finally {
            clearTimeout(updTimer);
        }
        var updData = await updRes.json();
        if (!updRes.ok || updData.code !== 0) {
            return jsonErr("Zoho invoice update failed: " + (updData.message || JSON.stringify(updData)), 502);
        }

        return jsonOk({ ok: true, invoice_id: zohoInvoiceId, message: updData.message || "Invoice updated" });
    } catch (e) {
        if (e.name === "AbortError") { return jsonErr("Zoho request timed out", 504); }
        return jsonErr("Error updating invoice items: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Bank reconciliation — Zoho Books Banking API
// Shared helper: zohoBankingFetch(zohoAuth, method, pathAndQuery, body)
// pathAndQuery is relative to https://www.zohoapis.com/books/v3/ and must NOT
// already contain organization_id (appended here, server-side).
// ---------------------------------------------------------------------------

async function zohoBankingFetch(zohoAuth, method, pathAndQuery, body) {
    var zohoUrl = "https://www.zohoapis.com/books/v3/" + pathAndQuery +
        (pathAndQuery.indexOf("?") === -1 ? "?" : "&") +
        "organization_id=" + zohoAuth.organization_id;
    var ctrl  = new AbortController();
    var timer = setTimeout(function() { ctrl.abort(); }, 15000);
    var res;
    var fOpts = {
        method:  method,
        headers: { "Authorization": "Zoho-oauthtoken " + zohoAuth.access_token },
        signal:  ctrl.signal
    };
    if (body) {
        fOpts.headers["Content-Type"] = "application/json";
        fOpts.body = JSON.stringify(body);
    }
    try {
        res = await fetch(zohoUrl, fOpts);
    } finally {
        clearTimeout(timer);
    }
    var data = await res.json();
    return { ok: (res.ok && data.code === 0), status: res.status, data: data };
}

// ---------------------------------------------------------------------------
// Route: GET /api/finance/reconciliation?status=uncategorized|all|categorized|manually_added|excluded|matched&account_id=...
// Lists bank transactions from Zoho Books. When account_id is omitted, every
// bank/cash account in the org is queried and the results merged.
// Auth: alice / rafa / developer only.
// ---------------------------------------------------------------------------

var RECON_STATUS_MAP = {
    "all":            "Status.All",
    "uncategorized":  "Status.Uncategorized",
    "categorized":    "Status.Categorized",
    "manually_added": "Status.ManuallyAdded",
    "excluded":       "Status.Excluded",
    "matched":        "Status.Matched"
};

async function handleGetFinanceReconciliation(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var url = new URL(request.url);
        var statusParam = (url.searchParams.get("status") || "uncategorized").toLowerCase();
        var filterBy = RECON_STATUS_MAP[statusParam];
        if (!filterBy) { return jsonErr("Invalid status. Use: all, uncategorized, categorized, manually_added, excluded, matched", 400); }

        var zohoAuth;
        try {
            zohoAuth = await getZohoAccessToken(env);
        } catch (e) {
            return jsonErr("Zoho auth error: " + e.message, 502);
        }

        var accountIds = [];
        var requestedAccount = url.searchParams.get("account_id");
        if (requestedAccount) {
            accountIds.push(requestedAccount);
        } else {
            var acctRes = await zohoBankingFetch(zohoAuth, "GET", "bankaccounts");
            if (!acctRes.ok) {
                return jsonErr("Zoho bank accounts error: " + (acctRes.data.message || JSON.stringify(acctRes.data)), 502);
            }
            var accts = acctRes.data.bankaccounts || [];
            for (var a = 0; a < accts.length; a++) {
                if (accts[a].is_active) { accountIds.push(accts[a].account_id); }
            }
        }

        var transactions = [];
        for (var i = 0; i < accountIds.length; i++) {
            var txRes = await zohoBankingFetch(zohoAuth, "GET",
                "banktransactions?account_id=" + encodeURIComponent(accountIds[i]) +
                "&filter_by=" + filterBy + "&per_page=200");
            if (!txRes.ok) {
                return jsonErr("Zoho bank transactions error: " + (txRes.data.message || JSON.stringify(txRes.data)), 502);
            }
            var raw = txRes.data.banktransactions || [];
            for (var t = 0; t < raw.length; t++) {
                transactions.push({
                    transaction_id:          raw[t].transaction_id,
                    imported_transaction_id: raw[t].imported_transaction_id || "",
                    date:                    raw[t].date,
                    amount:                  raw[t].amount,
                    description:             raw[t].description || "",
                    payee:                   raw[t].payee || "",
                    customer_id:             raw[t].customer_id || "",
                    status:                  raw[t].status,
                    transaction_type:        raw[t].transaction_type,
                    debit_or_credit:         raw[t].debit_or_credit || "",
                    is_income:               classifyZohoTxnAmount(raw[t]).isIncome,
                    account_id:              raw[t].account_id,
                    account_name:            raw[t].account_name || ""
                });
            }
        }

        transactions.sort(function(x, y) {
            return (y.date || "") < (x.date || "") ? -1 : ((y.date || "") > (x.date || "") ? 1 : 0);
        });

        return jsonOk({ transactions: transactions, status_filter: statusParam });
    } catch (e) {
        if (e.name === "AbortError") { return jsonErr("Zoho request timed out", 504); }
        return jsonErr("Error fetching bank transactions: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/finance/reconciliation/:transaction_id/match-invoice
// Body: { customer_id, invoice_id }
// Categorizes an uncategorized deposit as a customer payment applied to the
// given invoice. Fetches the transaction (amount, date) and the invoice
// (balance) first so amount_applied never exceeds either.
//
// NOTE: The categorize/customerpayments body fields were confirmed against a
// live Zoho call on 2026-07-06 (test statement line in "TEST BANK - DO NOT
// USE"). account_id (the bank account holding the uncategorized line) is
// REQUIRED — omitting it returns Zoho code 11086 "Invalid account chosen".
// Auth: alice / rafa / developer only.
// ---------------------------------------------------------------------------

async function handlePostReconciliationMatchInvoice(transactionId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var body = await request.json();
        if (!body.customer_id) { return jsonErr("customer_id is required", 400); }
        if (!body.invoice_id)  { return jsonErr("invoice_id is required", 400); }
        if (!body.amount)      { return jsonErr("amount is required", 400); }
        if (!body.date)        { return jsonErr("date is required", 400); }
        if (!body.account_id)  { return jsonErr("account_id is required", 400); }

        var zohoAuth;
        try {
            zohoAuth = await getZohoAccessToken(env);
        } catch (e) {
            return jsonErr("Zoho auth error: " + e.message, 502);
        }

        var txnAmount = parseFloat(body.amount) || 0;

        // 1. Fetch the invoice for its outstanding balance
        var invUrl = "https://www.zohoapis.com/books/v3/invoices/" + encodeURIComponent(body.invoice_id) +
            "?organization_id=" + zohoAuth.organization_id;
        var ctrl  = new AbortController();
        var timer = setTimeout(function() { ctrl.abort(); }, 15000);
        var invRes;
        try {
            invRes = await fetch(invUrl, {
                headers: { "Authorization": "Zoho-oauthtoken " + zohoAuth.access_token },
                signal: ctrl.signal
            });
        } finally {
            clearTimeout(timer);
        }
        var invData = await invRes.json();
        if (!invRes.ok || invData.code !== 0) {
            return jsonErr("Zoho invoice fetch failed: " + (invData.message || JSON.stringify(invData)), 502);
        }
        var invBalance = parseFloat(invData.invoice && invData.invoice.balance) || 0;
        var amountApplied = Math.min(txnAmount, invBalance);
        if (amountApplied <= 0) { return jsonErr("Nothing to apply: transaction amount is " + txnAmount + ", invoice balance is " + invBalance, 400); }

        // 2. Categorize the transaction as a customer payment applied to the invoice
        var catBody = {
            customer_id:  body.customer_id,
            payment_mode: "banktransfer",
            amount:       txnAmount,
            date:         body.date,
            account_id:   body.account_id,
            invoices: [
                { invoice_id: body.invoice_id, amount_applied: amountApplied }
            ]
        };
        var catRes = await zohoBankingFetch(zohoAuth, "POST",
            "banktransactions/uncategorized/" + encodeURIComponent(transactionId) + "/categorize/customerpayments",
            catBody);
        if (!catRes.ok) {
            return jsonErr("Zoho categorize failed: " + (catRes.data.message || JSON.stringify(catRes.data)), 502);
        }

        return jsonOk({ ok: true, transaction_id: transactionId, invoice_id: body.invoice_id, amount_applied: amountApplied, message: catRes.data.message || "Categorized" });
    } catch (e) {
        if (e.name === "AbortError") { return jsonErr("Zoho request timed out", 504); }
        return jsonErr("Error matching transaction to invoice: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/finance/reconciliation/:transaction_id/categorize
// Body: { account_id, category_account_id, amount, date, description? }
// Categorizes an uncategorized transaction directly to a plain expense or
// equity chart-of-accounts entry (e.g. Owner's Draw, Software) -- separate
// from match-invoice, which categorizes as a customer payment instead. Uses
// the same "categorize/<sub-resource>" sub-resource convention already
// proven live for customerpayments (see handlePostReconciliationMatchInvoice
// above); Zoho's docs list this sibling operation as "Categorize as expense",
// distinct from the customer-payment categorize path. account_id is required
// in the body per the live-verified 2026-07-06 gotcha (Zoho code 11086
// "Invalid account chosen" without it) -- same requirement applies here.
// CORRECTED 2026-07-22, real test call: the original guess 404/failed live
// ("Please enter valid expense account") on both counts confirmed via
// Zoho's own docs (fetched directly, not search-summarized) --
// (1) path must be plural "categorize/expenses", not "categorize/expense"
// (matches the confirmed-working sibling "categorize/customerpayments"
// convention); (2) "category_id" is not a real Zoho field at all -- the
// documented attribute for "which account the money is categorized into"
// is to_account_id (from_account_id/to_account_id pair), not category_id.
//
// CORRECTED AGAIN 2026-07-22, real test call: the to_account_id fix above
// hit the same "Please enter valid expense account" message but now with a
// real Zoho error code (1002) surfaced -- Zoho generically means "this
// account_id isn't valid for this operation." Root cause confirmed via
// Zoho's own help docs: Owner's Draw and other Equity-type accounts are
// NOT valid targets for categorize/expenses at all -- that operation only
// ever accepts real Expense-type accounts. Equity postings (owner's draw,
// owner's equity, opening balance, retained earnings -- everything this
// app's own folder rail already lists alongside real expense categories,
// see handleGetFinanceCategories' AccountType.Equity filter) need Zoho's
// generic categorize endpoint instead, with transaction_type set to the
// matching enum value (owner_drawings confirmed as a real documented
// value; other equity categories are mapped to it too since Zoho's
// bank-categorization transaction_type enum doesn't have a distinct value
// per equity account -- if a specific equity category needs a different
// transaction_type, that would be the next thing to check against a real
// test call).
// STILL NOT FIELD-CONFIRMED for the generic categorize endpoint specifically
// (same documentation gap as the expenses path) -- if this fails, get the
// real Zoho error code from the response before guessing further.
// Auth: alice / rafa / developer only.
// ---------------------------------------------------------------------------

async function handlePostReconciliationCategorize(transactionId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var body = await request.json();
        if (!body.account_id)          { return jsonErr("account_id is required", 400); }
        if (!body.category_account_id) { return jsonErr("category_account_id is required", 400); }
        if (!body.amount)              { return jsonErr("amount is required", 400); }
        if (!body.date)                { return jsonErr("date is required", 400); }

        var zohoAuth;
        try {
            zohoAuth = await getZohoAccessToken(env);
        } catch (e) {
            return jsonErr("Zoho auth error: " + e.message, 502);
        }

        var isEquity = body.category_account_type === "equity";
        var isIncome = body.category_account_type === "income";
        var catBody, catPath, opLabel;

        if (isEquity) {
            // CONFIRMED 2026-07-22 via a real live test call direct against
            // Zoho (not a guess) -- from_account_id (the bank side) +
            // to_account_id (the equity/drawings account), NOT account_id.
            // Real response: code 0, transaction actually categorized.
            catBody = {
                transaction_type: "owner_drawings",
                from_account_id:  body.account_id,
                to_account_id:    body.category_account_id,
                date:             body.date,
                amount:           parseFloat(body.amount) || 0,
                description:      body.description || ""
            };
            catPath = "banktransactions/uncategorized/" + encodeURIComponent(transactionId) + "/categorize";
            opLabel = "categorize-as-equity";
        } else if (isIncome) {
            // CONFIRMED 2026-07-22 via a real live test call direct against
            // Zoho (not a guess) -- generic categorize endpoint,
            // transaction_type "deposit". Roles are INVERTED from
            // owner_drawings: from_account_id is the income category (money
            // conceptually originates from Income), to_account_id is the
            // bank account (where it lands) -- confirmed by testing the
            // non-inverted pairing first, which failed with a real Zoho
            // error (code 108025 "Transaction is not associated to the
            // specified bank"), then the inverted pairing, which succeeded
            // (code 0, real transaction categorized against "Event Income").
            catBody = {
                transaction_type: "deposit",
                from_account_id:  body.category_account_id,
                to_account_id:    body.account_id,
                date:             body.date,
                amount:           parseFloat(body.amount) || 0,
                description:      body.description || ""
            };
            catPath = "banktransactions/uncategorized/" + encodeURIComponent(transactionId) + "/categorize";
            opLabel = "categorize-as-income";
        } else {
            // CONFIRMED 2026-07-22 via a real live test call direct against
            // Zoho (not a guess) -- account_id is the destination expense
            // account, paid_through_account_id is the bank side. Real
            // response: code 0, a genuine expense record created and linked
            // back to the real imported bank transaction.
            catBody = {
                account_id:              body.category_account_id,
                paid_through_account_id: body.account_id,
                date:                    body.date,
                amount:                  parseFloat(body.amount) || 0,
                description:             body.description || ""
            };
            catPath = "banktransactions/uncategorized/" + encodeURIComponent(transactionId) + "/categorize/expenses";
            opLabel = "categorize-as-expense";
        }

        var catRes = await zohoBankingFetch(zohoAuth, "POST", catPath, catBody);
        if (!catRes.ok) {
            // Include the raw Zoho error code + full body -- keep this
            // detail in every failure response, not just a human-readable
            // summary, since that summary has already proven identical
            // across multiple different underlying causes tonight.
            return jsonErr("Zoho " + opLabel + " failed (code " + catRes.data.code + "): " +
                (catRes.data.message || JSON.stringify(catRes.data)) + " | raw: " + JSON.stringify(catRes.data), 502);
        }

        return jsonOk({ ok: true, transaction_id: transactionId, category_account_id: body.category_account_id, message: catRes.data.message || "Categorized" });
    } catch (e) {
        if (e.name === "AbortError") { return jsonErr("Zoho request timed out", 504); }
        return jsonErr("Error categorizing transaction: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Routes: POST /api/finance/reconciliation/:transaction_id/exclude|restore|unmatch
// exclude — hide a transaction from reconciliation (Alice's non-client deposits)
// restore — undo an exclude
// unmatch — undo a categorize/match. Confirmed live 2026-07-06: lines
// categorized via categorize/customerpayments must be reversed with
// POST banktransactions/:id/uncategorize?account_id=..., and account_id is
// REQUIRED as a query param (code 4 without it). GET banktransactions/:id is
// NOT used to resolve account_id — same as the match-invoice fix, it does not
// reliably resolve transactions originating from statement-import lines
// ("Transaction does not exist" — confirmed live 2026-07-06). account_id is
// instead sent by the frontend from its cached transaction record.
//
// SECOND bug found + fixed live 2026-07-06: for transactions that originated
// from an imported bank statement line, uncategorize (and unmatch) must be
// called with the transaction's imported_transaction_id, NOT its
// transaction_id -- calling with transaction_id returns Zoho code 108005
// "The transaction(s) you are looking for does not exist." even though the
// same transaction_id appears fine in GET banktransactions (list). Confirmed
// live: transaction_id 455783000000112003 (imported_transaction_id
// 455783000000116004) failed uncategorize with transaction_id, succeeded
// immediately with imported_transaction_id. The frontend now sends
// imported_transaction_id alongside account_id; falls back to the URL
// transaction_id for transactions with no imported_transaction_id (e.g.
// manually-added, non-statement-import transactions).
// Auth: alice / rafa / developer only.
// ---------------------------------------------------------------------------

async function handlePostReconciliationAction(transactionId, action, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        if (action !== "exclude" && action !== "restore" && action !== "unmatch") {
            return jsonErr("Unknown action", 400);
        }

        var zohoAuth;
        try {
            zohoAuth = await getZohoAccessToken(env);
        } catch (e) {
            return jsonErr("Zoho auth error: " + e.message, 502);
        }

        var zohoPath;
        if (action === "exclude") {
            zohoPath = "banktransactions/uncategorized/" + encodeURIComponent(transactionId) + "/exclude";
        } else if (action === "restore") {
            zohoPath = "banktransactions/uncategorized/" + encodeURIComponent(transactionId) + "/restore";
        } else {
            var body = {};
            try { body = await request.json(); } catch (e) {}
            if (!body.account_id) { return jsonErr("account_id is required", 400); }
            var reverseId = body.imported_transaction_id || transactionId;
            zohoPath = "banktransactions/" + encodeURIComponent(reverseId) + "/uncategorize" +
                "?account_id=" + encodeURIComponent(body.account_id);
        }

        var res = await zohoBankingFetch(zohoAuth, "POST", zohoPath);
        if (!res.ok) {
            return jsonErr("Zoho " + action + " failed: " + (res.data.message || JSON.stringify(res.data)), 502);
        }

        return jsonOk({ ok: true, transaction_id: transactionId, action: action, message: res.data.message || "Done" });
    } catch (e) {
        if (e.name === "AbortError") { return jsonErr("Zoho request timed out", 504); }
        return jsonErr("Error on " + action + ": " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/finance/reconciliation/category-totals?from=YYYY-MM-DD&to=YYYY-MM-DD
// Live per-category (and "Client Income") totals for the Reconcile folder
// rail, sourced fresh from Zoho every call (never from session-only state) so
// a page reload or a return visit tomorrow shows the same correct totals.
// Reuses aggregateZohoTransactions (see handleGetFinanceOverview above) --
// same categorized-transaction fetch, just grouped by category instead of by
// month. Defaults from/to to the current calendar month when omitted.
// CORRECTED 2026-07-22/23: the prior field-name guesses (category_id,
// debit_or_credit_account_id) were confirmed wrong by fetching a real
// categorized banktransaction directly from Zoho -- neither field exists.
// The real field is `offset_account_name` (present on every categorized
// transaction, confirmed for both an expense-type and an owner_drawings/
// equity-type categorization). Zoho does NOT return an offset account ID,
// only its name, so this builds a name -> account_id map from the chart of
// accounts (same Expense+Equity fetch handleGetFinanceCategories already
// does) to resolve back to the real account_id every other part of this
// app keys folders by. Client Income is still identified via customer_id,
// confirmed present and correct on a real customer_payment transaction.
// Auth: alice / rafa / developer only.
// ---------------------------------------------------------------------------

async function handleGetReconciliationCategoryTotals(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var url = new URL(request.url);
        var now = new Date();
        var year = now.getFullYear();
        var month = now.getMonth() + 1;
        var mm = month < 10 ? "0" + month : "" + month;
        var defaultFrom = year + "-" + mm + "-01";
        var daysInMonth = new Date(year, month, 0).getDate();
        var defaultTo = year + "-" + mm + "-" + (daysInMonth < 10 ? "0" + daysInMonth : "" + daysInMonth);

        var fromDate = url.searchParams.get("from") || defaultFrom;
        var toDate   = url.searchParams.get("to")   || defaultTo;

        var zohoAuth;
        try {
            zohoAuth = await getZohoAccessToken(env);
        } catch (e) {
            return jsonErr("Zoho auth error: " + e.message, 502);
        }

        var txns;
        try {
            txns = await aggregateZohoTransactions(zohoAuth, fromDate, toDate);
        } catch (e) {
            return jsonErr(e.message, 502);
        }

        // Build offset_account_name -> account_id map from the real chart of
        // accounts (same Expense+Equity filters as handleGetFinanceCategories)
        // -- Zoho's categorized-transaction list only ever returns the
        // category's NAME, never its account_id, so this is the only way to
        // resolve back to the real id every folder/label/hide-state is keyed by.
        var nameToId = {};
        var nameToType = {};
        var coaFilters = [
            { filter: "AccountType.Expense", type: "expense" },
            { filter: "AccountType.Equity",  type: "equity" },
            { filter: "AccountType.Income",  type: "income" }
        ];
        for (var f = 0; f < coaFilters.length; f++) {
            var coaRes = await zohoBankingFetch(zohoAuth, "GET", "chartofaccounts?filter_by=" + coaFilters[f].filter + "&per_page=200");
            if (coaRes.ok) {
                var coa = coaRes.data.chartofaccounts || [];
                for (var c = 0; c < coa.length; c++) {
                    nameToId[coa[c].account_name]   = coa[c].account_id;
                    nameToType[coa[c].account_name] = coaFilters[f].type;
                }
            }
        }

        // Custom labels (AKA) substitute for the real Zoho account_name in
        // this tally display too -- purely cosmetic, keyed by the same
        // account_id every categorize action already uses.
        var labelRows = await env.DB.prepare("SELECT category_account_id, custom_label FROM finance_category_labels").all();
        var labelSet = {};
        for (var lr = 0; lr < labelRows.results.length; lr++) { labelSet[labelRows.results[lr].category_account_id] = labelRows.results[lr].custom_label; }

        var byCategory = {};
        for (var i = 0; i < txns.length; i++) {
            var t = txns[i];
            var isClientIncome = !!t.customer_id;
            var key, label, accountType;
            if (isClientIncome) {
                key = "client_income";
                label = labelSet["client_income"] || "Client Income";
                accountType = "income";
            } else {
                var resolvedId = nameToId[t.offset_account_name];
                key   = resolvedId || ("unresolved:" + (t.offset_account_name || "unknown"));
                label = labelSet[key] || t.offset_account_name || "Other";
                accountType = nameToType[t.offset_account_name] || "expense";
            }
            if (!byCategory[key]) { byCategory[key] = { category_id: key, category_name: label, account_type: accountType, total: 0, count: 0 }; }
            byCategory[key].total += Math.abs(parseFloat(t.amount) || 0);
            byCategory[key].count += 1;
        }

        var totals = [];
        for (var k in byCategory) { if (byCategory.hasOwnProperty(k)) { totals.push(byCategory[k]); } }

        return jsonOk({ from: fromDate, to: toDate, totals: totals });
    } catch (e) {
        if (e.name === "AbortError") { return jsonErr("Zoho request timed out", 504); }
        return jsonErr("Error fetching category totals: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/clients/:id/invoices
// Returns that client's invoices split into unpaid and paid arrays,
// matched via the client's zoho_customer_id.
// Auth: admins for any client; a client for their own record only
// (requireClientAccess — same contract as handleGetGoalState). The portal
// "Faturas" tab is a client-facing read, so the client branch is required.
// ---------------------------------------------------------------------------

async function handleGetClientInvoices(clientId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, clientId)) { return jsonErr("Forbidden", 403); }

        var clientRow = await env.DB.prepare(
            "SELECT id, name, zoho_customer_id FROM clients WHERE id = ?"
        ).bind(clientId).first();
        if (!clientRow) { return jsonErr("Client not found", 404); }
        if (!clientRow.zoho_customer_id) {
            return jsonOk({ unpaid: [], paid: [], client_id: clientId, note: "No zoho_customer_id set for this client" });
        }

        var zohoAuth;
        try {
            zohoAuth = await getZohoAccessToken(env);
        } catch (e) {
            return jsonErr("Zoho auth error: " + e.message, 502);
        }

        // Fetch both unpaid and paid for this customer
        async function fetchForStatus(zohoStatus, accessToken, orgId) {
            var zohoUrl = "https://www.zohoapis.com/books/v3/invoices" +
                "?organization_id=" + orgId +
                "&customer_id=" + clientRow.zoho_customer_id +
                "&status=" + zohoStatus +
                "&per_page=100&sort_column=date&sort_order=D";

            var controller = new AbortController();
            var timer = setTimeout(function() { controller.abort(); }, 15000);

            var res;
            try {
                res = await fetch(zohoUrl, {
                    method: "GET",
                    headers: { "Authorization": "Zoho-oauthtoken " + accessToken },
                    signal: controller.signal
                });
            } finally {
                clearTimeout(timer);
            }

            if (!res.ok) {
                var errBody = await res.text();
                throw new Error("Zoho invoices lookup failed (status=" + zohoStatus + "): HTTP " + res.status + " " + errBody);
            }
            var data = await res.json();
            var list = data.invoices || [];
            var result = [];
            for (var i = 0; i < list.length; i++) {
                var inv = list[i];
                result.push({
                    invoice_id:     inv.invoice_id,
                    invoice_number: inv.invoice_number,
                    customer_name:  inv.customer_name,
                    total:          inv.total,
                    due_date:       inv.due_date,
                    status:         inv.status
                });
            }
            return result;
        }

        // Zoho only accepts one status per request; fetch each separately and merge.
        // Draft and void invoices are intentionally excluded from client.html — only
        // sent/overdue/partially_paid are visible to clients as "unpaid".
        var sentBatch         = await fetchForStatus("sent",          zohoAuth.access_token, zohoAuth.organization_id);
        var overdueBatch      = await fetchForStatus("overdue",       zohoAuth.access_token, zohoAuth.organization_id);
        var partialBatch      = await fetchForStatus("partially_paid", zohoAuth.access_token, zohoAuth.organization_id);
        var unpaid = sentBatch.concat(overdueBatch).concat(partialBatch);
        var paid   = await fetchForStatus("paid", zohoAuth.access_token, zohoAuth.organization_id);

        return jsonOk({ unpaid: unpaid, paid: paid, client_id: clientId, client_name: clientRow.name });
    } catch (e) {
        if (e.name === "AbortError") { return jsonErr("Zoho request timed out", 504); }
        return jsonErr("Error fetching client invoices: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/invoices/:zoho_invoice_id/render-data
// Fetches invoice from Zoho Books, looks up our internal client by zoho_customer_id,
// and returns a JSON payload shaped exactly like apex-invoice-data-DRAFT.json.
// Auth: alice / rafa / developer only.
// ---------------------------------------------------------------------------

var APEX_API_BASE = "https://apex-api.farfromtimnah.workers.dev";

// Formats a Zoho date string (YYYY-MM-DD) to DD/MM/YYYY for display.
function formatZohoDate(zohoDate) {
    if (!zohoDate) { return ""; }
    var parts = zohoDate.split("-");
    if (parts.length !== 3) { return zohoDate; }
    return parts[2] + "/" + parts[1] + "/" + parts[0];
}

// Formats a number as a USD currency string (e.g. "$ 1,500.00").
function formatCurrency(amount) {
    if (amount === undefined || amount === null) { return "---"; }
    var n = parseFloat(amount);
    if (isNaN(n)) { return "---"; }
    return "$ " + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

async function handleGetInvoiceRenderData(zohoInvoiceId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        // 1. Get a fresh Zoho access token and org ID.
        var zohoAuth;
        try {
            zohoAuth = await getZohoAccessToken(env);
        } catch (e) {
            return jsonErr("Zoho auth error: " + e.message, 502);
        }

        // 2. Fetch the invoice from Zoho Books.
        var zohoInvoiceUrl = "https://www.zohoapis.com/books/v3/invoices/" + zohoInvoiceId +
            "?organization_id=" + zohoAuth.organization_id;

        var invController = new AbortController();
        var invTimer = setTimeout(function() { invController.abort(); }, 15000);

        var zohoRes;
        try {
            zohoRes = await fetch(zohoInvoiceUrl, {
                method:  "GET",
                headers: { "Authorization": "Zoho-oauthtoken " + zohoAuth.access_token },
                signal:  invController.signal
            });
        } finally {
            clearTimeout(invTimer);
        }

        if (!zohoRes.ok) {
            var zohoErrText = await zohoRes.text();
            return jsonErr("Zoho invoice fetch failed (" + zohoRes.status + "): " + zohoErrText, 502);
        }

        var zohoData = await zohoRes.json();
        if (!zohoData.invoice) {
            return jsonErr("Zoho response did not include an invoice object", 502);
        }
        var inv = zohoData.invoice;

        // 3. Look up our internal client by zoho_customer_id.
        var zohoCustomerId = inv.customer_id;
        if (!zohoCustomerId) {
            return jsonErr("Invoice has no customer_id", 400);
        }

        var clientRow = await env.DB.prepare(
            "SELECT id, name, email, payment_method, package FROM clients WHERE zoho_customer_id = ?"
        ).bind(String(zohoCustomerId)).first();

        if (!clientRow) {
            return jsonErr("No local client found with zoho_customer_id " + zohoCustomerId, 404);
        }

        // Assunto defaults to the invoice's own subject when Zoho has one set.
        // Otherwise fall back to the client's package full name, since invoices
        // are always billing a defined package (Start/Sprint/Elite). If the
        // client has no package on record, leave it blank (existing fallback).
        var assunto = inv.subject || "";
        if (!assunto && clientRow.package) {
            var pkgRow = await env.DB.prepare(
                "SELECT full_name FROM packages WHERE short_name = ?"
            ).bind(clientRow.package).first();
            if (pkgRow && pkgRow.full_name) {
                assunto = pkgRow.full_name;
            }
        }

        // 4. Build the client logo URL using our internal UUID.
        var clientLogoUrl = APEX_API_BASE + "/api/clients/" + clientRow.id + "/logo-image";

        // 5. Map Zoho line items to the template's itens shape.
        var zohoLineItems = inv.line_items || [];
        var itens = [];
        for (var i = 0; i < zohoLineItems.length; i++) {
            var li = zohoLineItems[i];
            var discount = li.discount_amount && parseFloat(li.discount_amount) > 0
                ? formatCurrency(li.discount_amount)
                : "---";
            itens.push({
                descricao:      li.name || li.description || "",
                detalhes:       li.description && li.name ? li.description : "",
                quantidade:     li.quantity || 1,
                valor_unitario: li.rate !== undefined ? formatCurrency(li.rate) : "---",
                desconto:       discount,
                subtotal:       li.item_total !== undefined ? formatCurrency(li.item_total) : "---"
            });
        }

        // 6. Build the payment method field from our D1 record (Zoho has no equivalent).
        var paymentMethod = clientRow.payment_method ||
            "Transferencia bancaria (ACH/Wire). Dados bancarios enviados separadamente.";

        // 7. Build the response shaped exactly like apex-invoice-data-DRAFT.json.
        var renderData = {
            invoice: {
                numero:                     inv.invoice_number || "",
                data_fatura:                formatZohoDate(inv.date),
                data_vencimento:            formatZohoDate(inv.due_date),
                termos_condicoes_pagamento: inv.payment_terms_label || "",
                assunto:                    assunto,
                descricao:                  inv.notes || ""
            },
            empresa: {
                nome:      "Apex Business & Leadership",
                endereco:  "Tampa, FL",
                telefone:  "",
                website:   "apexbusiness.pro",
                logo_url:  "https://apexbusiness.pro/wp-content/uploads/2025/12/LogoApex.png"
            },
            cliente: {
                client_id:  clientRow.id,
                nome:       inv.customer_name || clientRow.name,
                endereco:   inv.billing_address
                    ? [
                        inv.billing_address.address,
                        inv.billing_address.city,
                        inv.billing_address.state,
                        inv.billing_address.zip
                      ].filter(Boolean).join(", ")
                    : "",
                email:      inv.email || clientRow.email || "",
                logo_url:   clientLogoUrl
            },
            itens: itens,
            totais: {
                subtotal:       inv.sub_total !== undefined ? formatCurrency(inv.sub_total) : "---",
                desconto_total: (inv.discount_total !== undefined && parseFloat(inv.discount_total) > 0)
                    ? formatCurrency(inv.discount_total)
                    : null,
                valor_total:    inv.total !== undefined      ? formatCurrency(inv.total)     : "---"
            },
            observacoes:      inv.notes || "",
            formas_pagamento: paymentMethod
        };

        return jsonOk(renderData);
    } catch (e) {
        if (e.name === "AbortError") { return jsonErr("Zoho request timed out", 504); }
        return jsonErr("Error building invoice render data: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/finance/bank-status
// Read-only indicator: is a real (non-cash) bank-type account set up in Zoho?
// Deliberately NOT a linking flow -- connecting a bank feed remains an
// in-person Zoho-hosted step done by Nicole. Auth: alice / rafa / developer.
// ---------------------------------------------------------------------------

async function handleGetFinanceBankStatus(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var zohoAuth;
        try {
            zohoAuth = await getZohoAccessToken(env);
        } catch (e) {
            return jsonErr("Zoho auth error: " + e.message, 502);
        }

        var acctRes = await zohoBankingFetch(zohoAuth, "GET", "bankaccounts");
        if (!acctRes.ok) {
            return jsonErr("Zoho bank accounts error: " + (acctRes.data.message || JSON.stringify(acctRes.data)), 502);
        }

        var accts = acctRes.data.bankaccounts || [];
        var bankAccounts = [];
        for (var i = 0; i < accts.length; i++) {
            var a = accts[i];
            if (a.is_active && (a.account_type === "bank" || a.account_type === "credit_card")) {
                bankAccounts.push({
                    account_name: a.account_name,
                    account_type: a.account_type,
                    uncategorized_transactions: a.uncategorized_transactions || 0
                });
            }
        }

        return jsonOk({ connected: bankAccounts.length > 0, bank_accounts: bankAccounts });
    } catch (e) {
        if (e.name === "AbortError") { return jsonErr("Zoho request timed out", 504); }
        return jsonErr("Error fetching bank status: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/finance/expense-form-data
// Returns the dropdown data for the expense form: Zoho expense-category
// accounts (chart of accounts, type=expense) and paid-through accounts
// (bank/cash accounts). Auth: alice / rafa / developer.
// ---------------------------------------------------------------------------

async function handleGetFinanceExpenseFormData(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var zohoAuth;
        try {
            zohoAuth = await getZohoAccessToken(env);
        } catch (e) {
            return jsonErr("Zoho auth error: " + e.message, 502);
        }

        var coaRes = await zohoBankingFetch(zohoAuth, "GET", "chartofaccounts?filter_by=AccountType.Expense&per_page=200");
        if (!coaRes.ok) {
            return jsonErr("Zoho chart of accounts error: " + (coaRes.data.message || JSON.stringify(coaRes.data)), 502);
        }
        var coa = coaRes.data.chartofaccounts || [];
        var categories = [];
        for (var i = 0; i < coa.length; i++) {
            if (coa[i].is_active && coa[i].account_type === "expense") {
                categories.push({ account_id: coa[i].account_id, account_name: coa[i].account_name });
            }
        }

        var acctRes = await zohoBankingFetch(zohoAuth, "GET", "bankaccounts");
        if (!acctRes.ok) {
            return jsonErr("Zoho bank accounts error: " + (acctRes.data.message || JSON.stringify(acctRes.data)), 502);
        }
        var accts = acctRes.data.bankaccounts || [];
        var paidThrough = [];
        for (var j = 0; j < accts.length; j++) {
            if (accts[j].is_active) {
                paidThrough.push({
                    account_id:   accts[j].account_id,
                    account_name: accts[j].account_name,
                    account_type: accts[j].account_type
                });
            }
        }

        return jsonOk({ categories: categories, paid_through: paidThrough });
    } catch (e) {
        if (e.name === "AbortError") { return jsonErr("Zoho request timed out", 504); }
        return jsonErr("Error fetching expense form data: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/finance/categories
// Returns Expense + Equity chart-of-accounts entries for the Reconcile
// category-folder UI. Self-extending list (see POST below) rather than a
// hardcoded set, so it always matches whatever accounts exist in Zoho.
// Auth: alice / rafa / developer only.
// ---------------------------------------------------------------------------

async function handleGetFinanceCategories(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var url = new URL(request.url);
        var includeHidden = url.searchParams.get("include_hidden") === "true";

        var zohoAuth;
        try {
            zohoAuth = await getZohoAccessToken(env);
        } catch (e) {
            return jsonErr("Zoho auth error: " + e.message, 502);
        }

        var categories = [];
        var filters = [
            { filter: "AccountType.Expense", type: "expense" },
            { filter: "AccountType.Equity",  type: "equity" },
            { filter: "AccountType.Income",  type: "income" }
        ];
        for (var f = 0; f < filters.length; f++) {
            var coaRes = await zohoBankingFetch(zohoAuth, "GET", "chartofaccounts?filter_by=" + filters[f].filter + "&per_page=200");
            if (!coaRes.ok) {
                return jsonErr("Zoho chart of accounts error: " + (coaRes.data.message || JSON.stringify(coaRes.data)), 502);
            }
            var coa = coaRes.data.chartofaccounts || [];
            for (var i = 0; i < coa.length; i++) {
                if (coa[i].is_active) {
                    categories.push({ account_id: coa[i].account_id, account_name: coa[i].account_name, account_type: filters[f].type });
                }
            }
        }

        categories.sort(function(x, y) { return x.account_name.localeCompare(y.account_name); });

        // Hidden-category filtering is scoped to the Reconciliation folder view
        // only (this endpoint, default mode). include_hidden=true is used by
        // the Manage Categories checklist, which needs the full list plus each
        // category's hidden state. Every other chart-of-accounts reader in this
        // app (expense-form-data, tax-summary) calls Zoho directly and never
        // touches this table.
        var hiddenRows = await env.DB.prepare("SELECT category_account_id FROM hidden_finance_categories").all();
        var hiddenSet = {};
        for (var h = 0; h < hiddenRows.results.length; h++) { hiddenSet[hiddenRows.results[h].category_account_id] = true; }

        // Custom labels (AKA) are a pure display substitution on top of the
        // real Zoho account_name -- never used for categorization, which
        // always keys off account_id. Same scope as hidden_finance_categories:
        // only this Reconciliation-facing endpoint reads this table.
        var labelRows = await env.DB.prepare("SELECT category_account_id, custom_label FROM finance_category_labels").all();
        var labelSet = {};
        for (var l = 0; l < labelRows.results.length; l++) { labelSet[labelRows.results[l].category_account_id] = labelRows.results[l].custom_label; }
        for (var m = 0; m < categories.length; m++) {
            categories[m].custom_label = labelSet[categories[m].account_id] || null;
            categories[m].display_name = labelSet[categories[m].account_id] || categories[m].account_name;
        }

        if (includeHidden) {
            for (var k = 0; k < categories.length; k++) { categories[k].hidden = !!hiddenSet[categories[k].account_id]; }
            // "Client Income" (CLIENT_INCOME_KEY in finance.html) isn't a real
            // Zoho account -- it's a special folder that opens the
            // invoice-match flow instead of a normal categorize action, so it
            // is deliberately NOT added to the plain (non-hidden) list above,
            // which feeds the actual draggable Reconciliation folder rail.
            // It's included here (Manage Categories only) purely so its label
            // is editable in D1 like every real category, per Nicole's
            // explicit correction 2026-07-23 -- this label must never be a
            // hardcoded string in the frontend again. Never hideable: unlike
            // a real expense/equity category, incoming client money always
            // needs somewhere to go, so no checkbox is rendered for it (see
            // renderReconManageCategoriesList in finance.html).
            categories.unshift({
                account_id:   "client_income",
                account_name: "Client Income",
                account_type: "client_income",
                custom_label: labelSet["client_income"] || null,
                display_name: labelSet["client_income"] || "Client Income",
                hidden:       false
            });
        } else {
            categories = categories.filter(function(c) { return !hiddenSet[c.account_id]; });
        }

        // Returned regardless of include_hidden so both the Reconciliation
        // folder rail (default mode, which never gets the synthetic
        // client_income row added to `categories`) and Manage Categories can
        // read the same D1-backed label from one request.
        return jsonOk({ categories: categories, client_income_label: labelSet["client_income"] || null });
    } catch (e) {
        if (e.name === "AbortError") { return jsonErr("Zoho request timed out", 504); }
        return jsonErr("Error fetching categories: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/finance/categories/:account_id/hide
// Route: POST /api/finance/categories/:account_id/unhide
// Hides/unhides a category from the Reconcile folder view only -- purely a
// display preference stored in D1, never touches the real Zoho account.
// Auth: alice / rafa / developer only.
// ---------------------------------------------------------------------------

async function handlePostFinanceCategoryHide(request, env, accountId) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }
        if (!accountId) { return jsonErr("account_id is required", 400); }

        await env.DB.prepare(
            "INSERT INTO hidden_finance_categories (category_account_id) VALUES (?) ON CONFLICT(category_account_id) DO NOTHING"
        ).bind(accountId).run();

        return jsonOk({ ok: true });
    } catch (e) {
        return jsonErr("Error hiding category: " + e.message, 500);
    }
}

async function handlePostFinanceCategoryUnhide(request, env, accountId) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }
        if (!accountId) { return jsonErr("account_id is required", 400); }

        await env.DB.prepare("DELETE FROM hidden_finance_categories WHERE category_account_id = ?").bind(accountId).run();

        return jsonOk({ ok: true });
    } catch (e) {
        return jsonErr("Error unhiding category: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: PUT /api/finance/categories/:account_id/label
// Body: { custom_label: string }
// Sets a plain-English display label for a category, shown in place of the
// real Zoho account name everywhere a Reconciliation folder name is shown.
// Purely a display substitution -- category_account_id (what a transaction
// actually posts to in Zoho) is completely unaffected.
// Route: DELETE /api/finance/categories/:account_id/label
// Clears the custom label, reverting the folder to the real Zoho account name.
// Auth: alice / rafa / developer only.
// ---------------------------------------------------------------------------

async function handlePutFinanceCategoryLabel(request, env, accountId) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }
        if (!accountId) { return jsonErr("account_id is required", 400); }

        var body = await request.json();
        var label = (body.custom_label || "").trim();
        if (!label) { return jsonErr("custom_label is required", 400); }
        if (label.length > 80) { return jsonErr("custom_label is too long", 400); }

        await env.DB.prepare(
            "INSERT INTO finance_category_labels (category_account_id, custom_label, updated_at) VALUES (?, ?, datetime('now')) " +
            "ON CONFLICT(category_account_id) DO UPDATE SET custom_label = excluded.custom_label, updated_at = excluded.updated_at"
        ).bind(accountId, label).run();

        return jsonOk({ ok: true, custom_label: label });
    } catch (e) {
        return jsonErr("Error setting category label: " + e.message, 500);
    }
}

async function handleDeleteFinanceCategoryLabel(request, env, accountId) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }
        if (!accountId) { return jsonErr("account_id is required", 400); }

        await env.DB.prepare("DELETE FROM finance_category_labels WHERE category_account_id = ?").bind(accountId).run();

        return jsonOk({ ok: true });
    } catch (e) {
        return jsonErr("Error clearing category label: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/finance/categories
// Body: { account_name, account_type ("expense"|"equity") }
// Creates a new chart-of-accounts entry in Zoho so the Reconcile folder list
// can self-extend (same convention as this app's other type-to-create
// fields) without ever sending Alice/Rafa to Zoho's own UI.
// Auth: alice / rafa / developer only.
// ---------------------------------------------------------------------------

async function handlePostFinanceCategory(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var body = await request.json();
        if (!body.account_name || !body.account_name.trim()) { return jsonErr("account_name is required", 400); }
        var accountType = (body.account_type === "equity") ? "equity" : (body.account_type === "income") ? "income" : "expense";

        var zohoAuth;
        try {
            zohoAuth = await getZohoAccessToken(env);
        } catch (e) {
            return jsonErr("Zoho auth error: " + e.message, 502);
        }

        var createBody = {
            account_name: body.account_name.trim(),
            account_type: accountType
        };
        var createRes = await zohoBankingFetch(zohoAuth, "POST", "chartofaccounts", createBody);
        if (!createRes.ok) {
            return jsonErr("Zoho create-account failed: " + (createRes.data.message || JSON.stringify(createRes.data)), 502);
        }

        var acct = createRes.data.chart_of_account || {};
        return jsonOk({ ok: true, account_id: acct.account_id, account_name: acct.account_name || createBody.account_name, account_type: accountType });
    } catch (e) {
        if (e.name === "AbortError") { return jsonErr("Zoho request timed out", 504); }
        return jsonErr("Error creating category: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/finance/expenses
// Lists recent expenses from Zoho Books. Auth: alice / rafa / developer.
// ---------------------------------------------------------------------------

async function handleGetFinanceExpenses(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var zohoAuth;
        try {
            zohoAuth = await getZohoAccessToken(env);
        } catch (e) {
            return jsonErr("Zoho auth error: " + e.message, 502);
        }

        var res = await zohoBankingFetch(zohoAuth, "GET", "expenses?per_page=25&sort_column=created_time&sort_order=D");
        if (!res.ok) {
            return jsonErr("Zoho expenses error: " + (res.data.message || JSON.stringify(res.data)), 502);
        }

        var raw = res.data.expenses || [];
        var expenses = [];
        for (var i = 0; i < raw.length; i++) {
            expenses.push({
                expense_id:                raw[i].expense_id,
                date:                      raw[i].date,
                description:               raw[i].description || "",
                account_name:              raw[i].account_name || "",
                paid_through_account_name: raw[i].paid_through_account_name || "",
                total:                     raw[i].total
            });
        }

        return jsonOk({ expenses: expenses });
    } catch (e) {
        if (e.name === "AbortError") { return jsonErr("Zoho request timed out", 504); }
        return jsonErr("Error fetching expenses: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/finance/expenses
// Body: { description, amount, date, account_id, paid_through_account_id }
// Creates a real expense in Zoho Books. account_id is the expense-category
// account; paid_through_account_id is REQUIRED by Zoho (confirmed live
// 2026-07-06: create succeeds only with all of date/amount/account_id/
// paid_through_account_id). Auth: alice / rafa / developer.
// ---------------------------------------------------------------------------

async function handlePostFinanceExpense(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var body = await request.json();
        var amount = parseFloat(body.amount);
        if (!amount || amount <= 0) { return jsonErr("amount must be a positive number", 400); }
        if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) { return jsonErr("date is required (YYYY-MM-DD)", 400); }
        if (!body.account_id) { return jsonErr("account_id (expense category) is required", 400); }
        if (!body.paid_through_account_id) { return jsonErr("paid_through_account_id is required", 400); }

        var zohoAuth;
        try {
            zohoAuth = await getZohoAccessToken(env);
        } catch (e) {
            return jsonErr("Zoho auth error: " + e.message, 502);
        }

        var res = await zohoBankingFetch(zohoAuth, "POST", "expenses", {
            date:                    body.date,
            amount:                  amount,
            account_id:              String(body.account_id),
            paid_through_account_id: String(body.paid_through_account_id),
            description:             (body.description || "").slice(0, 100)
        });
        if (!res.ok) {
            return jsonErr("Zoho expense creation failed: " + (res.data.message || JSON.stringify(res.data)), 502);
        }

        var exp = res.data.expense || {};
        return jsonOk({
            expense_id:   exp.expense_id,
            date:         exp.date,
            total:        exp.total,
            account_name: exp.account_name,
            description:  exp.description
        });
    } catch (e) {
        if (e.name === "AbortError") { return jsonErr("Zoho request timed out", 504); }
        return jsonErr("Error creating expense: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/invoices
// Body: { client_id, line_items: [{ name, description?, quantity?, rate? }],
//         recurring?: { recurrence_frequency: "days"|"weeks"|"months"|"years",
//                        repeat_every: number, start_date,
//                        never_ends: boolean, occurrences?: number } }
// Creates a real DRAFT invoice in Zoho Books for the client's linked Zoho
// contact, OR (if body.recurring is present) a recurring invoice profile via
// Zoho's separate recurringinvoices endpoint using the same customer/line
// items. No tax fields anywhere -- confirmed standing decision, invoices
// never carry sales tax; applies to recurring invoices too.
//
// Zoho's recurringinvoices create payload confirmed against live API docs
// (zoho.com/books/api/v3/recurring-invoices/): recurrence_frequency accepts
// days/weeks/months/years, paired with repeat_every (integer interval) --
// e.g. repeat_every:3 + recurrence_frequency:"months" for Apex's quarterly
// default. Zoho has NO occurrence-count field -- only start_date/end_date --
// so when the user picks "after N invoices" instead of "never expires", Apex
// computes end_date itself (start_date + interval * occurrences) and sends
// that computed date to Zoho; see computeRecurringEndDate below.
//
// This also requires "Recurring Invoice" to be manually enabled in Zoho
// Books under Settings -> Preferences -> General by a human with Zoho admin
// access (documented precondition, cannot be done via API). If Zoho rejects
// the call because that setting isn't enabled, the error is surfaced
// verbatim to the frontend rather than swallowed -- see progress.md.
// Auth: alice / rafa / developer.
// ---------------------------------------------------------------------------

// Computes the recurring invoice's end_date so that exactly `occurrences`
// invoices are generated: the last one fires on start_date + (occurrences-1)
// intervals, and Zoho's end_date is exclusive of further firings beyond it,
// so we push a few days past that last firing to guarantee it still fires
// while never allowing an extra occurrence.
function computeRecurringEndDate(startDateStr, unit, repeatEvery, occurrences) {
    var start = new Date(startDateStr + "T00:00:00Z");
    var totalSteps = repeatEvery * (occurrences - 1);
    var end = new Date(start.getTime());
    if (unit === "days") {
        end.setUTCDate(end.getUTCDate() + totalSteps);
    } else if (unit === "weeks") {
        end.setUTCDate(end.getUTCDate() + totalSteps * 7);
    } else if (unit === "months") {
        end.setUTCMonth(end.getUTCMonth() + totalSteps);
    } else if (unit === "years") {
        end.setUTCFullYear(end.getUTCFullYear() + totalSteps);
    }
    // Nudge a few days past the final firing date so Zoho's end_date
    // (the day recurrence stops) doesn't fall exactly on -- and cut off --
    // the last intended invoice.
    end.setUTCDate(end.getUTCDate() + 3);
    return end.toISOString().slice(0, 10);
}

async function handlePostInvoice(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var body = await request.json();
        if (!body.client_id) { return jsonErr("client_id is required", 400); }
        var lineItems = body.line_items;
        if (!Array.isArray(lineItems) || lineItems.length === 0) {
            return jsonErr("line_items array is required", 400);
        }
        for (var i = 0; i < lineItems.length; i++) {
            if (!lineItems[i].name) { return jsonErr("Each line item requires a name", 400); }
        }

        var isRecurring = body.recurring && typeof body.recurring === "object";
        if (isRecurring) {
            var validFreqs = ["days", "weeks", "months", "years"];
            if (validFreqs.indexOf(body.recurring.recurrence_frequency) === -1) {
                return jsonErr("recurring.recurrence_frequency must be one of: " + validFreqs.join(", "), 400);
            }
            if (!body.recurring.start_date) { return jsonErr("recurring.start_date is required", 400); }
            var repeatEvery = parseInt(body.recurring.repeat_every, 10);
            if (!repeatEvery || repeatEvery < 1) {
                return jsonErr("recurring.repeat_every must be a positive integer", 400);
            }
            if (!body.recurring.never_ends) {
                var occurrences = parseInt(body.recurring.occurrences, 10);
                if (!occurrences || occurrences < 1) {
                    return jsonErr("recurring.occurrences must be a positive integer when never_ends is false", 400);
                }
            }
        }

        var clientRow = await env.DB.prepare(
            "SELECT id, name, zoho_customer_id FROM clients WHERE id = ?"
        ).bind(String(body.client_id)).first();
        if (!clientRow) { return jsonErr("Client not found", 404); }
        if (!clientRow.zoho_customer_id) {
            return jsonErr("Client has no linked Zoho contact yet. Run the contact re-sync in Financial Tools first.", 400);
        }

        var zohoAuth;
        try {
            zohoAuth = await getZohoAccessToken(env);
        } catch (e) {
            return jsonErr("Zoho auth error: " + e.message, 502);
        }

        var lineItemsPayload = lineItems.map(function(li) {
            return {
                name:        String(li.name).slice(0, 100),
                description: (li.description || "").slice(0, 2000),
                quantity:    (li.quantity !== undefined && li.quantity !== null && li.quantity !== "") ? parseFloat(li.quantity) || 0 : 1,
                rate:        (li.rate !== undefined && li.rate !== null && li.rate !== "") ? parseFloat(li.rate) || 0 : 0
            };
        });

        if (isRecurring) {
            var recurPayload = {
                recurrence_name:       "Recurring - " + (clientRow.name || clientRow.id) + " - " + body.recurring.start_date,
                customer_id:           String(clientRow.zoho_customer_id),
                recurrence_frequency:  body.recurring.recurrence_frequency,
                repeat_every:          parseInt(body.recurring.repeat_every, 10),
                start_date:            body.recurring.start_date,
                line_items:            lineItemsPayload
            };
            if (!body.recurring.never_ends) {
                recurPayload.end_date = computeRecurringEndDate(
                    body.recurring.start_date,
                    body.recurring.recurrence_frequency,
                    recurPayload.repeat_every,
                    parseInt(body.recurring.occurrences, 10)
                );
            }
            var recurRes = await zohoBankingFetch(zohoAuth, "POST", "recurringinvoices", recurPayload);
            if (!recurRes.ok) {
                return jsonErr("Zoho recurring invoice creation failed: " + (recurRes.data.message || JSON.stringify(recurRes.data)), 502);
            }
            var recur = recurRes.data.recurring_invoice || {};
            return jsonOk({
                ok:                    true,
                recurring:             true,
                recurring_invoice_id:  recur.recurring_invoice_id,
                recurrence_name:       recur.recurrence_name,
                customer_name:         recur.customer_name,
                status:                recur.status,
                recurrence_frequency:  recur.recurrence_frequency || recurPayload.recurrence_frequency,
                repeat_every:          recur.repeat_every || recurPayload.repeat_every,
                start_date:            recur.start_date || recurPayload.start_date,
                end_date:              recur.end_date || recurPayload.end_date || null
            });
        }

        var payload = {
            customer_id: String(clientRow.zoho_customer_id),
            line_items:  lineItemsPayload
        };

        var res = await zohoBankingFetch(zohoAuth, "POST", "invoices", payload);
        if (!res.ok) {
            return jsonErr("Zoho invoice creation failed: " + (res.data.message || JSON.stringify(res.data)), 502);
        }

        var inv = res.data.invoice || {};
        return jsonOk({
            ok:             true,
            invoice_id:     inv.invoice_id,
            invoice_number: inv.invoice_number,
            customer_name:  inv.customer_name,
            total:          inv.total,
            status:         inv.status
        });
    } catch (e) {
        if (e.name === "AbortError") { return jsonErr("Zoho request timed out", 504); }
        return jsonErr("Error creating invoice: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/finance/ar-aging
// Accounts Receivable aging: every invoice with an outstanding balance > 0,
// bucketed by days past due (current / 1-30 / 31-60 / 61-90 / 90+), sorted
// most overdue first. Auth: alice / rafa / developer.
// ---------------------------------------------------------------------------

function arAgingBucket(daysOverdue) {
    if (daysOverdue <= 0)  { return "current"; }
    if (daysOverdue <= 30) { return "1-30"; }
    if (daysOverdue <= 60) { return "31-60"; }
    if (daysOverdue <= 90) { return "61-90"; }
    return "90+";
}

async function handleGetFinanceArAging(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var zohoAuth;
        try {
            zohoAuth = await getZohoAccessToken(env);
        } catch (e) {
            return jsonErr("Zoho auth error: " + e.message, 502);
        }

        // Status.Unpaid covers sent, overdue, viewed and partially-paid invoices.
        var rows = [];
        var page = 1;
        while (page <= 10) {
            var res = await zohoBankingFetch(zohoAuth, "GET",
                "invoices?filter_by=Status.Unpaid&per_page=200&page=" + page +
                "&sort_column=due_date&sort_order=A");
            if (!res.ok) {
                return jsonErr("Zoho invoices error: " + (res.data.message || JSON.stringify(res.data)), 502);
            }
            var batch = res.data.invoices || [];
            for (var i = 0; i < batch.length; i++) { rows.push(batch[i]); }
            if (!res.data.page_context || !res.data.page_context.has_more_page) { break; }
            page++;
        }

        var todayStr = new Date().toISOString().slice(0, 10);
        var today = new Date(todayStr + "T00:00:00Z").getTime();
        var out = [];
        for (var j = 0; j < rows.length; j++) {
            var inv = rows[j];
            var balance = parseFloat(inv.balance) || 0;
            if (balance <= 0) { continue; }
            var daysOverdue = 0;
            if (inv.due_date) {
                daysOverdue = Math.round((today - new Date(inv.due_date + "T00:00:00Z").getTime()) / 86400000);
            }
            out.push({
                invoice_id:     inv.invoice_id,
                invoice_number: inv.invoice_number,
                customer_name:  inv.customer_name,
                balance:        balance,
                due_date:       inv.due_date,
                days_overdue:   daysOverdue > 0 ? daysOverdue : 0,
                bucket:         arAgingBucket(daysOverdue)
            });
        }
        out.sort(function(a, b) { return b.days_overdue - a.days_overdue; });

        var totals = { "current": 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
        var grandTotal = 0;
        for (var k = 0; k < out.length; k++) {
            totals[out[k].bucket] += out[k].balance;
            grandTotal += out[k].balance;
        }

        return jsonOk({ invoices: out, bucket_totals: totals, total_outstanding: grandTotal, as_of: todayStr });
    } catch (e) {
        if (e.name === "AbortError") { return jsonErr("Zoho request timed out", 504); }
        return jsonErr("Error building AR aging report: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/finance/tax-summary?year=YYYY
// Annual income vs. expense summary for Rafa/Alice's own tax filing. This is
// explicitly NOT a sales-tax calculation (no invoice carries sales tax) --
// just totals: paid-invoice income for the year plus Zoho expenses broken
// down by category. Auth: alice / rafa / developer.
// ---------------------------------------------------------------------------

async function handleGetFinanceTaxSummary(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var url = new URL(request.url);
        var year = parseInt(url.searchParams.get("year"), 10);
        if (!year || year < 2000 || year > 2100) {
            year = new Date().getFullYear();
        }
        var dateStart = year + "-01-01";
        var dateEnd   = year + "-12-31";

        var zohoAuth;
        try {
            zohoAuth = await getZohoAccessToken(env);
        } catch (e) {
            return jsonErr("Zoho auth error: " + e.message, 502);
        }

        // Income: paid invoices dated within the year.
        var totalIncome = 0;
        var paidCount = 0;
        var page = 1;
        while (page <= 10) {
            var invRes = await zohoBankingFetch(zohoAuth, "GET",
                "invoices?filter_by=Status.Paid&date_start=" + dateStart + "&date_end=" + dateEnd +
                "&per_page=200&page=" + page);
            if (!invRes.ok) {
                return jsonErr("Zoho invoices error: " + (invRes.data.message || JSON.stringify(invRes.data)), 502);
            }
            var invBatch = invRes.data.invoices || [];
            for (var i = 0; i < invBatch.length; i++) {
                totalIncome += parseFloat(invBatch[i].total) || 0;
                paidCount++;
            }
            if (!invRes.data.page_context || !invRes.data.page_context.has_more_page) { break; }
            page++;
        }

        // Expenses: everything dated within the year, grouped by category account.
        var byCategory = {};
        var totalExpenses = 0;
        page = 1;
        while (page <= 10) {
            var expRes = await zohoBankingFetch(zohoAuth, "GET",
                "expenses?date_start=" + dateStart + "&date_end=" + dateEnd +
                "&per_page=200&page=" + page);
            if (!expRes.ok) {
                return jsonErr("Zoho expenses error: " + (expRes.data.message || JSON.stringify(expRes.data)), 502);
            }
            var expBatch = expRes.data.expenses || [];
            for (var j = 0; j < expBatch.length; j++) {
                var amt = parseFloat(expBatch[j].total) || 0;
                var cat = expBatch[j].account_name || "Sem categoria";
                byCategory[cat] = (byCategory[cat] || 0) + amt;
                totalExpenses += amt;
            }
            if (!expRes.data.page_context || !expRes.data.page_context.has_more_page) { break; }
            page++;
        }

        var categories = Object.keys(byCategory).map(function(name) {
            return { category: name, total: byCategory[name] };
        });
        categories.sort(function(a, b) { return b.total - a.total; });

        return jsonOk({
            year:                  year,
            total_income:          totalIncome,
            paid_invoice_count:    paidCount,
            expenses_by_category:  categories,
            total_expenses:        totalExpenses,
            net_total:             totalIncome - totalExpenses
        });
    } catch (e) {
        if (e.name === "AbortError") { return jsonErr("Zoho request timed out", 504); }
        return jsonErr("Error building tax summary: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Routes: GET/PUT /api/clients/:id/zoho-contact
// GET returns the client's Zoho contact details (email/phone live on the
// primary contact person; billing address on the contact itself).
// PUT updates them. Zoho's update replaces the contact_persons list, so the
// handler re-sends every existing person and only edits the primary one
// (confirmed live 2026-07-06: top-level email in the PUT body is silently
// ignored; only contact_persons carries email/phone).
// Auth: alice / rafa / developer.
// ---------------------------------------------------------------------------

async function handleGetClientZohoContact(clientId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var clientRow = await env.DB.prepare(
            "SELECT id, name, zoho_customer_id FROM clients WHERE id = ?"
        ).bind(clientId).first();
        if (!clientRow) { return jsonErr("Client not found", 404); }
        if (!clientRow.zoho_customer_id) {
            return jsonErr("This client has no Zoho contact yet. Use the re-sync tool first.", 400);
        }

        var zohoAuth;
        try {
            zohoAuth = await getZohoAccessToken(env);
        } catch (e) {
            return jsonErr("Zoho auth error: " + e.message, 502);
        }

        var res = await zohoBankingFetch(zohoAuth, "GET", "contacts/" + encodeURIComponent(clientRow.zoho_customer_id));
        if (!res.ok) {
            return jsonErr("Zoho contact fetch failed: " + (res.data.message || JSON.stringify(res.data)), 502);
        }

        var c = res.data.contact || {};
        var ba = c.billing_address || {};
        return jsonOk({
            client_id:    clientId,
            contact_id:   c.contact_id,
            contact_name: c.contact_name,
            email:        c.email || "",
            phone:        c.phone || "",
            billing_address: {
                address: ba.address || "",
                street2: ba.street2 || "",
                city:    ba.city    || "",
                state:   ba.state   || "",
                zip:     ba.zip     || "",
                country: ba.country || ""
            }
        });
    } catch (e) {
        if (e.name === "AbortError") { return jsonErr("Zoho request timed out", 504); }
        return jsonErr("Error fetching Zoho contact: " + e.message, 500);
    }
}

async function handlePutClientZohoContact(clientId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var body = await request.json();

        var clientRow = await env.DB.prepare(
            "SELECT id, name, zoho_customer_id FROM clients WHERE id = ?"
        ).bind(clientId).first();
        if (!clientRow) { return jsonErr("Client not found", 404); }
        if (!clientRow.zoho_customer_id) {
            return jsonErr("This client has no Zoho contact yet. Use the re-sync tool first.", 400);
        }

        var zohoAuth;
        try {
            zohoAuth = await getZohoAccessToken(env);
        } catch (e) {
            return jsonErr("Zoho auth error: " + e.message, 502);
        }

        var zohoId = encodeURIComponent(clientRow.zoho_customer_id);

        // Fetch current contact first: the PUT replaces contact_persons wholesale,
        // so every existing person must be re-sent to avoid deleting them.
        var curRes = await zohoBankingFetch(zohoAuth, "GET", "contacts/" + zohoId);
        if (!curRes.ok) {
            return jsonErr("Zoho contact fetch failed: " + (curRes.data.message || JSON.stringify(curRes.data)), 502);
        }
        var cur = curRes.data.contact || {};

        var persons = [];
        var existing = cur.contact_persons || [];
        var primaryFound = false;
        for (var i = 0; i < existing.length; i++) {
            var p = existing[i];
            var entry = {
                contact_person_id:  p.contact_person_id,
                first_name:         p.first_name || "",
                last_name:          p.last_name  || "",
                email:              p.email      || "",
                phone:              p.phone      || "",
                mobile:             p.mobile     || "",
                is_primary_contact: !!p.is_primary_contact
            };
            if (p.is_primary_contact) {
                primaryFound = true;
                if (body.hasOwnProperty("email")) { entry.email = body.email || ""; }
                if (body.hasOwnProperty("phone")) { entry.phone = body.phone || ""; }
            }
            persons.push(entry);
        }
        if (!primaryFound && (body.email || body.phone)) {
            persons.push({
                first_name:         cur.contact_name || clientRow.name,
                email:              body.email || "",
                phone:              body.phone || "",
                is_primary_contact: true
            });
        }

        var updateBody = {
            contact_name:    cur.contact_name,
            contact_persons: persons
        };
        if (body.billing_address) {
            var ba = body.billing_address;
            updateBody.billing_address = {
                address: ba.address || "",
                street2: ba.street2 || "",
                city:    ba.city    || "",
                state:   ba.state   || "",
                zip:     ba.zip     || "",
                country: ba.country || ""
            };
        }

        var res = await zohoBankingFetch(zohoAuth, "PUT", "contacts/" + zohoId, updateBody);
        if (!res.ok) {
            return jsonErr("Zoho contact update failed: " + (res.data.message || JSON.stringify(res.data)), 502);
        }

        var c = res.data.contact || {};
        var nba = c.billing_address || {};
        return jsonOk({
            client_id:    clientId,
            contact_id:   c.contact_id,
            contact_name: c.contact_name,
            email:        c.email || "",
            phone:        c.phone || "",
            billing_address: {
                address: nba.address || "",
                street2: nba.street2 || "",
                city:    nba.city    || "",
                state:   nba.state   || "",
                zip:     nba.zip     || "",
                country: nba.country || ""
            }
        });
    } catch (e) {
        if (e.name === "AbortError") { return jsonErr("Zoho request timed out", 504); }
        return jsonErr("Error updating Zoho contact: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Routes: GET /api/zoho/contacts/resync-status, POST /api/zoho/contacts/resync
// Status: counts clients with no zoho_customer_id. Resync: attempts to create
// a Zoho contact for each such client (same call as handlePostClients'
// auto-create) and writes the new id back to D1. Auth: alice / rafa / developer.
// ---------------------------------------------------------------------------

async function handleGetZohoContactsResyncStatus(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var res = await env.DB.prepare(
            "SELECT id, name FROM clients WHERE zoho_customer_id IS NULL OR zoho_customer_id = '' ORDER BY name ASC"
        ).all();
        var rows = res.results || [];
        return jsonOk({ missing: rows.length, clients: rows });
    } catch (e) {
        return jsonErr("Error checking resync status: " + e.message, 500);
    }
}

async function handlePostZohoContactsResync(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var res = await env.DB.prepare(
            "SELECT id, name FROM clients WHERE zoho_customer_id IS NULL OR zoho_customer_id = '' ORDER BY name ASC"
        ).all();
        var rows = res.results || [];
        if (rows.length === 0) {
            return jsonOk({ attempted: 0, succeeded: 0, failed: 0, results: [] });
        }

        var zohoAuth;
        try {
            zohoAuth = await getZohoAccessToken(env);
        } catch (e) {
            return jsonErr("Zoho auth error: " + e.message, 502);
        }

        var results = [];
        var succeeded = 0;
        var failed = 0;
        for (var i = 0; i < rows.length; i++) {
            try {
                var contactRes = await zohoBankingFetch(zohoAuth, "POST", "contacts", {
                    contact_name: rows[i].name
                });
                if (contactRes.ok && contactRes.data.contact && contactRes.data.contact.contact_id) {
                    var zohoCustomerId = String(contactRes.data.contact.contact_id);
                    await env.DB.prepare("UPDATE clients SET zoho_customer_id = ? WHERE id = ?")
                        .bind(zohoCustomerId, rows[i].id).run();
                    succeeded++;
                    results.push({ client_id: rows[i].id, name: rows[i].name, ok: true, zoho_customer_id: zohoCustomerId });
                } else {
                    failed++;
                    results.push({
                        client_id: rows[i].id, name: rows[i].name, ok: false,
                        error: (contactRes.data && (contactRes.data.message || JSON.stringify(contactRes.data))) || "Unknown Zoho error"
                    });
                }
            } catch (zohoErr) {
                failed++;
                results.push({ client_id: rows[i].id, name: rows[i].name, ok: false, error: zohoErr.message });
            }
        }

        return jsonOk({ attempted: rows.length, succeeded: succeeded, failed: failed, results: results });
    } catch (e) {
        return jsonErr("Error re-syncing Zoho contacts: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Main fetch handler
// ---------------------------------------------------------------------------

// ===========================================================================
// CLIENT PORTAL — daily-entry log, client logins, portal endpoints
// Everything below is additive: the 'client' role is a genuinely new role.
// alice / rafa / developer checks elsewhere in this file are untouched.
// ===========================================================================

// ---------------------------------------------------------------------------
// Indicator catalog. type drives input rendering and monthly aggregation:
//   currency/count  → monthly Realizado = SUM over completed days
//   percent/hours   → monthly Realizado = AVG over completed days
//   toggle          → yes/no (rotina)
//   computed        → derived server-side, never an input (lucro, margem)
//   computed_month  → dias_rotina_completos: REAL count of completed days
//                     with rotina_completa = yes this month (bug fix #3 —
//                     never a mirror of today's toggle)
// inverse: lower is better (velocidade_resposta, erros_retrabalho) — scoring inverts it.
// ---------------------------------------------------------------------------

var ENTRY_SECTIONS = ["financeiro", "clientes_mercado", "processos", "crescimento", "rotina"];

var INDICATORS = [
    { key: "receita",                section: "financeiro",       type: "currency", labelPt: "Receita do Dia",             labelEn: "Revenue Today" },
    { key: "saida",                  section: "financeiro",       type: "currency", labelPt: "Saída do Dia",          labelEn: "Expenses Today", inverse: true },
    { key: "lucro_liquido",          section: "financeiro",       type: "computed", labelPt: "Lucro Líquido",         labelEn: "Net Profit" },
    { key: "margem_lucro",           section: "financeiro",       type: "computed", labelPt: "Margem de Lucro %",          labelEn: "Profit Margin %" },
    { key: "vendas_fechadas",        section: "financeiro",       type: "count",    labelPt: "Vendas Fechadas",            labelEn: "Closed Sales" },
    { key: "taxa_conversao",         section: "financeiro",       type: "computed", labelPt: "Taxa de Conversão %",   labelEn: "Conversion Rate %" },
    { key: "pipeline_ativo",         section: "financeiro",       type: "currency", labelPt: "Pipeline Ativo",             labelEn: "Active Pipeline" },
    { key: "leads_gerados",          section: "clientes_mercado", type: "count",    labelPt: "Leads Gerados",              labelEn: "Leads Generated" },
    { key: "visitas_estrategicas",   section: "clientes_mercado", type: "count",    labelPt: "Visitas Estratégicas",  labelEn: "Strategic Visits" },
    { key: "contatos_estrategicos",  section: "clientes_mercado", type: "count",    labelPt: "Contatos Estratégicos", labelEn: "Strategic Contacts" },
    { key: "retomadas_cliente",      section: "clientes_mercado", type: "count",    labelPt: "Retomadas com Cliente",      labelEn: "Client Follow-ups" },
    { key: "interacoes_estrategicas",section: "clientes_mercado", type: "count",    labelPt: "Interações Estratégicas", labelEn: "Strategic Interactions" },
    { key: "google_review",          section: "clientes_mercado", type: "count",    labelPt: "Google Review",              labelEn: "Google Reviews" },
    { key: "post_publicado",         section: "clientes_mercado", type: "count",    labelPt: "Post Publicado",             labelEn: "Posts Published" },
    { key: "story",                  section: "clientes_mercado", type: "count",    labelPt: "Story",                      labelEn: "Stories" },
    { key: "video_curto",            section: "clientes_mercado", type: "count",    labelPt: "Vídeo Curto (Reels)",   labelEn: "Short Video (Reels)" },
    { key: "novos_clientes",         section: "clientes_mercado", type: "count",    labelPt: "Novos Clientes",             labelEn: "New Clients" },
    { key: "entregas_realizadas",    section: "processos",        type: "count",    labelPt: "Entregas Realizadas",        labelEn: "Deliveries Completed" },
    { key: "envio_propostas",        section: "processos",        type: "count",    labelPt: "Envio de Propostas",         labelEn: "Proposals Sent" },
    { key: "velocidade_resposta",    section: "processos",        type: "hours",    labelPt: "Velocidade de Resposta (h)", labelEn: "Response Speed (h)", inverse: true },
    { key: "erros_retrabalho",       section: "processos",        type: "count",    labelPt: "Erros/Retrabalho",           labelEn: "Errors/Rework", inverse: true },
    { key: "processos_documentados", section: "processos",        type: "count",    labelPt: "Processos Documentados",     labelEn: "Processes Documented" },
    { key: "melhorias_internas",     section: "crescimento",      type: "count",    labelPt: "Melhorias Internas",         labelEn: "Internal Improvements" },
    { key: "treinamentos_realizados",section: "crescimento",      type: "count",    labelPt: "Treinamentos Realizados",    labelEn: "Trainings Completed" },
    { key: "acoes_estrategicas",     section: "crescimento",      type: "count",    labelPt: "Ações Estratégicas Feitas", labelEn: "Strategic Actions Done" },
    { key: "dias_rotina_completos",  section: "crescimento",      type: "computed_month", labelPt: "Dias de Rotina Completos", labelEn: "Complete Routine Days" },
    { key: "metas_batidas",          section: "crescimento",      type: "computed_month", labelPt: "Metas Batidas %",            labelEn: "Goals Hit %" },
    { key: "rotina_completa",        section: "rotina",           type: "toggle",   labelPt: "Rotina Completa Hoje",       labelEn: "Routine Complete Today" }
];

function indicatorByKey(key) {
    for (var i = 0; i < INDICATORS.length; i++) {
        if (INDICATORS[i].key === key) { return INDICATORS[i]; }
    }
    return null;
}

// Enabled + meta map for a client, resolved for one month. Missing rows
// default to enabled, no meta. Month resolution: the row for `month` wins;
// otherwise the most recent prior month's row applies — a client who sets
// goals once keeps them until they change them, and past months are never
// retroactively rescored when a later month's goals change.
async function getFieldConfig(env, clientId, month) {
    if (!isValidMonthStr(month)) { month = new Date().toISOString().slice(0, 7); }
    var rows = await env.DB.prepare(
        "SELECT indicator_key, month_label, enabled, meta_mensal, status, proposed_value, proposed_at " +
        "FROM client_field_config WHERE client_id = ? AND month_label <= ? " +
        "ORDER BY month_label ASC"
    ).bind(clientId, month).all();
    var byKey = {};
    (rows.results || []).forEach(function(r) {
        // rows arrive oldest-first, so the last write per key is the winner
        byKey[r.indicator_key] = {
            enabled: !!r.enabled, meta_mensal: r.meta_mensal,
            month_label: r.month_label, status: r.status,
            proposed_value: r.proposed_value, proposed_at: r.proposed_at
        };
    });
    var config = {};
    INDICATORS.forEach(function(ind) {
        var row = byKey[ind.key];
        config[ind.key] = {
            enabled: row ? row.enabled : true,
            meta_mensal: row ? row.meta_mensal : null,
            month_label: row ? row.month_label : null,
            status: row ? row.status : "approved",
            proposed_value: row ? row.proposed_value : null,
            proposed_at: row ? row.proposed_at : null
        };
    });
    return config;
}

// Input indicators (what the form actually asks for) for a section.
function sectionInputKeys(sectionKey, config) {
    return INDICATORS.filter(function(ind) {
        return ind.section === sectionKey &&
               ind.type !== "computed" && ind.type !== "computed_month" &&
               config[ind.key] && config[ind.key].enabled;
    }).map(function(ind) { return ind.key; });
}

// Sections this client must submit for a day to count as complete.
function applicableSections(config) {
    return ENTRY_SECTIONS.filter(function(s) { return sectionInputKeys(s, config).length > 0; });
}

function isValidDateStr(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "")) { return false; }
    var d = new Date(s + "T12:00:00Z");
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function isValidMonthStr(s) { return /^\d{4}-\d{2}$/.test(s || ""); }

// ---------------------------------------------------------------------------
// THE working-days calculation — the single source of truth composed from
// three mechanisms (never duplicate this logic elsewhere):
//   1. client_logins.work_schedule — weekly schedule (JSON weekday array,
//      0=Sun..6=Sat). NULL = never asked → every weekday counts, preserving
//      pre-feature behavior until the client answers the one-time setup.
//   2. client_blocked_ranges — planned closures (vacations etc.).
//   3. client_missed_days status 'day_off' — reactive one-off (existing).
// A day is a working day iff: weekday ∈ schedule AND not inside any blocked
// range AND not marked day_off. entry-state, weekly-summary and the pace
// dashboard all call isWorkingDay()/countWorkingDays() on a loadWorkContext.
// ---------------------------------------------------------------------------

function parseWorkScheduleJson(s) {
    if (!s) { return null; }
    try {
        var v = JSON.parse(s);
        if (Array.isArray(v)) {
            var out = [];
            v.forEach(function(n) {
                var x = Number(n);
                if (isFinite(x) && x >= 0 && x <= 6 && out.indexOf(x) === -1) { out.push(x); }
            });
            if (out.length) { out.sort(); return out; }
        }
    } catch (e) {}
    return null;
}

async function loadWorkContext(env, clientId, fromDate, toDate) {
    var login = await env.DB.prepare(
        "SELECT work_schedule FROM client_logins WHERE client_id = ?"
    ).bind(clientId).first();
    var schedule = parseWorkScheduleJson(login && login.work_schedule);
    var ranges = await env.DB.prepare(
        "SELECT start_date, end_date FROM client_blocked_ranges " +
        "WHERE client_id = ? AND end_date >= ? AND start_date <= ?"
    ).bind(clientId, fromDate, toDate).all();
    var missed = await env.DB.prepare(
        "SELECT missed_date FROM client_missed_days " +
        "WHERE client_id = ? AND status = 'day_off' AND missed_date >= ? AND missed_date <= ?"
    ).bind(clientId, fromDate, toDate).all();
    var dayOff = {};
    (missed.results || []).forEach(function(r) { dayOff[r.missed_date] = true; });
    return {
        schedule: schedule,               // null = not set → all weekdays count
        schedule_set: !!schedule,
        blocked: ranges.results || [],
        day_off: dayOff
    };
}

function isWorkingDay(ctx, dateStr) {
    var dow = new Date(dateStr + "T12:00:00Z").getUTCDay();
    if (ctx.schedule && ctx.schedule.indexOf(dow) === -1) { return false; }
    for (var i = 0; i < ctx.blocked.length; i++) {
        if (dateStr >= ctx.blocked[i].start_date && dateStr <= ctx.blocked[i].end_date) { return false; }
    }
    if (ctx.day_off[dateStr]) { return false; }
    return true;
}

function nextDateStr(ds) {
    return new Date(new Date(ds + "T12:00:00Z").getTime() + 24 * 3600 * 1000)
        .toISOString().slice(0, 10);
}

// Inclusive count of working days in [fromDate, toDate].
function countWorkingDays(ctx, fromDate, toDate) {
    var n = 0;
    var d = fromDate;
    while (d <= toDate) {
        if (isWorkingDay(ctx, d)) { n++; }
        d = nextDateStr(d);
    }
    return n;
}

// ---------------------------------------------------------------------------
// Route: GET  /api/clients/:id/work-settings — schedule + blocked ranges
// Route: PUT  /api/clients/:id/work-settings — { work_schedule: [0-6, ...] }
// Route: POST /api/clients/:id/blocked-ranges — { start_date, end_date, reason? }
// Route: DELETE /api/clients/:id/blocked-ranges/:rangeId
// Route: GET  /api/clients/:id/working-days?month=YYYY-MM&today=YYYY-MM-DD —
//   total/elapsed/remaining working days for the month, from the ONE shared
//   calculation (feeds the pace tiles; never a hardcoded 5-day week).
// ---------------------------------------------------------------------------

async function handleGetWorkSettings(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        var login = await env.DB.prepare(
            "SELECT work_schedule FROM client_logins WHERE client_id = ?"
        ).bind(id).first();
        var ranges = await env.DB.prepare(
            "SELECT id, start_date, end_date, reason FROM client_blocked_ranges " +
            "WHERE client_id = ? ORDER BY start_date"
        ).bind(id).all();
        return jsonOk({
            work_schedule: parseWorkScheduleJson(login && login.work_schedule),
            blocked_ranges: ranges.results || []
        });
    } catch (e) {
        return jsonErr("Error fetching work settings: " + e.message, 500);
    }
}

async function handlePutWorkSettings(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        var body = {};
        try { body = await request.json(); } catch (e2) { body = {}; }
        var schedule = parseWorkScheduleJson(JSON.stringify(body.work_schedule));
        if (!schedule) {
            return jsonErr("Selecione pelo menos um dia de trabalho / Select at least one working day", 400);
        }
        var res = await env.DB.prepare(
            "UPDATE client_logins SET work_schedule = ? WHERE client_id = ?"
        ).bind(JSON.stringify(schedule), id).run();
        if (!res.meta || res.meta.changes === 0) {
            return jsonErr("Client login not found", 404);
        }
        return jsonOk({ saved: true, work_schedule: schedule });
    } catch (e) {
        return jsonErr("Error saving work schedule: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/clients/:id/referral-settings
// Route: PUT /api/clients/:id/referral-settings
//   Body: { language?: 'pt'|'en', referral_bg_color?, referral_text_color? }
//
// The client's own control over their PUBLIC referral page (referral.html):
// which language it opens in, and its two brand colors. Same
// requireClientAccess contract as work-settings — a client edits their own
// record, admins may edit any.
//
// Colors are stored RAW (null when unset) rather than pre-resolved to the Apex
// fallback: null is the meaningful "I have no branding of my own" state, and
// baking the fallback in at write time would make a later change to Apex's
// palette silently miss every client who once opened this screen.
// handleGetReferralInfo applies the fallback at read time instead.
//
// The logo is deliberately NOT part of this payload: it reuses the existing
// clients.logo_url written by POST /api/clients/:id/logo, which the portal
// already exposes. One upload path, one stored key.
// ---------------------------------------------------------------------------

async function handleGetReferralSettings(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }

        var row = await env.DB.prepare(
            "SELECT language, referral_bg_color, referral_text_color, logo_url FROM clients WHERE id = ?"
        ).bind(id).first();
        if (!row) { return jsonErr("Client not found", 404); }

        return jsonOk({
            language: row.language === "en" ? "en" : "pt",
            referral_bg_color:   referralHexOrNull(row.referral_bg_color),
            referral_text_color: referralHexOrNull(row.referral_text_color),
            has_logo: !!row.logo_url,
            // The values used when the client sets nothing — so the picker can
            // show the real fallback instead of an invented placeholder.
            default_bg_color:   REFERRAL_DEFAULT_BG,
            default_text_color: REFERRAL_DEFAULT_TEXT
        });
    } catch (e) {
        return jsonErr("Error fetching referral settings: " + e.message, 500);
    }
}

async function handlePutReferralSettings(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }

        var body = {};
        try { body = await request.json(); } catch (e2) { body = {}; }

        if (typeof body.language !== "undefined") {
            if (body.language !== "pt" && body.language !== "en") {
                return jsonErr("Invalid language", 400);
            }
            await env.DB.prepare("UPDATE clients SET language = ? WHERE id = ?")
                .bind(body.language, id).run();
        }

        // Each color is independently settable and independently clearable:
        // sending "" (or any non-hex value) resets that one back to the Apex
        // fallback without disturbing the other.
        var colorKeys = ["referral_bg_color", "referral_text_color"];
        for (var i = 0; i < colorKeys.length; i++) {
            var key = colorKeys[i];
            if (typeof body[key] === "undefined") { continue; }
            var hex = referralHexOrNull(body[key]);
            if (body[key] && !hex) { return jsonErr("Invalid color: " + key, 400); }
            await env.DB.prepare("UPDATE clients SET " + key + " = ? WHERE id = ?")
                .bind(hex, id).run();
        }

        var row = await env.DB.prepare(
            "SELECT language, referral_bg_color, referral_text_color, logo_url FROM clients WHERE id = ?"
        ).bind(id).first();
        if (!row) { return jsonErr("Client not found", 404); }

        return jsonOk({
            saved: true,
            language: row.language === "en" ? "en" : "pt",
            referral_bg_color:   referralHexOrNull(row.referral_bg_color),
            referral_text_color: referralHexOrNull(row.referral_text_color),
            has_logo: !!row.logo_url
        });
    } catch (e) {
        return jsonErr("Error saving referral settings: " + e.message, 500);
    }
}

async function handlePostBlockedRange(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        var body = {};
        try { body = await request.json(); } catch (e2) { body = {}; }
        if (!isValidDateStr(body.start_date) || !isValidDateStr(body.end_date)) {
            return jsonErr("Datas inválidas / Invalid dates", 400);
        }
        if (body.end_date < body.start_date) {
            return jsonErr("A data final deve ser igual ou depois da inicial / End date must not be before start", 400);
        }
        var span = (new Date(body.end_date + "T12:00:00Z") - new Date(body.start_date + "T12:00:00Z")) / 86400000;
        if (span > 370) { return jsonErr("Período longo demais / Range too long", 400); }
        var reason = (typeof body.reason === "string" && body.reason.trim())
            ? body.reason.trim().slice(0, 200) : null;
        var rangeId = crypto.randomUUID();
        await env.DB.prepare(
            "INSERT INTO client_blocked_ranges (id, client_id, start_date, end_date, reason) VALUES (?, ?, ?, ?, ?)"
        ).bind(rangeId, id, body.start_date, body.end_date, reason).run();
        return jsonOk({ created: true, range: { id: rangeId, start_date: body.start_date, end_date: body.end_date, reason: reason } });
    } catch (e) {
        return jsonErr("Error creating blocked range: " + e.message, 500);
    }
}

async function handleDeleteBlockedRange(id, rangeId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        await env.DB.prepare(
            "DELETE FROM client_blocked_ranges WHERE id = ? AND client_id = ?"
        ).bind(rangeId, id).run();
        return jsonOk({ deleted: true });
    } catch (e) {
        return jsonErr("Error deleting blocked range: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/clients/:id/help-request — the pace dashboard's "Pedir
// ajuda com esta área" button. Creates a structured consultant task (the
// exact inbox Rafa already works from in tasks.html / the client profile)
// carrying the category and the four tile values, and returns a wa.me
// prefill URL (the app's existing no-phone-number WhatsApp pattern) so the
// client can ping Rafa directly. The full context lives in the task; the
// WhatsApp message just points him there.
// ---------------------------------------------------------------------------

async function handlePostHelpRequest(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        var client = await env.DB.prepare("SELECT id, name FROM clients WHERE id = ?").bind(id).first();
        if (!client) { return jsonErr("Client not found", 404); }
        var body = {};
        try { body = await request.json(); } catch (e2) { body = {}; }
        var label = gmStr(body.category_label, 120);
        if (!label) { return jsonErr("category_label is required", 400); }
        var month = isValidMonthStr(body.month) ? body.month : new Date().toISOString().slice(0, 7);
        // values: free-form label→string map, sanitized and capped (works for
        // count/money four-tile categories AND ratio current-vs-target ones).
        var lines = [];
        if (body.values && typeof body.values === "object") {
            Object.keys(body.values).slice(0, 8).forEach(function(k) {
                var kk = gmStr(k, 40);
                var vv = gmStr(String(body.values[k]), 60);
                if (kk && vv) { lines.push(kk + ": " + vv); }
            });
        }
        var description = "[Pedido de ajuda / Help request] " + client.name +
            " — " + label + " (" + month + ")" +
            (lines.length ? " · " + lines.join(" · ") : "");
        var taskId = crypto.randomUUID();
        // Due TODAY: the client is asking because they're overwhelmed by
        // today's goal, so the task is same-day, not dateless. Same
        // YYYY-MM-DD shape client.html's date inputs write and its overdue
        // check compares against.
        var dueDate = new Date().toISOString().slice(0, 10);
        await env.DB.prepare(
            "INSERT INTO tasks (id, client_id, type, description, due_date, status) VALUES (?, ?, 'consultant', ?, ?, 'pending')"
        ).bind(taskId, id, description, dueDate).run();
        var waText = "Oi Rafa! Aqui é " + client.name +
            ". Preciso de ajuda com \"" + label + "\" no Portal Apex. Os números estão na sua aba de tarefas.";
        return jsonOk({
            created: true,
            task_id: taskId,
            whatsapp_url: "https://wa.me/?text=" + encodeURIComponent(waText)
        });
    } catch (e) {
        return jsonErr("Error creating help request: " + e.message, 500);
    }
}

async function handleGetWorkingDays(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        var url = new URL(request.url);
        var month = url.searchParams.get("month");
        if (!isValidMonthStr(month)) { month = new Date().toISOString().slice(0, 7); }
        var today = url.searchParams.get("today");
        if (!isValidDateStr(today)) { today = new Date().toISOString().slice(0, 10); }
        var p = month.split("-");
        var first = month + "-01";
        var lastDay = new Date(Date.UTC(Number(p[0]), Number(p[1]), 0)).getUTCDate();
        var last = month + "-" + String(lastDay).padStart(2, "0");
        var ctx = await loadWorkContext(env, id, first, last);
        var total = countWorkingDays(ctx, first, last);
        // elapsed includes today; remaining also includes today (today is both
        // the latest day you produced on and the first day you can still act on).
        var elapsed, remaining;
        if (today < first)      { elapsed = 0;     remaining = total; }
        else if (today > last)  { elapsed = total; remaining = 0; }
        else {
            elapsed = countWorkingDays(ctx, first, today);
            remaining = countWorkingDays(ctx, today, last);
        }
        return jsonOk({
            month: month, today: today,
            schedule_set: ctx.schedule_set,
            total: total, elapsed: elapsed, remaining: remaining
        });
    } catch (e) {
        return jsonErr("Error computing working days: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Password hashing (PBKDF2-SHA256) + token helpers
// ---------------------------------------------------------------------------

var PBKDF2_ITERATIONS = 100000;

async function pbkdf2Hash(password, saltBytes, iterations) {
    var keyMaterial = await crypto.subtle.importKey(
        "raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    var bits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations: iterations },
        keyMaterial, 256);
    return new Uint8Array(bits);
}

function bytesToB64(bytes) {
    var bin = "";
    for (var i = 0; i < bytes.length; i++) { bin += String.fromCharCode(bytes[i]); }
    return btoa(bin);
}

function b64ToBytes(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) { out[i] = bin.charCodeAt(i); }
    return out;
}

async function hashPassword(password) {
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var hash = await pbkdf2Hash(password, salt, PBKDF2_ITERATIONS);
    return "pbkdf2$" + PBKDF2_ITERATIONS + "$" + bytesToB64(salt) + "$" + bytesToB64(hash);
}

async function verifyPassword(password, stored) {
    var parts = (stored || "").split("$");
    if (parts.length !== 4 || parts[0] !== "pbkdf2") { return false; }
    var iterations = parseInt(parts[1], 10);
    if (!iterations || iterations < 1000 || iterations > 1000000) { return false; }
    var expected = b64ToBytes(parts[3]);
    var actual = await pbkdf2Hash(password, b64ToBytes(parts[2]), iterations);
    if (actual.length !== expected.length) { return false; }
    var diff = 0;
    for (var i = 0; i < actual.length; i++) { diff |= actual[i] ^ expected[i]; }
    return diff === 0;
}

// Unambiguous alphabet (no 0/O/1/l/I) — sent over WhatsApp, typed on phones.
function generateTempPassword() {
    var alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
    var bytes = crypto.getRandomValues(new Uint8Array(12));
    var out = "";
    for (var i = 0; i < bytes.length; i++) { out += alphabet[bytes[i] % alphabet.length]; }
    return out;
}

function generateClientToken() {
    var bytes = crypto.getRandomValues(new Uint8Array(32));
    var out = "capt_";
    for (var i = 0; i < bytes.length; i++) { out += bytes[i].toString(16).padStart(2, "0"); }
    return out;
}

// Username from business name: lowercased, diacritics stripped, only [a-z0-9].
function usernameFromBusinessName(name) {
    var base = (name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase().replace(/[^a-z0-9]/g, "");
    return base || "cliente";
}

// ---------------------------------------------------------------------------
// Central client-role gate — runs in fetch() before any route dispatch.
// A client-role user can ONLY reach the whitelist below, and parameterized
// paths are matched against THEIR OWN client_id, so ID manipulation in any
// request is rejected at the API level regardless of handler behavior.
// Returns a Response to short-circuit with, or null to continue.
// ---------------------------------------------------------------------------

function clientRequestAllowed(path, method, clientId) {
    if (path === "/api/role" && method === "GET") { return true; }
    if (path === "/api/auth/client-change-password" && method === "POST") { return true; }
    if (path === "/api/auth/client-link-google" && method === "POST") { return true; }
    if (path === "/api/auth/client-logout" && method === "POST") { return true; }
    if (path === "/api/portal/me" && method === "GET") { return true; }
    if (path === "/api/portal/next-meeting" && method === "GET") { return true; }
    var base = "/api/clients/" + clientId;
    if (path === base && method === "GET") { return true; }
    if (path.indexOf(base + "/") === 0) {
        var rest = path.slice(base.length + 1);
        if (method === "GET") {
            if (rest === "tasks" || rest === "invoices" || rest === "documents" ||
                rest === "documents/latest" || rest === "logo-image" ||
                rest === "field-config" || rest === "entry-state" ||
                rest === "entries" || rest === "entries-summary" ||
                rest === "goal-state" || rest === "indicator-history" ||
                rest === "work-settings" || rest === "working-days" ||
                rest === "referral-settings" ||
                rest === "assessments") { return true; }
            if (/^documents\/[A-Za-z0-9-]+\/file$/.test(rest)) { return true; }
            if (/^assessments\/[a-z_]+$/.test(rest)) { return true; }
        }
        if (method === "POST") {
            if (rest === "logo") { return true; }
            if (rest === "blocked-ranges") { return true; }
            if (rest === "help-request") { return true; }
            if (/^entries\/\d{4}-\d{2}-\d{2}\/day-off$/.test(rest)) { return true; }
        }
        if (method === "DELETE" && /^blocked-ranges\/[A-Za-z0-9-]+$/.test(rest)) { return true; }
        if (method === "PUT" && rest === "work-settings") { return true; }
        // The client's own public referral page: their language default and
        // brand colors. Their own record only — requireClientAccess enforces it.
        if (method === "PUT" && rest === "referral-settings") { return true; }
        if (method === "PUT" && rest === "goals") { return true; }
        if (method === "PUT" && /^entries\/\d{4}-\d{2}-\d{2}\/sections\/[a-z_]+$/.test(rest)) { return true; }
        if (method === "PUT" && /^assessments\/[a-z_]+\/answers$/.test(rest)) { return true; }
        // Growth Management — the client business's own data (their leads,
        // roadmap, dormant customers, partners, ledger, jobs). Full CRUD for
        // the client's own client_id. PUT gm/config is allowed, but the handler
        // narrows a client to the four presentation lists (servicos, vendedores,
        // partner_types, cycle_months) — finance_categories, target_margin and
        // pipeline_view_threshold stay consultancy-only there.
        if (rest.indexOf("gm/") === 0) {
            var gmRest = rest.slice(3);
            if (method === "GET") {
                if (gmRest === "config" || gmRest === "leads" || gmRest === "roadmap" ||
                    gmRest === "base-ouro" || gmRest === "partners" || gmRest === "finance" ||
                    gmRest === "jobs") { return true; }
                if (/^leads\/[A-Za-z0-9-]+\/contacts$/.test(gmRest)) { return true; }
            }
            if (method === "POST") {
                if (gmRest === "leads" || gmRest === "roadmap" || gmRest === "base-ouro" ||
                    gmRest === "partners" || gmRest === "finance" || gmRest === "jobs") { return true; }
                if (/^base-ouro\/[A-Za-z0-9-]+\/reactivate$/.test(gmRest)) { return true; }
                if (/^leads\/[A-Za-z0-9-]+\/contacts$/.test(gmRest)) { return true; }
            }
            if (method === "PUT") {
                if (gmRest === "config/view-mode") { return true; }
                // The client's own referral/sheet lists. Their own record only —
                // requireClientAccess in the handler enforces it, and the handler
                // ignores the admin-only keys.
                if (gmRest === "config") { return true; }
                if (/^(leads|roadmap|base-ouro|partners|finance|jobs)\/[A-Za-z0-9-]+$/.test(gmRest)) { return true; }
            }
            if (method === "DELETE") {
                if (/^(leads|roadmap|base-ouro|partners|finance|jobs)\/[A-Za-z0-9-]+$/.test(gmRest)) { return true; }
            }
        }
    }
    return false;
}

async function enforceClientRoleGate(request, env, path, method) {
    var auth = request.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) { return null; }   // unauthenticated flows unchanged
    var user = null;
    try { user = await authenticate(request, env); } catch (e) { return null; }
    if (!user || user.role !== "client") { return null; } // admin/unknown → existing behavior
    // Forced first-login password change: until completed, a password-token
    // session can reach nothing but the change-password flow. Not bypassable.
    if (user.must_change_password) {
        if (path === "/api/role" || path === "/api/auth/client-change-password" ||
            path === "/api/auth/client-logout") { return null; }
        return jsonErr("Password change required", 403);
    }
    if (!user.client_id) { return jsonErr("Forbidden", 403); }
    if (!clientRequestAllowed(path, method, user.client_id)) { return jsonErr("Forbidden", 403); }
    return null;
}

// ---------------------------------------------------------------------------
// Route: GET /api/clients/:id/login  — admin: login status for profile card
// ---------------------------------------------------------------------------

async function handleGetClientLoginStatus(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!isAdminRole(user)) { return jsonErr("Forbidden", 403); }
        var row = await env.DB.prepare(
            "SELECT username, must_change_password, tracking_start, last_login_at, password_changed_at, created_at " +
            "FROM client_logins WHERE client_id = ?"
        ).bind(id).first();
        if (!row) { return jsonOk({ exists: false }); }
        return jsonOk({
            exists: true, username: row.username,
            must_change_password: !!row.must_change_password,
            tracking_start: row.tracking_start,
            last_login_at: row.last_login_at,
            password_changed_at: row.password_changed_at,
            created_at: row.created_at
        });
    } catch (e) {
        return jsonErr("Error fetching login status: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/clients/:id/login — admin: create login (or reset password)
// Username derived from business name, numeric suffix on collision.
// Returns the temp password ONCE (only a hash is stored).
// ---------------------------------------------------------------------------

async function handlePostClientLoginCreate(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!isAdminRole(user)) { return jsonErr("Forbidden", 403); }

        var client = await env.DB.prepare("SELECT id, name, email FROM clients WHERE id = ?").bind(id).first();
        if (!client) { return jsonErr("Client not found", 404); }

        var tempPassword = generateTempPassword();
        var passwordHash = await hashPassword(tempPassword);
        var existing = await env.DB.prepare("SELECT username FROM client_logins WHERE client_id = ?").bind(id).first();
        var username;

        if (existing) {
            // Reset: keep the username, issue a new temp password, re-force change,
            // and revoke any live sessions.
            username = existing.username;
            await env.DB.prepare(
                "UPDATE client_logins SET password_hash = ?, must_change_password = 1 WHERE client_id = ?"
            ).bind(passwordHash, id).run();
            await env.DB.prepare("DELETE FROM client_auth_tokens WHERE client_id = ?").bind(id).run();
        } else {
            var base = usernameFromBusinessName(client.name);
            username = base;
            for (var n = 2; n < 100; n++) {
                var taken = await env.DB.prepare("SELECT username FROM client_logins WHERE username = ?").bind(username).first();
                if (!taken) { break; }
                username = base + n;
            }
            // created_by is stamped on CREATION only. The reset branch above
            // deliberately does not touch it: this column answers "who let
            // this client in", and a later password reset by someone else
            // does not change who did.
            await env.DB.prepare(
                "INSERT INTO client_logins (username, client_id, password_hash, must_change_password, tracking_start, created_by) " +
                "VALUES (?, ?, ?, 1, date('now'), ?)"
            ).bind(username, id, passwordHash, actorName(user)).run();
        }

        // Google sign-in link: if the client has an email on file and it isn't
        // already a user (never overwrite an existing admin row), register it
        // as a client-role user tied to this client_id.
        var linkedEmail = null;
        if (client.email && /@/.test(client.email)) {
            var emailNorm = client.email.trim();
            var userRow = await env.DB.prepare("SELECT email, role FROM users WHERE email = ?").bind(emailNorm).first();
            if (!userRow) {
                await env.DB.prepare(
                    "INSERT INTO users (email, role, client_id) VALUES (?, 'client', ?)"
                ).bind(emailNorm, id).run();
                linkedEmail = emailNorm;
            } else if (userRow.role === "client") {
                await env.DB.prepare("UPDATE users SET client_id = ? WHERE email = ? AND role = 'client'")
                    .bind(id, emailNorm).run();
                linkedEmail = emailNorm;
            }
        }

        return jsonOk({
            username: username,
            temp_password: tempPassword,
            reset: !!existing,
            linked_google_email: linkedEmail
        });
    } catch (e) {
        return jsonErr("Error creating login: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/auth/client-login  (no auth) — { username, password }
// ---------------------------------------------------------------------------

async function handlePostClientLogin(request, env) {
    try {
        var body = await request.json();
        var username = (body.username || "").trim().toLowerCase();
        var password = body.password || "";
        if (!username || !password) { return jsonErr("Usuário e senha são obrigatórios", 400); }

        var row = await env.DB.prepare(
            "SELECT l.username, l.client_id, l.password_hash, l.must_change_password, c.name AS client_name " +
            "FROM client_logins l LEFT JOIN clients c ON c.id = l.client_id WHERE l.username = ?"
        ).bind(username).first();

        var ok = row ? await verifyPassword(password, row.password_hash) : false;
        if (!ok) { return jsonErr("Usuário ou senha inválidos", 401); }

        // Lazy purge of expired tokens, then mint a 30-day session token.
        await env.DB.prepare("DELETE FROM client_auth_tokens WHERE expires_at <= datetime('now')").run();
        var token = generateClientToken();
        var tokenHash = await sha256Hex(token);
        var expires = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
        await env.DB.prepare(
            "INSERT INTO client_auth_tokens (token_hash, client_id, username, expires_at) VALUES (?, ?, ?, ?)"
        ).bind(tokenHash, row.client_id, row.username, expires).run();
        await env.DB.prepare("UPDATE client_logins SET last_login_at = datetime('now') WHERE username = ?")
            .bind(row.username).run();

        return jsonOk({
            token: token,
            client_id: row.client_id,
            client_name: row.client_name,
            must_change_password: !!row.must_change_password
        });
    } catch (e) {
        return jsonErr("Error logging in: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/auth/client-change-password — { new_password }
// Only reachable with a password-session token. Clears the forced-change flag
// and revokes every other session for this client.
// ---------------------------------------------------------------------------

async function handlePostClientChangePassword(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user || user.role !== "client") { return jsonErr("Unauthorized", 401); }
        if (user.auth_method !== "password") { return jsonErr("Password change applies to username/password logins only", 400); }

        var body = await request.json();
        var newPassword = body.new_password || "";
        if (newPassword.length < 8) { return jsonErr("A nova senha deve ter pelo menos 8 caracteres", 400); }

        var passwordHash = await hashPassword(newPassword);
        await env.DB.prepare(
            "UPDATE client_logins SET password_hash = ?, must_change_password = 0, password_changed_at = datetime('now') " +
            "WHERE username = ?"
        ).bind(passwordHash, user.username).run();
        await env.DB.prepare("DELETE FROM client_auth_tokens WHERE client_id = ? AND token_hash != ?")
            .bind(user.client_id, user.token_hash).run();

        return jsonOk({ changed: true });
    } catch (e) {
        return jsonErr("Error changing password: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/auth/client-link-google — { google_id_token }
// Optional, skippable step offered right after a client finishes the forced
// first-login password change. Links the verified Google account's email to
// this client's users row so future logins can use either method. Requires
// the client's own password-session bearer token (not the Google token) —
// the Google ID token travels in the body purely to be verified and read.
// ---------------------------------------------------------------------------

async function handlePostClientLinkGoogle(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user || user.role !== "client" || !user.client_id) { return jsonErr("Unauthorized", 401); }

        var body = await request.json();
        var idToken = body.google_id_token || "";
        if (!idToken) { return jsonErr("Missing google_id_token", 400); }

        var payload;
        try {
            payload = await verifyFirebaseToken(idToken, env.FIREBASE_PROJECT_ID);
        } catch (e) {
            return jsonErr("Invalid Google token: " + e.message, 401);
        }
        if (!payload.email) { return jsonErr("Google account has no email", 400); }
        var emailNorm = payload.email.trim();

        var existing = await env.DB.prepare("SELECT email, role, client_id FROM users WHERE email = ?")
            .bind(emailNorm).first();
        if (existing && existing.role !== "client") {
            return jsonErr("This Google account is already an admin account", 409);
        }
        if (existing && existing.role === "client" && existing.client_id && existing.client_id !== user.client_id) {
            return jsonErr("This Google account is already linked to a different client", 409);
        }

        if (existing) {
            await env.DB.prepare("UPDATE users SET client_id = ? WHERE email = ?")
                .bind(user.client_id, emailNorm).run();
        } else {
            await env.DB.prepare("INSERT INTO users (email, role, client_id) VALUES (?, 'client', ?)")
                .bind(emailNorm, user.client_id).run();
        }

        return jsonOk({ linked: true, email: emailNorm });
    } catch (e) {
        return jsonErr("Error linking Google account: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/auth/client-logout
// ---------------------------------------------------------------------------

async function handlePostClientLogout(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user || user.role !== "client") { return jsonErr("Unauthorized", 401); }
        if (user.token_hash) {
            await env.DB.prepare("DELETE FROM client_auth_tokens WHERE token_hash = ?").bind(user.token_hash).run();
        }
        return jsonOk({ logged_out: true });
    } catch (e) {
        return jsonErr("Error logging out: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/portal/me — client's own identity + client record basics
// ---------------------------------------------------------------------------

async function handleGetPortalMe(request, env) {
    try {
        var user = await authenticate(request, env);
        // Developer preview-as (LTC pattern): a developer with ?previewAs=<id>
        // reads this endpoint as that client. Developer only — alice/rafa and
        // the real client path are untouched. Writes stay blocked by the
        // preview read-only gate in fetch().
        var previewClientId = devPreviewClientId(user, request);
        if (!previewClientId && (!user || user.role !== "client" || !user.client_id)) { return jsonErr("Unauthorized", 401); }
        // status is read fresh on EVERY portal load (never cached in the token
        // or session) so a lead who converts to 'active' via the Lead Pipeline
        // Outcome Control sees the full client portal on their very next load,
        // with no re-login and no migration step — same client_id row throughout.
        var client = await env.DB.prepare(
            "SELECT id, name, logo_url, industry, location, status FROM clients WHERE id = ?"
        ).bind(previewClientId || user.client_id).first();
        if (!client) { return jsonErr("Client not found", 404); }
        var helpTemplateRow = await env.DB.prepare(
            "SELECT template_text FROM message_templates WHERE template_key = ?"
        ).bind("portal_help_request").first();
        var helpTemplateText = (helpTemplateRow && helpTemplateRow.template_text)
            ? helpTemplateRow.template_text
            : DEFAULT_WHATSAPP_TEMPLATES.portal_help_request;
        return jsonOk({
            client_id: client.id, name: client.name,
            status: client.status || "active",
            has_logo: !!client.logo_url,
            industry: client.industry, location: client.location,
            username: user.username || null,
            auth_method: user.auth_method,
            must_change_password: !!user.must_change_password,
            help_request_template: helpTemplateText
        });
    } catch (e) {
        return jsonErr("Error fetching portal profile: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/portal/next-meeting — next scheduled session for this
// client. Sessions are already synced with Google Calendar (calendar.html /
// sessions_calendar_sync), so this reads the same integration's data and
// carries the Meet join link.
// ---------------------------------------------------------------------------

async function handleGetPortalNextMeeting(request, env) {
    try {
        var user = await authenticate(request, env);
        // Developer preview-as: same rule as handleGetPortalMe.
        var previewClientId = devPreviewClientId(user, request);
        if (!previewClientId && (!user || user.role !== "client" || !user.client_id)) { return jsonErr("Unauthorized", 401); }
        var row = await env.DB.prepare(
            "SELECT date, time, session_type, google_meet_link FROM sessions " +
            "WHERE client_id = ? AND status != 'discarded' AND status != 'cancelled' AND date >= date('now', '-1 day') " +
            "ORDER BY date ASC, COALESCE(time,'99:99') ASC LIMIT 1"
        ).bind(previewClientId || user.client_id).first();
        return jsonOk({ meeting: row || null });
    } catch (e) {
        return jsonErr("Error fetching next meeting: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/clients/:id/field-config?month=YYYY-MM — full catalog with
//   enabled/meta resolved for that month (default: current month).
// Route: PUT /api/clients/:id/field-config — admin only; body:
//   { month?: 'YYYY-MM', indicators: [{ key, enabled, meta_mensal }] }
//   Admin writes are direct: status='approved', set_by='admin'. A pending
//   client proposal survives only if the admin left that meta unchanged.
// ---------------------------------------------------------------------------

async function handleGetClientFieldConfig(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        var url = new URL(request.url);
        var month = url.searchParams.get("month");
        if (!isValidMonthStr(month)) { month = new Date().toISOString().slice(0, 7); }
        var config = await getFieldConfig(env, id, month);
        var out = INDICATORS.map(function(ind) {
            return {
                key: ind.key, section: ind.section, type: ind.type,
                label_pt: ind.labelPt, label_en: ind.labelEn,
                inverse: !!ind.inverse,
                enabled: config[ind.key].enabled,
                meta_mensal: config[ind.key].meta_mensal,
                goal_month: config[ind.key].month_label,
                goal_status: config[ind.key].status,
                proposed_value: config[ind.key].proposed_value
            };
        });
        return jsonOk({ month: month, indicators: out, sections: ENTRY_SECTIONS });
    } catch (e) {
        return jsonErr("Error fetching field config: " + e.message, 500);
    }
}

async function handlePutClientFieldConfig(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!isAdminRole(user)) { return jsonErr("Forbidden", 403); }

        var client = await env.DB.prepare("SELECT id FROM clients WHERE id = ?").bind(id).first();
        if (!client) { return jsonErr("Client not found", 404); }

        var body = await request.json();
        var month = isValidMonthStr(body.month) ? body.month : new Date().toISOString().slice(0, 7);
        var list = Array.isArray(body.indicators) ? body.indicators : [];
        var stmts = [];
        for (var i = 0; i < list.length; i++) {
            var item = list[i];
            if (!indicatorByKey(item.key)) { continue; }
            var meta = (item.meta_mensal === null || item.meta_mensal === undefined || item.meta_mensal === "")
                ? null : Number(item.meta_mensal);
            if (meta !== null && !isFinite(meta)) { meta = null; }
            stmts.push(env.DB.prepare(
                "INSERT INTO client_field_config (client_id, indicator_key, month_label, enabled, meta_mensal, set_by, status, updated_at) " +
                "VALUES (?, ?, ?, ?, ?, 'admin', 'approved', datetime('now')) " +
                "ON CONFLICT (client_id, indicator_key, month_label) DO UPDATE SET " +
                "enabled = excluded.enabled, meta_mensal = excluded.meta_mensal, " +
                "set_by = 'admin', updated_at = excluded.updated_at, " +
                // Admin changed the value → any live proposal is superseded.
                // Value untouched → a pending proposal stays pending.
                "status = CASE WHEN excluded.meta_mensal IS client_field_config.meta_mensal THEN client_field_config.status ELSE 'approved' END, " +
                "proposed_value = CASE WHEN excluded.meta_mensal IS client_field_config.meta_mensal THEN client_field_config.proposed_value ELSE NULL END, " +
                "proposed_at = CASE WHEN excluded.meta_mensal IS client_field_config.meta_mensal THEN client_field_config.proposed_at ELSE NULL END, " +
                "proposed_by = CASE WHEN excluded.meta_mensal IS client_field_config.meta_mensal THEN client_field_config.proposed_by ELSE NULL END"
            ).bind(id, item.key, month, item.enabled ? 1 : 0, meta));
        }
        if (stmts.length) { await env.DB.batch(stmts); }
        return jsonOk({ saved: stmts.length, month: month });
    } catch (e) {
        return jsonErr("Error saving field config: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Goal-able indicators: everything a monthly target makes sense for. Excludes
// the daily rotina toggle and metas_batidas (its meta is fixed at 100 by
// computeMonthlySummary).
// ---------------------------------------------------------------------------

function isGoalableIndicator(ind) {
    return ind.type !== "toggle" && ind.key !== "metas_batidas";
}

// ---------------------------------------------------------------------------
// Route: GET /api/clients/:id/goal-state?today=YYYY-MM-DD — drives the portal
// goal gates. "Has goals for month M" = at least one row written FOR month M
// with an active or proposed value (fallback from prior months does not
// count — the gate is about this month's commitment).
// ---------------------------------------------------------------------------

async function handleGetGoalState(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }

        var url = new URL(request.url);
        var today = url.searchParams.get("today");
        if (!isValidDateStr(today)) { today = new Date().toISOString().slice(0, 10); }
        var curMonth = today.slice(0, 7);
        var p = curMonth.split("-");
        var nextD = new Date(Number(p[0]), Number(p[1]), 1);
        var nextMonth = nextD.getFullYear() + "-" + String(nextD.getMonth() + 1).padStart(2, "0");

        var any = await env.DB.prepare(
            "SELECT 1 AS x FROM client_field_config WHERE client_id = ? AND (meta_mensal IS NOT NULL OR proposed_value IS NOT NULL) LIMIT 1"
        ).bind(id).first();
        var cur = await env.DB.prepare(
            "SELECT 1 AS x FROM client_field_config WHERE client_id = ? AND month_label = ? AND (meta_mensal IS NOT NULL OR proposed_value IS NOT NULL) LIMIT 1"
        ).bind(id, curMonth).first();
        var nxt = await env.DB.prepare(
            "SELECT 1 AS x FROM client_field_config WHERE client_id = ? AND month_label = ? AND (meta_mensal IS NOT NULL OR proposed_value IS NOT NULL) LIMIT 1"
        ).bind(id, nextMonth).first();

        return jsonOk({
            today: today, current_month: curMonth, next_month: nextMonth,
            has_any_goals: !!any,
            current_month_has_goals: !!cur,
            next_month_has_goals: !!nxt
        });
    } catch (e) {
        return jsonErr("Error fetching goal state: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: PUT /api/clients/:id/goals — the client's own goal submission.
// Body: { month: 'YYYY-MM', goals: [{ key, meta_mensal }] }
// Approval rules (Task 3):
//   - no prior approved value for that month (incl. fallback) → direct write,
//     status='approved', set_by='client' (first-time goals never block)
//   - same value as the active goal → re-commit for the month (approved copy)
//   - different value → proposal: the approved meta stays active and keeps
//     driving every percentage; proposed_value waits for admin decision
// Admins may also call this (requireClientAccess passes) — their writes go
// through the same rules with set_by/proposed_by reflecting who called.
// ---------------------------------------------------------------------------

async function handlePutClientGoals(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }

        var client = await env.DB.prepare("SELECT id FROM clients WHERE id = ?").bind(id).first();
        if (!client) { return jsonErr("Client not found", 404); }

        var body = await request.json();
        var month = isValidMonthStr(body.month) ? body.month : new Date().toISOString().slice(0, 7);
        var list = Array.isArray(body.goals) ? body.goals : [];
        var isAdmin = isAdminRole(user);
        var actor = isAdmin ? (user.email || user.role) : "client";

        // Past months are history — rewriting their targets would retroactively
        // rescore them. Clients may only set current/future months (admins can
        // still correct history via the field-config modal if ever needed).
        if (!isAdmin && month < new Date().toISOString().slice(0, 7)) {
            return jsonErr("Metas de meses passados não podem ser alteradas", 400);
        }

        var config = await getFieldConfig(env, id, month);
        var monthRows = await env.DB.prepare(
            "SELECT indicator_key, meta_mensal, status FROM client_field_config WHERE client_id = ? AND month_label = ?"
        ).bind(id, month).all();
        var rowInMonth = {};
        (monthRows.results || []).forEach(function(r) { rowInMonth[r.indicator_key] = r; });

        var stmts = [];
        var pendingCount = 0, savedCount = 0;
        for (var i = 0; i < list.length; i++) {
            var item = list[i];
            var ind = indicatorByKey(item.key);
            if (!ind || !isGoalableIndicator(ind)) { continue; }
            if (!config[item.key].enabled) { continue; }
            var val = (item.meta_mensal === null || item.meta_mensal === undefined || item.meta_mensal === "")
                ? null : Number(item.meta_mensal);
            if (val !== null && !isFinite(val)) { continue; }
            if (val === null) { continue; }   // a goal submission never clears a goal

            var active = config[item.key].meta_mensal;   // resolved (with fallback) approved value
            var enabled = config[item.key].enabled ? 1 : 0;

            if (isAdmin) {
                // Admin path: direct approved write (same semantics as field-config PUT).
                stmts.push(env.DB.prepare(
                    "INSERT INTO client_field_config (client_id, indicator_key, month_label, enabled, meta_mensal, set_by, status, decided_at, decided_by, updated_at) " +
                    "VALUES (?, ?, ?, ?, ?, 'admin', 'approved', datetime('now'), ?, datetime('now')) " +
                    "ON CONFLICT (client_id, indicator_key, month_label) DO UPDATE SET " +
                    "meta_mensal = excluded.meta_mensal, set_by = 'admin', status = 'approved', " +
                    "proposed_value = NULL, proposed_at = NULL, proposed_by = NULL, " +
                    "decided_at = excluded.decided_at, decided_by = excluded.decided_by, updated_at = excluded.updated_at"
                ).bind(id, item.key, month, enabled, val, actor));
                savedCount++;
            } else if (active === null || active === undefined) {
                // First-time goal → auto-approve, never blocks a new client.
                stmts.push(env.DB.prepare(
                    "INSERT INTO client_field_config (client_id, indicator_key, month_label, enabled, meta_mensal, set_by, status, updated_at) " +
                    "VALUES (?, ?, ?, ?, ?, 'client', 'approved', datetime('now')) " +
                    "ON CONFLICT (client_id, indicator_key, month_label) DO UPDATE SET " +
                    "meta_mensal = excluded.meta_mensal, set_by = 'client', status = 'approved', " +
                    "proposed_value = NULL, proposed_at = NULL, proposed_by = NULL, updated_at = excluded.updated_at"
                ).bind(id, item.key, month, enabled, val));
                savedCount++;
            } else if (Number(val) === Number(active)) {
                // Unchanged → re-commit the active goal for this month (clears the
                // monthly gate without needing approval). Never downgrades a
                // pending proposal already sitting on this month's row.
                var existing = rowInMonth[item.key];
                if (!existing) {
                    stmts.push(env.DB.prepare(
                        "INSERT INTO client_field_config (client_id, indicator_key, month_label, enabled, meta_mensal, set_by, status, updated_at) " +
                        "VALUES (?, ?, ?, ?, ?, 'client', 'approved', datetime('now'))"
                    ).bind(id, item.key, month, enabled, val));
                    savedCount++;
                }
            } else {
                // Edit of an existing approved goal → pending proposal. The active
                // meta_mensal is carried into this month's row and stays live.
                stmts.push(env.DB.prepare(
                    "INSERT INTO client_field_config (client_id, indicator_key, month_label, enabled, meta_mensal, set_by, status, proposed_value, proposed_at, proposed_by, updated_at) " +
                    "VALUES (?, ?, ?, ?, ?, 'client', 'pending', ?, datetime('now'), ?, datetime('now')) " +
                    "ON CONFLICT (client_id, indicator_key, month_label) DO UPDATE SET " +
                    "status = 'pending', proposed_value = excluded.proposed_value, " +
                    "proposed_at = excluded.proposed_at, proposed_by = excluded.proposed_by, updated_at = excluded.updated_at"
                ).bind(id, item.key, month, enabled, active, val, user.username || user.email || "client"));
                pendingCount++;
            }
        }
        if (stmts.length) { await env.DB.batch(stmts); }
        return jsonOk({ saved: savedCount, pending: pendingCount, month: month });
    } catch (e) {
        return jsonErr("Error saving goals: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/goal-approvals — admin only. Every live client proposal.
// Route: POST /api/goal-approvals/:client_id/:indicator_key/:month_label
//   Body { decision: 'approve' | 'reject' }. Approve copies proposed_value
//   into meta_mensal; reject clears the proposal only (old meta stays).
// ---------------------------------------------------------------------------

async function handleGetGoalApprovals(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!isAdminRole(user)) { return jsonErr("Forbidden", 403); }

        var rows = await env.DB.prepare(
            "SELECT f.client_id, c.name AS client_name, f.indicator_key, f.month_label, " +
            "f.meta_mensal, f.proposed_value, f.proposed_at, f.proposed_by " +
            "FROM client_field_config f LEFT JOIN clients c ON c.id = f.client_id " +
            "WHERE f.status = 'pending' AND f.proposed_value IS NOT NULL " +
            "ORDER BY f.proposed_at DESC"
        ).all();
        var out = (rows.results || []).map(function(r) {
            var ind = indicatorByKey(r.indicator_key);
            return {
                client_id: r.client_id, client_name: r.client_name || r.client_id,
                indicator_key: r.indicator_key,
                label_pt: ind ? ind.labelPt : r.indicator_key,
                label_en: ind ? ind.labelEn : r.indicator_key,
                month_label: r.month_label,
                current_value: r.meta_mensal, proposed_value: r.proposed_value,
                proposed_at: r.proposed_at, proposed_by: r.proposed_by
            };
        });
        return jsonOk({ pending: out });
    } catch (e) {
        return jsonErr("Error fetching goal approvals: " + e.message, 500);
    }
}

async function handlePostGoalApprovalDecision(clientId, indicatorKey, monthLabel, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!isAdminRole(user)) { return jsonErr("Forbidden", 403); }
        if (!isValidMonthStr(monthLabel)) { return jsonErr("Invalid month", 400); }

        var body = await request.json();
        var decision = body.decision;
        if (decision !== "approve" && decision !== "reject") { return jsonErr("decision must be 'approve' or 'reject'", 400); }

        var row = await env.DB.prepare(
            "SELECT status, proposed_value FROM client_field_config WHERE client_id = ? AND indicator_key = ? AND month_label = ?"
        ).bind(clientId, indicatorKey, monthLabel).first();
        if (!row || row.status !== "pending" || row.proposed_value === null) {
            return jsonErr("No pending proposal for this goal", 404);
        }

        var decider = user.email || user.role;
        if (decision === "approve") {
            await env.DB.prepare(
                "UPDATE client_field_config SET meta_mensal = proposed_value, status = 'approved', set_by = 'client', " +
                "proposed_value = NULL, proposed_at = NULL, proposed_by = NULL, " +
                "decided_at = datetime('now'), decided_by = ?, updated_at = datetime('now') " +
                "WHERE client_id = ? AND indicator_key = ? AND month_label = ?"
            ).bind(decider, clientId, indicatorKey, monthLabel).run();
        } else {
            await env.DB.prepare(
                "UPDATE client_field_config SET status = 'rejected', " +
                "proposed_value = NULL, proposed_at = NULL, proposed_by = NULL, " +
                "decided_at = datetime('now'), decided_by = ?, updated_at = datetime('now') " +
                "WHERE client_id = ? AND indicator_key = ? AND month_label = ?"
            ).bind(decider, clientId, indicatorKey, monthLabel).run();
        }
        return jsonOk({ decided: decision, client_id: clientId, indicator_key: indicatorKey, month_label: monthLabel });
    } catch (e) {
        return jsonErr("Error deciding goal approval: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/clients/:id/indicator-history?indicator=key&months=12
// Monthly realizado + meta for ONE indicator, for the portal trend chart.
// Reuses computeMonthlySummary per month so the math can never drift from the
// analytics view. Only months that actually have completed entries appear.
// ---------------------------------------------------------------------------

async function handleGetIndicatorHistory(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }

        var url = new URL(request.url);
        var key = url.searchParams.get("indicator") || "";
        if (!indicatorByKey(key)) { return jsonErr("Unknown indicator", 400); }
        var maxMonths = parseInt(url.searchParams.get("months"), 10);
        if (!maxMonths || maxMonths < 1 || maxMonths > 24) { maxMonths = 12; }

        var monthsRes = await env.DB.prepare(
            "SELECT DISTINCT substr(entry_date, 1, 7) AS m FROM client_daily_entries " +
            "WHERE client_id = ? AND completed = 1 ORDER BY m DESC LIMIT ?"
        ).bind(id, maxMonths).all();
        var months = (monthsRes.results || []).map(function(r) { return r.m; }).reverse();

        var points = [];
        for (var i = 0; i < months.length; i++) {
            var summary = await computeMonthlySummary(env, id, months[i]);
            for (var j = 0; j < summary.indicators.length; j++) {
                if (summary.indicators[j].key === key) {
                    points.push({
                        month: months[i],
                        realizado: summary.indicators[j].realizado,
                        meta: summary.indicators[j].meta_mensal
                    });
                    break;
                }
            }
        }
        var ind = indicatorByKey(key);
        return jsonOk({
            indicator: key, type: ind.type, inverse: !!ind.inverse,
            label_pt: ind.labelPt, label_en: ind.labelEn, points: points
        });
    } catch (e) {
        return jsonErr("Error fetching indicator history: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Daily-entry helpers
// ---------------------------------------------------------------------------

function parseSectionsJson(raw) {
    try { var v = JSON.parse(raw || "{}"); return (v && typeof v === "object") ? v : {}; }
    catch (e) { return {}; }
}

function computeFinanceiroDerived(values) {
    var receita = Number(values.receita) || 0;
    var saida   = Number(values.saida) || 0;
    values.lucro_liquido = Math.round((receita - saida) * 100) / 100;
    values.margem_lucro  = receita !== 0 ? Math.round(((receita - saida) / receita) * 10000) / 100 : 0;
}

function recomputeTaxaConversao(sections) {
    var fin = sections.financeiro;
    var cli = sections.clientes_mercado;
    if (!fin || !fin.submitted_at || !fin.values) { return; }
    if (!cli || !cli.submitted_at || !cli.values) { return; }
    var vendas = Number(fin.values.vendas_fechadas) || 0;
    var leads = Number(cli.values.leads_gerados) || 0;
    fin.values.taxa_conversao = leads > 0 ? Math.round((vendas / leads) * 10000) / 100 : 0;
}

// ---------------------------------------------------------------------------
// Route: PUT /api/clients/:id/entries/:date/sections/:sectionKey
// Body: { values: {key: number}, draft: bool, today: 'YYYY-MM-DD' }
// draft=true  → autosave: store partial values, no validation, no submit stamp
// draft=false → submit: every enabled field required; lucro/margem recomputed
//               server-side; marks the day completed when all sections are in.
// ---------------------------------------------------------------------------

async function handlePutEntrySection(id, dateStr, sectionKey, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        if (!isValidDateStr(dateStr)) { return jsonErr("Invalid date", 400); }
        if (ENTRY_SECTIONS.indexOf(sectionKey) === -1) { return jsonErr("Invalid section", 400); }

        var client = await env.DB.prepare("SELECT id FROM clients WHERE id = ?").bind(id).first();
        if (!client) { return jsonErr("Client not found", 404); }

        var body = await request.json();
        var isDraft = !!body.draft;
        var today = isValidDateStr(body.today) ? body.today : new Date().toISOString().slice(0, 10);
        if (dateStr > today) { return jsonErr("Cannot fill a future day", 400); }

        var config = await getFieldConfig(env, id, dateStr.slice(0, 7));
        var inputKeys = sectionInputKeys(sectionKey, config);
        if (inputKeys.length === 0) { return jsonErr("Section has no enabled fields for this client", 400); }

        var rawValues = (body.values && typeof body.values === "object") ? body.values : {};
        var values = {};
        for (var i = 0; i < inputKeys.length; i++) {
            var k = inputKeys[i];
            var v = rawValues[k];
            if (v === null || v === undefined || v === "") {
                if (!isDraft) { return jsonErr("Campo obrigatório ausente: " + k, 400); }
                continue;
            }
            var num = Number(v);
            if (!isFinite(num)) { return jsonErr("Valor inválido para " + k, 400); }
            var ind = indicatorByKey(k);
            if (ind.type === "toggle") { num = num ? 1 : 0; }
            values[k] = num;
        }
        if (sectionKey === "financeiro" && !isDraft) { computeFinanceiroDerived(values); }

        var row = await env.DB.prepare(
            "SELECT id, sections_json, completed FROM client_daily_entries WHERE client_id = ? AND entry_date = ?"
        ).bind(id, dateStr).first();

        var sections = row ? parseSectionsJson(row.sections_json) : {};
        if (isDraft) {
            var prev = sections[sectionKey] || {};
            if (prev.submitted_at) {
                // Already submitted — a draft never downgrades a submitted section.
                return jsonOk({ saved: true, already_submitted: true, completed: !!(row && row.completed) });
            }
            sections[sectionKey] = { draft_values: Object.assign({}, prev.draft_values || {}, values) };
        } else {
            sections[sectionKey] = { values: values, submitted_at: new Date().toISOString() };
        }

        if (!isDraft && (sectionKey === "financeiro" || sectionKey === "clientes_mercado")) {
            recomputeTaxaConversao(sections);
        }

        var required = applicableSections(config);
        var completed = required.every(function(s) { return sections[s] && sections[s].submitted_at; });
        var wasCompleted = !!(row && row.completed);
        var sectionsStr = JSON.stringify(sections);

        if (row) {
            await env.DB.prepare(
                "UPDATE client_daily_entries SET sections_json = ?, completed = ?, " +
                "completed_at = CASE WHEN ? = 1 AND completed_at IS NULL THEN datetime('now') WHEN ? = 0 THEN NULL ELSE completed_at END, " +
                "updated_at = datetime('now') WHERE id = ?"
            ).bind(sectionsStr, completed ? 1 : 0, completed ? 1 : 0, completed ? 1 : 0, row.id).run();
        } else {
            await env.DB.prepare(
                "INSERT INTO client_daily_entries (id, client_id, entry_date, sections_json, completed, completed_at) " +
                "VALUES (?, ?, ?, ?, ?, CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END)"
            ).bind(crypto.randomUUID(), id, dateStr, sectionsStr, completed ? 1 : 0, completed ? 1 : 0).run();
        }

        // A backlogged day completed after the fact is recorded as filled-late
        // (upgrades an earlier day-off mark, keeping any reason text).
        if (completed && !wasCompleted && dateStr < today) {
            await env.DB.prepare(
                "INSERT INTO client_missed_days (id, client_id, missed_date, status) VALUES (?, ?, ?, 'filled_late') " +
                "ON CONFLICT (client_id, missed_date) DO UPDATE SET status = 'filled_late'"
            ).bind(crypto.randomUUID(), id, dateStr).run();
        }

        return jsonOk({ saved: true, draft: isDraft, completed: completed, sections: sections });
    } catch (e) {
        return jsonErr("Error saving entry: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/clients/:id/entries/:date/day-off — { reason? }
// ---------------------------------------------------------------------------

async function handlePostEntryDayOff(id, dateStr, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        if (!isValidDateStr(dateStr)) { return jsonErr("Invalid date", 400); }

        var entry = await env.DB.prepare(
            "SELECT completed FROM client_daily_entries WHERE client_id = ? AND entry_date = ?"
        ).bind(id, dateStr).first();
        if (entry && entry.completed) { return jsonErr("This day is already completed", 400); }

        var body = {};
        try { body = await request.json(); } catch (e2) { body = {}; }
        var reason = (typeof body.reason === "string" && body.reason.trim()) ? body.reason.trim().slice(0, 300) : null;

        await env.DB.prepare(
            "INSERT INTO client_missed_days (id, client_id, missed_date, status, reason) VALUES (?, ?, ?, 'day_off', ?) " +
            "ON CONFLICT (client_id, missed_date) DO UPDATE SET status = 'day_off', reason = excluded.reason"
        ).bind(crypto.randomUUID(), id, dateStr, reason).run();

        return jsonOk({ marked: true, date: dateStr });
    } catch (e) {
        return jsonErr("Error marking day off: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/clients/:id/entry-state?today=YYYY-MM-DD
// Login/entry flow driver: every backlogged day (not completed, not a day
// off) from tracking_start (capped at 14 days back) through today, each with
// its saved sections so the client resumes exactly where they left off.
// ---------------------------------------------------------------------------

async function handleGetEntryState(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }

        var url = new URL(request.url);
        var today = url.searchParams.get("today");
        if (!isValidDateStr(today)) { today = new Date().toISOString().slice(0, 10); }

        var login = await env.DB.prepare("SELECT tracking_start FROM client_logins WHERE client_id = ?").bind(id).first();
        var start = (login && login.tracking_start && isValidDateStr(login.tracking_start)) ? login.tracking_start : today;
        var cap = new Date(new Date(today + "T12:00:00Z").getTime() - 13 * 24 * 3600 * 1000).toISOString().slice(0, 10);
        if (start < cap) { start = cap; }
        if (start > today) { start = today; }

        var entries = await env.DB.prepare(
            "SELECT entry_date, sections_json, completed FROM client_daily_entries " +
            "WHERE client_id = ? AND entry_date >= ? AND entry_date <= ?"
        ).bind(id, start, today).all();

        var entryByDate = {};
        (entries.results || []).forEach(function(r) { entryByDate[r.entry_date] = r; });

        // The shared working-day rule (weekly schedule + blocked ranges +
        // day_off) decides which dates need entries — the log never prompts
        // for a Sunday a Mon-Sat business is closed, or inside a vacation.
        var workCtx = await loadWorkContext(env, id, start, today);

        var config = await getFieldConfig(env, id, today.slice(0, 7));
        var required = applicableSections(config);

        var pending = [];
        var d = new Date(start + "T12:00:00Z");
        var end = new Date(today + "T12:00:00Z");
        while (d <= end) {
            var ds = d.toISOString().slice(0, 10);
            var entry = entryByDate[ds];
            if (!(entry && entry.completed) && isWorkingDay(workCtx, ds)) {
                pending.push({
                    date: ds,
                    is_today: ds === today,
                    sections: entry ? parseSectionsJson(entry.sections_json) : {}
                });
            }
            d = new Date(d.getTime() + 24 * 3600 * 1000);
        }

        return jsonOk({
            today: today, tracking_start: start, required_sections: required,
            pending: pending,
            work_schedule_set: workCtx.schedule_set,
            // Uncapped (the `tracking_start` above is clamped to 14 days for
            // the backlog): drives the new/established framing emphasis only.
            tracking_start_raw: (login && login.tracking_start) || null
        });
    } catch (e) {
        return jsonErr("Error fetching entry state: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/clients/:id/entries?month=YYYY-MM
// Historical view (the retired grid's data) + missed-day info for the month.
// ---------------------------------------------------------------------------

async function handleGetClientEntries(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }

        var url = new URL(request.url);
        var month = url.searchParams.get("month");
        if (!isValidMonthStr(month)) { month = new Date().toISOString().slice(0, 7); }

        var entries = await env.DB.prepare(
            "SELECT entry_date, sections_json, completed, completed_at FROM client_daily_entries " +
            "WHERE client_id = ? AND entry_date LIKE ? ORDER BY entry_date DESC"
        ).bind(id, month + "-%").all();
        var missed = await env.DB.prepare(
            "SELECT missed_date, status, reason FROM client_missed_days WHERE client_id = ? AND missed_date LIKE ?"
        ).bind(id, month + "-%").all();

        var out = (entries.results || []).map(function(r) {
            return {
                date: r.entry_date, completed: !!r.completed, completed_at: r.completed_at,
                sections: parseSectionsJson(r.sections_json)
            };
        });
        return jsonOk({ month: month, entries: out, missed_days: missed.results || [] });
    } catch (e) {
        return jsonErr("Error fetching entries: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Monthly aggregation. ONLY fully-completed days contribute (partial days add
// nothing to sums or Falta). Falta is computed fresh on every call — never
// cached — so it reacts immediately to new entries and target changes (bug
// fix #2). Realizado comes straight from the same rows the entry form writes,
// so the entry and the dashboard can never disagree (bug fix #1).
// ---------------------------------------------------------------------------

async function computeMonthlySummary(env, clientId, month) {
    var config = await getFieldConfig(env, clientId, month);
    var entries = await env.DB.prepare(
        "SELECT entry_date, sections_json FROM client_daily_entries " +
        "WHERE client_id = ? AND entry_date LIKE ? AND completed = 1"
    ).bind(clientId, month + "-%").all();

    var rows = (entries.results || []).map(function(r) {
        return { date: r.entry_date, sections: parseSectionsJson(r.sections_json) };
    });

    var sums = {}, counts = {};
    rows.forEach(function(r) {
        ENTRY_SECTIONS.forEach(function(sec) {
            var block = r.sections[sec];
            if (!block || !block.submitted_at || !block.values) { return; }
            Object.keys(block.values).forEach(function(k) {
                var v = Number(block.values[k]);
                if (!isFinite(v)) { return; }
                sums[k] = (sums[k] || 0) + v;
                counts[k] = (counts[k] || 0) + 1;
            });
        });
    });

    var diasRotina = rows.filter(function(r) {
        var rot = r.sections.rotina;
        return rot && rot.submitted_at && rot.values && Number(rot.values.rotina_completa) === 1;
    }).length;

    var indicators = [];
    INDICATORS.forEach(function(ind) {
        if (!config[ind.key].enabled) { return; }
        var realizado = null;
        if (ind.key === "margem_lucro") {
            // Monthly margin derives from monthly totals, not a sum/avg of dailies.
            var recSum = sums.receita || 0;
            realizado = recSum !== 0 ? Math.round(((recSum - (sums.saida || 0)) / recSum) * 10000) / 100
                                     : (rows.length ? 0 : null);
        } else if (ind.key === "taxa_conversao") {
            // Monthly conversion rate derives from monthly totals, same pattern as margem_lucro.
            var leadsSum = sums.leads_gerados || 0;
            realizado = leadsSum !== 0 ? Math.round(((sums.vendas_fechadas || 0) / leadsSum) * 10000) / 100
                                       : (rows.length ? 0 : null);
        } else if (ind.key === "metas_batidas") {
            realizado = null; // filled in below, once every other indicator's realizado/meta is known
        } else if (ind.key === "dias_rotina_completos") {
            realizado = diasRotina;
        } else if (ind.type === "percent" || ind.type === "hours") {
            realizado = counts[ind.key] ? Math.round((sums[ind.key] / counts[ind.key]) * 100) / 100 : null;
        } else if (ind.type === "toggle") {
            realizado = diasRotina;
        } else {
            realizado = (ind.key in sums) ? Math.round(sums[ind.key] * 100) / 100 : (rows.length ? 0 : null);
        }
        var meta = config[ind.key].meta_mensal;
        var falta = null;
        if (meta !== null && meta !== undefined && realizado !== null) {
            falta = ind.inverse ? Math.max(0, realizado - meta) : Math.max(0, meta - realizado);
            falta = Math.round(falta * 100) / 100;
        }
        indicators.push({
            key: ind.key, section: ind.section, type: ind.type,
            label_pt: ind.labelPt, label_en: ind.labelEn, inverse: !!ind.inverse,
            meta_mensal: (meta === undefined) ? null : meta,
            realizado: realizado, falta: falta,
            goal_status: config[ind.key].status,
            proposed_value: config[ind.key].proposed_value
        });
    });

    var metasBatidasEligible = indicators.filter(function(x) {
        return x.key !== "metas_batidas" && x.key !== "dias_rotina_completos" &&
               x.type !== "toggle" &&
               x.meta_mensal !== null && x.meta_mensal !== undefined && x.meta_mensal !== 0 &&
               x.realizado !== null;
    });
    var metasBatidasHits = metasBatidasEligible.filter(function(x) {
        return x.inverse ? x.realizado <= x.meta_mensal : x.realizado >= x.meta_mensal;
    }).length;
    var metasBatidasPct = metasBatidasEligible.length
        ? Math.round((metasBatidasHits / metasBatidasEligible.length) * 10000) / 100
        : null;
    indicators.forEach(function(x) {
        if (x.key !== "metas_batidas") { return; }
        x.realizado = metasBatidasPct;
        x.meta_mensal = 100;
        x.falta = metasBatidasPct !== null ? Math.round(Math.max(0, 100 - metasBatidasPct) * 100) / 100 : null;
    });

    return {
        month: month,
        completed_days: rows.length,
        dias_rotina_completos: diasRotina,
        indicators: indicators
    };
}

async function handleGetEntriesSummary(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        var url = new URL(request.url);
        var month = url.searchParams.get("month");
        if (!isValidMonthStr(month)) { month = new Date().toISOString().slice(0, 7); }
        var summary = await computeMonthlySummary(env, id, month);
        return jsonOk(summary);
    } catch (e) {
        return jsonErr("Error computing summary: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/leaderboard?month=YYYY-MM — alice/rafa/developer ONLY.
// Ranks active clients by composite score and per category. Attainment per
// indicator (needs a meta): realizado/meta*100 capped at 150; inverse
// indicators score 100 when within target, meta/realizado*100 when over.
// ---------------------------------------------------------------------------

async function handleGetLeaderboard(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!isAdminRole(user)) { return jsonErr("Forbidden", 403); }

        var url = new URL(request.url);
        var month = url.searchParams.get("month");
        if (!isValidMonthStr(month)) { month = new Date().toISOString().slice(0, 7); }

        var clients = await env.DB.prepare(
            "SELECT id, name FROM clients WHERE status = 'active' OR status IS NULL ORDER BY name"
        ).all();

        var CATEGORIES = ["financeiro", "clientes_mercado", "processos", "crescimento"];
        var results = [];
        var list = clients.results || [];
        for (var i = 0; i < list.length; i++) {
            var c = list[i];
            var summary = await computeMonthlySummary(env, c.id, month);
            var catScores = {};
            CATEGORIES.forEach(function(cat) {
                var pcts = [];
                summary.indicators.forEach(function(ind) {
                    if (ind.section !== cat) { return; }
                    var meta = ind.meta_mensal;
                    if (meta === null || meta === undefined || meta === 0 || ind.realizado === null) { return; }
                    var pct;
                    if (ind.inverse) {
                        pct = ind.realizado <= meta ? 100 : Math.round((meta / ind.realizado) * 10000) / 100;
                    } else {
                        // Capped at 150 DELIBERATELY for fair ranking. The client
                        // portal shows uncapped percentages on purpose — not an
                        // inconsistency to "fix".
                        pct = Math.min(150, Math.round((ind.realizado / meta) * 10000) / 100);
                    }
                    pcts.push(pct);
                });
                catScores[cat] = pcts.length
                    ? Math.round((pcts.reduce(function(a, b) { return a + b; }, 0) / pcts.length) * 10) / 10
                    : null;
            });
            var present = CATEGORIES.map(function(cat) { return catScores[cat]; })
                .filter(function(v) { return v !== null; });
            var composite = present.length
                ? Math.round((present.reduce(function(a, b) { return a + b; }, 0) / present.length) * 10) / 10
                : null;
            results.push({
                client_id: c.id, name: c.name,
                completed_days: summary.completed_days,
                composite: composite, categories: catScores
            });
        }

        results.sort(function(a, b) {
            if (a.composite === null && b.composite === null) { return 0; }
            if (a.composite === null) { return 1; }
            if (b.composite === null) { return -1; }
            return b.composite - a.composite;
        });

        return jsonOk({ month: month, ranking: results });
    } catch (e) {
        return jsonErr("Error computing leaderboard: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/clients/:id/weekly-summary?start=YYYY-MM-DD (Monday) —
// alice/rafa/developer ONLY. Current-week day-by-day status for the profile.
// ---------------------------------------------------------------------------

async function handleGetWeeklySummary(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!isAdminRole(user)) { return jsonErr("Forbidden", 403); }

        var url = new URL(request.url);
        var start = url.searchParams.get("start");
        if (!isValidDateStr(start)) {
            // default: Monday of the current week (UTC)
            var now = new Date();
            var dow = (now.getUTCDay() + 6) % 7;
            start = new Date(now.getTime() - dow * 24 * 3600 * 1000).toISOString().slice(0, 10);
        }
        var endDate = new Date(new Date(start + "T12:00:00Z").getTime() + 6 * 24 * 3600 * 1000)
            .toISOString().slice(0, 10);
        var today = new Date().toISOString().slice(0, 10);

        var entries = await env.DB.prepare(
            "SELECT entry_date, completed FROM client_daily_entries WHERE client_id = ? AND entry_date >= ? AND entry_date <= ?"
        ).bind(id, start, endDate).all();
        var missed = await env.DB.prepare(
            "SELECT missed_date, status, reason FROM client_missed_days WHERE client_id = ? AND missed_date >= ? AND missed_date <= ?"
        ).bind(id, start, endDate).all();
        var login = await env.DB.prepare("SELECT tracking_start FROM client_logins WHERE client_id = ?").bind(id).first();
        var trackingStart = login ? login.tracking_start : null;

        var entryByDate = {}, missedByDate = {};
        (entries.results || []).forEach(function(r) { entryByDate[r.entry_date] = r; });
        (missed.results || []).forEach(function(r) { missedByDate[r.missed_date] = r; });

        var workCtx = await loadWorkContext(env, id, start, endDate);

        var days = [];
        for (var i = 0; i < 7; i++) {
            var ds = new Date(new Date(start + "T12:00:00Z").getTime() + i * 24 * 3600 * 1000)
                .toISOString().slice(0, 10);
            var e = entryByDate[ds];
            var m = missedByDate[ds];
            var status;
            if (e && e.completed) { status = (m && m.status === "filled_late") ? "filled_late" : "completed"; }
            else if (m && m.status === "day_off") { status = "day_off"; }
            // Weekly schedule / blocked range: the day was never expected —
            // it must not read as "missing" on the admin card.
            else if (!isWorkingDay(workCtx, ds)) { status = "not_scheduled"; }
            else if (ds > today) { status = "future"; }
            else if (trackingStart && ds < trackingStart) { status = "not_tracked"; }
            else if (e) { status = "partial"; }
            else { status = "missing"; }
            days.push({ date: ds, status: status, reason: m ? (m.reason || null) : null });
        }
        return jsonOk({ week_start: start, days: days });
    } catch (e) {
        return jsonErr("Error fetching weekly summary: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Business X-Ray (Raio X Empresarial) — Part 1: instrument + scoring engine
// + generic assessment assignment. The question bank is DATA (Part 2 appends
// sections to it); scoring is a pure function, fully separate from rendering,
// so a narrative/report layer can be added later without touching it.
// ---------------------------------------------------------------------------

var ASSESSMENT_TYPES = {
    business_xray:   { labelPt: "Raio X Empresarial", labelEn: "Business X-Ray" },
    management_xray: { labelPt: "Raio X de Gestão",  labelEn: "Management X-Ray" },
    leadership_xray: { labelPt: "Raio X Nível de Liderança", labelEn: "Leadership Level X-Ray" },
    permissividade_xray: { labelPt: "Raio X de Permissividade", labelEn: "Permissiveness X-Ray" },
    falhas_xray: { labelPt: "Raio X Falhas", labelEn: "Failures X-Ray" },
    feedback_360: { labelPt: "Feedback 360º", labelEn: "360º Feedback" },
    pilares_crescimento: { labelPt: "Pilares de Crescimento", labelEn: "Growth Pillars" }
};

// Answer scales. A catalog declares which one it uses and EVERY generic path
// (merge/validation, answered-count, portal rendering) keys off this — never
// off the type string. A third assessment type only needs a new entry here.
//   coerceBool: legacy true/false payloads collapse to 1/0 (binary only).
var ASSESSMENT_SCALES = {
    binary:  { type: "binary",  values: [0, 1],    coerceBool: true },
    ternary: { type: "ternary", values: [0, 1, 2], coerceBool: false },
    // 0-10 rating. Same descriptor contract as the two above, so the merge
    // loop, answered-count and the portal widget pick it up with no branch —
    // only the button count changes (11 instead of 3).
    scale0to10: { type: "scale0to10", values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], coerceBool: false }
};

// ---------------------------------------------------------------------------
// 0-10 banding — shared by every scale0to10 instrument. Three tiers:
//   0-3 Crítico (vermelho) · 4-7 Atenção (amarelo) · 8-10 Adequado (verde)
// `inverted` flips the MEANING without moving the cutoffs: on the Falhas
// instrument a high answer means the failure is strongly present, so 8-10 is
// the critical end. The numeric boundaries stay in ONE place either way.
// ---------------------------------------------------------------------------
var SCALE10_BANDS = {
    verde:    { key: "verde",    color: "success", hex: "#28a745",
                labelPt: "Adequado", labelEn: "Adequate" },
    amarelo:  { key: "amarelo",  color: "warning", hex: "#ffc107",
                labelPt: "Atenção",  labelEn: "Attention" },
    vermelho: { key: "vermelho", color: "danger",  hex: "#dc3545",
                labelPt: "Crítico",  labelEn: "Critical" }
};

var SCALE10_UNANSWERED_HEX = "#c9cbcf";

// Band a single 0-10 answer. Returns null when unanswered so callers can
// count "não respondidas" separately rather than defaulting to a real band.
function scale10Band(v, inverted) {
    if (typeof v !== "number" || v < 0 || v > 10) { return null; }
    var low = inverted ? SCALE10_BANDS.verde : SCALE10_BANDS.vermelho;
    var high = inverted ? SCALE10_BANDS.vermelho : SCALE10_BANDS.verde;
    if (v <= 3) { return low; }
    if (v <= 7) { return SCALE10_BANDS.amarelo; }
    return high;
}

// Chart bar colour for a raw 0-10 value, using the same cutoffs.
function scale10Hex(v, inverted) {
    var b = scale10Band(v, inverted);
    return b ? b.hex : SCALE10_UNANSWERED_HEX;
}

// Count answers per band across a question list. `inverted` is passed through
// so a Falhas-style instrument reports its counts the right way round.
function scale10Distribution(questions, answers, inverted) {
    var dist = { verde: 0, amarelo: 0, vermelho: 0, nao_respondido: 0, total: questions.length };
    questions.forEach(function(q) {
        var b = scale10Band(answers[q.key], inverted);
        if (b) { dist[b.key] += 1; } else { dist.nao_respondido += 1; }
    });
    return dist;
}

// The ONLY assessment type wired into the lead pipeline. The two "Raio X"
// lead stages ("Raio X enviado" / "Raio X recebido") mean the Business X-Ray
// specifically, so this is an allowlist, not a denylist: a newly added
// instrument never touches a prospect's CRM stage unless it is named here.
var LEAD_STAGE_ASSESSMENT_TYPES = ["business_xray"];

function assessmentAdvancesLeadStage(type) {
    return LEAD_STAGE_ASSESSMENT_TYPES.indexOf(type) > -1;
}

var XRAY_AREAS = [
    { key: "identidade_cultura",  namePt: "Identidade e Cultura",   nameEn: "Identity & Culture" },
    { key: "estrategia",          namePt: "Estratégia",        nameEn: "Strategy" },
    { key: "processos",           namePt: "Processos",              nameEn: "Processes" },
    { key: "pessoas",             namePt: "Pessoas",                nameEn: "People" },
    { key: "comercial_marketing", namePt: "Comercial e Marketing",  nameEn: "Sales & Marketing" },
    { key: "resultados",          namePt: "Resultados",             nameEn: "Results" }
];

// Every question is a plain Sim/Não. "Sim" = 1 point, raw score out of 62.
var XRAY_QUESTIONS = [
    // I — Identidade e Cultura (12)
    { key: "missao_visao_valores",   area: "identidade_cultura", labelPt: "A empresa possui missão, visão e valores definidos e comunicados a toda a equipe?", labelEn: "Does the company have mission, vision and values defined and communicated to the whole team?" },
    { key: "equipe_vive_valores",    area: "identidade_cultura", labelPt: "A equipe conhece e pratica os valores da empresa no dia a dia?", labelEn: "Does the team know and live the company's values day to day?" },
    { key: "codigo_etica",           area: "identidade_cultura", labelPt: "Existe um código de ética ou de conduta formalizado?", labelEn: "Is there a formal code of ethics or conduct?" },
    { key: "identidade_visual",      area: "identidade_cultura", labelPt: "A identidade visual da empresa é padronizada (logotipo, cores, materiais)?", labelEn: "Is the company's visual identity standardized (logo, colors, materials)?" },
    { key: "rituais_cultura",        area: "identidade_cultura", labelPt: "Existem rituais que reforçam a cultura (reuniões, celebrações, integrações)?", labelEn: "Are there rituals that reinforce the culture (meetings, celebrations, team events)?" },
    { key: "onboarding",             area: "identidade_cultura", labelPt: "Há um programa de integração (onboarding) para novos colaboradores?", labelEn: "Is there an onboarding program for new hires?" ,
      helpPt: "Onboarding é como um novo funcionário aprende o trabalho nos primeiros dias: quem mostra como fazer, o que explicar, o que entregar. Mesmo algo simples e combinado conta.",
      helpEn: "Onboarding is how a new hire learns the job in their first days: who shows them the ropes, what gets explained, what they receive. Even something simple but consistent counts." },
    { key: "clima_positivo",         area: "identidade_cultura", labelPt: "O clima organizacional é positivo e produtivo?", labelEn: "Is the organizational climate positive and productive?" ,
      helpPt: "Clima organizacional é o ambiente entre as pessoas no dia a dia: se a equipe trabalha bem junta, sem conflito constante e sem gente desmotivada.",
      helpEn: "Organizational climate is the day-to-day mood between people: whether the team works well together, without constant conflict or unmotivated people." },
    { key: "reconhecimento",         area: "identidade_cultura", labelPt: "Existe um programa de reconhecimento e valorização dos colaboradores?", labelEn: "Is there an employee recognition and appreciation program?" },
    { key: "responsabilidade_social",area: "identidade_cultura", labelPt: "A empresa desenvolve ações de responsabilidade social ou ambiental?", labelEn: "Does the company carry out social or environmental responsibility initiatives?" },
    { key: "comunicacao_interna",    area: "identidade_cultura", labelPt: "A comunicação interna é transparente e chega a todos?", labelEn: "Is internal communication transparent and reaching everyone?" },
    { key: "orgulho_pertencimento",  area: "identidade_cultura", labelPt: "Os colaboradores demonstram orgulho e senso de pertencimento?", labelEn: "Do employees show pride and a sense of belonging?" },
    { key: "sucessao_lideranca",     area: "identidade_cultura", labelPt: "Existe um plano de sucessão e de desenvolvimento de lideranças?", labelEn: "Is there a succession and leadership development plan?" ,
      helpPt: "Plano de sucessão significa: se você ou uma pessoa-chave sair ou se afastar amanhã, já está claro quem assume e essa pessoa está sendo preparada.",
      helpEn: "A succession plan means: if you or a key person left or stepped away tomorrow, it's already clear who takes over and that person is being prepared." },
    // II — Estratégia (6)
    { key: "plano_estrategico",      area: "estrategia", labelPt: "A empresa possui um planejamento estratégico formalizado?", labelEn: "Does the company have a formal strategic plan?" ,
      helpPt: "Um plano escrito de onde a empresa quer chegar (ex.: em 1-3 anos) e como — não precisa ser um documento sofisticado, mas precisa estar no papel, não só na cabeça.",
      helpEn: "A written plan of where the business wants to go (e.g. in 1-3 years) and how — it doesn't need to be a fancy document, but it needs to be on paper, not just in your head." },
    { key: "plano_acao_metas",       area: "estrategia", labelPt: "Existe um plano de ação com metas, responsáveis e prazos definidos?", labelEn: "Is there an action plan with goals, owners and deadlines?" },
    { key: "revisao_periodica",      area: "estrategia", labelPt: "O planejamento é revisado periodicamente?", labelEn: "Is the plan reviewed periodically?" },
    { key: "objetivos_conhecidos",   area: "estrategia", labelPt: "A equipe conhece os objetivos estratégicos da empresa?", labelEn: "Does the team know the company's strategic objectives?" },
    { key: "analise_mercado",        area: "estrategia", labelPt: "A empresa analisa regularmente o mercado e a concorrência?", labelEn: "Does the company regularly analyze the market and competitors?" },
    { key: "inovacao_melhoria",      area: "estrategia", labelPt: "Existe um processo de inovação ou de melhoria contínua?", labelEn: "Is there an innovation or continuous-improvement process?" },
    // III — Processos (3)
    { key: "processos_mapeados",     area: "processos", labelPt: "Os processos-chave da empresa estão mapeados e documentados?", labelEn: "Are the company's key processes mapped and documented?" },
    { key: "indicadores_processos",  area: "processos", labelPt: "Existem indicadores de desempenho para monitorar os processos?", labelEn: "Are there performance indicators to monitor the processes?" ,
      helpPt: "Números que você acompanha para saber se o trabalho vai bem — ex.: obras entregues no prazo, orçamentos enviados por semana, retrabalho. Não precisa de sistema, precisa de acompanhamento.",
      helpEn: "Numbers you track to know whether the work is going well — e.g. jobs delivered on time, quotes sent per week, rework. It doesn't require software, it requires tracking." },
    { key: "automacao_tecnologia",   area: "processos", labelPt: "A empresa usa tecnologia para automatizar processos manuais?", labelEn: "Does the company use technology to automate manual processes?" },
    // IV — Pessoas (18)
    { key: "organograma_atualizado", area: "pessoas", labelPt: "A empresa possui um organograma atualizado?", labelEn: "Does the company have an up-to-date org chart?" ,
      helpPt: "Organograma é um desenho simples de quem responde a quem na empresa — quem manda em quê, quem procura quem quando algo dá errado.",
      helpEn: "An org chart is a simple drawing of who reports to whom — who owns what, who to go to when something goes wrong." },
    { key: "descricoes_cargos",      area: "pessoas", labelPt: "Existem descrições de cargo claras para cada função?", labelEn: "Are there clear job descriptions for every role?" },
    { key: "recrutamento_estruturado", area: "pessoas", labelPt: "O processo de recrutamento e seleção é estruturado?", labelEn: "Is the hiring process structured?" },
    { key: "treinamento_desenvolvimento", area: "pessoas", labelPt: "Existe um plano de treinamento e desenvolvimento da equipe?", labelEn: "Is there a team training and development plan?" },
    { key: "avaliacao_desempenho",   area: "pessoas", labelPt: "São realizadas avaliações de desempenho regulares?", labelEn: "Are regular performance reviews carried out?" },
    { key: "plano_carreira",         area: "pessoas", labelPt: "Existe um plano de carreira definido para os colaboradores?", labelEn: "Is there a defined career path for employees?" },
    { key: "remuneracao_competitiva",area: "pessoas", labelPt: "A remuneração e os benefícios são competitivos no mercado?", labelEn: "Are pay and benefits competitive in the market?" },
    { key: "programa_bem_estar",     area: "pessoas", labelPt: "Existe um programa de bem-estar e qualidade de vida?", labelEn: "Is there a wellness and quality-of-life program?" },
    { key: "feedback_comunicacao",   area: "pessoas", labelPt: "Existe um programa estruturado de feedback e comunicação com a equipe?", labelEn: "Is there a structured feedback and communication program for the team?" },
    { key: "seguranca_trabalho",     area: "pessoas", labelPt: "A empresa mantém comissão ou práticas ativas de segurança do trabalho?", labelEn: "Does the company maintain an active workplace-safety committee or practices?" },
    { key: "pesquisa_clima",         area: "pessoas", labelPt: "São aplicadas pesquisas de clima organizacional regularmente?", labelEn: "Are climate surveys run regularly?" ,
      helpPt: "Perguntar à equipe, de forma organizada e periódica (mesmo que num formulário simples), como está o ambiente de trabalho e o que incomoda.",
      helpEn: "Asking the team, in an organized and recurring way (even a simple form), how the work environment feels and what bothers them." },
    { key: "retencao_talentos",      area: "pessoas", labelPt: "Existe um programa de retenção de talentos?", labelEn: "Is there a talent retention program?" },
    { key: "sucessao_cargos_chave",  area: "pessoas", labelPt: "Há plano de sucessão para os cargos-chave?", labelEn: "Is there a succession plan for key roles?" ,
      helpPt: "Para cada função que pararia a empresa se a pessoa saísse, já existe alguém preparado (ou sendo preparado) para assumir.",
      helpEn: "For every role that would stop the business if the person left, someone is already prepared (or being prepared) to take over." },
    { key: "politica_hibrido_remoto",area: "pessoas", labelPt: "Existe uma política clara de trabalho híbrido ou remoto?", labelEn: "Is there a clear hybrid/remote work policy?" },
    { key: "diversidade_inclusao",   area: "pessoas", labelPt: "A empresa possui um programa de diversidade e inclusão?", labelEn: "Does the company have a diversity and inclusion program?" },
    { key: "crescimento_interno",    area: "pessoas", labelPt: "Existem oportunidades reais de crescimento interno?", labelEn: "Are there real internal growth opportunities?" },
    { key: "investimento_lideranca", area: "pessoas", labelPt: "A empresa investe no desenvolvimento de suas lideranças?", labelEn: "Does the company invest in developing its leaders?" },
    { key: "estagio_trainee",        area: "pessoas", labelPt: "Existe um programa estruturado de estágio ou trainee?", labelEn: "Is there a structured internship or trainee program?" },
    // V — Comercial e Marketing (6)
    { key: "plano_marketing",        area: "comercial_marketing", labelPt: "A empresa possui um plano de marketing anual?", labelEn: "Does the company have an annual marketing plan?" },
    { key: "processo_vendas",        area: "comercial_marketing", labelPt: "O processo de prospecção e vendas é estruturado?", labelEn: "Is the prospecting and sales process structured?" ,
      helpPt: "Prospecção é buscar clientes ativamente em vez de só esperar chegarem. Estruturado significa: os mesmos passos sempre, do primeiro contato até fechar (ou perder) o negócio.",
      helpEn: "Prospecting is actively going after customers instead of only waiting for them to show up. Structured means: the same steps every time, from first contact to closing (or losing) the deal." },
    { key: "crm_implementado",       area: "comercial_marketing", labelPt: "A empresa utiliza um CRM implementado?", labelEn: "Does the company use an implemented CRM?" ,
      helpPt: "CRM é um sistema ou aplicativo onde ficam registrados os contatos, orçamentos e negociações com cada cliente — em vez de caderno, memória ou só o WhatsApp.",
      helpEn: "A CRM is a system or app where contacts, quotes and negotiations with each customer are recorded — instead of a notebook, memory, or just WhatsApp." },
    { key: "pesquisa_satisfacao",    area: "comercial_marketing", labelPt: "São realizadas pesquisas de satisfação com os clientes?", labelEn: "Are customer satisfaction surveys carried out?" },
    { key: "programa_fidelizacao",   area: "comercial_marketing", labelPt: "Existe um programa de fidelização de clientes?", labelEn: "Is there a customer loyalty program?" },
    { key: "redes_sociais",          area: "comercial_marketing", labelPt: "A empresa mantém presença ativa nas redes sociais?", labelEn: "Does the company maintain an active social media presence?" },
    // VI — Resultados (17)
    { key: "metas_financeiras",      area: "resultados", labelPt: "A empresa atinge regularmente suas metas financeiras?", labelEn: "Does the company regularly meet its financial goals?" },
    { key: "controle_financeiro",    area: "resultados", labelPt: "O controle financeiro é rigoroso e atualizado?", labelEn: "Is financial control rigorous and up to date?" },
    { key: "gestao_custos",          area: "resultados", labelPt: "Existe um sistema eficiente de gestão de custos?", labelEn: "Is there an efficient cost-management system?" },
    { key: "reservas_emergencia",    area: "resultados", labelPt: "A empresa possui reservas financeiras de emergência?", labelEn: "Does the company have financial emergency reserves?" },
    { key: "crescimento_receita",    area: "resultados", labelPt: "A receita cresce de forma sustentável?", labelEn: "Is revenue growing sustainably?" },
    { key: "margens_saudaveis",      area: "resultados", labelPt: "As margens de lucro são saudáveis?", labelEn: "Are profit margins healthy?" },
    { key: "contas_receber_pagar",   area: "resultados", labelPt: "O controle de contas a receber e a pagar é eficaz?", labelEn: "Is AR/AP control effective?" ,
      helpPt: "Saber exatamente quem ainda vai te pagar (e quando) e o que você ainda deve a fornecedores (e quando vence) — sem depender da memória.",
      helpEn: "Knowing exactly who still owes you (and when) and what you still owe suppliers (and when it's due) — without relying on memory." },
    { key: "planejamento_tributario",area: "resultados", labelPt: "O planejamento tributário é otimizado?", labelEn: "Is tax planning optimized?" ,
      helpPt: "Organizar os impostos com o contador para pagar o mínimo permitido por lei e sem sustos — em vez de só pagar as guias que chegam.",
      helpEn: "Working with your accountant to legally pay the minimum tax possible and avoid surprises — instead of just paying whatever bills arrive." },
    { key: "indicadores_produtividade", area: "resultados", labelPt: "Os indicadores de produtividade são monitorados?", labelEn: "Are productivity indicators monitored?" ,
      helpPt: "Números que mostram quanto a equipe produz — ex.: metros quadrados instalados por semana, obras concluídas por mês, horas por serviço.",
      helpEn: "Numbers that show how much the team produces — e.g. square feet installed per week, jobs finished per month, hours per job." },
    { key: "gestao_qualidade",       area: "resultados", labelPt: "Existe um sistema de gestão da qualidade?", labelEn: "Is there a quality management system?" },
    { key: "certificacoes_qualidade",area: "resultados", labelPt: "A empresa possui certificações ou selos de qualidade?", labelEn: "Does the company hold quality certifications or seals?" },
    { key: "benchmarking",           area: "resultados", labelPt: "É feito benchmarking com os concorrentes?", labelEn: "Is competitor benchmarking carried out?" ,
      helpPt: "Benchmarking é comparar sua empresa com os concorrentes de propósito: preços, prazos, qualidade, presença online — para saber onde você está na frente ou atrás.",
      helpEn: "Benchmarking is deliberately comparing your business to competitors: prices, lead times, quality, online presence — to know where you're ahead or behind." },
    { key: "gestao_projetos",        area: "resultados", labelPt: "Existe um sistema de gestão de projetos?", labelEn: "Is there a project management system?" },
    { key: "investimento_pd",        area: "resultados", labelPt: "A empresa investe em pesquisa e desenvolvimento?", labelEn: "Does the company invest in R&D?" ,
      helpPt: "Pesquisa e desenvolvimento (P&D) aqui significa testar novos métodos, materiais ou formas de trabalhar — não precisa ser laboratório nem verba formal de pesquisa.",
      helpEn: "R&D here means trying new methods, materials or ways of working — it doesn't require a lab or a formal research budget." },
    { key: "gestao_ambiental",       area: "resultados", labelPt: "Existe um sistema de gestão ambiental?", labelEn: "Is there an environmental management system?" },
    { key: "continuidade_negocios",  area: "resultados", labelPt: "Existe um plano de continuidade de negócios?", labelEn: "Is there a business continuity plan?" ,
      helpPt: "Se algo grande der errado (você doente, equipamento parado, cliente principal saindo), já está pensado como a empresa continua rodando?",
      helpEn: "If something big goes wrong (you get sick, equipment breaks down, your main customer leaves), is there already a plan for how the business keeps running?" },
    { key: "gestao_riscos",          area: "resultados", labelPt: "Existe um sistema de gestão de riscos?", labelEn: "Is there a risk management system?" }
];

// Per-area recommended actions for the Plano de Ação Prioritário.
// "fix" = weak/moderate areas; "replicate" = genuinely strong areas
// (REPLICAÇÃO — document and replicate what already works, deliberate).
var XRAY_ACTION_PLANS = {
    identidade_cultura: {
        fix: [
            { pt: "Formalizar e comunicar missão, visão e valores em reunião geral", en: "Formalize and communicate mission, vision and values in an all-hands meeting" },
            { pt: "Criar código de conduta e programa de integração para novos colaboradores", en: "Create a code of conduct and an onboarding program for new hires" },
            { pt: "Implantar ritual mensal de reconhecimento e comunicação interna", en: "Establish a monthly recognition and internal-communication ritual" },
            { pt: "Aplicar pesquisa de clima simples e definir plano de resposta", en: "Run a simple climate survey and define a response plan" }
        ],
        replicate: [
            { pt: "Documentar os rituais de cultura que já funcionam", en: "Document the culture rituals that already work" },
            { pt: "Transformar o onboarding atual em manual replicável", en: "Turn the current onboarding into a replicable playbook" },
            { pt: "Registrar depoimentos da equipe para fortalecer a marca empregadora", en: "Capture team testimonials to strengthen the employer brand" }
        ]
    },
    estrategia: {
        fix: [
            { pt: "Elaborar plano estratégico anual com metas, responsáveis e prazos", en: "Build an annual strategic plan with goals, owners and deadlines" },
            { pt: "Instituir reunião mensal de revisão do plano de ação", en: "Institute a monthly action-plan review meeting" },
            { pt: "Comunicar os objetivos estratégicos a toda a equipe", en: "Communicate the strategic objectives to the whole team" },
            { pt: "Mapear concorrentes diretos e monitorar trimestralmente", en: "Map direct competitors and monitor them quarterly" }
        ],
        replicate: [
            { pt: "Documentar o processo de planejamento que já funciona", en: "Document the planning process that already works" },
            { pt: "Padronizar o modelo de revisão periódica para replicar em novas áreas", en: "Standardize the periodic-review model to replicate in new areas" },
            { pt: "Compartilhar aprendizados de mercado com toda a equipe", en: "Share market learnings with the whole team" }
        ]
    },
    processos: {
        fix: [
            { pt: "Mapear e documentar os 3 processos mais críticos da operação", en: "Map and document the 3 most critical processes of the operation" },
            { pt: "Definir 1-2 indicadores de desempenho por processo-chave", en: "Define 1-2 performance indicators per key process" },
            { pt: "Automatizar a tarefa manual mais repetitiva com tecnologia acessível", en: "Automate the most repetitive manual task with accessible technology" }
        ],
        replicate: [
            { pt: "Consolidar a documentação de processos em repositório único", en: "Consolidate process documentation into a single repository" },
            { pt: "Treinar a equipe para manter os indicadores atualizados", en: "Train the team to keep the indicators up to date" },
            { pt: "Replicar o padrão de automação para os demais setores", en: "Replicate the automation pattern to the remaining departments" }
        ]
    },
    pessoas: {
        fix: [
            { pt: "Atualizar organograma e descrições de cargo", en: "Update the org chart and job descriptions" },
            { pt: "Estruturar processo seletivo e trilha de treinamento", en: "Structure the hiring process and a training track" },
            { pt: "Implantar avaliação de desempenho com feedback semestral", en: "Implement performance reviews with twice-yearly feedback" },
            { pt: "Definir plano de carreira e ações de retenção de talentos", en: "Define a career path and talent-retention actions" }
        ],
        replicate: [
            { pt: "Documentar as práticas de gestão de pessoas que já funcionam", en: "Document the people-management practices that already work" },
            { pt: "Formar multiplicadores internos de treinamento", en: "Develop internal training multipliers" },
            { pt: "Padronizar o processo seletivo para replicar em novas vagas", en: "Standardize the hiring process to replicate for new openings" }
        ]
    },
    comercial_marketing: {
        fix: [
            { pt: "Criar plano de marketing anual com calendário de ações", en: "Create an annual marketing plan with an action calendar" },
            { pt: "Estruturar funil de vendas e implantar CRM", en: "Structure the sales funnel and implement a CRM" },
            { pt: "Aplicar pesquisa de satisfação com clientes ativos", en: "Run a satisfaction survey with active customers" },
            { pt: "Ativar presença consistente nas redes sociais", en: "Activate a consistent social media presence" }
        ],
        replicate: [
            { pt: "Documentar o processo comercial que já converte", en: "Document the sales process that already converts" },
            { pt: "Transformar cases de clientes satisfeitos em material de vendas", en: "Turn satisfied-customer cases into sales material" },
            { pt: "Padronizar o playbook de prospecção para novos vendedores", en: "Standardize the prospecting playbook for new salespeople" }
        ]
    },
    resultados: {
        fix: [
            { pt: "Implantar controle financeiro com fechamento mensal", en: "Implement financial control with a monthly close" },
            { pt: "Definir metas financeiras e acompanhar semanalmente", en: "Set financial goals and track them weekly" },
            { pt: "Estruturar gestão de custos e contas a receber/pagar", en: "Structure cost management and AR/AP control" },
            { pt: "Constituir reserva de emergência e plano de gestão de riscos", en: "Build an emergency reserve and a risk-management plan" }
        ],
        replicate: [
            { pt: "Documentar a rotina financeira que já funciona", en: "Document the financial routine that already works" },
            { pt: "Formalizar benchmarking e indicadores em painel único", en: "Formalize benchmarking and indicators in a single dashboard" },
            { pt: "Replicar o modelo de gestão para novas linhas de receita", en: "Replicate the management model to new revenue lines" }
        ]
    }
};

// ---------------------------------------------------------------------------
// Part 2 — practice-profile sections (Marketing / Sistemas & IA).
// These are a PICTURE, not a grade: they never touch XRAY_QUESTIONS, the
// 62-point score, the percentage or the maturity band. Answers live in a
// separate column (client_assessments.profile_json) and computeXrayScore
// never sees them. Each activity is profiled across five dimensions:
// what is actually done / who does it / weekly time cost / observed result /
// pain point. The point is truth over box-ticking — "a monthly Instagram
// post" scores Sim on redes_sociais; the profile shows what that really is.
// ---------------------------------------------------------------------------

var XRAY_PROFILE_SECTIONS = [
    { key: "marketing_pratica", namePt: "Marketing na Prática", nameEn: "Marketing in Practice" },
    { key: "sistemas_ia",       namePt: "Sistemas e IA",        nameEn: "Business Systems & AI" }
];

// The five dimensions every activity is profiled across. 'required' drives
// completion (the two free-text reflection fields stay optional so nobody
// is forced to invent a resultado/dor that doesn't exist).
var XRAY_PROFILE_DIMENSIONS = [
    { key: "o_que",     type: "text",   required: true,
      labelPt: "O que é feito hoje? (canais, frequência, como funciona na prática)",
      labelEn: "What is done today? (channels, frequency, how it actually works)" },
    { key: "quem",      type: "choice", required: true,
      labelPt: "Quem faz?", labelEn: "Who does it?",
      options: [
        { key: "dono",       labelPt: "Eu (dono)",              labelEn: "Me (owner)" },
        { key: "funcionario",labelPt: "Funcionário",       labelEn: "Employee" },
        { key: "terceiro",   labelPt: "Agência/terceiro",  labelEn: "Agency/third party" },
        { key: "ninguem",    labelPt: "Ninguém",           labelEn: "Nobody" }
      ] },
    { key: "tempo",     type: "choice", required: true,
      labelPt: "Tempo gasto por semana", labelEn: "Time spent per week",
      options: [
        { key: "nenhum",   labelPt: "Nenhum",            labelEn: "None" },
        { key: "ate_2h",   labelPt: "Até 2h",       labelEn: "Up to 2h" },
        { key: "de_2_5h",  labelPt: "2 a 5h",            labelEn: "2 to 5h" },
        { key: "de_5_10h", labelPt: "5 a 10h",           labelEn: "5 to 10h" },
        { key: "mais_10h", labelPt: "Mais de 10h",       labelEn: "More than 10h" }
      ] },
    { key: "resultado", type: "text",   required: false,
      labelPt: "Que resultado você percebe? (opcional)",
      labelEn: "What result do you observe? (optional)" },
    { key: "dor",       type: "text",   required: false,
      labelPt: "Onde isso trava ou dói hoje? (opcional)",
      labelEn: "Where does it hurt or get stuck today? (optional)" }
];

// Marketing activities are derived from what Rafa already tracks:
// area V (comercial_marketing) questions + the Daily Log marketing
// indicators — not a generic checklist. Source of each item:
//   redes_sociais_pratica   ← Q redes_sociais + Daily Log post_publicado/story/video_curto
//   prospeccao_pratica      ← Q processo_vendas + Daily Log leads_gerados/contatos_estrategicos/envio_propostas
//   crm_followup_pratica    ← Q crm_implementado + Daily Log retomadas_cliente/pipeline_ativo
//   avaliacoes_pratica      ← Daily Log google_review + Q pesquisa_satisfacao
//   fidelizacao_pratica     ← Q programa_fidelizacao + Daily Log visitas_estrategicas/interacoes_estrategicas
//   plano_marketing_pratica ← Q plano_marketing
var XRAY_PROFILE_ACTIVITIES = [
    { key: "redes_sociais_pratica",   section: "marketing_pratica",
      labelPt: "Redes sociais (posts, stories, vídeos curtos)",
      labelEn: "Social media (posts, stories, short videos)" },
    { key: "prospeccao_pratica",      section: "marketing_pratica",
      labelPt: "Prospecção e geração de leads",
      labelEn: "Prospecting and lead generation",
      helpPt: "Leads são pessoas interessadas que ainda não fecharam. Prospecção é como você as encontra: anúncios, indicações, porta a porta, redes sociais.",
      helpEn: "Leads are interested people who haven't closed yet. Prospecting is how you find them: ads, referrals, door-to-door, social media." },
    { key: "crm_followup_pratica",    section: "marketing_pratica",
      labelPt: "CRM e acompanhamento de clientes (follow-up, pipeline)",
      labelEn: "CRM and client follow-up (pipeline)",
      helpPt: "CRM é onde as negociações ficam registradas; follow-up é retomar contato com quem recebeu orçamento; pipeline é a lista de negociações em andamento.",
      helpEn: "A CRM is where negotiations are recorded; follow-up is circling back with people who got a quote; the pipeline is your list of deals in progress." },
    { key: "avaliacoes_pratica",      section: "marketing_pratica",
      labelPt: "Avaliações e reputação online (Google Reviews, satisfação)",
      labelEn: "Reviews and online reputation (Google Reviews, satisfaction)" },
    { key: "fidelizacao_pratica",     section: "marketing_pratica",
      labelPt: "Fidelização e relacionamento com clientes atuais",
      labelEn: "Loyalty and relationships with current clients" },
    { key: "plano_marketing_pratica", section: "marketing_pratica",
      labelPt: "Planejamento e calendário de marketing",
      labelEn: "Marketing planning and calendar" },
    { key: "controle_financeiro_op",  section: "sistemas_ia",
      labelPt: "Controle financeiro do dia a dia (onde e como registra receitas e saídas)",
      labelEn: "Day-to-day financial control (where and how revenue and expenses are recorded)" },
    { key: "atendimento_comunicacao", section: "sistemas_ia",
      labelPt: "Atendimento e comunicação com clientes (canais, quem responde)",
      labelEn: "Client service and communication (channels, who answers)" },
    { key: "agenda_tarefas",          section: "sistemas_ia",
      labelPt: "Agenda, tarefas e compromissos da equipe",
      labelEn: "Team schedule, tasks and commitments" },
    { key: "dados_clientes",          section: "sistemas_ia",
      labelPt: "Cadastro e informações de clientes (onde os dados vivem)",
      labelEn: "Client records and information (where the data lives)" },
    { key: "tarefas_repetitivas",     section: "sistemas_ia",
      labelPt: "Tarefas repetitivas feitas manualmente (o que consome tempo toda semana)",
      labelEn: "Repetitive tasks done by hand (what eats time every week)" },
    { key: "uso_ia",                  section: "sistemas_ia",
      labelPt: "Uso atual de IA e automação (o que já usa hoje, mesmo que pouco)",
      labelEn: "Current use of AI and automation (whatever is used today, even a little)" }
];

// Every catalog declares its `scale`; the generic answer paths (merge,
// answered-count, portal rendering) read it instead of branching on the type.
// `layout` tells the portal which flow to render: the 62-question bank needs
// the multi-section wizard, an 11-question one fits on a single page.
function assessmentCatalog(type) {
    if (type === "business_xray") {
        return {
            assessment_type: "business_xray",
            scale: ASSESSMENT_SCALES.binary,
            layout: "sections",
            areas: XRAY_AREAS, questions: XRAY_QUESTIONS, total: XRAY_QUESTIONS.length,
            profile_sections: XRAY_PROFILE_SECTIONS,
            profile_activities: XRAY_PROFILE_ACTIVITIES,
            profile_dimensions: XRAY_PROFILE_DIMENSIONS
        };
    }
    if (type === "management_xray") {
        // Category === question: the same rows are exposed under `questions`
        // (what the generic answer paths iterate) and `categories` (what the
        // report reads), so nothing downstream needs a special case.
        return {
            assessment_type: "management_xray",
            scale: ASSESSMENT_SCALES.ternary,
            layout: "single_page",
            categories: MGMT_CATEGORIES,
            questions: MGMT_CATEGORIES,
            total: MGMT_CATEGORIES.length,
            max_score: mgmtMaxScore(),
            scale_levels: MGMT_SCALE_LEVELS
        };
    }
    if (type === "leadership_xray") {
        // Same category === question shape as the Management X-Ray, on a 0-10
        // scale. `scale10_bands` lets the portal colour the 11 buttons from
        // the same cutoffs the Worker scores with — never a second copy.
        return {
            assessment_type: "leadership_xray",
            scale: ASSESSMENT_SCALES.scale0to10,
            layout: "single_page",
            categories: LEAD_QUESTIONS,
            questions: LEAD_QUESTIONS,
            total: LEAD_QUESTIONS.length,
            scale10_bands: scale10BandLegend(false)
        };
    }
    if (type === "permissividade_xray") {
        return {
            assessment_type: "permissividade_xray",
            scale: ASSESSMENT_SCALES.scale0to10,
            layout: "single_page",
            categories: PERM_QUESTIONS,
            questions: PERM_QUESTIONS,
            total: PERM_QUESTIONS.length,
            scale10_bands: scale10BandLegend(false)
        };
    }
    if (type === "falhas_xray") {
        // INVERTED: a high answer means the failure is strongly present, so
        // the legend is built the other way round and the portal's rating row
        // colours 8-10 red instead of green. `groups` drives the grouped
        // rendering in both the questionnaire and the report.
        return {
            assessment_type: "falhas_xray",
            scale: ASSESSMENT_SCALES.scale0to10,
            layout: "single_page",
            inverted: true,
            groups: FALHAS_GROUPS,
            categories: FALHAS_QUESTIONS,
            questions: FALHAS_QUESTIONS,
            total: FALHAS_QUESTIONS.length,
            scale10_bands: scale10BandLegend(true)
        };
    }
    // Perception surveys (Feedback 360º, Pilares de Crescimento): 7 Sim/Não
    // questions each, same shape, so they share one catalog branch. The scale
    // is the SAME binary descriptor the Business X-Ray uses.
    if (PERCEPTION_SPECS[type]) {
        var spec = PERCEPTION_SPECS[type];
        return {
            assessment_type: type,
            scale: ASSESSMENT_SCALES.binary,
            layout: "single_page",
            categories: spec.questions,
            questions: spec.questions,
            total: spec.questions.length,
            binary_levels: PERCEPTION_BINARY_LEVELS
        };
    }
    return null;
}

// The three 0-10 bands as a portal-renderable legend (low → high), so the
// questionnaire UI reads its colours from the same cutoffs as the scoring.
function scale10BandLegend(inverted) {
    return [0, 4, 8].map(function(v) {
        var b = scale10Band(v, inverted);
        return { from: v, to: (v === 0 ? 3 : (v === 4 ? 7 : 10)),
                 key: b.key, color: b.color, hex: b.hex,
                 labelPt: b.labelPt, labelEn: b.labelEn };
    });
}

// True when `v` is one of the values the catalog's scale declares.
function assessmentScaleAccepts(catalog, v) {
    var scale = catalog && catalog.scale;
    if (!scale) { return false; }
    return scale.values.indexOf(v) > -1;
}

// ---------------------------------------------------------------------------
// Band cutoffs — the ONLY place these numbers live. Everything downstream
// (portal, report) keys off the computed labels, never off raw numbers.
//   maturity: pct >= alta → Alta; pct >= media → Média; else Baixa
//   area:     pct >= bom → Bom; >= moderado → Moderado; >= atencao → Atenção;
//             else Crítico
//
// MATURITY (confirmed): from Pr. Rafa's own scoring page for the Business
// X-Ray, converted — not guessed — onto Apex's scale. Two differences had to
// be reconciled:
//   1. Ceiling: his page tops out at 42, ours at 62 questions. His bands are
//      therefore read as proportions of his own ceiling, not as raw counts.
//   2. Polarity: he scores 1 point per "não" (higher = worse); computeXrayScore
//      scores 1 point per "sim" (higher = better). The inversion below is
//      deliberate — a raw copy of his numbers would band every client
//      backwards.
//   His Good 0–18 = 0–43% of 42, Medium 19–31 = 45–74%, Urgent 29–42 = 69–100%.
//   Inverted onto percentage-of-"sim": Alta ≥ 57, Média 26–56, Baixa < 26.
//   (43%/74% land within rounding of the old 41/71 placeholders, which is why
//   the ceiling difference is not a blocker.)
//   CAVEAT: his source document contradicts itself — medium is 19–31 while
//   urgent starts at 29, so 29/30/31 fall in both bands. This conversion reads
//   medium as ending at 28. Revisit if Rafa ever clarifies that overlap.
//
// AREA (still placeholder): invented pending the consultant's real thresholds.
// Rafa's page addresses the overall result only and says nothing about
// per-area bands, so these remain unconfirmed.
// ---------------------------------------------------------------------------
var XRAY_CUTOFFS = {
    maturity: { alta: 57, media: 26 },
    area:     { bom: 80, moderado: 60, atencao: 40 }
};

// Per-area 4-tier status from the area's percentage of "Sim" answers.
function xrayAreaStatus(pct) {
    if (pct >= XRAY_CUTOFFS.area.bom)      { return "Bom"; }
    if (pct >= XRAY_CUTOFFS.area.moderado) { return "Moderado"; }
    if (pct >= XRAY_CUTOFFS.area.atencao)  { return "Atenção"; }
    return "Crítico";
}

// Pure scoring engine — answers is a flat { question_key: 0|1 } map.
// Returns the full structured result; NO rendering and NO narrative here
// (an AI narrative layer can consume this output later).
function computeXrayScore(answers) {
    answers = answers || {};
    var total = XRAY_QUESTIONS.length;
    var score = 0;
    var areaAgg = {};
    XRAY_AREAS.forEach(function(a) { areaAgg[a.key] = { score: 0, count: 0 }; });
    XRAY_QUESTIONS.forEach(function(q) {
        areaAgg[q.area].count += 1;
        if (answers[q.key] === 1) { score += 1; areaAgg[q.area].score += 1; }
    });
    var pct = Math.round((score / total) * 100);

    // Maturity band over the raw score (cutoffs live in XRAY_CUTOFFS only).
    var maturity;
    if (pct >= XRAY_CUTOFFS.maturity.alta)       { maturity = { level: "alta",  labelPt: "Alta",  labelEn: "High" }; }
    else if (pct >= XRAY_CUTOFFS.maturity.media) { maturity = { level: "media", labelPt: "Média", labelEn: "Medium" }; }
    else                                         { maturity = { level: "baixa", labelPt: "Baixa", labelEn: "Low" }; }

    // Per-area status + three-bucket classification.
    var STATUS_META = {
        "Bom":              { rank: 3, bucket: "fortes",   tag: "REPLICAÇÃO", timeframePt: "3 meses",   timeframeEn: "3 months" },
        "Moderado":         { rank: 2, bucket: "atencao",  tag: "MELHORIA",            timeframePt: "6 semanas", timeframeEn: "6 weeks" },
        "Atenção":{ rank: 1, bucket: "atencao",  tag: "MELHORIA",            timeframePt: "1 mês", timeframeEn: "1 month" },
        "Crítico":     { rank: 0, bucket: "criticos", tag: "URGENTE",             timeframePt: "2 semanas", timeframeEn: "2 weeks" }
    };
    var areas = [];
    var buckets = { fortes: [], atencao: [], criticos: [] };
    XRAY_AREAS.forEach(function(a) {
        var agg = areaAgg[a.key];
        var areaPct = agg.count ? Math.round((agg.score / agg.count) * 100) : 0;
        var status = xrayAreaStatus(areaPct);
        var bucketNames = {
            fortes:   { pt: "Pontos Fortes",       en: "Strengths" },
            atencao:  { pt: "Pontos de Atenção", en: "Attention Points" },
            criticos: { pt: "Pontos Críticos", en: "Critical Points" }
        };
        var bucket = STATUS_META[status].bucket;
        areas.push({
            key: a.key, namePt: a.namePt, nameEn: a.nameEn,
            score: agg.score, count: agg.count,
            fraction: agg.score + "/" + agg.count, pct: areaPct,
            status: status, bucket: bucket,
            bucketLabelPt: bucketNames[bucket].pt, bucketLabelEn: bucketNames[bucket].en
        });
        buckets[bucket].push(a.key);
    });

    // Plano de Ação Prioritário — one ranked card per area, worst first.
    // Strong areas keep the deliberate REPLICAÇÃO tag: document and
    // replicate what already works instead of fixing anything.
    var ranked = areas.slice().sort(function(x, y) {
        var rx = STATUS_META[x.status].rank, ry = STATUS_META[y.status].rank;
        if (rx !== ry) { return rx - ry; }
        return x.pct - y.pct;
    });
    var actionPlan = ranked.map(function(area, i) {
        var meta = STATUS_META[area.status];
        var variant = (area.status === "Bom") ? "replicate" : "fix";
        var actions = XRAY_ACTION_PLANS[area.key][variant];
        var target = Math.ceil(area.count * 0.8);
        var criterioPt, criterioEn;
        if (variant === "replicate") {
            criterioPt = "Manter pelo menos " + target + "/" + area.count + " respostas Sim (80%) e documentar as práticas replicáveis";
            criterioEn = "Maintain at least " + target + "/" + area.count + " Yes answers (80%) and document the replicable practices";
        } else {
            criterioPt = "Atingir pelo menos " + target + "/" + area.count + " respostas Sim (80%) na reavaliação";
            criterioEn = "Reach at least " + target + "/" + area.count + " Yes answers (80%) on reassessment";
        }
        return {
            rank: i + 1,
            areaKey: area.key, areaNamePt: area.namePt, areaNameEn: area.nameEn,
            status: area.status, fraction: area.fraction, pct: area.pct,
            tag: meta.tag, timeframePt: meta.timeframePt, timeframeEn: meta.timeframeEn,
            actionsPt: actions.map(function(x) { return x.pt; }),
            actionsEn: actions.map(function(x) { return x.en; }),
            criterioSucessoPt: criterioPt, criterioSucessoEn: criterioEn,
            successTarget: target, successOf: area.count
        };
    });

    // Recommended-action table (Ação / Prioridade / Prazo / Responsável).
    // Two templates keyed to severity: 15-day emergency intervention for
    // Crítico areas, 30-day deep audit for Moderado/Atenção areas.
    var actionTable = [];
    ranked.forEach(function(area) {
        if (area.status === "Crítico") {
            actionTable.push({
                areaKey: area.key,
                acaoPt: "Intervenção emergencial em " + area.namePt + " (plano de choque de 15 dias)",
                acaoEn: "Emergency intervention in " + area.nameEn + " (15-day shock plan)",
                prioridade: "URGENTE",
                prazoPt: "15 dias", prazoEn: "15 days",
                responsavel: "Diretoria"
            });
        } else if (area.status === "Moderado" || area.status === "Atenção") {
            actionTable.push({
                areaKey: area.key,
                acaoPt: "Auditoria profunda de " + area.namePt + " com plano de correção (30 dias)",
                acaoEn: "Deep audit of " + area.nameEn + " with a correction plan (30 days)",
                prioridade: "MELHORIA",
                prazoPt: "30 dias", prazoEn: "30 days",
                responsavel: "Diretoria"
            });
        }
    });

    return {
        version: 1,
        assessment_type: "business_xray",
        score: score, max_score: total, pct: pct,
        maturity: maturity,
        areas: areas,
        buckets: buckets,
        action_plan: actionPlan,
        action_table: actionTable
    };
}

// ---------------------------------------------------------------------------
// Management X-Ray (Raio X de Gestão) — the second assigned assessment.
//
// Structurally different from the Business X-Ray and deliberately so:
//   - 11 CATEGORIES, one question each (category === question), so there is
//     no area/question split — a category IS the unit of measurement;
//   - a 0/1/2 maturity scale (Vermelho / Amarelo / Verde) instead of Sim/Não;
//   - WEIGHTED: each category carries weight 3, 2 or 1, so raw max is
//     Σ(weight × 2) = 50, not the category count.
// No practice-profile section here — that is business_xray-only.
// ---------------------------------------------------------------------------

// The three points on the scale. Index === stored answer value, so
// MGMT_SCALE_LEVELS[answers[key]] is the whole response descriptor.
var MGMT_SCALE_LEVELS = [
    { value: 0, key: "vermelho", color: "danger",  hex: "#dc3545",
      labelPt: "Crítico",           labelEn: "Critical",
      shortPt: "Crítico",           shortEn: "Critical" },
    { value: 1, key: "amarelo",  color: "warning", hex: "#ffc107",
      labelPt: "Em Desenvolvimento", labelEn: "In Development",
      shortPt: "Em Dev.",            shortEn: "In Dev." },
    { value: 2, key: "verde",    color: "success", hex: "#28a745",
      labelPt: "Alta Performance",   labelEn: "High Performance",
      shortPt: "Alta Perf.",         shortEn: "High Perf." }
];

// Priority derives from weight ONLY — never hand-assigned per category.
var MGMT_WEIGHT_PRIORITY = {
    3: { pt: "ALTA",  en: "HIGH" },
    2: { pt: "MÉDIA", en: "MEDIUM" },
    1: { pt: "BAIXA", en: "LOW" }
};

// Each category is one question with three verbatim options indexed by value.
var MGMT_CATEGORIES = [
    { key: "planejamento_estrategico", weight: 3,
      namePt: "Planejamento Estratégico", nameEn: "Strategic Planning",
      labelPt: "O plano estratégico da empresa é claro, comunicado e alinhado a toda a organização?",
      labelEn: "Is the company's strategic plan clear, communicated and aligned across the whole organization?",
      optionsPt: ["Não existe ou não é comunicado", "Parcialmente definido e comunicado", "Totalmente definido e alinhado"],
      optionsEn: ["Does not exist or is not communicated", "Partially defined and communicated", "Fully defined and aligned"] },
    { key: "estrutura_organizacional", weight: 2,
      namePt: "Estrutura Organizacional", nameEn: "Organizational Structure",
      labelPt: "As responsabilidades e hierarquias estão claramente definidas e documentadas?",
      labelEn: "Are responsibilities and reporting lines clearly defined and documented?",
      optionsPt: ["Não definidas ou documentadas", "Parcialmente documentadas", "Totalmente documentadas e conhecidas"],
      optionsEn: ["Not defined or documented", "Partially documented", "Fully documented and known"] },
    { key: "comunicacao_interna", weight: 2,
      namePt: "Comunicação Interna", nameEn: "Internal Communication",
      labelPt: "A comunicação interna é eficiente e há canais abertos para feedback?",
      labelEn: "Is internal communication efficient, with open channels for feedback?",
      optionsPt: ["Ineficiente ou inexistente", "Parcialmente eficiente", "Muito eficiente com canais abertos"],
      optionsEn: ["Inefficient or non-existent", "Partially efficient", "Very efficient with open channels"] },
    { key: "gestao_metas", weight: 3,
      namePt: "Gestão de Metas", nameEn: "Goal Management",
      labelPt: "As metas são mensuráveis, alinhadas e o desempenho é avaliado regularmente?",
      labelEn: "Are goals measurable, aligned, and is performance reviewed regularly?",
      optionsPt: ["Não há sistema formal de metas", "Sistema parcial ou inconsistente", "Sistema completo e regularmente avaliado"],
      optionsEn: ["No formal goal system", "Partial or inconsistent system", "Complete system, regularly reviewed"] },
    { key: "gestao_reunioes", weight: 1,
      namePt: "Gestão de Reuniões", nameEn: "Meeting Management",
      labelPt: "As reuniões são produtivas, com agenda clara e resultam em decisões documentadas?",
      labelEn: "Are meetings productive, with a clear agenda, resulting in documented decisions?",
      optionsPt: ["Reuniões desorganizadas", "Parcialmente organizadas", "Bem estruturadas com decisões documentadas"],
      optionsEn: ["Disorganized meetings", "Partially organized", "Well structured with documented decisions"] },
    { key: "processos_procedimentos", weight: 3,
      namePt: "Processos e Procedimentos", nameEn: "Processes & Procedures",
      labelPt: "Os processos-chave são documentados, padronizados e seguidos consistentemente?",
      labelEn: "Are key processes documented, standardized and consistently followed?",
      optionsPt: ["Não documentados ou não padronizados", "Parcialmente documentados", "Completamente documentados e padronizados"],
      optionsEn: ["Not documented or not standardized", "Partially documented", "Fully documented and standardized"] },
    { key: "indicadores_desempenho", weight: 3,
      namePt: "Indicadores de Desempenho", nameEn: "Performance Indicators",
      labelPt: "Existem KPIs definidos, monitorados e usados para tomada de decisão?",
      labelEn: "Are there KPIs defined, monitored and used for decision-making?",
      optionsPt: ["Não existem KPIs formalizados", "Parcialmente implantados", "Completamente implantados e monitorados"],
      optionsEn: ["No formalized KPIs", "Partially implemented", "Fully implemented and monitored"] },
    { key: "desenvolvimento_pessoas", weight: 2,
      namePt: "Desenvolvimento de Pessoas", nameEn: "People Development",
      labelPt: "Há planos de desenvolvimento profissional e programas de capacitação contínua?",
      labelEn: "Are there professional development plans and continuous training programs?",
      optionsPt: ["Não há programa de desenvolvimento", "Programa básico ou ocasional", "Programa robusto e contínuo"],
      optionsEn: ["No development program", "Basic or occasional program", "Robust and continuous program"] },
    { key: "avaliacao_desempenho", weight: 2,
      namePt: "Avaliação de Desempenho", nameEn: "Performance Review",
      labelPt: "Existe sistema formal de avaliação de desempenho com feedback regular?",
      labelEn: "Is there a formal performance-review system with regular feedback?",
      optionsPt: ["Não existe sistema formal", "Sistema informal ou irregular", "Sistema formal com feedback regular"],
      optionsEn: ["No formal system", "Informal or irregular system", "Formal system with regular feedback"] },
    { key: "documentacao_registro", weight: 2,
      namePt: "Documentação e Registro", nameEn: "Documentation & Records",
      labelPt: "A documentação organizacional é mantida, atualizada e facilmente acessível?",
      labelEn: "Is organizational documentation maintained, up to date and easily accessible?",
      optionsPt: ["Desorganizada ou inacessível", "Parcialmente organizada", "Bem organizada e facilmente acessível"],
      optionsEn: ["Disorganized or inaccessible", "Partially organized", "Well organized and easily accessible"] },
    { key: "controle_conformidade", weight: 2,
      namePt: "Controle e Conformidade", nameEn: "Control & Compliance",
      labelPt: "Existem controles e auditorias para garantir conformidade e qualidade?",
      labelEn: "Are there controls and audits to ensure compliance and quality?",
      optionsPt: ["Não existem controles formais", "Parcialmente implantados", "Completamente implantados e auditados"],
      optionsEn: ["No formal controls", "Partially implemented", "Fully implemented and audited"] }
];

// Band cutoffs + verbatim band copy — the ONLY place these numbers and this
// wording live (mirrors XRAY_CUTOFFS). Ordered strongest-first; the first
// entry whose `min` the percentage clears wins.
var MGMT_CUTOFFS = [
    { min: 80, level: "consolidada", color: "success",
      labelPt: "GESTÃO CONSOLIDADA", labelEn: "CONSOLIDATED MANAGEMENT",
      rangePt: "80-100%", rangeEn: "80-100%",
      devolutivaPt: "Sua organização possui processos bem estruturados e uma gestão madura. Os indicadores estão em linha, a comunicação flui, e há clareza nas responsabilidades. O desafio agora é escalar e otimizar continuamente para manter competitividade.",
      devolutivaEn: "Your organization has well-structured processes and mature management. Indicators are on track, communication flows, and responsibilities are clear. The challenge now is to scale and continuously optimize to stay competitive.",
      acaoImediataPt: "Mantenha a excelência atual. Foque em otimizar as categorias amarelas. Documente as melhores práticas para replicar em toda a empresa.",
      acaoImediataEn: "Maintain the current standard. Focus on optimizing the yellow categories. Document best practices to replicate across the company." },
    { min: 50, level: "transicao", color: "warning",
      labelPt: "GESTÃO EM TRANSIÇÃO", labelEn: "MANAGEMENT IN TRANSITION",
      rangePt: "50-79%", rangeEn: "50-79%",
      devolutivaPt: "Existem boas iniciativas, mas faltam consistência e padronização. Alguns processos estão definidos, mas nem todos são seguidos rigorosamente. Há comunicação, mas pode ser mais clara e fluida. O feedback é ocasional, não rotina. Indicadores existem, mas precisam de maior rigor.",
      devolutivaEn: "There are good initiatives, but consistency and standardization are missing. Some processes are defined, but not all are strictly followed. Communication exists, but it could be clearer and smoother. Feedback is occasional, not routine. Indicators exist, but need more rigor.",
      acaoImediataPt: "Priorize implementar os 3 pontos críticos nos próximos 30 dias. Defina responsáveis claros. Estabeleça acompanhamento mensal.",
      acaoImediataEn: "Prioritize implementing the 3 critical points over the next 30 days. Assign clear owners. Establish monthly follow-up." },
    { min: 0, level: "desorganizada", color: "danger",
      labelPt: "GESTÃO DESORGANIZADA", labelEn: "DISORGANIZED MANAGEMENT",
      rangePt: "0-49%", rangeEn: "0-49%",
      devolutivaPt: "A organização opera de forma pouco estruturada. Processos não são padronizados. Responsabilidades são difusas. Faltam indicadores e métricas. Comunicação é ineficiente. Há risco significativo de inconsistências, erros e perda de oportunidades. Uma intervenção estruturada é urgente.",
      devolutivaEn: "The organization operates with little structure. Processes are not standardized. Responsibilities are diffuse. Indicators and metrics are missing. Communication is inefficient. There is significant risk of inconsistencies, errors and lost opportunities. A structured intervention is urgent.",
      acaoImediataPt: "Crie um plano de ação de 90 dias. Comece pelos 3 processos-chave mais críticos. Designe um responsável pela transformação. Estabeleça check-ins semanais.",
      acaoImediataEn: "Create a 90-day action plan. Start with the 3 most critical key processes. Appoint an owner for the transformation. Establish weekly check-ins." }
];

// Action-card templates keyed by tag. {cat} is replaced with the category name.
var MGMT_ACTION_TEMPLATES = {
    "URGENTE": {
        pt: ['Diagnosticar raiz do problema em "{cat}"', "Definir processo padrão documentado",
             "Treinar equipe e estabelecer responsáveis", "Monitorar com métricas semanais"],
        en: ['Diagnose the root cause in "{cat}"', "Define a documented standard process",
             "Train the team and assign owners", "Track with weekly metrics"]
    },
    "MELHORIA": {
        pt: ['Revisar processos atuais em "{cat}"', "Implementar melhorias incrementais",
             "Validar com usuários finais", "Documentar e comunicar mudanças"],
        en: ['Review current processes in "{cat}"', "Implement incremental improvements",
             "Validate with end users", "Document and communicate the changes"]
    }
};

// Timeline ladder by action-plan rank (1-indexed), capped at 4 cards.
var MGMT_ACTION_TIMELINES = [
    { pt: "2 semanas", en: "2 weeks" },
    { pt: "1 mês",     en: "1 month" },
    { pt: "6 semanas", en: "6 weeks" },
    { pt: "3 meses",   en: "3 months" }
];

var MGMT_ACTION_SUCCESS_PT = "Implementação completa e primeiro ciclo de melhoria em andamento";
var MGMT_ACTION_SUCCESS_EN = "Full implementation and first improvement cycle under way";

// Max raw score = Σ(weight × 2). Computed, never hardcoded, so editing a
// weight above cannot silently desync the denominator.
function mgmtMaxScore() {
    return MGMT_CATEGORIES.reduce(function(sum, c) { return sum + c.weight * 2; }, 0);
}

// Pure scoring engine — answers is a flat { category_key: 0|1|2 } map.
// Returns the full structured result; NO rendering and NO narrative here.
function computeManagementXrayScore(answers) {
    answers = answers || {};
    var maxScore = mgmtMaxScore();
    var score = 0;
    var dist = { vermelho: 0, amarelo: 0, verde: 0, nao_respondido: 0, total: MGMT_CATEGORIES.length };
    var buckets = { criticos: [], atencao: [], fortes: [] };
    var BUCKET_BY_LEVEL = { vermelho: "criticos", amarelo: "atencao", verde: "fortes" };

    var categories = MGMT_CATEGORIES.map(function(c) {
        var v = answers[c.key];
        var answered = (v === 0 || v === 1 || v === 2);
        var level = answered ? MGMT_SCALE_LEVELS[v] : null;
        var weighted = answered ? v * c.weight : 0;
        score += weighted;
        if (answered) { dist[level.key] += 1; buckets[BUCKET_BY_LEVEL[level.key]].push(c.key); }
        else { dist.nao_respondido += 1; }
        var prio = MGMT_WEIGHT_PRIORITY[c.weight];
        return {
            key: c.key, namePt: c.namePt, nameEn: c.nameEn,
            weight: c.weight,
            value: answered ? v : null,
            response: answered
                ? { key: level.key, labelPt: level.labelPt, labelEn: level.labelEn,
                    optionPt: c.optionsPt[v], optionEn: c.optionsEn[v] }
                : null,
            color: answered ? level.color : "muted",
            hex: answered ? level.hex : "#c9cbcf",
            weightedScore: weighted, maxWeighted: c.weight * 2,
            bucket: answered ? BUCKET_BY_LEVEL[level.key] : null,
            priorityPt: prio.pt, priorityEn: prio.en
        };
    });

    var pct = maxScore ? Math.round((score / maxScore) * 100) : 0;

    // Maturity band (cutoffs live in MGMT_CUTOFFS only).
    var band = MGMT_CUTOFFS[MGMT_CUTOFFS.length - 1];
    for (var i = 0; i < MGMT_CUTOFFS.length; i++) {
        if (pct >= MGMT_CUTOFFS[i].min) { band = MGMT_CUTOFFS[i]; break; }
    }
    var maturity = {
        level: band.level, labelPt: band.labelPt, labelEn: band.labelEn,
        color: band.color, rangePt: band.rangePt, rangeEn: band.rangeEn,
        devolutivaPt: band.devolutivaPt, devolutivaEn: band.devolutivaEn,
        acaoImediataPt: band.acaoImediataPt, acaoImediataEn: band.acaoImediataEn
    };

    // Plano de Ação Prioritário — max 4 cards, only non-verde categories.
    // Order: value ascending (vermelho first), then weight descending, then
    // catalog order (the sort is stable, so equal keys keep catalog order).
    var orderByKey = {};
    MGMT_CATEGORIES.forEach(function(c, idx) { orderByKey[c.key] = idx; });
    var actionable = categories.filter(function(c) { return c.value === 0 || c.value === 1; });
    actionable.sort(function(x, y) {
        if (x.value !== y.value) { return x.value - y.value; }
        if (x.weight !== y.weight) { return y.weight - x.weight; }
        return orderByKey[x.key] - orderByKey[y.key];
    });
    var actionPlan = actionable.slice(0, MGMT_ACTION_TIMELINES.length).map(function(c, idx) {
        var tag = (c.value === 0) ? "URGENTE" : "MELHORIA";
        var tpl = MGMT_ACTION_TEMPLATES[tag];
        var time = MGMT_ACTION_TIMELINES[idx];
        return {
            rank: idx + 1,
            categoryKey: c.key, categoryNamePt: c.namePt, categoryNameEn: c.nameEn,
            weight: c.weight, value: c.value,
            priorityPt: c.priorityPt, priorityEn: c.priorityEn,
            tag: tag, timeframePt: time.pt, timeframeEn: time.en,
            actionsPt: tpl.pt.map(function(a) { return a.replace("{cat}", c.namePt); }),
            actionsEn: tpl.en.map(function(a) { return a.replace("{cat}", c.nameEn); }),
            criterioSucessoPt: MGMT_ACTION_SUCCESS_PT, criterioSucessoEn: MGMT_ACTION_SUCCESS_EN
        };
    });

    // Chart DATA only — the report renders it client-side (same discipline as
    // the Business X-Ray's inline SVG bars: no chart library, no CDN).
    var charts = {
        categoryBar: {
            titlePt: "Nível por Categoria", titleEn: "Level by Category",
            yMin: 0, yMax: 2,
            ticks: MGMT_SCALE_LEVELS.map(function(l) {
                return { value: l.value, labelPt: l.shortPt, labelEn: l.shortEn };
            }),
            // FULL category names — never truncated.
            bars: categories.map(function(c) {
                return { key: c.key, labelPt: c.namePt, labelEn: c.nameEn,
                         value: c.value, hex: c.hex };
            })
        },
        responseDoughnut: {
            titlePt: "Distribuição das Respostas", titleEn: "Response Distribution",
            total: dist.total,
            slices: [
                { key: "vermelho",       labelPt: "Crítico",           labelEn: "Critical",         count: dist.vermelho,       hex: "#dc3545" },
                { key: "amarelo",        labelPt: "Em Desenvolvimento", labelEn: "In Development",   count: dist.amarelo,        hex: "#ffc107" },
                { key: "verde",          labelPt: "Alta Performance",   labelEn: "High Performance", count: dist.verde,          hex: "#28a745" },
                { key: "nao_respondido", labelPt: "Não respondidas",    labelEn: "Unanswered",       count: dist.nao_respondido, hex: "#c9cbcf" }
            ].map(function(s) {
                return Object.assign(s, { pct: dist.total ? Math.round((s.count / dist.total) * 100) : 0 });
            })
        }
    };

    return {
        version: 1,
        assessment_type: "management_xray",
        score: score, max_score: maxScore, pct: pct,
        maturity: maturity,
        categories: categories,
        buckets: buckets,
        distribution: dist,
        action_plan: actionPlan,
        charts: charts
    };
}

// ---------------------------------------------------------------------------
// Leadership X-Ray (Raio X Nível de Liderança) — the third assigned assessment.
//
// Structurally different again, and the first instrument that is NOT scored by
// summing points:
//   - 10 competencies, one question each, answered 0-10;
//   - the overall result is the MAJORITY BAND across the ten answers, not a
//     total. Ten 9s and ten 2s both produce a single-colour verdict; a split
//     field resolves to amarelo.
// No weights, no practice profile — simpler than both existing instruments.
// ---------------------------------------------------------------------------

// Each question carries the FULL competency name it maps to. The report and
// the bar chart both print this — never a truncated label.
var LEAD_QUESTIONS = [
    { key: "L1",
      namePt: "Admiração e Referência", nameEn: "Admiration & Role Model",
      labelPt: "A equipe te admira como líder e tem você como referência de conduta e excelência?",
      labelEn: "Does the team admire you as a leader and see you as a reference for conduct and excellence?" },
    { key: "L2",
      namePt: "Autogestão da Equipe", nameEn: "Team Self-Management",
      labelPt: "A sua equipe é autogerenciável o suficiente a ponto de você poder se ausentar da empresa por 30 dias sem que haja prejuízo nos resultados comerciais e operacionais?",
      labelEn: "Is your team self-managing enough that you could be away from the company for 30 days with no damage to commercial and operational results?" },
    { key: "L3",
      namePt: "Execução de Projetos", nameEn: "Project Execution",
      labelPt: "Seus projetos prioritários estão caminhando conforme o planejado e dentro dos prazos estipulados? Eles já geraram os resultados esperados ou estão em vias de gerar?",
      labelEn: "Are your priority projects progressing as planned and on schedule? Have they delivered the expected results, or are they about to?" },
    { key: "L4",
      namePt: "Disciplina de Reuniões", nameEn: "Meeting Discipline",
      labelPt: "As rotinas semanais de reuniões de sua equipe direta ocorrem de forma disciplinada na data e horários acordados?",
      labelEn: "Do the weekly meeting routines with your direct team happen with discipline, on the agreed dates and times?" },
    { key: "L5",
      namePt: "Aderência a Processos", nameEn: "Process Adherence",
      labelPt: "Há quanto tempo sua equipe obedece de forma rígida os processos fundamentais da área com disciplina?",
      labelEn: "For how long has your team strictly and consistently followed the area's fundamental processes?" },
    { key: "L6",
      namePt: "Desenvolvimento de Liderados", nameEn: "Developing Direct Reports",
      labelPt: "Existem ritos claros e bem definidos de passagem de aprendizado, aculturamento e desenvolvimento formal da liderança dos seus liderados diretos?",
      labelEn: "Are there clear, well-defined rituals for transferring learning, onboarding into the culture and formally developing your direct reports' leadership?" },
    { key: "L7",
      namePt: "Resolução de Problemas", nameEn: "Problem Solving",
      labelPt: "Você é um resolvedor de problemas ou um criador sistemático de problemas?",
      labelEn: "Are you a problem solver, or a systematic creator of problems?" },
    { key: "L8",
      namePt: "Retenção de Talentos", nameEn: "Talent Retention",
      labelPt: "Os talentos que estão sob sua liderança permanecem na empresa, crescem e se desenvolvem de forma constante sob sua liderança?",
      labelEn: "Do the talents under your leadership stay with the company, grow and develop consistently under you?" },
    { key: "L9",
      namePt: "Decisão e Adaptação", nameEn: "Decision-Making & Adaptability",
      labelPt: "No ambiente dinâmico em que vivemos, qual nível de capacidade de tomada de decisão e adaptação da sua equipe hoje?",
      labelEn: "In today's dynamic environment, what is your team's current level of decision-making and adaptability?" },
    { key: "L10",
      namePt: "Resultados e Metas", nameEn: "Results & Targets",
      labelPt: "Os resultados gerados pela sua equipe nos últimos trimestres de performance, inovação ou em ganho de eficiência superaram as expectativas da diretoria ou stakeholders? As metas são batidas com consistência?",
      labelEn: "Have your team's results over recent quarters — performance, innovation or efficiency gains — exceeded the expectations of the board or stakeholders? Are targets hit consistently?" }
];

// Verbatim devolutiva + ação copy, one pair per overall colour. The ONLY
// place this wording lives.
var LEAD_VERDICTS = {
    verde: {
        key: "verde", color: "success",
        labelPt: "Liderança de Alta Performance", labelEn: "High-Performance Leadership",
        devolutivaPt: "Sua liderança está em alta performance. Seus liderados confiam no seu direcionamento, você tem autonomia e os processos rodam mesmo na sua ausência. Há resultados consistentes e um clima organizacional favorável para crescimento e inovação.",
        devolutivaEn: "Your leadership is performing at a high level. Your reports trust your direction, you have autonomy, and processes keep running even when you are away. Results are consistent and the organizational climate favours growth and innovation.",
        acaoImediataPt: "Mantenha o foco em formar novos líderes abaixo de você para sustentar a expansão. Celebre as conquistas da equipe e engaje-os na visão de longo prazo da empresa.",
        acaoImediataEn: "Keep the focus on building new leaders below you to sustain expansion. Celebrate the team's wins and engage them in the company's long-term vision."
    },
    amarelo: {
        key: "amarelo", color: "warning",
        labelPt: "Liderança com Gargalos", labelEn: "Leadership with Bottlenecks",
        devolutivaPt: "Sua liderança possui boas intenções e potencial, mas apresenta gargalos operacionais. Você provavelmente ainda apaga muitos incêndios e a equipe não tem a autonomia necessária. Os resultados da área podem estar oscilando ou abaixo do esperado.",
        devolutivaEn: "Your leadership has good intentions and potential, but shows operational bottlenecks. You are probably still putting out a lot of fires and the team lacks the autonomy it needs. The area's results may be fluctuating or below expectations.",
        acaoImediataPt: "Mapeie o que mais toma seu tempo hoje (microgerenciamento). Tente instituir rotinas básicas de Delegação e Follow-up. Melhore a disciplina dos ritos de gestão (reuniões com pauta e check-ins frequentes).",
        acaoImediataEn: "Map what takes up most of your time today (micromanagement). Put basic Delegation and Follow-up routines in place. Improve the discipline of your management rituals (meetings with an agenda and frequent check-ins)."
    },
    vermelho: {
        key: "vermelho", color: "danger",
        labelPt: "Liderança Frágil", labelEn: "Fragile Leadership",
        devolutivaPt: "A situação atual da sua liderança é extremamente frágil. A equipe não consegue operar sozinha e você está sobrecarregado resolvendo problemas que não deveriam chegar a você. Isso prejudica a retenção de talentos e a entrega de resultados.",
        devolutivaEn: "The current state of your leadership is extremely fragile. The team cannot operate on its own and you are overloaded solving problems that should never reach you. This harms talent retention and the delivery of results.",
        acaoImediataPt: "Pare e estruture o básico. Desenhe claramente as responsabilidades de cada membro (quem faz o que). Institua processos inegociáveis. Se necessário, busque mentoria de outro líder sênior ou revise a composição do seu time.",
        acaoImediataEn: "Stop and structure the basics. Clearly map out each member's responsibilities (who does what). Establish non-negotiable processes. If needed, seek mentoring from another senior leader or review your team's composition."
    }
};

// Majority band across the ten answers.
//   - a strict majority of one colour wins;
//   - anything else (a tie, or no colour above half) resolves to amarelo.
// Verified against the legacy tool's 5-verde/5-vermelho case, which returns
// amarelo rather than picking a side.
function leadOverallColorKey(dist) {
    var answered = dist.total - dist.nao_respondido;
    if (!answered) { return "amarelo"; }
    var keys = ["verde", "amarelo", "vermelho"];
    var top = keys[0];
    keys.forEach(function(k) { if (dist[k] > dist[top]) { top = k; } });
    // A tie for the lead is not a majority — amarelo is the tie-break default.
    var tied = keys.filter(function(k) { return dist[k] === dist[top]; }).length > 1;
    if (tied) { return "amarelo"; }
    return top;
}

// Pure scoring engine — answers is a flat { L1..L10: 0..10 } map.
// Returns the structured result; NO rendering and NO narrative here.
function computeLeadershipXrayScore(answers) {
    answers = answers || {};
    var dist = scale10Distribution(LEAD_QUESTIONS, answers, false);

    var categories = LEAD_QUESTIONS.map(function(q) {
        var v = answers[q.key];
        var band = scale10Band(v, false);
        return {
            key: q.key, namePt: q.namePt, nameEn: q.nameEn,
            labelPt: q.labelPt, labelEn: q.labelEn,
            value: band ? v : null,
            band: band ? band.key : null,
            color: band ? band.color : "muted",
            hex: band ? band.hex : SCALE10_UNANSWERED_HEX,
            bandLabelPt: band ? band.labelPt : null,
            bandLabelEn: band ? band.labelEn : null
        };
    });

    var overall = LEAD_VERDICTS[leadOverallColorKey(dist)];

    // A 0-100 read for the card badge ("Escala de 100 pontos"). It does NOT
    // decide the colour — the majority band does — but it gives the report a
    // single headline number.
    var answeredCount = dist.total - dist.nao_respondido;
    var sum = 0;
    LEAD_QUESTIONS.forEach(function(q) {
        var b = scale10Band(answers[q.key], false);
        if (b) { sum += answers[q.key]; }
    });
    var pct = answeredCount ? Math.round((sum / (answeredCount * 10)) * 100) : 0;

    // Chart DATA only — the report draws it as inline SVG, no library, no CDN.
    var charts = {
        competencyBar: {
            titlePt: "Nota por Competência", titleEn: "Score by Competency",
            yMin: 0, yMax: 10,
            bars: categories.map(function(c) {
                return { key: c.key, labelPt: c.namePt, labelEn: c.nameEn,
                         value: c.value, hex: c.hex };
            })
        },
        bandDoughnut: {
            titlePt: "Distribuição do Resultado", titleEn: "Result Distribution",
            total: dist.total,
            slices: [
                { key: "vermelho",       labelPt: "Crítico (0-3)",    labelEn: "Critical (0-3)",   count: dist.vermelho,       hex: "#dc3545" },
                { key: "amarelo",        labelPt: "Atenção (4-7)",    labelEn: "Attention (4-7)",  count: dist.amarelo,        hex: "#ffc107" },
                { key: "verde",          labelPt: "Excelência (8-10)", labelEn: "Excellence (8-10)", count: dist.verde,        hex: "#28a745" },
                { key: "nao_respondido", labelPt: "Pendente",          labelEn: "Pending",          count: dist.nao_respondido, hex: SCALE10_UNANSWERED_HEX }
            ].map(function(s) {
                return Object.assign(s, { pct: dist.total ? Math.round((s.count / dist.total) * 100) : 0 });
            })
        }
    };

    return {
        version: 1,
        assessment_type: "leadership_xray",
        score: sum, max_score: dist.total * 10, pct: pct,
        overall: {
            color: overall.color, key: overall.key,
            labelPt: overall.labelPt, labelEn: overall.labelEn,
            devolutivaPt: overall.devolutivaPt, devolutivaEn: overall.devolutivaEn,
            acaoImediataPt: overall.acaoImediataPt, acaoImediataEn: overall.acaoImediataEn
        },
        // client.html's assessment card reads score_summary.maturity — mirror
        // the shape so the generic admin row needs no special case.
        maturity: {
            level: overall.key, color: overall.color,
            labelPt: overall.labelPt, labelEn: overall.labelEn
        },
        categories: categories,
        distribution: dist,
        charts: charts
    };
}

// ---------------------------------------------------------------------------
// Permissiveness X-Ray (Raio X de Permissividade) — the fourth assigned
// assessment, and the first scored by a SUBTRACTION rather than a total:
//
//   pontos = (CL + CG) − (PR + PC)      → range −20..+20
//
// Competence (liderança, gestão) minus permissiveness (tolerated bad results,
// tolerated bad behaviour). Only four indicators, so the report leans on
// per-indicator insight paragraphs rather than a long breakdown.
// ---------------------------------------------------------------------------

var PERM_QUESTIONS = [
    { key: "CL", side: "competencia",
      namePt: "Competência de Liderança", nameEn: "Leadership Competence",
      shortPt: "Comp. Liderança", shortEn: "Leadership Comp.",
      labelPt: "Qual o nível de competência e influência da liderança atual?",
      labelEn: "What is the current leadership's level of competence and influence?" },
    { key: "CG", side: "competencia",
      namePt: "Competência de Gestão", nameEn: "Management Competence",
      shortPt: "Comp. Gestão", shortEn: "Management Comp.",
      labelPt: "Qual o nível de maturidade dos processos e ritos de gestão?",
      labelEn: "What is the maturity level of your management processes and rituals?" },
    { key: "PR", side: "permissividade",
      namePt: "Permissividade de Resultado", nameEn: "Result Permissiveness",
      shortPt: "Perm. Resultado", shortEn: "Result Perm.",
      labelPt: "O quanto a empresa tolera resultados abaixo da meta?",
      labelEn: "How much does the company tolerate results below target?" },
    { key: "PC", side: "permissividade",
      namePt: "Permissividade de Comportamento", nameEn: "Behaviour Permissiveness",
      shortPt: "Perm. Comportamento", shortEn: "Behaviour Perm.",
      labelPt: "O quanto a empresa tolera comportamentos desalinhados à cultura?",
      labelEn: "How much does the company tolerate behaviour that is out of line with the culture?" }
];

// Band cutoffs on `pontos` (NOT a percentage). Ordered strongest-first; the
// first entry whose `min` the score clears wins. Verified by sweep:
//   pontos > 10 → Excelente · 0..10 → em Atenção · < 0 → Crítico
var PERM_CUTOFFS = [
    { min: 11, level: "excelente", color: "success",
      labelPt: "Resultado Empresarial Excelente", labelEn: "Excellent Business Result",
      devolutivaPt: "Sua empresa possui um alto nível de maturidade. A força da sua liderança e gestão é superior à tolerância a falhas, criando um ambiente de alta performance.",
      devolutivaEn: "Your company has a high level of maturity. The strength of your leadership and management outweighs your tolerance for failure, creating a high-performance environment.",
      acaoTituloPt: "Manutenção da Excelência", acaoTituloEn: "Maintaining Excellence",
      acaoImediataPt: "Continue elevando a barra e não permita que o sucesso traga complacência.",
      acaoImediataEn: "Keep raising the bar and do not let success breed complacency." },
    { min: 0, level: "atencao", color: "warning",
      labelPt: "Resultado Empresarial em Atenção", labelEn: "Business Result Needs Attention",
      devolutivaPt: "O equilíbrio entre competências e permissividade é frágil. Embora existam competências, a tolerância a resultados baixos ou comportamentos desalinhados está começando a comprometer a eficácia do seu negócio.",
      devolutivaEn: "The balance between competence and permissiveness is fragile. Competence exists, but tolerance for low results or misaligned behaviour is starting to undermine your business's effectiveness.",
      acaoTituloPt: "Ajuste de Processos", acaoTituloEn: "Process Adjustment",
      acaoImediataPt: "Reforce os rituais de feedback e cobrança de metas (KPIs).",
      acaoImediataEn: "Reinforce feedback rituals and hold the team to their targets (KPIs)." },
    { min: -20, level: "critico", color: "danger",
      labelPt: "Resultado Empresarial Crítico", labelEn: "Critical Business Result",
      devolutivaPt: "Situação de alto risco. A permissividade superou a força da liderança e da gestão. Na prática, a cultura está sendo moldada pela mediocridade e pela falta de cobrança, o que compromete a sustentabilidade da empresa.",
      devolutivaEn: "A high-risk situation. Permissiveness has overtaken the strength of leadership and management. In practice, the culture is being shaped by mediocrity and a lack of accountability, which threatens the company's sustainability.",
      acaoTituloPt: "Intervenção Estrutural", acaoTituloEn: "Structural Intervention",
      acaoImediataPt: "Estabeleça o mínimo inegociável: metas com consequência clara e comportamentos que não serão mais tolerados. Comece pelos casos mais visíveis para a equipe.",
      acaoImediataEn: "Set the non-negotiable minimum: targets with clear consequences and behaviours that will no longer be tolerated. Start with the cases the team can see most clearly." }
];

// Conditional insight paragraphs. Which ones fire is driven by the SAME 4/7
// thresholds used everywhere else in this family (low = 0-3, high = 8-10) —
// the legacy source's exact cutoffs were not recovered, so these reuse the
// family convention rather than inventing a fourth set of numbers.
// {CL} {CG} {PR} {PC} are replaced with the raw answers.
var PERM_INSIGHTS = [
    { key: "base_fraca",
      when: function(a) { return scale10Band(a.CL, false) === SCALE10_BANDS.vermelho ||
                                 scale10Band(a.CG, false) === SCALE10_BANDS.vermelho; },
      titlePt: "Fortalecimento de Base", titleEn: "Strengthening the Base",
      textPt: "Suas notas de Competência de Liderança ({CL}) ou Gestão ({CG}) estão baixas. Sem uma base forte, é impossível reduzir a permissividade. Foque em treinar seus líderes e estruturar ritos de gestão.",
      textEn: "Your Leadership ({CL}) or Management ({CG}) Competence scores are low. Without a strong base it is impossible to reduce permissiveness. Focus on training your leaders and structuring management rituals." },
    { key: "base_solida",
      when: function(a) { return scale10Band(a.CL, false) === SCALE10_BANDS.verde &&
                                 scale10Band(a.CG, false) === SCALE10_BANDS.verde; },
      titlePt: "Base Sólida", titleEn: "Solid Base",
      textPt: "Você possui boas notas de Liderança ({CL}) e Gestão ({CG}). Use essa força para ser mais rigoroso com os indicadores de permissividade.",
      textEn: "You have strong Leadership ({CL}) and Management ({CG}) scores. Use that strength to be stricter with the permissiveness indicators." },
    { key: "rigor_metas",
      when: function(a) { return scale10Band(a.PR, false) === SCALE10_BANDS.verde; },
      titlePt: "Rigor com Metas", titleEn: "Rigor with Targets",
      textPt: "Sua Permissividade de Resultado ({PR}) está elevada. Isso indica que não atingir as metas é algo \"aceitável\" ou recorrente sem consequências claras. É preciso estabelecer metas inegociáveis.",
      textEn: "Your Result Permissiveness ({PR}) is high. It signals that missing targets is \"acceptable\", or recurring without clear consequences. Non-negotiable targets need to be established." },
    { key: "cultura_valores",
      when: function(a) { return scale10Band(a.PC, false) === SCALE10_BANDS.verde; },
      titlePt: "Cultura e Valores", titleEn: "Culture and Values",
      textPt: "Sua Permissividade de Comportamento ({PC}) está alta. Você está tolerando pessoas que performam mas não vivem os valores, ou que simplesmente agem contra a cultura. Isso é um \"câncer\" silencioso para o time.",
      textEn: "Your Behaviour Permissiveness ({PC}) is high. You are tolerating people who perform but do not live the values, or who simply act against the culture. That is a silent \"cancer\" for the team." }
];

// Pure scoring engine — answers is a flat { CL, CG, PR, PC: 0..10 } map.
function computePermissividadeXrayScore(answers) {
    answers = answers || {};
    var raw = {};
    PERM_QUESTIONS.forEach(function(q) {
        var v = answers[q.key];
        raw[q.key] = (typeof v === "number" && v >= 0 && v <= 10) ? v : 0;
    });

    var pontos = (raw.CL + raw.CG) - (raw.PR + raw.PC);

    var band = PERM_CUTOFFS[PERM_CUTOFFS.length - 1];
    for (var i = 0; i < PERM_CUTOFFS.length; i++) {
        if (pontos >= PERM_CUTOFFS[i].min) { band = PERM_CUTOFFS[i]; break; }
    }

    // Each indicator is ALSO banded 0-3/4-7/8-10 for the "Distribuição do
    // Resultado" display, same as every other instrument in this family.
    var dist = scale10Distribution(PERM_QUESTIONS, answers, false);
    var indicators = PERM_QUESTIONS.map(function(q) {
        var v = answers[q.key];
        var b = scale10Band(v, false);
        return {
            key: q.key, side: q.side,
            namePt: q.namePt, nameEn: q.nameEn,
            shortPt: q.shortPt, shortEn: q.shortEn,
            labelPt: q.labelPt, labelEn: q.labelEn,
            value: b ? v : null,
            band: b ? b.key : null,
            color: b ? b.color : "muted",
            hex: b ? b.hex : SCALE10_UNANSWERED_HEX,
            bandLabelPt: b ? b.labelPt : null,
            bandLabelEn: b ? b.labelEn : null
        };
    });

    function fill(s) {
        return s.replace("{CL}", raw.CL).replace("{CG}", raw.CG)
                .replace("{PR}", raw.PR).replace("{PC}", raw.PC);
    }

    // Insight conditions read the RAW ANSWERS, not the zero-filled `raw` map:
    // an unanswered indicator must not trigger "your score is low". (The
    // formula above still treats a blank as 0 — only the narrative abstains.)
    var insights = PERM_INSIGHTS.filter(function(ins) { return ins.when(answers); })
        .map(function(ins) {
            return { key: ins.key, titlePt: ins.titlePt, titleEn: ins.titleEn,
                     textPt: fill(ins.textPt), textEn: fill(ins.textEn) };
        });

    // Every band restates the raw inputs before its recommendation.
    var basePt = "Com base nos seus números de hoje (CL:" + raw.CL + ", CG:" + raw.CG +
                 ", PR:" + raw.PR + ", PC:" + raw.PC + "), sua prioridade deve ser: ";
    var baseEn = "Based on today's numbers (CL:" + raw.CL + ", CG:" + raw.CG +
                 ", PR:" + raw.PR + ", PC:" + raw.PC + "), your priority should be: ";

    // Chart DATA only. ONE chart for this instrument — four bars, coloured by
    // the SAME 0-3/4-7/8-10 rule as everywhere else. Note the permissividade
    // bars are NOT polarity-inverted: the legacy tool colours a high PR/PC
    // green even though a low one is the good outcome, and this reproduces
    // that as observed rather than "fixing" it.
    var charts = {
        indicatorBar: {
            titlePt: "Pontuação (0-10)", titleEn: "Score (0-10)",
            yMin: 0, yMax: 10,
            bars: indicators.map(function(c) {
                return { key: c.key, labelPt: c.shortPt, labelEn: c.shortEn,
                         value: c.value, hex: c.hex };
            })
        }
    };

    return {
        version: 1,
        assessment_type: "permissividade_xray",
        pontos: pontos, min_pontos: -20, max_pontos: 20,
        // The headline number IS pontos; score/max_score are the normalized
        // 0-40 mirror so the generic admin row has something to print.
        score: pontos + 20, max_score: 40,
        pct: Math.round(((pontos + 20) / 40) * 100),
        raw: raw,
        overall: {
            level: band.level, color: band.color,
            labelPt: band.labelPt, labelEn: band.labelEn,
            // Headline restates the band name WITH the score, e.g.
            // "Resultado Empresarial em Atenção (1 pontos)." — the legacy
            // tool's own phrasing, pluralization quirk included.
            headlinePt: band.labelPt + " (" + pontos + " pontos).",
            headlineEn: band.labelEn + " (" + pontos + " points).",
            devolutivaPt: band.devolutivaPt, devolutivaEn: band.devolutivaEn,
            acaoTituloPt: band.acaoTituloPt, acaoTituloEn: band.acaoTituloEn,
            acaoImediataPt: basePt + band.acaoImediataPt,
            acaoImediataEn: baseEn + band.acaoImediataEn
        },
        maturity: {
            level: band.level, color: band.color,
            labelPt: band.labelPt, labelEn: band.labelEn
        },
        categories: indicators,
        indicators: indicators,
        insights: insights,
        distribution: dist,
        charts: charts
    };
}

// ---------------------------------------------------------------------------
// Failures X-Ray (Raio X Falhas) — the fifth assigned assessment, and the
// INVERTED one: every answer rates how strongly a failure is PRESENT, so a
// high answer is the bad outcome (the opposite of every other instrument).
//
//   maxIntensity  = 27 × 10 = 270
//   intensityTotal = Σ answers
//   healthPct     = 100 − round(intensityTotal / 270 × 100)
//
// Two groups (16 operational failures + 11 strategic errors) that the report
// prints as separate sub-sections, matching the card's own framing.
// ---------------------------------------------------------------------------

var FALHAS_GROUPS = [
    { key: "operacionais", prefix: "f",
      namePt: "Falhas Operacionais", nameEn: "Operational Failures",
      shortPt: "FALHA", shortEn: "FAILURE" },
    { key: "estrategicos", prefix: "e",
      namePt: "Erros Estratégicos", nameEn: "Strategic Errors",
      shortPt: "ERRO", shortEn: "ERROR" }
];

var FALHAS_QUESTIONS = [
    // Falhas Operacionais (f1-f16)
    { key: "f1",  group: "operacionais", namePt: "Falta de direcionamento claro", nameEn: "Lack of clear direction",
      labelPt: "Falta de direcionamento claro?", labelEn: "Lack of clear direction?" },
    { key: "f2",  group: "operacionais", namePt: "Não conseguir sair do operacional", nameEn: "Unable to step out of day-to-day operations",
      labelPt: "Não conseguir sair do operacional?", labelEn: "Unable to step out of day-to-day operations?" },
    { key: "f3",  group: "operacionais", namePt: "Falta de acabativa", nameEn: "Failure to finish what is started",
      labelPt: "Falta de acabativa?", labelEn: "Failure to finish what is started?" },
    { key: "f4",  group: "operacionais", namePt: "Falta de alinhamento da equipe", nameEn: "Lack of team alignment",
      labelPt: "Falta de alinhamento da equipe?", labelEn: "Lack of team alignment?" },
    { key: "f5",  group: "operacionais", namePt: "Desperdício de recursos", nameEn: "Wasted resources",
      labelPt: "Desperdício de recursos?", labelEn: "Wasted resources?" },
    { key: "f6",  group: "operacionais", namePt: "Perda de oportunidades", nameEn: "Missed opportunities",
      labelPt: "Perda de oportunidades?", labelEn: "Missed opportunities?" },
    { key: "f7",  group: "operacionais", namePt: "Desmotivação do time", nameEn: "Team demotivation",
      labelPt: "Desmotivação do time?", labelEn: "Team demotivation?" },
    { key: "f8",  group: "operacionais", namePt: "Insubordinação", nameEn: "Insubordination",
      labelPt: "Insubordinação?", labelEn: "Insubordination?" },
    { key: "f9",  group: "operacionais", namePt: "Não conseguir adaptar às mudanças do mercado", nameEn: "Unable to adapt to market change",
      labelPt: "Não conseguir adaptar com as mudanças do mercado?", labelEn: "Unable to adapt to changes in the market?" },
    { key: "f10", group: "operacionais", namePt: "Cultura de reatividade", nameEn: "Reactive culture",
      labelPt: "Cultura de reatividade?", labelEn: "A reactive culture?" },
    { key: "f11", group: "operacionais", namePt: "Perda de foco", nameEn: "Loss of focus",
      labelPt: "Perda de foco?", labelEn: "Loss of focus?" },
    { key: "f12", group: "operacionais", namePt: "Dificuldade para atrair e reter pessoas", nameEn: "Difficulty attracting and retaining people",
      labelPt: "Dificuldade para atrair e reter pessoas?", labelEn: "Difficulty attracting and retaining people?" },
    { key: "f13", group: "operacionais", namePt: "Problemas com fluxo de caixa e planejamento financeiro", nameEn: "Cash-flow and financial-planning problems",
      labelPt: "Problemas com fluxo de caixa e planejamento financeiro?", labelEn: "Problems with cash flow and financial planning?" },
    { key: "f14", group: "operacionais", namePt: "Dificuldade em ser competitivo", nameEn: "Difficulty staying competitive",
      labelPt: "Dificuldade em ser competitivo?", labelEn: "Difficulty being competitive?" },
    { key: "f15", group: "operacionais", namePt: "Má gestão do tempo", nameEn: "Poor time management",
      labelPt: "Má gestão do tempo?", labelEn: "Poor time management?" },
    { key: "f16", group: "operacionais", namePt: "Problemas com produtividade e eficiência", nameEn: "Productivity and efficiency problems",
      labelPt: "Problemas com produtividade e eficiência?", labelEn: "Problems with productivity and efficiency?" },
    // Erros Estratégicos (e1-e11)
    { key: "e1",  group: "estrategicos", namePt: "Ausência de planejamento estratégico", nameEn: "No strategic planning",
      labelPt: "Ausência de planejamento estratégico?", labelEn: "Absence of strategic planning?" },
    { key: "e2",  group: "estrategicos", namePt: "Contratação sem critérios corretos", nameEn: "Hiring without proper criteria",
      labelPt: "Contratação sem critérios corretos?", labelEn: "Hiring without the right criteria?" },
    { key: "e3",  group: "estrategicos", namePt: "Marketing fraco ou inexistente", nameEn: "Weak or non-existent marketing",
      labelPt: "Marketing fraco ou inexistente?", labelEn: "Weak or non-existent marketing?" },
    { key: "e4",  group: "estrategicos", namePt: "Gestão comercial inexistente", nameEn: "No sales management",
      labelPt: "Gestão comercial inexistente?", labelEn: "Non-existent sales management?" },
    { key: "e5",  group: "estrategicos", namePt: "Falta de tempo para o estratégico", nameEn: "No time for strategic work",
      labelPt: "Falta de tempo para o estratégico?", labelEn: "No time for strategic work?" },
    { key: "e6",  group: "estrategicos", namePt: "Desconhecimento do cliente atual", nameEn: "Not knowing your current customer",
      labelPt: "Desconhecimento do cliente atual?", labelEn: "Not knowing your current customer?" },
    { key: "e7",  group: "estrategicos", namePt: "Precificação ruim", nameEn: "Poor pricing",
      labelPt: "Precificação ruim?", labelEn: "Poor pricing?" },
    { key: "e8",  group: "estrategicos", namePt: "Má gestão financeira e contábil", nameEn: "Poor financial and accounting management",
      labelPt: "Má gestão financeira e contábil?", labelEn: "Poor financial and accounting management?" },
    { key: "e9",  group: "estrategicos", namePt: "Falta de foco em indicadores e números", nameEn: "No focus on indicators and numbers",
      labelPt: "Falta de foco em indicadores e números?", labelEn: "Lack of focus on indicators and numbers?" },
    { key: "e10", group: "estrategicos", namePt: "Isolamento empresarial", nameEn: "Business isolation",
      labelPt: "Isolamento empresarial?", labelEn: "Business isolation?" },
    { key: "e11", group: "estrategicos", namePt: "Incapacidade de formar times de alta performance", nameEn: "Unable to build high-performance teams",
      labelPt: "Incapacidade de formar times de alta performance?", labelEn: "Inability to build high-performance teams?" }
];

// Band cutoffs on healthPct. Ordered strongest-first.
//
// VERIFIED: only the 100% anchor ("Nível de Saúde Excelente", with the
// devolutiva and ação below). The mid and low bands' cutoffs AND copy are
// INFERRED — thresholds chosen to match this family's convention (>=80 /
// 50-79 / <50) and the copy written in the same voice as the verified string.
// Flagged as unverified in the build report; swap in the consultant's real
// wording when it is available.
var FALHAS_CUTOFFS = [
    { min: 80, level: "excelente", color: "success",
      labelPt: "Nível de Saúde Excelente", labelEn: "Excellent Health Level",
      devolutivaPt: "Sua empresa possui poucas falhas operacionais e erros estratégicos (Intensidade total de falhas: {total}/{max}). A operação está rodando com fluidez e a estratégia está bem direcionada.",
      devolutivaEn: "Your company has few operational failures and strategic errors (Total failure intensity: {total}/{max}). Operations are running smoothly and the strategy is well directed.",
      acaoImediataPt: "Mantenha o rigor nos processos e foque em expansão agressiva.",
      acaoImediataEn: "Keep the rigor in your processes and focus on aggressive expansion." },
    { min: 50, level: "atencao", color: "warning",
      labelPt: "Nível de Saúde em Atenção", labelEn: "Health Level Needs Attention",
      devolutivaPt: "Sua empresa convive com um conjunto relevante de falhas operacionais e erros estratégicos (Intensidade total de falhas: {total}/{max}). A operação ainda entrega, mas o desgaste é constante e boa parte da energia da liderança é consumida corrigindo o que deveria funcionar sozinho.",
      devolutivaEn: "Your company lives with a significant set of operational failures and strategic errors (Total failure intensity: {total}/{max}). Operations still deliver, but the strain is constant and much of leadership's energy goes into correcting what should run on its own.",
      acaoImediataPt: "Ataque as falhas de maior intensidade primeiro, uma de cada vez. Escolha as três notas mais altas desta lista e trate cada uma como um projeto com responsável e prazo.",
      acaoImediataEn: "Attack the highest-intensity failures first, one at a time. Pick the three highest scores on this list and treat each as a project with an owner and a deadline." },
    { min: 0, level: "critico", color: "danger",
      labelPt: "Nível de Saúde Crítico", labelEn: "Critical Health Level",
      devolutivaPt: "Sua empresa acumula falhas operacionais e erros estratégicos em intensidade alta (Intensidade total de falhas: {total}/{max}). Nesse patamar os problemas deixam de ser pontuais e passam a se alimentar entre si — a operação consome a estratégia, e a sobrevivência do negócio está em risco.",
      devolutivaEn: "Your company is accumulating operational failures and strategic errors at high intensity (Total failure intensity: {total}/{max}). At this level problems stop being isolated and start feeding each other — operations consume strategy, and the survival of the business is at risk.",
      acaoImediataPt: "Pare de tratar sintomas. Escolha as duas falhas mais intensas e resolva-as antes de qualquer iniciativa nova. Se necessário, busque apoio externo para estruturar o básico.",
      acaoImediataEn: "Stop treating symptoms. Pick the two most intense failures and resolve them before starting anything new. If needed, bring in outside support to structure the basics." }
];

function falhasMaxIntensity() { return FALHAS_QUESTIONS.length * 10; }

// Health percentage from an intensity total over a given question count —
// the same formula the overall score uses, so the per-group bars in the
// chart cannot drift from the headline.
function falhasHealthPct(intensity, questionCount) {
    var max = questionCount * 10;
    if (!max) { return 0; }
    return 100 - Math.round((intensity / max) * 100);
}

// Pure scoring engine — answers is a flat { f1..f16, e1..e11: 0..10 } map.
function computeFalhasXrayScore(answers) {
    answers = answers || {};

    // INVERTED banding: for a failure, 0-3 (barely present) is Adequado and
    // 8-10 (strongly present) is Crítico.
    var dist = scale10Distribution(FALHAS_QUESTIONS, answers, true);

    var intensityTotal = 0;
    var questions = FALHAS_QUESTIONS.map(function(q) {
        var v = answers[q.key];
        var b = scale10Band(v, true);
        if (b) { intensityTotal += v; }
        return {
            key: q.key, group: q.group,
            namePt: q.namePt, nameEn: q.nameEn,
            labelPt: q.labelPt, labelEn: q.labelEn,
            value: b ? v : null,
            band: b ? b.key : null,
            color: b ? b.color : "muted",
            hex: b ? b.hex : SCALE10_UNANSWERED_HEX,
            bandLabelPt: b ? b.labelPt : null,
            bandLabelEn: b ? b.labelEn : null
        };
    });

    var maxIntensity = falhasMaxIntensity();
    var healthPct = falhasHealthPct(intensityTotal, FALHAS_QUESTIONS.length);

    var band = FALHAS_CUTOFFS[FALHAS_CUTOFFS.length - 1];
    for (var i = 0; i < FALHAS_CUTOFFS.length; i++) {
        if (healthPct >= FALHAS_CUTOFFS[i].min) { band = FALHAS_CUTOFFS[i]; break; }
    }
    function fill(s) {
        return s.replace("{total}", intensityTotal).replace("{max}", maxIntensity);
    }

    // Per-group rollup, scoped to that group's own question count.
    var groups = FALHAS_GROUPS.map(function(g) {
        var mine = questions.filter(function(q) { return q.group === g.key; });
        var sub = 0;
        mine.forEach(function(q) { if (q.value != null) { sub += q.value; } });
        return {
            key: g.key, namePt: g.namePt, nameEn: g.nameEn,
            shortPt: g.shortPt, shortEn: g.shortEn,
            count: mine.length,
            intensity: sub, maxIntensity: mine.length * 10,
            healthPct: falhasHealthPct(sub, mine.length)
        };
    });

    // Chart DATA only.
    //   Bar: efficiency per group, flat gray (NOT coloured by value) — it is a
    //        percentage, not a 0-10 answer, so the band colours would lie.
    //   Doughnut: the legacy tool reuses its binary Sim/Não/unanswered chart
    //        here, which does not fit a 0-10 instrument at all. Deliberately
    //        NOT ported: this uses the same three-band split as the
    //        "Distribuição do Resultado" section, inverted like everything
    //        else in this instrument.
    var charts = {
        groupBar: {
            titlePt: "Eficiência por Área (%)", titleEn: "Efficiency by Area (%)",
            yMin: 0, yMax: 100, flatHex: "#6c757d",
            bars: groups.map(function(g) {
                return { key: g.key, labelPt: g.shortPt, labelEn: g.shortEn,
                         value: g.healthPct, hex: "#6c757d" };
            })
        },
        bandDoughnut: {
            titlePt: "Distribuição do Resultado", titleEn: "Result Distribution",
            total: dist.total,
            slices: [
                { key: "vermelho",       labelPt: "Crítico (8-10)",  labelEn: "Critical (8-10)",  count: dist.vermelho,       hex: "#dc3545" },
                { key: "amarelo",        labelPt: "Atenção (4-7)",   labelEn: "Attention (4-7)",  count: dist.amarelo,        hex: "#ffc107" },
                { key: "verde",          labelPt: "Adequado (0-3)",  labelEn: "Adequate (0-3)",   count: dist.verde,          hex: "#28a745" },
                { key: "nao_respondido", labelPt: "Pendente",        labelEn: "Pending",          count: dist.nao_respondido, hex: SCALE10_UNANSWERED_HEX }
            ].map(function(s) {
                return Object.assign(s, { pct: dist.total ? Math.round((s.count / dist.total) * 100) : 0 });
            })
        }
    };

    return {
        version: 1,
        assessment_type: "falhas_xray",
        intensity_total: intensityTotal, max_intensity: maxIntensity,
        health_pct: healthPct,
        // Generic mirror for the admin row: "score" is health, not intensity,
        // so a higher number always reads as better wherever it is printed.
        score: healthPct, max_score: 100, pct: healthPct,
        overall: {
            level: band.level, color: band.color,
            labelPt: band.labelPt, labelEn: band.labelEn,
            headlinePt: band.labelPt + " (" + healthPct + "%)",
            headlineEn: band.labelEn + " (" + healthPct + "%)",
            devolutivaPt: fill(band.devolutivaPt), devolutivaEn: fill(band.devolutivaEn),
            acaoImediataPt: band.acaoImediataPt, acaoImediataEn: band.acaoImediataEn
        },
        maturity: {
            level: band.level, color: band.color,
            labelPt: band.labelPt, labelEn: band.labelEn
        },
        categories: questions,
        questions: questions,
        groups: groups,
        distribution: dist,
        charts: charts
    };
}

// ---------------------------------------------------------------------------
// Perception surveys — Feedback 360º and Pilares de Crescimento.
//
// Both are the SAME instrument shape: 7 Sim/Não questions, pct = Sim/7, one
// flat-gray area bar and one Sim/Não doughnut. Only the questions, the area
// label and the report copy differ, so they share one engine and one spec
// table rather than two near-identical copies.
//
// LEGACY QUIRK, reproduced deliberately (do NOT "fix"): every "Sim" counts as
// positive toward the percentage regardless of the question's real-world
// polarity. Feedback 360's question 6 asks whether avoidable waste EXISTS, so
// a "Sim" there is bad news in reality — but the legacy tool still scores it
// as a point, and all-Sim → 100% is verified. No polarity-aware inversion.
// ---------------------------------------------------------------------------

var PERCEPTION_BINARY_LEVELS = [
    { value: 0, key: "nao", color: "danger",  hex: "#dc3545", labelPt: "Não", labelEn: "No" },
    { value: 1, key: "sim", color: "success", hex: "#28a745", labelPt: "Sim", labelEn: "Yes" }
];

var PERCEPTION_SPECS = {
    feedback_360: {
        assessment_type: "feedback_360",
        areaLabelPt: "FINANCEIRO", areaLabelEn: "FINANCIAL",
        questions: [
            { key: "q1", namePt: "Organização financeira", nameEn: "Financial organization",
              labelPt: "Você acredita que a empresa possui organização financeira adequada para crescer?",
              labelEn: "Do you believe the company has adequate financial organization to grow?" },
            { key: "q2", namePt: "Controle de custos", nameEn: "Cost control",
              labelPt: "A empresa demonstra controle sobre custos e desperdícios?",
              labelEn: "Does the company demonstrate control over costs and waste?" },
            { key: "q3", namePt: "Eficiência no uso de recursos", nameEn: "Efficient use of resources",
              labelPt: "Os recursos da empresa são utilizados de forma eficiente?",
              labelEn: "Are the company's resources used efficiently?" },
            { key: "q4", namePt: "Clareza na precificação", nameEn: "Pricing clarity",
              labelPt: "Você percebe clareza na forma como a empresa define preços dos serviços/produtos?",
              labelEn: "Do you see clarity in how the company sets prices for its services/products?" },
            { key: "q5", namePt: "Saúde financeira", nameEn: "Financial health",
              labelPt: "A empresa parece financeiramente saudável e sustentável?",
              labelEn: "Does the company appear financially healthy and sustainable?" },
            { key: "q6", namePt: "Desperdícios evitáveis", nameEn: "Avoidable waste",
              labelPt: "Existem desperdícios financeiros que poderiam ser evitados?",
              labelEn: "Are there financial wastes that could be avoided?" },
            { key: "q7", namePt: "Decisões financeiras estratégicas", nameEn: "Strategic financial decisions",
              labelPt: "Você percebe decisões financeiras sendo tomadas de forma estratégica ou apenas reativa?",
              labelEn: "Do you see financial decisions being made strategically, or only reactively?" }
        ],
        devolutivaPt: "O Feedback 360 Financeiro indica um nível de confiança de {pct}% na gestão dos recursos.",
        devolutivaEn: "The 360 Financial Feedback indicates a {pct}% level of confidence in how resources are managed.",
        acaoPerfeitoPt: "Continue monitorando a eficiência do uso de recursos.",
        acaoPerfeitoEn: "Keep monitoring how efficiently resources are used.",
        acaoPadraoPt: "Revise os processos de controle de custos e desperdícios imediatamente.",
        acaoPadraoEn: "Review your cost- and waste-control processes immediately."
    },
    pilares_crescimento: {
        assessment_type: "pilares_crescimento",
        areaLabelPt: "CRESCIMENTO", areaLabelEn: "GROWTH",
        questions: [
            { key: "q1", namePt: "Visão de futuro", nameEn: "Vision for the future",
              labelPt: "A empresa tem visão clara de futuro?",
              labelEn: "Does the company have a clear vision for the future?" },
            { key: "q2", namePt: "Comunicação da visão", nameEn: "Communicating the vision",
              labelPt: "Os líderes comunicam essa visão de forma clara?",
              labelEn: "Do the leaders communicate that vision clearly?" },
            { key: "q3", namePt: "Motivação para crescer", nameEn: "Motivation to grow",
              labelPt: "Os colaboradores se sentem motivados a crescer dentro da empresa?",
              labelEn: "Do employees feel motivated to grow within the company?" },
            { key: "q4", namePt: "Desenvolvimento da equipe", nameEn: "Team development",
              labelPt: "Existe investimento em desenvolvimento da equipe?",
              labelEn: "Is there investment in developing the team?" },
            { key: "q5", namePt: "Inovação e oportunidades", nameEn: "Innovation and opportunities",
              labelPt: "A empresa busca inovação e novas oportunidades?",
              labelEn: "Does the company pursue innovation and new opportunities?" },
            { key: "q6", namePt: "Adaptação ao mercado", nameEn: "Adapting to the market",
              labelPt: "A empresa se adapta rapidamente às mudanças do mercado?",
              labelEn: "Does the company adapt quickly to changes in the market?" },
            { key: "q7", namePt: "Potencial de crescimento", nameEn: "Growth potential",
              labelPt: "Você acredita que a empresa tem potencial real de crescimento?",
              labelEn: "Do you believe the company has real growth potential?" }
        ],
        devolutivaPt: "Seus Pilares de Crescimento estão em {pct}%. Isso reflete a prontidão da empresa para escalar e sustentar o futuro.",
        devolutivaEn: "Your Growth Pillars are at {pct}%. That reflects the company's readiness to scale and sustain the future.",
        acaoPerfeitoPt: "Sua base está sólida para buscar novas parcerias e mercados.",
        acaoPerfeitoEn: "Your base is solid enough to pursue new partnerships and markets.",
        acaoPadraoPt: "Foque em comunicar melhor a visão e investir no desenvolvimento do time.",
        acaoPadraoEn: "Focus on communicating the vision better and investing in developing the team."
    }
};

// Band from the Sim percentage. Presentation only — the verified copy has
// exactly two Ação variants (100% and everything else), so the band drives
// the colour and label while the ação still branches on the two-way rule.
var PERCEPTION_CUTOFFS = [
    { min: 80, level: "forte",   color: "success",
      labelPt: "Percepção Forte",     labelEn: "Strong Perception" },
    { min: 50, level: "moderada", color: "warning",
      labelPt: "Percepção Moderada",  labelEn: "Moderate Perception" },
    { min: 0,  level: "fragil",   color: "danger",
      labelPt: "Percepção Frágil",    labelEn: "Fragile Perception" }
];

// Pure scoring engine, shared by both perception surveys.
function computePerceptionScore(type, answers) {
    var spec = PERCEPTION_SPECS[type];
    if (!spec) { return null; }
    answers = answers || {};

    var sim = 0, nao = 0, pendente = 0;
    var questions = spec.questions.map(function(q) {
        var v = answers[q.key];
        var answered = (v === 0 || v === 1);
        if (answered) { if (v === 1) { sim += 1; } else { nao += 1; } }
        else { pendente += 1; }
        var lvl = answered ? PERCEPTION_BINARY_LEVELS[v] : null;
        return {
            key: q.key, namePt: q.namePt, nameEn: q.nameEn,
            labelPt: q.labelPt, labelEn: q.labelEn,
            value: answered ? v : null,
            band: lvl ? lvl.key : null,
            color: lvl ? lvl.color : "muted",
            hex: lvl ? lvl.hex : SCALE10_UNANSWERED_HEX,
            bandLabelPt: lvl ? lvl.labelPt : null,
            bandLabelEn: lvl ? lvl.labelEn : null
        };
    });

    var total = spec.questions.length;
    // Every "Sim" is a point regardless of the question's real polarity —
    // see the LEGACY QUIRK note above. Denominator is the full bank, so an
    // unanswered question costs a point rather than shrinking the divisor.
    var pct = total ? Math.round((sim / total) * 100) : 0;

    var band = PERCEPTION_CUTOFFS[PERCEPTION_CUTOFFS.length - 1];
    for (var i = 0; i < PERCEPTION_CUTOFFS.length; i++) {
        if (pct >= PERCEPTION_CUTOFFS[i].min) { band = PERCEPTION_CUTOFFS[i]; break; }
    }

    var perfect = (pct === 100);
    var devolutivaPt = spec.devolutivaPt.replace("{pct}", pct);
    var devolutivaEn = spec.devolutivaEn.replace("{pct}", pct);

    // Chart DATA only.
    //   areaBar: ONE flat-gray bar for this instrument's area.
    //     NOTE: in the legacy tool this bar did NOT match the headline (both
    //     surveys scored 4 Sim/3 Não = 57%, yet showed 40 and 50
    //     respectively). Identical answers producing different bars means the
    //     legacy value is not a function of the responses at all — almost
    //     certainly a leftover denominator from another question bank, the
    //     same copy-paste family as the Sim/Não doughnut it wrongly reuses on
    //     Falhas. Rather than reproduce an underivable number, the bar is the
    //     headline percentage. Flagged as an unrecovered formula.
    //   responseDoughnut: Sim / Não / Não respondidas — verified to match the
    //     headline exactly (4 Sim/3 Não → [4,3,0] → 57/43/0%).
    var charts = {
        areaBar: {
            titlePt: "Eficiência por Área (%)", titleEn: "Efficiency by Area (%)",
            yMin: 0, yMax: 100, flatHex: "#6c757d",
            bars: [{ key: "area", labelPt: spec.areaLabelPt, labelEn: spec.areaLabelEn,
                     value: pct, hex: "#6c757d" }]
        },
        responseDoughnut: {
            titlePt: "Distribuição das Respostas", titleEn: "Response Distribution",
            total: total,
            slices: [
                { key: "sim",            labelPt: "Sim",             labelEn: "Yes",        count: sim,      hex: "#4bc0c0" },
                { key: "nao",            labelPt: "Não",             labelEn: "No",         count: nao,      hex: "#dc3545" },
                { key: "nao_respondido", labelPt: "Não respondidas", labelEn: "Unanswered", count: pendente, hex: SCALE10_UNANSWERED_HEX }
            ].map(function(s) {
                return Object.assign(s, { pct: total ? Math.round((s.count / total) * 100) : 0 });
            })
        }
    };

    return {
        version: 1,
        assessment_type: spec.assessment_type,
        score: sim, max_score: total, pct: pct,
        overall: {
            level: band.level, color: band.color,
            labelPt: band.labelPt, labelEn: band.labelEn,
            devolutivaPt: devolutivaPt, devolutivaEn: devolutivaEn,
            acaoImediataPt: perfect ? spec.acaoPerfeitoPt : spec.acaoPadraoPt,
            acaoImediataEn: perfect ? spec.acaoPerfeitoEn : spec.acaoPadraoEn
        },
        maturity: {
            level: band.level, color: band.color,
            labelPt: band.labelPt, labelEn: band.labelEn
        },
        categories: questions,
        questions: questions,
        distribution: { sim: sim, nao: nao, nao_respondido: pendente, total: total },
        charts: charts
    };
}

function computeAssessmentScore(type, answers) {
    if (type === "business_xray")   { return computeXrayScore(answers); }
    if (type === "management_xray") { return computeManagementXrayScore(answers); }
    if (type === "leadership_xray") { return computeLeadershipXrayScore(answers); }
    if (type === "permissividade_xray") { return computePermissividadeXrayScore(answers); }
    if (type === "falhas_xray")     { return computeFalhasXrayScore(answers); }
    if (PERCEPTION_SPECS[type])     { return computePerceptionScore(type, answers); }
    return null;
}

// Answered-question count for a stored answers map, scoped to the catalog
// (stray keys from an older bank never inflate the count).
function assessmentAnsweredCount(type, answers) {
    var catalog = assessmentCatalog(type);
    if (!catalog) { return 0; }
    var n = 0;
    catalog.questions.forEach(function(q) {
        if (assessmentScaleAccepts(catalog, answers[q.key])) { n += 1; }
    });
    return n;
}

// ── Practice-profile helpers (Part 2) ──────────────────────────────────────
// profile is { <activity_key>: { <dimension_key>: value } }. Counts and
// validation cover REQUIRED dimensions only; the optional free-text ones
// never block completion.

function xrayProfileRequiredDims() {
    return XRAY_PROFILE_DIMENSIONS.filter(function(d) { return d.required; });
}

function xrayProfileRequiredTotal() {
    return XRAY_PROFILE_ACTIVITIES.length * xrayProfileRequiredDims().length;
}

function xrayProfileDimAnswered(dim, entry) {
    if (!entry) { return false; }
    var v = entry[dim.key];
    if (dim.type === "choice") {
        return dim.options.some(function(o) { return o.key === v; });
    }
    return typeof v === "string" && v.trim().length > 0;
}

function xrayProfileAnsweredCount(profile) {
    profile = profile || {};
    var required = xrayProfileRequiredDims();
    var n = 0;
    XRAY_PROFILE_ACTIVITIES.forEach(function(act) {
        required.forEach(function(dim) {
            if (xrayProfileDimAnswered(dim, profile[act.key])) { n += 1; }
        });
    });
    return n;
}

// Merge an incoming profile draft into the stored one, accepting only known
// activity/dimension keys, valid choice values, and length-capped text.
function xrayMergeProfile(prev, incoming) {
    var merged = {};
    var dimByKey = {};
    XRAY_PROFILE_DIMENSIONS.forEach(function(d) { dimByKey[d.key] = d; });
    XRAY_PROFILE_ACTIVITIES.forEach(function(act) {
        var entry = Object.assign({}, (prev && prev[act.key]) || {});
        var inc = incoming && incoming[act.key];
        if (inc && typeof inc === "object") {
            Object.keys(inc).forEach(function(dk) {
                var dim = dimByKey[dk];
                if (!dim) { return; }
                var v = inc[dk];
                if (dim.type === "choice") {
                    if (dim.options.some(function(o) { return o.key === v; })) { entry[dk] = v; }
                    else if (v === null || v === "") { delete entry[dk]; }
                } else if (typeof v === "string") {
                    entry[dk] = v.slice(0, 2000);
                }
            });
        }
        if (Object.keys(entry).length > 0) { merged[act.key] = entry; }
    });
    return merged;
}

// ---------------------------------------------------------------------------
// Route: GET /api/clients/:id/assessments — assignment list (admin + own client)
// ---------------------------------------------------------------------------

async function handleGetClientAssessments(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        var rows = await env.DB.prepare(
            "SELECT assessment_type, status, answers_json, profile_json, score_json, activated_by, activated_at, started_at, completed_at " +
            "FROM client_assessments WHERE client_id = ? ORDER BY activated_at"
        ).bind(id).all();
        var out = (rows.results || []).map(function(r) {
            var typeMeta = ASSESSMENT_TYPES[r.assessment_type] || { labelPt: r.assessment_type, labelEn: r.assessment_type };
            var answers = {};
            try { answers = JSON.parse(r.answers_json || "{}"); } catch (e) { answers = {}; }
            var profile = {};
            try { profile = JSON.parse(r.profile_json || "{}"); } catch (e) { profile = {}; }
            var catalog = assessmentCatalog(r.assessment_type);
            var summary = null;
            if (r.status === "completed" && r.score_json) {
                try {
                    var sc = JSON.parse(r.score_json);
                    summary = { score: sc.score, max_score: sc.max_score, pct: sc.pct, maturity: sc.maturity };
                } catch (e) { summary = null; }
            }
            return {
                assessment_type: r.assessment_type,
                labelPt: typeMeta.labelPt, labelEn: typeMeta.labelEn,
                status: r.status,
                answered: assessmentAnsweredCount(r.assessment_type, answers),
                total: catalog ? catalog.total : 0,
                // Only the Business X-Ray catalog declares profile activities;
                // every other type reports a clean 0/0 rather than the
                // Business X-Ray's totals against an empty profile.
                profile_answered: (catalog && catalog.profile_activities) ? xrayProfileAnsweredCount(profile) : 0,
                profile_required_total: (catalog && catalog.profile_activities) ? xrayProfileRequiredTotal() : 0,
                activated_by: r.activated_by, activated_at: r.activated_at,
                started_at: r.started_at, completed_at: r.completed_at,
                score_summary: summary
            };
        });
        return jsonOk({ assessments: out });
    } catch (e) {
        return jsonErr("Error fetching assessments: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/clients/:id/assessments — admin: activate an assessment
// Body: { type: 'business_xray' }. Row existence = activated (mirrors the
// client_logins pattern). 409 if already active.
// ---------------------------------------------------------------------------

async function handlePostClientAssessment(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!isAdminRole(user)) { return jsonErr("Forbidden", 403); }
        var body = await request.json();
        var type = body && body.type;
        if (!type || !ASSESSMENT_TYPES[type]) { return jsonErr("Unknown assessment type", 400); }
        var client = await env.DB.prepare("SELECT id FROM clients WHERE id = ?").bind(id).first();
        if (!client) { return jsonErr("Client not found", 404); }
        var existing = await env.DB.prepare(
            "SELECT id FROM client_assessments WHERE client_id = ? AND assessment_type = ?"
        ).bind(id, type).first();
        if (existing) { return jsonErr("Assessment already activated for this client", 409); }
        await env.DB.prepare(
            "INSERT INTO client_assessments (id, client_id, assessment_type, status, activated_by) VALUES (?, ?, ?, 'not_started', ?)"
        ).bind(crypto.randomUUID(), id, type, user.display_name || user.role).run();
        // Business X-Ray assigned to a lead → "Raio X enviado" (no-op for real
        // clients). Type-scoped on purpose: the lead pipeline's "Raio X" stages
        // track that instrument only, so assigning ANY other assessment
        // (Gestão, Liderança, Permissividade, Falhas, Feedback 360, Pilares)
        // must leave the prospect's stage exactly where it was.
        if (assessmentAdvancesLeadStage(type)) {
            await advanceLeadStage(env, id, "Raio X enviado", actorName(user), "auto:xray_assigned");
        }
        return jsonOk({ activated: true, assessment_type: type, status: "not_started" });
    } catch (e) {
        return jsonErr("Error activating assessment: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: DELETE /api/clients/:id/assessments/:type — admin: deactivate.
// Removes the assignment AND its answers (used for test cleanup / mistakes).
// ---------------------------------------------------------------------------

async function handleDeleteClientAssessment(id, type, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!isAdminRole(user)) { return jsonErr("Forbidden", 403); }
        await env.DB.prepare(
            "DELETE FROM client_assessments WHERE client_id = ? AND assessment_type = ?"
        ).bind(id, type).run();
        return jsonOk({ deleted: true });
    } catch (e) {
        return jsonErr("Error deactivating assessment: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/clients/:id/assessments/:type — full state for the portal:
// assignment row + question catalog + saved answers (+ score once completed).
// ---------------------------------------------------------------------------

async function handleGetClientAssessmentDetail(id, type, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        var catalog = assessmentCatalog(type);
        if (!catalog) { return jsonErr("Unknown assessment type", 400); }
        var row = await env.DB.prepare(
            "SELECT status, answers_json, profile_json, score_json, activated_at, started_at, completed_at " +
            "FROM client_assessments WHERE client_id = ? AND assessment_type = ?"
        ).bind(id, type).first();
        if (!row) { return jsonErr("Assessment not activated for this client", 404); }
        var answers = {};
        try { answers = JSON.parse(row.answers_json || "{}"); } catch (e) { answers = {}; }
        var profile = {};
        try { profile = JSON.parse(row.profile_json || "{}"); } catch (e) { profile = {}; }
        var score = null;
        if (row.score_json) {
            try { score = JSON.parse(row.score_json); } catch (e) { score = null; }
        }
        return jsonOk({
            assessment_type: type,
            status: row.status,
            activated_at: row.activated_at, started_at: row.started_at, completed_at: row.completed_at,
            answers: answers,
            answered: assessmentAnsweredCount(type, answers),
            total: catalog.total,
            profile: profile,
            profile_answered: catalog.profile_activities ? xrayProfileAnsweredCount(profile) : 0,
            profile_required_total: catalog.profile_activities ? xrayProfileRequiredTotal() : 0,
            catalog: catalog,
            score: score
        });
    } catch (e) {
        return jsonErr("Error fetching assessment: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: PUT /api/clients/:id/assessments/:type/answers
// Body: { draft: bool, answers: { question_key: 0|1 } }
// draft=true  → partial autosave: merge into stored answers, never validates
//               completeness (62 questions on a phone won't happen in one
//               sitting — mirrors the daily-entry draft pattern).
// draft=false → submit: requires every question answered, runs the scoring
//               engine and freezes score_json. A completed assessment is
//               immutable (writes return already_completed).
// ---------------------------------------------------------------------------

async function handlePutAssessmentAnswers(id, type, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        var catalog = assessmentCatalog(type);
        if (!catalog) { return jsonErr("Unknown assessment type", 400); }
        var row = await env.DB.prepare(
            "SELECT id, status, answers_json, profile_json FROM client_assessments WHERE client_id = ? AND assessment_type = ?"
        ).bind(id, type).first();
        if (!row) { return jsonErr("Assessment not activated for this client", 404); }
        if (row.status === "completed") {
            return jsonOk({ saved: false, already_completed: true });
        }

        var body = await request.json();
        var isDraft = !(body && body.draft === false);
        var incoming = (body && body.answers) || {};
        var validKeys = {};
        catalog.questions.forEach(function(q) { validKeys[q.key] = true; });

        var prev = {};
        try { prev = JSON.parse(row.answers_json || "{}"); } catch (e) { prev = {}; }
        var merged = Object.assign({}, prev);
        // Accepted values come from the catalog's declared scale, never from a
        // hardcoded 0|1 — a ternary instrument stores 2 through the same path.
        // Legacy true/false payloads still collapse to 1/0 on binary scales.
        Object.keys(incoming).forEach(function(k) {
            if (!validKeys[k]) { return; }
            var v = incoming[k];
            if (catalog.scale.coerceBool) {
                if (v === true)  { v = 1; }
                if (v === false) { v = 0; }
            }
            if (assessmentScaleAccepts(catalog, v)) { merged[k] = v; }
        });

        // Practice profile (Part 2): merged and stored in its own column,
        // NEVER handed to the scoring engine below. Only the Business X-Ray
        // declares profile sections — for any other type this stays {} / 0-of-0
        // so the completion gate below is a no-op rather than an impossible bar.
        var hasProfile = !!catalog.profile_activities;
        var prevProfile = {};
        try { prevProfile = JSON.parse(row.profile_json || "{}"); } catch (e) { prevProfile = {}; }
        var mergedProfile = hasProfile ? xrayMergeProfile(prevProfile, (body && body.profile) || null) : prevProfile;
        var profileAnswered = hasProfile ? xrayProfileAnsweredCount(mergedProfile) : 0;
        var profileTotal = hasProfile ? xrayProfileRequiredTotal() : 0;

        var answered = assessmentAnsweredCount(type, merged);
        if (isDraft) {
            var status = (answered > 0 || profileAnswered > 0) ? "in_progress" : "not_started";
            await env.DB.prepare(
                "UPDATE client_assessments SET answers_json = ?, profile_json = ?, status = ?, " +
                "started_at = CASE WHEN started_at IS NULL AND ? > 0 THEN datetime('now') ELSE started_at END, " +
                "updated_at = datetime('now') WHERE id = ?"
            ).bind(JSON.stringify(merged), JSON.stringify(mergedProfile), status, answered + profileAnswered, row.id).run();
            return jsonOk({ saved: true, draft: true, answered: answered, total: catalog.total,
                            profile_answered: profileAnswered, profile_required_total: profileTotal });
        }

        if (answered < catalog.total) {
            return jsonErr("Ainda faltam " + (catalog.total - answered) + " perguntas para concluir", 400);
        }
        if (profileAnswered < profileTotal) {
            return jsonErr("Ainda faltam " + (profileTotal - profileAnswered) + " campos das seções de prática para concluir", 400);
        }
        // Score is computed from the 62 Sim/Não answers ONLY — the practice
        // profile is stored alongside but never influences score/pct/band.
        var score = computeAssessmentScore(type, merged);
        await env.DB.prepare(
            "UPDATE client_assessments SET answers_json = ?, profile_json = ?, score_json = ?, status = 'completed', " +
            "started_at = COALESCE(started_at, datetime('now')), " +
            "completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
        ).bind(JSON.stringify(merged), JSON.stringify(mergedProfile), JSON.stringify(score), row.id).run();
        // X-Ray submitted → "Raio X recebido", the stage flagged in the UI as
        // Alice's cue to act (schedule the meeting). The two "Raio X" lead
        // stages mean the BUSINESS X-Ray specifically, so no other instrument
        // may move a lead's pipeline stage.
        //
        // ATTRIBUTION CAVEAT: this handler is requireClientAccess, not
        // isAdminRole — the person submitting is normally the CLIENT filling in
        // their own X-Ray, not Alice or Rafa. So the actor recorded here is
        // 'client' for a client-role submitter, and only a real Apex name when
        // an admin submits on their behalf. Stamping an Apex name on every
        // submission would be exactly the confident-wrong-answer this whole
        // build exists to prevent.
        if (assessmentAdvancesLeadStage(type)) {
            var xrayActor = user.role === "client" ? "client" : actorName(user);
            await advanceLeadStage(env, id, "Raio X recebido", xrayActor, "auto:xray_submitted");
        }
        return jsonOk({ saved: true, completed: true, score: score });
    } catch (e) {
        return jsonErr("Error saving assessment answers: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// APEX Growth Management (Part 1) — the six data tabs that port the 7-month
// Google Sheets engagement workbook into the client portal.
//
// DATA TIER NOTE: gm_leads rows are the CLIENT's own customers (e.g. LIRA's
// paver leads) — one tier below the clients table, and completely unrelated
// to clients.status = 'lead' (the consultancy's own prospect flag).
//
// THE METHOD (fixed for every client — never configurable):
//   - the 8 pipeline stages below,
//   - "pipeline ativo" = the 3 stages in GM_ACTIVE_PIPELINE_STAGES,
//   - the Entrada/Saída category model with tipo DERIVED from categoria,
//   - the 5-minute first-contact SLA and 24-hour estimate SLA.
// Per-client configurable (gm_config, seeded with the LIRA defaults):
//   SERVIÇO list, VENDEDOR list, finance categories, partner types, cycle
//   months, target margin %, pipeline view threshold.
// ---------------------------------------------------------------------------

var GM_STAGES = ["Novo Lead", "Contato Feito", "Visita Agendada", "Estimate Enviado", "Follow-up", "Negociação", "Fechado", "Perdido"];
// Pipeline ativo ($) sums VALOR over EXACTLY these three stages — Visita
// Agendada and Contato Feito deliberately do NOT count (the client's rule).
var GM_ACTIVE_PIPELINE_STAGES = ["Estimate Enviado", "Follow-up", "Negociação"];
// "Live" leads for the pipeline view-mode threshold: everything except
// Fechado and Perdido. Closed/lost history must never force the crowded-
// pipeline chip-rail view on someone managing 20 live leads.
var GM_LIVE_STAGES = ["Novo Lead", "Contato Feito", "Visita Agendada", "Estimate Enviado", "Follow-up", "Negociação"];
var GM_ORIGENS = ["Orgânico", "Tráfego pago", "Indicação", "Base de Clientes", "Parceiro", "Google", "Instagram", "Site", "Outro"];
var GM_ROADMAP_STATUSES = ["Realizado", "Em andamento", "Pendente", "Atrasado", "Cancelado"];
var GM_FRENTES = ["Comercial", "Gestão", "Base de Ouro", "Financeiro", "Parcerias", "Marketing", "Operação"];
var GM_BASE_OURO_STATUSES = ["Não contatado", "Contatado", "Interessado", "Reativado", "Sem interesse"];
var GM_PARTNER_STATUSES = ["Prospectando", "Ativo", "Inativo"];
var GM_JOB_STATUSES = ["Em andamento", "Concluída", "Atrasada", "Pausada"];

// LIRA seed defaults for the per-client configurable lists.
var GM_DEFAULT_SERVICOS = ["Pavers", "Pergola", "Outdoor Kitchen", "Fire Pit", "Turf", "Travertine", "Lighting", "Landscape", "Living Area", "Combo", "Sealer"];
var GM_DEFAULT_VENDEDORES = ["Anderson", "Ana"];
var GM_DEFAULT_PARTNER_TYPES = ["Pool", "Screen", "Realtor", "Builder", "Landscaper", "Designer", "Arquiteto", "Outro"];
var GM_DEFAULT_CYCLE_MONTHS = ["Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro", "Janeiro"];
// The Entrada/Saída derivation table — tipo comes from HERE (or a client's
// configured copy), never from a request body.
var GM_DEFAULT_FINANCE_CATEGORIES = [
    { name: "Recebimento de obra",        tipo: "Entrada" },
    { name: "Outras receitas",            tipo: "Entrada" },
    { name: "Material de obra",           tipo: "Saída" },
    { name: "Mão de obra / equipe",       tipo: "Saída" },
    { name: "Combustível / veículos",     tipo: "Saída" },
    { name: "Equipamentos / ferramentas", tipo: "Saída" },
    { name: "Marketing / tráfego pago",   tipo: "Saída" },
    { name: "Software / plataformas",     tipo: "Saída" },
    { name: "Seguro / licenças",          tipo: "Saída" },
    { name: "Impostos / taxas",           tipo: "Saída" },
    { name: "Pró-labore / retiradas",     tipo: "Saída" },
    { name: "Administrativo / escritório", tipo: "Saída" },
    { name: "Frete / descarte",           tipo: "Saída" },
    { name: "Outros",                     tipo: "Saída" }
];

// The four client-editable lists (servicos, vendedores, partner_types, cycle_months).
// An empty stored array is a REAL value: the client deliberately cleared the list, and
// clearing it must stick. Only a genuinely unconfigured column — NULL, empty string,
// unparseable JSON, or a non-array — falls back to the seed defaults. The write side
// (setList in handlePutGmConfig) already stores [] faithfully; this is the matching
// read side.
function gmParseJsonList(s, fallback) {
    try {
        var v = JSON.parse(s);
        if (Object.prototype.toString.call(v) === "[object Array]") { return v; }
    } catch (e) {}
    return fallback;
}

// finance_categories deliberately differs from the four lists above: it is admin-only
// (handlePutGmConfig gates it behind isAdmin) and it drives the Entrada/Saída derivation
// for every finance entry, so an empty list would leave a client unable to categorise
// anything. An empty stored array is therefore treated as "unset" here and falls back to
// GM_DEFAULT_FINANCE_CATEGORIES.
function gmParseJsonListNonEmpty(s, fallback) {
    var v = gmParseJsonList(s, null);
    if (v && v.length) { return v; }
    return fallback;
}

// Load (and lazily seed with the LIRA defaults) a client's gm_config row.
async function gmGetConfig(env, clientId) {
    var row = await env.DB.prepare("SELECT * FROM gm_config WHERE client_id = ?").bind(clientId).first();
    if (!row) {
        await env.DB.prepare(
            "INSERT INTO gm_config (client_id, servicos_json, vendedores_json, finance_categories_json, partner_types_json, cycle_months_json) " +
            "VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (client_id) DO NOTHING"
        ).bind(
            clientId,
            JSON.stringify(GM_DEFAULT_SERVICOS),
            JSON.stringify(GM_DEFAULT_VENDEDORES),
            JSON.stringify(GM_DEFAULT_FINANCE_CATEGORIES),
            JSON.stringify(GM_DEFAULT_PARTNER_TYPES),
            JSON.stringify(GM_DEFAULT_CYCLE_MONTHS)
        ).run();
        row = await env.DB.prepare("SELECT * FROM gm_config WHERE client_id = ?").bind(clientId).first();
    }
    return {
        servicos:            gmParseJsonList(row.servicos_json, GM_DEFAULT_SERVICOS),
        vendedores:          gmParseJsonList(row.vendedores_json, GM_DEFAULT_VENDEDORES),
        finance_categories:  gmParseJsonListNonEmpty(row.finance_categories_json, GM_DEFAULT_FINANCE_CATEGORIES),
        partner_types:       gmParseJsonList(row.partner_types_json, GM_DEFAULT_PARTNER_TYPES),
        cycle_months:        gmParseJsonList(row.cycle_months_json, GM_DEFAULT_CYCLE_MONTHS),
        target_margin:       row.target_margin,
        pipeline_view_threshold: row.pipeline_view_threshold,
        pipeline_view_override:  row.pipeline_view_override || null
    };
}

function gmStr(v, max) {
    if (typeof v !== "string") { return null; }
    var s = v.trim();
    if (!s) { return null; }
    return s.slice(0, max || 500);
}

function gmNum(v) {
    if (v === null || v === undefined || v === "") { return null; }
    var n = Number(v);
    return isFinite(n) ? n : null;
}

// tipo is a pure function of categoria — the ONLY way a gm_finance row gets
// its tipo. Request bodies never carry it.
function gmFinanceTipo(config, categoria) {
    for (var i = 0; i < config.finance_categories.length; i++) {
        var c = config.finance_categories[i];
        if (c && c.name === categoria) { return c.tipo === "Entrada" ? "Entrada" : "Saída"; }
    }
    return null;
}

async function gmOwnedRow(env, table, rowId, clientId) {
    // table names come from code, never from the request
    return env.DB.prepare("SELECT * FROM " + table + " WHERE id = ? AND client_id = ?")
        .bind(rowId, clientId).first();
}

// Dynamic-SET updates bind a variable-length array; .bind must keep the
// prepared statement as its `this`.
async function gmRunUpdate(env, sql, binds) {
    var stmt = env.DB.prepare(sql);
    return stmt.bind.apply(stmt, binds).run();
}

// ---------------------------------------------------------------------------
// Route: GET /api/clients/:id/gm/config — configurable lists + method constants
// ---------------------------------------------------------------------------

async function handleGetGmConfig(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        var config = await gmGetConfig(env, id);
        var referralTemplateRow = await env.DB.prepare(
            "SELECT template_text FROM message_templates WHERE template_key = ?"
        ).bind("partner_referral_share").first();
        var referralTemplateText = (referralTemplateRow && referralTemplateRow.template_text)
            ? referralTemplateRow.template_text
            : DEFAULT_WHATSAPP_TEMPLATES.partner_referral_share;
        return jsonOk({
            config: config,
            referral_share_template: referralTemplateText,
            method: {
                stages: GM_STAGES,
                active_pipeline_stages: GM_ACTIVE_PIPELINE_STAGES,
                live_stages: GM_LIVE_STAGES,
                origens: GM_ORIGENS,
                roadmap_statuses: GM_ROADMAP_STATUSES,
                frentes: GM_FRENTES,
                base_ouro_statuses: GM_BASE_OURO_STATUSES,
                partner_statuses: GM_PARTNER_STATUSES,
                job_statuses: GM_JOB_STATUSES
            }
        });
    } catch (e) {
        return jsonErr("Error fetching GM config: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: PUT /api/clients/:id/gm/config — per-client lists/settings.
//
// Mixed gate. A client may write ONLY the four presentation lists for their
// own client_id (servicos, vendedores, partner_types, cycle_months) — these
// are theirs: their services are what their partners' customers see on the
// public referral page, and the other three are optional rows on their own
// sheets. Everything else stays admin-only: finance_categories drives the
// Entrada/Saída derivation, and target_margin / pipeline_view_threshold are
// consultancy settings. A client sending those is not an error — the keys are
// simply ignored, so a client UI can PUT the whole config object safely.
// ---------------------------------------------------------------------------

async function handlePutGmConfig(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        var isAdmin = isAdminRole(user);
        if (!isAdmin && !requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        await gmGetConfig(env, id);   // ensure the row exists
        var body = {};
        try { body = await request.json(); } catch (e2) { body = {}; }
        var sets = [], binds = [];
        function listOfStrings(v) {
            if (Object.prototype.toString.call(v) !== "[object Array]") { return null; }
            var out = [];
            for (var i = 0; i < v.length; i++) {
                var s = gmStr(v[i], 80);
                if (s) { out.push(s); }
            }
            return out;
        }
        // Key absent → leave the list alone. Key present but empty → clear it.
        // Turning a list off IS the empty case, so an empty array must store []
        // rather than being silently ignored (which used to return success and
        // change nothing). Applies to admins too, which is the same intent.
        function setList(key, column) {
            if (typeof body[key] === "undefined") { return; }
            var list = listOfStrings(body[key]);
            if (list === null) { return; }   // present but not an array — ignore
            sets.push(column + " = ?");
            binds.push(JSON.stringify(list));
        }
        setList("servicos", "servicos_json");
        setList("vendedores", "vendedores_json");
        setList("partner_types", "partner_types_json");
        setList("cycle_months", "cycle_months_json");
        if (isAdmin && Object.prototype.toString.call(body.finance_categories) === "[object Array]") {
            var cats = [];
            for (var i = 0; i < body.finance_categories.length; i++) {
                var c = body.finance_categories[i] || {};
                var name = gmStr(c.name, 80);
                if (!name) { continue; }
                cats.push({ name: name, tipo: c.tipo === "Entrada" ? "Entrada" : "Saída" });
            }
            if (cats.length) { sets.push("finance_categories_json = ?"); binds.push(JSON.stringify(cats)); }
        }
        var tm = isAdmin ? gmNum(body.target_margin) : null;
        if (tm !== null && tm >= 0 && tm <= 100) { sets.push("target_margin = ?"); binds.push(tm); }
        var thr = isAdmin ? gmNum(body.pipeline_view_threshold) : null;
        if (thr !== null && thr >= 1) { sets.push("pipeline_view_threshold = ?"); binds.push(Math.round(thr)); }
        if (!sets.length) { return jsonErr("Nothing to update", 400); }
        sets.push("updated_at = datetime('now')");
        binds.push(id);
        await gmRunUpdate(env, "UPDATE gm_config SET " + sets.join(", ") + " WHERE client_id = ?", binds);
        var config = await gmGetConfig(env, id);
        return jsonOk({ saved: true, config: config });
    } catch (e) {
        return jsonErr("Error saving GM config: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: PUT /api/clients/:id/gm/config/view-mode — the client's persisted
// manual pipeline-view toggle (overrides the automatic threshold both ways)
// ---------------------------------------------------------------------------

async function handlePutGmViewMode(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        await gmGetConfig(env, id);
        var body = {};
        try { body = await request.json(); } catch (e2) { body = {}; }
        var override = null;
        if (body.override === "stacked" || body.override === "rail") { override = body.override; }
        await env.DB.prepare(
            "UPDATE gm_config SET pipeline_view_override = ?, updated_at = datetime('now') WHERE client_id = ?"
        ).bind(override, id).run();
        return jsonOk({ saved: true, pipeline_view_override: override });
    } catch (e) {
        return jsonErr("Error saving view mode: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/clients/:id/gm/leads — pipeline + summary metrics
// ---------------------------------------------------------------------------
// Summary lives in SQL so the definitions are auditable in one place:
//   - pipeline ativo sums EXACTLY Estimate Enviado / Follow-up / Negociação
//   - the two SLA counts are computed correctly here (the source spreadsheet's
//     formulas were #REF! and silently returned 0 — do not "preserve" that)
//   - live_count feeds the view-mode threshold and EXCLUDES Fechado/Perdido

async function handleGetGmLeads(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        // contatos_count / primeiro_contato are DERIVED from the outreach log
        // on every read and never stored on the lead: the sheet shows the
        // follow-up count and the first-contacted age, and a stored copy of
        // either would drift the moment a log row is added or removed.
        // COALESCE keeps the old hand-entered data_contato meaningful for
        // leads that predate the log — see gmLeadPrimeiroContato in gm.js.
        var rows = await env.DB.prepare(
            "SELECT l.*, p.name AS parceiro_name, " +
            "(SELECT COUNT(*) FROM gm_lead_contacts c WHERE c.lead_id = l.id) AS contatos_count, " +
            "(SELECT MIN(c.logged_at) FROM gm_lead_contacts c WHERE c.lead_id = l.id) AS primeiro_contato " +
            "FROM gm_leads l " +
            "LEFT JOIN gm_partners p ON p.id = l.parceiro_id " +
            "WHERE l.client_id = ? " +
            "ORDER BY COALESCE(l.data_lead, l.created_at) DESC"
        ).bind(id).all();
        var summary = await env.DB.prepare(
            "SELECT COUNT(*) AS leads_totais, " +
            "SUM(CASE WHEN estagio IN ('Estimate Enviado','Follow-up','Negociação') THEN COALESCE(valor,0) ELSE 0 END) AS pipeline_ativo, " +
            "SUM(CASE WHEN estagio = 'Fechado' THEN COALESCE(valor,0) ELSE 0 END) AS receita_fechada, " +
            "SUM(CASE WHEN estagio = 'Fechado' THEN 1 ELSE 0 END) AS fechados, " +
            "SUM(CASE WHEN data_lead IS NOT NULL AND data_contato IS NOT NULL " +
            "AND (julianday(data_contato) - julianday(data_lead)) * 1440.0 > 5.0 THEN 1 ELSE 0 END) AS fora_sla_contato, " +
            "SUM(CASE WHEN data_lead IS NOT NULL AND data_estimate IS NOT NULL " +
            "AND (julianday(data_estimate) - julianday(data_lead)) > 1.0 THEN 1 ELSE 0 END) AS fora_sla_estimate, " +
            "SUM(CASE WHEN estagio NOT IN ('Fechado','Perdido') THEN 1 ELSE 0 END) AS live_count " +
            "FROM gm_leads WHERE client_id = ?"
        ).bind(id).first();
        var leadsTotais = (summary && summary.leads_totais) || 0;
        var fechados = (summary && summary.fechados) || 0;
        return jsonOk({
            leads: (rows.results || []),
            summary: {
                leads_totais: leadsTotais,
                pipeline_ativo: (summary && summary.pipeline_ativo) || 0,
                receita_fechada: (summary && summary.receita_fechada) || 0,
                fechados: fechados,
                conversao_pct: leadsTotais > 0 ? Math.round((fechados / leadsTotais) * 1000) / 10 : null,
                fora_sla_contato: (summary && summary.fora_sla_contato) || 0,
                fora_sla_estimate: (summary && summary.fora_sla_estimate) || 0,
                live_count: (summary && summary.live_count) || 0
            }
        });
    } catch (e) {
        return jsonErr("Error fetching leads: " + e.message, 500);
    }
}

// Shared field extraction for lead create/update. Returns { fields, error }.
// partial=true (PUT) only touches keys present in the body.
async function gmLeadFields(body, config, partial, env, clientId) {
    var out = {};
    function has(k) { return Object.prototype.hasOwnProperty.call(body, k); }
    if (!partial || has("cliente")) {
        var cliente = gmStr(body.cliente, 200);
        if (!cliente) { return { error: "CLIENTE é obrigatório" }; }
        out.cliente = cliente;
    }
    if (!partial || has("estagio")) {
        var estagio = body.estagio === undefined || body.estagio === null ? "Novo Lead" : body.estagio;
        if (GM_STAGES.indexOf(estagio) === -1) { return { error: "Estágio inválido" }; }
        out.estagio = estagio;
    }
    if (has("origem")) {
        out.origem = body.origem === null ? null : (GM_ORIGENS.indexOf(body.origem) !== -1 ? body.origem : null);
        if (body.origem !== null && out.origem === null) { return { error: "Origem inválida" }; }
    }
    if (has("parceiro_id")) {
        if (body.parceiro_id === null || body.parceiro_id === "") {
            out.parceiro_id = null;
        } else {
            var partner = await gmOwnedRow(env, "gm_partners", String(body.parceiro_id), clientId);
            if (!partner) { return { error: "Parceiro não encontrado" }; }
            out.parceiro_id = partner.id;
        }
    }
    var strFields = [
        ["mes_lead", 40], ["data_lead", 40], ["telefone", 60], ["email", 200], ["servico", 400],
        ["observacao", 2000], ["vendedor", 80], ["data_contato", 40],
        ["data_estimate", 40], ["proxima_acao", 500], ["mes_fechamento", 40]
    ];
    for (var i = 0; i < strFields.length; i++) {
        var k = strFields[i][0];
        if (has(k)) { out[k] = body[k] === null ? null : gmStr(body[k], strFields[i][1]); }
    }
    if (has("valor")) { out.valor = gmNum(body.valor); }
    if (has("followups")) {
        var f = gmNum(body.followups);
        out.followups = f === null ? null : Math.max(0, Math.round(f));
    }
    return { fields: out };
}

// ---------------------------------------------------------------------------
// Route: POST /api/clients/:id/gm/leads
// ---------------------------------------------------------------------------

// The ONE lead-insert path — the authenticated quick-add and the public
// referral form both go through here, so a referral lead is a normal lead
// in every way (summary metrics, partner attribution, detail sheet).
async function gmInsertLead(env, clientId, f) {
    var leadId = crypto.randomUUID();
    await env.DB.prepare(
        "INSERT INTO gm_leads (id, client_id, mes_lead, data_lead, cliente, telefone, email, origem, parceiro_id, servico, " +
        "observacao, vendedor, data_contato, data_estimate, valor, estagio, followups, proxima_acao, mes_fechamento) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(
        leadId, clientId,
        f.mes_lead !== undefined ? f.mes_lead : null,
        f.data_lead !== undefined ? f.data_lead : null,
        f.cliente,
        f.telefone !== undefined ? f.telefone : null,
        f.email !== undefined ? f.email : null,
        f.origem !== undefined ? f.origem : null,
        f.parceiro_id !== undefined ? f.parceiro_id : null,
        f.servico !== undefined ? f.servico : null,
        f.observacao !== undefined ? f.observacao : null,
        f.vendedor !== undefined ? f.vendedor : null,
        f.data_contato !== undefined ? f.data_contato : null,
        f.data_estimate !== undefined ? f.data_estimate : null,
        f.valor !== undefined ? f.valor : null,
        f.estagio,
        f.followups !== undefined ? f.followups : null,
        f.proxima_acao !== undefined ? f.proxima_acao : null,
        f.mes_fechamento !== undefined ? f.mes_fechamento : null
    ).run();
    return leadId;
}

async function handlePostGmLead(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        var body = {};
        try { body = await request.json(); } catch (e2) { body = {}; }
        var config = await gmGetConfig(env, id);
        var parsed = await gmLeadFields(body, config, false, env, id);
        if (parsed.error) { return jsonErr(parsed.error, 400); }
        var leadId = await gmInsertLead(env, id, parsed.fields);
        var row = await gmOwnedRow(env, "gm_leads", leadId, id);
        return jsonOk({ created: true, lead: row });
    } catch (e) {
        return jsonErr("Error creating lead: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: PUT /api/clients/:id/gm/leads/:leadId — partial update; a stage
// change restamps stage_changed_at (drives "days in stage")
// ---------------------------------------------------------------------------

async function handlePutGmLead(id, leadId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        var existing = await gmOwnedRow(env, "gm_leads", leadId, id);
        if (!existing) { return jsonErr("Lead not found", 404); }
        var body = {};
        try { body = await request.json(); } catch (e2) { body = {}; }
        var config = await gmGetConfig(env, id);
        var parsed = await gmLeadFields(body, config, true, env, id);
        if (parsed.error) { return jsonErr(parsed.error, 400); }
        var f = parsed.fields;
        var sets = [], binds = [];
        Object.keys(f).forEach(function(k) {
            sets.push(k + " = ?");
            binds.push(f[k]);
        });
        if (!sets.length) { return jsonErr("Nothing to update", 400); }
        if (f.estagio !== undefined && f.estagio !== existing.estagio) {
            sets.push("stage_changed_at = datetime('now')");
        }
        sets.push("updated_at = datetime('now')");
        binds.push(leadId);
        binds.push(id);
        await gmRunUpdate(env, "UPDATE gm_leads SET " + sets.join(", ") + " WHERE id = ? AND client_id = ?", binds);
        var row = await gmOwnedRow(env, "gm_leads", leadId, id);
        return jsonOk({ saved: true, lead: row });
    } catch (e) {
        return jsonErr("Error updating lead: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET/POST /api/clients/:id/gm/leads/:leadId/contacts
//
// The client-facing CRM's own outreach log. Deliberately a separate table
// from lead_contact_log: that one keys on clients(id) and is APEX's funnel
// (a "lead" there is a prospective Apex client); this one keys on gm_leads
// and is the CLIENT'S funnel. See migrations/gm_lead_contacts.sql.
//
// Two lead-sheet fields are derived from these rows and are no longer typed
// by hand: the follow-up count (COUNT) and first-contacted (MIN logged_at).
// Both are computed in handleGetGmLeads, never stored.
//
// The method/result vocabularies are the SAME constants the Apex side
// validates against, so one word means one thing across both tiers.
// ---------------------------------------------------------------------------

async function handleGetGmLeadContacts(id, leadId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        // Scope through the LEAD, not just client_id: proves this lead belongs
        // to this tenant before returning anything keyed to it.
        var lead = await gmOwnedRow(env, "gm_leads", leadId, id);
        if (!lead) { return jsonErr("Lead not found", 404); }
        var rows = await env.DB.prepare(
            "SELECT id, lead_id, method, result, notes, logged_at FROM gm_lead_contacts " +
            "WHERE lead_id = ? ORDER BY logged_at DESC"
        ).bind(leadId).all();
        return jsonOk({ contacts: (rows.results || []) });
    } catch (e) {
        return jsonErr("Error fetching contacts: " + e.message, 500);
    }
}

async function handlePostGmLeadContact(id, leadId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        var lead = await gmOwnedRow(env, "gm_leads", leadId, id);
        if (!lead) { return jsonErr("Lead not found", 404); }
        var body = await request.json();
        var method = gmStr(body.method, 40);
        if (LEAD_CONTACT_METHODS.indexOf(method) < 0) { return jsonErr("Invalid method", 400); }
        var result = gmStr(body.result, 40);
        if (result && LEAD_CONTACT_RESULTS.indexOf(result) < 0) { return jsonErr("Invalid result", 400); }
        await env.DB.prepare(
            "INSERT INTO gm_lead_contacts (id, lead_id, client_id, method, result, notes) VALUES (?, ?, ?, ?, ?, ?)"
        ).bind(crypto.randomUUID(), leadId, id, method, result || null, gmStr(body.notes, 2000) || null).run();
        // Return the lead's refreshed derived values so the sheet can re-render
        // without a second round trip.
        var agg = await env.DB.prepare(
            "SELECT COUNT(*) AS contatos_count, MIN(logged_at) AS primeiro_contato " +
            "FROM gm_lead_contacts WHERE lead_id = ?"
        ).bind(leadId).first();
        return jsonOk({
            saved: true,
            contatos_count: (agg && agg.contatos_count) || 0,
            primeiro_contato: (agg && agg.primeiro_contato) || null
        });
    } catch (e) {
        return jsonErr("Error saving contact: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET/POST /api/clients/:id/gm/roadmap, PUT /gm/roadmap/:rowId
// ---------------------------------------------------------------------------

async function handleGetGmRoadmap(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        var rows = await env.DB.prepare(
            "SELECT * FROM gm_roadmap WHERE client_id = ? ORDER BY created_at"
        ).bind(id).all();
        var items = rows.results || [];
        var done = 0;
        items.forEach(function(r) { if (r.status === "Realizado") { done++; } });
        return jsonOk({
            items: items,
            summary: { total: items.length, realizado: done,
                       completion_pct: items.length ? Math.round((done / items.length) * 100) : null }
        });
    } catch (e) {
        return jsonErr("Error fetching roadmap: " + e.message, 500);
    }
}

function gmRoadmapFields(body, partial) {
    var out = {};
    function has(k) { return Object.prototype.hasOwnProperty.call(body, k); }
    if (!partial || has("acao")) {
        var acao = gmStr(body.acao, 500);
        if (!acao) { return { error: "AÇÃO é obrigatória" }; }
        out.acao = acao;
    }
    if (has("status")) {
        if (GM_ROADMAP_STATUSES.indexOf(body.status) === -1) { return { error: "Status inválido" }; }
        out.status = body.status;
    }
    if (has("frente")) {
        out.frente = body.frente === null ? null : (GM_FRENTES.indexOf(body.frente) !== -1 ? body.frente : null);
        if (body.frente !== null && out.frente === null) { return { error: "Frente inválida" }; }
    }
    if (has("mes")) { out.mes = body.mes === null ? null : gmStr(body.mes, 40); }
    if (has("responsavel")) { out.responsavel = body.responsavel === null ? null : gmStr(body.responsavel, 120); }
    if (has("observacoes")) { out.observacoes = body.observacoes === null ? null : gmStr(body.observacoes, 2000); }
    return { fields: out };
}

async function handlePostGmRoadmap(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        var body = {};
        try { body = await request.json(); } catch (e2) { body = {}; }
        var parsed = gmRoadmapFields(body, false);
        if (parsed.error) { return jsonErr(parsed.error, 400); }
        var f = parsed.fields;
        var rowId = crypto.randomUUID();
        await env.DB.prepare(
            "INSERT INTO gm_roadmap (id, client_id, mes, acao, frente, responsavel, status, observacoes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(rowId, id,
            f.mes !== undefined ? f.mes : null, f.acao,
            f.frente !== undefined ? f.frente : null,
            f.responsavel !== undefined ? f.responsavel : null,
            f.status !== undefined ? f.status : "Pendente",
            f.observacoes !== undefined ? f.observacoes : null).run();
        var row = await gmOwnedRow(env, "gm_roadmap", rowId, id);
        return jsonOk({ created: true, item: row });
    } catch (e) {
        return jsonErr("Error creating roadmap item: " + e.message, 500);
    }
}

async function handlePutGmRoadmap(id, rowId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        var existing = await gmOwnedRow(env, "gm_roadmap", rowId, id);
        if (!existing) { return jsonErr("Item not found", 404); }
        var body = {};
        try { body = await request.json(); } catch (e2) { body = {}; }
        var parsed = gmRoadmapFields(body, true);
        if (parsed.error) { return jsonErr(parsed.error, 400); }
        var f = parsed.fields;
        var sets = [], binds = [];
        Object.keys(f).forEach(function(k) { sets.push(k + " = ?"); binds.push(f[k]); });
        if (!sets.length) { return jsonErr("Nothing to update", 400); }
        sets.push("updated_at = datetime('now')");
        binds.push(rowId); binds.push(id);
        await gmRunUpdate(env, "UPDATE gm_roadmap SET " + sets.join(", ") + " WHERE id = ? AND client_id = ?", binds);
        var row = await gmOwnedRow(env, "gm_roadmap", rowId, id);
        return jsonOk({ saved: true, item: row });
    } catch (e) {
        return jsonErr("Error updating roadmap item: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET/POST /api/clients/:id/gm/base-ouro, PUT /gm/base-ouro/:rowId,
//        POST /gm/base-ouro/:rowId/reactivate
// ---------------------------------------------------------------------------

async function handleGetGmBaseOuro(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        var rows = await env.DB.prepare(
            "SELECT * FROM gm_base_ouro WHERE client_id = ? ORDER BY created_at"
        ).bind(id).all();
        return jsonOk({ items: rows.results || [] });
    } catch (e) {
        return jsonErr("Error fetching base de ouro: " + e.message, 500);
    }
}

function gmBaseOuroFields(body, partial) {
    var out = {};
    function has(k) { return Object.prototype.hasOwnProperty.call(body, k); }
    if (!partial || has("cliente")) {
        var cliente = gmStr(body.cliente, 200);
        if (!cliente) { return { error: "CLIENTE é obrigatório" }; }
        out.cliente = cliente;
    }
    if (has("status")) {
        if (GM_BASE_OURO_STATUSES.indexOf(body.status) === -1) { return { error: "Status inválido" }; }
        // 'Reativado' only via the explicit reactivate action, never a plain edit
        if (body.status === "Reativado") { return { error: "Use a ação Reativar para marcar como Reativado" }; }
        out.status = body.status;
    }
    if (has("telefone")) { out.telefone = body.telefone === null ? null : gmStr(body.telefone, 60); }
    if (has("servico_anterior")) { out.servico_anterior = body.servico_anterior === null ? null : gmStr(body.servico_anterior, 200); }
    if (has("data_contato")) { out.data_contato = body.data_contato === null ? null : gmStr(body.data_contato, 40); }
    if (has("oferta")) { out.oferta = body.oferta === null ? null : gmStr(body.oferta, 500); }
    if (has("observacoes")) { out.observacoes = body.observacoes === null ? null : gmStr(body.observacoes, 2000); }
    return { fields: out };
}

async function handlePostGmBaseOuro(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        var body = {};
        try { body = await request.json(); } catch (e2) { body = {}; }
        var parsed = gmBaseOuroFields(body, false);
        if (parsed.error) { return jsonErr(parsed.error, 400); }
        var f = parsed.fields;
        var rowId = crypto.randomUUID();
        await env.DB.prepare(
            "INSERT INTO gm_base_ouro (id, client_id, cliente, telefone, servico_anterior, status, data_contato, oferta, observacoes) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(rowId, id, f.cliente,
            f.telefone !== undefined ? f.telefone : null,
            f.servico_anterior !== undefined ? f.servico_anterior : null,
            f.status !== undefined ? f.status : "Não contatado",
            f.data_contato !== undefined ? f.data_contato : null,
            f.oferta !== undefined ? f.oferta : null,
            f.observacoes !== undefined ? f.observacoes : null).run();
        var row = await gmOwnedRow(env, "gm_base_ouro", rowId, id);
        return jsonOk({ created: true, item: row });
    } catch (e) {
        return jsonErr("Error creating base de ouro row: " + e.message, 500);
    }
}

async function handlePutGmBaseOuro(id, rowId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        var existing = await gmOwnedRow(env, "gm_base_ouro", rowId, id);
        if (!existing) { return jsonErr("Item not found", 404); }
        var body = {};
        try { body = await request.json(); } catch (e2) { body = {}; }
        var parsed = gmBaseOuroFields(body, true);
        if (parsed.error) { return jsonErr(parsed.error, 400); }
        var f = parsed.fields;
        var sets = [], binds = [];
        Object.keys(f).forEach(function(k) { sets.push(k + " = ?"); binds.push(f[k]); });
        if (!sets.length) { return jsonErr("Nothing to update", 400); }
        sets.push("updated_at = datetime('now')");
        binds.push(rowId); binds.push(id);
        await gmRunUpdate(env, "UPDATE gm_base_ouro SET " + sets.join(", ") + " WHERE id = ? AND client_id = ?", binds);
        var row = await gmOwnedRow(env, "gm_base_ouro", rowId, id);
        return jsonOk({ saved: true, item: row });
    } catch (e) {
        return jsonErr("Error updating base de ouro row: " + e.message, 500);
    }
}

// The explicit, confirmed reactivation action: creates the CRM lead with
// ORIGEM = 'Base de Clientes' and stamps the link. Idempotent — a second
// call returns the existing lead instead of duplicating it.
async function handlePostGmBaseOuroReactivate(id, rowId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        var row = await gmOwnedRow(env, "gm_base_ouro", rowId, id);
        if (!row) { return jsonErr("Item not found", 404); }
        if (row.reactivated_lead_id) {
            return jsonOk({ reactivated: true, already: true, lead_id: row.reactivated_lead_id });
        }
        var body = {};
        try { body = await request.json(); } catch (e2) { body = {}; }
        var dataLead = gmStr(body.data_lead, 40);   // device-local datetime from the portal
        var mesLead = gmStr(body.mes_lead, 40);
        var leadId = crypto.randomUUID();
        await env.DB.prepare(
            "INSERT INTO gm_leads (id, client_id, mes_lead, data_lead, cliente, telefone, servico, origem, estagio) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, 'Base de Clientes', 'Novo Lead')"
        ).bind(leadId, id, mesLead, dataLead, row.cliente, row.telefone, null).run();
        await env.DB.prepare(
            "UPDATE gm_base_ouro SET status = 'Reativado', reactivated_lead_id = ?, updated_at = datetime('now') WHERE id = ?"
        ).bind(leadId, rowId).run();
        return jsonOk({ reactivated: true, lead_id: leadId });
    } catch (e) {
        return jsonErr("Error reactivating: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET/POST /api/clients/:id/gm/partners, PUT /gm/partners/:rowId
// LEADS INDICADOS / RECEITA GERADA are computed through the parceiro_id FK —
// the spreadsheet's name-string join had already drifted after one month
// ("Mark Alluminum" vs "MARK (LUMINUM)"), silently zeroing attribution.
// ---------------------------------------------------------------------------

// Referral slug: 14 chars from a 32-char alphabet (~70 bits) — unguessable
// and non-enumerable, unlike a sequential id. 32 divides 256 exactly, so
// the modulo introduces no bias.
function gmReferralSlug() {
    var alphabet = "abcdefghijklmnopqrstuvwxyz234567";
    var bytes = crypto.getRandomValues(new Uint8Array(14));
    var out = "";
    for (var i = 0; i < bytes.length; i++) { out += alphabet[bytes[i] % 32]; }
    return out;
}

async function handleGetGmPartners(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        // Backfill: partners created before the referral feature get a slug
        // on first read, so every partner card can always show its link/QR.
        var missing = await env.DB.prepare(
            "SELECT id FROM gm_partners WHERE client_id = ? AND referral_slug IS NULL"
        ).bind(id).all();
        var missingRows = (missing.results || []);
        for (var mi = 0; mi < missingRows.length; mi++) {
            await env.DB.prepare("UPDATE gm_partners SET referral_slug = ? WHERE id = ?")
                .bind(gmReferralSlug(), missingRows[mi].id).run();
        }
        var rows = await env.DB.prepare(
            "SELECT p.*, " +
            "(SELECT COUNT(*) FROM gm_leads l WHERE l.parceiro_id = p.id) AS leads_indicados, " +
            "(SELECT COALESCE(SUM(l.valor), 0) FROM gm_leads l WHERE l.parceiro_id = p.id AND l.estagio = 'Fechado') AS receita_gerada " +
            "FROM gm_partners p WHERE p.client_id = ? ORDER BY p.name COLLATE NOCASE"
        ).bind(id).all();
        return jsonOk({ partners: rows.results || [] });
    } catch (e) {
        return jsonErr("Error fetching partners: " + e.message, 500);
    }
}

function gmPartnerFields(body, config, partial) {
    var out = {};
    function has(k) { return Object.prototype.hasOwnProperty.call(body, k); }
    if (!partial || has("name")) {
        var name = gmStr(body.name, 200);
        if (!name) { return { error: "PARCEIRO (nome) é obrigatório" }; }
        out.name = name;
    }
    if (has("status")) {
        if (GM_PARTNER_STATUSES.indexOf(body.status) === -1) { return { error: "Status inválido" }; }
        out.status = body.status;
    }
    if (has("tipo")) {
        out.tipo = body.tipo === null ? null : (config.partner_types.indexOf(body.tipo) !== -1 ? body.tipo : null);
        if (body.tipo !== null && out.tipo === null) { return { error: "Tipo inválido" }; }
    }
    if (has("contato")) { out.contato = body.contato === null ? null : gmStr(body.contato, 200); }
    if (has("ultima_interacao")) { out.ultima_interacao = body.ultima_interacao === null ? null : gmStr(body.ultima_interacao, 40); }
    if (has("proxima_acao")) { out.proxima_acao = body.proxima_acao === null ? null : gmStr(body.proxima_acao, 500); }
    return { fields: out };
}

async function handlePostGmPartner(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        var body = {};
        try { body = await request.json(); } catch (e2) { body = {}; }
        var config = await gmGetConfig(env, id);
        var parsed = gmPartnerFields(body, config, false);
        if (parsed.error) { return jsonErr(parsed.error, 400); }
        var f = parsed.fields;
        var rowId = crypto.randomUUID();
        await env.DB.prepare(
            "INSERT INTO gm_partners (id, client_id, name, tipo, contato, status, ultima_interacao, proxima_acao, referral_slug) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(rowId, id, f.name,
            f.tipo !== undefined ? f.tipo : null,
            f.contato !== undefined ? f.contato : null,
            f.status !== undefined ? f.status : "Prospectando",
            f.ultima_interacao !== undefined ? f.ultima_interacao : null,
            f.proxima_acao !== undefined ? f.proxima_acao : null,
            gmReferralSlug()).run();
        var row = await gmOwnedRow(env, "gm_partners", rowId, id);
        return jsonOk({ created: true, partner: row });
    } catch (e) {
        return jsonErr("Error creating partner: " + e.message, 500);
    }
}

async function handlePutGmPartner(id, rowId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        var existing = await gmOwnedRow(env, "gm_partners", rowId, id);
        if (!existing) { return jsonErr("Partner not found", 404); }
        var body = {};
        try { body = await request.json(); } catch (e2) { body = {}; }
        var config = await gmGetConfig(env, id);
        var parsed = gmPartnerFields(body, config, true);
        if (parsed.error) { return jsonErr(parsed.error, 400); }
        var f = parsed.fields;
        var sets = [], binds = [];
        Object.keys(f).forEach(function(k) { sets.push(k + " = ?"); binds.push(f[k]); });
        if (!sets.length) { return jsonErr("Nothing to update", 400); }
        sets.push("updated_at = datetime('now')");
        binds.push(rowId); binds.push(id);
        await gmRunUpdate(env, "UPDATE gm_partners SET " + sets.join(", ") + " WHERE id = ? AND client_id = ?", binds);
        var row = await gmOwnedRow(env, "gm_partners", rowId, id);
        return jsonOk({ saved: true, partner: row });
    } catch (e) {
        return jsonErr("Error updating partner: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// PUBLIC referral intake — the first no-login surface in this app.
//   GET  /api/referral/:slug  → the minimum the form needs to render:
//                               business name + partner first name + serviços.
//   POST /api/referral/:slug  → creates a gm_leads row via gmInsertLead with
//                               parceiro_id set from the slug lookup (never a
//                               text match), origem 'Parceiro', estágio
//                               'Novo Lead'.
// Treated as hostile input by default: strict slug shape, server-side
// validation/truncation of every field, per-slug and per-IP rate limits in
// D1 (gm_referral_hits), a honeypot field and a minimum fill time. Responses
// never carry lead ids, other partners, or any client data beyond the
// business display name.
// ---------------------------------------------------------------------------

var GM_MONTH_NAMES_PT = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

// Local date/time in the app's timezone (America/New_York), matching what
// the portal's own gmNowLocalIso() would produce on a phone in Florida.
function gmNyNowParts() {
    var fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone: APEX_TIMEZONE, year: "numeric", month: "2-digit",
        day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
    });
    var parts = {};
    fmt.formatToParts(new Date()).forEach(function(p) { parts[p.type] = p.value; });
    // en-CA can render midnight as "24" — normalize to 00
    if (parts.hour === "24") { parts.hour = "00"; }
    return parts;
}

function gmReferralSlugValid(slug) {
    return /^[a-z2-7]{10,40}$/.test(slug || "");
}

async function gmPartnerBySlug(env, slug) {
    if (!gmReferralSlugValid(slug)) { return null; }
    return env.DB.prepare(
        "SELECT p.id, p.client_id, p.name, c.name AS business_name, " +
        "c.language, c.referral_bg_color, c.referral_text_color, c.logo_url " +
        "FROM gm_partners p JOIN clients c ON c.id = p.client_id " +
        "WHERE p.referral_slug = ?"
    ).bind(slug).first();
}

// Apex's own palette — the literal values referral.html already hardcodes.
// Used as the fallback when a client has set no branding of their own.
var REFERRAL_DEFAULT_BG   = "#1a1a1d";   // --header
var REFERRAL_DEFAULT_TEXT = "#C9A43A";   // --gold

function referralHexOrNull(v) {
    return /^#[0-9a-fA-F]{6}$/.test(String(v || "")) ? String(v) : null;
}

async function handleGetReferralInfo(slug, request, env) {
    try {
        var partner = await gmPartnerBySlug(env, slug);
        if (!partner) { return jsonErr("Not found", 404); }
        var config = await gmGetConfig(env, partner.client_id);
        // Only what the public form needs — no ids, no other partners, no
        // financials. Partner first name only (it's their own link).
        //
        // Branding is resolved to concrete values HERE rather than sent as
        // nulls for the page to interpret: referral.html is deliberately
        // dependency-free, and the fallback rule (Apex black/gold) belongs in
        // one place. A stored value that is not a valid 6-digit hex is treated
        // as unset — the page can never be handed a broken color.
        var logoUrl = null;
        if (partner.logo_url) {
            // Served through the EXISTING logo-image route; no raw R2 key is
            // ever exposed to a public page.
            logoUrl = new URL(request.url).origin + "/api/clients/" + partner.client_id + "/logo-image";
        }
        return jsonOk({
            business_name: partner.business_name,
            partner_name: (partner.name || "").split(/\s+/)[0],
            servicos: config.servicos,
            language: partner.language === "en" ? "en" : "pt",
            referral_bg_color:   referralHexOrNull(partner.referral_bg_color)   || REFERRAL_DEFAULT_BG,
            referral_text_color: referralHexOrNull(partner.referral_text_color) || REFERRAL_DEFAULT_TEXT,
            has_logo: !!logoUrl,
            logo_url: logoUrl
        });
    } catch (e) {
        return jsonErr("Error loading referral form", 500);
    }
}

// ===========================================================================
// APEX'S OWN REFERRAL PARTNERS  (apex_partners)
//
// DATA TIER NOTE — the distinction this whole file keeps having to repeat:
//   gm_partners   = a CLIENT's referral partners (LIRA's suppliers). One tier
//                   below Apex, scoped by client_id, client-accessible.
//   apex_partners = APEX's own referral partners: who sends COACHING CLIENTS
//                   to Apex. This section. No client_id exists on the table,
//                   so there is no client scope to grant — every authenticated
//                   route here is isAdminRole-only, full stop, and a
//                   client-role token can never reach any of it.
//
// A referred lead lands in the APEX-INTERNAL pipeline (clients.status='lead',
// the Task-1 ladder), never in any client's gm_leads. Attribution is by record
// through clients.referred_by_partner_id, never by matching a typed name.
// ===========================================================================

// Apex's own partner statuses — same three-rung ladder as gm_partners, so the
// two screens read identically. Deliberately a separate constant: the client
// tier's list is configurable per client, Apex's own is fixed.
var APEX_PARTNER_STATUSES = ["Prospectando", "Ativo", "Inativo"];

function apexPartnerFields(body, partial) {
    var out = {};
    function has(k) { return Object.prototype.hasOwnProperty.call(body, k); }
    if (!partial || has("name")) {
        var name = gmStr(body.name, 200);
        if (!name) { return { error: "Nome do parceiro é obrigatório" }; }
        out.name = name;
    }
    if (has("status")) {
        if (APEX_PARTNER_STATUSES.indexOf(body.status) === -1) { return { error: "Status inválido" }; }
        out.status = body.status;
    }
    // tipo is FREE TEXT here, unlike gm_partners.tipo which validates against
    // the client's configurable partner_types list. Apex has no such list to
    // configure and only two people use this screen.
    if (has("tipo")) { out.tipo = body.tipo === null ? null : gmStr(body.tipo, 100); }
    if (has("contato")) { out.contato = body.contato === null ? null : gmStr(body.contato, 200); }
    if (has("ultima_interacao")) { out.ultima_interacao = body.ultima_interacao === null ? null : gmStr(body.ultima_interacao, 40); }
    if (has("proxima_acao")) { out.proxima_acao = body.proxima_acao === null ? null : gmStr(body.proxima_acao, 500); }
    return { fields: out };
}

// ---------------------------------------------------------------------------
// Route: GET /api/apex-partners — admin only
//
// clientes_indicados / clientes_convertidos are COMPUTED here and never
// stored, the same rule gm_partners follows for leads_indicados: a stored
// counter drifts the moment a lead is deleted, converted or re-attributed.
// ---------------------------------------------------------------------------

async function handleGetApexPartners(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!isAdminRole(user)) { return jsonErr("Forbidden", 403); }

        // Backfill, mirroring handleGetGmPartners: partners created before a
        // slug existed get one on first read, so every card can show its link.
        var missing = await env.DB.prepare(
            "SELECT id FROM apex_partners WHERE referral_slug IS NULL"
        ).all();
        var missingRows = missing.results || [];
        for (var mi = 0; mi < missingRows.length; mi++) {
            await env.DB.prepare("UPDATE apex_partners SET referral_slug = ? WHERE id = ?")
                .bind(gmReferralSlug(), missingRows[mi].id).run();
        }

        var rows = await env.DB.prepare(
            "SELECT p.*, " +
            "(SELECT COUNT(*) FROM clients c WHERE c.referred_by_partner_id = p.id) AS clientes_indicados, " +
            // "Converted" means the referred lead actually became a paying
            // client — status='active'. A lead still in the pipeline counts as
            // referred but not yet converted.
            "(SELECT COUNT(*) FROM clients c WHERE c.referred_by_partner_id = p.id AND c.status = 'active') AS clientes_convertidos " +
            "FROM apex_partners p ORDER BY p.name COLLATE NOCASE"
        ).all();

        return jsonOk({ partners: rows.results || [], statuses: APEX_PARTNER_STATUSES });
    } catch (e) {
        return jsonErr("Error fetching Apex partners: " + e.message, 500);
    }
}

async function handlePostApexPartner(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!isAdminRole(user)) { return jsonErr("Forbidden", 403); }

        var body = {};
        try { body = await request.json(); } catch (e2) { body = {}; }
        var parsed = apexPartnerFields(body, false);
        if (parsed.error) { return jsonErr(parsed.error, 400); }
        var f = parsed.fields;

        var rowId = crypto.randomUUID();
        await env.DB.prepare(
            "INSERT INTO apex_partners (id, name, tipo, contato, status, ultima_interacao, proxima_acao, referral_slug) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(rowId, f.name,
            f.tipo !== undefined ? f.tipo : null,
            f.contato !== undefined ? f.contato : null,
            f.status !== undefined ? f.status : "Prospectando",
            f.ultima_interacao !== undefined ? f.ultima_interacao : null,
            f.proxima_acao !== undefined ? f.proxima_acao : null,
            gmReferralSlug()).run();

        var row = await env.DB.prepare("SELECT * FROM apex_partners WHERE id = ?").bind(rowId).first();
        return jsonOk({ created: true, partner: row });
    } catch (e) {
        return jsonErr("Error creating Apex partner: " + e.message, 500);
    }
}

async function handlePutApexPartner(rowId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!isAdminRole(user)) { return jsonErr("Forbidden", 403); }

        var existing = await env.DB.prepare("SELECT id FROM apex_partners WHERE id = ?").bind(rowId).first();
        if (!existing) { return jsonErr("Partner not found", 404); }

        var body = {};
        try { body = await request.json(); } catch (e2) { body = {}; }
        var parsed = apexPartnerFields(body, true);
        if (parsed.error) { return jsonErr(parsed.error, 400); }
        var f = parsed.fields;

        var sets = [], binds = [];
        Object.keys(f).forEach(function(k) { sets.push(k + " = ?"); binds.push(f[k]); });
        if (!sets.length) { return jsonErr("Nothing to update", 400); }
        sets.push("updated_at = datetime('now')");
        binds.push(rowId);

        await gmRunUpdate(env, "UPDATE apex_partners SET " + sets.join(", ") + " WHERE id = ?", binds);

        var row = await env.DB.prepare("SELECT * FROM apex_partners WHERE id = ?").bind(rowId).first();
        return jsonOk({ saved: true, partner: row });
    } catch (e) {
        return jsonErr("Error updating Apex partner: " + e.message, 500);
    }
}

async function handleDeleteApexPartner(rowId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!isAdminRole(user)) { return jsonErr("Forbidden", 403); }

        var existing = await env.DB.prepare("SELECT id FROM apex_partners WHERE id = ?").bind(rowId).first();
        if (!existing) { return jsonErr("Partner not found", 404); }

        // Leads this partner referred are NOT deleted — they are real people in
        // Apex's pipeline. Their attribution is cleared instead, so the lead
        // survives with no partner rather than pointing at a missing row.
        await env.DB.prepare(
            "UPDATE clients SET referred_by_partner_id = NULL WHERE referred_by_partner_id = ?"
        ).bind(rowId).run();
        await env.DB.prepare("DELETE FROM apex_partners WHERE id = ?").bind(rowId).run();

        return jsonOk({ deleted: true });
    } catch (e) {
        return jsonErr("Error deleting Apex partner: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// PUBLIC: GET/POST /api/apex-referral/:slug — Apex's own referral landing.
//
// Deliberately mirrors the gm_partners public form, with three differences
// that follow from this being Apex's own tool rather than a client's:
//   * PT only — no language field. Rafa and Alice are both Brazilian and this
//     page represents Apex itself, not a client with American customers.
//   * Apex's own black/gold always. No per-partner color customization.
//   * A submission creates a row in the APEX-INTERNAL pipeline
//     (clients.status='lead', lead_stage='Lead') — never a gm_leads row.
// ---------------------------------------------------------------------------

async function apexPartnerBySlug(env, slug) {
    if (!gmReferralSlugValid(slug)) { return null; }
    return env.DB.prepare(
        "SELECT id, name FROM apex_partners WHERE referral_slug = ?"
    ).bind(slug).first();
}

async function handleGetApexReferralInfo(slug, request, env) {
    try {
        var partner = await apexPartnerBySlug(env, slug);
        if (!partner) { return jsonErr("Not found", 404); }
        // First name only — it is the partner's own link, and nothing else
        // about Apex's partner roster is exposed publicly.
        return jsonOk({ partner_name: (partner.name || "").split(/\s+/)[0] });
    } catch (e) {
        return jsonErr("Error loading referral form", 500);
    }
}

async function handlePostApexReferralLead(slug, request, env) {
    try {
        var partner = await apexPartnerBySlug(env, slug);
        if (!partner) { return jsonErr("Not found", 404); }

        var ip = request.headers.get("CF-Connecting-IP") || "";

        // Same rate-limit shape as the gm referral form, against its OWN
        // ledger table: 10/hour per link, 20/hour per IP, counted BEFORE the
        // body is read so invalid payloads cannot bypass the counter.
        await env.DB.prepare(
            "DELETE FROM apex_referral_hits WHERE created_at < datetime('now', '-2 days')"
        ).run();
        var slugHits = await env.DB.prepare(
            "SELECT COUNT(*) AS c FROM apex_referral_hits WHERE slug = ? AND created_at > datetime('now', '-1 hour')"
        ).bind(slug).first();
        var ipHits = ip ? await env.DB.prepare(
            "SELECT COUNT(*) AS c FROM apex_referral_hits WHERE ip = ? AND created_at > datetime('now', '-1 hour')"
        ).bind(ip).first() : { c: 0 };
        if ((slugHits && slugHits.c >= 10) || (ipHits && ipHits.c >= 20)) {
            return jsonErr("Muitas tentativas. Tente novamente mais tarde.", 429);
        }
        await env.DB.prepare(
            "INSERT INTO apex_referral_hits (id, slug, ip) VALUES (?, ?, ?)"
        ).bind(crypto.randomUUID(), slug, ip || null).run();

        var body = {};
        try { body = await request.json(); } catch (e2) { body = {}; }

        // Honeypot + impossibly-fast submit get a FAKE success, so bots do not
        // learn to adapt. Identical to the gm form's treatment.
        var elapsed = gmNum(body.elapsed_ms);
        if (gmStr(body.website, 200) !== null || (elapsed !== null && elapsed >= 0 && elapsed < 3000)) {
            return jsonOk({ created: true });
        }

        var nome = gmStr(body.nome, 200);
        if (!nome) { return jsonErr("Nome é obrigatório", 400); }
        var telefone = gmStr(body.telefone, 60);
        if (telefone && !/^[0-9+()\-.\s]{7,60}$/.test(telefone)) {
            return jsonErr("Telefone inválido", 400);
        }
        var email = gmStr(body.email, 200);
        if (email && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(email)) {
            return jsonErr("Email inválido", 400);
        }

        // Lands in the APEX-INTERNAL pipeline at the first rung, with
        // stage_changed_at stamped so Task 1's "days in this stage" starts
        // counting from arrival rather than reading as unknown.
        var leadId = crypto.randomUUID();
        await env.DB.prepare(
            // source_type is stamped 'partner' here rather than inferred later
            // from the non-null partner id: the Overview card and the future
            // attribution metrics read source_type, and a lead that arrived
            // through a partner's own link is the least ambiguous partner
            // referral there is. referred_by_partner_id stays authoritative for
            // WHICH partner — the name is never copied into source_detail.
            "INSERT INTO clients (id, name, status, lead_stage, stage_changed_at, phone, email, referred_by_partner_id, source_type) " +
            "VALUES (?, ?, 'lead', 'Lead', datetime('now'), ?, ?, ?, 'partner')"
        ).bind(leadId, nome, telefone, email, partner.id).run();

        // Deliberately no id and no data in the public response.
        return jsonOk({ created: true });
    } catch (e) {
        return jsonErr("Error submitting referral", 500);
    }
}

async function handlePostReferralLead(slug, request, env) {
    try {
        var partner = await gmPartnerBySlug(env, slug);
        if (!partner) { return jsonErr("Not found", 404); }

        var ip = request.headers.get("CF-Connecting-IP") || "";

        // Rate limit BEFORE reading the body: 10/hour per link, 20/hour per
        // IP. Every attempt is a hit, valid or not, so hammering invalid
        // payloads cannot bypass the counter. Old rows pruned opportunistically.
        await env.DB.prepare(
            "DELETE FROM gm_referral_hits WHERE created_at < datetime('now', '-2 days')"
        ).run();
        var slugHits = await env.DB.prepare(
            "SELECT COUNT(*) AS c FROM gm_referral_hits WHERE slug = ? AND created_at > datetime('now', '-1 hour')"
        ).bind(slug).first();
        var ipHits = ip ? await env.DB.prepare(
            "SELECT COUNT(*) AS c FROM gm_referral_hits WHERE ip = ? AND created_at > datetime('now', '-1 hour')"
        ).bind(ip).first() : { c: 0 };
        if ((slugHits && slugHits.c >= 10) || (ipHits && ipHits.c >= 20)) {
            return jsonErr("Muitas tentativas. Tente novamente mais tarde. / Too many attempts. Try again later.", 429);
        }
        await env.DB.prepare(
            "INSERT INTO gm_referral_hits (id, slug, ip) VALUES (?, ?, ?)"
        ).bind(crypto.randomUUID(), slug, ip || null).run();

        var body = {};
        try { body = await request.json(); } catch (e2) { body = {}; }

        // Honeypot: real users never see the 'website' field. Bots that fill
        // it get a fake success so they don't adapt. Same for an impossibly
        // fast submit (3 fields in under 3 seconds).
        var elapsed = gmNum(body.elapsed_ms);
        if (gmStr(body.website, 200) !== null || (elapsed !== null && elapsed >= 0 && elapsed < 3000)) {
            return jsonOk({ created: true });
        }

        var nome = gmStr(body.nome, 200);
        if (!nome) { return jsonErr("Nome é obrigatório / Name is required", 400); }
        var telefone = gmStr(body.telefone, 60);
        if (telefone && !/^[0-9+()\-.\s]{7,60}$/.test(telefone)) {
            return jsonErr("Telefone inválido / Invalid phone", 400);
        }
        var config = await gmGetConfig(env, partner.client_id);
        // servico may hold SEVERAL services as one comma-separated string
        // ("Pavers, Lighting") — validate each against the client's catalog,
        // drop unknowns, store the surviving list re-joined.
        var servicoRaw = gmStr(body.servico, 400);
        var servico = null;
        if (servicoRaw) {
            var servicoList = [];
            servicoRaw.split(",").forEach(function(part) {
                var t = part.trim();
                if (t && config.servicos.indexOf(t) !== -1 && servicoList.indexOf(t) === -1) {
                    servicoList.push(t);
                }
            });
            servico = servicoList.length ? servicoList.join(", ") : null;
        }

        var now = gmNyNowParts();
        var mesLead = GM_MONTH_NAMES_PT[Number(now.month) - 1];
        if (config.cycle_months.indexOf(mesLead) === -1) { mesLead = null; }

        // Same insert path as the authenticated quick-add — parceiro_id from
        // the slug's own partner row, by record.
        await gmInsertLead(env, partner.client_id, {
            cliente: nome,
            telefone: telefone,
            servico: servico,
            origem: "Parceiro",
            parceiro_id: partner.id,
            estagio: "Novo Lead",
            data_lead: now.year + "-" + now.month + "-" + now.day + "T" + now.hour + ":" + now.minute,
            mes_lead: mesLead,
            observacao: "Recebido pelo link de indicação do parceiro."
        });
        // Deliberately no lead id / no data in the public response.
        return jsonOk({ created: true });
    } catch (e) {
        return jsonErr("Error submitting referral", 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET/POST /api/clients/:id/gm/finance, PUT /gm/finance/:rowId
// tipo is DERIVED from categoria via gm_config — a request body's tipo is
// never read. Monthly summary: ENTRADAS | SAÍDAS | RESULTADO | MARGEM.
// ---------------------------------------------------------------------------

async function handleGetGmFinance(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        var rows = await env.DB.prepare(
            "SELECT f.*, j.obra AS obra_name FROM gm_finance f " +
            "LEFT JOIN gm_jobs j ON j.id = f.obra_id " +
            "WHERE f.client_id = ? ORDER BY COALESCE(f.data, f.created_at) DESC"
        ).bind(id).all();
        var sums = await env.DB.prepare(
            "SELECT mes, " +
            "SUM(CASE WHEN tipo = 'Entrada' THEN valor ELSE 0 END) AS entradas, " +
            "SUM(CASE WHEN tipo = 'Saída' THEN valor ELSE 0 END) AS saidas " +
            "FROM gm_finance WHERE client_id = ? GROUP BY mes"
        ).bind(id).all();
        var monthly = [];
        (sums.results || []).forEach(function(m) {
            var entradas = m.entradas || 0;
            var saidas = m.saidas || 0;
            var resultado = entradas - saidas;
            monthly.push({
                mes: m.mes,
                entradas: entradas,
                saidas: saidas,
                resultado: resultado,
                margem_pct: entradas > 0 ? Math.round((resultado / entradas) * 1000) / 10 : null
            });
        });
        return jsonOk({ entries: rows.results || [], monthly: monthly });
    } catch (e) {
        return jsonErr("Error fetching finance entries: " + e.message, 500);
    }
}

async function gmFinanceFields(body, config, partial, env, clientId) {
    var out = {};
    function has(k) { return Object.prototype.hasOwnProperty.call(body, k); }
    if (!partial || has("descricao")) {
        var descricao = gmStr(body.descricao, 500);
        if (!descricao) { return { error: "DESCRIÇÃO é obrigatória" }; }
        out.descricao = descricao;
    }
    if (!partial || has("categoria")) {
        var categoria = gmStr(body.categoria, 80);
        var tipo = categoria ? gmFinanceTipo(config, categoria) : null;
        if (!tipo) { return { error: "Categoria inválida" }; }
        out.categoria = categoria;
        out.tipo = tipo;   // derived — body.tipo is never read
    }
    if (!partial || has("valor")) {
        var valor = gmNum(body.valor);
        if (valor === null || valor < 0) { return { error: "VALOR deve ser um número" }; }
        out.valor = valor;
    }
    if (has("obra_id")) {
        if (body.obra_id === null || body.obra_id === "") {
            out.obra_id = null;
        } else {
            var job = await gmOwnedRow(env, "gm_jobs", String(body.obra_id), clientId);
            if (!job) { return { error: "Obra não encontrada" }; }
            out.obra_id = job.id;
        }
    }
    if (has("mes")) { out.mes = body.mes === null ? null : gmStr(body.mes, 40); }
    if (has("data")) { out.data = body.data === null ? null : gmStr(body.data, 40); }
    if (has("obs")) { out.obs = body.obs === null ? null : gmStr(body.obs, 2000); }
    return { fields: out };
}

async function handlePostGmFinance(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        var body = {};
        try { body = await request.json(); } catch (e2) { body = {}; }
        var config = await gmGetConfig(env, id);
        var parsed = await gmFinanceFields(body, config, false, env, id);
        if (parsed.error) { return jsonErr(parsed.error, 400); }
        var f = parsed.fields;
        var rowId = crypto.randomUUID();
        await env.DB.prepare(
            "INSERT INTO gm_finance (id, client_id, mes, data, descricao, categoria, tipo, valor, obra_id, obs) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(rowId, id,
            f.mes !== undefined ? f.mes : null,
            f.data !== undefined ? f.data : null,
            f.descricao, f.categoria, f.tipo, f.valor,
            f.obra_id !== undefined ? f.obra_id : null,
            f.obs !== undefined ? f.obs : null).run();
        var row = await gmOwnedRow(env, "gm_finance", rowId, id);
        return jsonOk({ created: true, entry: row });
    } catch (e) {
        return jsonErr("Error creating finance entry: " + e.message, 500);
    }
}

async function handlePutGmFinance(id, rowId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        var existing = await gmOwnedRow(env, "gm_finance", rowId, id);
        if (!existing) { return jsonErr("Entry not found", 404); }
        var body = {};
        try { body = await request.json(); } catch (e2) { body = {}; }
        var config = await gmGetConfig(env, id);
        var parsed = await gmFinanceFields(body, config, true, env, id);
        if (parsed.error) { return jsonErr(parsed.error, 400); }
        var f = parsed.fields;
        var sets = [], binds = [];
        Object.keys(f).forEach(function(k) { sets.push(k + " = ?"); binds.push(f[k]); });
        if (!sets.length) { return jsonErr("Nothing to update", 400); }
        sets.push("updated_at = datetime('now')");
        binds.push(rowId); binds.push(id);
        await gmRunUpdate(env, "UPDATE gm_finance SET " + sets.join(", ") + " WHERE id = ? AND client_id = ?", binds);
        var row = await gmOwnedRow(env, "gm_finance", rowId, id);
        return jsonOk({ saved: true, entry: row });
    } catch (e) {
        return jsonErr("Error updating finance entry: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET/POST /api/clients/:id/gm/jobs, PUT /gm/jobs/:rowId
// CUSTO TOTAL / LUCRO / MARGEM % / ALVO? / NO PRAZO? computed at read time.
// ---------------------------------------------------------------------------

function gmJobComputed(row, targetMargin) {
    var custoTotal = (row.material || 0) + (row.mao_de_obra || 0) + (row.outros || 0);
    var lucro = row.valor === null || row.valor === undefined ? null : row.valor - custoTotal;
    var margemPct = (row.valor && row.valor > 0 && lucro !== null)
        ? Math.round((lucro / row.valor) * 1000) / 10 : null;
    var noPrazo = null;
    if (row.entrega_real && row.prazo_previsto) { noPrazo = row.entrega_real <= row.prazo_previsto; }
    return {
        custo_total: custoTotal,
        lucro: lucro,
        margem_pct: margemPct,
        // ALVO? — warn when margin is below the client's configured minimum.
        // "No proposal goes out below this number."
        alvo_ok: margemPct === null ? null : margemPct >= targetMargin,
        no_prazo: noPrazo
    };
}

async function handleGetGmJobs(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        var config = await gmGetConfig(env, id);
        var rows = await env.DB.prepare(
            "SELECT * FROM gm_jobs WHERE client_id = ? ORDER BY created_at DESC"
        ).bind(id).all();
        var jobs = [];
        (rows.results || []).forEach(function(r) {
            var computed = gmJobComputed(r, config.target_margin);
            var out = {};
            Object.keys(r).forEach(function(k) { out[k] = r[k]; });
            Object.keys(computed).forEach(function(k) { out[k] = computed[k]; });
            jobs.push(out);
        });
        return jsonOk({ jobs: jobs, target_margin: config.target_margin });
    } catch (e) {
        return jsonErr("Error fetching jobs: " + e.message, 500);
    }
}

function gmJobFields(body, partial) {
    var out = {};
    function has(k) { return Object.prototype.hasOwnProperty.call(body, k); }
    if (!partial || has("obra")) {
        var obra = gmStr(body.obra, 300);
        if (!obra) { return { error: "CLIENTE / OBRA é obrigatório" }; }
        out.obra = obra;
    }
    if (has("status")) {
        if (GM_JOB_STATUSES.indexOf(body.status) === -1) { return { error: "Status inválido" }; }
        out.status = body.status;
    }
    var numFields = ["valor", "material", "mao_de_obra", "outros"];
    for (var i = 0; i < numFields.length; i++) {
        if (has(numFields[i])) { out[numFields[i]] = gmNum(body[numFields[i]]); }
    }
    var strFields = [["mes_entrega", 40], ["inicio", 40], ["prazo_previsto", 40], ["entrega_real", 40]];
    for (var j = 0; j < strFields.length; j++) {
        var k = strFields[j][0];
        if (has(k)) { out[k] = body[k] === null ? null : gmStr(body[k], strFields[j][1]); }
    }
    return { fields: out };
}

async function handlePostGmJob(id, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        var body = {};
        try { body = await request.json(); } catch (e2) { body = {}; }
        var parsed = gmJobFields(body, false);
        if (parsed.error) { return jsonErr(parsed.error, 400); }
        var f = parsed.fields;
        var rowId = crypto.randomUUID();
        await env.DB.prepare(
            "INSERT INTO gm_jobs (id, client_id, obra, mes_entrega, valor, material, mao_de_obra, outros, inicio, prazo_previsto, entrega_real, status) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(rowId, id, f.obra,
            f.mes_entrega !== undefined ? f.mes_entrega : null,
            f.valor !== undefined ? f.valor : null,
            f.material !== undefined ? f.material : null,
            f.mao_de_obra !== undefined ? f.mao_de_obra : null,
            f.outros !== undefined ? f.outros : null,
            f.inicio !== undefined ? f.inicio : null,
            f.prazo_previsto !== undefined ? f.prazo_previsto : null,
            f.entrega_real !== undefined ? f.entrega_real : null,
            f.status !== undefined ? f.status : "Em andamento").run();
        var row = await gmOwnedRow(env, "gm_jobs", rowId, id);
        return jsonOk({ created: true, job: row });
    } catch (e) {
        return jsonErr("Error creating job: " + e.message, 500);
    }
}

async function handlePutGmJob(id, rowId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        var existing = await gmOwnedRow(env, "gm_jobs", rowId, id);
        if (!existing) { return jsonErr("Job not found", 404); }
        var body = {};
        try { body = await request.json(); } catch (e2) { body = {}; }
        var parsed = gmJobFields(body, true);
        if (parsed.error) { return jsonErr(parsed.error, 400); }
        var f = parsed.fields;
        var sets = [], binds = [];
        Object.keys(f).forEach(function(k) { sets.push(k + " = ?"); binds.push(f[k]); });
        if (!sets.length) { return jsonErr("Nothing to update", 400); }
        sets.push("updated_at = datetime('now')");
        binds.push(rowId); binds.push(id);
        await gmRunUpdate(env, "UPDATE gm_jobs SET " + sets.join(", ") + " WHERE id = ? AND client_id = ?", binds);
        var row = await gmOwnedRow(env, "gm_jobs", rowId, id);
        return jsonOk({ saved: true, job: row });
    } catch (e) {
        return jsonErr("Error updating job: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: DELETE /api/clients/:id/gm/<collection>/:rowId
// FK-referenced rows are protected with a clear message instead of a raw
// constraint error; a deleted lead first releases its base-ouro back-link.
// ---------------------------------------------------------------------------

var GM_DELETE_TABLES = {
    "leads":     "gm_leads",
    "roadmap":   "gm_roadmap",
    "base-ouro": "gm_base_ouro",
    "partners":  "gm_partners",
    "finance":   "gm_finance",
    "jobs":      "gm_jobs"
};

async function handleDeleteGmRow(id, collection, rowId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (!requireClientAccess(user, id)) { return jsonErr("Forbidden", 403); }
        var table = GM_DELETE_TABLES[collection];
        if (!table) { return jsonErr("Not found", 404); }
        var existing = await gmOwnedRow(env, table, rowId, id);
        if (!existing) { return jsonErr("Not found", 404); }
        if (table === "gm_partners") {
            var refLeads = await env.DB.prepare(
                "SELECT COUNT(*) AS c FROM gm_leads WHERE parceiro_id = ?"
            ).bind(rowId).first();
            if (refLeads && refLeads.c > 0) {
                return jsonErr("Este parceiro tem leads vinculados no CRM — remova o vínculo nos leads antes de excluir", 400);
            }
        }
        if (table === "gm_jobs") {
            var refFin = await env.DB.prepare(
                "SELECT COUNT(*) AS c FROM gm_finance WHERE obra_id = ?"
            ).bind(rowId).first();
            if (refFin && refFin.c > 0) {
                return jsonErr("Esta obra tem lançamentos financeiros vinculados — remova o vínculo antes de excluir", 400);
            }
        }
        if (table === "gm_leads") {
            await env.DB.prepare(
                "UPDATE gm_base_ouro SET reactivated_lead_id = NULL WHERE reactivated_lead_id = ?"
            ).bind(rowId).run();
        }
        await env.DB.prepare("DELETE FROM " + table + " WHERE id = ? AND client_id = ?")
            .bind(rowId, id).run();
        return jsonOk({ deleted: true });
    } catch (e) {
        return jsonErr("Error deleting: " + e.message, 500);
    }
}

export default {
    fetch: async function(request, env) {
        var url    = new URL(request.url);
        var path   = url.pathname;
        var method = request.method;

        if (method === "OPTIONS") {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }

        // Client-role isolation gate: a 'client' user can only reach the
        // portal whitelist, always scoped to their own client_id. Admin and
        // unauthenticated requests pass through untouched.
        var gateResponse = await enforceClientRoleGate(request, env, path, method);
        if (gateResponse) { return gateResponse; }

        // Developer preview-as is READ-ONLY, enforced here at the API level —
        // not by hiding buttons. portal.html appends previewAs=<id> to every
        // request while previewing, so any non-GET arriving with that param
        // from a developer is rejected before route dispatch.
        if (method !== "GET" && url.searchParams.get("previewAs")) {
            var previewUser = null;
            try { previewUser = await authenticate(request, env); } catch (e) { previewUser = null; }
            if (previewUser && previewUser.role === "developer") {
                return jsonErr("Modo preview é somente leitura / Preview mode is read-only", 403);
            }
        }

        // PUBLIC partner-referral intake (no auth by design — see handlers).
        var refMatch = path.match(/^\/api\/referral\/([A-Za-z0-9]+)$/);
        if (refMatch) {
            if (method === "GET")  { return handleGetReferralInfo(refMatch[1], request, env); }
            if (method === "POST") { return handlePostReferralLead(refMatch[1], request, env); }
        }

        // PUBLIC intake for APEX'S OWN referral partners. Separate path and
        // separate handlers from /api/referral/ above: that one creates a
        // gm_leads row for a CLIENT, this one creates an Apex-internal lead.
        var apexRefMatch = path.match(/^\/api\/apex-referral\/([A-Za-z0-9]+)$/);
        if (apexRefMatch) {
            if (method === "GET")  { return handleGetApexReferralInfo(apexRefMatch[1], request, env); }
            if (method === "POST") { return handlePostApexReferralLead(apexRefMatch[1], request, env); }
        }

        // Apex's own partner roster — admin only, enforced in every handler.
        // Never under /api/clients/, because these rows belong to no client.
        if (path === "/api/apex-partners") {
            if (method === "GET")  { return handleGetApexPartners(request, env); }
            if (method === "POST") { return handlePostApexPartner(request, env); }
        }
        var apexPartnerMatch = path.match(/^\/api\/apex-partners\/([A-Za-z0-9-]+)$/);
        if (apexPartnerMatch) {
            if (method === "PUT")    { return handlePutApexPartner(apexPartnerMatch[1], request, env); }
            if (method === "DELETE") { return handleDeleteApexPartner(apexPartnerMatch[1], request, env); }
        }

        if (path === "/api/auth/client-login"           && method === "POST") { return handlePostClientLogin(request, env); }
        if (path === "/api/auth/client-change-password" && method === "POST") { return handlePostClientChangePassword(request, env); }
        if (path === "/api/auth/client-link-google"     && method === "POST") { return handlePostClientLinkGoogle(request, env); }
        if (path === "/api/auth/client-logout"          && method === "POST") { return handlePostClientLogout(request, env); }
        if (path === "/api/portal/me"                   && method === "GET")  { return handleGetPortalMe(request, env); }
        if (path === "/api/portal/next-meeting"         && method === "GET")  { return handleGetPortalNextMeeting(request, env); }
        if (path === "/api/leaderboard"                 && method === "GET")  { return handleGetLeaderboard(request, env); }
        if (path === "/api/goal-approvals"              && method === "GET")  { return handleGetGoalApprovals(request, env); }

        if (path === "/api/role"                       && method === "GET")  { return handleGetRole(request, env); }
        if (path === "/api/google/oauth/start"        && method === "GET")  { return handleGoogleOAuthStart(request, env); }
        if (path === "/api/google/oauth/callback"     && method === "GET")  { return handleGoogleOAuthCallback(request, env); }
        if (path === "/api/google/oauth/status"       && method === "GET")  { return handleGoogleOAuthStatus(request, env); }
        if (path === "/api/google/calendar/event"     && method === "POST") { return handlePostGoogleCalendarEvent(request, env); }
        if (path === "/api/google/calendar/events"    && method === "GET")  { return handleGetGoogleCalendarEvents(request, env); }
        if (path === "/api/zoho/oauth/start"          && method === "GET")  { return handleZohoOAuthStart(request, env); }
        if (path === "/api/zoho/oauth/callback"       && method === "GET")  { return handleZohoOAuthCallback(request, env); }
        if (path === "/api/zoho/oauth/status"         && method === "GET")  { return handleZohoOAuthStatus(request, env); }
        if (path === "/api/sessions"              && method === "GET")  { return handleGetSessions(request, env); }
        if (path === "/api/sessions/inbox"        && method === "GET")  { return handleGetSessionsInbox(request, env); }
        if (path === "/api/sessions/calendar"     && method === "GET")  { return handleGetSessionsCalendar(request, env); }
        if (path === "/api/sessions/match-for-event" && method === "GET") { return handleGetSessionsMatchForEvent(request, env); }
        if (path === "/api/sessions/schedule"     && method === "POST") { return handlePostSessionsSchedule(request, env); }
        if (path === "/api/fireflies/webhook"    && method === "POST") { return handleFirefliesWebhook(request, env); }
        if (path === "/api/fireflies/transcripts" && method === "GET")  { return handleGetFirefliesTranscripts(request, env); }
        if (path === "/api/fireflies/pull"        && method === "POST") { return handlePostFirefliesPull(request, env); }
        if (path === "/api/fireflies/dismiss"     && method === "POST") { return handlePostFirefliesDismiss(request, env); }
        if (path === "/api/clients"              && method === "GET")  { return handleGetClients(request, env); }
        if (path === "/api/clients"              && method === "POST") { return handlePostClients(request, env); }
        if (path === "/api/transcript"           && method === "POST") { return handlePostTranscript(request, env); }
        if (path === "/api/summarize"            && method === "POST") { return handlePostSummarize(request, env); }
        if (path === "/api/approve"              && method === "POST") { return handlePostApprove(request, env); }
        if (path === "/api/users"                && method === "GET")  { return handleGetUsers(request, env); }
        if (path === "/api/users"                && method === "POST") { return handlePostUsers(request, env); }
        if (path === "/api/me/profile"           && method === "GET")  { return handleGetMyProfile(request, env); }
        if (path === "/api/me/profile"           && method === "PATCH") { return handlePatchMyProfile(request, env); }
        if (path === "/api/me/avatar"            && method === "POST") { return handlePostMyAvatar(request, env); }
        if (path === "/api/me/avatar-image"      && method === "GET")  { return handleGetMyAvatarImage(request, env); }
        if (path === "/api/settings/templates"   && method === "GET")  { return handleGetSettingsTemplates(request, env); }
        if (path === "/api/settings/packages"    && method === "GET")  { return handleGetSettingsPackages(request, env); }
        if (path === "/api/settings/packages"    && method === "POST") { return handlePostSettingsPackages(request, env); }
        if (path === "/api/business/settings"    && method === "GET")   { return handleGetBusinessSettings(request, env); }
        if (path === "/api/business/settings"    && method === "PATCH") { return handlePatchBusinessSettings(request, env); }
        if (path === "/api/business/qr"          && method === "POST")  { return handlePostBusinessQr(request, env); }
        if (path === "/api/business/qr-image"    && method === "GET")   { return handleGetBusinessQrImage(request, env); }

        if (path === "/api/invoices"                 && method === "GET")  { return handleGetInvoices(request, env); }
        if (path === "/api/invoices"                 && method === "POST") { return handlePostInvoice(request, env); }
        if (path === "/api/finance/ar-aging"         && method === "GET")  { return handleGetFinanceArAging(request, env); }
        if (path === "/api/finance/tax-summary"      && method === "GET")  { return handleGetFinanceTaxSummary(request, env); }
        if (path === "/api/finance/statement-upload" && method === "POST") { return handlePostFinanceStatementUpload(request, env); }
        if (path === "/api/finance/overview"         && method === "GET")  { return handleGetFinanceOverview(request, env); }
        if (path === "/api/finance/chart"            && method === "GET")  { return handleGetFinanceChart(request, env); }
        if (path === "/api/finance/subscriptions"    && method === "GET")  { return handleGetFinanceSubscriptions(request, env); }
        if (path === "/api/finance/subscriptions"    && method === "POST") { return handlePostFinanceSubscriptions(request, env); }
        if (path === "/api/finance/reconciliation"   && method === "GET")  { return handleGetFinanceReconciliation(request, env); }
        if (path === "/api/finance/reconciliation/category-totals" && method === "GET") { return handleGetReconciliationCategoryTotals(request, env); }
        if (path === "/api/finance/bank-status"       && method === "GET")  { return handleGetFinanceBankStatus(request, env); }
        if (path === "/api/finance/expense-form-data" && method === "GET")  { return handleGetFinanceExpenseFormData(request, env); }
        if (path === "/api/finance/categories"        && method === "GET")  { return handleGetFinanceCategories(request, env); }
        if (path === "/api/finance/categories"        && method === "POST") { return handlePostFinanceCategory(request, env); }
        if (path === "/api/finance/expenses"          && method === "GET")  { return handleGetFinanceExpenses(request, env); }
        if (path === "/api/finance/expenses"          && method === "POST") { return handlePostFinanceExpense(request, env); }
        if (path === "/api/sales/growth-ranking"      && method === "GET")  { return handleGetSalesGrowthRanking(request, env); }
        if (path === "/api/resources"                 && method === "GET")  { return handleGetResources(request, env); }
        if (path === "/api/resources"                 && method === "POST") { return handlePostResource(request, env); }
        if (path === "/api/client-resources/pending"  && method === "GET")  { return handleGetClientResourcesPending(request, env); }
        if (path === "/api/client-resources/progress" && method === "GET")  { return handleGetClientResourcesProgress(request, env); }
        if (path === "/api/zoho/contacts/resync-status" && method === "GET")  { return handleGetZohoContactsResyncStatus(request, env); }
        if (path === "/api/zoho/contacts/resync"        && method === "POST") { return handlePostZohoContactsResync(request, env); }

        // Parameterized routes: /api/sessions/:id/task-completions, /api/sessions/:id/assign-client, /api/sessions/:id/whatsapp
        var segs = path.replace(/^\//, "").split("/");
        if (segs[0] === "api" && segs[1] === "sessions" && segs[2] && segs[3] === "section-config") {
            if (method === "GET") { return handleGetSessionSectionConfig(segs[2], request, env); }
            if (method === "PUT") { return handlePutSessionSectionConfig(segs[2], request, env); }
        }
        if (segs[0] === "api" && segs[1] === "sessions" && segs[2] && segs[3] === "pdf-data" && method === "GET") {
            return handleGetSessionPdfData(segs[2], request, env);
        }
        if (segs[0] === "api" && segs[1] === "sessions" && segs[2] && segs[3] === "task-completions" && method === "PATCH") {
            return handlePatchSessionTaskCompletions(segs[2], request, env);
        }
        if (segs[0] === "api" && segs[1] === "sessions" && segs[2] && segs[3] === "transcript" && method === "GET") {
            return handleGetSessionTranscript(segs[2], request, env);
        }
        if (segs[0] === "api" && segs[1] === "sessions" && segs[2] && segs[3] === "assign-client" && method === "POST") {
            return handlePostSessionAssignClient(segs[2], request, env);
        }
        if (segs[0] === "api" && segs[1] === "sessions" && segs[2] && segs[3] === "discard" && method === "POST") {
            return handlePostSessionDiscard(segs[2], request, env);
        }
        if (segs[0] === "api" && segs[1] === "sessions" && segs[2] && segs[3] === "whatsapp" && method === "POST") {
            return handlePostSessionWhatsapp(segs[2], request, env);
        }
        if (segs[0] === "api" && segs[1] === "sessions" && segs[2] && segs[3] === "meet-link" && method === "PATCH") {
            return handlePatchSessionMeetLink(segs[2], request, env);
        }
        if (segs[0] === "api" && segs[1] === "sessions" && segs[2] && segs[3] === "cancel" && method === "POST") {
            return handlePostSessionCancel(segs[2], request, env);
        }
        if (segs[0] === "api" && segs[1] === "sessions" && segs[2] && segs[3] === "reschedule" && method === "POST") {
            return handlePostSessionReschedule(segs[2], request, env);
        }
        // /api/sessions/:id  PATCH -- edit location/notes/end_time
        if (segs[0] === "api" && segs[1] === "sessions" && segs[2] && segs.length === 3 && method === "PATCH") {
            return handlePatchSessionDetails(segs[2], request, env);
        }

        // /api/goal-approvals/:client_id/:indicator_key/:month_label  POST
        if (segs[0] === "api" && segs[1] === "goal-approvals" && segs[2] && segs[3] && segs[4] && method === "POST") {
            return handlePostGoalApprovalDecision(segs[2], segs[3], segs[4], request, env);
        }

        // /api/client-resources/:id/mark-sent  POST
        if (segs[0] === "api" && segs[1] === "client-resources" && segs[2] && segs[3] === "mark-sent" && method === "POST") {
            return handlePostClientResourceMarkSent(segs[2], request, env);
        }

        // /api/resources/:id  PUT | /api/resources/:id/file  GET
        if (segs[0] === "api" && segs[1] === "resources" && segs[2]) {
            if (segs.length === 3 && method === "PUT") { return handlePutResource(segs[2], request, env); }
            if (segs.length === 4 && segs[3] === "file" && method === "GET") {
                return handleGetResourceFile(segs[2], request, env);
            }
        }

        // /api/users/:email  DELETE
        if (segs[0] === "api" && segs[1] === "users" && segs[2] && method === "DELETE") {
            return handleDeleteUser(segs[2], request, env);
        }

        // /api/users/:email/avatar-image  GET
        if (segs[0] === "api" && segs[1] === "users" && segs[2] && segs[3] === "avatar-image" && method === "GET") {
            return handleGetUserAvatarImage(segs[2], request, env);
        }

        // /api/users/:email/avatar  POST
        if (segs[0] === "api" && segs[1] === "users" && segs[2] && segs[3] === "avatar" && method === "POST") {
            return handlePostUserAvatar(segs[2], request, env);
        }

        // /api/settings/templates/:key  PUT
        if (segs[0] === "api" && segs[1] === "settings" && segs[2] === "templates" && segs[3] && method === "PUT") {
            return handlePutSettingsTemplate(segs[3], request, env);
        }

        // /api/settings/packages/:id  PUT | DELETE
        if (segs[0] === "api" && segs[1] === "settings" && segs[2] === "packages" && segs[3] && method === "PUT") {
            return handlePutSettingsPackage(segs[3], request, env);
        }
        if (segs[0] === "api" && segs[1] === "settings" && segs[2] === "packages" && segs[3] && method === "DELETE") {
            return handleDeleteSettingsPackage(segs[3], request, env);
        }

        // Parameterized routes: /api/clients/:id[/notes | /logo | /logo-image | /documents/latest]
        if (segs[0] === "api" && segs[1] === "clients" && segs[2]) {
            var cid = segs[2];
            if (segs.length === 3 && method === "GET")   { return handleGetClient(cid, request, env); }
            if (segs.length === 3 && method === "PATCH") { return handlePatchClient(cid, request, env); }
            if (segs.length === 4 && segs[3] === "notes") {
                if (method === "GET")  { return handleGetClientNotes(cid, request, env); }
                if (method === "POST") { return handlePostClientNote(cid, request, env); }
            }
            if (segs.length === 4 && segs[3] === "contacts" && method === "GET") {
                return handleGetClientContacts(cid, request, env);
            }
            if (segs.length === 4 && segs[3] === "contact-log") {
                if (method === "GET")  { return handleGetLeadContactLog(cid, request, env); }
                if (method === "POST") { return handlePostLeadContactLog(cid, request, env); }
            }
            if (segs.length === 4 && segs[3] === "lead-pipeline" && method === "GET") {
                return handleGetLeadPipeline(cid, request, env);
            }
            if (segs.length === 4 && segs[3] === "lead-stage" && method === "PATCH") {
                return handlePatchLeadStage(cid, request, env);
            }
            if (segs.length === 4 && segs[3] === "lead-next-step" && method === "PATCH") {
                return handlePatchLeadNextStep(cid, request, env);
            }
            if (segs.length === 4 && segs[3] === "lead-outcome" && method === "POST") {
                return handlePostLeadOutcome(cid, request, env);
            }
            if (segs.length === 4 && segs[3] === "logo" && method === "POST") {
                return handlePostClientLogo(cid, request, env);
            }
            if (segs.length === 4 && segs[3] === "logo-image" && method === "GET") {
                return handleGetClientLogoImage(cid, request, env);
            }
            if (segs.length === 5 && segs[3] === "documents" && segs[4] === "latest" && method === "GET") {
                return handleGetClientLatestDocument(cid, request, env);
            }
            if (segs.length === 4 && segs[3] === "documents") {
                if (method === "GET")  { return handleGetClientDocuments(cid, request, env); }
                if (method === "POST") { return handlePostClientDocument(cid, request, env); }
            }
            if (segs.length === 6 && segs[3] === "documents" && segs[5] === "file" && method === "GET") {
                return handleGetClientDocumentFile(cid, segs[4], request, env);
            }
            if (segs.length === 5 && segs[3] === "documents" && method === "DELETE") {
                return handleDeleteClientDocument(cid, segs[4], request, env);
            }
            if (segs.length === 4 && segs[3] === "digital-presence") {
                if (method === "GET")   { return handleGetDigitalPresence(cid, request, env); }
                if (method === "PATCH") { return handlePatchDigitalPresence(cid, request, env); }
            }
            if (segs.length === 4 && segs[3] === "tasks") {
                if (method === "GET")  { return handleGetClientTasks(cid, request, env); }
                if (method === "POST") { return handlePostClientTask(cid, request, env); }
            }
            if (segs.length === 4 && segs[3] === "invoices" && method === "GET") {
                return handleGetClientInvoices(cid, request, env);
            }
            if (segs.length === 4 && segs[3] === "resources") {
                if (method === "GET")  { return handleGetClientResources(cid, request, env); }
                if (method === "POST") { return handlePostClientResource(cid, request, env); }
            }
            if (segs.length === 4 && segs[3] === "growth") {
                if (method === "GET")  { return handleGetClientGrowth(cid, request, env); }
                if (method === "POST") { return handlePostClientGrowth(cid, request, env); }
            }
            if (segs.length === 4 && segs[3] === "package-terms") {
                if (method === "GET") { return handleGetClientPackageTerms(cid, request, env); }
                if (method === "PUT") { return handlePutClientPackageTerms(cid, request, env); }
            }
            if (segs.length === 4 && segs[3] === "zoho-contact") {
                if (method === "GET") { return handleGetClientZohoContact(cid, request, env); }
                if (method === "PUT") { return handlePutClientZohoContact(cid, request, env); }
            }
            // Client Portal routes
            if (segs.length === 4 && segs[3] === "login") {
                if (method === "GET")  { return handleGetClientLoginStatus(cid, request, env); }
                if (method === "POST") { return handlePostClientLoginCreate(cid, request, env); }
            }
            if (segs.length === 4 && segs[3] === "field-config") {
                if (method === "GET") { return handleGetClientFieldConfig(cid, request, env); }
                if (method === "PUT") { return handlePutClientFieldConfig(cid, request, env); }
            }
            if (segs.length === 4 && segs[3] === "goal-state" && method === "GET") {
                return handleGetGoalState(cid, request, env);
            }
            if (segs.length === 4 && segs[3] === "goals" && method === "PUT") {
                return handlePutClientGoals(cid, request, env);
            }
            if (segs.length === 4 && segs[3] === "indicator-history" && method === "GET") {
                return handleGetIndicatorHistory(cid, request, env);
            }
            if (segs.length === 4 && segs[3] === "entry-state" && method === "GET") {
                return handleGetEntryState(cid, request, env);
            }
            if (segs.length === 4 && segs[3] === "work-settings") {
                if (method === "GET") { return handleGetWorkSettings(cid, request, env); }
                if (method === "PUT") { return handlePutWorkSettings(cid, request, env); }
            }
            if (segs.length === 4 && segs[3] === "referral-settings") {
                if (method === "GET") { return handleGetReferralSettings(cid, request, env); }
                if (method === "PUT") { return handlePutReferralSettings(cid, request, env); }
            }
            if (segs.length === 4 && segs[3] === "blocked-ranges" && method === "POST") {
                return handlePostBlockedRange(cid, request, env);
            }
            if (segs.length === 5 && segs[3] === "blocked-ranges" && method === "DELETE") {
                return handleDeleteBlockedRange(cid, segs[4], request, env);
            }
            if (segs.length === 4 && segs[3] === "working-days" && method === "GET") {
                return handleGetWorkingDays(cid, request, env);
            }
            if (segs.length === 4 && segs[3] === "help-request" && method === "POST") {
                return handlePostHelpRequest(cid, request, env);
            }
            if (segs.length === 4 && segs[3] === "entries" && method === "GET") {
                return handleGetClientEntries(cid, request, env);
            }
            if (segs.length === 4 && segs[3] === "entries-summary" && method === "GET") {
                return handleGetEntriesSummary(cid, request, env);
            }
            if (segs.length === 4 && segs[3] === "weekly-summary" && method === "GET") {
                return handleGetWeeklySummary(cid, request, env);
            }
            if (segs.length === 7 && segs[3] === "entries" && segs[5] === "sections" && method === "PUT") {
                return handlePutEntrySection(cid, segs[4], segs[6], request, env);
            }
            if (segs.length === 6 && segs[3] === "entries" && segs[5] === "day-off" && method === "POST") {
                return handlePostEntryDayOff(cid, segs[4], request, env);
            }
            // Assessments (Business X-Ray + future types)
            if (segs.length === 4 && segs[3] === "assessments") {
                if (method === "GET")  { return handleGetClientAssessments(cid, request, env); }
                if (method === "POST") { return handlePostClientAssessment(cid, request, env); }
            }
            if (segs.length === 5 && segs[3] === "assessments") {
                if (method === "GET")    { return handleGetClientAssessmentDetail(cid, segs[4], request, env); }
                if (method === "DELETE") { return handleDeleteClientAssessment(cid, segs[4], request, env); }
            }
            if (segs.length === 6 && segs[3] === "assessments" && segs[5] === "answers" && method === "PUT") {
                return handlePutAssessmentAnswers(cid, segs[4], request, env);
            }
            // Growth Management (the six data tabs) — /api/clients/:id/gm/...
            if (segs[3] === "gm" && segs[4]) {
                var gmCol = segs[4];
                if (segs.length === 5 && method === "GET") {
                    if (gmCol === "config")    { return handleGetGmConfig(cid, request, env); }
                    if (gmCol === "leads")     { return handleGetGmLeads(cid, request, env); }
                    if (gmCol === "roadmap")   { return handleGetGmRoadmap(cid, request, env); }
                    if (gmCol === "base-ouro") { return handleGetGmBaseOuro(cid, request, env); }
                    if (gmCol === "partners")  { return handleGetGmPartners(cid, request, env); }
                    if (gmCol === "finance")   { return handleGetGmFinance(cid, request, env); }
                    if (gmCol === "jobs")      { return handleGetGmJobs(cid, request, env); }
                }
                if (segs.length === 5 && method === "POST") {
                    if (gmCol === "leads")     { return handlePostGmLead(cid, request, env); }
                    if (gmCol === "roadmap")   { return handlePostGmRoadmap(cid, request, env); }
                    if (gmCol === "base-ouro") { return handlePostGmBaseOuro(cid, request, env); }
                    if (gmCol === "partners")  { return handlePostGmPartner(cid, request, env); }
                    if (gmCol === "finance")   { return handlePostGmFinance(cid, request, env); }
                    if (gmCol === "jobs")      { return handlePostGmJob(cid, request, env); }
                }
                if (segs.length === 5 && gmCol === "config" && method === "PUT") {
                    return handlePutGmConfig(cid, request, env);   // admin only
                }
                if (segs.length === 6 && gmCol === "config" && segs[5] === "view-mode" && method === "PUT") {
                    return handlePutGmViewMode(cid, request, env);
                }
                if (segs.length === 7 && gmCol === "base-ouro" && segs[6] === "reactivate" && method === "POST") {
                    return handlePostGmBaseOuroReactivate(cid, segs[5], request, env);
                }
                // /gm/leads/:leadId/contacts — the client CRM's outreach log
                if (segs.length === 7 && gmCol === "leads" && segs[6] === "contacts") {
                    if (method === "GET")  { return handleGetGmLeadContacts(cid, segs[5], request, env); }
                    if (method === "POST") { return handlePostGmLeadContact(cid, segs[5], request, env); }
                }
                if (segs.length === 6 && method === "PUT") {
                    if (gmCol === "leads")     { return handlePutGmLead(cid, segs[5], request, env); }
                    if (gmCol === "roadmap")   { return handlePutGmRoadmap(cid, segs[5], request, env); }
                    if (gmCol === "base-ouro") { return handlePutGmBaseOuro(cid, segs[5], request, env); }
                    if (gmCol === "partners")  { return handlePutGmPartner(cid, segs[5], request, env); }
                    if (gmCol === "finance")   { return handlePutGmFinance(cid, segs[5], request, env); }
                    if (gmCol === "jobs")      { return handlePutGmJob(cid, segs[5], request, env); }
                }
                if (segs.length === 6 && method === "DELETE") {
                    return handleDeleteGmRow(cid, gmCol, segs[5], request, env);
                }
            }
        }

        // /api/finance/reconciliation/:transaction_id/match-invoice|categorize|exclude|restore|unmatch
        if (segs[0] === "api" && segs[1] === "finance" && segs[2] === "reconciliation" && segs[3] && segs[4] && method === "POST") {
            if (segs[4] === "match-invoice") { return handlePostReconciliationMatchInvoice(segs[3], request, env); }
            if (segs[4] === "categorize") { return handlePostReconciliationCategorize(segs[3], request, env); }
            if (segs[4] === "exclude" || segs[4] === "restore" || segs[4] === "unmatch") {
                return handlePostReconciliationAction(segs[3], segs[4], request, env);
            }
        }

        // /api/finance/categories/:account_id/hide|unhide  POST
        if (segs[0] === "api" && segs[1] === "finance" && segs[2] === "categories" && segs[3] && segs[4] && method === "POST") {
            if (segs[4] === "hide")   { return handlePostFinanceCategoryHide(request, env, decodeURIComponent(segs[3])); }
            if (segs[4] === "unhide") { return handlePostFinanceCategoryUnhide(request, env, decodeURIComponent(segs[3])); }
        }

        // /api/finance/categories/:account_id/label  PUT | DELETE
        if (segs[0] === "api" && segs[1] === "finance" && segs[2] === "categories" && segs[3] && segs[4] === "label") {
            if (method === "PUT")    { return handlePutFinanceCategoryLabel(request, env, decodeURIComponent(segs[3])); }
            if (method === "DELETE") { return handleDeleteFinanceCategoryLabel(request, env, decodeURIComponent(segs[3])); }
        }

        // /api/finance/subscriptions/:id  PUT | DELETE
        if (segs[0] === "api" && segs[1] === "finance" && segs[2] === "subscriptions" && segs[3] && method === "PUT") {
            return handlePutFinanceSubscription(segs[3], request, env);
        }
        if (segs[0] === "api" && segs[1] === "finance" && segs[2] === "subscriptions" && segs[3] && method === "DELETE") {
            return handleDeleteFinanceSubscription(segs[3], request, env);
        }

        // /api/tasks/consultant/overdue  GET — must come before generic tasks/:id match
        if (segs[0] === "api" && segs[1] === "tasks" && segs[2] === "consultant" && segs[3] === "overdue" && method === "GET") {
            return handleGetConsultantTasksOverdue(request, env);
        }

        // /api/tasks/consultant  GET (scope=today|week)
        if (segs[0] === "api" && segs[1] === "tasks" && segs[2] === "consultant" && !segs[3] && method === "GET") {
            return handleGetConsultantTasks(request, env);
        }

        // /api/tasks/:id  PATCH (status toggle — syncs with tasks.html)
        if (segs[0] === "api" && segs[1] === "tasks" && segs[2] && method === "PATCH") {
            return handlePatchTask(segs[2], request, env);
        }

        // /api/invoices/:zoho_invoice_id/package-check  GET
        if (segs[0] === "api" && segs[1] === "invoices" && segs[2] && segs[3] === "package-check" && method === "GET") {
            return handleGetInvoicePackageCheck(segs[2], request, env);
        }

        // /api/invoices/:zoho_invoice_id/mark-sent  POST
        if (segs[0] === "api" && segs[1] === "invoices" && segs[2] && segs[3] === "mark-sent" && method === "POST") {
            return handlePostInvoiceMarkSent(segs[2], request, env);
        }

        // /api/invoices/:zoho_invoice_id/render-data  GET
        if (segs[0] === "api" && segs[1] === "invoices" && segs[2] && segs[3] === "render-data" && method === "GET") {
            return handleGetInvoiceRenderData(segs[2], request, env);
        }

        // /api/invoices/:zoho_invoice_id/items  GET / PUT
        if (segs[0] === "api" && segs[1] === "invoices" && segs[2] && segs[3] === "items" && method === "GET") {
            return handleGetInvoiceItems(segs[2], request, env);
        }
        if (segs[0] === "api" && segs[1] === "invoices" && segs[2] && segs[3] === "items" && method === "PUT") {
            return handlePutInvoiceItems(segs[2], request, env);
        }

        return jsonErr("Not found", 404);
    },

    // -------------------------------------------------------------------
    // Cron: runs on the schedule set by `crons` in wrangler.toml. Proactively
    // exercises both getZohoAccessToken() and getGoogleAccessToken() -- a
    // real refresh-token exchange against each provider, not just a DB read
    // -- so a dead refresh token (revoked, expired from inactivity, or
    // scope drift) is caught here instead of by a client hitting a broken
    // button first. Alerts Nicole's own Telegram DM directly via the Bot
    // API on any failure. Successes are silent (no daily "all good" noise).
    // -------------------------------------------------------------------
    scheduled: async function(event, env, ctx) {
        ctx.waitUntil(checkIntegrationHealth(env));
    }
};

async function checkIntegrationHealth(env) {
    var failures = [];

    try {
        await getZohoAccessToken(env);
    } catch (e) {
        failures.push("Zoho Books: " + e.message);
    }

    try {
        var googleRow = await env.DB.prepare(
            "SELECT id FROM oauth_tokens WHERE id = 'google_calendar'"
        ).first();
        if (!googleRow) {
            failures.push("Google Calendar: not connected (no stored token)");
        } else {
            await getGoogleAccessToken(env);
        }
    } catch (e) {
        failures.push("Google Calendar: " + e.message);
    }

    if (failures.length > 0) {
        await notifyNicoleTelegram(env,
            "Apex integration check failed:\n\n" + failures.join("\n") +
            "\n\nReconnect via add-user.html when you're at your desktop."
        );
    }
}

// Sends Nicole a DM via the raw Telegram Bot API. Independent of the
// separate Claude Code Telegram-bot session/MCP setup -- this call goes
// straight from the Worker to Telegram, so it still works even if that
// other bot session is itself down. Best-effort: a failed alert is not
// retried and does not throw, since this runs inside ctx.waitUntil().
async function notifyNicoleTelegram(env, message) {
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_ALERT_CHAT_ID) { return; }
    try {
        await fetch("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/sendMessage", {
            method:  "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body:    new URLSearchParams({
                chat_id: env.TELEGRAM_ALERT_CHAT_ID,
                text:    message
            }).toString()
        });
    } catch (e) {
        // Nothing else to do -- no second alert channel exists.
    }
}
