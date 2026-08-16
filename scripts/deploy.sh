#!/bin/sh
# Deploy apex-api, then prove the vault read gate still holds.
#
#   ./scripts/deploy.sh
#
# The order matters. The read-only test fires at the DEPLOYED Worker over the
# real network, so it has to run AFTER wrangler deploy — it is verifying what
# is actually serving traffic, not what is in the working tree.
#
# This exists because the guarantee it checks is invisible in normal use. Every
# read endpoint keeps working perfectly if someone deletes the gate; the only
# thing that changes is that a write becomes possible. Nobody would notice from
# the UI. So it gets checked on every single deploy, not once.
#
# VAULT_SERVICE_TOKEN must be set in the environment (the same value held as a
# Worker secret). Without it the test refuses to run rather than 401-ing its way
# to a false pass.
set -e

cd "$(dirname "$0")/.."

echo "==> wrangler deploy"
npx wrangler deploy

echo ""
echo "==> verifying the vault read gate against the deployed Worker"
node scripts/test-vault-readonly.mjs

echo ""
echo "Deployed and verified."
