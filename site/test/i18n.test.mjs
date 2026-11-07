import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { LANGS } from '../scripts/langs.mjs';
import { LANGS as APP_LANGS } from '../../desktop/scripts/gen-i18n.mjs';
const detect = readFileSync(new URL('../public/js/lang-detect.js', import.meta.url), 'utf8');
function choose(languages, saved = null, denied = false) {
  let redirect = '';
  runInNewContext(detect, {
    navigator: { languages, language: languages[0] },
    location: { pathname: '/', hash: '#download', replace: (url) => { redirect = url; } },
    localStorage: { getItem: () => { if (denied) throw new Error('storage denied'); return saved; } },
  });
  return redirect;
}
test('site languages match the 16 application languages in order', () => {
  assert.deepEqual(LANGS, APP_LANGS);
  assert.equal(LANGS.length, 16);
});
test('six new languages open their own pages, including regional tags', () => {
  for (const [locale, lang] of [['be-BY','be'],['uz-UZ','uz'],['ky-KG','ky'],['tg-TJ','tg'],['kk-KZ','kk'],['hy-AM','hy']]) {
    assert.equal(choose([locale]), `/${lang}/#download`);
    assert.equal(choose(['en-US'], lang), `/${lang}/#download`);
    assert.equal(choose([locale], null, true), `/${lang}/#download`);
  }
});
test('unsupported language fallbacks, preference priority and saved language', () => {
  assert.equal(choose(['ja-JP', 'hy-AM']), '/hy/#download');
  assert.equal(choose(['kk-KZ', 'en-US']), '/kk/#download');
  assert.equal(choose(['uk-UA']), '/ru/#download');
  assert.equal(choose(['ja-JP']), '');
  assert.equal(choose(['hy-AM'], 'en'), '/en/#download');
  assert.equal(choose(['uz-UZ'], 'invalid'), '/uz/#download');
});
test('404 chooses each new language from URL, saved preference or browser', () => {
  const script = readFileSync(new URL('../public/js/not-found.js', import.meta.url), 'utf8');
  for (const lang of LANGS.slice(10)) for (const mode of ['url', 'saved', 'browser']) {
    const blocks = LANGS.map((l) => ({ hidden: true, dir: l === 'ar' ? 'rtl' : 'ltr', getAttribute: (key) => key === 'data-nf' ? l : `404-${l}` }));
    const doc = { querySelectorAll: () => blocks, documentElement: {} };
    runInNewContext(script, { document: doc, location: { pathname: mode === 'url' ? `/${lang}/missing/` : '/missing/' },
      localStorage: { getItem: () => mode === 'saved' ? lang : null }, navigator: { language: mode === 'browser' ? `${lang}-XX` : 'en-US' } });
    assert.equal(doc.documentElement.lang, lang, mode);
    assert.equal(doc.documentElement.dir, 'ltr');
    assert.equal(blocks.filter((b) => !b.hidden).length, 1);
  }
});
