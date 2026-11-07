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
# Ordinary tabs must also be selected again by the real profile picker.
tap_label() {
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  adb exec-out cat /sdcard/ui.xml > "$OUT/retention-ui.xml"
  python3 - "$OUT/retention-ui.xml" "$1" <<'TAP'
import re, subprocess, sys, xml.etree.ElementTree as ET
for node in ET.parse(sys.argv[1]).iter('node'):
    if sys.argv[2] in (node.get('text'), node.get('content-desc')):
        x1, y1, x2, y2 = map(int, re.findall(r'\d+', node.get('bounds', '')))
        subprocess.run(['adb', 'shell', 'input', 'tap', str((x1+x2)//2), str((y1+y2)//2)], check=True)
        break
else:
    raise SystemExit('Missing UI action: ' + sys.argv[2])
TAP
}
for id in 8 9; do
  adb shell am start -n "$PKG/ru.multibrowser.BrowserActivity" --ei profile "$id" --es action new_tab --es url "http://localhost:8767/page?id=10$id" >/dev/null
  sleep 3
  adb shell input text "draft10$id"
  adb shell input keyevent 4
  sleep 1
done
for id in 8 9; do
  tap_label "Switch profile"
  sleep 1
  tap_label "Profile $id"
  sleep 2
  adb shell run-as "$PKG" cat shared_prefs/profiles.xml > "$OUT/retention-profile-$id.xml"
  adb exec-out screencap -p > "$OUT/profile-ordinary-retained-$id.png"
done
python3 - "$OUT" <<'PY'
import json, sys, urllib.request, xml.etree.ElementTree as ET
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
    for profile in (8, 9):
        root = ET.parse(out / f'retention-profile-{profile}.xml').getroot()
        strings = {n.get('name'): n.text for n in root.findall('string')}
        ints = {n.get('name'): n.get('value') for n in root.findall('int')}
        selected = strings.get(f'last_pin_{profile}', '')
        item = state.get(f'10{profile}', {})
        good = (selected.startswith('tab') and strings.get('pin') == selected
                and ints.get('last_profile') == str(profile)
                and item.get('loads') == 1 and item.get('value') == f'draft10{profile}')
        line = f'{"ok  " if good else "FAIL"} Picker returns to profile {profile} ordinary tab and draft: {item}\n'
        print(line, end='')
        report.write(line)
        failed |= not good
sys.exit(1 if failed else 0)
PY
