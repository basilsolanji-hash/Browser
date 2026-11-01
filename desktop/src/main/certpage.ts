import type { Palette } from '../shared/types';
import { fingerprintHex, nameFromCode, reasonKey, type PendingError } from './certstore';

/** Перевод строки: (ключ, подстановки) → текст. Если ключа нет в словаре, возвращается сам ключ. */
export type Tr = (key: string, ...args: unknown[]) => string;

/**
 * Временные английские строки: настоящие dt_cert_* на 16 языков добавляются на этапе 5.
 * Пока ключа нет в TrDesktop.kt, t() вернёт сам ключ — тогда берём текст отсюда.
 */
const EN: Record<string, string> = {
  dt_cert_title: 'Your connection is not private',
  dt_cert_lead: 'Attackers might be trying to steal your information from %s.',
  dt_cert_back: 'Back to safety',
  dt_cert_details: 'Details',
  dt_cert_proceed: 'Continue to %s (unsafe)',
  dt_cert_no_proceed: "This site requires a secure connection, so the error can't be bypassed.",
  dt_cert_why_expired: "The site's certificate has expired or is not valid yet.",
  dt_cert_why_name: 'The certificate was issued for a different address.',
  dt_cert_why_authority: "Your computer doesn't trust the organization that issued this certificate.",
  dt_cert_why_self: 'The certificate is self-signed: the site vouches for itself.',
  dt_cert_why_revoked: 'The issuer has revoked this certificate.',
  dt_cert_why_revcheck: "Couldn't check whether the certificate has been revoked.",
  dt_cert_why_weak: 'The site uses outdated protection.',
  dt_cert_why_invalid: "The certificate doesn't meet the requirements.",
  dt_cert_why_other: "Couldn't verify that the site is safe.",
  dt_cert_clock: 'Check that the date and time on your computer are correct.',
  dt_cert_issuer: 'Issued by',
  dt_cert_subject: 'Issued to',
  dt_cert_valid: 'Valid from %s to %s',
  dt_cert_fp: 'SHA-256 fingerprint',
  dt_cert_code: 'Error code',
};

const MAX = 200;
/** Всё, что пришло из сертификата и адреса, — недоверенный текст: обрезка и экранирование. */
export const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const clip = (x: string) => (x.length > MAX ? x.slice(0, MAX) + '…' : x);
const safe = (x: string) => esc(clip(x));
/** Управляющие символы и символы направления письма из чужого текста не показываем. */
// eslint-disable-next-line no-control-regex
const clean = (x: string) => x.replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, ' ');

function fmt(s: string, args: unknown[]): string {
  let i = 0;
  return s.replace(/%s/g, () => String(args[i++] ?? ''));
}

/** Красный акцент ошибки: ≥ 4,5:1 на фоне светлых и тёмных тем. */
const bad = (p: Palette) => (p.dark ? '#ff8a80' : '#b3261e');

/** Дата в виде «31.10.2026» по языку интерфейса; битая — прочерк. */
function date(sec: number, locale: string): string {
  const d = new Date(sec * 1000);
  if (!Number.isFinite(sec) || Number.isNaN(d.getTime())) return '—';
  try { return d.toLocaleDateString(locale, { year: 'numeric', month: '2-digit', day: '2-digit' }); } catch { return d.toISOString().slice(0, 10); }
}

/** Адрес с выделенным хостом (остальное приглушено). */
function address(url: string): string {
  try {
    const u = new URL(url);
    const rest = u.pathname + u.search;
    return `<span class="m">${safe(clean(u.protocol + '//'))}</span><b>${safe(clean(u.host))}</b><span class="m">${safe(clean(rest === '/' ? '' : rest))}</span>`;
  } catch {
    return `<b>${safe(clean(url))}</b>`;
  }
}

/**
 * Страница ошибки сертификата. Без скриптов; действия — обычные ссылки os://error/act (их разбирает main).
 * Часы компьютера: подсказка про дату — только для просроченного/ещё не начавшегося сертификата.
 */
export function certHtml(p: Palette, info: PendingError, token: string, tr: Tr, rtl: boolean, locale = 'en'): string {
  const T = (key: string, ...args: unknown[]) => {
    const s = tr(key, ...args);
    return s === key ? fmt(EN[key] ?? key, args) : s;
  };
  const why = reasonKey(info.code, info.selfSigned);
  const dir = rtl ? 'rtl' : 'ltr';
  const act = (a: string) => `os://error/act?t=${encodeURIComponent(token)}&amp;a=${a}`;
  const clock = why === 'dt_cert_why_expired' ? `<p>${esc(T('dt_cert_clock'))}</p>` : '';
  const proceed = info.canProceed
    ? `<p><a class="go" href="${act('proceed')}">${esc(T('dt_cert_proceed', clip(clean(info.host))))}</a></p>`
    : `<p class="m">${esc(T('dt_cert_no_proceed'))}</p>`;
  const row = (k: string, v: string) => `<tr><th>${esc(T(k))}</th><td>${v}</td></tr>`;
  const details = `<details><summary>${esc(T('dt_cert_details'))}</summary><table>
${row('dt_cert_issuer', safe(clean(info.issuer)))}
${row('dt_cert_subject', safe(clean(info.subject)))}
<tr><td colspan="2">${esc(T('dt_cert_valid', date(info.validFrom, locale), date(info.validTo, locale)))}</td></tr>
${row('dt_cert_fp', `<code>${safe(clean(fingerprintHex(info.fp)))}</code>`)}
${row('dt_cert_code', `<code>${esc(nameFromCode(info.code))} (${esc(String(info.code))})</code>`)}
</table></details>`;
  return `<!doctype html><html dir="${dir}"><head><meta charset="utf-8"><title>${esc(T('dt_cert_title'))}</title>
<meta name="color-scheme" content="${p.dark ? 'dark' : 'light'}"><style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:${p.bg};color:${p.text};
font-family:"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif}.c{max-width:560px;padding:24px;box-sizing:border-box}
.bar{width:48px;height:4px;background:${bad(p)};border-radius:2px;margin-bottom:18px}
h1{font-size:24px;margin:0 0 10px;color:${bad(p)}}p{color:${p.muted};line-height:1.55;margin:10px 0}
.a{color:${p.text};word-break:break-all}.m{color:${p.muted}}
.btn{display:inline-block;padding:9px 20px;border-radius:6px;background:${p.accent};color:${p.onAccent};text-decoration:none;font-weight:600}
.btn:focus-visible,.go:focus-visible,summary:focus-visible{outline:2px solid ${p.text};outline-offset:2px}
.go{color:${p.muted};font-size:13px}
details{margin-top:18px;border-top:1px solid ${p.border};padding-top:12px;color:${p.muted}}summary{cursor:pointer;color:${p.text}}
table{border-collapse:collapse;margin-top:10px;font-size:13px;width:100%}th{text-align:start;font-weight:600;padding:4px 12px 4px 0;vertical-align:top;white-space:nowrap}
td{padding:4px 0;word-break:break-word}code{font-size:12px;word-break:break-all}</style></head>
<body><div class="c"><div class="bar"></div><h1>${esc(T('dt_cert_title'))}</h1>
<p class="a">${address(info.url)}</p>
<p>${esc(T('dt_cert_lead', clip(clean(info.host))))}</p>
<p>${esc(T(why))}</p>${clock}
<p><a class="btn" href="${act('back')}" autofocus>${esc(T('dt_cert_back'))}</a></p>
${details}
${proceed}</div></body></html>`;
}

export const CERT_CSP = "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
