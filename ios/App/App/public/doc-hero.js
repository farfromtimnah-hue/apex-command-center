// The customer-document hero: framing and tone for one hero photo. ONE copy,
// shared by the six homeowner pages, the six PDF templates and the portal's
// hero picker (see doc-hero.css for the look).
//
// A hero is { focus_x, focus_y, zoom, slide, fill, tone, flip }, as the Worker
// sends it on business.hero (a gallery pick copies Nicole's saved values
// from data/hero-gallery-v1.json; an upload carries the owner's own):
//   focus_x / focus_y  object-position, percent (default 50 / 50)
//   zoom               percent, 100 = cover; below 100 only with a fill,
//                      so the fill shows where the photo stops
//   slide              translateX, percent of the photo's width
//   fill               the band's color behind the photo, or null
//   tone               "dark" (default) or "light" tiles
//   flip               true = mirrored horizontally (default false), so a
//                      subject on the left moves out from under the logo

function docHeroNum(v, dflt, lo, hi) {
  var n = (v === null || v === undefined || v === "") ? NaN : Number(v);
  if (isNaN(n)) { return dflt; }
  return Math.max(lo, Math.min(hi, n));
}

function docHeroNorm(h) {
  h = h || {};
  var fill = (typeof h.fill === "string" && /^#[0-9a-fA-F]{6}$/.test(h.fill)) ? h.fill : null;
  return {
    focus_x: docHeroNum(h.focus_x, 50, 0, 100),
    focus_y: docHeroNum(h.focus_y, 50, 0, 100),
    zoom: docHeroNum(h.zoom, 100, fill ? 50 : 100, 200),
    slide: docHeroNum(h.slide, 0, -50, 50),
    fill: fill,
    tone: h.tone === "light" ? "light" : "dark",
    flip: h.flip === true || h.flip === 1 || h.flip === "1"
  };
}

// The img transform: slide, then zoom, then the mirror (last, so the photo
// is flipped in place). "" when none applies.
function docHeroTransform(n) {
  var t = "";
  if (n.slide !== 0 || n.zoom !== 100) { t = "translateX(" + n.slide + "%) scale(" + (n.zoom / 100) + ")"; }
  if (n.flip) { t += (t ? " " : "") + "scaleX(-1)"; }
  return t;
}

// Inline style for the <img class="hero-img">.
function docHeroImgStyle(h) {
  var n = docHeroNorm(h);
  var s = "object-position:" + n.focus_x + "% " + n.focus_y + "%;";
  var t = docHeroTransform(n);
  if (t) { s += "transform:" + t + ";"; }
  return s;
}

// Inline style for the .hero-band (the fill color, when the hero has one).
function docHeroBandStyle(h) {
  var n = docHeroNorm(h);
  return n.fill ? "background:" + n.fill + ";" : "";
}

// Extra class for the .hero-band ("" or " tone-light").
function docHeroToneClass(h) {
  return docHeroNorm(h).tone === "light" ? " tone-light" : "";
}

// For pages that build the band in markup and fill it in afterwards.
function docHeroApply(band, img, h) {
  var n = docHeroNorm(h);
  if (band) {
    band.style.background = n.fill || "";
    if (n.tone === "light") { band.classList.add("tone-light"); } else { band.classList.remove("tone-light"); }
  }
  if (img) {
    img.style.objectPosition = n.focus_x + "% " + n.focus_y + "%";
    img.style.transform = docHeroTransform(n);
  }
}
