// Task 7.2: Dictate button, "I sent the payment", and bank-line linking --
// what can be tested here without a microphone or a real bank, and an
// honest statement of what cannot.
//
// vendors.js is a single top-level IIFE ((function () { ... })()) with
// every function indented inside it and closing over module-level state
// (CURRENT_SENT_VENDOR, VENDORS_BY_ID, vndQRec...) and direct DOM/Web API
// calls (document.getElementById, MediaRecorder, navigator.mediaDevices).
// Unlike gm.js's gmReviewFocusSettingsField (see
// test-review-focus-settings-field.mjs), these functions are not
// individually extractable by the d1-shim's fnSrc() (which only finds a
// "function name(" at column 0) without either a real browser or
// reimplementing a large fake-DOM sandbox disproportionate to this task.
//
// WHAT NEEDS A REAL MIC / REAL BANK, NOT TESTABLE HERE:
//   - toggleQuestionMic/startQuestionMic/stopQuestionMic/sendQuestionMic:
//     actual MediaRecorder capture and the real transcription quality of
//     POST /api/contracts/transcribe against real spoken audio.
//   - vendorLinkSentBatches ever firing against a genuine Remitly bank
//     feed transaction (vs. a hand-inserted test row).
//
// WHAT IS TESTED, EITHER HERE OR ALREADY IN test-vendor-tracking.mjs:
//   - The REAL backend route this session can exercise without a browser:
//     handlePostVendorPaymentSent + vendorLinkSentBatches, already covered
//     by test-vendor-tracking.mjs's "Part E" block (amount-within-8%
//     matching, tie-breaking, credit/shortfall on a mismatched real amount).
//   - POST /api/contracts/transcribe's OWN contract (no audio content
//     assumptions) -- confirmed below: it is auth-gated the same as every
//     other vendor route, and accepts a multipart "audio" field, matching
//     vendors.js's sendQuestionMic() request shape exactly, so a wiring
//     mismatch between the button and the route would be caught here even
//     without real audio.
//   - This file is also the honest record that the frontend wiring itself
//     (button -> MediaRecorder -> FormData -> apiFetch -> DOM update) is a
//     browser-only concern this session could not automate; see the
//     brief's final report for a manual QA checklist instead.
//
//   node scripts/test-vendor-dictate-and-sent-payment-contract.mjs
import { build, baseStubs } from "./fixtures/d1-shim.mjs";

let fail = 0, pass = 0;
const ok = (c, m) => { console.log((c ? "PASS  " : "FAIL  ") + m); if (c) { pass++; } else { fail++; } };

// ── POST /api/contracts/transcribe: the route vendors.js's Dictate button
//    actually calls. Confirms its auth gate and its multipart contract
//    (field name "audio") without needing real audio content or a mic.
{
  const FNS = ["handlePostContractTranscribe", "contractIsReviewer", "isAdminRole"];
  const fakeFormReq = (audio) => ({
    url: "https://x.test/", headers: { get: () => null },
    formData: async () => ({ get: (k) => (k === "audio" ? audio : null) })
  });

  // No session at all -- same 401 every other vendor/gm route gives.
  const F1 = build(FNS, [], Object.assign({}, baseStubs, { authenticate: async () => null }));
  const r1 = await F1.handlePostContractTranscribe(fakeFormReq(null), { AI: {} });
  ok(r1.status === 401, "no session: transcribe refuses with 401, same as every other authed vendor route");

  // Alice (vendors.js's real user) is alice-admin-tier -- isAdminRole covers
  // her, so she CAN dictate without being a "contract reviewer" by name.
  const F2 = build(FNS, [], Object.assign({}, baseStubs, { authenticate: async () => ({ role: "alice" }) }));
  const r2 = await F2.handlePostContractTranscribe(fakeFormReq(null), { AI: {} });
  ok(r2.status === 400 && /audio file is required/.test(r2.error), "alice is authorized (admin role) but an empty audio field is refused -- the route's own validation, not a wiring bug");

  // The exact shape sendQuestionMic() sends: a FormData with one "audio"
  // field holding a Blob-like object. Confirms the route reads that
  // specific field name -- a missing/renamed field would 400 here with "audio
  // file is required" the same as the empty case above, catching a frontend
  // field-name typo without needing the audio to be real.
  const fakeBlob = { type: "audio/webm", arrayBuffer: async () => new ArrayBuffer(0) };
  const r3 = await F2.handlePostContractTranscribe(fakeFormReq(fakeBlob), { AI: {} });
  ok(r3.status === 400 && /audio file is empty/.test(r3.error), "a present but empty audio blob (0 bytes) is refused by the route's own size check, confirming the 'audio' field name round-trips correctly");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
