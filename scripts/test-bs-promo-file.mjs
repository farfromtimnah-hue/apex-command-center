// The Business System promo video: the address stored in bs_promo_items
// (/api/bs/promo-file/video-pt.mp4) maps to the R2 key the Learn uploader writes
// (help/video/bs-promo-pt.mp4), is signed for staff at read time, and the file
// route answers video/mp4 with range support. Runs the REAL handlers with a fake
// R2 bucket and a made-up secret. No network, no real token.
//
//   node scripts/test-bs-promo-file.mjs
import { readFileSync } from "node:fs";
import vm from "node:vm";

const worker = readFileSync(new URL("../worker/index.js", import.meta.url), "utf8");
const uploader = readFileSync(new URL("./help-media-upload.mjs", import.meta.url), "utf8");
function slice(src, a, b) {
  const i = src.indexOf(a), j = src.indexOf(b, i);
  if (i < 0 || j < 0) { throw new Error("marker not found: " + (i < 0 ? a : b)); }
  return src.slice(i, j);
}
let fails = 0;
const t = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) { fails++; }
  console.log((ok ? "PASS" : "FAIL") + "  " + label +
    (ok ? "" : "\n        expected " + JSON.stringify(expected) + "\n        got      " + JSON.stringify(actual)));
};

globalThis.CORS_HEADERS = { "Access-Control-Allow-Origin": "https://example.test" };
vm.runInThisContext(slice(worker, "var HELP_LINK_TTL_SEC", "// info: { role, login_role, client_status }"));
vm.runInThisContext(slice(worker, "function helpB64hex(", "async function helpLinkSig("));
vm.runInThisContext(slice(worker, "async function helpLinkSig(", "async function helpMintLink("));
vm.runInThisContext(slice(worker, "function helpParseRange(header, size)", "// GET /api/help/file/<path>?e="));
vm.runInThisContext(slice(worker, "function helpNotFound()", "function helpParseRange(") );
vm.runInThisContext(slice(worker, "var BS_PROMO_FILE_RE", "async function handleGetBsPromo(request, env)"));

// A made-up 1000 byte "video" in a fake bucket.
const BYTES = new Uint8Array(1000).map((_, i) => i % 251);
const gets = [];
const env = {
  HELP_LINK_SECRET: "test-only-secret",
  ASSETS: {
    head: async (key) => (key === "help/video/bs-promo-pt.mp4" ? { size: BYTES.length } : null),
    get: async (key, opts) => {
      gets.push({ key, opts });
      if (key !== "help/video/bs-promo-pt.mp4") { return null; }
      const r = opts && opts.range ? BYTES.slice(opts.range.offset, opts.range.offset + opts.range.length) : BYTES;
      return { body: r };
    }
  }
};
const origin = "https://apex-api.example";

// the key matches what the uploader writes
t("the uploader maps help-private/video to the key prefix help/video", /\["help-private\/video", "help\/video"\]/.test(uploader), true);
t("the file video-pt.mp4 maps to the key the uploader writes (help/video/bs-promo-pt.mp4)", bsPromoKey("video-pt.mp4"), "help/video/bs-promo-pt.mp4");
t("the mp4 content type is video/mp4", HELP_TYPES.mp4, "video/mp4");
t("an unknown name has no key", [bsPromoKey("video-fr.mp4"), bsPromoKey("../secret"), bsPromoKey("poster-pt.mp4")], [null, null, null]);

// the stored address becomes a signed one at read time
const signed = await bsPromoSign(env, { url: origin + "/api/bs/promo" }, "/api/bs/promo-file/video-pt.mp4");
t("the stored plain address is signed for the page", /^https:\/\/apex-api\.example\/api\/bs\/promo-file\/video-pt\.mp4\?e=\d+&s=[a-f0-9]{64}$/.test(signed), true);
const reqFor = (url, headers, method) => ({ url, method: method || "GET", headers: { get: (k) => (headers || {})[k] || null } });

let r = await handleGetBsPromoFile(reqFor(signed), env, "video-pt.mp4");
t("a signed GET answers 200", r.status, 200);
t("it answers video/mp4", r.headers.get("Content-Type"), "video/mp4");
t("it says it accepts byte ranges", r.headers.get("Accept-Ranges"), "bytes");
t("it sends the whole file with its length", [r.headers.get("Content-Length"), (await r.arrayBuffer()).byteLength], ["1000", 1000]);
t("it is never stored by a shared cache", r.headers.get("Cache-Control"), "private, no-store");

r = await handleGetBsPromoFile(reqFor(signed, { Range: "bytes=100-199" }), env, "video-pt.mp4");
t("a range request answers 206", r.status, 206);
t("with the right Content-Range and length", [r.headers.get("Content-Range"), r.headers.get("Content-Length")], ["bytes 100-199/1000", "100"]);
t("and only those bytes are read from the bucket", gets[gets.length - 1].opts.range, { offset: 100, length: 100 });
t("and the body is those bytes", Array.from(new Uint8Array(await r.arrayBuffer())).join(","), Array.from(BYTES.slice(100, 200)).join(","));
r = await handleGetBsPromoFile(reqFor(signed, { Range: "bytes=500-" }), env, "video-pt.mp4");
t("an open ended range reads to the end", [r.status, r.headers.get("Content-Range")], [206, "bytes 500-999/1000"]);
r = await handleGetBsPromoFile(reqFor(signed, { Range: "bytes=5000-6000" }), env, "video-pt.mp4");
t("a range past the end answers 416", r.status, 416);
r = await handleGetBsPromoFile(reqFor(signed, null, "HEAD"), env, "video-pt.mp4");
t("HEAD answers 200 with the length and no body", [r.status, r.headers.get("Content-Length"), (await r.arrayBuffer()).byteLength], [200, "1000", 0]);

// refusals
const bad = signed.replace(/s=[a-f0-9]{64}/, "s=" + "0".repeat(64));
r = await handleGetBsPromoFile(reqFor(bad), env, "video-pt.mp4");
t("a wrong signature is a neutral 404", r.status, 404);
r = await handleGetBsPromoFile(reqFor(origin + "/api/bs/promo-file/video-pt.mp4"), env, "video-pt.mp4");
t("no signature is a neutral 404", r.status, 404);
r = await handleGetBsPromoFile(reqFor(signed), env, "video-en.mp4");
t("a signature for another file does not work (and the English file is not in the bucket)", r.status, 404);
const expired = signed.replace(/e=\d+/, "e=1000");
r = await handleGetBsPromoFile(reqFor(expired), env, "video-pt.mp4");
t("an expired link is a 404", r.status, 404);

console.log(fails ? "\n" + fails + " FAILED" : "\nAll passed");
process.exit(fails ? 1 : 0);
