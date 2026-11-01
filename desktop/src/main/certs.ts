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

/** Субресурс, iframe, worker и WebSocket к хосту:порту с исключением блокируются всегда: исключение — только для главной рамки. */
export function blocksSubresource(ses: Session, url: string): boolean {
  const hp = hostPort(url);
  return !!hp && exceptions.get(ses)?.hasHostPort(hp.host, hp.port) === true;
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

/**
 * Страница главной рамки открылась (did-navigate). Если при этом соединении проверка сертификата хоста провалилась, а
 * исключения на этот хост:порт:отпечаток нет, значит Chromium принял сертификат без нашего события (запомненное решение):
 * останавливаем загрузку и возвращаем токен страницы ошибки. С исключением — только пометка «Не защищено».
 */
export function checkCommitted(wc: WebContents, url: string, navStart: number): string | null {
  const hp = hostPort(url);
  if (!hp || !url.startsWith('https:')) return null;
  const v = verdicts.get(wc.session)?.get(hp.host);
  // Вердикт должен быть свежим: относится к соединению этой навигации (старые — от других страниц и портов).
  if (!v || v.ok || v.ts < navStart - 50 || !v.cert.fingerprint || !isCertCode(v.code)) return null;
  if (exceptionsOf(wc.session).has(hp.host, hp.port, v.cert.fingerprint)) { insecure.add(wc.id); return null; }
  wc.stop();
  return addPending(wc, url, hp.host, hp.port, v.code, v.cert);
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
  // Субресурсы и iframe с плохим сертификатом отклоняются всегда.
  if (isMainFrame && exceptionsOf(wc.session).has(hp.host, hp.port, cert.fingerprint)) {
    insecure.add(wc.id);
    cb(true);
    return;
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
