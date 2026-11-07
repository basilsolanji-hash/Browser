# Сверка Windows с Android — 07.11.2026

База: `main` f42cfe37ae130b4b9d8e3e13987d5e247a868d38. Проверены исходники и содержание тестов; это не отчёт о новом успешном прогоне CI. «Сделано» означает наличие реализации и указанного покрытия; непроверенные условия перечислены отдельно.

| § | Статус | Доказательство: код | Доказательство: тест и пробел |
|---|---|---|---|
| 1 | Сделано (07.11, CI) | `desktop/src/ui/browser.ts`: `mainMenu`, `moreTools`; `browser.css`: `.main-menu`, `.toprow` | `desktop/test/acceptance.mjs`, сценарий 34: пять круглых кнопок, группы, размеры, мобильный UA, диагностика. Пункты возвращены в основные группы; `test/menu.mjs` — 49 проверок на 16 языках. CI Windows 42321426976 и полная приёмка 42321426999 зелёные. |
| 3 | Сделано | `desktop/src/ui/browser.ts`: `ENGINE_BADGES`, `suggest`, `pageCard`, `paintSuggestions`; `main/addrpanel.ts`, `main/query.ts` | `desktop/test/unit/query.test.mjs`, `addrpanel.test.mjs`; приёмка 35: значок поисковика, очистка, карточка, до восьми сайтов, прошлые запросы, подстановка. |
| 6 | Сделано | `desktop/src/main/settings.ts`: `TOOLBAR_BUTTONS`, значение `downloads`; `pages/settings.ts`: `toolbar-button`; `ui/browser.ts`: `toolbarItem` | Приёмка 38: смена Downloads → Find, открытие поиска. Все восемь вариантов присутствуют в коде; отдельного прохода по каждому нет. Кнопка загрузок появляется после первой загрузки. |
| 9 | Сделано (07.11, CI) | `pages/home.ts`, `pages/home.css`, `main/ipc.ts`: поиск с выбором профиля; существующие уведомления/обучение/загрузки сохранены | `test/quicksearch.mjs`: 10 проверок, реальные cookies, другое окно, блокировка; CI 42321794819 и полная приёмка 42321794796 зелёные. |
| 12 | Частично | `pages/common.css`: `.wrap` (720 px содержимого); `pages/cabinet.css`; `main/ipc.ts`: `FEEDBACK_EMAIL`; `pages/about.ts`: `SITE` и две политики | Приёмка 52 проверяет ширину/центрирование пяти экранов, но не кабинет и не узкое окно. `site/public/privacy{,-en}.html` описывают Android Keystore, не содержат Windows safeStorage/DPAPI; теста на Windows-политику нет. |
| 13 | Частично | `main/signin.ts`: `isSignInPage`; `main/window.ts`: `onNavigated` пропускает сохранение формы входа | `test/unit/signin.test.mjs` проверяет распознавание адресов. Но `main/tabs.ts:add` сохраняет исходный URL без фильтра, `setPinState` исключает только accounts.google.com, а `window.ts:onTitle` вызывает его для остальных форм входа. Теста перезапуска/счётчика SMS нет. Автоматической выгрузки по лимиту в Windows сейчас нет. |
| 15 | Частично | `main/security.ts`: `autoplayPolicy: document-user-activation-required` | Приёмка 36 проверяет AudioContext до жеста и через 1 с после; реальное видео/play через 10 с не проверяется. Отдельного разрешения «Звук» ещё нет (уже есть задача «Настройки сайта: JavaScript, картинки, звук, всплывающие окна»). |
| 17 | Частично | `main/window.ts`: `chromeHeight`, `layout` — фиксированные панели без автоскрытия при прокрутке; `main/tabview.ts`: `contextMenu` | Приёмка 21 проверяет сохранение цитаты и поиск, но вызывает методы напрямую: не выделяет текст мышью/тачем и не сравнивает размеры/координаты до и после. Поведение архитектурно предусмотрено, регрессионного теста нет. |
| 18 | Сделано | `main/permissions.ts`: ASK/ALLOW/BLOCK; `main/window.ts`: `osMediaDenied`, `explainOsDenied`, обработчик разрешений; `main/security.ts`: список ms-settings | Приёмка 18 и 37: решения по профилю/сайту, три варианта, подсказка о запрете. Системный отказ реализован, но в приёмке не имитируется; физические камера/микрофон требуют проверки на Windows. |
| 21 | Сделано | `main/tabview.ts`: `will-prevent-unload`, `reload`; `main/unload.ts`; `main/privacy.ts`: данные POST | `test/unit/unload.test.mjs`; приёмка 58: Остаться/Покинуть, три минуты, отмена повторной оплаты и повтор POST с теми же данными. |
| 22 | Сделано | `scripts/gen-i18n.mjs`, `shared/format.ts`, `main/i18n.ts`, `assets/phrases/`, `store/captions-desktop.json` | `test/unit/langs.test.mjs` проверяет 16 столбцов, непустые строки, фразы и подписи. Приёмка 59 переключает шесть новых языков, проверяет фразу, LTR и размеры меню. Термины поступают из общих Tr*.kt, на Android — GlossaryTest. |
| 23 | Частично | `main/linkmenu.ts`, `main/tabview.ts:contextMenu`, `main/window.ts:openLink/openInProfile`; `ui/browser.ts:toast` (4 с) | `test/unit/linkmenu.test.mjs`; приёмка 60: фон/Перейти, группа, профиль, инкогнито, mailto/javascript, картинка. Шапки с буквой сайта, текстом и адресом в нативном Menu нет. Видео/аудио покрываются unit-правилами, но не живым сценарием скачивания. |

Итог: 5 параграфов сделаны, 7 частично, полностью отсутствующих параграфов нет. Пробелы добавлены отдельным блоком в DESKTOP_TASKS.md; счётчик очереди из 46 функций не увеличивается за счёт исправлений соответствия.

Локальная проверка 07.11.2026: выполнены `query.test.mjs`, `addrpanel.test.mjs`,
`signin.test.mjs`, `unload.test.mjs`, `langs.test.mjs`, `linkmenu.test.mjs` через
`node --import ./test/unit/ts-resolve.mjs --test …`: **17/17 PASS**.
Это не заменяет запуск приёмки на windows-latest.

Обновление 07.11.2026: после исправления §1 — 6 параграфов сделаны, 6 частично. Исторический итог выше относится к базе f42cfe3.

После §9: 7 параграфов сделаны, 5 частично.
