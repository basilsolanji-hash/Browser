/**
 * Меню ссылки и картинки по правой кнопке — как в Chrome (WINDOWS_SYNC §23, образец LinkMenu.kt и
 * showContextMenu в BrowserActivity.kt). Здесь — только какие пункты показать, без Electron: проверяется юнит-тестом.
 */

export type Media = 'image' | 'video' | 'audio';

export interface LinkTarget {
  /** Адрес ссылки: http(s), mailto: или tel:. */
  link: string | null;
  /** Текст ссылки без лишних пробелов. */
  text: string | null;
  /** Адрес картинки, видео или аудио (только http(s)). */
  media: string | null;
  type: Media | null;
}

export type LinkItem =
  | 'open' | 'open_new_tab' | 'open_in_group' | 'open_incognito' | 'open_in_profile'
  | 'copy_link' | 'copy_link_text' | 'download_link' | 'favorite' | 'share_link'
  | 'open_media' | 'download_media' | 'copy_media' | 'share_image';

const isWeb = (u: string) => /^https?:\/\//i.test(u);
const linkOk = (u: string) => isWeb(u) || /^(mailto|tel):/i.test(u);

/** Данные из ContextMenuParams Electron; null — меню ссылки не нужно (javascript:, data:, blob:). */
export function linkTarget(p: { linkURL?: string; linkText?: string; srcURL?: string; mediaType?: string }): LinkTarget | null {
  const link = p.linkURL?.trim() && linkOk(p.linkURL.trim()) ? p.linkURL.trim() : null;
  const kind = p.mediaType === 'image' || p.mediaType === 'video' || p.mediaType === 'audio' ? p.mediaType : null;
  const media = kind && p.srcURL?.trim() && isWeb(p.srcURL.trim()) ? p.srcURL.trim() : null;
  if (!link && !media) return null;
  const text = p.linkText?.replace(/\s+/g, ' ').trim() || null;
  return { link, text, media, type: media ? kind : null };
}

/** Группы пунктов (между группами — разделитель). В инкогнито — без профилей, групп и избранного. */
export function linkMenu(t: LinkTarget, o: { incognito: boolean; otherProfiles: boolean }): LinkItem[][] {
  const open: LinkItem[] = [];
  const copy: LinkItem[] = [];
  const media: LinkItem[] = [];
  const web = !!t.link && isWeb(t.link);
  if (web) {
    if (o.incognito) open.push('open');
    else {
      open.push('open_new_tab', 'open_in_group', 'open_incognito');
      if (o.otherProfiles) open.push('open_in_profile');
    }
  }
  if (t.link) {
    copy.push('copy_link');
    if (t.text) copy.push('copy_link_text');
    if (web) {
      copy.push('download_link');
      if (!o.incognito) copy.push('favorite');
    }
    copy.push('share_link');
  }
  if (t.media) {
    media.push('open_media', 'download_media', 'copy_media');
    if (t.type === 'image') media.push('share_image');
  }
  return [open, copy, media].filter((g) => g.length);
}

/** Ключи перевода пунктов картинки, видео и аудио. */
export function mediaKeys(type: Media): { open: string; download: string; copy: string } {
  return { open: `ctx_open_${type}`, download: `ctx_download_${type}`, copy: `ctx_copy_${type}` };
}
