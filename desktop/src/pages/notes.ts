import { boot, h, iconButton, os, t } from '../shared/ui';
import { confirmDialog, modal } from './common';

/** Заметки (NotesActivity.kt): хранятся только на этом компьютере. */
interface Note { id: string; text: string; source: string; time: number }
const app = document.getElementById('app')!;
app.className = 'wrap';

async function render(): Promise<void> {
  document.title = t('notes');
  const notes = await os.call<Note[]>('notes');
  app.replaceChildren(
    h('div', { class: 'row' }, h('h1', { class: 'grow' }, t('notes')),
      h('button', { class: 'btn accent', id: 'new-note', onclick: () => edit(null) }, t('new_note'))),
    h('div', { class: 'hint' }, t('notes_local')),
    notes.length
      ? h('div', { class: 'card', style: 'margin-top:14px' }, ...notes.map((n) => h('div', { class: 'note' },
        h('div', { class: 'text' }, n.text,
          h('div', { class: 'src' }, new Date(n.time).toLocaleString() + (n.source ? ' · ' + n.source : ''))),
        iconButton('edit', t('edit_tab'), () => edit(n)),
        iconButton('delete', t('delete'), async () => {
          if (await confirmDialog(t('delete_note_q'), '', t('delete'), true)) { await os.call('noteDelete', n.id); void render(); }
        }))))
      : h('div', { class: 'empty' }, t('dt_notes_empty')),
  );
}

function edit(n: Note | null): void {
  const area = h('textarea', { placeholder: t('note_hint') });
  area.value = n?.text ?? '';
  modal((close) => [
    h('h3', null, n ? t('notes') : t('new_note')),
    h('div', { class: 'editor' }, area),
    h('div', { class: 'actions' },
      h('button', { class: 'btn', onclick: close }, t('cancel')),
      h('button', { class: 'btn accent', onclick: async () => { await os.call('noteSave', n?.id ?? null, area.value); close(); void render(); } }, t('save'))),
  ]);
}

void boot(render);
