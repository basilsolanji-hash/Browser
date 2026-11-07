#!/usr/bin/env bash
# Invoked by acceptance.sh after onboarding; only a loopback fixture is used.
set -eu
OUT=${OUT:-results}
PKG=${PKG:-ru.multibrowser.test}
mkdir -p "$OUT"
retention_run=$(python3 -c 'import secrets; print(secrets.token_hex(16))')
export PROFILE_RETENTION_RUN="$retention_run"
python3 .github/scripts/fixtures/profile-retention.py > "$OUT/profile-retention-server.log" 2>&1 &
retention_pid=$!
trap 'kill "$retention_pid" 2>/dev/null || true' EXIT
adb reverse tcp:8767 tcp:8767
# Bounded readiness/state polling instead of guessing software-emulator timings.
wait_state() {
  python3 - "$1" "$2" <<'WAIT'
import json, sys, time, urllib.request
key, expected = sys.argv[1:]
deadline = time.monotonic() + 90
last = {}
while time.monotonic() < deadline:
    try:
        with urllib.request.urlopen('http://127.0.0.1:8767/snapshot', timeout=2) as response:
            last = json.load(response).get(key, {})
        good = last.get('loads') == 1 and last.get('ready') and last.get('visible')
        good = good and (last.get('focused') if expected == 'FOCUSED' else last.get('value') == expected)
        if good:
            break
    except (OSError, ValueError):
        pass
    time.sleep(.5)
else:
    raise SystemExit(f'Fixture did not reach expected state {key}/{expected}: {last}')
WAIT
}
# DOM autofocus alone does not route Android IME keys to the web input.
tap_draft() {
  python3 - "$OUT" <<'FOCUS'
import re, subprocess, sys, xml.etree.ElementTree as ET
from pathlib import Path
for attempt in range(4):
    subprocess.run(['adb','shell','uiautomator','dump','/sdcard/retention-focus.xml'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=30)
    content=subprocess.check_output(['adb','exec-out','cat','/sdcard/retention-focus.xml'],timeout=30)
    Path(sys.argv[1],'retention-focus.xml').write_bytes(content)
    for node in ET.fromstring(content).iter('node'):
        if "System UI" in node.get('text','') and "responding" in node.get('text',''):
            raise SystemExit('BLOCKED: System UI is unresponsive')
        if node.get('resource-id','').split('/')[-1] != 'draft': continue
        bounds=list(map(int,re.findall(r'\d+',node.get('bounds',''))))
        if len(bounds)==4 and bounds[2]>bounds[0] and bounds[3]>bounds[1]:
            subprocess.run(['adb','shell','input','tap',str((bounds[0]+bounds[2])//2),str((bounds[1]+bounds[3])//2)],check=True,timeout=30)
            raise SystemExit(0)
raise SystemExit('Missing accessible draft input')
FOCUS
}
for id in 8 9 10 11 12 13 14; do
  adb shell am start -n "$PKG/ru.multibrowser.BrowserActivity" --ei profile "$id" --es site gmail --es url "http://localhost:8767/page/$retention_run?id=$id" >/dev/null
  wait_state "$id" FOCUSED
  tap_draft
  adb shell input text "draft$id"
  wait_state "$id" "draft$id"
  adb shell input keyevent 4
done
for id in 8 9 10 11 12 13 14; do
  # No URL: returning must reuse the existing document, never navigate again.
  adb shell am start -n "$PKG/ru.multibrowser.BrowserActivity" --ei profile "$id" --es site gmail >/dev/null
  wait_state "$id" "draft$id"
  adb exec-out screencap -p > "$OUT/profile-retained-$id.png"
done
# Ordinary tabs must also be selected again by the real profile picker.
tap_label() {
  python3 - "$1" "$OUT" <<'TAP'
import re, subprocess, sys, time, xml.etree.ElementTree as ET
from pathlib import Path
label, out = sys.argv[1:]
for attempt in range(8):
    subprocess.run(['adb','shell','uiautomator','dump','/sdcard/ui.xml'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    content=subprocess.check_output(['adb','exec-out','cat','/sdcard/ui.xml'])
    Path(out,'retention-ui.xml').write_bytes(content)
    for node in ET.fromstring(content).iter('node'):
        if label in (node.get('text'), node.get('content-desc')):
            bounds=list(map(int,re.findall(r'\d+',node.get('bounds',''))))
            if len(bounds)!=4: continue
            x1,y1,x2,y2=bounds
            if x2<=x1 or y2<=y1: continue
            subprocess.run(['adb','shell','input','tap',str((x1+x2)//2),str((y1+y2)//2)],check=True)
            raise SystemExit(0)
    # Main list and picker can scroll; keep the search finite and inside the content area.
    size=list(map(int,re.findall(r'\d+',subprocess.check_output(['adb','shell','wm','size'],text=True))))[-2:]
    width,height=size
    subprocess.run(['adb','shell','input','swipe',str(width//2),str(height*3//4),str(width//2),str(height//3),'400'],check=True)
    time.sleep(.5)
raise SystemExit('Missing UI action: '+label)
TAP
}
for id in 8 9; do
  adb shell am start -n "$PKG/ru.multibrowser.BrowserActivity" --ei profile "$id" --es action new_tab --es url "http://localhost:8767/page/$retention_run?id=10$id" >/dev/null
  wait_state "10$id" FOCUSED
  tap_draft
  adb shell input text "draft10$id"
  wait_state "10$id" "draft10$id"
  adb shell input keyevent 4
done
for id in 8 9; do
  tap_label "Switch profile"
  sleep 1
  tap_label "Profile $id"
  wait_state "10$id" "draft10$id"
  adb shell run-as "$PKG" cat shared_prefs/profiles.xml > "$OUT/retention-profile-$id.xml"
  adb exec-out screencap -p > "$OUT/profile-ordinary-retained-$id.png"
done
# Return from MainActivity in both list and tile layouts, not only its browser picker.
for layout in list grid; do
  for id in 8 9; do
    adb shell am start -n "$PKG/ru.multibrowser.MainActivity" >/dev/null
    if [ "$layout" = list ]; then tap_label "Show as list"; else tap_label "Show as tiles"; fi
    tap_label "Profile $id"
    wait_state "10$id" "draft10$id"
    adb shell run-as "$PKG" cat shared_prefs/profiles.xml > "$OUT/retention-main-$layout-$id.xml"
    adb exec-out screencap -p > "$OUT/profile-main-$layout-$id.png"
  done
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
    for layout in ('list', 'grid'):
        for profile in (8, 9):
            root = ET.parse(out / f'retention-main-{layout}-{profile}.xml').getroot()
            strings = {n.get('name'): n.text for n in root.findall('string')}
            ints = {n.get('name'): n.get('value') for n in root.findall('int')}
            selected = strings.get(f'last_pin_{profile}', '')
            item = state.get(f'10{profile}', {})
            good = (selected.startswith('tab') and strings.get('pin') == selected
                    and ints.get('last_profile') == str(profile)
                    and item.get('loads') == 1 and item.get('value') == f'draft10{profile}')
            line = f'{"ok  " if good else "FAIL"} Main {layout} returns to profile {profile} ordinary tab: {item}\n'
            print(line, end='')
            report.write(line)
            failed |= not good
sys.exit(1 if failed else 0)
PY
