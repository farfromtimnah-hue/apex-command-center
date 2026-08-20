#!/bin/sh
# Stage the PWA's web assets into www/ for the Capacitor iOS wrapper.
#
# The web assets ARE the repo root - there is no build step and no dist/.
# Capacitor 8 hardcodes '.' onto an invalid-webDir blocklist (see
# node_modules/@capacitor/cli/dist/common.js, checkWebDir), so the root
# cannot be used as webDir directly. This script mirrors the root's web
# assets into www/ instead, which also keeps .git, node_modules, ios/,
# migrations/ and scripts/ out of the shipped app bundle.
#
# www/ is generated and gitignored. Re-run this before `npx cap sync`.
# `npm run sync` does both.

set -e

ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="$ROOT/www"

rm -rf "$OUT"
mkdir -p "$OUT"

# Top-level web assets. capacitor.config.json and the npm manifests are
# tooling, not app assets, so they are deliberately excluded.
for f in "$ROOT"/*.html "$ROOT"/*.js "$ROOT"/*.css "$ROOT"/manifest.json "$ROOT"/version.json; do
  [ -f "$f" ] || continue
  case $(basename "$f") in
    capacitor.config.json|package.json|package-lock.json) continue ;;
  esac
  cp "$f" "$OUT"/
done

# Asset directories referenced by the pages.
for d in assets icons; do
  [ -d "$ROOT/$d" ] || continue
  cp -R "$ROOT/$d" "$OUT"/
done

echo "staged $(find "$OUT" -type f | wc -l | tr -d ' ') files into www/"
