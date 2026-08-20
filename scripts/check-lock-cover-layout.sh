#!/bin/sh
# Render the biometric cover's recovery screen at eight device/text
# combinations and assert nothing overlaps, nothing overflows, and the group is
# vertically centred.
#
# WHY: the wordmark was centred in the window while the recovery stack was
# centred independently at +40pt, so once the recovery UI appeared they occupied
# the same space -- the wordmark sat on top of the message and the first button.
# This is the screen a user sees when everything else has failed, and it is
# unreachable in normal testing (it needs a 12s stall), so it is worth checking
# mechanically rather than by eye.
#
# The harness mirrors ApexLockCover.show() + showRecovery() and runs the REAL
# Auto Layout engine in a simulator. It also writes PNGs to /tmp/cover_*.png so
# the result can be looked at, not just asserted.
#
# Keep lock-cover-layout-test.swift in sync when the cover's layout changes.
#
# Usage:  sh scripts/check-lock-cover-layout.sh
set -e
ROOT=$(cd "$(dirname "$0")" && pwd)
SDK=$(xcrun --sdk iphonesimulator --show-sdk-path)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

xcrun swiftc -sdk "$SDK" -target arm64-apple-ios15.0-simulator \
  -emit-executable -o "$WORK/LayoutTest" "$ROOT/lock-cover-layout-test.swift"

DEV=$(xcrun simctl list devices available | grep -E "iPhone" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')
[ -z "$DEV" ] && { echo "No iPhone simulator available"; exit 1; }
xcrun simctl boot "$DEV" 2>/dev/null || true
# Give a cold simulator time to come up.
xcrun simctl bootstatus "$DEV" -b >/dev/null 2>&1 || sleep 8

xcrun simctl spawn "$DEV" "$WORK/LayoutTest"
