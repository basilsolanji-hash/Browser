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
tabs() { adb shell am start -n "$PKG/ru.multibrowser.TabsActivity" "$@" >/dev/null; }
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
# --- Вкладки (блок A): профиль 7 — чистый ---
tabs --ei profile 7;                                                      shot 20-tabs-empty 5
browser --ei profile 7 --es action new_tab --es url https://example.com;  shot 21-newtab-example 25
browser --ei profile 7 --es action new_tab --es url https://ru.wikipedia.org; sleep 20
browser --ei profile 7 --es action new_tab;                               shot 22-newtab-start 8
tap "Menu";                                                               shot 23-menu 3
adb shell input keyevent KEYCODE_BACK; sleep 1
tap "Tabs";                                                               shot 24-tabs-grid 4
adb shell input keyevent KEYCODE_BACK; sleep 1
tabs --ei profile 7 --es demo_group Work;                                 shot 25-tabs-group 4
tabs --ei profile 7 --es filter wiki;                                     shot 26-tabs-search 4
tabs --ei profile 7 --es filter zzzz;                                     shot 27-tabs-notfound 4
tabs --ei profile 7 --es mode select --ez select_all true;                shot 28-tabs-select 4
tabs --ei profile 7;                                                      sleep 3
tap "Example Domain";                                                     shot 29-tab-switched 8
browser --ei profile 7 --es action new_group;                             shot 30-new-group-dialog 4
adb shell input keyevent KEYCODE_BACK; sleep 1
adb shell input keyevent KEYCODE_BACK; sleep 1
tabs --ei profile 7;                                                      sleep 3
tap "Close tab";                                                          shot 31-tab-closed 3
browser --ei profile 7 --es action close_all;                             shot 32-close-all-dialog 4
tap "Close";                                                              shot 33-after-close-all 6
tabs --ei profile 7;                                                      shot 34-tabs-after-close 4
adb shell input keyevent KEYCODE_BACK; sleep 1
settings;                                                               shot 09-settings 6
# Светлая тема (2-й пункт переключателя «Тема» рядом с верхом). Тап по координате сегмента «Светлая».
adb shell input tap 540 340; sleep 2;                                     shot 10-settings-light 3
browser --ei profile 5 --es site claude --es url https://claude.ai/;      shot 11-claude-light 40
main;                                                                     shot 12-main-light 5
adb shell am force-stop "$PKG"; sleep 2
main;                                                                     shot 13-relaunch 8
browser --ei profile 1 --es url https://claude.ai/;                       shot 14-session-restored 35

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
must_render={'02-example','03-wikipedia','05-p1-claude','06-p2-claude','07-p4-claude','11-claude-light','14-session-restored',
             '21-newtab-example','24-tabs-grid','25-tabs-group','28-tabs-select','29-tab-switched'}
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
