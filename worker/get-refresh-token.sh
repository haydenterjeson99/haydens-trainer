#!/bin/bash
# One-time helper: exchanges a Strava authorization code for a refresh token.
# Run this yourself — it only ever touches your own terminal, never sends
# anything back to Claude.
set -e

read -p "Strava Client ID: " CID
read -s -p "Strava Client Secret (hidden): " CSEC
echo
read -p "Authorization code (from the localhost redirect just now): " CODE

echo
echo "Exchanging with Strava..."
curl -s -X POST https://www.strava.com/oauth/token \
  -d client_id="$CID" \
  -d client_secret="$CSEC" \
  -d code="$CODE" \
  -d grant_type=authorization_code
echo
echo
echo "Copy the refresh_token value above — you'll need it for:"
echo "  npx wrangler secret put STRAVA_REFRESH_TOKEN"
