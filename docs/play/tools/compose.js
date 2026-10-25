// node compose.js <сырые снимки> <выход> <phone|tablet|site>  (site — 1200×1600, пропорция 3:4 для сайта)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const [raw, out, kind] = process.argv.slice(2);
const C = JSON.parse(fs.readFileSync(path.join(__dirname, 'captions.json'), 'utf8'));
const W = kind === 'tablet' ? 2560 : kind === 'site' ? 1200 : 1080, H = kind === 'tablet' ? 1440 : kind === 'site' ? 1600 : 1920;
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: W, height: H } });
  for (const f of fs.readdirSync(raw).filter(x => x.endsWith('.png')).sort()) {
    const m = f.match(/^([a-z]{2})-(\d\d-[a-z]+)\.png$/); if (!m) continue;
    const [lang, key] = [m[1], m[2]]; const cap = C[key]?.[lang]; if (!cap) continue;
    const img = 'data:image/png;base64,' + fs.readFileSync(path.join(raw, f)).toString('base64');
    const shot = kind === 'tablet'
      ? `<img src="${img}" style="height:${H - 330}px;border-radius:28px;border:10px solid #2b2c31;box-shadow:0 30px 80px rgba(0,0,0,.55)">`
      : `<img src="${img}" style="height:${H - 400}px;border-radius:46px;border:14px solid #2b2c31;box-shadow:0 30px 80px rgba(0,0,0,.55)">`;
    await p.setContent(`<html dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><body style="margin:0;width:${W}px;height:${H}px;overflow:hidden;
      background:radial-gradient(circle at 50% 0%, #3d1714 0%, #17181B 60%);font-family:Inter,Roboto,'Segoe UI',system-ui,sans-serif;
      display:flex;flex-direction:column;align-items:center">
      <div style="color:#fff;font-weight:800;font-size:${kind === 'tablet' ? 72 : 68}px;line-height:1.15;text-align:center;
        padding:${kind === 'tablet' ? 70 : 90}px 70px 0;max-width:${W - 140}px;letter-spacing:-.5px">${cap}</div>
      <div style="width:120px;height:8px;background:#F0453A;border-radius:4px;margin:30px 0 ${kind === 'tablet' ? 36 : 44}px"></div>
      ${shot}</body></html>`);
    await p.waitForTimeout(100);
    await p.screenshot({ path: path.join(out, `${lang}-${key}.png`) });
    console.log('ok', lang, key);
  }
  await b.close();
})();
