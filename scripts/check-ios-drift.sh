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
  # Already staged alongside -- the normal, correct case.
  echo "$STAGED" | grep -qx "$COUNTERPART" && continue
  # Not staged, but the iOS copy ALREADY matches what is being committed.
  # This is root catching up TO iOS, not iOS falling behind, and it is a real
  # case: a hook that rewrites both copies can land one of them a commit
  # earlier. Comparing against the STAGED content (git show :FILE), not the
  # working tree, so an unstaged edit cannot make this look clean.
  if git show ":$F" 2>/dev/null | cmp -s - "$COUNTERPART"; then continue; fi
  MISSING="$MISSING $F"
done

# ---------------------------------------------------------------------------
# www/ -- THE COPY CAPACITOR ACTUALLY BUILDS FROM.
#
# capacitor.config.json sets webDir: "www". `npx cap sync ios` copies www/ ->
# ios/App/App/public/, so the check above guards the DESTINATION while this
# guards the SOURCE. Getting the destination right means nothing if the next
# sync overwrites it from a stale source.
#
# www/ is GITIGNORED, which is exactly why this was invisible: the hook and the
# CI drift job both work off staged paths, and an ignored directory is never
# staged. On 2026-09-04 the guard passed green all day on four commits while
# www/finance-new.html sat 16 hours behind, and the change simply was not in
# the app. That is the same class of bug the header above describes -- "nobody
# remembered" -- so it gets the same treatment: block, do not warn.
#
# Content comparison IS right here, unlike above: www/ is generated output,
# never hand-edited, so identical is precisely the correct test.
# ---------------------------------------------------------------------------
WWW_STALE=""
if [ -d "www" ]; then
  for F in $STAGED; do
    case "$F" in
      "$IOS_DIR"/*) continue ;;
      ios/*)        continue ;;
      www/*)        continue ;;
    esac
    [ -f "www/$F" ] || continue
    git show ":$F" 2>/dev/null | cmp -s - "www/$F" && continue
    WWW_STALE="$WWW_STALE $F"
  done
fi

if [ -n "$WWW_STALE" ]; then
  printf '\n'
  printf '  ============================================================\n'
  printf '   COMMIT BLOCKED -- www/ is stale (the iOS app builds from it)\n'
  printf '  ============================================================\n\n'
  printf '  capacitor.config.json sets webDir: "www", so www/ is what the iOS\n'
  printf '  app is actually built from. These files differ from it:\n\n'
  for F in $WWW_STALE; do printf '     %s\n' "$F"; done
  printf '\n'
  printf '  www/ is generated, never hand-edited. Regenerate and re-sync:\n\n'
  printf '     sh scripts/build-webdir.sh && npx cap sync ios\n\n'
  printf '  (or: npm run sync, which does both), then commit again.\n\n'
  printf '  If this change genuinely should NOT reach the app:\n'
  printf '     SKIP_IOS_DRIFT=1 git commit ...\n\n'
  exit 1
fi

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
