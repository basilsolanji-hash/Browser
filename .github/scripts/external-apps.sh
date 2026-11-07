#!/usr/bin/env bash
# Local/device acceptance. No Actions, APK build/install, phone calls or SMS.
set -eu
cd "$(dirname "$0")/../.."
exec python3 .github/scripts/external-apps.py "$@"
