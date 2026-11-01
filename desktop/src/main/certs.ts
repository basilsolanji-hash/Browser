import { app, type Session, type WebContents } from 'electron';
import { CertExceptions, PendingErrors, canProceed, codeFromName, hostPort, hsts } from './certstore';
import { registerSiteDataClear } from './clearhooks';
import * as Diag from './diag';
import { JsonFile } from './store';

/**
 * Перехват ошибок сертификата (electron-часть; логика — в certstore.ts).
 * Решение принимает `certificate-error` (хост, порт, отпечаток, только главная рамка). Проверка сертификата
 * (setCertificateVerifyProc) результат Chromium не меняет (-3), а лишь запоминает вердикт по хосту: Chromium мог принять
 * сертификат без события (память принятых сертификатов в сеансе), и после перехода мы это замечаем (`checkCommitted`).
 */

/** HSTS обычных профилей — на диск (до 5000 хостов), стирается вместе с историей и данными сайтов. */
const hstsFile = new JsonFile<{ h: unknown[] }>('hsts', () => ({ h: [] }));

/** Ожидающие ошибки всех вкладок (токен → данные); страницу ошибки и действия читают отсюда. */
export const pending = new PendingErrors();

const exceptions = new WeakMap<Session, CertExceptions>();
const keys = new WeakMap<Session, string>();
let nextKey = 1;
/** Вкладки, главная рамка которых открывается с исключением (пометка «Не защищено»). */
const insecure = new Set<number>();

/** Исключения сессии: профиль и инкогнито разделены, исчезают вместе с сессией. */
export function exceptionsOf(ses: Session): CertExceptions {
  let e = exceptions.get(ses);
  if (!e) exceptions.set(ses, (e = new CertExceptions()));
  return e;
}

/** Стабильный идентификатор сессии: токен ошибки не работает в чужой сессии. */
export function sessionKey(ses: Session): string {
  let k = keys.get(ses);
  if (!k) keys.set(ses, (k = `s${nextKey++}`));
  return k;
}

/** Забрать и сбросить пометку «открыто с исключением» (вызывает вкладка при did-navigate). */
export function takeInsecure(wcId: number): boolean {
  return insecure.delete(wcId);
}

/** Вкладка закрыта или ушла на новую навигацию: токены и пометка не нужны. */
export function dropTab(wcId: number): void {
  pending.dropTab(wcId);
  insecure.delete(wcId);
}

/** Вердикт последней проверки сертификата хоста (setCertificateVerifyProc вызывается на каждое новое соединение). */
interface Verdict { ok: boolean; ts: number; code: number; cert: Electron.Certificate }
const verdicts = new WeakMap<Session, Map<string, Verdict>>();
const VERDICTS_MAX = 500;

/** Подключить к сессии запоминание вердиктов проверки сертификата (результат Chromium не меняем). */
export function guardSession(ses: Session): void {
  const m = new Map<string, Verdict>();
  verdicts.set(ses, m);
  ses.setCertificateVerifyProc((req, cb) => {
    const h = req.hostname.toLowerCase().replace(/\.$/, '');
    m.delete(h);
    m.set(h, { ok: req.verificationResult === 'net::OK', ts: Date.now(), code: req.errorCode, cert: req.certificate });
    while (m.size > VERDICTS_MAX) m.delete(m.keys().next().value as string);
    cb(-3);
  });
}

/** Главный кадр вкладки (webContents), если он открыт на хосте:порту с исключением (пока не ушёл на другой адрес). */
const mainHp = new Map<number, { host: string; port: number }>();

/** Запрос главного кадра вкладки: запоминаем только адреса с исключением (состояние берём из самого запроса — он раньше did-navigate). */
export function noteMainFrame(ses: Session, wcId: number | undefined, url: string): void {
  if (wcId === undefined) return;
  const hp = hostPort(url);
  if (hp && url.startsWith('https:') && exceptions.get(ses)?.hasHostPort(hp.host, hp.port) === true) mainHp.set(wcId, hp);
  else mainHp.delete(wcId);
}

const sameHp = (a: { host: string; port: number } | null | undefined, b: { host: string; port: number }) =>
  !!a && a.host.toLowerCase() === b.host.toLowerCase() && a.port === b.port;

/** Главный кадр этой вкладки сейчас на этом хосте:порту с исключением. */
function tabOnExcepted(wcId: number | undefined, hp: { host: string; port: number }): boolean {
  return wcId !== undefined && sameHp(mainHp.get(wcId), hp);
}

/**
 * Субресурс, iframe, worker и WebSocket к хосту:порту с исключением: разрешены только со страницы этого же хоста:порта в
 * главном кадре этой же вкладки (и из её рамок того же адреса); со страниц других сайтов, из чужих iframe и из других
 * вкладок блокируются.
 */
export function blocksSubresource(
  ses: Session, url: string, wcId: number | undefined, frame: Electron.WebFrameMain | null | undefined, referrer: string,
): boolean {
  const hp = hostPort(url);
  if (!hp || exceptions.get(ses)?.hasHostPort(hp.host, hp.port) !== true) return false;
  if (!tabOnExcepted(wcId, hp)) return true;
  try {
    if (frame) {
      // Вся цепочка рамок от запросившей до главной должна быть на том же хосте:порту.
      for (let f: Electron.WebFrameMain | null = frame; f; f = f.parent) {
        if (f.url && !sameHp(hostPort(f.url), hp)) return true;
      }
      return false;
    }
  } catch { return true; }
  return !sameHp(hostPort(referrer), hp);
}

function addPending(wc: WebContents, url: string, host: string, port: number, code: number, cert: Electron.Certificate): string {
  // Лог — только хост и код (без отпечатка).
  Diag.log(String(wc.id), `cert ${code} ${host}`);
  pending.dropTab(wc.id);
  return pending.add({
    wcId: wc.id,
    sessionKey: sessionKey(wc.session),
    url,
    host,
    port,
    code,
    fp: cert.fingerprint,
    issuer: cert.issuerName ?? '',
    subject: cert.subjectName ?? '',
    validFrom: cert.validStart,
    validTo: cert.validExpiry,
    selfSigned: code === -202 && !!cert.issuerName && cert.issuerName === cert.subjectName,
    canProceed: canProceed(code, host),
  });
}

const isCertCode = (c: number) => Number.isInteger(c) && c <= -200 && c >= -299;

/** Трассировка решений checkCommitted (для приёмки и диагностики; только хост, порт и коды). */
const trace: string[] = [];
const note = (m: string) => { trace.push(m); if (trace.length > 60) trace.shift(); };
export const certTrace = (): string[] => [...trace];

/** Вкладка → адрес, который уже перезагружали с закрытием соединений (повтор — один раз). */
const retried = new Map<number, string>();

export type CommitCheck = { token: string } | 'retry' | null;

/**
 * Страница главной рамки открылась (did-navigate). Если при этом соединении проверка сертификата хоста провалилась, а
 * исключения на этот хост:порт:отпечаток нет, значит Chromium принял сертификат без нашего события (запомненное решение):
 * останавливаем загрузку и возвращаем токен страницы ошибки. С исключением — только пометка «Не защищено».
 * Если свежего вердикта нет (нет вовсе или старый плохой), Chromium мог переиспользовать уже установленное соединение
 * (на Windows — тот же IP:порт под другим именем): вкладка один раз закрывает все соединения сессии и грузит адрес заново
 * ('retry'); на повторе вердикт уже свежий. Хорошие вердикты (net::OK) запоминаются, такие хосты не перезагружаются.
 */
export function checkCommitted(wc: WebContents, url: string, navStart: number): CommitCheck {
  const hp = hostPort(url);
  if (!hp || !url.startsWith('https:')) { retried.delete(wc.id); return null; }
  const tag = `${hp.host}:${hp.port}`;
  const v = verdicts.get(wc.session)?.get(hp.host.toLowerCase());
  const fresh = !!v && v.ts >= navStart - 50;
  if (v && v.ok) { retried.delete(wc.id); note(`${tag} ok${fresh ? '' : ' (old)'}`); return null; }
  const excepted = !!v && !!v.cert.fingerprint && exceptionsOf(wc.session).has(hp.host, hp.port, v.cert.fingerprint);
  if (v && fresh && v.cert.fingerprint && isCertCode(v.code)) {
    retried.delete(wc.id);
    if (excepted) { insecure.add(wc.id); note(`${tag} excepted ${v.code}`); return null; }
    wc.stop();
    note(`${tag} bad ${v.code} -> error page`);
    return { token: addPending(wc, url, hp.host, hp.port, v.code, v.cert) };
  }
  // Свежего вердикта нет.
  if (excepted) { retried.delete(wc.id); insecure.add(wc.id); note(`${tag} excepted (old verdict)`); return null; }
  if (retried.get(wc.id) !== url) {
    retried.set(wc.id, url);
    note(`${tag} no fresh verdict (${v ? `old ${v.code}` : 'none'}) -> close connections, reload`);
    Diag.log(String(wc.id), `cert recheck ${hp.host}`);
    wc.stop();
    return 'retry';
  }
  retried.delete(wc.id);
  note(`${tag} still no verdict after reload (${v ? `old ${v.code}` : 'none'}) -> allowed`);
  return null;
}

function onCertError(
  e: Electron.Event, wc: WebContents, url: string, error: string, cert: Electron.Certificate,
  cb: (ok: boolean) => void, isMainFrame: boolean,
): void {
  const hp = hostPort(url);
  const code = codeFromName(error);
  if (!hp || code === null || !cert.fingerprint) { cb(false); return; }
  e.preventDefault();
  // Исключение — только главной рамке вкладки и только для точного хоста, порта и сертификата, в своей сессии.
  // Субресурсы того же хоста:порта:отпечатка — только со страницы этого же адреса в главном кадре той же вкладки, остальные отклоняются.
  if (exceptionsOf(wc.session).has(hp.host, hp.port, cert.fingerprint)) {
    if (isMainFrame) { insecure.add(wc.id); cb(true); return; }
    // Новое соединение субресурса: тот же хост:порт:отпечаток и главный кадр этой вкладки на нём же (чужие отсечены в onBeforeRequest).
    if (tabOnExcepted(wc.id, hp)) { cb(true); return; }
  }
  cb(false);
  if (!isMainFrame) return;
  // did-fail-load вкладки подберёт запись и откроет os://error/?cert=<токен>.
  addPending(wc, url, hp.host, hp.port, code, cert);
}

export function installCertHandling(): void {
  hsts.load(hstsFile.get().h);
  hsts.onChange = () => hstsFile.update((d) => { d.h = hsts.dump(); });
  registerSiteDataClear(() => hsts.clear());
  app.on('certificate-error', onCertError);
}
