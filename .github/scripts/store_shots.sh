#!/usr/bin/env bash
# Скриншоты для Google Play: телефон Pixel 6 (1080×2400) и планшет Pixel Tablet, русский и английский,
# заранее подготовленные данные (профили-примеры, вкладки, история, заметки, загрузки).
# Сырые снимки — в results/<язык>-NN-<экран>.png; подписи и рамки делаются отдельно.
set -u
PKG=ru.multibrowser.test
OUT=results
mkdir -p "$OUT"
exec > >(tee -a "$OUT/steps.txt") 2>&1

adb install -r app/build/outputs/apk/debug/app-debug.apk
ADB_BIN=$(command -v adb)
adb() { timeout 60 "$ADB_BIN" "$@"; }
for a in window_animation_scale transition_animation_scale animator_duration_scale; do adb shell settings put global "$a" 0; done
# Системные окна «приложение не отвечает» (лаунчер на медленном эмуляторе) не должны попадать в кадр.
adb shell settings put global hide_error_dialogs 1
# Все кадры для магазина и сайта — в пропорции 3:4, поэтому планшет снимаем вертикально.
read -r W H <<<"$(adb shell wm size | sed -n 's/.*: \([0-9]*\)x\([0-9]*\).*/\1 \2/p' | tail -1)"
if [ "${W:-0}" -gt "${H:-0}" ]; then
  adb shell settings put system accelerometer_rotation 0
  adb shell settings put system user_rotation 1
fi
sleep 30
adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null
# Чистая строка состояния: 10:00, полная батарея, без уведомлений.
adb shell settings put global sysui_demo_allowed 1
demo() { adb shell am broadcast -a com.android.systemui.demo -e command "$@" >/dev/null; }
demo enter; demo clock -e hhmm 1000; demo battery -e level 100 -e plugged false; demo network -e wifi show -e level 4
demo notifications -e visible false

shot() { sleep "${2:-2}"; adb exec-out screencap -p > "$OUT/$1.png"; echo "shot $1"; }
start() { adb shell am start -n "$PKG/ru.multibrowser.$1" "${@:2}" >/dev/null 2>&1; }
stop() { adb shell am force-stop "$PKG"; }
back() { adb shell input keyevent 4; sleep 1; }

tr_text() {
  python3 - "$1" "$2" <<'PY'
import sys, re, glob
key, lang = sys.argv[1], sys.argv[2]
idx = ["en","ru","es","pt","fr","de","ar","hi","tr","zh"].index(lang)
for f in glob.glob("app/src/main/java/ru/multibrowser/Tr*.kt"):
    m = re.search(r'^\s+"' + re.escape(key) + r'" to listOf\((.*)\),?\s*$', open(f, encoding="utf-8").read(), re.M)
    if m:
        print(re.findall(r'"((?:[^"\\]|\\.)*)"', m.group(1))[idx].replace('\\$', '$').replace('\\"', '"')); break
PY
}
# Центр элемента: по тексту/описанию (без учёта регистра) или по подсказке поля (hint).
find_xy() {
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; adb shell cat /sdcard/ui.xml > "$OUT/ui.xml" 2>/dev/null
  python3 - "$OUT/ui.xml" "$1" <<'PY'
import sys, re, xml.etree.ElementTree as ET
q = sys.argv[2].lower()
try: root = ET.parse(sys.argv[1]).getroot()
except Exception: sys.exit(0)
for n in root.iter('node'):
    if q in ((n.get('text') or '').lower(), (n.get('content-desc') or '').lower(), (n.get('hint') or '').lower()):
        x1, y1, x2, y2 = map(int, re.findall(r'\d+', n.get('bounds'))); print((x1 + x2) // 2, (y1 + y2) // 2); break
PY
}
tap() { local xy; xy=$(find_xy "$1"); if [ -n "$xy" ]; then adb shell input tap $xy; echo "tap '$1'"; else echo "NOT FOUND '$1'"; fi; }
type_text() { adb shell input text "$(printf '%s' "$1" | sed 's/ /%s/g')"; }

# Файл настроек приложения (shared_prefs/<имя>.xml) из строк <map>.
put_prefs() {
  local name="$1"; shift
  { echo "<?xml version='1.0' encoding='utf-8' standalone='yes' ?>"; echo "<map>"; printf '%s\n' "$@"; echo "</map>"; } > "/tmp/$name.xml"
  adb push "/tmp/$name.xml" /data/local/tmp/ >/dev/null
  adb shell chmod 644 "/data/local/tmp/$name.xml"
  adb shell run-as "$PKG" mkdir -p shared_prefs
  adb shell run-as "$PKG" cp "/data/local/tmp/$name.xml" shared_prefs/
}
esc() { python3 -c 'import html,sys; print(html.escape(sys.argv[1], quote=True))' "$1"; }

seed() {
  local L="$1" now; now=$(date +%s)000
  stop; adb shell pm clear "$PKG" >/dev/null
  put_prefs settings "<string name=\"lang\">$L</string>" "<string name=\"theme_id\">scarlet_dark</string>" "<boolean name=\"lock\" value=\"false\" />"
  put_prefs onboarding '<boolean name="done" value="true" />'
  put_prefs profiles \
    '<string name="name_1">@ex_personal_name</string>' '<string name="desc_1">@ex_personal_desc</string>' \
    '<string name="name_2">@ex_work_name</string>' '<string name="desc_2">@ex_work_desc</string>' \
    '<string name="name_3">@ex_shopping_name</string>' '<string name="desc_3">@ex_shopping_desc</string>' \
    '<string name="name_4">@ex_social_name</string>' '<string name="desc_4">@ex_social_desc</string>' \
    '<string name="email_1">anna.petrova@example.com</string>' '<string name="email_2">a.petrova@company.example</string>' \
    '<int name="unread_1" value="3" />' '<int name="last_profile" value="1" />' '<string name="pinned">2</string>'
  local wiki news="https://www.bbc.com/news"
  case "$L" in
    ru) wiki="https://ru.m.wikipedia.org/wiki/Луна"; news="https://lenta.ru/" ;;
    es) wiki="https://es.m.wikipedia.org/wiki/Luna"; news="https://elpais.com/" ;;
    pt) wiki="https://pt.m.wikipedia.org/wiki/Lua"; news="https://g1.globo.com/" ;;
    fr) wiki="https://fr.m.wikipedia.org/wiki/Lune"; news="https://www.lemonde.fr/" ;;
    de) wiki="https://de.m.wikipedia.org/wiki/Mond"; news="https://www.spiegel.de/" ;;
    ar) wiki="https://ar.m.wikipedia.org/wiki/قمر"; news="https://www.aljazeera.net/" ;;
    hi) wiki="https://hi.m.wikipedia.org/wiki/चन्द्रमा" ;;
    tr) wiki="https://tr.m.wikipedia.org/wiki/Ay"; news="https://www.trthaber.com/" ;;
    zh) wiki="https://zh.m.wikipedia.org/wiki/月球" ;;
    *) wiki="https://en.m.wikipedia.org/wiki/Moon" ;;
  esac
  local tabs; tabs=$(esc "[{\"id\":\"tab1\",\"title\":\"Wikipedia\",\"url\":\"$wiki\",\"group\":\"\"},{\"id\":\"tab2\",\"title\":\"GitHub\",\"url\":\"https://github.com/\",\"group\":\"\"},{\"id\":\"tab3\",\"title\":\"News\",\"url\":\"$news\",\"group\":\"\"}]")
  put_prefs tabs "<string name=\"list_1\">$tabs</string>"
  local hist; hist=$(esc "[{\"u\":\"$wiki\",\"t\":\"Wikipedia\",\"d\":$now},{\"u\":\"https://github.com/\",\"t\":\"GitHub\",\"d\":$now},{\"u\":\"https://claude.ai/\",\"t\":\"Claude\",\"d\":$now},{\"u\":\"https://mail.google.com/\",\"t\":\"Gmail\",\"d\":$now},{\"u\":\"https://www.notion.so/\",\"t\":\"Notion\",\"d\":$now},{\"u\":\"https://trello.com/\",\"t\":\"Trello\",\"d\":$now},{\"u\":\"https://duckduckgo.com/?q=weather\",\"t\":\"DuckDuckGo\",\"d\":$now},{\"u\":\"https://www.booking.com/\",\"t\":\"Booking\",\"d\":$now}]")
  put_prefs history "<string name=\"h_1\">$hist</string>"
  local n1 n2 n3
  case "$L" in
    ru) n1="Позвонить поставщику до 15:00"; n2="Идеи для презентации: цифры за квартал, отзывы клиентов"; n3="Луна удаляется от Земли примерно на 3,8 см в год" ;;
    es) n1="Llamar al proveedor antes de las 15:00"; n2="Ideas para la presentación: cifras del trimestre, opiniones de clientes"; n3="La Luna se aleja de la Tierra unos 3,8 cm al año" ;;
    pt) n1="Ligar para o fornecedor antes das 15h"; n2="Ideias para a apresentação: números do trimestre, depoimentos de clientes"; n3="A Lua se afasta da Terra cerca de 3,8 cm por ano" ;;
    fr) n1="Appeler le fournisseur avant 15 h"; n2="Idées pour la présentation : chiffres du trimestre, avis clients"; n3="La Lune s'éloigne de la Terre d'environ 3,8 cm par an" ;;
    de) n1="Lieferanten vor 15 Uhr anrufen"; n2="Ideen für die Präsentation: Quartalszahlen, Kundenstimmen"; n3="Der Mond entfernt sich jährlich etwa 3,8 cm von der Erde" ;;
    ar) n1="الاتصال بالمورّد قبل الساعة 3 مساءً"; n2="أفكار للعرض: أرقام الربع، آراء العملاء"; n3="يبتعد القمر عن الأرض نحو 3.8 سم كل عام" ;;
    hi) n1="दोपहर 3 बजे से पहले सप्लायर को कॉल करें"; n2="प्रेज़ेंटेशन के लिए आइडिया: तिमाही के आंकड़े, ग्राहकों की राय"; n3="चंद्रमा हर साल पृथ्वी से लगभग 3.8 सेमी दूर जाता है" ;;
    tr) n1="Tedarikçiyi saat 15:00'ten önce ara"; n2="Sunum fikirleri: çeyrek rakamları, müşteri yorumları"; n3="Ay her yıl Dünya'dan yaklaşık 3,8 cm uzaklaşıyor" ;;
    zh) n1="下午3点前给供应商打电话"; n2="演示文稿思路：季度数据、客户评价"; n3="月球每年远离地球约3.8厘米" ;;
    *) n1="Call the supplier before 3 pm"; n2="Ideas for the deck: quarterly numbers, customer quotes"; n3="The Moon drifts away from Earth by about 3.8 cm a year" ;;
  esac
  local notes; notes=$(esc "[{\"id\":1,\"text\":\"$n1\",\"url\":\"\",\"time\":$now},{\"id\":2,\"text\":\"$n2\",\"url\":\"https://www.notion.so/\",\"time\":$now},{\"id\":3,\"text\":\"$n3\",\"url\":\"$wiki\",\"time\":$now}]")
  put_prefs notes "<string name=\"list\">$notes</string>"
  local dl; dl=$(esc "[{\"n\":\"Report_Q3.pdf\",\"m\":\"application/pdf\",\"u\":\"\",\"t\":$now,\"s\":2457600},{\"n\":\"team-photo.jpg\",\"m\":\"image/jpeg\",\"u\":\"\",\"t\":$now,\"s\":1843200},{\"n\":\"budget.xlsx\",\"m\":\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\",\"u\":\"\",\"t\":$now,\"s\":98304},{\"n\":\"podcast.mp3\",\"m\":\"audio/mpeg\",\"u\":\"\",\"t\":$now,\"s\":31457280}]")
  put_prefs downloads "<string name=\"list\">$dl</string>"
}

for L in ${LANGS:-ru en}; do
  seed "$L"
  start MainActivity;                                                   shot "$L-01-main" 5
  start BrowserActivity --ei profile 1 --es site tab1;                  shot "$L-02-browser" 18
  tap "$(tr_text menu "$L")";                                           shot "$L-03-menu" 2
  back
  tap "$(tr_text switch_profile "$L")";                                 shot "$L-04-profiles" 2
  back
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
  xy=$(adb shell cat /sdcard/ui.xml | python3 -c 'import sys,re
x=sys.stdin.read(); m=re.search(r"class=\"android.widget.EditText\"[^>]*bounds=\"\[(\d+),(\d+)\]\[(\d+),(\d+)\]\"", x)
print((int(m.group(1))+int(m.group(3)))//2, (int(m.group(2))+int(m.group(4)))//2) if m else None')
  [ -n "$xy" ] && adb shell input tap $xy;                              shot "$L-05-address" 2
  back; back
  start BrowserActivity --ei profile 1 --es url os:start;               shot "$L-06-start" 8
  start AccountActivity --ei profile 1; sleep 3
  tap "$(tr_text password_add "$L")"; sleep 2
  tap "$(tr_text password_site "$L")"; type_text "mail.example.com"
  tap "$(tr_text password_login "$L")"; type_text "anna.petrova"
  tap "$(tr_text password_value "$L")"; type_text "Secret-2026"
  tap "$(tr_text save "$L")"; sleep 2
  start AccountActivity --ei profile 1;                                 shot "$L-07-cabinet" 3
  start DownloadsActivity;                                              shot "$L-08-downloads" 3
  start NotesActivity;                                                  shot "$L-09-notes" 3
  start SettingsActivity;                                               shot "$L-10-settings" 3
  start SettingsActivity --es group privacy;                            shot "$L-11-privacy" 3
  start TabsActivity --ei profile 1;                                    shot "$L-12-tabs" 3
done
demo exit
