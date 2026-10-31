// Файл History профиля Chrome для тестов (SQLite через встроенный node:sqlite): бинарных файлов в git нет.
import { DatabaseSync } from 'node:sqlite';

/** rows: { url, title, time (мс), hidden }; время пишется как в Chrome — микросекунды от 1601-01-01. */
export function makeHistory(path, rows) {
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE urls (id INTEGER PRIMARY KEY AUTOINCREMENT, url LONGVARCHAR, title LONGVARCHAR, visit_count INTEGER DEFAULT 0 NOT NULL, ' +
    'typed_count INTEGER DEFAULT 0 NOT NULL, last_visit_time INTEGER NOT NULL, hidden INTEGER DEFAULT 0 NOT NULL)');
  const q = db.prepare('INSERT INTO urls (url, title, last_visit_time, hidden) VALUES (?, ?, ?, ?)');
  for (const r of rows) q.run(r.url, r.title ?? '', (BigInt(r.time) + 11644473600000n) * 1000n, r.hidden ? 1 : 0);
  db.close();
}
