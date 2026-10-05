#!/bin/sh
# ---------------------------------------------------------------------------
# No browser pop-ups (Rule 31).
#
# Fails when any .html or .js file at the ROOT of the repo calls the browser's
# confirm(), alert() or prompt() (or the window. forms). Comment lines are
# ignored. A confirmation is an in-page card (pageDialog on the staff pages,
# gmAsk in gm.js); a message is pageNotice. A browser box cannot be styled,
# blocks the page, is silently suppressed in some in-app browsers, and is the
# first thing a client sees go wrong.
#
# Used by two callers so nobody has to remember to run it:
#   scripts/pre-commit                  (every local commit)
#   .github/workflows/ios-drift.yml     (every push)
# Run it by hand with:  sh scripts/check-no-popups.sh
#
# A method on an object (deps.confirm(), x.alert()) is not the browser box, so
# a match needs a character before the name that is not a letter, digit, _, .
# or $ -- except the explicit window. form, which is caught.
# Only root files are checked: worker/ and ios/ are not part of this rule.
# ---------------------------------------------------------------------------
FOUND=0
for F in ./*.html ./*.js; do
  [ -f "$F" ] || continue
  F=${F#./}
  HITS=$(grep -nE '(^|[^A-Za-z0-9_.$])(window\.)?(confirm|alert|prompt)\(' "$F" \
    | grep -vE '^[0-9]+:[[:space:]]*(//|\*|/\*|<!--)')
  [ -n "$HITS" ] || continue
  if [ "$FOUND" = "0" ]; then
    printf '\n  ============================================================\n'
    printf '   BROWSER POP-UP FOUND -- not allowed on this site\n'
    printf '  ============================================================\n\n'
  fi
  FOUND=1
  echo "$HITS" | while IFS= read -r LINE; do
    N=${LINE%%:*}
    TEXT=${LINE#*:}
    printf '  %s:%s: %s\n' "$F" "$N" "$(printf '%s' "$TEXT" | sed -E 's/^[[:space:]]+//' | cut -c1-110)"
    printf '      Use pageDialog / gmAsk instead (Rule 31: no browser pop-ups)\n'
  done
done
if [ "$FOUND" = "1" ]; then
  printf '\n  Questions: pageDialog({message, yes, keep, onYes}) or gmAsk(...).\n'
  printf '  Messages: pageNotice(text). See scripts/test-page-dialog.mjs.\n\n'
  exit 1
fi
exit 0
