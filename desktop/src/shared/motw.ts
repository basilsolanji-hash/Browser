/**
 * «Скачано из интернета» (Mark-of-the-Web): содержимое альтернативного потока NTFS `<файл>:Zone.Identifier`.
 * ZoneId=3 — зона «Интернет»: Проводник и SmartScreen предупреждают при открытии исполняемых файлов.
 * Чистая функция — без доступа к диску, чтобы проверяться юнит-тестом.
 */
const web = (u: string | null | undefined): string => {
  // Только http(s); data:/blob:/file: и всё прочее не пишем. Переводы строк в адресе недопустимы.
  // eslint-disable-next-line no-control-regex -- NUL в адресе отбрасываем намеренно
  if (!u || !/^https?:\/\//i.test(u) || /[\r\n\u0000]/.test(u)) return '';
  return u;
};

/** Текст Zone.Identifier. В инкогнито — только ZoneId=3 (адреса не оставляем на диске). */
export function zoneIdentifier(opts: { referrer?: string | null; host?: string | null; incognito?: boolean }): string {
  const lines = ['[ZoneTransfer]', 'ZoneId=3'];
  if (!opts.incognito) {
    const ref = web(opts.referrer);
    const host = web(opts.host);
    if (ref) lines.push(`ReferrerUrl=${ref}`);
    if (host) lines.push(`HostUrl=${host}`);
  }
  return lines.join('\r\n') + '\r\n';
}
