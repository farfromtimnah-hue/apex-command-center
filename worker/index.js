// Apex Command Center — Cloudflare Worker

var FIREBASE_CERTS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
var CLAUDE_API_URL     = "https://api.anthropic.com/v1/messages";
var CLAUDE_MODEL       = "claude-sonnet-4-6";

var CORS_HEADERS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
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
                "FROM sessions WHERE status != 'archived' AND client_id = ? ORDER BY created_at DESC"
            ).bind(clientIdFilter);
        } else {
            stmt = env.DB.prepare(
                "SELECT id, client_name, client_id, date, status, summary_json, pdf_data, task_completions, approved_at, created_at " +
                "FROM sessions WHERE status != 'archived' ORDER BY created_at DESC"
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
        if (user.role !== "alice" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

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
        if (user.role !== "alice" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

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
        if (user.role !== "alice" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

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
        if (user.role !== "alice" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

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
        if (user.role !== "alice" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

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
        if (user.role !== "alice" && user.role !== "developer") { return jsonErr("Forbidden", 403); }

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

        if (path === "/api/role"       && method === "GET")  { return handleGetRole(request, env); }
        if (path === "/api/sessions"   && method === "GET")  { return handleGetSessions(request, env); }
        if (path === "/api/clients"    && method === "GET")  { return handleGetClients(request, env); }
        if (path === "/api/clients"    && method === "POST") { return handlePostClients(request, env); }
        if (path === "/api/transcript" && method === "POST") { return handlePostTranscript(request, env); }
        if (path === "/api/summarize"  && method === "POST") { return handlePostSummarize(request, env); }
        if (path === "/api/approve"    && method === "POST") { return handlePostApprove(request, env); }

        // Parameterized routes: /api/sessions/:id/task-completions
        var segs = path.replace(/^\//, "").split("/");
        if (segs[0] === "api" && segs[1] === "sessions" && segs[2] && segs[3] === "task-completions" && method === "PATCH") {
            return handlePatchSessionTaskCompletions(segs[2], request, env);
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
        }

        return jsonErr("Not found", 404);
    }
};
