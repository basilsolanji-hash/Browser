import { dialog } from 'electron';
import { t } from './i18n';
import { flushAll } from './store';

let active = false;

/** Не закрывать приложение с несохранёнными данными без возможности остаться. */
export function guardStorageBeforeExit(): boolean {
  // Модальный диалог может обработать повторное событие закрытия.
  if (active) return false;
  active = true;
  try {
    while (!flushAll()) {
      const choice = dialog.showMessageBoxSync({
        type: 'warning',
        message: t('dt_storage_save_failed'),
        detail: t('dt_storage_exit_help'),
        buttons: [t('dt_storage_retry'), t('cancel')],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      if (choice !== 0) return false;
    }
    return true;
  } finally {
    active = false;
  }
}
