#!/usr/bin/env python3
"""Writes the ABC Supply guides into help/guides.json and their pictures into help-private/img/guides.
Run: python3 scripts/abc-guides-build.py <spec.json>   (spec made by the session; pictures come from files or recording frames)
Spec: {"guides": [{"id":..., "title":{"pt","en"}, "summary":{...}, "keywords":{...}, "page":"gmpricing", "video": {...}|null,
        "sections":[{"id","title":{},"steps":[{"text":{"pt","en"}, "pic": {"file": path} | {"video": path, "t": seconds, "crop":"w:h:x:y"} | null}]}],
        "buttons":[{"labels":{"pt":[],"en":[]},"section":id,"step":n}]}]}
Pictures are written once and used for both languages (the screens are in English); width 946.
"""
import json, os, subprocess, sys
from PIL import Image
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = json.load(open(sys.argv[1]))
gpath = os.path.join(REPO, "help/guides.json")
data = json.load(open(gpath))
for g in spec["guides"]:
    gid = g["id"]; sections = []
    for sec in g["sections"]:
        steps = []
        for n, st in enumerate(sec["steps"], 1):
            img = None
            p = st.get("pic")
            if p:
                rel = "help/img/guides/%s/%s-%02d.%s.jpg" % (gid, sec["id"], n, "%s")
                dst = {l: os.path.join(REPO, rel.replace("help/img/", "help-private/img/", 1) % l) for l in ("pt", "en")}
                os.makedirs(os.path.dirname(dst["en"]), exist_ok=True)
                tmp = dst["en"] + ".src.png"
                if "file" in p:
                    im = Image.open(p["file"]).convert("RGB")
                    if p.get("file_pt"): im_pt = Image.open(p["file_pt"]).convert("RGB")
                else:
                    cr = p.get("crop", "1624:1250:8:346")
                    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(p["t"]), "-i", p["video"], "-frames:v", "1", "-vf", "crop=" + cr, tmp], check=True)
                    im = Image.open(tmp).convert("RGB"); os.remove(tmp)
                if p.get("autocrop"):
                    import numpy as np
                    a = np.array(im).astype(int); white = (a.min(axis=2) >= 244)
                    rr = np.where(white.mean(axis=1) > 0.30)[0]; cc = np.where(white.mean(axis=0) > 0.18)[0]
                    if len(rr) > 20 and len(cc) > 20:
                        im = im.crop((max(cc.min() - 14, 0), max(rr.min() - 16, 0), min(cc.max() + 14, im.width), min(rr.max() + 10, im.height)))
                for box in p.get("cover", []):  # solid grey cover over private text
                    from PIL import ImageDraw
                    ImageDraw.Draw(im).rectangle(box, fill=(138, 138, 138))
                w = 946; h = round(im.height * w / im.width)
                im = im.resize((w, h), Image.LANCZOS)
                im.save(dst["en"], quality=88)
                if p.get("file_pt"):
                    # a separate Portuguese picture (taken in the Portuguese screen): same width, same quality
                    im2 = im_pt; im2 = im2.resize((w, round(im2.height * w / im2.width)), Image.LANCZOS); im2.save(dst["pt"], quality=88)
                else:
                    im.save(dst["pt"], quality=88)
                img = {"pt": rel % "pt", "en": rel % "en"}
            steps.append({"n": n, "text": st["text"], "image": img})
        sections.append({"id": sec["id"], "title": sec["title"], "steps": steps})
    entry = {"id": gid, "audience": "client", "who": ["owner"], "title": g["title"], "summary": g["summary"], "keywords": g["keywords"],
             "video": g.get("video"), "sections": sections, "buttons": g.get("buttons", [])}
    data["guides"] = [x for x in data["guides"] if x["id"] != gid] + [entry]
    pg = g.get("page")
    if pg and pg in data["pages"] and gid not in data["pages"][pg]["guides"]:
        data["pages"][pg]["guides"].append(gid)
    print("wrote guide", gid, "with", sum(len(s["steps"]) for s in sections), "steps")
json.dump(data, open(gpath, "w"), ensure_ascii=False, indent=2); open(gpath, "a").write("\n")
