import { randomBytes } from 'node:crypto';

/**
 * Ядро страницы ошибки сертификата — чистая логика без electron (юнит-тесты: test/unit/certstore.test.mjs).
 * Исключения («Перейти на сайт») живут только в памяти: на диск, в резервные копии, диагностику и историю не попадают.
 */

/** Код сети Chromium (net_error_list.h) по имени из `certificate-error` Electron («net::ERR_CERT_DATE_INVALID»). */
const NAMES: Record<string, number> = {
  ERR_CERT_COMMON_NAME_INVALID: -200,
  ERR_CERT_DATE_INVALID: -201,
  ERR_CERT_AUTHORITY_INVALID: -202,
  ERR_CERT_CONTAINS_ERRORS: -203,
  ERR_CERT_NO_REVOCATION_MECHANISM: -204,
  ERR_CERT_UNABLE_TO_CHECK_REVOCATION: -205,
  ERR_CERT_REVOKED: -206,
  ERR_CERT_INVALID: -207,
  ERR_CERT_WEAK_SIGNATURE_ALGORITHM: -208,
  ERR_CERT_NON_UNIQUE_NAME: -210,
  ERR_CERT_WEAK_KEY: -211,
  ERR_CERT_NAME_CONSTRAINT_VIOLATION: -212,
  ERR_CERT_VALIDITY_TOO_LONG: -213,
  ERR_CERTIFICATE_TRANSPARENCY_REQUIRED: -214,
  ERR_CERT_SYMANTEC_LEGACY: -215,
};

/** «net::ERR_CERT_DATE_INVALID» → -201; неизвестное имя → null. */
export function codeFromName(name: string): number | null {
  const n = name.replace(/^net::/, '');
  return Object.prototype.hasOwnProperty.call(NAMES, n) ? NAMES[n] : null;
}

/** -201 → «ERR_CERT_DATE_INVALID» (технический код для «Подробнее»); неизвестный → «ERR_CERT_<код>». */
export function nameFromCode(code: number): string {
  for (const [k, v] of Object.entries(NAMES)) if (v === code) return k;
  return `ERR_CERT_${code}`;
}

/** Ключ строки с причиной простыми словами. */
export function reasonKey(code: number, selfSigned: boolean): string {
  switch (code) {
    case -201: return 'dt_cert_why_expired';
    case -200: return 'dt_cert_why_name';
    case -202: return selfSigned ? 'dt_cert_why_self' : 'dt_cert_why_authority';
    case -206: return 'dt_cert_why_revoked';
    case -205: case -204: return 'dt_cert_why_revcheck';
    case -208: case -211: return 'dt_cert_why_weak';
    case -213: case -214: case -215: case -212: case -210: case -203: case -207: return 'dt_cert_why_invalid';
    default: return 'dt_cert_why_other';
  }
}

/** Это ошибка сертификата (а не любая сетевая)? Диапазон -200..-299 — как в net_error_list.h. */
export function isOverridable(code: number): boolean {
  return Number.isInteger(code) && code <= -200 && code >= -299;
}

/** «host» и порт из адреса; хост — в нижнем регистре и punycode (через URL). null — не http(s) или битый адрес. */
export function hostPort(url: string): { host: string; port: number } | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const host = u.hostname.toLowerCase().replace(/\.$/, '');
    if (!host) return null;
    return { host, port: u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80 };
  } catch {
    return null;
  }
}

/** Исключения одной сессии: точный хост + точный порт + отпечаток. Без поддоменов и родительских доменов. */
export class CertExceptions {
  private map = new Map<string, Set<string>>();
  private static key(host: string, port: number): string {
    return `${host.toLowerCase().replace(/\.$/, '')}:${port}`;
  }
  /** Хост нормализуем через URL (IDN → punycode). */
  private static norm(host: string): string {
    try { return new URL(`https://${host}`).hostname; } catch { return host; }
  }
  allow(host: string, port: number, fp: string): void {
    if (!fp) return;
    const k = CertExceptions.key(CertExceptions.norm(host), port);
    let s = this.map.get(k);
    if (!s) this.map.set(k, (s = new Set()));
    s.add(fp);
  }
  has(host: string, port: number, fp: string): boolean {
    if (!fp) return false;
    return this.map.get(CertExceptions.key(CertExceptions.norm(host), port))?.has(fp) === true;
  }
  clear(): void { this.map.clear(); }
}

/**
 * Выборка из preload-списка HSTS Chromium (не полный: Chromium остаётся последней линией защиты).
 * Целиком TLD — только те, что точно в списке с includeSubDomains.
 */
const PRELOAD_HOSTS = [
  'google.com', 'youtube.com', 'gmail.com', 'googleapis.com', 'gstatic.com', 'googleusercontent.com',
  'github.com', 'facebook.com', 'twitter.com', 'x.com', 'paypal.com', 'accounts.google.com',
];
const PRELOAD_TLDS = ['dev', 'app', 'page', 'new'];

function under(host: string, root: string): boolean {
  return host === root || host.endsWith(`.${root}`);
}

/** Памятка о заголовках Strict-Transport-Security, виденных в этом процессе. */
export class HstsStore {
  private exact = new Set<string>();
  private subs = new Set<string>();
  /** Разобрать заголовок ответа https; max-age=0 снимает запись. */
  note(host: string, header: string): void {
    const h = host.toLowerCase().replace(/\.$/, '');
    if (!h) return;
    const m = /(?:^|;)\s*max-age\s*=\s*"?(\d+)"?/i.exec(header);
    if (!m) return;
    if (Number(m[1]) <= 0) { this.exact.delete(h); this.subs.delete(h); return; }
    this.exact.add(h);
    if (/(?:^|;)\s*includeSubDomains\s*(?:;|$)/i.test(header)) this.subs.add(h);
  }
  known(host: string): boolean {
    const h = host.toLowerCase().replace(/\.$/, '');
    if (this.exact.has(h)) return true;
    for (const s of this.subs) if (under(h, s)) return true;
    return false;
  }
}

export const hsts = new HstsStore();
/** Разбор заголовка Strict-Transport-Security для хоста (вызывается из onHeadersReceived). */
export function noteHsts(host: string, header: string): void { hsts.note(host, header); }

/** Хост из preload-выборки (сам или поддомен) либо в зоне .dev/.app/.page/.new. */
export function isPreloaded(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (PRELOAD_HOSTS.some((r) => under(h, r))) return true;
  const tld = h.slice(h.lastIndexOf('.') + 1);
  return h.includes('.') && PRELOAD_TLDS.includes(tld);
}

/** Можно ли показать «Перейти на сайт»: ошибку нельзя обойти для HSTS/закреплённых хостов и неисправимых кодов. */
export function canProceed(code: number, host: string): boolean {
  if (!isOverridable(code)) return false;
  return !(hsts.known(host) || isPreloaded(host));
}

/** 128-битный непредсказуемый одноразовый токен действий страницы ошибки. */
export function makeToken(): string {
  return randomBytes(16).toString('hex');
}

export interface PendingError {
  wcId: number;
  /** Идентификатор сессии вкладки (раздел), чтобы токен не работал в другой сессии. */
  sessionKey: string;
  url: string;
  host: string;
  port: number;
  code: number;
  fp: string;
  issuer: string;
  subject: string;
  validFrom: number;
  validTo: number;
  selfSigned: boolean;
  canProceed: boolean;
}

/** Ожидающие ошибки по токену. Действия одноразовые; запись живёт, пока жива вкладка. */
export class PendingErrors {
  private byToken = new Map<string, PendingError>();
  add(p: PendingError): string {
    const t = makeToken();
    this.byToken.set(t, p);
    return t;
  }
  /** Данные для показа страницы: только своей вкладке и своей сессии, без удаления. */
  peek(token: string, wcId: number, sessionKey: string): PendingError | null {
    const p = this.byToken.get(token);
    return p && p.wcId === wcId && p.sessionKey === sessionKey ? p : null;
  }
  /** Для показа страницы протокол-обработчиком: у него нет вкладки, только сессия. */
  forSession(token: string, sessionKey: string): PendingError | null {
    const p = this.byToken.get(token);
    return p && p.sessionKey === sessionKey ? p : null;
  }
  /** Забрать для действия: одноразово; чужая вкладка/сессия — отказ без удаления. */
  take(token: string, wcId: number, sessionKey: string): PendingError | null {
    const p = this.peek(token, wcId, sessionKey);
    if (p) this.byToken.delete(token);
    return p;
  }
  /** Последняя ожидающая ошибка вкладки (did-fail-load подбирает то, что записал certificate-error). */
  latestFor(wcId: number): { token: string; p: PendingError } | null {
    let r: { token: string; p: PendingError } | null = null;
    for (const [token, p] of this.byToken) if (p.wcId === wcId) r = { token, p };
    return r;
  }
  /** Вкладка закрыта или ушла на новую навигацию. */
  dropTab(wcId: number): void {
    for (const [t, p] of this.byToken) if (p.wcId === wcId) this.byToken.delete(t);
  }
  get size(): number { return this.byToken.size; }
}

/** Отпечаток Electron «sha256/<base64>» → «AB:CD:…» для показа. Нераспознанное возвращается как есть. */
export function fingerprintHex(fp: string): string {
  const m = /^sha256\/(.+)$/.exec(fp);
  if (!m) return fp;
  const hex = Buffer.from(m[1], 'base64').toString('hex').toUpperCase();
  return hex.replace(/(..)(?=.)/g, '$1:');
}
