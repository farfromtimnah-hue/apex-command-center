// The industry lists must agree, so that adding an industry never needs an app update again.
//
// The same list of industries lives in four places:
//   data/hero-gallery-v1.json  categories + images   (served by GET /api/hero-gallery)
//   data/wizard-v1.json        categories + sub taps (served by GET gm/wizard)
//   data/license-table-v1.json work types per state  (what a sub tap needs a license for)
//   gm-labels.js               HERO_CATEGORIES       (BUNDLED in the app: only a fallback now)
// The first three are server data: a Worker deploy changes them for every app already installed.
// The cover picker reads its chips from the server list (gm.js gmHeroCats) and only falls back
// to the bundled one when the server could not be reached.
import { readFileSync } from "node:fs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };
const root = new URL("../", import.meta.url);
const json = (f) => JSON.parse(readFileSync(new URL(f, root), "utf8"));
const text = (f) => readFileSync(new URL(f, root), "utf8");

const gal = json("data/hero-gallery-v1.json");
const wiz = json("data/wizard-v1.json");
const lic = json("data/license-table-v1.json");
const labels = text("gm-labels.js");
const picker = text("gm.js");

const MIN_PHOTOS = 5;
// Categories still short of photos. Each name here is a promise that photos are coming;
// the list must be EMPTY when the cover photo work is finished.
const SHORT_UNTIL_PHOTOS_ADDED = [];   // emptied 2026-11-09: every category has its photos

const galKeys = gal.categories.map(c => c.key);
const wizKeys = wiz.categories.map(c => c.key);

ok(new Set(galKeys).size === galKeys.length, "gallery: no category key twice");
ok(new Set(wizKeys).size === wizKeys.length, "wizard: no category key twice");
ok(wizKeys.every(k => galKeys.includes(k)), "every wizard industry has a gallery category (" + wizKeys.filter(k => !galKeys.includes(k)).join(", ") + ")");
ok(galKeys.every(k => wizKeys.includes(k)), "every gallery category is a wizard industry (" + galKeys.filter(k => !wizKeys.includes(k)).join(", ") + ")");

// Same words in both files and in both languages.
for (const g of gal.categories) {
  const w = wiz.categories.find(c => c.key === g.key);
  if (!w) continue;
  ok(!!(g.label_en && g.label_pt && w.label_en && w.label_pt), g.key + ": has English and Portuguese labels in both files");
  ok(g.label_en === w.label_en && g.label_pt === w.label_pt, g.key + ": the same labels in both files");
}

// The bundled list is the fallback: it may be shorter (older app), but must never show a chip with no photos.
const bundled = [...labels.matchAll(/\{ key: "([a-z_]+)",\s+pt: "[^"]*",\s+en: "[^"]*" \}/g)].map(m => m[1])
  .filter(k => galKeys.includes(k) || /exclusive/.test(k));
const block = labels.slice(labels.indexOf("var HERO_CATEGORIES = ["), labels.indexOf("];", labels.indexOf("var HERO_CATEGORIES = [")));
const bundledKeys = [...block.matchAll(/key: "([a-z_]+)"/g)].map(m => m[1]);
ok(bundledKeys.every(k => galKeys.includes(k)), "gm-labels.js (bundled fallback) lists only categories the server also has");
ok(bundledKeys.length > 0, "gm-labels.js still carries the fallback list (" + bundledKeys.length + " chips)");

// Photos.
const byCat = {};
for (const im of gal.images) { if (im.hidden) continue; (byCat[im.category] = byCat[im.category] || []).push(im); }   // hidden photos are not offered, so they do not count
for (const k of galKeys) {
  const n = (byCat[k] || []).length;
  if (SHORT_UNTIL_PHOTOS_ADDED.includes(k)) { ok(n < MIN_PHOTOS, k + ": listed as short and really is (" + n + ")"); }
  else { ok(n >= MIN_PHOTOS, k + ": at least " + MIN_PHOTOS + " photos (" + n + ")"); }
}
ok(gal.images.every(im => galKeys.includes(im.category)), "every photo belongs to a gallery category");
ok(gal.images.every(im => im.file && /\.jpg$/.test(im.file) && im.key), "every photo has a key and a .jpg file name");
const keys = gal.images.map(i => i.key);
ok(new Set(keys).size === keys.length, "no photo key twice");
const ordered = Object.entries(byCat).every(([k, l]) => new Set(l.map(i => i.order)).size === l.length);
ok(ordered, "no two photos share an order number inside a category");
for (const [cat, list] of Object.entries(wiz.lead_photos || {})) {
  ok(list.every(k => keys.includes(k)), "lead photos for " + cat + " exist in the gallery");
}

// Sub taps: a license work type must be one the license table knows, or null (Apex says it could not confirm).
const known = new Set();
for (const st of Object.values(lic)) { Object.keys(st.wt || {}).forEach(k => known.add(k)); }
const unknown = [];
for (const c of wiz.categories) {
  const sk = c.subtaps.map(s => s.key);
  ok(new Set(sk).size === sk.length, c.key + ": no sub tap key twice");
  ok(c.subtaps.every(s => s.en && s.pt), c.key + ": every sub tap has English and Portuguese words");
  for (const s of c.subtaps) { if (s.work_type && !known.has(s.work_type)) { unknown.push(c.key + "/" + s.key + " -> " + s.work_type); } }
}
ok(unknown.length === 0, "every sub tap work type exists in the license table" + (unknown.length ? ": " + unknown.join("; ") : ""));

// The picker reads the SERVER list of chips.
ok(/function gmHeroCats\(\)/.test(picker) && /gmHeroGallery\.categories/.test(picker), "gm.js: gmHeroCats() reads the categories the server sent");
ok(/var chips = gmHeroHasPrivate\(\) \? \[GmLabels\.HERO_PRIVATE_CHIP\]\.concat\(gmHeroCats\(\)\) : gmHeroCats\(\);/.test(picker), "gm.js: the cover chips come from gmHeroCats(), not straight from the bundled list");

console.log(fail ? "\n" + fail + " FAILED" : "\nAll passed");
process.exit(fail ? 1 : 0);
