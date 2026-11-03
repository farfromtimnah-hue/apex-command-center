// Setup wizard: the pure logic, kept apart from worker/index.js so it can be
// tested on its own. Nothing here touches the database or the network except
// safeFetch(), which is handed the fetch function to use.

// ── License answer for a state and the kinds of work tapped ────────────────
// Statuses come from data/license-table-v1.json. The wizard asks the Worker;
// the app only draws the answer. Nothing here is copied into page code.
var NEED = { "REQUIRED": 1, "LICENSED": 1, "REGISTRATION": 1, "PERMIT": 1 };
var NONE = { "NO STATE LICENSE": 1, "NO_STATE_LICENSE": 1, "LEAN_NOT_LICENSED": 1, "PESTICIDE ONLY": 1 };
var UNSURE = { "AMBIGUOUS": 1, "UNCLEAR": 1, "LEAN_LICENSED": 1 };

var LABELS = {
    "REQUIRED":          ["License required", "Licença obrigatória"],
    "LICENSED":          ["License required", "Licença obrigatória"],
    "REGISTRATION":      ["Registration required", "Registro obrigatório"],
    "PERMIT":            ["Permit required", "Permissão obrigatória"],
    "THRESHOLD":         ["License needed only above {amount}", "Licença só acima de {amount}"],
    "NO STATE LICENSE":  ["No state license", "Sem licença estadual"],
    "NO_STATE_LICENSE":  ["No state license", "Sem licença estadual"],
    "LEAN_NOT_LICENSED": ["No state license found", "Nenhuma licença estadual encontrada"],
    "PESTICIDE ONLY":    ["No license. A pesticide license is needed if you spray", "Sem licença. É preciso licença de pesticida se você aplicar"],
    "AMBIGUOUS":         ["Apex could not confirm", "A Apex não conseguiu confirmar"],
    "UNCLEAR":           ["Apex could not confirm", "A Apex não conseguiu confirmar"],
    "LEAN_LICENSED":     ["Probably needs a license", "Provavelmente precisa de licença"],
    "NO_DATA":           ["Apex could not confirm", "A Apex não conseguiu confirmar"]
};

function kindOf(status) {
    if (NEED[status]) { return "need"; }
    if (status === "THRESHOLD") { return "threshold"; }
    if (UNSURE[status] || status === "NO_DATA") { return "unsure"; }
    if (NONE[status]) { return "none"; }
    return "unsure";
}

function workTypeName(wiz, key) {
    var n = wiz.work_type_names && wiz.work_type_names[key];
    return n ? { en: n[0], pt: n[1] } : { en: String(key).replace(/_/g, " "), pt: String(key).replace(/_/g, " ") };
}

// state: two letter code. cat: category key. subs: subtap keys the owner tapped.
// Returns { ok, state_name, items[], summary, unmapped[] }. ok=false when the
// state is not in the table (the app then shows its safe screen).
// Same hash the Portuguese notes file was written with (data/license-notes-pt-v1.json, "h").
function noteHash(str) { var x = 5381, i; str = String(str || ""); for (i = 0; i < str.length; i++) { x = ((x * 33) ^ str.charCodeAt(i)) >>> 0; } return x.toString(16); }
// The Portuguese for a cell's note, or "" when there is none or the English changed since it was written.
function notePt(ptNotes, st, workType, status, en) {
    var e = ptNotes && ptNotes.states && ptNotes.states[st] && ptNotes.states[st][workType] && ptNotes.states[st][workType][status];
    return e && e.pt && e.h === noteHash(en) ? e.pt : "";
}
function licenseResult(table, wiz, state, cat, subs, ptNotes) {
    var row = table && table[String(state || "").toUpperCase()];
    if (!row) { return { ok: false, reason: "state_not_found", items: [], unmapped: [] }; }
    var category = (wiz.categories || []).filter(function(c) { return c.key === cat; })[0];
    if (!category) { return { ok: false, reason: "category_not_found", items: [], unmapped: [] }; }
    var seen = {}, items = [], unmapped = [];
    (subs || []).forEach(function(sk) {
        var sub = category.subtaps.filter(function(s) { return s.key === sk; })[0];
        if (!sub) { return; }
        if (!sub.work_type) { unmapped.push(sk); return; }
        if (seen[sub.work_type]) { return; }
        seen[sub.work_type] = 1;
        var cell = row.wt[sub.work_type];
        var nm = workTypeName(wiz, sub.work_type);
        if (!cell) {
            unmapped.push(sk);
            items.push({ work_type: sub.work_type, name_en: nm.en, name_pt: nm.pt, status: "NO_DATA", kind: "unsure", threshold: "", note: "", confidence: "",
                label_en: LABELS.NO_DATA[0], label_pt: LABELS.NO_DATA[1] });
            return;
        }
        var th = cell[1] || "";
        var lab = LABELS[cell[0]] || ["", ""];
        items.push({ work_type: sub.work_type, name_en: nm.en, name_pt: nm.pt, status: cell[0], kind: kindOf(cell[0]), threshold: th,
            note: cell[2] || "", note_pt: cell[2] ? notePt(ptNotes, String(state).toUpperCase(), sub.work_type, cell[0], cell[2]) : "", confidence: cell[3] || "",
            label_en: lab[0].replace("{amount}", th || "a set amount"), label_pt: lab[1].replace("{amount}", th || "um valor definido") });
    });
    // unmapped taps with no work type at all (a tap the draft map cannot place)
    var kinds = items.map(function(i) { return i.kind; });
    var summary = "none";
    if (!items.length) { summary = unmapped.length ? "unsure" : "none"; }
    else if (kinds.indexOf("need") !== -1) { summary = "need"; }
    else if (kinds.indexOf("threshold") !== -1) { summary = "threshold"; }
    else if (kinds.indexOf("unsure") !== -1) { summary = "unsure"; }
    return { ok: true, state: String(state).toUpperCase(), state_name: row.name, items: items, summary: summary, unmapped: unmapped };
}

// ── Website reader: address safety ─────────────────────────────────────────
function ipv4Parts(s) {
    var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
    if (!m) { return null; }
    var p = [+m[1], +m[2], +m[3], +m[4]];
    return p.some(function(x) { return x > 255; }) ? null : p;
}

// true for any address a public page must never make the Worker call.
function isBlockedIp(ip) {
    var s = String(ip || "").trim().toLowerCase();
    var p = ipv4Parts(s);
    if (p) {
        if (p[0] === 0 || p[0] === 10 || p[0] === 127) { return true; }
        if (p[0] === 169 && p[1] === 254) { return true; }
        if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) { return true; }
        if (p[0] === 192 && p[1] === 168) { return true; }
        if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) { return true; }
        if (p[0] === 192 && p[1] === 0 && p[2] === 0) { return true; }
        if (p[0] === 198 && (p[1] === 18 || p[1] === 19)) { return true; }
        if (p[0] >= 224) { return true; }
        return false;
    }
    // IPv6
    s = s.replace(/^\[|\]$/g, "");
    if (s === "::" || s === "::1") { return true; }
    var mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) { return isBlockedIp(mapped[1]); }
    var mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(s);
    if (mappedHex) {
        var a = parseInt(mappedHex[1], 16), b = parseInt(mappedHex[2], 16);
        return isBlockedIp([a >> 8, a & 255, b >> 8, b & 255].join("."));
    }
    if (/^f[cd][0-9a-f]{2}:/.test(s)) { return true; }      // unique local
    if (/^fe[89ab][0-9a-f]:/.test(s)) { return true; }      // link local
    if (/^ff[0-9a-f]{2}:/.test(s)) { return true; }         // multicast
    if (/^(0{0,4}:){2,7}0{0,4}[01]?$/.test(s)) { return true; }
    return false;
}

function isIpLiteral(h) {
    return !!ipv4Parts(h) || h.indexOf(":") !== -1;
}

// Checks the shape of an address before any lookup. Returns the URL object or
// { error }. Only http and https, ports 80 and 443, no credentials.
function checkWebAddress(raw) {
    var u;
    try { u = new URL(raw); } catch (e) { return { error: "bad_address" }; }
    if (u.protocol !== "http:" && u.protocol !== "https:") { return { error: "bad_scheme" }; }
    if (u.username || u.password) { return { error: "bad_address" }; }
    if (u.port && u.port !== "80" && u.port !== "443") { return { error: "bad_port" }; }
    var h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!h || h === "localhost" || /\.(local|localhost|internal|lan|home|corp)$/.test(h)) { return { error: "blocked_host" }; }
    if (isIpLiteral(h)) { return isBlockedIp(h) ? { error: "blocked_host" } : { url: u }; }
    if (h.indexOf(".") === -1) { return { error: "blocked_host" }; }
    return { url: u };
}

// Normalizes what the owner typed: "bergaminisolutions.com" gets https.
function normalizeTypedAddress(s) {
    var t = String(s || "").trim();
    if (!t || t.length > 300 || /\s/.test(t)) { return ""; }
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) { t = "https://" + t; }
    return t;
}

// Fetches a page or an image with every safety rule. doFetch is the Worker's
// fetch; resolveHost(host) returns the list of addresses (or throws).
// Rules: every hop (including each redirect) is checked and resolved, private,
// loopback and link local answers are refused, at most 5 redirects, 10 second
// limit for the whole call, body cut at maxBytes, content type must match.
async function safeFetch(startUrl, o) {
    o = o || {};
    var doFetch = o.doFetch, resolveHost = o.resolveHost;
    var maxBytes = o.maxBytes || 6 * 1024 * 1024, maxHops = 5, timeoutMs = o.timeoutMs || 10000;
    var ctl = new AbortController();
    var timer = setTimeout(function() { ctl.abort(); }, timeoutMs);
    try {
        var cur = startUrl;
        for (var hop = 0; hop <= maxHops; hop++) {
            var chk = checkWebAddress(cur);
            if (chk.error) { return { error: chk.error }; }
            var host = chk.url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
            if (!isIpLiteral(host)) {
                var addrs;
                try { addrs = await resolveHost(host); } catch (eR) { return { error: "no_such_site" }; }
                if (!addrs || !addrs.length) { return { error: "no_such_site" }; }
                if (addrs.some(isBlockedIp)) { return { error: "blocked_host" }; }
            }
            var res = await doFetch(chk.url.toString(), { method: "GET", redirect: "manual", signal: ctl.signal,
                headers: { "User-Agent": "ApexSetupReader/1.0 (+https://apex.resonateai.online)", "Accept": o.accept || "text/html,application/xhtml+xml,image/*;q=0.8" } });
            if (res.status >= 300 && res.status < 400 && res.headers.get("Location")) {
                try { cur = new URL(res.headers.get("Location"), chk.url).toString(); } catch (eL) { return { error: "bad_redirect" }; }
                continue;
            }
            if (res.status < 200 || res.status >= 300) { return { error: "http_" + res.status }; }
            var ct = String(res.headers.get("Content-Type") || "").toLowerCase();
            if (o.contentType && !o.contentType.test(ct)) { return { error: "wrong_type" }; }
            var len = Number(res.headers.get("Content-Length") || 0);
            if (len && len > maxBytes) { return { error: "too_big" }; }
            var reader = res.body.getReader(), chunks = [], total = 0;
            while (true) {
                var part = await reader.read();
                if (part.done) { break; }
                total += part.value.byteLength;
                if (total > maxBytes) { try { await reader.cancel(); } catch (eC) {} return { error: "too_big" }; }
                chunks.push(part.value);
            }
            var bytes = new Uint8Array(total), off = 0;
            chunks.forEach(function(c) { bytes.set(c, off); off += c.byteLength; });
            return { bytes: bytes, contentType: ct, finalUrl: chk.url.toString() };
        }
        return { error: "too_many_redirects" };
    } catch (e) {
        return { error: e && e.name === "AbortError" ? "timeout" : "fetch_failed" };
    } finally {
        clearTimeout(timer);
    }
}

// ── Website reader: what a page says ──────────────────────────────────────
function decodeEntities(s) {
    return String(s || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;|&apos;/g, "'")
        .replace(/&#(\d+);/g, function(m, n) { return String.fromCharCode(+n); });
}

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// Returns only what the page really holds. Never invents. logoCandidate is a
// URL the caller still has to verify is a real image.
function parseSite(html, baseUrl, categories) {
    var found = {}, h = String(html || "");
    var m = /<meta[^>]+property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i.exec(h) || /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:site_name["']/i.exec(h);
    var name = m ? m[1] : null;
    if (!name) { var t = /<title[^>]*>([^<]+)<\/title>/i.exec(h); if (t) { name = t[1]; } }
    if (name) {
        name = decodeEntities(name).split(/\s+[|–—-]\s+/)[0].replace(/\s+/g, " ").trim();
        if (name && name.length <= 80) { found.name = name; }
    }
    function abs(u) { try { return new URL(decodeEntities(u), baseUrl).toString(); } catch (e) { return null; } }
    var logo = null;
    var imgs = h.match(/<img\b[^>]*>/gi) || [];
    for (var i = 0; i < imgs.length && !logo; i++) {
        if (/logo/i.test(imgs[i])) {
            var s = /\bsrc=["']([^"']+)["']/i.exec(imgs[i]) || /\bdata-src=["']([^"']+)["']/i.exec(imgs[i]);
            if (s && !/^data:/i.test(s[1])) { logo = abs(s[1]); }
        }
    }
    if (!logo) {
        var ic = /<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]*href=["']([^"']+)["']/i.exec(h) || /<link[^>]+href=["']([^"']+)["'][^>]*rel=["'][^"']*icon[^"']*["']/i.exec(h);
        if (ic) { logo = abs(ic[1]); }
    }
    var logoCandidate = logo;
    var text = decodeEntities(h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
    var tel = /href=["']tel:([+\d\-().\s%]{7,})["']/i.exec(h);
    var ph = tel ? decodeEntities(tel[1]).replace(/%20/g, " ").trim() : null;
    if (!ph) { var pm = /(?:\+?1[ .-]?)?\(?\b(\d{3})\)?[ .-](\d{3})[ .-](\d{4})\b/.exec(text); if (pm) { ph = pm[0].trim(); } }
    if (ph) { found.phone = ph; }
    var ad = /"streetAddress"\s*:\s*"([^"]+)"/.exec(h);
    if (ad) {
        var loc = /"addressLocality"\s*:\s*"([^"]+)"/.exec(h), reg = /"addressRegion"\s*:\s*"([^"]+)"/.exec(h), zip = /"postalCode"\s*:\s*"([^"]+)"/.exec(h);
        found.addr = [ad[1], loc && loc[1], reg && reg[1], zip && zip[1]].filter(Boolean).join(", ");
    } else {
        var am = /\b\d{2,5} [A-Z][A-Za-z0-9 .]+ (?:St|Street|Ave|Avenue|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Ct|Court|Pkwy|Hwy)\b[^|]{0,60}?\b[A-Z]{2} \d{5}\b/.exec(text);
        if (am) { found.addr = am[0]; }
    }
    var rv = /https?:\/\/(?:g\.page\/[^"'\s<>]+|search\.google\.com\/local\/writereview[^"'\s<>]*|g\.co\/kgs\/[^"'\s<>]+)/i.exec(h);
    if (rv) { found.review = decodeEntities(rv[0]); }
    var low = text.toLowerCase(), hits = [];
    (categories || []).forEach(function(c) {
        var any = (c.keywords || []).some(function(k) { return new RegExp("\\b" + escRe(k.toLowerCase()) + "s?\\b").test(low); });
        if (any) { hits.push(c.key); }
    });
    if (hits.length) { found.cat = hits; }
    return { found: found, logoCandidate: logoCandidate };
}

// A real image: PNG, JPEG, GIF, WebP, ICO, or SVG, by the first bytes.
function sniffImage(bytes) {
    var b = bytes;
    if (!b || b.length < 4) { return null; }
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) { return "image/png"; }
    if (b[0] === 0xff && b[1] === 0xd8) { return "image/jpeg"; }
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) { return "image/gif"; }
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b.length > 11 && b[8] === 0x57 && b[9] === 0x45) { return "image/webp"; }
    if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) { return "image/x-icon"; }
    return null;
}

// Who is shown the full wizard on their own. ONLY a business created after the
// cutoff (one value in contract_admin_settings, wizard_auto_open_after, set at
// the moment of the Worker deploy). An unset cutoff means nobody. An existing
// owner is never auto opened: their missing parts show as a card instead.
function wizardAutoOpen(cutoff, createdAt, completedAt, setupCompletedAt) {
    var c = String(cutoff || "").trim(), t = String(createdAt || "").trim();
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(c) || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(t)) { return false; }
    if (completedAt || setupCompletedAt) { return false; }
    return t > c;
}

export { wizardAutoOpen, licenseResult, noteHash, notePt, isBlockedIp, checkWebAddress, normalizeTypedAddress, safeFetch, parseSite, sniffImage, kindOf };
