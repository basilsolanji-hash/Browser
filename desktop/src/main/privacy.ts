import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Session } from 'electron';
import { settings } from './settings';
import * as Stats from './stats';
import * as Unload from './unload';

/**
 * Защита от слежки (§4 этап 3): блокировка трекеров и майнеров по списку EasyPrivacy (уровень
 * «стандартной» защиты Firefox — только сторонние запросы), «только HTTPS» и изоляция сторонних cookies.
 */
let trackers: Set<string> | null = null;
let blockedTotal = 0;
const perTab = new Map<number, number>();
let onBlocked: (wcId: number) => void = () => {};

function list(): Set<string> {
  if (!trackers) {
    const data = JSON.parse(readFileSync(join(__dirname, '..', 'assets', 'blocklist.json'), 'utf8')) as { domains: string[] };
    trackers = new Set(data.domains);
    // Для приёмки: домены тестового сервера, которые нужно считать трекерами.
    for (const d of (process.env.OS_TEST_BLOCK ?? '').split(',').filter(Boolean)) trackers.add(d);
  }
  return trackers;
}

export const blocklistSize = () => list().size;
export const blockedOnTab = (wcId: number) => perTab.get(wcId) ?? 0;
export const setBlockedListener = (fn: (wcId: number) => void) => { onBlocked = fn; };
export const resetTab = (wcId: number) => perTab.delete(wcId);

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return '';
  }
}

/** Домен или любой его родитель есть в списке. */
function isTracker(host: string): boolean {
  const l = list();
  let h = host;
  for (;;) {
    if (l.has(h)) return true;
    const i = h.indexOf('.');
    if (i < 0) return false;
    h = h.slice(i + 1);
  }
}

// Частые составные публичные суффиксы: «site» для mail.example.co.uk — example.co.uk.
const SECOND_LEVEL = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'ne.jp', 'or.jp',
  'com.br', 'com.tr', 'com.cn', 'net.cn', 'org.cn', 'com.ru', 'co.in', 'co.kr', 'com.mx', 'com.ar', 'co.za', 'com.sg', 'com.hk',
  'com.tw', 'com.ua', 'co.il', 'com.sa', 'com.eg', 'co.id', 'com.my', 'com.ph', 'com.vn', 'spb.ru', 'msk.ru']);

/** Сайт (регистрируемый домен) — по нему решаем, сторонний ли запрос. */
export function siteOf(host: string): string {
  if (!host || /^[\d.]+$/.test(host) || host.includes(':')) return host;
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const last2 = parts.slice(-2).join('.');
  return SECOND_LEVEL.has(last2) ? parts.slice(-3).join('.') : last2;
}

const isLocal = (host: string) => host === 'localhost' || host.endsWith('.localhost') || /^127\./.test(host) || host === '[::1]' ||
  /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(host);

function topHost(details: Electron.OnBeforeRequestListenerDetails | Electron.OnBeforeSendHeadersListenerDetails | Electron.OnHeadersReceivedListenerDetails): string {
  try {
    return hostOf(details.webContents?.getURL() ?? '');
  } catch {
    return '';
  }
}

function thirdParty(reqHost: string, top: string): boolean {
  return !!top && siteOf(reqHost) !== siteOf(top);
}

let pendingStats = 0;
let statsTimer: NodeJS.Timeout | null = null;
function countBlocked(wcId: number | undefined): void {
  blockedTotal++;
  pendingStats++;
  if (wcId != null) {
    perTab.set(wcId, (perTab.get(wcId) ?? 0) + 1);
    onBlocked(wcId);
  }
  // Трекеров на странице бывают десятки — пишем пачками.
  statsTimer ??= setTimeout(() => { statsTimer = null; Stats.trackers(pendingStats); pendingStats = 0; }, 1000);
}

export const totalBlocked = () => blockedTotal;

/** Подключить защиту к сессии сайтов (профиль или инкогнито). */
export function protect(ses: Session): void {
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (d, cb) => {
    const s = settings.get();
    const host = hostOf(d.url);
    if (d.resourceType === 'mainFrame') {
      Unload.noteRequest(d.webContentsId, d.method, d.url, d.uploadData);
      // Только HTTPS: незащищённый адрес повышается; без HTTPS сайт не откроется.
      if (s.httpsOnly && d.url.startsWith('http://') && !isLocal(host)) {
        cb({ redirectURL: 'https://' + d.url.slice('http://'.length) });
        return;
      }
      cb({});
      return;
    }
    if (s.trackingProtection && thirdParty(host, topHost(d)) && isTracker(host)) {
      countBlocked(d.webContentsId);
      cb({ cancel: true });
      return;
    }
    cb({});
  });
  // Сторонние cookies: сайт в рамке или скрипт чужого сайта не читает и не ставит cookies.
  ses.webRequest.onBeforeSendHeaders({ urls: ['http://*/*', 'https://*/*'] }, (d, cb) => {
    if (d.resourceType === 'mainFrame') Unload.noteContentType(d.webContentsId, d.url, d.requestHeaders);
    if (settings.get().blockThirdPartyCookies && d.resourceType !== 'mainFrame' && thirdParty(hostOf(d.url), topHost(d))) {
      const headers = { ...d.requestHeaders };
      delete headers.Cookie;
      delete headers.cookie;
      cb({ requestHeaders: headers });
      return;
    }
    cb({});
  });
  ses.webRequest.onHeadersReceived({ urls: ['http://*/*', 'https://*/*'] }, (d, cb) => {
    if (settings.get().blockThirdPartyCookies && d.resourceType !== 'mainFrame' && thirdParty(hostOf(d.url), topHost(d)) && d.responseHeaders) {
      const headers: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(d.responseHeaders)) if (k.toLowerCase() !== 'set-cookie') headers[k] = v;
      cb({ responseHeaders: headers });
      return;
    }
    cb({});
  });
}
