import { JsonFile } from './store';

/** Настройки приложения (как Settings.kt / Search.kt / Home.kt). */
export const MIN_PROFILES = 1;
export const MAX_PROFILES = 50;

export interface SettingsData {
  lang: string;
  theme: string;
  engine: string;
  profileCount: number;
  homeMode: 'OS' | 'BLANK' | 'CUSTOM';
  homeUrl: string;
  zoom: number;
  trackingProtection: boolean;
  httpsOnly: boolean;
  blockThirdPartyCookies: boolean;
  hideContent: boolean;
  /** PIN входа: соль и хеш scrypt (сам PIN не хранится). */
  lock: { salt: string; hash: string } | null;
  autoUpdate: boolean;
}

export const settings = new JsonFile<SettingsData>('settings', () => ({
  lang: 'system',
  theme: 'scarlet_dark',
  engine: 'ddg',
  profileCount: 15,
  homeMode: 'OS',
  homeUrl: '',
  zoom: 100,
  trackingProtection: true,
  httpsOnly: false,
  blockThirdPartyCookies: true,
  hideContent: false,
  lock: null,
  autoUpdate: true,
}));

export const profileCount = () =>
  Math.min(MAX_PROFILES, Math.max(MIN_PROFILES, Math.trunc(settings.get().profileCount) || 15));

/** Поисковые системы; по умолчанию приватная DuckDuckGo. */
export const ENGINES = [
  { id: 'ddg', title: 'DuckDuckGo', query: 'https://duckduckgo.com/?q=' },
  { id: 'startpage', title: 'Startpage', query: 'https://www.startpage.com/sp/search?query=' },
  { id: 'brave', title: 'Brave', query: 'https://search.brave.com/search?q=' },
  { id: 'google', title: 'Google', query: 'https://www.google.com/search?q=' },
  { id: 'bing', title: 'Bing', query: 'https://www.bing.com/search?q=' },
  { id: 'yandex', title: 'Яндекс', query: 'https://yandex.ru/search/?text=' },
];

export const engine = () => ENGINES.find((e) => e.id === settings.get().engine) ?? ENGINES[0];

export const searchUrl = (text: string) => engine().query + encodeURIComponent(text);
