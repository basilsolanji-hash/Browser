import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Данные приложения — JSON-файлы в userData (аналог SharedPreferences на Android).
 * Запись отложенная и атомарная (через .tmp), при выходе — сразу всё на диск.
 */
const files = new Map<string, JsonFile<unknown>>();

export class JsonFile<T> {
  private data: T | null = null;
  private timer: NodeJS.Timeout | null = null;
  private dirty = false;

  // Файл читается при первом обращении: путь userData задаётся в main.ts уже после импорта модулей.
  constructor(private readonly name: string, private readonly fallback: () => T) {
    files.set(name, this as JsonFile<unknown>);
  }

  get path(): string {
    return join(app.getPath('userData'), this.name + '.json');
  }

  private load(): T {
    let data = this.fallback();
    if (existsSync(this.path)) {
      try {
        data = { ...data, ...JSON.parse(readFileSync(this.path, 'utf8')) };
      } catch {
        // Испорченный файл не роняет приложение: начинаем с умолчаний, старый остаётся рядом.
        try { renameSync(this.path, this.path + '.broken'); } catch { /* нет доступа — не страшно */ }
      }
    }
    return data;
  }

  get(): T {
    return (this.data ??= this.load());
  }

  /** Изменить данные и запланировать запись. */
  update(fn: (d: T) => void): void {
    fn(this.get());
    this.dirty = true;
    this.schedule();
  }

  /** Файл ещё не создавался (нужно для «чистой установки» в обучении). */
  isNew(): boolean {
    return !existsSync(this.path) && !this.dirty;
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), 300);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty) return;
    this.dirty = false;
    mkdirSync(app.getPath('userData'), { recursive: true });
    const tmp = this.path + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.get(), null, 1));
    renameSync(tmp, this.path);
  }
}

export function flushAll(): void {
  for (const f of files.values()) {
    try { f.flush(); } catch (e) { console.error('[store] flush', f.path, e); }
  }
}
