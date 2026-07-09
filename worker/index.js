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

async function authenticate(request, env) {
    var auth = request.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) { return null; }
    var payload = await verifyFirebaseToken(auth.slice(7), env.FIREBASE_PROJECT_ID);
    var row = await env.DB.prepare("SELECT role, display_name, avatar_url FROM users WHERE email = ?")
        .bind(payload.email).first();
    if (!row) { return null; }
    return { email: payload.email, role: row.role, display_name: row.display_name ?? null, avatar_url: row.avatar_url ?? null };
}

// ---------------------------------------------------------------------------
// Route: GET /api/role
// ---------------------------------------------------------------------------

async function handleGetRole(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        return jsonOk({ role: user.role, email: user.email, display_name: user.display_name, avatar_url: user.avatar_url });
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
        transcript_text: text
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
        "WHERE date = ? AND client_name IS NOT NULL AND client_name != '' AND status != 'discarded'"
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
    var dateStr = new Date().toISOString().split("T")[0];
    if (dateVal !== null && dateVal !== undefined && dateVal !== "") {
        try {
            var n = typeof dateVal === "number" ? dateVal : Number(dateVal);
            // Fireflies returns epoch ms; also accept epoch seconds and ISO strings
            var d = isNaN(n) ? new Date(dateVal) : new Date(n < 1e12 ? n * 1000 : n);
            if (!isNaN(d.getTime())) { dateStr = d.toISOString().split("T")[0]; }
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
        "INSERT INTO sessions (id, client_name, date, status, raw_transcript, task_completions, created_at) " +
        "VALUES (?, ?, ?, 'inbox', ?, ?, datetime('now'))"
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

        // Fireflies "Transcription completed" webhooks carry only
        // { meetingId, eventType, clientReferenceId } — never the transcript itself.
        var meetingId  = payload.meetingId || payload.id || null;
        var eventType  = payload.eventType || payload.event || "";
        if (!meetingId) {
            console.log("Fireflies webhook: no meetingId in payload — skipped. Payload keys: " + Object.keys(payload).join(","));
            return jsonOk({ ok: true, note: "No meetingId — skipped" });
        }
        if (eventType && eventType.toLowerCase().indexOf("transcription") === -1) {
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

        var data = await firefliesGraphQL(env,
            "query Transcripts($limit: Int) { transcripts(limit: $limit) { " +
            "id title date duration organizer_email } }",
            { limit: 15 }
        );

        var dismissedRows = await env.DB.prepare(
            "SELECT transcript_id FROM fireflies_dismissed_transcripts"
        ).all();
        var dismissed = {};
        for (var d = 0; d < dismissedRows.results.length; d++) {
            dismissed[dismissedRows.results[d].transcript_id] = true;
        }

        var list = (data && data.transcripts || [])
            .filter(function(t) { return !dismissed[t.id]; })
            .map(function(t) {
                return {
                    id: t.id,
                    title: t.title || "Untitled meeting",
                    date: firefliesDateToYMD(t.date),
                    duration_min: t.duration ? Math.round(t.duration) : null,
                    organizer_email: t.organizer_email || null
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
        if (!meta.transcript_text) { return jsonErr("Transcript has no content yet — Fireflies may still be processing it", 422); }

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
            stmt = env.DB.prepare(
                "SELECT id, client_name, client_id, date, status, summary_json, pdf_data, task_completions, approved_at, created_at " +
                "FROM sessions WHERE status NOT IN ('archived','discarded') AND client_id = ? ORDER BY created_at DESC"
            ).bind(clientIdFilter);
        } else {
            stmt = env.DB.prepare(
                "SELECT id, client_name, client_id, date, status, summary_json, pdf_data, task_completions, approved_at, created_at " +
                "FROM sessions WHERE status NOT IN ('archived','discarded') ORDER BY created_at DESC"
            );
        }

        var res = await stmt.all();
        return jsonOk({ sessions: res.results });
    } catch (e) {
        return jsonErr("Error fetching sessions: " + e.message, 500);
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
        var newPdfDataStr = null;
        if (session.pdf_data) {
            try {
                var pdfData = JSON.parse(session.pdf_data);
                var customContent = null;
                try {
                    var summary = session.summary_json ? JSON.parse(session.summary_json) : null;
                    customContent = summary ? summary.custom_section_content : null;
                } catch (se) { customContent = null; }
                applySectionConfigToPdfData(pdfData, cfg, customContent);
                newPdfDataStr = JSON.stringify(pdfData);
            } catch (pe) { newPdfDataStr = null; }
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
            "INSERT INTO sessions (id, client_name, client_id, date, status, raw_transcript) VALUES (?, ?, ?, ?, 'pending', ?)"
        ).bind(sessionId, clientName, clientId, sessionDate, body.transcript).run();

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

var SUMMARY_PROMPT = "Generate a session summary for the transcript below.\n\n" +
    "Respond with a JSON object containing exactly 10 top-level keys.\n\n" +
    "Keys 1-6 are for internal review only. Each must be an object with 'pt' and 'en' string fields:\n" +
    "  discussion_overview, recommendations, client_action_items, rafa_followups,\n" +
    "  next_session_focus, client_profile_updates\n\n" +
    "Keys 7-9 are structured sections. Each must be an object with 'pt' and 'en' fields, where pt and en\n" +
    "hold the SAME structure (pt in Brazilian Portuguese, en in English — translate descriptions; keep\n" +
    "dimension/area names and level values EXACTLY as specified, in Portuguese, in BOTH languages):\n" +
    "  business_diagnosis: pt/en are each an array of exactly 10 rows, one per business dimension,\n" +
    "    in exactly this order: \"Produto/Serviço\", \"Fundadores\", \"Experiência do Cliente\",\n" +
    "    \"Time Operacional\", \"Time Comercial\", \"Marketing & Presença Digital\", \"Infraestrutura\",\n" +
    "    \"Documentação Legal\", \"Sistemas de Gestão\", \"Parcerias\".\n" +
    "    Each row: {\"dimension\": \"<fixed name above>\", \"situation\": \"1 short sentence describing the\n" +
    "    client's current situation in that dimension, extracted from the transcript\", \"level\": one of\n" +
    "    exactly \"FORTE\", \"MÉDIO\", \"FRACO\", \"CRÍTICO\" — your assessment from the transcript content}\n" +
    "  swot_synthesis: pt/en are each an object with exactly 3 string fields, each a short analytical\n" +
    "    paragraph (2-3 sentences) cross-referencing the SWOT quadrants you produced:\n" +
    "    {\"forca_oportunidade\": \"how the strengths enable capturing the opportunities\",\n" +
    "     \"fraqueza_ameaca\": \"the biggest combined risk where weaknesses meet threats\",\n" +
    "     \"forca_ameaca\": \"how the strengths defend against the threats\"}\n" +
    "  thirty_day_goals: pt/en are each an array of exactly 7 rows, one per area, in exactly this order:\n" +
    "    \"Operacional\", \"Comercial\", \"Marketing\", \"Parcerias\", \"Infraestrutura\", \"Legal\", \"Sistemas\".\n" +
    "    Each row: {\"area\": \"<fixed name above>\", \"meta\": \"a concrete 30-day goal for that area derived\n" +
    "    from the transcript\", \"indicador\": \"a measurable success indicator for that goal\"}\n\n" +
    "Key 10 is 'pdf_data' — a client-facing deliverable written entirely in Brazilian Portuguese.\n" +
    "pdf_data must be an object with exactly these fields:\n" +
    "  document_title: always the exact string \"Relatorio\\nEstrategico\" (use \\n between the two words)\n" +
    "  executive_summary: string, 2-4 sentences summarizing the session\n" +
    "  headline_insights: array of 2-4 objects: [{\"title\": \"...\", \"body\": \"1-2 sentences\"}]\n" +
    "  recommendations: array of 2-4 objects: [{\"number\": \"01\", \"title\": \"...\", \"body\": \"1-2 sentences\"}]\n" +
    "  client_actions: array of 2-4 objects: [{\"text\": \"...\", \"due\": \"DD Mon\"}] (abbreviated Portuguese month, e.g. '20 Jun')\n" +
    "  consultant_followups: array of 2-4 objects: [{\"text\": \"...\", \"due\": \"DD Mon\"}]\n" +
    "  next_session_focus_points: array of 2-4 objects: [{\"number\": \"01\", \"text\": \"...\"}]\n" +
    "  swot: {\"strengths\": [2-4 strings], \"weaknesses\": [2-4 strings], \"opportunities\": [2-4 strings], \"threats\": [2-4 strings]}\n" +
    "  thirty_day_plan: array of exactly 4 week objects:\n" +
    "    [{\"week_label\": \"SEMANA 1\", \"week_title\": \"short theme\", \"items\": [{\"text\": \"...\", \"owner\": \"CLIENTE\"}]}]\n" +
    "    owner must be exactly 'CLIENTE' or 'CONSULTOR' (uppercase, no other values)\n" +
    "  business_diagnosis: identical structure and content to the 'pt' side of top-level business_diagnosis\n" +
    "  swot_synthesis: identical structure and content to the 'pt' side of top-level swot_synthesis\n" +
    "  thirty_day_goals: identical structure and content to the 'pt' side of top-level thirty_day_goals\n\n" +
    "Rules: 2-4 items per array unless stated otherwise. Exactly 4 week entries in thirty_day_plan.\n" +
    "Exactly 10 rows in business_diagnosis and exactly 7 rows in thirty_day_goals, in the fixed order given.\n" +
    "If the transcript lacks enough detail for a field, infer a reasonable conservative entry — do not leave arrays empty.\n";

// Instruction block appended to SUMMARY_PROMPT when the session's section_config
// defines custom sections. Asks for one more top-level key, custom_section_content,
// keyed by custom section id.
function buildCustomSectionsPrompt(customSections) {
    if (!customSections || customSections.length === 0) { return ""; }
    var block = "\nAdditionally, include one more top-level key: 'custom_section_content'.\n" +
        "It must be an object with exactly " + customSections.length + " key(s), one per custom section id below.\n" +
        "Each value must be an object with 'pt' and 'en' fields; each of those is an object shaped as\n" +
        "{\"title\": \"<the exact title given>\", \"body\": \"1-3 sentence paragraph grounded in the transcript\",\n" +
        " \"bullets\": [2-5 short strings]}. Write pt in Brazilian Portuguese and en in English.\n";
    for (var i = 0; i < customSections.length; i++) {
        var cs = customSections[i];
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

        // All nine standard sections are always generated regardless of enabled/
        // disabled state — section_config only controls what the template renders.
        // Custom sections, however, need their own instruction block.
        var sectionCfg = parseSectionConfig(session.section_config);
        var promptText = SUMMARY_PROMPT +
            buildCustomSectionsPrompt(sectionCfg.custom_sections) +
            "\nTranscript:\n" + session.raw_transcript;

        var claudeRes = await fetch(CLAUDE_API_URL, {
            method: "POST",
            headers: {
                "Content-Type":      "application/json",
                "x-api-key":         env.CLAUDE_API_KEY,
                "anthropic-version": "2023-06-01"
            },
            body: JSON.stringify({
                model:      CLAUDE_MODEL,
                max_tokens: 8192,
                system:     SUMMARY_SYSTEM,
                messages:   [{ role: "user", content: promptText }]
            })
        });

        if (!claudeRes.ok) {
            var claudeErr = await claudeRes.text();
            return jsonErr("Claude API error: " + claudeErr, 502);
        }

        var claudeData = await claudeRes.json();
        var rawText    = claudeData.content[0].text.trim();

        var summaryJson;
        try {
            summaryJson = JSON.parse(rawText);
        } catch (parseErr) {
            var match = rawText.match(/\{[\s\S]*\}/);
            if (!match) { return jsonErr("Could not parse Claude response as JSON", 500); }
            summaryJson = JSON.parse(match[0]);
        }

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
            "package, status, phone, email, whatsapp, payment_method, contacts, zoho_customer_id, created_at " +
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
            "(id, name, owners, industry, location, logo_url, profile_pt, profile_en, package, status, phone, email, whatsapp, contacts) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
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
            body.contacts   || null
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

        var client = await env.DB.prepare(
            "SELECT id, name, owners, industry, location, logo_url, profile_pt, profile_en, " +
            "package, status, phone, email, whatsapp, payment_method, contacts, " +
            "created_at FROM clients WHERE id = ?"
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
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

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
// Body: { client_id, date, time, session_type, notes }
// session_type: 'online_meet' | 'in_person'
// ---------------------------------------------------------------------------

async function handlePostSessionsSchedule(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }

        var body = await request.json();
        if (!body.client_id)    { return jsonErr("client_id is required", 400); }
        if (!body.date)         { return jsonErr("date is required", 400); }
        if (!body.time)         { return jsonErr("time is required", 400); }
        if (body.session_type !== "online_meet" && body.session_type !== "in_person") {
            return jsonErr("session_type must be online_meet or in_person", 400);
        }

        var client = await env.DB.prepare("SELECT id, name FROM clients WHERE id = ?")
            .bind(body.client_id).first();
        if (!client) { return jsonErr("Client not found", 404); }

        var sessionId    = crypto.randomUUID();
        var meetLink = null;
        if (body.session_type === "online_meet") {
          meetLink = body.google_meet_link || "[PENDING_GOOGLE_API]";
        }

        await env.DB.prepare(
            "INSERT INTO sessions (id, client_id, client_name, date, time, session_type, google_meet_link, google_event_id, calendar_provider, status, raw_transcript) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'apex', 'scheduled', ?)"
        ).bind(sessionId, body.client_id, client.name, body.date, body.time, body.session_type, meetLink, body.google_event_id || null, body.notes || null).run();

        var session = await env.DB.prepare(
            "SELECT id, client_id, client_name, date, time, session_type, google_meet_link, status, whatsapp_sent_at, created_at " +
            "FROM sessions WHERE id = ?"
        ).bind(sessionId).first();

        return jsonOk({ session: session });
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
            "google_event_id, calendar_provider, html_link, end_time, attendees, raw_transcript, pdf_data " +
            "FROM sessions WHERE date LIKE ? AND status != 'discarded' ORDER BY date ASC, time ASC"
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
                attendees:          row.attendees ? JSON.parse(row.attendees) : null,
                has_transcript:     !!row.raw_transcript,
                has_pdf:            !!row.pdf_data
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
            "FROM sessions WHERE date = ? AND status != 'discarded'"
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
    session_online: "Olá! Sua sessão de consultoria está agendada para {weekday}, {date} às {time}. Acesse aqui: {meetLink}"
};

async function handlePostSessionWhatsapp(sessionId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }

        var session = await env.DB.prepare(
            "SELECT id, client_id, client_name, date, time, session_type, google_meet_link, status " +
            "FROM sessions WHERE id = ?"
        ).bind(sessionId).first();
        if (!session) { return jsonErr("Session not found", 404); }

        var d       = new Date(session.date + "T12:00:00");
        var weekday = WEEKDAYS_PT[d.getDay()];
        var dateParts = session.date.split("-");
        var dateFormatted = dateParts[2] + "/" + dateParts[1] + "/" + dateParts[0];
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
// Route: GET /api/google/oauth/start
// Auth: developer only. Returns Google OAuth authorization URL as JSON.
// ---------------------------------------------------------------------------

async function handleGoogleOAuthStart(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "developer") { return jsonErr("Forbidden", 403); }

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
// Auth: developer or alice. Returns { connected: true/false } — never the token.
// ---------------------------------------------------------------------------

async function handleGoogleOAuthStatus(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "developer" && user.role !== "alice") { return jsonErr("Forbidden", 403); }

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
            start: { dateTime: body.start_datetime, timeZone: "America/Sao_Paulo" },
            end:   { dateTime: body.end_datetime,   timeZone: "America/Sao_Paulo" }
        };

        if (body.add_meet_link) {
            eventBody.conferenceData = {
                createRequest: {
                    requestId: crypto.randomUUID(),
                    conferenceSolutionKey: { type: "hangoutsMeet" }
                }
            };
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

        // Pull every google_event_id already known to D1 so we don't insert
        // duplicates of Apex-created sessions or previously-persisted
        // external events.
        var knownRows = await env.DB.prepare(
            "SELECT google_event_id FROM sessions WHERE google_event_id IS NOT NULL AND google_event_id != ''"
        ).all();
        var known = {};
        for (var k = 0; k < knownRows.results.length; k++) {
            known[knownRows.results[k].google_event_id] = true;
        }

        for (var i = 0; i < items.length; i++) {
            var ev = items[i];
            if (!ev.id || known[ev.id]) { continue; }
            if (ev.status === "cancelled") { continue; }

            var startVal = (ev.start && (ev.start.dateTime || ev.start.date)) || null;
            var endVal   = (ev.end   && (ev.end.dateTime   || ev.end.date))   || null;
            if (!startVal) { continue; }

            var isAllDay = !(ev.start && ev.start.dateTime);
            var datePart = isAllDay ? startVal : startVal.slice(0, 10);
            var timePart = isAllDay ? null     : startVal.slice(11, 16);
            var sessionType = extractGoogleEventMeetLink(ev) ? "online_meet" : "in_person";
            var attendeesJson = null;
            if (ev.attendees && ev.attendees.length) {
                attendeesJson = JSON.stringify(ev.attendees.map(function(a) {
                    return { email: a.email || null, name: a.displayName || null, response_status: a.responseStatus || null };
                }));
            }

            await env.DB.prepare(
                "INSERT INTO sessions (id, client_name, date, time, session_type, google_meet_link, google_event_id, calendar_provider, status, html_link, end_time, attendees) " +
                "VALUES (?, ?, ?, ?, ?, ?, ?, 'google_external', 'scheduled', ?, ?, ?)"
            ).bind(
                crypto.randomUUID(),
                ev.summary || "(No title)",
                datePart,
                timePart,
                sessionType,
                extractGoogleEventMeetLink(ev),
                ev.id,
                ev.htmlLink || null,
                endVal,
                attendeesJson
            ).run();
            known[ev.id] = true; // guard against dupes within the same Google page of results
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
        params.set("scope",         "ZohoBooks.invoices.ALL,ZohoBooks.contacts.ALL,ZohoBooks.expenses.ALL,ZohoBooks.customerpayments.ALL,ZohoBooks.settings.READ,ZohoBooks.banking.ALL");
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
            "base_price, has_payment_plan, installment_count, installment_amount " +
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
                installment_amount: row.installment_amount ?? null
            };
        });

        return jsonOk({ packages: pkgs });
    } catch (e) {
        return jsonErr("Error fetching packages: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/settings/packages
// Body: { short_name, full_name, audience?, included_items? (array), is_popular? (boolean), sort_order? }
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

        var pkgId = crypto.randomUUID();
        await env.DB.prepare(
            "INSERT INTO packages (id, short_name, full_name, audience, included_items, is_popular, sort_order, base_price, has_payment_plan, installment_count, installment_amount) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(
            pkgId,
            body.short_name.trim(),
            body.full_name.trim(),
            body.audience || null,
            JSON.stringify(includedItems),
            isPopular,
            sortOrder,
            basePrice,
            hasPaymentPlan,
            installmentCount,
            installmentAmount
        ).run();

        var row = await env.DB.prepare(
            "SELECT id, short_name, full_name, audience, included_items, is_popular, sort_order, " +
            "base_price, has_payment_plan, installment_count, installment_amount FROM packages WHERE id = ?"
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
            installment_amount: row.installment_amount ?? null
        }});
    } catch (e) {
        return jsonErr("Error creating package: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: PUT /api/settings/packages/:id
// Body: any subset of { short_name, full_name, audience, included_items (array), is_popular (boolean), sort_order }
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
            await env.DB.prepare("UPDATE packages SET short_name = ? WHERE id = ?")
                .bind(body.short_name.trim(), id).run();
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

        var row = await env.DB.prepare(
            "SELECT id, short_name, full_name, audience, included_items, is_popular, sort_order, " +
            "base_price, has_payment_plan, installment_count, installment_amount FROM packages WHERE id = ?"
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
            installment_amount: row.installment_amount ?? null
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
            "SELECT id, client_id, month_label, growth_percent, entered_by, entered_at " +
            "FROM client_growth_entries WHERE client_id = ? ORDER BY month_label ASC"
        ).bind(id).all();

        return jsonOk({ growth_entries: rows.results });
    } catch (e) {
        return jsonErr("Error fetching growth entries: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/clients/:id/growth
// Body: { month_label: 'YYYY-MM', growth_percent: number }
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

        var client = await env.DB.prepare("SELECT id FROM clients WHERE id = ?").bind(id).first();
        if (!client) { return jsonErr("Client not found", 404); }

        var enteredBy = user.display_name || user.role;
        await env.DB.prepare(
            "INSERT INTO client_growth_entries (id, client_id, month_label, growth_percent, entered_by) " +
            "VALUES (?, ?, ?, ?, ?) " +
            "ON CONFLICT (client_id, month_label) DO UPDATE SET " +
            "growth_percent = excluded.growth_percent, entered_by = excluded.entered_by, " +
            "entered_at = datetime('now')"
        ).bind(crypto.randomUUID(), id, monthLabel, pct, enteredBy).run();

        var row = await env.DB.prepare(
            "SELECT id, client_id, month_label, growth_percent, entered_by, entered_at " +
            "FROM client_growth_entries WHERE client_id = ? AND month_label = ?"
        ).bind(id, monthLabel).first();
        return jsonOk({ growth_entry: row });
    } catch (e) {
        return jsonErr("Error saving growth entry: " + e.message, 500);
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
// Accepts a CSV or plain-text bank statement, sends to Claude, inserts parsed
// transactions into bank_transactions with status='pending'.
// ---------------------------------------------------------------------------

async function handlePostFinanceStatementUpload(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var formData = await request.formData();
        var file = formData.get("statement");
        if (!file) { return jsonErr("statement field is required", 400); }

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

        var inserted = [];
        for (var i = 0; i < parsed.length; i++) {
            var t = parsed[i];
            if (!t.date || !t.description || t.amount === undefined) { continue; }
            var txType = (t.transaction_type === "income") ? "income" : "expense";
            var conf   = (t.confidence === "alta" || t.confidence === "baixa") ? t.confidence : "media";
            var txId   = crypto.randomUUID();
            var amt    = Math.abs(parseFloat(t.amount) || 0);
            var cat    = t.suggested_category || "Outro";
            await env.DB.prepare(
                "INSERT INTO bank_transactions (id, transaction_date, description, amount, transaction_type, suggested_category, confidence, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))"
            ).bind(txId, t.date, t.description, amt, txType, cat, conf).run();
            inserted.push({ id: txId, transaction_date: t.date, description: t.description, amount: amt, transaction_type: txType, suggested_category: cat, confidence: conf, status: "pending", assigned_category: null });
        }

        return jsonOk({ transactions: inserted, count: inserted.length });
    } catch (e) {
        return jsonErr("Error processing statement: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/finance/transactions?status=pending
// Lists transactions filtered by status (default: all), most recent first.
// ---------------------------------------------------------------------------

async function handleGetFinanceTransactions(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var url    = new URL(request.url);
        var status = url.searchParams.get("status") || "";

        var res;
        if (status) {
            res = await env.DB.prepare(
                "SELECT * FROM bank_transactions WHERE status = ? ORDER BY transaction_date DESC, created_at DESC"
            ).bind(status).all();
        } else {
            res = await env.DB.prepare(
                "SELECT * FROM bank_transactions ORDER BY transaction_date DESC, created_at DESC"
            ).all();
        }

        return jsonOk({ transactions: res.results });
    } catch (e) {
        return jsonErr("Error fetching transactions: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/finance/transactions/:id/confirm
// Body: { assigned_category: string }
// Sets status='confirmed' and assigned_category.
// ---------------------------------------------------------------------------

async function handlePostFinanceTransactionConfirm(txId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var body = await request.json();
        if (!body.assigned_category || !body.assigned_category.trim()) {
            return jsonErr("assigned_category is required", 400);
        }

        var existing = await env.DB.prepare("SELECT id FROM bank_transactions WHERE id = ?").bind(txId).first();
        if (!existing) { return jsonErr("Transaction not found", 404); }

        await env.DB.prepare(
            "UPDATE bank_transactions SET status = 'confirmed', assigned_category = ? WHERE id = ?"
        ).bind(body.assigned_category.trim(), txId).run();

        return jsonOk({ ok: true, id: txId, status: "confirmed", assigned_category: body.assigned_category.trim() });
    } catch (e) {
        return jsonErr("Error confirming transaction: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: POST /api/finance/transactions/:id/ignore
// Sets status='ignored'.
// ---------------------------------------------------------------------------

async function handlePostFinanceTransactionIgnore(txId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

        var existing = await env.DB.prepare("SELECT id FROM bank_transactions WHERE id = ?").bind(txId).first();
        if (!existing) { return jsonErr("Transaction not found", 404); }

        await env.DB.prepare("UPDATE bank_transactions SET status = 'ignored' WHERE id = ?").bind(txId).run();

        return jsonOk({ ok: true, id: txId, status: "ignored" });
    } catch (e) {
        return jsonErr("Error ignoring transaction: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/finance/overview
// Returns aggregated stats from confirmed transactions in the current calendar month.
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

        var incomeRow = await env.DB.prepare(
            "SELECT SUM(amount) as total FROM bank_transactions WHERE status = 'confirmed' AND transaction_type = 'income' AND transaction_date LIKE ?"
        ).bind(prefix + "%").first();

        var expenseRow = await env.DB.prepare(
            "SELECT SUM(amount) as total FROM bank_transactions WHERE status = 'confirmed' AND transaction_type = 'expense' AND transaction_date LIKE ?"
        ).bind(prefix + "%").first();

        var income   = incomeRow  && incomeRow.total  ? parseFloat(incomeRow.total)  : 0;
        var expenses = expenseRow && expenseRow.total ? parseFloat(expenseRow.total) : 0;
        var net      = income - expenses;

        return jsonOk({ income: income, expenses: expenses, net: net, month: prefix });
    } catch (e) {
        return jsonErr("Error fetching overview: " + e.message, 500);
    }
}

// ---------------------------------------------------------------------------
// Route: GET /api/finance/chart?months=6
// Returns confirmed transactions grouped by month and type for the last N months.
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

        var res = await env.DB.prepare(
            "SELECT substr(transaction_date, 1, 7) as month, transaction_type, SUM(amount) as total " +
            "FROM bank_transactions WHERE status = 'confirmed' AND substr(transaction_date, 1, 7) >= ? " +
            "GROUP BY month, transaction_type ORDER BY month ASC"
        ).bind(labels[0]).all();

        // Index by month+type
        var byMonth = {};
        for (var j = 0; j < res.results.length; j++) {
            var row = res.results[j];
            if (!byMonth[row.month]) { byMonth[row.month] = { income: 0, expenses: 0 }; }
            if (row.transaction_type === "income") { byMonth[row.month].income = parseFloat(row.total) || 0; }
            else { byMonth[row.month].expenses = parseFloat(row.total) || 0; }
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

        // Look up the package's base_price
        var pkgRow = await env.DB.prepare(
            "SELECT short_name, full_name, base_price FROM packages WHERE short_name = ?"
        ).bind(packageShortName).first();

        if (!pkgRow) {
            return jsonOk({ ok: true, has_price: false, package_name: packageShortName });
        }

        return jsonOk({
            ok:           true,
            has_price:    pkgRow.base_price !== null && pkgRow.base_price !== undefined,
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
// Route: GET /api/clients/:id/invoices
// Returns that client's invoices split into unpaid and paid arrays,
// matched via the client's zoho_customer_id.
// Auth: alice / rafa / developer only.
// ---------------------------------------------------------------------------

async function handleGetClientInvoices(clientId, request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        if (user.role !== "alice" && user.role !== "rafa" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

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
            "SELECT id, name, email, payment_method FROM clients WHERE zoho_customer_id = ?"
        ).bind(String(zohoCustomerId)).first();

        if (!clientRow) {
            return jsonErr("No local client found with zoho_customer_id " + zohoCustomerId, 404);
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
                numero_pedido:              inv.reference_number || "",
                assunto:                    inv.subject || "",
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
                subtotal:       inv.sub_total !== undefined    ? formatCurrency(inv.sub_total)    : "---",
                desconto_total: inv.discount_total !== undefined ? formatCurrency(inv.discount_total) : "---",
                valor_total:    inv.total !== undefined         ? formatCurrency(inv.total)        : "---"
            },
            observacoes:        inv.notes || "",
            formas_pagamento:   paymentMethod,
            termos_e_condicoes: inv.terms || ""
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
// Body: { client_id, line_items: [{ name, description?, quantity?, rate? }] }
// Creates a real DRAFT invoice in Zoho Books for the client's linked Zoho
// contact. No tax fields anywhere -- confirmed standing decision, invoices
// never carry sales tax. Auth: alice / rafa / developer.
// ---------------------------------------------------------------------------

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

        var payload = {
            customer_id: String(clientRow.zoho_customer_id),
            line_items: lineItems.map(function(li) {
                return {
                    name:        String(li.name).slice(0, 100),
                    description: (li.description || "").slice(0, 2000),
                    quantity:    (li.quantity !== undefined && li.quantity !== null && li.quantity !== "") ? parseFloat(li.quantity) || 0 : 1,
                    rate:        (li.rate !== undefined && li.rate !== null && li.rate !== "") ? parseFloat(li.rate) || 0 : 0
                };
            })
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

export default {
    fetch: async function(request, env) {
        var url    = new URL(request.url);
        var path   = url.pathname;
        var method = request.method;

        if (method === "OPTIONS") {
            return new Response(null, { status: 204, headers: CORS_HEADERS });
        }

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
        if (path === "/api/finance/transactions"     && method === "GET")  { return handleGetFinanceTransactions(request, env); }
        if (path === "/api/finance/overview"         && method === "GET")  { return handleGetFinanceOverview(request, env); }
        if (path === "/api/finance/chart"            && method === "GET")  { return handleGetFinanceChart(request, env); }
        if (path === "/api/finance/subscriptions"    && method === "GET")  { return handleGetFinanceSubscriptions(request, env); }
        if (path === "/api/finance/subscriptions"    && method === "POST") { return handlePostFinanceSubscriptions(request, env); }
        if (path === "/api/finance/reconciliation"   && method === "GET")  { return handleGetFinanceReconciliation(request, env); }
        if (path === "/api/finance/bank-status"       && method === "GET")  { return handleGetFinanceBankStatus(request, env); }
        if (path === "/api/finance/expense-form-data" && method === "GET")  { return handleGetFinanceExpenseFormData(request, env); }
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
        if (segs[0] === "api" && segs[1] === "sessions" && segs[2] && segs[3] === "task-completions" && method === "PATCH") {
            return handlePatchSessionTaskCompletions(segs[2], request, env);
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
            if (segs.length === 4 && segs[3] === "zoho-contact") {
                if (method === "GET") { return handleGetClientZohoContact(cid, request, env); }
                if (method === "PUT") { return handlePutClientZohoContact(cid, request, env); }
            }
        }

        // /api/finance/reconciliation/:transaction_id/match-invoice|exclude|restore|unmatch
        if (segs[0] === "api" && segs[1] === "finance" && segs[2] === "reconciliation" && segs[3] && segs[4] && method === "POST") {
            if (segs[4] === "match-invoice") { return handlePostReconciliationMatchInvoice(segs[3], request, env); }
            if (segs[4] === "exclude" || segs[4] === "restore" || segs[4] === "unmatch") {
                return handlePostReconciliationAction(segs[3], segs[4], request, env);
            }
        }

        // /api/finance/transactions/:id/confirm|ignore
        if (segs[0] === "api" && segs[1] === "finance" && segs[2] === "transactions" && segs[3] && segs[4] === "confirm" && method === "POST") {
            return handlePostFinanceTransactionConfirm(segs[3], request, env);
        }
        if (segs[0] === "api" && segs[1] === "finance" && segs[2] === "transactions" && segs[3] && segs[4] === "ignore" && method === "POST") {
            return handlePostFinanceTransactionIgnore(segs[3], request, env);
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
    }
};
