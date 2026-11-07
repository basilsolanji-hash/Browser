#!/usr/bin/env bash
# Invoked by acceptance.sh after onboarding; only a loopback fixture is used.
set -eu
OUT=${OUT:-results}
PKG=${PKG:-ru.multibrowser.test}
python3 .github/scripts/fixtures/profile-retention.py > "$OUT/profile-retention-server.log" 2>&1 &
retention_pid=$!
trap 'kill "$retention_pid" 2>/dev/null || true' EXIT
adb reverse tcp:8767 tcp:8767
sleep 1
for id in 8 9 10 11 12 13 14; do
  adb shell am start -n "$PKG/ru.multibrowser.BrowserActivity" --ei profile "$id" --es site gmail --es url "http://localhost:8767/page?id=$id" >/dev/null
  sleep 4
  adb shell input text "draft$id"
  adb shell input keyevent 4
  sleep 1
done
for id in 8 9 10 11 12 13 14; do
  # No URL: returning must reuse the existing document, never navigate again.
  adb shell am start -n "$PKG/ru.multibrowser.BrowserActivity" --ei profile "$id" --es site gmail >/dev/null
  sleep 2
  adb exec-out screencap -p > "$OUT/profile-retained-$id.png"
done
python3 - "$OUT" <<'PY'
import json, sys, urllib.request
from pathlib import Path
out = Path(sys.argv[1])
state = json.load(urllib.request.urlopen('http://127.0.0.1:8767/snapshot', timeout=10))
(out / 'profile-retention.json').write_text(json.dumps(state, indent=2))
failed = False
with (out / 'checks.txt').open('a') as report:
    for profile in range(8, 15):
        item = state.get(str(profile), {})
        good = item.get('loads') == 1 and item.get('value') == f'draft{profile}'
        line = f'{"ok  " if good else "FAIL"} Profile {profile}: one document load and draft retained: {item}\n'
        print(line, end='')
        report.write(line)
        failed |= not good
sys.exit(1 if failed else 0)
PY
