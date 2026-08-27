#!/bin/sh
# ---------------------------------------------------------------------------
# iOS drift guard.
#
# THE PROBLEM THIS EXISTS FOR
# ios/App/App/public/ is a REAL third copy of the frontend, not build output.
# It is genuinely diverged: it carries gmCallHref(), the OpenPhone deep link,
# which does not exist in the root copy. So it can never be fixed by copying
# root over it -- that would silently delete the dialer. Every change has to be
# HAND-PORTED.
#
# Which means the failure mode is not "the copy is wrong", it is "nobody
# remembered". A note in the vault does not help: the whole problem is that the
# step gets skipped without anyone noticing, and the app then ships weeks
# behind the web while looking fine. THIS BLOCKS THE COMMIT INSTEAD.
#
# WHAT IT CHECKS
# For every file that exists in BOTH root and ios/App/App/public/: if the root
# copy is staged and the iOS copy is not, stop and name it. Files that live in
# only one of the two places are ignored entirely -- this never invents work.
#
# It deliberately does NOT diff contents. The two copies are SUPPOSED to
# differ, so "identical" is the wrong test and would cry wolf on every commit.
# The real question is "did this change get considered for iOS", and staging
# the iOS file is the answer.
#
# ESCAPE HATCH
#   SKIP_IOS_DRIFT=1 git commit ...
# For the genuine web-only change. Use it as an actual decision, not a reflex:
# every use is a change the app will not have.
# ---------------------------------------------------------------------------

IOS_DIR="ios/App/App/public"
[ -d "$IOS_DIR" ] || exit 0

if [ "$SKIP_IOS_DRIFT" = "1" ]; then
  printf '\n  [ios-drift] SKIPPED via SKIP_IOS_DRIFT=1 -- the app will not have this change.\n\n'
  exit 0
fi

STAGED=$(git diff --cached --name-only)
MISSING=""

for F in $STAGED; do
  # Only root-level paths have an iOS counterpart worth checking.
  case "$F" in
    "$IOS_DIR"/*) continue ;;
    ios/*)        continue ;;
  esac
  COUNTERPART="$IOS_DIR/$F"
  # Only files that ALREADY exist in both copies. A new root-only file is not
  # drift -- it is simply not part of the wrapper bundle yet, and deciding
  # whether it should be is a human call, not a hook's.
  [ -f "$COUNTERPART" ] || continue
  if ! echo "$STAGED" | grep -qx "$COUNTERPART"; then
    MISSING="$MISSING $F"
  fi
done

[ -n "$MISSING" ] || exit 0

printf '\n'
printf '  ============================================================\n'
printf '   COMMIT BLOCKED -- iOS copy would be left behind\n'
printf '  ============================================================\n\n'
printf '  These files changed at root but their iOS copy did not:\n\n'
for F in $MISSING; do printf '     %s\n' "$F"; done
printf '\n'
printf '  ios/App/App/public/ is a diverged copy (it holds the OpenPhone\n'
printf '  deep link that root does not have), so do NOT copy root over it.\n'
printf '  Hand-port the same edits, then stage the iOS file too:\n\n'
for F in $MISSING; do printf '     git add -u %s/%s\n' "$IOS_DIR" "$F"; done
printf '\n'
printf '  Use "git add -u" (tracked files only), never "git add -f".\n\n'
printf '  If this change genuinely should NOT reach the app:\n'
printf '     SKIP_IOS_DRIFT=1 git commit ...\n\n'
exit 1
