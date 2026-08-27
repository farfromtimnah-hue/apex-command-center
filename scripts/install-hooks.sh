#!/bin/sh
# Points git at this repo's TRACKED hooks directory.
#
# This used to COPY scripts/pre-commit into .git/hooks/. That was the weak
# link: .git/hooks/ is not tracked, so a fresh clone silently had no hooks at
# all, and the safeguard was only as good as somebody remembering to run this.
#
# core.hooksPath makes the tracked scripts/ directory the hooks directory
# itself, so editing scripts/pre-commit takes effect immediately and there is
# nothing to keep in sync. (Git only executes files named after real hooks, so
# the other scripts here are ignored.)
#
# It is still a LOCAL git setting and still does not survive a clone -- which
# is exactly why the authoritative iOS drift check is the GitHub Actions
# workflow in .github/workflows/ios-drift.yml. That one is tracked, runs on
# every push, and needs nothing installed anywhere. This is fast local
# feedback; CI is the guarantee.
REPO_ROOT=$(git rev-parse --show-toplevel)
git -C "$REPO_ROOT" config core.hooksPath scripts
chmod +x "$REPO_ROOT/scripts/pre-commit" "$REPO_ROOT/scripts/check-ios-drift.sh"
echo "core.hooksPath -> scripts/  (tracked; no copy step)"
