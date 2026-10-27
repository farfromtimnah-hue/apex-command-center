// Learn (Aprenda): upload guide pictures, posters and videos to the PRIVATE R2
// bucket (binding ASSETS, bucket apex-command-center) under the key prefix help/.
// The Worker serves them only to signed in people (GET /api/help/file/...).
//
//   node scripts/help-media-upload.mjs            upload new or changed files
//   node scripts/help-media-upload.mjs --dry-run  show what would be uploaded
//   node scripts/help-media-upload.mjs --check 20 download 20 random objects and compare byte sizes
//
// Sources (the key is the same relative path under help/):
//   help/img/guides/<guide-id>/...   (older pictures still in the repo)
//   help/video/...                   (videos and posters still in the repo)
//   help-private/img/guides/...      (NEW pictures; gitignored, never committed)
//   help-private/video/...           (NEW videos; gitignored)
// Idempotent: help-private/.upload-manifest.json (gitignored) remembers the
// sha256 of every uploaded file, so a second run uploads nothing.
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { join, extname } from "node:path";
import { tmpdir } from "node:os";

const REPO = new URL("../", import.meta.url).pathname;
const BUCKET = "apex-command-center";
const ACCOUNT = "b52dcd8983e33e42355f98649193e20c";
const ROOTS = [
  ["help/img/guides", "help/img/guides"],
  ["help/video", "help/video"],
  ["help-private/img/guides", "help/img/guides"],
  ["help-private/video", "help/video"]
];
const TYPES = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".mp4": "video/mp4" };
const MANIFEST = join(REPO, "help-private/.upload-manifest.json");
const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const checkAt = args.indexOf("--check");
const CONCURRENCY = 8;

function walk(dir, out) {
  if (!existsSync(dir)) { return out; }
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) { continue; }
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { walk(p, out); } else { out.push(p); }
  }
  return out;
}

function listFiles() {
  const byKey = {};
  for (const [src, prefix] of ROOTS) {
    const abs = join(REPO, src);
    for (const f of walk(abs, [])) {
      if (!TYPES[extname(f).toLowerCase()]) { continue; }
      const key = prefix + f.slice(abs.length);
      byKey[key] = f; // help-private wins over a same-named repo file
    }
  }
  return byKey;
}

function wrangler(cmdArgs) {
  return new Promise((resolve) => {
    execFile("npx", ["wrangler", ...cmdArgs], { env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT }, maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout) + String(stderr) });
    });
  });
}

async function pool(items, worker) {
  let i = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (i < items.length) { const mine = items[i++]; await worker(mine); }
  }));
}

const files = listFiles();
const keys = Object.keys(files).sort();

if (checkAt !== -1) {
  const n = Math.max(1, parseInt(args[checkAt + 1], 10) || 10);
  const picked = [...keys].sort(() => Math.random() - 0.5).slice(0, n);
  const tmp = join(tmpdir(), "help-media-check-" + process.pid);
  mkdirSync(tmp, { recursive: true });
  let bad = 0;
  await pool(picked, async (key) => {
    const dest = join(tmp, createHash("sha1").update(key).digest("hex"));
    const r = await wrangler(["r2", "object", "get", BUCKET + "/" + key, "--file", dest, "--remote"]);
    const want = statSync(files[key]).size;
    const got = existsSync(dest) ? statSync(dest).size : -1;
    if (!r.ok || got !== want) { bad++; console.log("MISMATCH " + key + " local " + want + " remote " + got); }
  });
  rmSync(tmp, { recursive: true, force: true });
  console.log((picked.length - bad) + " of " + picked.length + " sampled objects have the same byte size");
  process.exit(bad ? 1 : 0);
}

const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
const todo = [];
for (const key of keys) {
  const buf = readFileSync(files[key]);
  const sha = createHash("sha256").update(buf).digest("hex");
  if (manifest[key] && manifest[key].sha256 === sha && manifest[key].size === buf.length) { continue; }
  todo.push({ key, file: files[key], sha, size: buf.length });
}
console.log(keys.length + " files found, " + todo.length + " to upload" + (DRY ? " (dry run, nothing sent)" : ""));
if (DRY) { todo.slice(0, 20).forEach((t) => console.log("  " + t.key)); process.exit(0); }

let done = 0, failed = 0;
await pool(todo, async (t) => {
  const r = await wrangler(["r2", "object", "put", BUCKET + "/" + t.key, "--file", t.file, "--content-type", TYPES[extname(t.file).toLowerCase()], "--remote"]);
  if (r.ok) {
    manifest[t.key] = { sha256: t.sha, size: t.size };
    done++;
    if (done % 50 === 0) { writeFileSync(MANIFEST, JSON.stringify(manifest)); console.log(done + " uploaded"); }
  } else {
    failed++;
    console.log("FAILED " + t.key + " :: " + r.out.split("\n").slice(-3).join(" ").slice(0, 200));
  }
});
mkdirSync(join(REPO, "help-private"), { recursive: true });
writeFileSync(MANIFEST, JSON.stringify(manifest));
console.log("uploaded " + done + ", failed " + failed + ", already current " + (keys.length - todo.length));
process.exit(failed ? 1 : 0);
