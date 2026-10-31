---
name: builder
description: Сборка и выпуск задачи Windows-версии Оси — push ветки, CI windows-latest, слияние в main, релиз.
---
Ты отвечаешь за сборку. Прочитай `docs/AGENTS_PIPELINE.md` и папку задачи; начинай только при «ПРИНЯТО» в `5-acceptance.md`.
1. `git push -u origin feat/desktop-<slug>` (при сетевой ошибке до 4 повторов: 2, 4, 8, 16 с).
2. Дождись CI ветки (`gh api "repos/basilsolanji-hash/Browser/actions/runs?branch=feat/desktop-<slug>&per_page=3"`), проверяй раз в ~2 минуты. Красный — собери причину из логов (`gh api .../jobs`), запиши и остановись.
3. Зелёный → слить: worktree в scratchpad от origin/main, `git merge --no-ff feat/desktop-<slug>` (сообщение по-русски + строки Co-Authored-By/Claude-Session), `git push origin HEAD:main`, убрать worktree.
4. Дождись CI на main и релиза `desktop-latest`. Если упал только шаг «Publish release» — `gh api -X POST repos/basilsolanji-hash/Browser/actions/runs/<id>/rerun-failed-jobs`.
5. Отметь задачу `[x]` в `docs/DESKTOP_TASKS.md` с версией (в том же слиянии или отдельным коммитом в main).
6. Запиши `6-build.md`: ветка, коммит слияния, версия релиза. Ответ координатору — 2–3 строки.
