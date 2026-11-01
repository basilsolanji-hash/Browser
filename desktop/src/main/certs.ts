import { app, type Session, type WebContents } from 'electron';
import { CertExceptions, PendingErrors, canProceed, codeFromName, hostPort } from './certstore';
import * as Diag from './diag';

/**
 * Перехват ошибок сертификата (electron-часть; логика — в certstore.ts).
 * Решение принимает только `certificate-error`: setCertificateVerifyProc не ставим, чтобы не ломать доверие системы.
 */

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

function onCertError(
  e: Electron.Event, wc: WebContents, url: string, error: string, cert: Electron.Certificate,
  cb: (ok: boolean) => void, isMainFrame: boolean,
): void {
  const hp = hostPort(url);
  const code = codeFromName(error);
  if (!hp || code === null || !cert.fingerprint) { cb(false); return; }
  e.preventDefault();
  // Исключение действует только для точного хоста, порта и сертификата, в своей сессии.
  if (exceptionsOf(wc.session).has(hp.host, hp.port, cert.fingerprint)) {
    if (isMainFrame) insecure.add(wc.id);
    cb(true);
    return;
  }
  cb(false);
  if (!isMainFrame) return;
  // Лог — только хост и код (без отпечатка).
  Diag.log(String(wc.id), `cert ${code} ${hp.host}`);
  // did-fail-load вкладки подберёт запись и откроет os://error/?cert=<токен>.
  pending.dropTab(wc.id);
  pending.add({
    wcId: wc.id,
    sessionKey: sessionKey(wc.session),
    url,
    host: hp.host,
    port: hp.port,
    code,
    fp: cert.fingerprint,
    issuer: cert.issuerName ?? '',
    subject: cert.subjectName ?? '',
    validFrom: cert.validStart,
    validTo: cert.validExpiry,
    selfSigned: code === -202 && !!cert.issuerName && cert.issuerName === cert.subjectName,
    canProceed: canProceed(code, hp.host),
  });
}

export function installCertHandling(): void {
  app.on('certificate-error', onCertError);
}
