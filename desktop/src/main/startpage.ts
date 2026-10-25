import { isRtl, t } from './i18n';
import { today } from './phrases';
import type { Palette } from '../shared/types';

/** Локализованная стартовая страница — тот же текст и стиль, что в StartPage.kt. */
const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function startHtml(p: Palette, incognito: boolean): string {
  const dir = isRtl() ? 'rtl' : 'ltr';
  const phrase = incognito ? '' : `<p class="q">${esc(today())}</p>`;
  const hint = incognito ? t('dt_incognito_hint') : t('dt_start_hint');
  return `<!doctype html><html dir="${dir}"><head><meta charset="utf-8"><title>${esc(t('new_tab'))}</title>
<meta name="color-scheme" content="${p.dark ? 'dark' : 'light'}"><style>
html,body{height:100%;margin:0}body{display:flex;flex-direction:column;align-items:center;justify-content:center;
font-family:"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;background:${p.bg};color:${p.text};text-align:center;padding:24px;box-sizing:border-box}
.ring{width:70px;height:70px;border:9px solid ${p.text};border-radius:50%;position:relative;margin-bottom:8px}
.axis{position:absolute;top:50%;left:-34px;width:150px;height:8px;background:${p.accent};transform:translateY(-50%)}
.dot{position:absolute;top:50%;left:-44px;width:18px;height:18px;border-radius:50%;background:${p.accent};transform:translateY(-50%)}
.sq{position:absolute;top:50%;left:110px;width:14px;height:14px;background:${p.accent};transform:translateY(-50%)}
h1{font-size:26px;margin:18px 0 4px}.t{color:${p.accent}}
.b{color:${p.muted};font-size:12px;letter-spacing:.14em;text-transform:uppercase;margin:0 0 12px}
p{color:${p.muted};font-size:14px;max-width:420px;line-height:1.5}
.q{color:${p.text};font-size:17px;font-style:italic;margin:26px 0 0;padding-top:18px;border-top:1px solid ${p.accent}}</style></head>
<body><div class="ring"><div class="axis"></div><div class="dot"></div><div class="sq"></div></div>
<h1>Ось<span class="t">Browser</span></h1>
<p class="b">${esc(incognito ? t('incognito') : t('start_tagline'))}</p>
<p>${esc(hint)}</p>${phrase}</body></html>`;
}

/** Страница ошибки загрузки — текст из переводов Android-версии. */
export function errorHtml(p: Palette, code: number, url: string): string {
  const key = code === -105 || code === -137 ? 'err_uri'
    : code <= -200 && code > -300 ? 'err_security'
    : code === -106 || code === -109 || code === -118 || code === -21 || code === -101 || code === -102 ? 'err_network'
    : 'err_generic';
  const dir = isRtl() ? 'rtl' : 'ltr';
  return `<!doctype html><html dir="${dir}"><head><meta charset="utf-8"><title>${esc(t('page_not_opened'))}</title><style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:${p.bg};color:${p.text};
font-family:"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif}.c{max-width:520px;padding:24px}
h1{font-size:22px;margin:0 0 10px}p{color:${p.muted};line-height:1.5}code{color:${p.muted};font-size:12px;word-break:break-all}
.bar{width:48px;height:4px;background:${p.accent};border-radius:2px;margin-bottom:18px}</style></head>
<body><div class="c"><div class="bar"></div><h1>${esc(t('page_not_opened'))}</h1><p>${esc(t(key))}</p>
<p>${esc(t('dt_err_retry'))}</p><code>${esc(url)} · ${code}</code></div></body></html>`;
}
