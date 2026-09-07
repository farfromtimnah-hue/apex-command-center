#!/bin/sh
# Build the iOS app and upload it to TestFlight. One command, no clicks, no 2FA.
#
# Internal testers (Nicole, Alice, Rafa) get the build as soon as Apple finishes
# processing it -- usually a few minutes. There is NO beta review for internal
# testers, ever. Only external testers are reviewed.
#
# ONE-TIME SETUP, before this script works:
#   1. App Store Connect -> Users and Access -> Integrations -> App Store Connect
#      API -> Team Keys -> Generate API Key. Role must be App Manager; Developer
#      cannot upload. It must be a TEAM key, not an Individual key -- individual
#      keys cannot touch the provisioning endpoints that -allowProvisioningUpdates
#      needs.
#   2. Download the .p8. IT DOWNLOADS EXACTLY ONCE and Apple keeps no copy.
#      Save it to ~/.appstoreconnect/private_keys/AuthKey_<KEYID>.p8
#   3. Note the Key ID and the Issuer ID (the UUID above the key table), and put
#      them in the two lines below.
#
# Everything after that is: sh scripts/ship-ios.sh

set -e

KEY_ID="PUT_KEY_ID_HERE"
ISSUER_ID="PUT_ISSUER_ID_HERE"

KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_${KEY_ID}.p8"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
ARCHIVE="$REPO/build/App.xcarchive"

if [ "$KEY_ID" = "PUT_KEY_ID_HERE" ]; then
  echo "ERROR: edit scripts/ship-ios.sh and set KEY_ID and ISSUER_ID first."
  echo "See the one-time setup notes at the top of this file."
  exit 1
fi

if [ ! -f "$KEY_PATH" ]; then
  echo "ERROR: no API key at $KEY_PATH"
  echo "The .p8 downloads only once from App Store Connect. If it is lost,"
  echo "revoke that key and generate a new one."
  exit 1
fi

echo "==> Rebuilding www/ and syncing it into the iOS project"
# www/ is what Capacitor actually builds from, it is gitignored, and NOTHING
# regenerates it automatically. It has silently gone two weeks stale before and
# shipped old web code against new native code. Never skip this.
sh "$REPO/scripts/build-webdir.sh"
cd "$REPO" && npx cap sync ios

echo "==> Archiving"
rm -rf "$ARCHIVE"
xcodebuild -project "$REPO/ios/App/App.xcodeproj" \
  -scheme App \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  archive \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$KEY_PATH" \
  -authenticationKeyID "$KEY_ID" \
  -authenticationKeyIssuerID "$ISSUER_ID"

echo "==> Uploading to TestFlight"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$REPO/ios/ExportOptions.plist" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$KEY_PATH" \
  -authenticationKeyID "$KEY_ID" \
  -authenticationKeyIssuerID "$ISSUER_ID"

echo ""
echo "==> Uploaded. Apple is processing it now."
echo "    Internal testers get it when processing finishes, with no review."
echo "    Nothing else to do."
