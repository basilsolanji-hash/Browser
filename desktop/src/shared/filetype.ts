/**
 * Тип скачанного файла (DownloadsActivity.kt → kindOf, Downloads.effectiveMime): по MIME, а если сервер
 * прислал «application/octet-stream» или ничего — по расширению. Без electron: используется и в тестах.
 */
export type FileKind = 'images' | 'audio' | 'video' | 'docs' | 'other';
export const FILE_KINDS: ('all' | FileKind)[] = ['all', 'images', 'audio', 'video', 'docs', 'other'];

const EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  svg: 'image/svg+xml', ico: 'image/x-icon', avif: 'image/avif', heic: 'image/heic', tif: 'image/tiff', tiff: 'image/tiff',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', opus: 'audio/opus',
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', mov: 'video/quicktime', avi: 'video/x-msvideo', wmv: 'video/x-ms-wmv',
  pdf: 'application/pdf', txt: 'text/plain', log: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', xml: 'text/xml',
  html: 'text/html', htm: 'text/html', rtf: 'application/rtf', odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet', odp: 'application/vnd.oasis.opendocument.presentation',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed', exe: 'application/vnd.microsoft.portable-executable',
  msi: 'application/x-msi', apk: 'application/vnd.android.package-archive',
};

export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

export const mimeByExt = (name: string): string => EXT[extOf(name)] ?? '';

/** MIME от сервера, а если он «ничего не сказал» — по расширению имени. */
export function effectiveMime(mime: string | undefined, name: string): string {
  const m = (mime ?? '').split(';')[0].trim().toLowerCase();
  if (!m || m === 'application/octet-stream' || m === 'binary/octet-stream' || m === 'application/force-download') return mimeByExt(name) || m || 'application/octet-stream';
  return m;
}

export function kindOf(mime: string | undefined, name: string): FileKind {
  const m = effectiveMime(mime, name);
  if (m.startsWith('image/')) return 'images';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('text/') || m === 'application/pdf' || m.includes('document') || m.includes('msword') || m.includes('spreadsheet') ||
    m.includes('presentation') || m.includes('ms-excel') || m.includes('ms-powerpoint') || m === 'application/json' || m === 'application/rtf') return 'docs';
  return 'other';
}

/** Что открывается во вкладке Оси: PDF, картинки и простой текст (HTML — нет: это был бы чужой сайт без адреса). */
export function viewableInOs(mime: string): boolean {
  if (mime === 'application/pdf') return true;
  if (/^image\/(png|jpeg|gif|webp|bmp|svg\+xml|x-icon|avif)$/.test(mime)) return true;
  return mime === 'text/plain' || mime === 'text/csv' || mime === 'text/markdown' || mime === 'application/json' || mime === 'text/xml';
}

/** Фильтр экрана загрузок: чип типа и поиск по имени. */
export function matchesDownload(d: { name: string; mime?: string }, filter: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return (filter === 'all' || kindOf(d.mime, d.name) === filter) && (!q || d.name.toLowerCase().includes(q));
}

/** «12 KB», «3.4 MB» — с десятичным разделителем языка. */
export function formatSize(n: number, lang = 'en'): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = Math.max(0, n);
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  const digits = i === 0 || v >= 100 ? 0 : 1;
  return `${new Intl.NumberFormat(lang, { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(v)} ${units[i]}`;
}

/** Оставшееся время загрузки: секунды до минуты, дальше — минуты (вверх). null — неизвестно. */
export function etaParts(seconds: number | null | undefined): { unit: 'sec' | 'min'; value: number } | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 60) return { unit: 'sec', value: Math.max(1, Math.round(seconds)) };
  return { unit: 'min', value: Math.ceil(seconds / 60) };
}
