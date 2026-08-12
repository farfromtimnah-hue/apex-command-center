#!/bin/sh
# Verify every app-target Swift file is actually REGISTERED in App.xcodeproj.
#
# WHY: ApexLockCoverPlugin.swift was created on disk, committed, and shipped in
# a build that did not contain it -- costing a full device cycle. The project
# uses objectVersion 60 with a manual file list and no
# PBXFileSystemSynchronizedRootGroup, so a new file is NEVER picked up
# automatically. A file needs FOUR entries: PBXBuildFile, PBXFileReference,
# PBXGroup child, and PBXSourcesBuildPhase.
#
# Usage:  sh scripts/check-xcodeproj.sh
set -e
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PBX="$ROOT/ios/App/App.xcodeproj/project.pbxproj"
SRC="$ROOT/ios/App/App"
FAIL=0

for f in "$SRC"/*.swift; do
  base=$(basename "$f")
  n=$(grep -c "$base" "$PBX" || true)
  if [ "$n" -lt 4 ]; then
    echo "FAIL  $base has only $n reference(s) in project.pbxproj (needs 4)"
    FAIL=1
  else
    echo "ok    $base ($n references)"
  fi
done

if [ "$FAIL" -ne 0 ]; then
  echo ""
  echo "A Swift file on disk but not in the project compiles into NOTHING."
  echo "Add it in Xcode (drag into the App group, check the App target), or"
  echo "mirror the four entries an existing file has."
  exit 1
fi
echo "OK - every app Swift file is registered in the Xcode project"
