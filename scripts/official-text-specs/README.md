# Spec files for scripts/official-text-apply.mjs

One file per state: `<ST>.json`. A spec says WHICH fenced block fills WHICH notice and WHICH facts change.
It never contains notice wording: the script copies the wording out of the state's input file.

```json
{
  "state": "AZ",
  "mirror_source": false,
  "mirror_source_reason": "only when the state file says its texts come from mirrors / unofficial copies",
  "notices": [
    {
      "id": "AZ-cancel",                      // an existing id, or a NEW id like "AZ-notice-to-buyer"
      "title": "...", "cite": "...",          // only to correct (existing) or required (new)
      "trigger": "...", "format": "...",
      "applies": { "sold_in_home": true },    // only to correct (existing) or required (new)
      "support": "quote from the state file that supports every change/addition on this notice",
      "summary_row": "exact text of the Item cell of the Summary table row (gives status, url, date)",
      "mode": "print | on_file | none",
      "block": "exact text of the ### heading (without the ###)",
      "block_index": 0,
      "hold_reason": "required when the row is official but mode is none"
    },
    { "id": "LA-old", "remove": true, "support": "quote saying it is repealed" }
  ],
  "changes": [
    { "path": "cancellation.business_days", "new": 5, "support": "quote from the state file" }
  ],
  "unsure": ["plain sentences: places where it is unclear a text belongs in the contract"]
}
```

* Every existing notice of the state MUST appear in `notices` (kept, corrected or removed).
* `support` quotes must appear verbatim (whitespace may differ) in the state file.
* `applies` may only use these keys for mode "print": sold_in_home, is_pool, residential (true), over_cents, at_least_cents.
  A trigger the builder cannot decide (credit sale, buyer age, homestead, insurance job, property type, new construction...) must use mode "on_file" (text stored, never printed).
* `changes` paths: `cancellation.*`, `deposit_cap.*`, `written_contract.*`, `license.*`, `defect_process.*`, `cleaning.*`, `pool`, agency phone numbers wherever they appear in the rider. Not `notices`, `reviewed`, `outside_florida`.
