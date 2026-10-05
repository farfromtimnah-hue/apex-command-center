# Range notices (start/end markers)

A notice may name a block plus markers instead of using the whole block:

    "mode": "print" | "on_file",
    "block": "<### heading>", "block_index": 0,
    "start": "exact short string found once in that block",   // copied INTO the notice (first characters)
    "end": "exact short string found once after start",        // copied INTO the notice (last characters)
    "start_occurrence": 2, "end_occurrence": 2,                // optional, 1-based, only if the marker repeats
    "quote_note": "how the statute's own quotation marks were handled (included / excluded by placing markers inside them / none)",
    "blanks": ["[date]", "(Name of seller)"],                   // every blank a person must fill; [] if none
    "boundary_unsure": "optional: where you were less than certain of an edge and why"

The loader copies blockText[start .. end+end.length] byte for byte. Markers must lie on one line (no line breaks inside a marker).
