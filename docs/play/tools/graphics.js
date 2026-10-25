const { chromium } = require('playwright');
const fs = require('fs');
const out = process.argv[2] || require('path').join(__dirname, '..', 'graphics');
const ACC = '#F0453A', BG = '#17181B';
const wordmark = (text) => `<svg viewBox="0 0 1200 360" xmlns="http://www.w3.org/2000/svg">
<path fill="${ACC}" d="M53,172H1150V188H53Z"/><path fill="${ACC}" d="M8,180a45,45 0 1,0 90,0a45,45 0 1,0 -90,0z"/>
<path fill="${ACC}" d="M1110,142H1190V220H1110Z"/>
<path fill="none" stroke="${text}" stroke-width="55" d="M157.5,180a157.5,142.5 0 1,0 315,0a157.5,142.5 0 1,0 -315,0z"/>
<path fill="none" stroke="${text}" stroke-width="55" d="M770,92.5H635A92.5,92.5 0 0,0 635,277.5H770"/>
<path fill="none" stroke="${text}" stroke-width="56" d="M839,62V305M839,163H970A57,57 0 0,1 970,277H839"/></svg>`;
const icon = `<svg viewBox="0 0 108 108" width="512" height="512" xmlns="http://www.w3.org/2000/svg">
<rect width="108" height="108" fill="${BG}"/>
<g transform="translate(54 54) scale(1.32) translate(-54 -54)">
<path fill="${ACC}" d="M27,52.5H80V55.5H27Z"/><path fill="${ACC}" d="M20,54a6,6 0 1,0 12,0a6,6 0 1,0 -12,0z"/>
<path fill="${ACC}" d="M77,49H86V58H77Z"/>
<path fill="none" stroke="#FFFFFF" stroke-width="7" d="M35,54a19,17.5 0 1,0 38,0a19,17.5 0 1,0 -38,0z"/></g></svg>`;
const feature = (title, sub, chips, rtl) => `<html><head><style>
body{margin:0;width:1024px;height:500px;overflow:hidden;font-family:'Inter','Segoe UI',Roboto,'Noto Sans','Noto Sans Devanagari','Noto Sans Arabic','Noto Sans CJK SC',system-ui,sans-serif;
background:radial-gradient(circle at 78% 40%, #3a1715 0%, ${BG} 55%);color:#fff;display:flex;align-items:center}
.l{padding-left:64px;width:500px}.wm{width:360px}.t{font-size:44px;font-weight:800;line-height:1.1;margin:26px 0 14px;letter-spacing:-.5px}
.s{font-size:20px;color:#c9c9cf;line-height:1.4}.chips{margin-top:26px;display:flex;gap:10px;flex-wrap:wrap}
.c{border:1.5px solid #4a4a52;border-radius:999px;padding:8px 16px;font-size:17px;color:#e8e8ec}
.r{position:absolute;right:70px;top:70px;width:300px;height:360px}
.ring{position:absolute;right:120px;top:120px;width:220px;height:220px;border-radius:50%;border:34px solid #fff;box-sizing:border-box}
.axis{position:absolute;right:40px;top:224px;width:370px;height:14px;background:${ACC}}
.dot{position:absolute;right:400px;top:211px;width:40px;height:40px;border-radius:50%;background:${ACC}}
.sq{position:absolute;right:28px;top:213px;width:36px;height:36px;background:${ACC}}
</style></head><body><div class="l" dir="${rtl ? 'rtl' : 'ltr'}" style="text-align:${rtl ? 'right' : 'left'}"><div class="wm" style="${rtl ? 'margin-left:auto' : ''}" dir="ltr">${wordmark('#fff')}</div>
<div class="t">${title}</div><div class="s">${sub}</div>
<div class="chips">${chips.map(c=>`<span class="c">${c}</span>`).join('')}</div></div>
<div class="axis"></div><div class="dot"></div><div class="sq"></div><div class="ring"></div></body></html>`;
const T = {
  ru: ['Приватный<br>бизнес-браузер', 'Отдельные профили для работы и личного.<br>Пароли и заметки — только на телефоне.', ['Профили', 'Пароли', 'Заметки', 'Без рекламы']],
  en: ['Private<br>business browser', 'Separate profiles for work and life.<br>Passwords and notes stay on your phone.', ['Profiles', 'Passwords', 'Notes', 'No ads']],
  es: ['Navegador<br>privado para negocios', 'Perfiles separados para trabajo y vida.<br>Contraseñas y notas, solo en tu móvil.', ['Perfiles', 'Contraseñas', 'Notas', 'Sin anuncios']],
  pt: ['Navegador<br>privado para negócios', 'Perfis separados para trabalho e vida.<br>Senhas e notas só no seu celular.', ['Perfis', 'Senhas', 'Notas', 'Sem anúncios']],
  fr: ['Navigateur<br>privé et pro', 'Des profils séparés pour le travail et la vie.<br>Mots de passe et notes sur votre téléphone.', ['Profils', 'Mots de passe', 'Notes', 'Sans pub']],
  de: ['Privater<br>Business-Browser', 'Getrennte Profile für Arbeit und Privates.<br>Passwörter und Notizen nur auf dem Handy.', ['Profile', 'Passwörter', 'Notizen', 'Ohne Werbung']],
  ar: ['متصفح أعمال<br>يحترم خصوصيتك', 'ملفات منفصلة للعمل والحياة.<br>كلمات المرور والملاحظات على هاتفك فقط.', ['ملفات', 'كلمات المرور', 'ملاحظات', 'بلا إعلانات']],
  hi: ['निजी<br>बिज़नेस ब्राउज़र', 'काम और निजी ज़िंदगी के लिए अलग प्रोफ़ाइल।<br>पासवर्ड और नोट्स सिर्फ़ आपके फ़ोन पर।', ['प्रोफ़ाइल', 'पासवर्ड', 'नोट्स', 'बिना विज्ञापन']],
  tr: ['Gizli<br>iş tarayıcısı', 'İş ve özel hayat için ayrı profiller.<br>Parolalar ve notlar yalnızca telefonunuzda.', ['Profiller', 'Parolalar', 'Notlar', 'Reklamsız']],
  zh: ['私密的<br>商务浏览器', '工作与生活使用独立资料。<br>密码和笔记只保存在你的手机上。', ['多资料', '密码', '笔记', '无广告']],
};
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 512, height: 512 } });
  await p.setContent(`<html><body style="margin:0">${icon}</body></html>`);
  await p.screenshot({ path: `${out}/icon-512.png` });
  await p.setViewportSize({ width: 1024, height: 500 });
  for (const [lang, [title, sub, chips]] of Object.entries(T)) {
    await p.setContent(feature(title, sub, chips, lang === 'ar'));
    await p.screenshot({ path: `${out}/feature-graphic-${lang}.png` });
    console.log('ok', lang);
  }
  await b.close();
})();
