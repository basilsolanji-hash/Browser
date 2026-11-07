# Android sync identity metadata — изолированный этап

`SyncIdentityStore.kt` подготовлен отдельно от UI/сети и не подключён к runtime приложения.
Он не изменяет Passwords.upsert/Passwords.list, GeckoSession, личные записи, ключи либо outbox.
APK 309 от предыдущего freeze не объявляется содержащим готовую синхронизацию.

- Приватная SQLite хранит только соответствия `(account UUID, vault UUID, kind, local key) → record UUID`.
  UUIDv4 создаётся системной UUID.randomUUID и проверяется канонически, по version/variant.
  ID профиля/заметки, `bUUID`, `os-millis` никогда автоматически не становятся global UUID.
- Типизированные LocalRef: Profile(Int), Password(profile Int, guid), Favorite(String), Note(Long).
  Парольный guid всегда включает локальный профиль в состав ключа. Два независимых Profile(1)
  не объединяются по номеру/имени; одинаковые guid разных профилей также независимы.
- Явно полученный и проверенный record UUID можно связать через ImportRecord. Повторное назначение
  уже занятого local↔record соответствия запрещено; record UUID уникален внутри vault среди всех kind.
- `importMetadata` атомарно фиксирует ID-привязки, receipt и локальный checkpoint миграции metadata.
  Это **не сетевой cursor и не подтверждение применения SharedPreferences с личными данными**.
  operationId — непрозрачный UUID локальной операции. expectedPreviousCheckpoint — CAS; разные
  новые операции со старой основы отклоняются. Порядок metadata записей несемантичен.
- Receipt связывает операцию с SHA-256 фиксированного length-prefixed UTF-8 metadata представления;
  это checksum для idempotency, не шифрование/аутентификация. Точный повтор возвращает прежние ID;
  изменённые metadata под тем же operationId запрещены. Повтор старого receipt не откатывает
  более новый checkpoint. Во время неудачной транзакции новые UUID не публикуются вызывающему;
  rollback не оставляет частичных привязок, receipt либо checkpoint. Уже сохранённые ID не меняются.
- `Empty`, непустой `Loaded` и `Unavailable` различны. Unavailable (включая Keystore) не открывает
  даже новую БД и ничего не меняет. Empty не порождает удаления/tombstones и не удаляет привязки.
  Строгий reader личных записей ещё не реализован: будущий адаптер не должен подменять Unavailable
  результатом Passwords.list, который сейчас скрывает ошибку как emptyList.
- Ошибки SQLite/неизвестная версия схемы не превращаются в пустой набор; автоматического wipe нет.

Подготовлены содержательные Robolectric-тесты: reopen/retry, два аккаунта/два vault/два устройства,
четыре типа, profile-scoped password GUID, строгость UUID, idempotency/CAS, duplicate/conflict,
реальный SQL-trigger сбой на записи receipt с rollback всех новых ID, Empty против Unavailable,
сохранность исходных bytes, двусторонние SQL unique и неизвестная версия без очистки.
Локальный прогон корня 07.11.2026: Gradle testDebugUnitTest PASS, 25 suites,
**2393 tests, 0 failures/errors**, включая все 22 новых теста. Роль приёмки независимо
проверила XML/лог и границы модуля; PASS только для этого metadata-этапа.

До настоящей синхронизации остаются строгие local readers, transactional personal data/outbox,
совместимые JWE/E2EE и Keystore wrapping, account/device/sync API, UI согласия/подключения,
двухустройственная/реальная device-приёмка и эксплуатационная проверка. Этот этап не объявляется
доступной функцией синхронизации и не меняет пользовательские данные автоматически.
