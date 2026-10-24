#!/usr/bin/env bash
# Проверка установщика на windows-latest (этап 5): тихая установка, регистрация браузера, запуск, удаление.
# Результаты дописываются в test-results/checks.txt, как у основной приёмки.
set -u
OUT=test-results
mkdir -p "$OUT"
fails=0
check() { if [ "$2" = 0 ]; then echo "ok $1" | tee -a "$OUT/checks.txt"; else echo "FAIL $1${3:+ — $3}" | tee -a "$OUT/checks.txt"; fails=$((fails+1)); fi; }

SETUP=$(ls release/Os-Browser-Setup-*.exe | head -1)
[ -f release/latest.yml ]; check "installer: latest.yml for auto-update is generated" $?
grep -q "sha512:" release/latest.yml 2>/dev/null; check "installer: latest.yml has sha512" $?
# Путь Windows → путь Git Bash (иначе обратные слеши ломают проверки файлов).
DIR="$(cygpath -u "$LOCALAPPDATA")/Programs/Os Browser"
# Как у пользователя: сначала прошлая версия из релизов, затем новая поверх неё.
PREV_URL=$(gh api repos/basilsolanji-hash/Browser/releases/tags/desktop-latest --jq '.assets[]|select(.name|endswith(".exe"))|.browser_download_url' 2>/dev/null)
if [ -n "$PREV_URL" ]; then
  curl -sSL -o prev-setup.exe "$PREV_URL" && ./prev-setup.exe //S; sleep 5
  for i in $(seq 1 30); do [ -f "$DIR/Os Browser.exe" ] && break; sleep 2; done
  [ -f "$DIR/Os Browser.exe" ]; check "installer: previous release installs ($(basename "$PREV_URL"))" $?
fi
"$SETUP" //S; sleep 5
for i in $(seq 1 30); do [ -f "$DIR/Os Browser.exe" ] && break; sleep 2; done
ls "$(cygpath -u "$LOCALAPPDATA")/Programs" > "$OUT/installer-programs.txt" 2>&1
[ -f "$DIR/Os Browser.exe" ]; check "installer: install over the previous version keeps Os Browser.exe" $? "$DIR"
# Ярлыки должны вести на существующий exe (иначе Windows пишет «Отсутствует ярлык»).
for lnk in "$(cygpath -u "$USERPROFILE")/Desktop/Ось Browser.lnk" "$(cygpath -u "$APPDATA")/Microsoft/Windows/Start Menu/Programs/Ось Browser.lnk"; do
  target=$(powershell -NoProfile -Command "(New-Object -ComObject WScript.Shell).CreateShortcut('$(cygpath -w "$lnk")').TargetPath" 2>/dev/null | tr -d '\r')
  echo "shortcut $lnk -> $target" >> "$OUT/installer-programs.txt"
  [ -f "$lnk" ] && [ -n "$target" ] && [ -f "$(cygpath -u "$target")" ]; check "installer: shortcut points to an existing exe ($(basename "$(dirname "$lnk")"))" $? "$target"
done
reg query 'HKCU\Software\Clients\StartMenuInternet\OsBrowser\Capabilities\URLAssociations' //v https 2>/dev/null | grep -q OsBrowserURL
check "installer: registered for Windows default apps (https → OsBrowserURL)" $?
reg query 'HKCU\Software\RegisteredApplications' //v 'Os Browser' >/dev/null 2>&1; check "installer: listed in RegisteredApplications" $?
ls "$(cygpath -u "$APPDATA")/Microsoft/Windows/Start Menu/Programs/" 2>/dev/null | grep -qi "Ось Browser\|Os Browser"; check "installer: Start menu shortcut" $?
# Запуск установленной программы: окно должно появиться и процесс — работать.
export OS_USER_DATA="$(cygpath -w "$(mktemp -d)")"
"$DIR/Os Browser.exe" & PID=$!
sleep 15
tasklist //FI "IMAGENAME eq Os Browser.exe" | grep -qi "Os Browser.exe"; check "installer: installed app starts" $?
taskkill //F //IM "Os Browser.exe" >/dev/null 2>&1; sleep 3
"$DIR/Uninstall Os Browser.exe" //S; sleep 5
for i in $(seq 1 30); do [ ! -f "$DIR/Os Browser.exe" ] && break; sleep 2; done
[ ! -f "$DIR/Os Browser.exe" ]; check "installer: silent uninstall removes the app" $?
reg query 'HKCU\Software\Clients\StartMenuInternet\OsBrowser' >/dev/null 2>&1; [ $? != 0 ]; check "installer: uninstall removes browser registration" $?
echo "installer: $fails failed" | tee -a "$OUT/checks.txt"
exit $fails
