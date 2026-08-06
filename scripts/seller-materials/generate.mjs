// Generates the three seller-material PDFs for a client and files them into
// client_documents with visibility='seller'.
//
//   node scripts/seller-materials/generate.mjs <client_id> [--dry]
//
// Idempotent by construction: each PDF has a STABLE document id derived from
// the client id and a slug (seller-material-<slug>-<client_id>), so a re-run
// overwrites the same three R2 objects and UPSERTs the same three rows. Running
// it twice leaves three documents, not six. That is why the id is derived
// rather than a fresh crypto.randomUUID() per run.
//
// The logo is read per-client from clients.logo_url (logos/<client_id>.<ext>)
// and inlined as a data URI. No client's asset path is hardcoded.

import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdtempSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// .mjs on both: the repo has no package.json, so a bare .js here would be
// treated as CommonJS and the named exports would not resolve.
import { APPROACH_MESSAGES, INSTAGRAM_POST, OBJECTIONS, CADENCE } from "./content.mjs";
import { renderScripts, renderObjections, renderCadence } from "./render.mjs";

const CLIENT_ID = process.argv[2];
const DRY = process.argv.includes("--dry");
const DB = "apex-command-center";
const BUCKET = "apex-command-center";

if (!CLIENT_ID) {
    console.error("usage: node scripts/seller-materials/generate.mjs <client_id> [--dry]");
    process.exit(1);
}

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function sh(cmd, args) {
    return execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

// wrangler prints a JSON array of result sets, preceded by human-readable
// banner lines. Slice from the first bracket so the banner never breaks parse.
function d1(sql) {
    const out = sh("npx", ["wrangler", "d1", "execute", DB, "--remote", "--json", "--command", sql]);
    const start = out.indexOf("[");
    const parsed = JSON.parse(out.slice(start));
    return parsed[0].results || [];
}

function sqlStr(v) {
    if (v === null || v === undefined) { return "NULL"; }
    return "'" + String(v).replace(/'/g, "''") + "'";
}

const MIME_BY_EXT = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    gif: "image/gif", webp: "image/webp"
};

const work = mkdtempSync(join(tmpdir(), "seller-materials-"));

try {
    const rows = d1(`SELECT id, name, logo_url FROM clients WHERE id = ${sqlStr(CLIENT_ID)}`);
    if (!rows.length) {
        console.error("No such client: " + CLIENT_ID);
        process.exit(1);
    }
    const client = rows[0];
    console.log("Client: " + client.name + "  (" + client.id + ")");

    // ── Logo → data URI ─────────────────────────────────────────────────────
    let logoDataUri = "";
    if (client.logo_url) {
        const ext = String(client.logo_url).split(".").pop().toLowerCase();
        const mime = MIME_BY_EXT[ext];
        if (!mime) {
            console.warn("! Unrecognised logo extension '" + ext + "' — rendering without a logo.");
        } else {
            const logoPath = join(work, "logo." + ext);
            try {
                sh("npx", ["wrangler", "r2", "object", "get", BUCKET + "/" + client.logo_url,
                    "--file", logoPath, "--remote"]);
                logoDataUri = "data:" + mime + ";base64," + readFileSync(logoPath).toString("base64");
                console.log("Logo: " + client.logo_url + " (" + readFileSync(logoPath).length + " bytes)");
            } catch (e) {
                console.warn("! Could not fetch logo (" + client.logo_url + ") — rendering without it.");
            }
        }
    } else {
        console.warn("! Client has no logo_url — rendering without a logo.");
    }

    const ctx = {
        clientName: client.name,
        logo: logoDataUri,
        messages: APPROACH_MESSAGES,
        instagram: INSTAGRAM_POST,
        objections: OBJECTIONS,
        cadence: CADENCE
    };

    const DOCS = [
        { slug: "scripts-abordagem", title: "Scripts de Abordagem", html: renderScripts(ctx) },
        { slug: "objecoes", title: "Objeções", html: renderObjections(ctx) },
        { slug: "cadencia-follow-up", title: "Cadência de Follow-Up", html: renderCadence(ctx) }
    ];

    for (const doc of DOCS) {
        const htmlPath = join(work, doc.slug + ".html");
        const pdfPath = join(work, doc.slug + ".pdf");
        writeFileSync(htmlPath, doc.html, "utf8");

        sh(CHROME, [
            "--headless", "--disable-gpu", "--no-sandbox",
            "--no-pdf-header-footer",
            "--print-to-pdf=" + pdfPath,
            "file://" + htmlPath
        ]);

        if (!existsSync(pdfPath)) { throw new Error("Chrome produced no PDF for " + doc.slug); }
        const bytes = readFileSync(pdfPath);
        doc.pdfPath = pdfPath;
        doc.bytes = bytes.length;
        console.log("  rendered " + doc.title + " → " + bytes.length + " bytes");

        if (DRY) { continue; }

        // Stable id + stable key: the re-run overwrites in place.
        const docId = "seller-material-" + doc.slug + "-" + CLIENT_ID;
        const key = "client-documents/" + CLIENT_ID + "/" + docId + ".pdf";
        const fileName = doc.slug + ".pdf";

        sh("npx", ["wrangler", "r2", "object", "put", BUCKET + "/" + key,
            "--file", pdfPath, "--content-type", "application/pdf", "--remote"]);

        // Delete-then-insert rather than INSERT OR REPLACE: client_documents.id
        // has no declared PRIMARY KEY, so OR REPLACE would not dedupe on it and
        // a second run would silently add three more rows.
        d1(`DELETE FROM client_documents WHERE id = ${sqlStr(docId)}`);
        d1(
            "INSERT INTO client_documents (id, client_id, title, file_name, file_url, content_type, uploaded_by, visibility) VALUES (" +
            [sqlStr(docId), sqlStr(CLIENT_ID), sqlStr(doc.title), sqlStr(fileName),
             sqlStr(key), sqlStr("application/pdf"), sqlStr("Apex"), sqlStr("seller")].join(", ") + ")"
        );
        console.log("  filed  " + doc.title + " → " + key);
    }

    if (DRY) {
        console.log("\nDRY RUN — nothing uploaded. PDFs in: " + work);
        // Leave the workdir for inspection on a dry run.
        process.exit(0);
    }

    const check = d1(
        `SELECT id, title, visibility FROM client_documents WHERE client_id = ${sqlStr(CLIENT_ID)} AND visibility = 'seller' ORDER BY title`
    );
    console.log("\nSeller-visible documents for this client: " + check.length);
    check.forEach(r => console.log("  - " + r.title + "  [" + r.visibility + "]  " + r.id));
} finally {
    if (!DRY) { rmSync(work, { recursive: true, force: true }); }
}
