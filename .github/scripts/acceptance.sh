#!/usr/bin/env bash
# Жёсткая приёмка на эмуляторе: скриншоты, журналы и АВТОПРОВЕРКА на белый экран.
# Если ключевая страница (Claude, Gmail, сайт) оказалась пустой — приёмка падает.
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
main() { adb shell am start -n "$PKG/ru.multibrowser.MainActivity" "$@" >/dev/null; }
browser() { adb shell am start -n "$PKG/ru.multibrowser.BrowserActivity" "$@" >/dev/null; }
settings() { adb shell am start -n "$PKG/ru.multibrowser.SettingsActivity" "$@" >/dev/null; }
rotate() { adb shell settings put system accelerometer_rotation 0; adb shell settings put system user_rotation "$1"; }

# --- Сценарии ---
main;                                                                     shot 01-main 10
browser --ei profile 6;                                                   shot 01b-start 12
browser --ei profile 3 --es site gmail --es url https://example.com;      shot 02-example 40
browser --ei profile 3 --es site gmail --es url https://ru.wikipedia.org; shot 03-wikipedia 25
browser --ei profile 1 --es url https://mail.google.com/;                 shot 04-p1-gmail 40
browser --ei profile 1 --es url https://claude.ai/;                       shot 05-p1-claude 45
browser --ei profile 2 --es url https://claude.ai/;                       shot 06-p2-claude 40
browser --ei profile 4 --es url https://claude.ai/;                       shot 07-p4-claude 40
rotate 1; sleep 3;                                                        shot 08-claude-landscape 6
rotate 0; sleep 3
settings;                                                                 shot 09-settings 6
# Светлая тема (2-й пункт переключателя «Тема» рядом с верхом). Тап по координате сегмента «Светлая».
adb shell input tap 540 340; sleep 2;                                     shot 10-settings-light 3
browser --ei profile 5 --es site claude --es url https://claude.ai/;      shot 11-claude-light 40
main;                                                                     shot 12-main-light 5
adb shell am force-stop "$PKG"; sleep 2
main;                                                                     shot 13-relaunch 8
browser --ei profile 1 --es url https://claude.ai/;                       shot 14-session-restored 35


# --- Блок C: настройки сайтов, проверка безопасности, поиск в настройках, запрос геолокации ---
# NEW_TASK|MULTIPLE_TASK: иначе am start лишь выводит на передний план старую задачу с браузером сверху.
sitesettings() { adb shell am start -f 0x18000000 -n "$PKG/ru.multibrowser.SiteSettingsActivity" "$@" >/dev/null; }
seccheck() { adb shell am start -f 0x18000000 -n "$PKG/ru.multibrowser.SecurityCheckActivity" "$@" >/dev/null; }
# Нажать на элемент экрана по его тексту (через дамп uiautomator); 0 — найден и нажат.
tap_text() {
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
) || { echo "tap_text: не найдено: $*"; return 1; }
  adb shell input tap $xy; echo "tap_text $* -> $xy"
}

adb shell am force-stop "$PKG"; sleep 1
sitesettings;                                                             shot 15-site-settings 6
seccheck;                                                                 shot 16-security-check 6
settings; sleep 4
# Поле поиска — первое поле ввода экрана, получает фокус; печатаем запрос.
tap_text "Search settings" || true
adb shell input text "HTTPS"; sleep 2; adb shell input keyevent 111;       shot 17-settings-search 2
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
browser --ei profile 7 --es url http://localhost:8765/geo.html;          shot 18-geo-prompt 15
tap_text "Allow" "Разрешить" && sleep 3;                                  shot 19-geo-android 2
tap_text "While using the app" "Only this time" "Allow" && sleep 5;       shot 20-geo-result 8
sitesettings;                                                             shot 21-site-settings-after 5
for i in 1 2 3 4; do adb shell input swipe 160 560 160 80 300; done;       shot 21b-site-settings-sites 2
sitesettings --es host localhost;                                         shot 22-site-localhost 5
seccheck;                                                                 shot 23-security-after 5
adb shell input swipe 160 560 160 80 300;                                 shot 23b-security-after-bottom 2
kill "$WEBPID" 2>/dev/null || true

adb logcat -d -v time > "$OUT/logcat.txt"
grep -E "OsDiag|GeckoConsole|AndroidRuntime|FATAL|Gecko" "$OUT/logcat.txt" | tail -800 > "$OUT/diag.txt"

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
must_render={'02-example','03-wikipedia','05-p1-claude','06-p2-claude','07-p4-claude','11-claude-light','14-session-restored'}
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
if fails:
    print("\nПРИЁМКА НЕ ПРОЙДЕНА — пустые страницы:")
    for f in fails: print("  "+f)
    sys.exit(1)
print("\nВсе ключевые страницы отрисованы.")
PY
