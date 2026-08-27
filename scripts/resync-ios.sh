#!/bin/sh
# ---------------------------------------------------------------------------
# One-off: bring ios/App/App/public/ back up to date with root.
#
# WHY THIS IS SAFE, AND WHY THAT IS THE OPPOSITE OF WHAT THE OLD RULE SAID
# The standing rule was "never blanket-copy root over the iOS copy, it holds
# the OpenPhone deep link root does not have". That WAS true once. It is not
# true now: `gmCallHref` and the openphone:// link were added to ROOT in
# 6a33c9f, so root carries them too.
#
# Audited 2026-08-26 across all 50 shared files:
#   · 20 identical, 30 differing
#   · ZERO functions exist only in the iOS copy
#   · root has >= Capacitor/native references in EVERY shared file
#   · the only two iOS-only symbols, reminderGreetingName and cardChargesHtml,
#     are functions root DELETED on purpose (a77005c, eafffb4)
#   · the ~226 remaining iOS-only lines are line-level remnants of older
#     implementations root rewrote (e.g. gm.js's Portuguese display-string
#     stage map, replaced by the key-based one)
#
# Root is a superset. The 73-line block missing from 23 iOS pages is a
# Capacitor-gated JS error hook -- iOS debugging code that currently exists
# only in the copy where it can never run.
#
# cordova.js and cordova_plugins.js exist ONLY in the iOS bundle and are
# Capacitor-generated. This script never touches them: it copies only files
# that already exist in BOTH places.
#
# Rollback: git reset --hard pre-ios-resync-2026-08-26
# ---------------------------------------------------------------------------
set -e
cd "$(git rev-parse --show-toplevel)"
IOS=ios/App/App/public
[ -d "$IOS" ] || { echo "No $IOS -- nothing to do."; exit 1; }

N=0
git ls-files "$IOS" | sed "s|^$IOS/||" | while read -r f; do
  [ -f "$f" ] || continue                 # iOS-only file: leave alone
  cmp -s "$f" "$IOS/$f" && continue       # already identical
  mkdir -p "$(dirname "$IOS/$f")"
  cp "$f" "$IOS/$f"
  echo "  synced  $f"
done

# Give the wrapper its own fresh cache key. Its bundle is separate from the
# web one and has an independent cache, so it does NOT need to match root --
# it just must CHANGE, or a cache-first service worker serves the old files
# forever. (That exact trap was hit earlier today.)
STAMP=$(date +%s)
for H in "$IOS"/*.html; do
  [ -f "$H" ] || continue
  sed -i '' -E 's|(["/])(gm\.js|gm\.css|calendar-grid\.js|calendar-grid\.css|gm-labels\.js|scheduling-queue\.js|scheduling-queue\.css|template-edit\.js|template-edit\.css|native-bridge\.js)(\?v=[0-9]+)?(["#])|\1\2?v='"$STAMP"'\4|g' "$H"
done
[ -f "$IOS/sw.js" ] && sed -i '' -E 's/apex-static-[a-z0-9]+/apex-static-'"$STAMP"'/' "$IOS/sw.js"
[ -f "$IOS/version.json" ] && printf '{"version": "%s"}\n' "$STAMP" > "$IOS/version.json"

echo ""
echo "iOS bundle re-synced and stamped $STAMP."
echo "Review with:  git diff --stat $IOS"
echo "Roll back with:  git reset --hard pre-ios-resync-2026-08-26"
