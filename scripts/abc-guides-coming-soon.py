#!/usr/bin/env python3
"""Puts "Coming soon" on, or takes it off, the five ABC Supply Aprenda guides (ids abc-connect, abc-price-list,
abc-extra-material, abc-order, abc-batch) in help/guides.json. Safe to run twice.
  python3 scripts/abc-guides-coming-soon.py on     adds   "Coming soon: " / "Em breve: " before each title and "Coming soon. " / "Em breve. " before each summary
  python3 scripts/abc-guides-coming-soon.py off    removes them (DO THIS WHEN ABC GOES LIVE; full list of places: Nicole Second Brain/knowledge/abc-go-live-remove-coming-soon-checklist.md)
  python3 scripts/abc-guides-coming-soon.py check  prints which guides carry the label
After "on" or "off": node scripts/test-help-system.mjs, commit help/guides.json, CLOUDFLARE_ACCOUNT_ID=b52dcd8983e33e42355f98649193e20c npx wrangler deploy (the Worker bundles guides.json), push."""
import json, os, sys
IDS = ["abc-connect", "abc-price-list", "abc-extra-material", "abc-order", "abc-batch"]
T = {"en": "Coming soon: ", "pt": "Em breve: "}
S = {"en": "Coming soon. ", "pt": "Em breve. "}
mode = sys.argv[1] if len(sys.argv) > 1 else "check"
p = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "help/guides.json")
d = json.load(open(p))
for g in d["guides"]:
    if g["id"] not in IDS:
        continue
    for lang in ("en", "pt"):
        t, s = g["title"][lang], g["summary"][lang]
        if mode == "on":
            if not t.startswith(T[lang]): g["title"][lang] = T[lang] + t
            if not s.startswith(S[lang]): g["summary"][lang] = S[lang] + s
        elif mode == "off":
            if t.startswith(T[lang]): g["title"][lang] = t[len(T[lang]):]
            if s.startswith(S[lang]): g["summary"][lang] = s[len(S[lang]):]
    print(g["id"], "|", g["title"]["en"], "|", g["title"]["pt"])
if mode in ("on", "off"):
    json.dump(d, open(p, "w"), ensure_ascii=False, indent=2); open(p, "a").write("\n")
