#!/usr/bin/env bash
# Pull the latest code from GitHub and restart the site.
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only origin main
npm install --omit=dev
pm2 restart irish-weather --update-env
