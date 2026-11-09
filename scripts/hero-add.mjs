// Add a cover photo to the shared hero gallery in one repeatable step.
//
//   node scripts/hero-add.mjs <category> <source> [--tone light] [--focus 50,40] [--zoom 100] [--flip]
//                             [--upload] [--dry-run]
//
//   <category>  a key from data/hero-gallery-v1.json categories (outdoor_living, home_systems ...)
//   <source>    pexels:<id>   | unsplash:<photo-id>   | a path to a local jpg or png
//
// What it does (the same standard every earlier photo has):
//   1. fetch the photo (pexels and unsplash are free to use; the id is kept in the entry as the credit)
//   2. resize to 2400 pixels wide, JPEG quality 85 (never enlarges a smaller photo)
//   3. save it as hero-gallery-files/<category>-<n>.jpg (gitignored: the file lives in R2, not in git)
//   4. add the entry to data/hero-gallery-v1.json with the next order number and the framing given
//   5. with --upload: put the file in R2 at hero-gallery/<file> (bucket apex-command-center)
// Without --upload nothing leaves this Mac, so candidates can be looked at first.
// Re-running with the same source and category does nothing (the source is the key).
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const REPO = new URL("../", import.meta.url).pathname;
const DATA = join(REPO, "data/hero-gallery-v1.json");
const OUT_DIR = join(REPO, "hero-gallery-files");
const BUCKET = "apex-command-center";
const ACCOUNT = "b52dcd8983e33e42355f98649193e20c";
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const [category, source] = args.filter(a => !a.startsWith("--") && a !== opt("--focus") && a !== opt("--zoom") && a !== opt("--tone"));
const DRY = flag("--dry-run");

function die(m) { console.error("ERROR: " + m); process.exit(1); }
if (!category || !source) { die("usage: node scripts/hero-add.mjs <category> <pexels:ID|unsplash:ID|file> [--tone light] [--focus 50,40] [--zoom 100] [--flip] [--upload] [--dry-run]"); }

const gallery = JSON.parse(readFileSync(DATA, "utf8"));
if (!gallery.categories.some(c => c.key === category)) { die("unknown category " + category + " (known: " + gallery.categories.map(c => c.key).join(", ") + ")"); }
const sourceTag = /^(pexels|unsplash):/.test(source) ? source : "file:" + source.split("/").pop();
const dupe = gallery.images.find(i => i.category === category && (i.source === sourceTag || ("unsplash:" + i.unsplash_id) === sourceTag));
if (dupe) { console.log("already in the gallery as " + dupe.key + " (nothing to do)"); process.exit(0); }

const inCat = gallery.images.filter(i => i.category === category);
const order = inCat.reduce((m, i) => Math.max(m, i.order), 0) + 1;
let key = category + "-" + order;
while (gallery.images.some(i => i.key === key)) { key = category + "-" + (Number(key.split("-").pop()) + 1); }
const file = key + ".jpg";
const [fx, fy] = (opt("--focus", "50,50")).split(",").map(Number);
const zoom = Number(opt("--zoom", "100"));
const tone = opt("--tone", "dark") === "light" ? "light" : "dark";
if (![fx, fy, zoom].every(Number.isFinite)) { die("--focus must be like 50,40 and --zoom a number"); }

const entry = { key, category, order, file, focus_x: fx, focus_y: fy, zoom, slide: 0, fill: null, tone, flip: flag("--flip"),
  source: sourceTag, retouch: null };
console.log("entry: " + JSON.stringify(entry));
if (DRY) { console.log("dry run: nothing fetched, saved or uploaded"); process.exit(0); }

mkdirSync(OUT_DIR, { recursive: true });
const raw = join(tmpdir(), "hero-add-" + process.pid + ".img");
if (/^pexels:/.test(source)) {
  const id = source.split(":")[1];
  execFileSync("curl", ["-fsSL", "-o", raw, "https://images.pexels.com/photos/" + id + "/pexels-photo-" + id + ".jpeg?auto=compress&cs=tinysrgb&w=2400"]);
} else if (/^unsplash:/.test(source)) {
  const id = source.split(":")[1];
  execFileSync("curl", ["-fsSL", "-o", raw, "https://images.unsplash.com/photo-" + id + "?auto=format&fit=max&w=2400&q=85&fm=jpg"]);
} else {
  if (!existsSync(source)) { die("file not found: " + source); }
  copyFileSync(source, raw);
}
const dest = join(OUT_DIR, file);
const width = Number((execFileSync("sips", ["-g", "pixelWidth", raw], { encoding: "utf8" }).match(/pixelWidth: (\d+)/) || [])[1] || 0);
if (!width) { die("could not read the photo (is it a picture?)"); }
const sipsArgs = ["-s", "format", "jpeg", "-s", "formatOptions", "85"];
if (width > 2400) { sipsArgs.push("--resampleWidth", "2400"); }
execFileSync("sips", [...sipsArgs, raw, "--out", dest], { stdio: "ignore" });
console.log("saved " + dest + " (" + Math.round(statSync(dest).size / 1024) + " KB, was " + width + " px wide)");

gallery.images.push(entry);
writeFileSync(DATA, JSON.stringify(gallery, null, 1).replace(/\n$/, "") + "\n");
console.log("added " + key + " to data/hero-gallery-v1.json (order " + order + ")");

if (flag("--upload")) {
  execFileSync("npx", ["wrangler", "r2", "object", "put", BUCKET + "/hero-gallery/" + file, "--file", dest, "--content-type", "image/jpeg", "--remote"],
    { stdio: "inherit", env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT } });
  console.log("uploaded to R2: hero-gallery/" + file);
} else {
  console.log("not uploaded (add --upload when Nicole has picked it)");
}
