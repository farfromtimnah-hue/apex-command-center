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
    var row = await env.DB.prepare("SELECT role FROM users WHERE email = ?")
        .bind(payload.email).first();
    if (!row) { return null; }
    return { email: payload.email, role: row.role };
}

// ---------------------------------------------------------------------------
// Route: GET /api/role
// ---------------------------------------------------------------------------

async function handleGetRole(request, env) {
    try {
        var user = await authenticate(request, env);
        if (!user) { return jsonErr("Unauthorized", 401); }
        return jsonOk({ role: user.role, email: user.email });
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
// Verifies HMAC if FIREFLIES_WEBHOOK_SECRET is set; accepts all if empty.
// ---------------------------------------------------------------------------

async function handleFirefliesWebhook(request, env) {
    try {
        var rawBody = await request.text();

        // HMAC verification — skip if secret not configured yet
        var secret = (env.FIREFLIES_WEBHOOK_SECRET || "").trim();
        if (secret) {
            var sigHeader = request.headers.get("X-Hub-Signature-256") ||
                            request.headers.get("X-Fireflies-Signature") || "";
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
                console.log("Fireflies webhook signature mismatch");
                return jsonErr("Signature mismatch", 401);
            }
        } else {
            console.log("FIREFLIES_WEBHOOK_SECRET not set — accepting webhook without verification");
        }

        var payload;
        try { payload = JSON.parse(rawBody); } catch(e) { return jsonErr("Invalid JSON", 400); }

        // Extract fields from Fireflies payload format
        var meetingId    = payload.meetingId || payload.id || null;
        var title        = payload.title     || payload.meeting_title || "Fireflies Meeting";
        var meetingDate  = payload.date      || payload.start_time    || null;
        var transcript   = payload.transcript || payload.summary || null;

        if (!meetingId) { return jsonOk({ ok: true, note: "No meetingId — skipped" }); }
        if (!transcript) { return jsonOk({ ok: true, note: "No transcript content — skipped" }); }

        // Normalize date to YYYY-MM-DD
        var dateStr = new Date().toISOString().split("T")[0];
        if (meetingDate) {
            try {
                var d = new Date(typeof meetingDate === "number" ? meetingDate * 1000 : meetingDate);
                if (!isNaN(d.getTime())) { dateStr = d.toISOString().split("T")[0]; }
            } catch(e) { /* use today */ }
        }

        // Prevent duplicates by checking fireflies_id stored in task_completions field
        // We store {"fireflies_id": "<meetingId>"} so we can check without a schema change
        var existing = await env.DB.prepare(
            "SELECT id FROM sessions WHERE task_completions LIKE ? LIMIT 1"
        ).bind('%"fireflies_id":"' + meetingId + '"%').first();

        if (existing) {
            return jsonOk({ ok: true, note: "Duplicate meetingId — skipped", session_id: existing.id });
        }

        var sessionId = crypto.randomUUID();
        var fireflyMeta = JSON.stringify({ fireflies_id: meetingId });

        await env.DB.prepare(
            "INSERT INTO sessions (id, client_name, date, status, raw_transcript, task_completions, created_at) " +
            "VALUES (?, ?, ?, 'inbox', ?, ?, datetime('now'))"
        ).bind(sessionId, title, dateStr, transcript, fireflyMeta).run();

        return jsonOk({ ok: true, session_id: sessionId });
    } catch (e) {
        return jsonErr("Webhook error: " + e.message, 500);
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
    "Respond with a JSON object containing exactly 7 top-level keys.\n\n" +
    "Keys 1-6 are for internal review only. Each must be an object with 'pt' and 'en' string fields:\n" +
    "  discussion_overview, recommendations, client_action_items, rafa_followups,\n" +
    "  next_session_focus, client_profile_updates\n\n" +
    "Key 7 is 'pdf_data' — a client-facing deliverable written entirely in Brazilian Portuguese.\n" +
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
    "    owner must be exactly 'CLIENTE' or 'CONSULTOR' (uppercase, no other values)\n\n" +
    "Rules: 2-4 items per array unless stated otherwise. Exactly 4 week entries in thirty_day_plan.\n" +
    "If the transcript lacks enough detail for a field, infer a reasonable conservative entry — do not leave arrays empty.\n\n" +
    "Transcript:\n";

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
                messages:   [{ role: "user", content: SUMMARY_PROMPT + session.raw_transcript }]
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

        // Update sessions: keep full summary_json for dashboard compat, write pdf_data to its own column
        await env.DB.prepare(
            "UPDATE sessions SET summary_json = ?, pdf_data = ?, status = 'summarized' WHERE id = ?"
        ).bind(JSON.stringify(summaryJson), pdfData ? JSON.stringify(pdfData) : null, body.session_id).run();

        // Write 6 structured keys to session_summaries
        var ss = summaryJson;
        var summaryId = crypto.randomUUID();
        await env.DB.prepare(
            "INSERT INTO session_summaries " +
            "(id, session_id, summary_pt, summary_en, recommendations_pt, recommendations_en, " +
            "client_action_items_pt, client_action_items_en, rafa_followups_pt, rafa_followups_en, " +
            "next_session_focus_pt, next_session_focus_en, client_profile_updates_pt, client_profile_updates_en) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) " +
            "ON CONFLICT(session_id) DO UPDATE SET " +
            "summary_pt = excluded.summary_pt, summary_en = excluded.summary_en, " +
            "recommendations_pt = excluded.recommendations_pt, recommendations_en = excluded.recommendations_en, " +
            "client_action_items_pt = excluded.client_action_items_pt, client_action_items_en = excluded.client_action_items_en, " +
            "rafa_followups_pt = excluded.rafa_followups_pt, rafa_followups_en = excluded.rafa_followups_en, " +
            "next_session_focus_pt = excluded.next_session_focus_pt, next_session_focus_en = excluded.next_session_focus_en, " +
            "client_profile_updates_pt = excluded.client_profile_updates_pt, client_profile_updates_en = excluded.client_profile_updates_en"
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
            ss.client_profile_updates ? ss.client_profile_updates.en : null
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

        await env.DB.prepare(
            "UPDATE sessions SET status = 'approved', approved_at = ?, summary_json = ? WHERE id = ?"
        ).bind(approvedAt, summaryToStore, body.session_id).run();

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
            "package, status, phone, email, whatsapp, payment_method, contacts, created_at " +
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

        return jsonOk({ client_id: clientId, name: body.name });
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
            "package, status, phone, email, whatsapp, payment_method, contacts, created_at FROM clients WHERE id = ?"
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

        var obj = await env.ASSETS.get(client.logo_url);
        if (!obj) {
            return new Response(null, { status: 404, headers: CORS_HEADERS });
        }

        var imgHeaders = Object.assign({}, CORS_HEADERS, {
            "Content-Type": (obj.httpMetadata && obj.httpMetadata.contentType) ? obj.httpMetadata.contentType : "image/jpeg",
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
            "INSERT INTO sessions (id, client_id, client_name, date, time, session_type, google_meet_link, status, raw_transcript) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', ?)"
        ).bind(sessionId, body.client_id, client.name, body.date, body.time, body.session_type, meetLink, body.notes || null).run();

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
            "SELECT id, client_id, client_name, date, time, session_type, status, google_meet_link, whatsapp_sent_at " +
            "FROM sessions WHERE date LIKE ? AND status != 'discarded' ORDER BY date ASC, time ASC"
        ).bind(month + "-%").all();

        return jsonOk({ sessions: res.results });
    } catch (e) {
        return jsonErr("Error fetching calendar: " + e.message, 500);
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

        var tokenRow = await env.DB.prepare(
            "SELECT refresh_token FROM oauth_tokens WHERE id = 'google_calendar'"
        ).first();
        if (!tokenRow) { return jsonErr("Google Calendar not connected", 400); }

        // Exchange refresh token for access token
        var refreshController = new AbortController();
        var refreshTimer = setTimeout(function() { refreshController.abort(); }, 15000);

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
                signal: refreshController.signal
            });
        } finally {
            clearTimeout(refreshTimer);
        }

        var refreshData = await refreshRes.json();
        if (!refreshRes.ok) {
            return jsonErr("Failed to refresh access token: " + (refreshData.error_description || refreshData.error || "unknown"), 502);
        }

        var accessToken = refreshData.access_token;

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

        var obj = await env.ASSETS.get(row.avatar_url);
        if (!obj) {
            return new Response(null, { status: 404, headers: CORS_HEADERS });
        }

        var imgHeaders = Object.assign({}, CORS_HEADERS, {
            "Content-Type": (obj.httpMetadata && obj.httpMetadata.contentType) ? obj.httpMetadata.contentType : "image/jpeg",
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
            "SELECT id, short_name, full_name, audience, included_items, is_popular, sort_order " +
            "FROM packages ORDER BY sort_order ASC, short_name ASC"
        ).all();

        var pkgs = res.results.map(function(row) {
            var items = [];
            if (row.included_items) {
                try { items = JSON.parse(row.included_items); } catch(e) { items = []; }
            }
            return {
                id:             row.id,
                short_name:     row.short_name,
                full_name:      row.full_name,
                audience:       row.audience,
                included_items: items,
                is_popular:     !!row.is_popular,
                sort_order:     row.sort_order
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

        var pkgId = crypto.randomUUID();
        await env.DB.prepare(
            "INSERT INTO packages (id, short_name, full_name, audience, included_items, is_popular, sort_order) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).bind(
            pkgId,
            body.short_name.trim(),
            body.full_name.trim(),
            body.audience || null,
            JSON.stringify(includedItems),
            isPopular,
            sortOrder
        ).run();

        var row = await env.DB.prepare(
            "SELECT id, short_name, full_name, audience, included_items, is_popular, sort_order FROM packages WHERE id = ?"
        ).bind(pkgId).first();

        var items = [];
        if (row.included_items) {
            try { items = JSON.parse(row.included_items); } catch(e) { items = []; }
        }

        return jsonOk({ package: {
            id:             row.id,
            short_name:     row.short_name,
            full_name:      row.full_name,
            audience:       row.audience,
            included_items: items,
            is_popular:     !!row.is_popular,
            sort_order:     row.sort_order
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

        var row = await env.DB.prepare(
            "SELECT id, short_name, full_name, audience, included_items, is_popular, sort_order FROM packages WHERE id = ?"
        ).bind(id).first();

        var updatedItems = [];
        if (row.included_items) {
            try { updatedItems = JSON.parse(row.included_items); } catch(e) { updatedItems = []; }
        }

        return jsonOk({ package: {
            id:             row.id,
            short_name:     row.short_name,
            full_name:      row.full_name,
            audience:       row.audience,
            included_items: updatedItems,
            is_popular:     !!row.is_popular,
            sort_order:     row.sort_order
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

        var obj = await env.ASSETS.get(row.avatar_url);
        if (!obj) {
            return new Response(null, { status: 404, headers: CORS_HEADERS });
        }

        var imgHeaders = Object.assign({}, CORS_HEADERS, {
            "Content-Type": (obj.httpMetadata && obj.httpMetadata.contentType) ? obj.httpMetadata.contentType : "image/jpeg",
            "Cache-Control": "public, max-age=86400"
        });
        return new Response(obj.body, { status: 200, headers: imgHeaders });
    } catch (e) {
        return jsonErr("Error fetching avatar: " + e.message, 500);
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
        if (path === "/api/sessions"              && method === "GET")  { return handleGetSessions(request, env); }
        if (path === "/api/sessions/inbox"        && method === "GET")  { return handleGetSessionsInbox(request, env); }
        if (path === "/api/sessions/calendar"     && method === "GET")  { return handleGetSessionsCalendar(request, env); }
        if (path === "/api/sessions/schedule"     && method === "POST") { return handlePostSessionsSchedule(request, env); }
        if (path === "/api/fireflies/webhook"    && method === "POST") { return handleFirefliesWebhook(request, env); }
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

        // Parameterized routes: /api/sessions/:id/task-completions, /api/sessions/:id/assign-client, /api/sessions/:id/whatsapp
        var segs = path.replace(/^\//, "").split("/");
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

        // /api/users/:email  DELETE
        if (segs[0] === "api" && segs[1] === "users" && segs[2] && method === "DELETE") {
            return handleDeleteUser(segs[2], request, env);
        }

        // /api/users/:email/avatar-image  GET
        if (segs[0] === "api" && segs[1] === "users" && segs[2] && segs[3] === "avatar-image" && method === "GET") {
            return handleGetUserAvatarImage(segs[2], request, env);
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
            if (segs.length === 4 && segs[3] === "digital-presence") {
                if (method === "GET")   { return handleGetDigitalPresence(cid, request, env); }
                if (method === "PATCH") { return handlePatchDigitalPresence(cid, request, env); }
            }
            if (segs.length === 4 && segs[3] === "tasks") {
                if (method === "GET")  { return handleGetClientTasks(cid, request, env); }
                if (method === "POST") { return handlePostClientTask(cid, request, env); }
            }
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

        return jsonErr("Not found", 404);
    }
};
