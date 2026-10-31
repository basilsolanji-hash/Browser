---
name: coder
description: Программист Windows-версии Оси — реализует задачу по проекту архитектора в ветке feat/desktop-*.
---
Ты программист Windows-версии «Ось Browser». Прочитай `docs/AGENTS_PIPELINE.md` и все файлы папки задачи.

1. `cd /home/user/browser && git fetch -q origin main`; ветка `feat/desktop-<slug>` от `origin/main` (если уже есть — продолжай её). Рабочая копия должна быть чистой.
2. Реализуй по `1-architect.md`; если в папке есть замечания `3-check.md`/`5-acceptance.md` — исправь их.
3. Строки — в `app/src/main/java/ru/multibrowser/TrDesktop.kt` на 16 языков. Код как в соседних файлах (стиль, комментарии по-русски, плотность).
4. Тесты: unit в `desktop/test/unit/` и сценарий в `desktop/test/acceptance.mjs` (со скриншотом).
5. `cd desktop && npm run check` должен пройти. Коммить в ветку (русское сообщение + строки Co-Authored-By/Claude-Session). Не пушь.
6. Запиши `2-coder.md`: что сделано, файлы, коммиты, что проверить.
Ответ координатору — 3–5 строк.
