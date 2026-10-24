import { randomUUID } from 'node:crypto';
import { JsonFile } from './store';

/** Заметки (Notes.kt): только на этом компьютере, никуда не отправляются. */
export interface Note { id: string; text: string; source: string; time: number }

const file = new JsonFile<{ list: Note[] }>('notes', () => ({ list: [] }));

export const all = () => [...file.get().list].sort((a, b) => b.time - a.time);

export function save(id: string | null, text: string, source = ''): Note | null {
  const clean = text.trim();
  if (!clean) {
    if (id) remove(id);
    return null;
  }
  let note: Note | null = null;
  file.update((d) => {
    const cur = id ? d.list.find((n) => n.id === id) : undefined;
    if (cur) {
      cur.text = clean;
      cur.time = Date.now();
      note = cur;
    } else {
      note = { id: 'n' + randomUUID(), text: clean, source, time: Date.now() };
      d.list.push(note);
    }
  });
  return note;
}

export function remove(id: string): void {
  file.update((d) => { d.list = d.list.filter((n) => n.id !== id); });
}
