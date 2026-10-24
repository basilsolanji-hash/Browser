#!/usr/bin/env bash
# Приёмочные сценарии на эмуляторе: скриншоты и журналы складываются в results/.
set -u
PKG=ru.multibrowser.test
OUT=results
mkdir -p "$OUT"

adb install -r app/build/outputs/apk/debug/app-debug.apk
for a in window_animation_scale transition_animation_scale animator_duration_scale; do
  adb shell settings put global "$a" 0
done
adb logcat -c

shot() { sleep "$2"; adb exec-out screencap -p > "$OUT/$1.png"; echo "shot $1"; }
browser() { adb shell am start -n "$PKG/ru.multibrowser.BrowserActivity" "$@"; }

adb shell am start -n "$PKG/ru.multibrowser.MainActivity";              shot 01-main 10
browser --ei profile 3 --es site GMAIL --es url https://example.com;    shot 02-example 40
browser --ei profile 3 --es site GMAIL --es url https://ru.wikipedia.org; shot 03-wikipedia 25
browser --ei profile 1 --es site GMAIL;                                 shot 04-p1-gmail 35
browser --ei profile 1 --es site CLAUDE;                                shot 05-p1-claude 40
browser --ei profile 2 --es site CLAUDE;                                shot 06-p2-claude 35
adb shell am start -n "$PKG/ru.multibrowser.SettingsActivity";          shot 07-settings 6
adb shell am start -n "$PKG/ru.multibrowser.MainActivity";              shot 08-main-after 6

adb logcat -d -v time > "$OUT/logcat.txt"
grep -E "OsDiag|GeckoConsole|AndroidRuntime|FATAL|Gecko" "$OUT/logcat.txt" | tail -600 > "$OUT/diag.txt"
exit 0
