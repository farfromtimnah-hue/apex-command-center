// The server deploys before Apple approves a new app build, so every app already installed keeps its
// OLD bundled code while it receives NEW industry data. This runs the code of App Store build 19
// (git commit 5f153ad8, 2026-11-02) against today's gallery manifest and proves the old app
// degrades gracefully: it must not throw on a category it has never heard of, must still find its
// photos, and must still show every chip it knows.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import vm from "node:vm";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };
const root = new URL("../", import.meta.url);
const BUILD_19 = "5f153ad8";
const old = (f) => execFileSync("git", ["show", BUILD_19 + ":" + f], { cwd: root.pathname, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

let oldLabels, oldGm;
try { oldLabels = old("gm-labels.js"); oldGm = old("gm.js"); }
catch (e) { console.log("SKIP  build 19 is not in this git history (" + e.message.split("\n")[0] + ")"); process.exit(0); }

const gal = JSON.parse(readFileSync(new URL("data/hero-gallery-v1.json", root), "utf8"));
// The manifest exactly as GET /api/hero-gallery sends it (worker handleGetHeroGallery).
const manifest = { version: gal.version, categories: gal.categories,
  images: gal.images.map(im => ({ key: im.key, category: im.category, order: im.order, focus_x: im.focus_x, focus_y: im.focus_y, zoom: im.zoom, slide: im.slide, fill: im.fill, tone: im.tone, flip: !!im.flip, url: "https://x/api/hero-gallery/" + im.key + ".jpg" })) };

// Build 19's own labels file.
const win = {};
vm.runInNewContext(oldLabels, { window: win, self: win, globalThis: win, console });
const Labels = win.GmLabels || (new Function(oldLabels + "; return typeof GmLabels !== 'undefined' ? GmLabels : null;"))();
ok(!!Labels && Array.isArray(Labels.HERO_CATEGORIES), "build 19: its bundled chip list loads (" + (Labels && Labels.HERO_CATEGORIES.length) + " chips)");
const oldKeys = Labels.HERO_CATEGORIES.map(c => c.key);

// Build 19's own picker helpers, cut out of its gm.js.
function fn(name) {
  const i = oldGm.indexOf("\nfunction " + name + "(");
  if (i < 0) throw new Error("not in build 19: " + name);
  const j = oldGm.indexOf("\n}", i + 1);
  return oldGm.slice(i + 1, j + 2);
}
const ctx = { GmLabels: Labels, gmHeroGallery: manifest, gmHeroPrivate: [] };
vm.createContext(ctx);
vm.runInContext(fn("gmHeroImagesOf") + "\n" + fn("gmHeroCatOfKey"), ctx);

// Every chip build 19 knows still has photos.
ok(oldKeys.every(k => ctx.gmHeroImagesOf(k).length > 0), "build 19: every chip it shows still has photos with the new manifest");
// Categories build 19 has never heard of: no crash, photos still found by key.
const newCats = manifest.categories.map(c => c.key).filter(k => !oldKeys.includes(k));
console.log("INFO  categories build 19 does not know: " + (newCats.join(", ") || "none"));
let threw = null;
try {
  for (const k of newCats) { ctx.gmHeroImagesOf(k); }
  for (const im of manifest.images) { if (ctx.gmHeroCatOfKey(im.key) !== im.category) { threw = "wrong category for " + im.key; } }
} catch (e) { threw = String(e); }
ok(threw === null, "build 19: finding the category of any photo in the new manifest never throws or misreads (" + (threw || "ok") + ")");
// What build 19 shows for a saved photo from a new category: its chip is missing, so the picker
// opens on that category with the photos and no highlighted chip. It must not be null (a null category
// is what makes the picker show an error).
for (const k of newCats) {
  const im = manifest.images.find(i => i.category === k);
  if (im) { ok(ctx.gmHeroCatOfKey(im.key) === k, "build 19: a saved cover from " + k + " is still recognised as " + k); }
}

console.log(fail ? "\n" + fail + " FAILED" : "\nAll passed");
process.exit(fail ? 1 : 0);
