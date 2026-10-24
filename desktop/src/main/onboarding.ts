import { JsonFile } from './store';
import { profileCount } from './settings';
import { profilesFile, rename, setDescription } from './profiles';
import { pinsFile, save } from './pins';
import { START } from './urls';
import type { Pin } from '../shared/types';

/**
 * Первый запуск (Onboarding.kt): обучение и профили-примеры «Личное», «Работа», «Покупки», «Соцсети».
 * Примеры создаются только на чистой установке; названия хранятся ключами перевода «@…».
 */
export const onboardingFile = new JsonFile<{ done: boolean }>('onboarding', () => ({ done: false }));

export function shouldShow(): boolean {
  if (onboardingFile.get().done) return false;
  if (!profilesFile.isNew() || !pinsFile.isNew()) {
    finish();
    return false;
  }
  seedExamples();
  return true;
}

export function finish(): void {
  onboardingFile.update((d) => { d.done = true; });
}

function seedExamples(): void {
  const start: Pin = { id: 'start', title: 'Старт', url: START };
  const mail: Pin = { id: 'mail', title: '@tab_mail', url: 'https://mail.google.com/' };
  const calendar: Pin = { id: 'calendar', title: '@tab_calendar', url: 'https://calendar.google.com/' };
  const examples: [string, Pin[], number][] = [
    ['ex_personal', [start, mail], 1],
    ['ex_work', [start, mail, calendar], 2],
    ['ex_shopping', [start], 3],
    ['ex_social', [start], 4],
  ];
  for (const [key, pins, id] of examples) {
    if (id > profileCount()) continue;
    rename(id, `@${key}_name`);
    setDescription(id, `@${key}_desc`);
    save(pins, id);
  }
}
