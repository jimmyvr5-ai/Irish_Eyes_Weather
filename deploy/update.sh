#!/usr/bin/env bash
# Pull the latest code from GitHub and restart the site.
# Usage on the server: ~/irish-weather/deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only origin main
if command -v npm >/dev/null; then npm install --omit=dev; fi
docker restart irish-weather
echo "Updated. Check https://weather.techx1.com"
