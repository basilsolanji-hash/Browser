/**
 * «Покинуть страницу?» и «Отправить форму ещё раз?» (WINDOWS_SYNC §21). Без ответа на beforeunload
 * Electron молча оставляет страницу, а обновление страницы после POST молча отменяет — адрес не открывался.
 * Здесь — только решения и данные формы, без окон: модуль проверяется юнит-тестом.
 */
import type { UploadData, UploadFile, UploadRawData } from 'electron';

/** Со страницей не работали дольше — уходим без вопроса. */
export const IDLE_MS = 3 * 60_000;

/** Спрашивать ли перед уходом: только если пользователь недавно работал со страницей. */
export function askBeforeLeave(lastInput: number, now: number): boolean {
  return lastInput > 0 && now - lastInput <= IDLE_MS;
}

interface Post {
  url: string;
  data: UploadData[];
  contentType: string;
}

/** Последний переход вкладки, если он был отправкой формы (по id webContents). */
const posts = new Map<number, Post>();

/** Запрос страницы вкладки (webRequest, mainFrame): POST запоминаем, любой другой — забываем. */
export function noteRequest(wcId: number | undefined, method: string, url: string, data: UploadData[] | undefined): void {
  if (wcId == null) return;
  if (method === 'POST' && data?.length) posts.set(wcId, { url, data, contentType: '' });
  else posts.delete(wcId);
}

/** Тип данных формы — из заголовков того же запроса. */
export function noteContentType(wcId: number | undefined, url: string, headers: Record<string, string>): void {
  const p = wcId == null ? undefined : posts.get(wcId);
  if (!p || p.url !== url) return;
  const k = Object.keys(headers).find((h) => h.toLowerCase() === 'content-type');
  p.contentType = k ? headers[k] : '';
}

export function forget(wcId: number): void {
  posts.delete(wcId);
}

/** Данные для повторной отправки, если показанная страница — ответ на форму. */
export function repostFor(wcId: number, url: string): { postData: (UploadRawData | UploadFile)[]; extraHeaders: string } | null {
  const p = posts.get(wcId);
  if (!p || p.url !== url) return null;
  const postData = toPostData(p.data);
  if (!postData) return null;
  return { postData, extraHeaders: p.contentType ? `Content-Type: ${p.contentType}` : '' };
}

/** Тело запроса из webRequest — в формат loadURL. Blob повторить нельзя — тогда null. */
export function toPostData(data: UploadData[]): (UploadRawData | UploadFile)[] | null {
  const out: (UploadRawData | UploadFile)[] = [];
  for (const d of data) {
    if (d.bytes) out.push({ type: 'rawData', bytes: d.bytes });
    else if (d.file) out.push({ type: 'file', filePath: d.file });
    else return null;
  }
  return out.length ? out : null;
}
