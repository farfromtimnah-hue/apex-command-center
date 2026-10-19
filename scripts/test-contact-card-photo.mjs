// Contact card vCard PHOTO (2026-10-19 fix): the saved iPhone contact must
// show the SELLER'S own photo when one exists, and must never crop the
// business logo into a circle when it doesn't. Real Worker functions
// (gmVcardPhotoBytes, gmBuildVcard) against fake R2 (env.ASSETS) and a fake
// Cloudflare Images binding (env.IMAGES) -- no network, no production data.
//
//   node scripts/test-contact-card-photo.mjs
import { build, varSrc } from "./fixtures/d1-shim.mjs";

let fail = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (!c) fail++; };

const FNS = ["gmVcardPhotoBytes", "gmBuildVcard", "gmVcardEsc", "gmVcardFold", "gmBytesToB64", "referralHexOrNull"];
const VARS = ["GM_VCARD_PHOTO_SIZE", "GM_VCARD_PHOTO_PAD_BG"];

// build() only returns named FUNCTIONS, not top-level vars, so the real
// numeric/string values are read straight out of the var declarations
// themselves (not duplicated as a guess here) to keep this test honest if
// either constant ever changes.
const PHOTO_SIZE = Number(varSrc("GM_VCARD_PHOTO_SIZE").match(/=\s*(\d+)\s*;/)[1]);
const PAD_BG = varSrc("GM_VCARD_PHOTO_PAD_BG").match(/=\s*"([^"]+)"\s*;/)[1];

function fakeR2(files) {
  return {
    get: async function (key) {
      const f = files[key];
      if (!f) { return null; }
      return {
        httpMetadata: { contentType: f.contentType },
        arrayBuffer: async function () { return f.buf; }
      };
    }
  };
}

// Records every transform call so a test can assert fit/background/size
// without caring about actual pixels -- there is no real image codec here,
// this fake just returns a deterministic "image" whose bytes encode what
// it was asked to do, which is exactly what the tests need to check.
function fakeImages(calls) {
  return {
    input: function (buf) {
      return {
        transform: function (opts) {
          calls.push({ inputByteLength: buf.byteLength, opts: opts });
          const tag = "PADDED:" + opts.width + "x" + opts.height + ":" + opts.fit + ":" + opts.background;
          const bytes = new TextEncoder().encode(tag);
          return {
            output: function () {
              return {
                response: function () {
                  return { arrayBuffer: async function () { return bytes.buffer; } };
                }
              };
            }
          };
        }
      };
    }
  };
}

function buf(n) { return new ArrayBuffer(n); }
function textOf(arrBuf) { return new TextDecoder().decode(arrBuf); }

// ── With a seller photo: the vCard carries the seller photo, untransformed ──
{
  const calls = [];
  const F = build(FNS, VARS, {});
  const env = {
    ASSETS: fakeR2({
      "seller-photos/c1/abc.jpg": { buf: buf(1000), contentType: "image/jpeg" },
      "logos/c1/logo.png": { buf: buf(2000), contentType: "image/png" }
    }),
    IMAGES: fakeImages(calls)
  };
  const photo = await F.gmVcardPhotoBytes(env, "seller-photos/c1/abc.jpg", "logos/c1/logo.png", "#112233");
  ok(photo !== null, "a seller photo is returned");
  ok(photo.type === "JPEG", "the seller photo's TYPE is read from its own content type (JPEG)");
  ok(photo.buf.byteLength === 1000, "the seller photo bytes are used as-is, not transformed");
  ok(calls.length === 0, "the Images binding is never called when a seller photo is used");

  const v = await F.gmBuildVcard(env, {
    company: "Marlow Pool & Patio", first: "Lucas", title: "Sales", phone: "4075551234", email: "lucas@example.com",
    urls: [], note: null, logoKey: "logos/c1/logo.png", sellerPhotoKey: "seller-photos/c1/abc.jpg", brandHex: "#112233"
  });
  ok(v.indexOf("BEGIN:VCARD") === 0, "the vCard starts with BEGIN:VCARD");
  ok(v.indexOf("PHOTO;ENCODING=b;TYPE=JPEG:") !== -1, "the vCard's PHOTO line carries the seller photo (TYPE=JPEG)");
  ok(v.indexOf("FN:Lucas (Marlow Pool & Patio)") !== -1, "the display name is unchanged");
  ok(v.indexOf("ORG:Marlow Pool & Patio") !== -1, "ORG is unchanged");
  ok(v.indexOf("TEL;TYPE=CELL,VOICE:4075551234") !== -1, "phone is unchanged");
  ok(v.indexOf("EMAIL;TYPE=INTERNET:lucas@example.com") !== -1, "email is unchanged");
}

// ── With no seller photo: the logo is padded into a square, fit 'pad',
//    brand color background, never cropped ────────────────────────────────
{
  const calls = [];
  const F = build(FNS, VARS, {});
  const env = {
    ASSETS: fakeR2({ "logos/c2/wide-logo.png": { buf: buf(5000), contentType: "image/png" } }),
    IMAGES: fakeImages(calls)
  };
  const photo = await F.gmVcardPhotoBytes(env, null, "logos/c2/wide-logo.png", "#C9A43A");
  ok(photo !== null, "a padded logo is returned when there is no seller photo");
  ok(photo.type === "JPEG", "the padded logo is always output as JPEG");
  ok(calls.length === 1, "the Images binding is called exactly once");
  ok(calls[0].opts.fit === "pad", "the transform uses fit: 'pad' (never crops the source)");
  ok(calls[0].opts.width === PHOTO_SIZE && calls[0].opts.height === PHOTO_SIZE,
     "the padded canvas is square, " + PHOTO_SIZE + "x" + PHOTO_SIZE);
  ok(calls[0].opts.background === "#C9A43A", "the pad background is the business's own brand color");
  ok(calls[0].inputByteLength === 5000, "the full, unmodified logo bytes are the transform's input");
  ok(textOf(photo.buf).indexOf("pad") !== -1 && textOf(photo.buf).indexOf("#C9A43A") !== -1,
     "the returned bytes come from the padded transform, not the raw logo");
}

// ── No brand color on file: falls back to a fixed pad color, never a guess
//    that silently varies ──────────────────────────────────────────────────
{
  const calls = [];
  const F = build(FNS, VARS, {});
  const env = { ASSETS: fakeR2({ "logos/c3/logo.jpg": { buf: buf(100), contentType: "image/jpeg" } }), IMAGES: fakeImages(calls) };
  await F.gmVcardPhotoBytes(env, null, "logos/c3/logo.jpg", null);
  ok(calls[0].opts.background === PAD_BG, "with no brand color, the fixed fallback pad color is used");
}

// ── An invalid brand color string never reaches the Images call unsanitized ──
{
  const calls = [];
  const F = build(FNS, VARS, {});
  const env = { ASSETS: fakeR2({ "logos/c4/logo.jpg": { buf: buf(100), contentType: "image/jpeg" } }), IMAGES: fakeImages(calls) };
  await F.gmVcardPhotoBytes(env, null, "logos/c4/logo.jpg", "javascript:alert(1)");
  ok(calls[0].opts.background === PAD_BG, "an invalid brand color string is rejected, not passed through to the transform");
}

// ── No seller photo and no logo: no PHOTO field at all ──────────────────────
{
  const F = build(FNS, VARS, {});
  const env = { ASSETS: fakeR2({}), IMAGES: fakeImages([]) };
  const photo = await F.gmVcardPhotoBytes(env, null, null, null);
  ok(photo === null, "with neither a seller photo nor a logo, there is no photo");
  const v = await F.gmBuildVcard(env, { company: "No Photo Co", first: "", title: null, phone: null, email: null, urls: [], note: null, logoKey: null, sellerPhotoKey: null, brandHex: null });
  ok(v.indexOf("PHOTO") === -1, "the vCard has no PHOTO line when there is nothing to show");
}

// ── No Images binding available: the logo is left out rather than shipped
//    unpadded (never crop by guessing) ─────────────────────────────────────
{
  const F = build(FNS, VARS, {});
  const env = { ASSETS: fakeR2({ "logos/c5/logo.jpg": { buf: buf(100), contentType: "image/jpeg" } }) }; // no env.IMAGES
  const photo = await F.gmVcardPhotoBytes(env, null, "logos/c5/logo.jpg", "#000000");
  ok(photo === null, "with no Images binding, the logo PHOTO is left out rather than sent unpadded");
}

// ── A seller photo over 400KB falls through to the (padded) logo ───────────
{
  const calls = [];
  const F = build(FNS, VARS, {});
  const env = {
    ASSETS: fakeR2({
      "seller-photos/c6/big.jpg": { buf: buf(500 * 1024), contentType: "image/jpeg" },
      "logos/c6/logo.png": { buf: buf(1000), contentType: "image/png" }
    }),
    IMAGES: fakeImages(calls)
  };
  const photo = await F.gmVcardPhotoBytes(env, "seller-photos/c6/big.jpg", "logos/c6/logo.png", "#654321");
  ok(photo !== null && calls.length === 1, "an oversized seller photo falls through to the padded logo instead of being sent raw");
}

// ── A padded logo over 400KB is left out rather than sent oversized ────────
{
  const F = build(FNS, VARS, {});
  const bigTag = "x".repeat(401 * 1024);
  const env = {
    ASSETS: fakeR2({ "logos/c7/logo.png": { buf: buf(100), contentType: "image/png" } }),
    IMAGES: {
      input: function () {
        return { transform: function () { return { output: function () { return { response: function () { return { arrayBuffer: async function () { return new TextEncoder().encode(bigTag).buffer; } }; } }; } }; } };
      }
    }
  };
  const photo = await F.gmVcardPhotoBytes(env, null, "logos/c7/logo.png", "#111111");
  ok(photo === null, "a padded logo that comes back over 400KB is left out, not shipped oversized");
}

console.log(fail ? ("\n" + fail + " FAILED") : "\nALL PASS");
process.exit(fail ? 1 : 0);
