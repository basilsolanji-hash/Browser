# Текст для сессии Windows (вставить первым сообщением)

Ты ведёшь настольную версию «Ось Browser» (папка `desktop/`, Electron + TypeScript) в репозитории
basilsolanji-hash/Browser. Эталон — Android-версия, её ведёт другая сессия, и она постоянно
добавляет правки. Твоя задача — держать Windows-версию в одном уровне с Android.

## Как читать правки Android в реальном времени
1. Все правки, которые нужно повторить в Windows, Android-сессия записывает в
   `docs/WINDOWS_SYNC.md` (разделы с номерами; новые — в конце, перед «Новые строки перевода»).
2. В начале работы и затем **каждый час** (поставь себе повторяющуюся задачу или проверяй между
   этапами):
   ```bash
   git fetch origin main feat/quick-search
   git log --oneline origin/feat/quick-search -15 -- docs/WINDOWS_SYNC.md app/src/main
   git diff "$(cat desktop/.android-sync 2>/dev/null || echo origin/main~30)" origin/feat/quick-search -- docs/WINDOWS_SYNC.md
   ```
   Рабочая ветка Android сейчас `feat/quick-search` (проверенное попадает в `main`). Если её
   нет — смотри `main`.
3. Сделал раздел — запиши, до какого коммита Android дочитал:
   `git rev-parse origin/feat/quick-search > desktop/.android-sync` и закоммить вместе с правкой.
4. Подробности поведения — в коде Android (`app/src/main/java/ru/multibrowser/*.kt`), переводы —
   в `Tr*.kt` (те же ключи и тексты на 10 языках), фразы — `app/src/main/assets/phrases/*.txt`.
5. Отличия платформы: Android Keystore → `safeStorage` (DPAPI); отпечаток/PIN → Windows Hello;
   GeckoView → Chromium (Electron); нижняя панель → панель инструментов окна.

## Правила
- Работай в своей ветке `feat/desktop-*`, в `main` — только после зелёного CI и проверки.
- Каждая правка из `WINDOWS_SYNC.md` — с тестом (unit или e2e) и скриншотом.
- Без своих серверов, аналитики и рекламы; всё локально. 10 языков + RTL, 6 тем.
- Почта для связи — hello@os-browser.com, сайт — https://www.os-browser.com.
- Коммиты заканчивай строками Co-Authored-By и Claude-Session своей сессии; модель не указывай.
- Отвечай владельцу по-русски, коротко: что сделано из списка, что осталось, готовность в %.
