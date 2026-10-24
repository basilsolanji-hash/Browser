import { JsonFile } from './store';
import { t } from './i18n';

/**
 * Фраза дня (Home.kt → Phrases): локально, без сети. Колода перемешивается, каждый день — следующая;
 * пока колода не кончится, фразы не повторяются (и на стыке колод — тоже).
 */
const COUNT = 30;
const file = new JsonFile<{ deck: number[]; pos: number; day: number }>('phrases', () => ({ deck: [], pos: -1, day: -1 }));

function dayNumber(): number {
  const now = new Date();
  return Math.floor((now.getTime() - now.getTimezoneOffset() * 60000) / 86400000);
}

function shuffled(notFirst: number): number[] {
  const list = [...Array(COUNT).keys()];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  if (list[0] === notFirst) list.push(list.shift()!);
  return list;
}

export function today(): string {
  const day = dayNumber();
  const p = file.get();
  const valid = p.deck.length === COUNT && new Set(p.deck).size === COUNT;
  if (valid && p.pos >= 0 && p.pos < COUNT && p.day === day) return t('phrase_' + (p.deck[p.pos] + 1));
  let deck = valid ? p.deck : shuffled(-1);
  let next = valid ? p.pos + 1 : 0;
  if (next >= COUNT) {
    deck = shuffled(deck[COUNT - 1]);
    next = 0;
  }
  file.update((d) => { d.deck = deck; d.pos = next; d.day = day; });
  return t('phrase_' + (deck[next] + 1));
}
