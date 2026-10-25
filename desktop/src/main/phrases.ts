import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JsonFile } from './store';
import { currentLang, t } from './i18n';
import { greetingKey, nextIndex, type Deck } from './phrasedeck';

/**
 * Позитивные фразы (Home.kt → Phrases): 300 штук на 10 языках, локально (assets/phrases/<язык>.txt,
 * строка N — одна и та же фраза на всех языках). Новая фраза при каждом показе, без повторов.
 */
const file = new JsonFile<Deck>('phrases', () => ({ deck: [], pos: -1 }));
const cache = new Map<string, string[]>();

function all(code: string): string[] {
  let list = cache.get(code);
  if (!list) {
    try {
      list = readFileSync(join(__dirname, '..', 'assets', 'phrases', code + '.txt'), 'utf8').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    } catch {
      list = [];
    }
    cache.set(code, list);
  }
  return list.length || code === 'en' ? list : all('en');
}

export function next(): string {
  const list = all(currentLang());
  if (!list.length) return '';
  const { index, state } = nextIndex(file.get(), list.length);
  file.update((d) => { d.deck = state.deck; d.pos = state.pos; });
  return list[index] ?? '';
}

export const greeting = (hour = new Date().getHours()) => t(greetingKey(hour));
