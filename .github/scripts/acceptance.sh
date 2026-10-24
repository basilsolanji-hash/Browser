#!/usr/bin/env bash
# Жёсткая приёмка на эмуляторе: скриншоты, журналы и АВТОПРОВЕРКА на белый экран.
# Если ключевая страница (Claude, Gmail, сайт) оказалась пустой — приёмка падает.
set -u
PKG=ru.multibrowser.test
OUT=results
mkdir -p "$OUT"
# Ход сценариев (нажатия, состояние вкладок) — в results/steps.txt.
exec > >(tee -a "$OUT/steps.txt") 2>&1

adb install -r app/build/outputs/apk/debug/app-debug.apk
for a in window_animation_scale transition_animation_scale animator_duration_scale; do
  adb shell settings put global "$a" 0
done
adb logcat -c

shot() { sleep "$2"; adb exec-out screencap -p > "$OUT/$1.png"; echo "shot $1"; }
main() { adb shell am start -n "$PKG/ru.multibrowser.MainActivity" "$@" >/dev/null; }
browser() { adb shell am start -n "$PKG/ru.multibrowser.BrowserActivity" "$@" >/dev/null; }
settings() { adb shell am start -n "$PKG/ru.multibrowser.SettingsActivity" "$@" >/dev/null; }
bookmarks() { adb shell am start -n "$PKG/ru.multibrowser.BookmarksActivity" "$@" >/dev/null; }
back() { adb shell input keyevent 4; sleep 1; }
tabs() { adb shell am start -n "$PKG/ru.multibrowser.TabsActivity" "$@" >/dev/null; }
# Сохранённые вкладки и группы (debug-сборка допускает run-as).
tabstate() { echo "== tabs state: $1"; adb shell run-as "$PKG" cat shared_prefs/tabs.xml; echo; }
# Нажать на элемент по тексту или contentDescription (без учёта регистра) через дамп uiautomator.
tap() {
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  adb shell cat /sdcard/ui.xml > "$OUT/ui.xml" 2>/dev/null
  local xy
  xy=$(python3 - "$OUT/ui.xml" "$1" <<'PY'
import sys, re, xml.etree.ElementTree as ET
q = sys.argv[2].lower()
try:
    root = ET.parse(sys.argv[1]).getroot()
except Exception:
    sys.exit(0)
for n in root.iter('node'):
    if (n.get('text') or '').lower() == q or (n.get('content-desc') or '').lower() == q:
        x1, y1, x2, y2 = map(int, re.findall(r'\d+', n.get('bounds')))
        print((x1 + x2) // 2, (y1 + y2) // 2)
        break
PY
)
  if [ -n "$xy" ]; then adb shell input tap $xy; echo "tap '$1' at $xy"; else echo "TAP NOT FOUND: '$1'"; fi
}
# Тап по центру элемента с текстом/описанием (первое найденное из вариантов) через uiautomator.
# Не нашли — пишем FAIL в checks.txt (приёмка падает).
tap_text() {
  local xy=""
  for _ in 1 2 3; do
    adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
    adb exec-out cat /sdcard/ui.xml > "$OUT/ui.xml" 2>/dev/null
    xy=$(python3 - "$OUT/ui.xml" "$@" <<'PY'
import sys, re, xml.etree.ElementTree as ET
try: root = ET.parse(sys.argv[1]).getroot()
except Exception: sys.exit(0)
for want in sys.argv[2:]:
    for n in root.iter('node'):
        if want in (n.get('text'), n.get('content-desc')):
            x1, y1, x2, y2 = map(int, re.findall(r'\d+', n.get('bounds')))
            print((x1 + x2) // 2, (y1 + y2) // 2); sys.exit(0)
PY
)
    [ -n "$xy" ] && break
    sleep 2
  done
  if [ -n "$xy" ]; then adb shell input tap $xy; echo "ok   tap '$1' at $xy" | tee -a "$OUT/checks.txt"
  else echo "FAIL tap '$1': not found" | tee -a "$OUT/checks.txt"; fi
}
rotate() { adb shell settings put system accelerometer_rotation 0; adb shell settings put system user_rotation "$1"; }

# --- Сценарии ---
# Первый запуск: обучение (6 экранов) и профили-примеры «Personal», «Work», «Shopping», «Social».
main;                                                                     shot 00-onboarding-1 10
OB="$OUT/onboarding.txt"; : > "$OB"
# Координаты кнопки по тексту (uiautomator), пусто — не найдена.
btn_xy() {
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  adb shell cat /sdcard/ui.xml | python3 -c "
import sys,re
x=sys.stdin.read()
m=re.search(r'text=\"'+re.escape(sys.argv[1])+r'\"[^>]*bounds=\"\[(\d+),(\d+)\]\[(\d+),(\d+)\]', x)
print('%d %d'%((int(m[1])+int(m[3]))//2,(int(m[2])+int(m[4]))//2) if m else '')" "$1"
}
for i in 2 3 4 5 6; do
  xy=$(btn_xy Next); echo "next $i: $xy" >> "$OB"
  [ -n "$xy" ] && adb shell input tap $xy;                                shot 00-onboarding-$i 2
done
xy=$(btn_xy "Start browsing"); echo "start: $xy" >> "$OB"; [ -n "$xy" ] && adb shell input tap $xy; sleep 2
main;                                                                     shot 01-main 6
browser --ei profile 6;                                                   shot 01b-start 12
browser --ei profile 3 --es site gmail --es url https://example.com;      shot 02-example 40
browser --ei profile 3 --es site gmail --es url https://ru.wikipedia.org; shot 03-wikipedia 25
browser --ei profile 1 --es url https://mail.google.com/;                 shot 04-p1-gmail 40
browser --ei profile 1 --es url https://claude.ai/;                       shot 05-p1-claude 45
browser --ei profile 2 --es url https://claude.ai/;                       shot 06-p2-claude 40
browser --ei profile 4 --es url https://claude.ai/;                       shot 07-p4-claude 40
rotate 1; sleep 3;                                                        shot 08-claude-landscape 6
rotate 0; sleep 3
# --- Вкладки (блок A): профиль 7 — чистый ---
tabs --ei profile 7;                                                      shot 70-tabs-empty 5
browser --ei profile 7 --es action new_tab --es url https://example.com;  shot 71-newtab-example 25
browser --ei profile 7 --es action new_tab --es url https://ru.wikipedia.org; sleep 20
browser --ei profile 7 --es action new_tab;                               shot 72-newtab-start 8
tap "Menu";                                                               shot 73-menu 3
adb shell input keyevent KEYCODE_BACK; sleep 1
tap "Tabs";                                                               shot 74-tabs-grid 4
adb shell input keyevent KEYCODE_BACK; sleep 1
tabs --ei profile 7 --es demo_group Work;                                 shot 75-tabs-group 4
tabs --ei profile 7 --es filter wiki;                                     shot 76-tabs-search 4
tabs --ei profile 7 --es filter zzzz;                                     shot 77-tabs-notfound 4
tabs --ei profile 7 --es mode select --ez select_all true;                shot 78-tabs-select 4
tabs --ei profile 7;                                                      sleep 3
tap "Example Domain";                                                     shot 79-tab-switched 8
browser --ei profile 7 --es action new_group;                             shot 80-new-group-dialog 4
adb shell input keyevent KEYCODE_BACK; sleep 1
adb shell input keyevent KEYCODE_BACK; sleep 1
tabstate before-close
tabs --ei profile 7;                                                      shot 81a-before-close 3
tap "Close tab";                                                          shot 81-tab-closed 3
adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb shell cat /sdcard/ui.xml > "$OUT/ui-81.xml"
tabstate after-close
browser --ei profile 7 --es action close_all;                             shot 82-close-all-dialog 4
tap "Close";                                                              shot 83-after-close-all 6
tabstate after-close-all
tabs --ei profile 7;                                                      shot 84-tabs-after-close 4
adb shell input keyevent KEYCODE_BACK; sleep 1
settings;                                                                 shot 09-settings 6
# Светлая тема (2-й пункт переключателя «Тема» рядом с верхом). Тап по координате сегмента «Светлая».
adb shell input tap 540 340; sleep 2;                                     shot 10-settings-light 3
browser --ei profile 5 --es site claude --es url https://claude.ai/;      shot 11-claude-light 40
main;                                                                     shot 12-main-light 5
adb shell am force-stop "$PKG"; sleep 2
main;                                                                     shot 13-relaunch 8
browser --ei profile 1 --es url https://claude.ai/;                       shot 14-session-restored 35

# --- Избранное: пусто → добавить из меню браузера → папка → поиск → открыть из списка ---
bookmarks;                                                                shot 15-fav-empty 4
browser --ei profile 3 --es site gmail --es url https://example.com;      sleep 20
tap_text "Menu";                                                          shot 16-menu 2
tap_text "Add to favorites";                                              shot 17-fav-added 1
bookmarks --es debug_add_url https://ru.wikipedia.org/ --es debug_add_title Wikipedia --es debug_add_folder Work
                                                                          shot 18-fav-list 4
tap_text "Work";                                                          shot 19-fav-folder 2
back
tap_text "Search favorites"; sleep 1; adb shell input text wiki;          shot 20-fav-search 2
back   # скрыть клавиатуру
# Открыть закладку из результатов поиска: должна загрузиться другая страница (Википедия) в текущем профиле.
tap_text "Wikipedia";                                                     shot 21-fav-opened 25
tap_text "Menu";                                                          shot 22-menu-remove 2
back

# --- Блок C: настройки сайтов, проверка безопасности, поиск в настройках, запрос геолокации ---
# NEW_TASK|MULTIPLE_TASK: иначе am start лишь выводит на передний план старую задачу с браузером сверху.
sitesettings() { adb shell am start -f 0x18000000 -n "$PKG/ru.multibrowser.SiteSettingsActivity" "$@" >/dev/null; }
seccheck() { adb shell am start -f 0x18000000 -n "$PKG/ru.multibrowser.SecurityCheckActivity" "$@" >/dev/null; }
# Нажать на первый найденный из нескольких вариантов текста (через дамп uiautomator); 0 — найден и нажат.
tap_any() {
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  adb shell cat /sdcard/ui.xml > "$OUT/ui.xml" 2>/dev/null
  local xy
  xy=$(python3 - "$OUT/ui.xml" "$@" <<'PY'
import sys, re
xml = open(sys.argv[1], encoding='utf-8', errors='ignore').read()
for want in sys.argv[2:]:
    for m in re.finditer(r'<node [^>]*>', xml):
        n = m.group(0)
        t = re.search(r' text="([^"]*)"', n)
        if t and t.group(1).strip().lower() == want.lower():
            b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', n)
            if b:
                x1, y1, x2, y2 = map(int, b.groups())
                print((x1 + x2) // 2, (y1 + y2) // 2)
                sys.exit(0)
sys.exit(1)
PY
) || { echo "tap_any: не найдено: $*"; return 1; }
  adb shell input tap $xy; echo "tap_any $* -> $xy"
}

adb shell am force-stop "$PKG"; sleep 1
sitesettings;                                                             shot 30-site-settings 6
seccheck;                                                                 shot 31-security-check 6
settings; sleep 4
# Поле поиска — первое поле ввода экрана, получает фокус; печатаем запрос.
tap_any "Search settings" || true
adb shell input text "HTTPS"; sleep 2; adb shell input keyevent 111;       shot 32-settings-search 2
adb shell input keyevent 4

# Страница, запрашивающая геолокацию: localhost — безопасный контекст, поднимаем сервер на раннере.
WEB=$(mktemp -d)
cat > "$WEB/geo.html" <<'HTML'
<!doctype html><meta name="viewport" content="width=device-width"><title>Geo test</title>
<body style="font:20px sans-serif;background:#fff;color:#000;padding:24px">
<h2>Geolocation test</h2><p id="s">requesting...</p>
<script>
navigator.geolocation.getCurrentPosition(
  p => { document.getElementById('s').textContent = 'OK ' + p.coords.latitude + ',' + p.coords.longitude; console.log('GEO ok'); },
  e => { document.getElementById('s').textContent = 'ERROR ' + e.code + ' ' + e.message; console.log('GEO error ' + e.code); },
  {timeout: 15000});
</script></body>
HTML
(cd "$WEB" && python3 -m http.server 8765 >/dev/null 2>&1) &
WEBPID=$!
adb reverse tcp:8765 tcp:8765
sleep 2
browser --ei profile 7 --es url http://localhost:8765/geo.html;          shot 33-geo-prompt 15
tap_any "Allow" "Разрешить" && sleep 3;                                  shot 34-geo-android 2
tap_any "While using the app" "Only this time" "Allow" && sleep 5;       shot 35-geo-result 8
sitesettings;                                                             shot 36-site-settings-after 5
for i in 1 2 3 4; do adb shell input swipe 160 560 160 80 300; done;       shot 36b-site-settings-sites 2
sitesettings --es host localhost;                                         shot 37-site-localhost 5
seccheck;                                                                 shot 38-security-after 5
adb shell input swipe 160 560 160 80 300;                                 shot 38b-security-after-bottom 2
kill "$WEBPID" 2>/dev/null || true

# --- Блоки D/E/F (feat/extras): по умолчанию, главная, чтение, офлайн, фраза, о приложении, справка, заметки ---
X="$OUT/extras.txt"; : > "$X"
act() { adb shell am start -n "$PKG/ru.multibrowser.$1" >/dev/null; }
# Центр элемента с текстом/описанием (точно или по вхождению); пусто — не найден.
find_xy() {
  for i in 1 2 3; do
    adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 && adb shell cat /sdcard/ui.xml > "$OUT/ui.xml" 2>/dev/null
    xy=$(python3 - "$OUT/ui.xml" "$1" <<'PY'
import sys, re
xml = open(sys.argv[1], encoding='utf-8', errors='ignore').read(); want = sys.argv[2]
nodes = re.findall(r'<node [^>]*>', xml)
def label(n, attr):
    m = re.search(' ' + attr + r'="([^"]*)"', n); return m.group(1) if m else ''
# Сначала точное совпадение, затем — по вхождению (заголовки сохранённых страниц бывают длиннее).
for match in (lambda s: s == want, lambda s: want in s):
    hit = next((n for n in nodes if match(label(n, 'text')) or match(label(n, 'content-desc'))), None)
    b = hit and re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', hit)
    if b:
        x1, y1, x2, y2 = map(int, b.groups()); print((x1 + x2) // 2, (y1 + y2) // 2); break
PY
)
    if [ -n "$xy" ]; then echo "$xy"; return 0; fi
    sleep 2
  done
  return 1
}
xtap() {
  local xy; xy=$(find_xy "$1")
  if [ -n "$xy" ]; then echo "tap '$1' at $xy" >> "$X"; adb shell input tap $xy; return 0; fi
  echo "NOT FOUND: '$1'" >> "$X"; return 1
}
# Пункт меню ⋮; меню длинное — если пункта не видно, прокручиваем его вниз.
menu_item() {
  xtap "Menu" && sleep 2 || return 1
  for i in 1 2 3; do
    xy=$(find_xy "$1") && [ -n "$xy" ] && { echo "tap '$1' at $xy" >> "$X"; adb shell input tap $xy; return 0; }
    adb shell input swipe 220 520 220 160 400; sleep 1
  done
  echo "NOT FOUND: '$1'" >> "$X"; return 1
}

browser --ei profile 7;                                                     shot 50-start-phrase 12
# №26: ссылка из «другого приложения» (неявный VIEW, только наш пакет) открывается в Оси.
echo "resolve VIEW https:" >> "$X"
adb shell cmd package resolve-activity --brief -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d https://example.org "$PKG" >> "$X" 2>&1
adb shell am start -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d https://example.org -p "$PKG" >> "$X" 2>&1
                                                                            shot 51-view-intent 30
# №37: долгое нажатие на заголовок example.org — панель выделения с «Добавить в заметку».
adb shell input swipe 150 296 150 296 1500;                                 shot 52-selection 3
# Плавающая панель выделения — отдельное окно, uiautomator её не видит: запасной тап по «Add to note» (320×640).
xtap "Add to note" || { echo "tap 'Add to note' by coordinates" >> "$X"; adb shell input tap 122 253; }; sleep 2
act NotesActivity;                                                          shot 53-notes 5
# №34: режим чтения на статье Википедии.
browser --ei profile 7 --es url https://en.m.wikipedia.org/wiki/Moon;       shot 54-article 30
menu_item "Reader mode";                                                    shot 55-reader 15
menu_item "Exit reader mode"; sleep 10
# №35: сохранить страницу офлайн, список и открытие PDF.
menu_item "Save page offline"
# Длинная статья пишется в PDF до полуминуты — ждём файл, а не фиксированное время.
for i in $(seq 30); do adb shell run-as "$PKG" cat shared_prefs/saved_pages.xml 2>/dev/null | grep -q 'page_' && break; sleep 3; done; sleep 2
act SavedPagesActivity;                                                     shot 56-saved 5
xtap "Moon" || true;                                                    shot 57-saved-open 15
# №27: главная — пустая страница, затем возврат к «Старт Ось».
settings; sleep 4
for i in 1 2 3 4 5 6 7 8; do adb shell input swipe 160 560 160 140 300; done; sleep 2
                                                                            shot 58-settings-extras 2
xtap "Blank page"; sleep 2
browser --ei profile 8 --es url os:start;                                   shot 59-home-blank 10
settings; sleep 4
for i in 1 2 3 4 5 6 7 8; do adb shell input swipe 160 560 160 140 300; done; sleep 2
xtap "Ось start"; sleep 1
# Полный экран из меню: панели скрыты, в углу кнопка выхода.
browser --ei profile 7 --es url https://example.com; sleep 15
menu_item "Full screen";                                                    shot 62-fullscreen 3
xtap "Exit full screen";                                                shot 63-fullscreen-exit 3
# Профили: перетаскивание («Personal» → на место «Work»), описание профиля.
adb shell am force-stop "$PKG"; main; sleep 6
from=$(find_xy "Personal"); to=$(find_xy "Work")
echo "drag: '$from' -> '$to'" >> "$X"
[ -n "$from" ] && [ -n "$to" ] && adb shell input draganddrop $from $to 2500
                                                                            shot 64-profiles-reordered 3
adb shell am start -n "$PKG/ru.multibrowser.ProfileActivity" --ei profile 5 >/dev/null; sleep 4
xtap "What this profile is for" && adb shell input text "Work%smail"
                                                                            shot 65-profile-info 2
adb shell input keyevent 4; sleep 1; adb shell input keyevent 4; sleep 2
adb shell run-as "$PKG" cat shared_prefs/profiles.xml | grep -E "order|desc_|name_" >> "$X" 2>&1
adb shell run-as "$PKG" cat shared_prefs/onboarding.xml shared_prefs/pins.xml >> "$X" 2>&1
# №23, №25
act AboutActivity;                                                          shot 60-about 5
act HelpActivity;                                                           shot 61-help 5
act StatsActivity;                                                          shot 66-stats 5
adb shell run-as "$PKG" cat shared_prefs/stats.xml >> "$X" 2>&1
adb shell run-as "$PKG" ls -la files/saved >> "$X" 2>&1
adb shell run-as "$PKG" cat shared_prefs/notes.xml >> "$X" 2>&1
adb shell run-as "$PKG" cat shared_prefs/home.xml shared_prefs/phrases.xml >> "$X" 2>&1

# Уведомления сайта → системное уведомление Android (страница на раннере, localhost).
NW=$(mktemp -d)
cat > "$NW/notify.html" <<'HTML'
<!doctype html><meta name="viewport" content="width=device-width"><title>Notify test</title>
<body style="margin:0;font:22px sans-serif;background:#fff;color:#000">
<button id="b" style="width:100vw;height:100vh;font-size:28px">Enable notifications</button>
<script>
document.getElementById('b').onclick = () => Notification.requestPermission().then(p => {
  console.log('NOTIF permission ' + p);
  // Пауза: успеть дать системное разрешение Android 13+.
  if (p === 'granted') setTimeout(() => {
    const n = new Notification('Os test', {body: 'Hello from the site', tag: 'os-test'});
    n.onclick = () => console.log('NOTIF clicked');
    console.log('NOTIF shown');
  }, 8000);
});
</script></body>
HTML
(cd "$NW" && python3 -m http.server 8766 >/dev/null 2>&1) &
NWPID=$!
adb reverse tcp:8766 tcp:8766; sleep 2
browser --ei profile 7 --es url http://localhost:8766/notify.html; sleep 12
adb shell input tap 160 400; sleep 3;                                       shot 69a-notify-site-prompt 1
tap_any "Allow" "Разрешить" && sleep 3;                                     shot 69b-notify-android 1
tap_any "Allow" && sleep 2
sleep 12
adb shell dumpsys notification --noredact > "$OUT/notifications.txt" 2>&1
adb shell cmd statusbar expand-notifications; sleep 2;                      shot 69-notification 1
adb shell cmd statusbar collapse; sleep 1
# Скачивание файла: Ось спрашивает разрешение сайта, после «Разрешить» файл в «Загрузках».
head -c 4096 /dev/urandom > "$NW/report.bin"
browser --ei profile 7 --es url http://localhost:8766/report.bin; sleep 8;   shot 69c-download-prompt 1
tap_any "Allow" "Разрешить" && sleep 6
adb shell run-as "$PKG" cat shared_prefs/downloads.xml > "$OUT/downloads.txt" 2>&1
kill "$NWPID" 2>/dev/null || true

# Смена языка: сразу меняются и настройки, и главный экран под ними (и имена профилей-примеров).
settings; sleep 4
xtap "System"; sleep 2; xtap "Русский"; sleep 4;                    shot 67-lang-settings-ru 1
adb shell input keyevent 4; sleep 3;                                        shot 68-lang-main-ru 1
echo "lang ru main: $(find_xy "Личное")" >> "$X"
adb logcat -d -v time > "$OUT/logcat.txt"
grep -E "OsDiag|GeckoConsole|AndroidRuntime|FATAL|Gecko" "$OUT/logcat.txt" | tail -800 > "$OUT/diag.txt"

# --- Проверки блоков D/E/F по состоянию приложения, а не по картинке ---
check() { if eval "$2"; then echo "ok   $1" | tee -a "$OUT/checks.txt"; else echo "FAIL $1" | tee -a "$OUT/checks.txt"; fi; }
check "№34 режим чтения отрисовал статью" 'grep -q "os-reader: ok" "$OUT/logcat.txt"'
check "№35 PDF сохранён и открыт"      'grep -q "page_.*\.pdf" "$X" && grep -q "tap .Moon" "$X"'
check "Полный экран: кнопка выхода"       'grep -q "tap .Exit full screen" "$X"'
check "Профили: порядок изменён"         'grep -q "name=\"order\"" "$X"'
check "Профили: описание сохранено"      'grep -q "desc_5\">Work mail" "$X"'
check "Первый запуск: примеры профилей"   'grep -q "name_1\">@ex_personal_name" "$X" && grep -q "name_4\">@ex_social_name" "$X" && grep -q "list_2" "$X"'
check "Первый запуск: обучение пройдено"  'grep -q "name=\"done\" value=\"true\"" "$X" && [ "$(grep -c "next .: [0-9]" "$OB")" -ge 5 ] && grep -q "start: [0-9]" "$OB"'
check "Статистика: страницы посчитаны"   'grep -q "name=\"pages_1\" value=\"[1-9]" "$X"'
check "Язык: главный экран сразу на русском" 'grep -q "lang ru main: [0-9]" "$X"'
check "Уведомление сайта показано системой" 'grep -q "Os test" "$OUT/notifications.txt"'
check "Скачивание: разрешение и файл в загрузках" 'grep -q "report.bin" "$OUT/downloads.txt"'
check "№37 заметка из выделения создана" 'grep -q "<string name=\"list\">\[{" "$X"'

# --- Автопроверка на белый экран: центральная область не должна быть почти вся белой/пустой ---
python3 - "$OUT" <<'PY'
import sys, glob, os, struct, zlib
# Минимальный разбор PNG без Pillow: считаем долю белых пикселей в центральной зоне.
def read_png(path):
    data=open(path,'rb').read()
    assert data[:8]==b'\x89PNG\r\n\x1a\n'
    i=8; w=h=bitd=ct=0; idat=b''
    while i<len(data):
        ln=struct.unpack('>I',data[i:i+4])[0]; typ=data[i+4:i+8]; chunk=data[i+8:i+8+ln]
        if typ==b'IHDR': w,h,bitd,ct=struct.unpack('>IIBB',chunk[:10])
        elif typ==b'IDAT': idat+=chunk
        elif typ==b'IEND': break
        i+=12+ln
    raw=zlib.decompress(idat); ch={0:1,2:3,4:2,6:4}[ct]; bpp=ch
    stride=w*bpp; out=bytearray(); prev=bytearray(stride); p=0
    def pa(a,b,c):
        pp=a+b-c; 
        return min((a,b,c),key=lambda x:abs(pp-x))
    for y in range(h):
        f=raw[p]; p+=1; line=bytearray(raw[p:p+stride]); p+=stride
        for x in range(stride):
            a=line[x-bpp] if x>=bpp else 0; b=prev[x]; c=prev[x-bpp] if x>=bpp else 0
            v=line[x]
            if f==1: v=(v+a)&255
            elif f==2: v=(v+b)&255
            elif f==3: v=(v+((a+b)>>1))&255
            elif f==4: v=(v+pa(a,b,c))&255
            line[x]=v
        out+=line; prev=line
    return w,h,ch,bytes(out)

outdir=sys.argv[1]
# Эти экраны обязаны показывать реальную страницу — не пустую.
must_render={'21-fav-opened','71-newtab-example','74-tabs-grid','75-tabs-group','78-tabs-select','79-tab-switched','51-view-intent','54-article','55-reader','57-saved-open','02-example','03-wikipedia','05-p1-claude','06-p2-claude','07-p4-claude','11-claude-light','14-session-restored'}
fails=[]
for path in sorted(glob.glob(os.path.join(outdir,'*.png'))):
    name=os.path.splitext(os.path.basename(path))[0]
    w,h,ch,px=read_png(path)
    y0,y1=int(h*0.25),int(h*0.80); x0,x1=int(w*0.1),int(w*0.9)
    white=same=tot=0; first=None
    for y in range(y0,y1,4):
        for x in range(x0,x1,4):
            o=(y*w+x)*ch; r,g,b=px[o],px[o+1],px[o+2]
            if min(r,g,b)>243: white+=1
            if first is None: first=(r,g,b)
            if (r,g,b)==first: same+=1
            tot+=1
    wr=white/tot; sr=same/tot
    status='ok'
    if name in must_render and (wr>0.9 or sr>0.97):
        status='BLANK'; fails.append(f"{name}: white={wr:.2f} uniform={sr:.2f}")
    print(f"{name:24} white={wr:.2f} uniform={sr:.2f} {status}")
checks=os.path.join(outdir,'checks.txt')
if os.path.exists(checks):
    fails+=[l.strip() for l in open(checks) if l.startswith('FAIL')]
if fails:
    print("\nПРИЁМКА НЕ ПРОЙДЕНА — пустые страницы:")
    for f in fails: print("  "+f)
    sys.exit(1)
print("\nВсе ключевые страницы отрисованы.")
PY
