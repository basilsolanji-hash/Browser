/** Колода фраз и приветствие (Home.kt → Phrases) — без electron, чтобы проверять юнит-тестами. */
export interface Deck { deck: number[]; pos: number }

/** Следующая фраза: колода перемешана, без повторов, пока не пройдут все; новая не начинается с последней. */
export function nextIndex(d: Deck, count: number, random: () => number = Math.random): { index: number; state: Deck } {
  let deck = d.deck.length === count && new Set(d.deck).size === count ? d.deck : null;
  let pos = d.pos + 1;
  if (!deck || pos >= count) {
    const last = deck ? deck[count - 1] : -1;
    const list = [...Array(count).keys()];
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    if (list[0] === last && count > 1) list.push(list.shift()!);
    deck = list;
    pos = 0;
  }
  return { index: deck[pos], state: { deck, pos } };
}

/** Ключ приветствия по часу: утро 5–11, день 12–16, вечер 17–22, ночь 23–4. */
export function greetingKey(hour: number): string {
  if (hour >= 5 && hour <= 11) return 'greet_morning';
  if (hour >= 12 && hour <= 16) return 'greet_day';
  if (hour >= 17 && hour <= 22) return 'greet_evening';
  return 'greet_night';
}
