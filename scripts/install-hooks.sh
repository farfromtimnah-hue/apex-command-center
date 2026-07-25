#!/bin/sh
# Installs this repo's git hooks. Hooks in .git/hooks/ are untracked and do
# not survive a fresh clone — run this once after cloning.
REPO_ROOT=$(git rev-parse --show-toplevel)
cp "$REPO_ROOT/scripts/pre-commit" "$REPO_ROOT/.git/hooks/pre-commit"
chmod +x "$REPO_ROOT/.git/hooks/pre-commit"
echo "Installed pre-commit hook."
