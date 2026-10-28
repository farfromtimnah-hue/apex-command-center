// Static audit: every button label in the page sources against help/guides.json,
// using the SAME rules Learn uses (HelpCore.resolveTarget: data-help first, then the
// normalized visible text compared with the buttons[] labels of the right audience).
//
// Usage: node scripts/audit-help-buttons.mjs [--json] [--page portal.html] [--all]
// Prints the labels that match no guide, grouped by page, with file and line.
// Labels built at run time from variables cannot be read here: they are counted as
// "dynamic" and are covered by the live audit in the browser.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const HC = require("../help-core.js");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const data = JSON.parse(fs.readFileSync(path.join(ROOT, "help/guides.json"), "utf8"));
const args = process.argv.slice(2);
const AS_JSON = args.includes("--json");
const SHOW_ALL = args.includes("--all");
const ONLY = args.includes("--page") ? args[args.indexOf("--page") + 1] : null;

// Labels that are deliberately without a guide (reason shown in the report).
const INTENTIONAL = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/fixtures/help-intentional-unlinked.json"), "utf8").replace(/^﻿/, ""));
const intentionalSet = new Map(INTENTIONAL.labels.map((x) => [HC.normalize(x.label), x.reason]));

function dataFor(aud) {
  return { version: data.version, guides: HC.filterByAudience(data.guides, aud), pages: data.pages };
}
const SIDE = { client: dataFor("client"), admin: dataFor("admin") };

const pages = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html") && fs.readFileSync(path.join(ROOT, f), "utf8").includes("help-widget.js"));

function lineOf(text, idx) { return text.slice(0, idx).split("\n").length; }

// Turn a piece of source (HTML or a JS string expression) into { pt, en } or null when dynamic.
function readLabel(raw) {
  let s = raw;
  // show-pt / show-en span pairs
  s = s.replace(/<span class="show-pt">([\s\S]*?)<\/span>\s*<span class="show-en">([\s\S]*?)<\/span>/g, (_, a, b) => `\u0001${a}\u0002${b}\u0003`);
  // helper calls with two literal strings: gmT("pt","en"), t("pt","en"), tr(...), ptEn(...)
  s = s.replace(/\b(?:gmT|t|tr|T|ptEn|bi|L)\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1\s*,\s*(["'`])((?:\\.|(?!\3)[^\\])*)\3\s*\)/g, (_, q1, a, q2, b) => `\u0001${a}\u0002${b}\u0003`);
  // ternary on the language flag: (en ? "English" : "Portugues")
  s = s.replace(/\(\s*(?:en|isEn|isen|IS_EN|isEnglish|EN)\s*\?\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1\s*:\s*(["'`])((?:\\.|(?!\3)[^\\])*)\3\s*\)/g, (_, q1, a, q2, b) => `\u0001${b}\u0002${a}\u0003`);
  // JS string glue:  ' + ... + '
  s = s.replace(/(["'`])\s*\+\s*(?=\u0001)/g, "").replace(/(?<=\u0003)\s*\+\s*(["'`])/g, "");
  const out = {};
  for (const lang of ["pt", "en"]) {
    let t = s.replace(/\u0001([\s\S]*?)\u0002([\s\S]*?)\u0003/g, (_, a, b) => (lang === "pt" ? a : b));
    t = t.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&times;/g, "×").replace(/&middot;/g, "·")
      .replace(/&[a-z]+acute;|&[a-z]+tilde;|&[a-z]+circ;|&[a-z]+cedil;/g, (m) => entity(m)).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
    t = t.replace(/\\(["'`])/g, "$1").replace(/\\n/g, " ");
    if (/[+]\s*[A-Za-z_(]|\$\{|\(\s*[a-z]+\.|[A-Za-z_]+\(/.test(t.replace(/\([^)]*\)/g, ""))) return null; // still has code
    t = t.replace(/^[\s"'`+]+|[\s"'`+]+$/g, "").replace(/\s+/g, " ").trim();
    out[lang] = t;
  }
  return out;
}
function entity(m) {
  const base = { a: "a", e: "e", i: "i", o: "o", u: "u", c: "c", n: "n" };
  const tbl = { "&aacute;": "á", "&eacute;": "é", "&iacute;": "í", "&oacute;": "ó", "&uacute;": "ú", "&atilde;": "ã", "&otilde;": "õ", "&ccedil;": "ç", "&acirc;": "â", "&ecirc;": "ê", "&ocirc;": "ô", "&Aacute;": "Á", "&Eacute;": "É", "&Iacute;": "Í", "&Oacute;": "Ó", "&Uacute;": "Ú", "&Ccedil;": "Ç", "&agrave;": "à" };
  return tbl[m] || "";
}

// Find every clickable in a text: <button ...>...</button>, <a ... class="btn..."> and role="button".
function extract(text, file) {
  const found = [];
  const re = /<(button|a)\b([^>]*)>/gi;
  let m;
  while ((m = re.exec(text))) {
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    const isBtn = tag === "button" || /role\s*=\s*["']button/i.test(attrs) || /class\s*=\s*["'][^"']*\bbtn/i.test(attrs);
    if (!isBtn) continue;
    const close = tag === "button" ? "</button>" : "</a>";
    const end = text.indexOf(close, m.index);
    const inner = end === -1 || end - m.index > 900 ? "" : text.slice(m.index + m[0].length, end);
    const dataHelp = (/data-help\s*=\s*["']([^"']+)["']/.exec(attrs) || [])[1] || null;
    const noHelp = /data-no-help/.test(attrs);
    const aria = (/aria-label\s*=\s*["']([^"']*)["']/.exec(attrs) || [])[1] || "";
    let label = readLabel(inner);
    let ariaLabel = aria ? readLabel(aria) : null;
    found.push({ file, line: lineOf(text, m.index), label, ariaLabel, dataHelp, noHelp, tag });
  }
  return found;
}

function check(item, aud) {
  if (item.noHelp) return { status: "no-help", why: "data-no-help" };
  const d = SIDE[aud];
  const tries = [];
  if (item.label) { tries.push(item.label.pt, item.label.en); }
  if (item.ariaLabel) { tries.push(item.ariaLabel.pt, item.ariaLabel.en); }
  if (item.dataHelp) {
    const r = HC.resolveTarget({ dataHelp: item.dataHelp, texts: [] }, d);
    if (r) return { status: "linked", via: "data-help" };
    return { status: "bad-data-help", why: item.dataHelp };
  }
  if (!item.label && !item.ariaLabel) return { status: "dynamic" };
  // Both languages must resolve: a reader may be in either one.
  const res = {};
  for (const lang of ["pt", "en"]) {
    const texts = [item.label && item.label[lang], item.ariaLabel && item.ariaLabel[lang]].filter(Boolean);
    if (!texts.length || texts.every((x) => !x)) { res[lang] = "empty"; continue; }
    const r = HC.resolveTarget({ texts }, d);
    res[lang] = r ? "ok" : "miss";
  }
  const label = (item.label && (item.label.en || item.label.pt)) || (item.ariaLabel && (item.ariaLabel.en || item.ariaLabel.pt)) || "";
  if (res.pt === "empty" && res.en === "empty") return { status: "empty" };
  if (!/[A-Za-zÀ-ÿ]/.test(((item.label && (item.label.en + item.label.pt)) || "")) && !item.ariaLabel) return { status: "intentional", why: "icon only button (arrow, close, toggle)" };
  const key = HC.normalize((item.label && item.label.en) || label);
  const keyPt = HC.normalize((item.label && item.label.pt) || label);
  if (res.pt === "miss" || res.en === "miss") {
    if (intentionalSet.has(key) || intentionalSet.has(keyPt)) return { status: "intentional", why: intentionalSet.get(key) || intentionalSet.get(keyPt) };
    return { status: "unlinked", res };
  }
  return { status: "linked", via: "label" };
}

const report = {};
let totals = { found: 0, linked: 0, intentional: 0, unlinked: 0, dynamic: 0, empty: 0, noHelp: 0, badDataHelp: 0 };
for (const page of pages) {
  if (ONLY && ONLY !== page) continue;
  const aud = HC.effectiveAudience(true, HC.defaultAudienceForPage(page.replace(/\.html$/, "")));
  const src = fs.readFileSync(path.join(ROOT, page), "utf8");
  const files = [[page, src]];
  for (const mm of src.matchAll(/<script[^>]+src="([^"?]+\.js)(?:\?[^"]*)?"/g)) {
    const f = mm[1];
    if (/^https?:|help-(core|widget|config)|firebase|xlsx|node_modules/.test(f)) continue;
    const p = path.join(ROOT, f);
    if (fs.existsSync(p)) files.push([f, fs.readFileSync(p, "utf8")]);
  }
  const seen = new Map();
  for (const [file, text] of files) {
    for (const it of extract(text, file)) {
      totals.found++;
      const r = check(it, aud);
      const label = it.label ? (it.label.en || it.label.pt) : it.ariaLabel ? (it.ariaLabel.en || it.ariaLabel.pt) : "";
      if (r.status === "linked") totals.linked++;
      else if (r.status === "intentional") totals.intentional++;
      else if (r.status === "dynamic") totals.dynamic++;
      else if (r.status === "empty") totals.empty++;
      else if (r.status === "no-help") totals.noHelp++;
      else if (r.status === "bad-data-help") totals.badDataHelp++;
      else totals.unlinked++;
      if (r.status === "unlinked" || r.status === "bad-data-help" || (SHOW_ALL && r.status !== "linked")) {
        const k = r.status + "|" + HC.normalize(label) + "|" + (it.label ? it.label.pt : "");
        if (!seen.has(k)) seen.set(k, { status: r.status, en: it.label && it.label.en, pt: it.label && it.label.pt, aria: it.ariaLabel, file: it.file, line: it.line, res: r.res, why: r.why, count: 1 });
        else seen.get(k).count++;
      }
    }
  }
  report[page] = { audience: aud, items: [...seen.values()] };
}

if (AS_JSON) {
  console.log(JSON.stringify({ totals, report }, null, 1));
} else {
  for (const [page, r] of Object.entries(report)) {
    if (!r.items.length) continue;
    console.log(`\n## ${page} (${r.audience} side): ${r.items.length} not linked`);
    for (const x of r.items) console.log(`  ${x.file}:${x.line}  [${x.status}] EN "${x.en}" | PT "${x.pt}"${x.count > 1 ? "  x" + x.count : ""}${x.res ? "  " + JSON.stringify(x.res) : ""}${x.why ? "  " + x.why : ""}`);
  }
  console.log("\nTOTALS", JSON.stringify(totals));
}
