# apex-command-center

## Setup

After cloning, run `scripts/install-hooks.sh` to install the pre-commit hook
that stamps `sw.js`'s `CACHE_NAME` and `version.json` on relevant commits
(keeps the service worker from silently serving stale pages — see comments
in `scripts/pre-commit`).

Slack integration verified 2026-07-28.
