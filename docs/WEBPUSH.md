# №28 Web Push по профилям — проект (не реализовано)

Документ проектирует уведомления сайтов (Web Push / Notifications API) для Ось Browser.
Реализация — отдельным этапом после решения вопросов из §6.

## 1. Цель
- Сайты (Gmail, Claude, мессенджеры и т.д.) могут показывать уведомления, **как в Chrome**,
  но с учётом профилей: уведомление видно с цветом и именем профиля, нажатие открывает
  вкладку **именно того профиля**, из которого оно пришло.
- Конфиденциальность прежде всего: по умолчанию сайты разрешения не получают; запрос — только
  после жеста пользователя; разрешение выдаётся **на домен в конкретном профиле**.

## 2. Что даёт GeckoView
| API | Назначение |
|---|---|
| `GeckoSession.PermissionDelegate.onContentPermissionRequest` с `PERMISSION_DESKTOP_NOTIFICATION` | Сайт просит разрешение на уведомления → наш диалог (блок C, экран разрешений). |
| `WebNotificationDelegate` (`GeckoRuntime.setWebNotificationDelegate`) | `onShowNotification(WebNotification)` / `onCloseNotification` — показывать и убирать системные уведомления. `WebNotification.click()` / `dismiss()` — сообщать странице. |
| `WebPushDelegate` (`GeckoRuntime.getWebPushController().setDelegate`) | `onSubscribe(scope, appServerKey)`, `onGetSubscription(scope)`, `onUnsubscribe(scope)` — сайт хочет push-подписку; мы возвращаем `WebPushSubscription` (endpoint + ключи p256dh/auth). |
| `WebPushController.onPushEvent(scope, data)` | Доставить пришедшее push-сообщение в Service Worker сайта (он сам вызовет `showNotification`). |
| `WebPushController.onSubscriptionChanged(subscription)` | Сообщить сайту, что подписка обновилась. |

Важно: `WebNotification` содержит `source`/`origin`, `tag`, `title`, `text`, `imageUrl`,
`requireInteraction`, `silent`, `privateBrowsing` — но **не contextId**. Профиль определяем
по `GeckoSession`, из которой пришёл запрос разрешения/подписки (см. §4).

## 3. Два уровня
### 3.1. Уведомления открытых страниц (без сервера) — этап 1
Работает, пока вкладка жива в памяти (`Settings.keepAlive`): страница вызывает
`new Notification(...)` или `registration.showNotification(...)`.
1. `PermissionDelegate` (блок C) спрашивает «Разрешить уведомления от mail.google.com в профиле 3?»
   и хранит решение в `SitePermissions` по ключу `profileId|origin`.
2. `WebNotificationDelegate.onShowNotification`:
   - находим профиль по origin + последней сессии, запросившей разрешение (см. §4);
   - строим `NotificationCompat` в канале профиля `push_profile_<id>` (имя канала = имя профиля,
     цвет = цвет профиля) — пользователь в системе может выключить уведомления отдельного профиля;
   - `contentIntent` → `BrowserActivity` с экстрами `profile`, `site`, `url=origin` и
     `notification_tag`, по нажатию вызываем `webNotification.click()`.
   - `deleteIntent` → `webNotification.dismiss()`.
3. В инкогнито (`privateBrowsing == true`) уведомления не показываем и не запоминаем.

### 3.2. Настоящий Web Push (когда приложение закрыто) — этап 2, требует сервера
Push-сообщения приходят от push-сервиса браузера. У Firefox это autopush (Mozilla Push Service),
но GeckoView **не включает свой клиент доставки**: встраивающее приложение само получает
сообщения (в Fenix — через Firebase Cloud Messaging + сервер autopush/autoconnect) и передаёт их
в `WebPushController.onPushEvent`.

Варианты:
| Вариант | Как | Плюсы | Минусы |
|---|---|---|---|
| A. FCM + Mozilla autopush (как Fenix) | `onSubscribe` → регистрация в autopush с FCM-токеном → endpoint autopush отдаём сайту; пуш: сайт → autopush → FCM → приложение → `onPushEvent` | Проверенная схема | Google Play Services и FCM (передача токена Google), нужен ключ/проект Firebase, согласование с Mozilla на использование autopush |
| B. Свой push-сервер + FCM | То же, но endpoint — наш сервер | Полный контроль | Свой бэкенд (хостинг, БД подписок, мониторинг) — по §8 SPEC отдельный проект |
| C. UnifiedPush (ntfy и др.) | Пользователь выбирает дистрибьютор UnifiedPush; endpoint — его сервер | Без Google, приватно | Нужен отдельный дистрибьютор у пользователя; меньше охват |

Рекомендация: этап 1 (локальные уведомления) — сразу; этап 2 — вариант C как опция
«для приватности» + вариант A/B по решению владельца продукта. Бэкенд **не имитировать**.

## 4. Профили
- Разрешение и подписка привязаны к паре `(profileId, origin)`; хранение — `push_subs` (JSON в prefs):
  `{profileId, origin, scope, endpoint, createdAt}`.
- Определение профиля для `onSubscribe(scope)`: у `WebPushDelegate` нет сессии в аргументах.
  Используем «последнюю активную сессию с этим origin»: `BrowserActivity` при `onLocationChange`
  обновляет карту `origin → profileId` для видимой вкладки. Если один origin открыт в нескольких
  профилях — выбираем видимый; при неоднозначности подписку не создаём и показываем подсказку
  «откройте сайт в нужном профиле».
- Каждый профиль — свой `contextId`, поэтому Service Worker'ы и подписки сайтов изолированы
  движком; наш слой только сопоставляет их с профилем для показа и маршрутизации нажатий.
- Очистка профиля (`Gecko.clearProfile`) удаляет его подписки (`onUnsubscribe` + запись) и канал
  уведомлений.

## 5. Интерфейс
- Настройки → «Уведомления»: общий выключатель, список «профиль → сайты с разрешением»
  (отозвать), ссылка на системные настройки каналов.
- Счётчик непрочитанных в плитке профиля (`Profiles.unread`) можно увеличивать по уведомлениям
  Gmail (tag/title), не читая содержимое писем.
- Разрешение `POST_NOTIFICATIONS` (Android 13+) запрашиваем при первом разрешённом сайте, не при запуске.

## 6. Вопросы владельцу продукта (до этапа 2)
1. Допустимо ли зависеть от Google Play Services / FCM (приватность, устройства без GMS)?
2. Кто держит push-сервер (autopush Mozilla по соглашению, свой сервер, только UnifiedPush)?
3. Нужны ли уведомления в release для всех сайтов или белый список (Gmail, Claude)?

## 7. Приёмка (когда будет реализация)
- Тестовая страница вызывает `Notification.requestPermission()` → наш диалог с именем профиля.
- Разрешили → `new Notification('test')` → системное уведомление в канале профиля.
- Нажатие открывает тот же профиль и сайт; в инкогнито уведомлений нет.
- Отозвали разрешение в настройках → уведомления не показываются.
