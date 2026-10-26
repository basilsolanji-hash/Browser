/**
 * Вопрос окном Windows (поверх окна браузера). Приёмка (OS_TEST) отвечает заранее заданными ответами
 * и читает, о чём спросили; без заданного ответа — «Отмена», чтобы тест не завис на окне.
 */
import { dialog, type BrowserWindow, type MessageBoxSyncOptions } from 'electron';

const asked: string[] = [];
const answers: number[] = [];

/** Номер нажатой кнопки. Синхронно: на beforeunload ответ нужен до возврата из обработчика. */
export function askSync(win: BrowserWindow, o: MessageBoxSyncOptions): number {
  if (process.env.OS_TEST === '1') {
    asked.push(o.message);
    return answers.shift() ?? o.cancelId ?? 0;
  }
  return dialog.showMessageBoxSync(win, o);
}

export const testHooks = {
  answer: (...n: number[]) => { answers.push(...n); },
  asked: () => asked.splice(0),
};
