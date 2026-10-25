/** Типы, общие для главного процесса, интерфейса и своих страниц. */

export interface Palette {
  dark: boolean;
  bg: string; surface: string; border: string;
  text: string; muted: string; accent: string; onAccent: string;
}

export interface Pin { id: string; title: string; url: string }

export interface TabGroup { id: string; name: string; color: string }

/** Элемент полосы вкладок: закреплённая вкладка или обычная. */
export interface StripTab {
  id: string;
  pinned: boolean;
  title: string;
  url: string;
  group: string | null;
  loading: boolean;
  favicon: string | null;
}

export interface ProfileInfo {
  id: number;
  name: string;
  color: string;
  email: string | null;
  unread: number;
  description: string;
  files: number;
  active: boolean;
  pins: Pin[];
  ownPins: boolean;
  /** Закреплён (всегда сверху списка). */
  pinned: boolean;
  /** Последний открытый профиль — отмечен рамкой и галочкой. */
  current: boolean;
  /** Папка на главном экране ('' — без папки). */
  folder: string;
}

/** Состояние окна для интерфейса браузера (полоса вкладок, адресная строка). */
export interface WindowState {
  incognito: boolean;
  profile: ProfileInfo | null;
  tabs: StripTab[];
  groups: TabGroup[];
  active: string | null;
  url: string;
  title: string;
  canBack: boolean;
  canForward: boolean;
  loading: boolean;
  secure: boolean;
  panel: string | null;
  panelTitle: string;
  panelCanBack: boolean;
  maximized: boolean;
  zoom: number;
  /** Строка «Найти на странице»: текст, номер текущего совпадения, всего совпадений. */
  find: { text: string; active: number; matches: number } | null;
  bookmarked: boolean;
  /** Запрос разрешения сайта для текущей вкладки. */
  prompt: { id: number; text: string; canRemember: boolean } | null;
  /** Сколько трекеров заблокировано на текущей вкладке. */
  blocked: number;
  locked: boolean;
  lockEnabled: boolean;
  reader: boolean;
  /** Вкладка открыта в мобильной версии сайта. */
  mobile: boolean;
  /** Ось — браузер по умолчанию (тогда пункт «Сделать браузером по умолчанию» не нужен). */
  isDefault: boolean;
  fullscreen: boolean;
  /** Выбранный поисковик (значок слева в строке при вводе). */
  engine: string;
  /** Что стоит на кнопке справа от адресной строки. */
  toolbarButton: string;
  /** Есть хотя бы одна загрузка (кнопка «Загрузки» на панели появляется после первой). */
  hasDownloads: boolean;
}

export interface Suggestion { kind: 'search' | 'query' | 'history' | 'favorite' | 'url'; title: string; url: string }
export interface Tile { host: string; label: string; url: string }

export interface UiInit {
  lang: string;
  rtl: boolean;
  strings: Record<string, string>;
  palette: Palette;
  themeId: string;
  platform: string;
  version: string;
}
