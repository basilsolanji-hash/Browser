import { protocol, type Session } from 'electron';
import { readFile } from 'node:fs/promises';
import { join, normalize, sep } from 'node:path';
import { errorHtml, startHtml } from './startpage';
import { INCOGNITO_PALETTE, palette } from './themes';
import { settings } from './settings';

/**
 * Свои страницы — по схеме os:// (protocol.handle), со строгим CSP. В сессиях сайтов доступны только
 * os://start и os://error (без мостов preload); экраны браузера — только в сессии интерфейса.
 */
export function registerScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'os', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

const PAGES = new Set(['home', 'settings', 'profile', 'tabs', 'onboarding', 'notes', 'saved', 'about']);
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.map': 'application/json',
};

const PAGE_CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
  "font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";
const START_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";

const dist = join(__dirname, '..');

function html(body: string, csp: string): Response {
  return new Response(body, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': csp, 'x-content-type-options': 'nosniff' },
  });
}

async function file(dir: string, rel: string): Promise<Response> {
  const base = join(dist, dir);
  const path = normalize(join(base, rel));
  // Защита от выхода из папки (os://ui/../../…).
  if (!path.startsWith(base + sep)) return new Response('', { status: 404 });
  try {
    const ext = path.slice(path.lastIndexOf('.'));
    return new Response(await readFile(path), {
      headers: { 'content-type': TYPES[ext] ?? 'application/octet-stream', 'content-security-policy': PAGE_CSP, 'x-content-type-options': 'nosniff' },
    });
  } catch {
    return new Response('', { status: 404 });
  }
}

function themed(incognito: boolean) {
  return incognito ? INCOGNITO_PALETTE : palette(settings.get().theme);
}

/** Сессия сайтов (профиль или инкогнито): только стартовая страница и страница ошибки. */
export function handleWebSession(ses: Session, incognito: boolean): void {
  if (ses.protocol.isProtocolHandled('os')) return;
  ses.protocol.handle('os', (req) => {
    const u = new URL(req.url);
    if (u.host === 'start') return html(startHtml(themed(incognito), incognito), START_CSP);
    if (u.host === 'error') {
      return html(errorHtml(themed(incognito), Number(u.searchParams.get('code')), u.searchParams.get('url') ?? ''), START_CSP);
    }
    return new Response('', { status: 404 });
  });
}

/** Сессия интерфейса: полоса вкладок (os://ui) и экраны (os://home, os://settings…). */
export function handleUiSession(ses: Session): void {
  if (ses.protocol.isProtocolHandled('os')) return;
  ses.protocol.handle('os', (req) => {
    const u = new URL(req.url);
    const path = decodeURIComponent(u.pathname);
    if (path.startsWith('/assets/')) return file('assets', path.slice('/assets/'.length));
    if (u.host === 'ui') return file('ui', path === '/' ? 'browser.html' : path.slice(1));
    if (PAGES.has(u.host)) return file('pages', path === '/' ? u.host + '.html' : path.slice(1));
    if (u.host === 'start') return html(startHtml(themed(false), false), START_CSP);
    return new Response('', { status: 404 });
  });
}

export const isPanelUrl = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === 'os:' && PAGES.has(u.host);
  } catch {
    return false;
  }
};
