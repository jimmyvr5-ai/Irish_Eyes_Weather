#!/usr/bin/env bash
# Pull the latest code from GitHub and restart the site.
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only origin main
if docker ps --format '{{.Names}}' | grep -qx irish-weather; then
  docker restart irish-weather
else
  npm install --omit=dev
  pm2 restart irish-weather --update-env
fi
