import { writeFileSync } from 'node:fs';
import { zoneIdentifier } from '../shared/motw';

/**
 * Пометить файл «скачано из интернета» (Windows): поток `<файл>:Zone.Identifier`.
 * Electron сам этого не делает (в Chrome это Attachment Services). Не Windows, FAT32, сетевой диск — молча пропускаем.
 * Возвращает true, если поток записан.
 */
export function markFromInternet(path: string, opts: { referrer?: string | null; host?: string | null; incognito?: boolean }): boolean {
  if (process.platform !== 'win32') return false;
  try {
    writeFileSync(`${path}:Zone.Identifier`, zoneIdentifier(opts));
    return true;
  } catch {
    return false;
  }
}
