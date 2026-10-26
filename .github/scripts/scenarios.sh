#!/usr/bin/env bash
# Матрица сценариев на эмуляторе (4 части параллельно, аргумент — номер части 1..4).
# Каждый сценарий: действие → скриншот → проверки (нет падения, экран не пустой, ожидаемое
# состояние). Итог построчно в results/checks.txt: «ok …» / «FAIL …»; любой FAIL роняет прогон.
set -u
SHARD="${1:-1}"
PKG=ru.multibrowser.test
OUT=results
mkdir -p "$OUT"
exec > >(tee -a "$OUT/steps.txt") 2>&1

adb install -r app/build/outputs/apk/debug/app-debug.apk
# Ни одна команда adb не висит дольше 60 с (зависший uiautomator или запуск на тяжёлом сайте
# раньше останавливал всю часть до общего лимита времени); зависание помечается в steps.txt.
ADB_BIN=$(command -v adb)
adb() {
  timeout 60 "$ADB_BIN" "$@"; local rc=$?
  [ $rc = 124 ] && echo "TIMEOUT: adb $*" >&2
  return $rc
}
for a in window_animation_scale transition_animation_scale animator_duration_scale; do adb shell settings put global "$a" 0; done
adb logcat -c; adb logcat -b crash -c

CHECKS="$OUT/checks.txt"; : > "$CHECKS"
N=0
ok()   { echo "ok   $*" >> "$CHECKS"; }
fail() { echo "FAIL $*" >> "$CHECKS"; }
check() { if eval "$2"; then ok "$1"; else fail "$1"; fi; }
# Снимок экрана. Если он завис (тяжёлый сайт с видео/WebGL вешает программный GPU эмулятора),
# перезапускаем приложение, чтобы следующие сценарии не падали цепочкой, и помечаем сценарий.
shot() {
  if ! adb exec-out screencap -p > "$OUT/$1.png"; then
    rm -f "$OUT/$1.png"; : > "$OUT/$1.hang"
    echo "GPU-HANG: $1 — графика эмулятора зависла, дальнейшие сайты пропускаются"
    # Перезагрузка эмулятора графику не оживляет (проверено) — не тратим время, помечаем остальное.
    GPU_HUNG=1
  fi
}
crashes() { adb logcat -b crash -d 2>/dev/null | grep -c "$PKG" || true; }
diag() { adb logcat -d -s OsDiag:I 2>/dev/null; }
start() { adb shell am start -W -n "$PKG/ru.multibrowser.$1" "${@:2}" >/dev/null 2>&1; }
stop() { adb shell am force-stop "$PKG"; }

# Сценарий: имя, затем команда. После — скриншот и проверка, что приложение не упало.
sc() {
  local name="$1"; shift
  N=$((N + 1))
  echo "== $name $(date +%T)"
  local before; before=$(crashes)
  eval "$@"
  shot "$name"
  local after; after=$(crashes)
  if [ "$after" = "$before" ]; then ok "$name: без падения"; else fail "$name: приложение упало"; fi
}

# Предустановленные настройки (язык, тема), обучение пройдено — экраны открываются сразу.
prefs() {
  local lang="$1" theme="$2"
  printf '%s\n' "<?xml version='1.0' encoding='utf-8' standalone='yes' ?>" "<map>" \
    "    <string name=\"lang\">$lang</string>" "    <string name=\"theme_id\">$theme</string>" "</map>" > /tmp/settings.xml
  printf '%s\n' "<?xml version='1.0' encoding='utf-8' standalone='yes' ?>" "<map>" \
    "    <boolean name=\"done\" value=\"true\" />" "</map>" > /tmp/onboarding.xml
  stop
  adb shell mkdir -p /data/local/tmp/os >/dev/null
  adb push /tmp/settings.xml /tmp/onboarding.xml /data/local/tmp/os/ >/dev/null
  adb shell chmod 644 /data/local/tmp/os/settings.xml /data/local/tmp/os/onboarding.xml
  adb shell run-as "$PKG" mkdir -p shared_prefs
  adb shell run-as "$PKG" cp /data/local/tmp/os/settings.xml /data/local/tmp/os/onboarding.xml shared_prefs/
}

# Тексты на экране (uiautomator) — для проверки перевода.
screen_text() { adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb shell cat /sdcard/ui.xml 2>/dev/null; }
# Перевод ключа из исходников (Tr*.kt), индекс языка как в Tr.idx.
tr_text() {
  python3 - "$1" "$2" <<'PY'
import sys, re, glob
key, lang = sys.argv[1], sys.argv[2]
idx = ["en","ru","es","pt","fr","de","ar","hi","tr","zh","be","uz","ky","tg","kk","hy"].index(lang)
for f in glob.glob("app/src/main/java/ru/multibrowser/Tr*.kt"):
    m = re.search(r'^\s+"' + re.escape(key) + r'" to listOf\((.*)\),?\s*$', open(f, encoding="utf-8").read(), re.M)
    if m:
        vals = re.findall(r'"((?:[^"\\]|\\.)*)"', m.group(1))
        # Как в дампе uiautomator: &, <, >, " экранированы.
        print(vals[idx].replace('\\$', '$').replace('\\"', '"').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')); break
PY
}
# Центр элемента по тексту/описанию.
find_xy() {
  screen_text > "$OUT/ui.xml"
  python3 - "$OUT/ui.xml" "$1" <<'PY'
import sys, re
xml = open(sys.argv[1], encoding='utf-8', errors='ignore').read(); want = sys.argv[2]
import html
want = html.escape(want, quote=True).replace("&#x27;", "'")
nodes = re.findall(r'<node [^>]*>', xml)
# Сначала точно, затем без учёта регистра (кнопки диалогов показываются заглавными).
for same in (lambda a: a == want, lambda a: a.lower() == want.lower()):
    hit = None
    for n in nodes:
        t = re.search(r' text="([^"]*)"', n); d = re.search(r'content-desc="([^"]*)"', n)
        if (t and same(t.group(1))) or (d and same(d.group(1))): hit = n; break
    if hit:
        b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', hit)
        x1, y1, x2, y2 = map(int, b.groups()); print((x1 + x2) // 2, (y1 + y2) // 2); break
PY
}
tap_text() { local xy; xy=$(find_xy "$1"); [ -n "$xy" ] && adb shell input tap $xy; }

# Локальный сервер для страниц-проверок (cookies, скачивание).
WEB=$(mktemp -d)
cp .github/scripts/scenario_server.py "$WEB/"
(cd "$WEB" && python3 scenario_server.py 8770 >/dev/null 2>&1) &
SRV=$!
adb reverse tcp:8770 tcp:8770

SCREENS="MainActivity AccountActivity SettingsActivity AboutActivity HelpActivity StatsActivity NotesActivity SavedPagesActivity DownloadsActivity BookmarksActivity SiteSettingsActivity SecurityCheckActivity OnboardingActivity"

case "$SHARD" in
1)  # --- Все экраны на 16 языках (и проверка перевода заголовков) ---
  for lang in en ru es pt fr de ar hi tr zh be uz ky tg kk hy; do
    prefs "$lang" scarlet_dark
    for s in $SCREENS; do sc "L-$lang-$s" "start $s; sleep 2"; done
    sc "L-$lang-Tabs" "start TabsActivity --ei profile 1; sleep 2"
    sc "L-$lang-Profile" "start ProfileActivity --ei profile 2; sleep 2"
    sc "L-$lang-Browser" "start BrowserActivity --ei profile 1 --es url os:start; sleep 6"
    for pair in "SettingsActivity:settings" "AboutActivity:about" "StatsActivity:stats" "HelpActivity:help_feedback"; do
      s=${pair%%:*}; key=${pair#*:}; want=$(tr_text "$key" "$lang")
      start "$s"; sleep 2
      check "L-$lang-$s: заголовок «$want»" 'screen_text | grep -qF "text=\"$want\""'
    done
  done
  ;;
2)  # --- 6 тем × экраны; ввод в адресную строку ---
  for theme in scarlet_dark scarlet_light graphite sand oled system; do
    prefs en "$theme"
    for s in MainActivity SettingsActivity AboutActivity StatsActivity; do sc "T-$theme-$s" "start $s; sleep 2"; done
    sc "T-$theme-Browser" "start BrowserActivity --ei profile 2 --es url os:start; sleep 6"
    sc "T-$theme-Tabs" "start TabsActivity --ei profile 2; sleep 2"
  done
  prefs en scarlet_dark
  start BrowserActivity --ei profile 3 --es url os:start; sleep 8
  while IFS='|' read -r input expected <&3; do
    [ -z "$input" ] && continue
    # Адресная строка (320×640: под полосой вкладок); при фокусе адрес выделяется — ввод его заменяет.
    type_url() {
      adb logcat -c
      adb shell input tap 160 99; sleep 2
      adb shell input text "$(printf '%s' "$input" | sed 's/ /%s/g')"
      adb shell input keyevent 66; sleep 6
    }
    type_url
    N=$((N + 1))
    if diag | grep -qF "начало: $expected"; then ok "A: «$input» → $expected"
    else
      # Тяжёлая страница ещё грузилась и забрала нажатие — одна повторная попытка, помечается отдельно.
      type_url
      check "A: «$input» → $expected (со второй попытки)" 'diag | grep -qF "начало: $expected"'
    fi
    shot "A-$(printf '%s' "$input" | tr -c 'a-zA-Z0-9.' '_')"
  done 3<<'CASES'
example.com|https://example.com/
https://example.org|https://example.org/
example.org/path|https://example.org/path
ru.wikipedia.org|https://ru.wikipedia.org/
en.m.wikipedia.org/wiki/Moon|https://en.m.wikipedia.org/wiki/Moon
hello|https://duckduckgo.com/?q=hello
hello world|https://duckduckgo.com/?q=hello+world
weather|https://duckduckgo.com/?q=weather
duckduckgo.com|https://duckduckgo.com/
news|https://duckduckgo.com/?q=news
1+1|https://duckduckgo.com/?q=1%2B1
claude.ai|https://claude.ai/
mozilla.org|https://mozilla.org/
openai com|https://duckduckgo.com/?q=openai+com
kotlin|https://duckduckgo.com/?q=kotlin
android 15|https://duckduckgo.com/?q=android+15
wikipedia.org|https://wikipedia.org/
localhost:8770/page|https://duckduckgo.com/?q=localhost%3A8770%2Fpage
# github.com — последним: его 3D-графика (WebGL) вешает программный GPU эмулятора целиком.
github.com|https://github.com/
CASES
  ;;
3)  # --- Популярные сайты: загрузка без падения и не пустой экран ---
  prefs en scarlet_dark
  # Сайты с тяжёлым видео/WebGL (вешают программный GPU эмулятора) — в конце, чтобы остальные проверялись.
  for u in https://example.com https://www.wikipedia.org https://en.m.wikipedia.org/wiki/Moon https://ru.wikipedia.org \
    https://duckduckgo.com https://www.mozilla.org https://gitlab.com https://stackoverflow.com \
    https://news.ycombinator.com https://www.reddit.com https://www.bbc.com https://www.reuters.com \
    https://www.theguardian.com https://www.nytimes.com https://www.cnn.com https://www.aljazeera.com \
    https://www.dw.com https://www.amazon.com https://www.ebay.com https://www.aliexpress.com https://www.etsy.com \
    https://www.booking.com https://www.airbnb.com https://www.tripadvisor.com https://maps.google.com \
    https://www.openstreetmap.org https://translate.google.com https://www.google.com https://www.bing.com \
    https://search.brave.com https://yandex.ru https://mail.google.com https://outlook.live.com https://proton.me \
    https://www.dropbox.com https://drive.google.com https://www.notion.so https://trello.com https://slack.com \
    https://zoom.us https://www.linkedin.com https://www.x.com https://www.instagram.com https://www.facebook.com \
    https://www.tiktok.com https://telegram.org https://web.whatsapp.com https://www.apple.com \
    https://www.microsoft.com https://www.samsung.com https://developer.android.com https://kotlinlang.org \
    https://www.python.org https://claude.ai https://www.lemonde.fr https://www.elpais.com https://www.spiegel.de \
    https://www.youtube.com https://vimeo.com https://www.twitch.tv https://github.com; do
    name="S-$(echo "$u" | sed 's#https\?://##; s#[^a-zA-Z0-9.]#_#g')"
    if [ "${GPU_HUNG:-0}" = 1 ]; then ok "$name: пропущен — графика эмулятора зависла раньше"; continue; fi
    # Каждые 6 тяжёлых сайтов — перезапуск Оси: программный GPU эмулятора иначе исчерпывает память и виснет.
    SITE_N=$(( ${SITE_N:-0} + 1 )); [ $(( SITE_N % 6 )) = 0 ] && { stop; sleep 2; }
    adb logcat -c
    sc "$name" "start BrowserActivity --ei profile 4 --es url $u; sleep 14"
    if [ -e "$OUT/$name.hang" ]; then ok "$name: пропущен — эмулятор завис на графике сайта"; continue; fi
    if ! diag | grep -q "начало: http"; then
      # Диагностика сбоя: что на экране (окно «не отвечает»?), журнал приложения и движка.
      { adb shell dumpsys window | grep -E "mCurrentFocus|mFocusedApp"; adb shell dumpsys activity processes | grep -iE "anr|not responding" | head -5
        adb logcat -d -v time | tail -400; } > "$OUT/$name.log" 2>&1
    fi
    check "$name: загрузка началась" 'diag | grep -q "начало: http"'
    echo "$name" >> "$OUT/must_render.txt"
  done
  ;;
4)  # --- Ссылки из других приложений, изоляция профилей, скачивание, поворот, меню ---
  prefs en scarlet_dark
  start BrowserActivity --ei profile 5 --es url os:start; sleep 8
  while IFS='|' read -r url allowed <&3; do
    [ -z "$url" ] && continue
    adb logcat -c
    sc "I-$(echo "$url" | tr -c 'a-zA-Z0-9' '_' | cut -c1-40)" "adb shell am start -a android.intent.action.VIEW -d \"$url\" -p $PKG >/dev/null 2>&1; sleep 6"
    if [ "$allowed" = yes ]; then check "I: $url открыта" 'diag | grep -qF "начало: $url"'
    else check "I: $url отклонена" '! diag | grep -qF "начало: $url"'; fi
  done 3<<'CASES'
https://example.com/|yes
https://ru.wikipedia.org/|yes
https://example.org/?a=1|yes
javascript:alert(1)|no
data:text/html,hello|no
file:///etc/hosts|no
file:///sdcard/Download/x.pdf|no
content://com.android.contacts/contacts|no
intent://scan/#Intent;scheme=zxing;end|no
about:config|no
chrome://settings|no
resource://android/assets/reader/reader.js|no
CASES
  # Изоляция cookies: профиль A ставит cookie, профиль B его не видит, A — видит.
  for a in 1 3 5 7 9; do
    b=$((a + 1)); v="p${a}x$RANDOM"
    adb logcat -c
    sc "C-set-$a" "start BrowserActivity --ei profile $a --es url http://localhost:8770/set?v=$v; sleep 6"
    sc "C-read-$b" "start BrowserActivity --ei profile $b --es url http://localhost:8770/read?n=$b; sleep 6"
    sc "C-read-$a" "start BrowserActivity --ei profile $a --es url http://localhost:8770/read?n=$a; sleep 6"
    check "C: профиль $b не видит cookie профиля $a" '! adb logcat -d | grep -q "COOKIE n=$b .*v=$v"'
    check "C: профиль $a видит свой cookie" 'adb logcat -d | grep -q "COOKIE n=$a .*v=$v"'
  done
  # Скачивание разных типов (первое — с разрешением «запомнить для сайта»).
  first=1
  for f in report.pdf data.csv photo.png notes.txt archive.zip music.mp3 table.xlsx doc.docx config.json blob.bin; do
    sc "D-$f" "start BrowserActivity --ei profile 6 --es url http://localhost:8770/file/$f; sleep 5"
    # Первый раз ждём вопрос о разрешении; дальше — отвечаем, если он всё же показан.
    tries=1; [ $first = 1 ] && tries=6
    for w in $(seq $tries); do xy=$(find_xy "Allow"); [ -n "$xy" ] && { adb shell input tap $xy; sleep 3; break; }; [ $tries = 1 ] || sleep 2; done
    first=0
  done
  sleep 3
  adb shell run-as "$PKG" cat shared_prefs/downloads.xml > "$OUT/downloads.txt" 2>&1
  for f in report.pdf data.csv photo.png notes.txt archive.zip music.mp3 table.xlsx doc.docx config.json blob.bin; do
    check "D: $f скачан" 'grep -qF "$f" "$OUT/downloads.txt"'
  done
  # Поворот экрана на основных экранах.
  adb shell settings put system accelerometer_rotation 0
  for s in MainActivity SettingsActivity TabsActivity StatsActivity BrowserActivity; do
    adb shell settings put system user_rotation 1
    sc "R-$s" "start $s --ei profile 7; sleep 4"
    adb shell settings put system user_rotation 0; sleep 1
  done
  # Каждый пункт меню ⋮ открывается без падения.
  for key in new_tab new_incognito new_tab_group history clear_title site_permissions cabinet dl_title favorites tabs saved_pages \
    notes zoom share find_in_page reader_mode copy_link open_external desktop_site full_screen settings help_feedback diagnostics \
    save_page refresh; do
    item=$(tr_text "$key" en | sed 's/&amp;/\&/g')
    xy=""
    # Меню длиннее экрана: ищем, прокручивая вниз; не нашли — открываем заново (экран мог не успеть).
    for attempt in 1 2; do
      start BrowserActivity --ei profile 8 --es url https://example.com; sleep 6
      tap_text "Menu"; sleep 2
      xy=$(find_xy "$item")
      for sw in 1 2 3 4; do
        [ -n "$xy" ] && break
        adb shell input swipe 160 520 160 200 400; sleep 1; xy=$(find_xy "$item")
      done
      [ -n "$xy" ] && break
      adb shell input keyevent 4; sleep 1
    done
    N=$((N + 1))
    if [ -n "$xy" ]; then
      sc "M-$(echo "$item" | tr -c 'a-zA-Z' '_')" "adb shell input tap $xy; sleep 3"
    else fail "M: пункт «$item» не найден в меню"; fi
    adb shell input keyevent 4; sleep 1; adb shell input keyevent 4; sleep 1
  done
  # Инкогнито не оставляет истории.
  stop; adb shell run-as "$PKG" rm -f shared_prefs/history.xml
  sc "P-incognito" "start BrowserActivity --ei profile 9 --es action incognito --es url https://example.org/; sleep 8"
  stop; sleep 1
  check "P: инкогнито не пишет историю" '! adb shell run-as $PKG cat shared_prefs/history.xml 2>/dev/null | grep -q "example.org"'
  ;;
esac

kill "$SRV" 2>/dev/null || true
adb logcat -d -v time > "$OUT/logcat.txt"

# Пустые экраны: для каждого скриншота — не почти весь белый и не однотонный.
python3 - "$OUT" <<'PY'
import sys, glob, os, struct, zlib
def read_png(path):
    data = open(path, 'rb').read(); i = 8; w = h = ct = 0; idat = b''
    while i < len(data):
        ln = struct.unpack('>I', data[i:i+4])[0]; typ = data[i+4:i+8]; chunk = data[i+8:i+8+ln]
        if typ == b'IHDR': w, h, _, ct = struct.unpack('>IIBB', chunk[:10])
        elif typ == b'IDAT': idat += chunk
        elif typ == b'IEND': break
        i += 12 + ln
    raw = zlib.decompress(idat); bpp = {0: 1, 2: 3, 4: 2, 6: 4}[ct]; stride = w * bpp
    out = bytearray(); prev = bytearray(stride); p = 0
    for y in range(h):
        f = raw[p]; p += 1; line = bytearray(raw[p:p+stride]); p += stride
        for x in range(stride):
            a = line[x-bpp] if x >= bpp else 0; b = prev[x]; c = prev[x-bpp] if x >= bpp else 0
            if f == 1: line[x] = (line[x] + a) & 255
            elif f == 2: line[x] = (line[x] + b) & 255
            elif f == 3: line[x] = (line[x] + ((a + b) >> 1)) & 255
            elif f == 4:
                pp = a + b - c; pr = min((a, b, c), key=lambda v: abs(pp - v)); line[x] = (line[x] + pr) & 255
        out += line; prev = line
    return w, h, bpp, bytes(out)
outdir = sys.argv[1]
must = set(open(os.path.join(outdir, 'must_render.txt')).read().split()) if os.path.exists(os.path.join(outdir, 'must_render.txt')) else set()
res = []
for path in sorted(glob.glob(os.path.join(outdir, '*.png'))):
    name = os.path.splitext(os.path.basename(path))[0]
    w, h, ch, px = read_png(path)
    same = tot = 0; first = None
    site = name.startswith(('S-', 'A-', 'C-', 'D-', 'I-'))
    # Свои экраны — по всей высоте ниже строки состояния (у пустых списков текст только сверху).
    top, bottom = (.25, .8) if site else (.06, .97)
    for y in range(int(h * top), int(h * bottom), 6):
        for x in range(int(w * .1), int(w * .9), 6):
            o = (y * w + x) * ch; v = (px[o], px[o+1], px[o+2])
            first = first or v; same += v == first; tot += 1
    blank = same / tot > 0.985
    # Свои экраны не бывают однотонными; сайты — только из списка must (остальные могут грузиться долго).
    if blank and (not name.startswith(('S-', 'A-', 'C-', 'D-', 'I-')) or name in must):
        res.append(f"FAIL {name}: пустой экран")
    else:
        res.append(f"ok   {name}: экран не пустой")
open(os.path.join(outdir, 'checks.txt'), 'a').write("\n".join(res) + "\n")
PY

total=$(grep -c . "$CHECKS"); failed=$(grep -c '^FAIL' "$CHECKS")
echo "Часть $SHARD: сценариев $N, проверок $total, провалов $failed" | tee "$OUT/summary.txt"
grep '^FAIL' "$CHECKS" | head -50
[ "$failed" = 0 ]
