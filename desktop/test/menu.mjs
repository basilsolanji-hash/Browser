// Меню WINDOW_SYNC §1: порядок групп, прокрутка и 16 языков в настоящем Electron.
import { _electron } from 'playwright';
import electronPath from 'electron';
import { createServer } from 'node:http';
import { writeFileSync, appendFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { LANGS, load } from '../scripts/gen-i18n.mjs';
const root=join(dirname(fileURLToPath(import.meta.url)), '..');
const out=join(root,'menu-results');mkdirSync(out,{recursive:true});writeFileSync(join(out,'checks.txt'),'');
const data=mkdtempSync(join(tmpdir(),'os-menu-'));
writeFileSync(join(data,'onboarding.json'),JSON.stringify({done:true}));
writeFileSync(join(data,'settings.json'),JSON.stringify({lang:'ru',autoUpdate:false}));
const server=createServer((_req,res)=>res.end('<!doctype html><title>Menu test</title><h1>Local menu test</h1>'));
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let app;
const tr=load();
const wait=async(fn)=>{const end=Date.now()+15000;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,100));}throw new Error('menu state timeout');};
const check=(name,value)=>{assert.ok(value,name);appendFileSync(join(out,'checks.txt'),`ok ${name}\n`);};
try {
 app=await _electron.launch({executablePath:electronPath,args:[root,...(process.platform==='linux'?['--no-sandbox']:[])],env:{...process.env,OS_TEST:'1',OS_USER_DATA:data,OS_TEST_DELAY:'800'},timeout:60000});
 const main=(fn,arg)=>app.evaluate(fn,arg);
 await wait(()=>main(()=>globalThis.osTest.windows().length));
 const home=await wait(()=>app.windows().find(p=>p.url().startsWith('os://home/')));
 await main((_e,url)=>{const w=globalThis.osTest.windows()[0];w.win.setBounds({width:1024,height:768});w.openProfile(1);w.newTab(url);},`http://127.0.0.1:${server.address().port}/`);
 const ui=await wait(()=>app.windows().find(p=>p.url().startsWith('os://ui')));
 for(const [col,lang] of LANGS.entries()) {
  await home.evaluate(lang=>window.os.call('setSetting','lang',lang),lang);
  await wait(()=>ui.evaluate(lang=>document.documentElement.lang===lang,lang));
  await ui.click('#more');await ui.waitForSelector('.main-menu');
  const shape=await ui.evaluate(()=>{
   const m=document.querySelector('.main-menu'),r=m.getBoundingClientRect();
   const groups=[...m.children].reduce((a,e)=>{if(e.classList.contains('sep'))a.push([]);else if(a.length&&e.matches('button'))a[a.length-1].push(e.querySelector('.grow')?.textContent);return a;},[]);
   return {groups,round:m.querySelectorAll('.round').length,scroll:m.scrollHeight>m.clientHeight,fits:r.height<=660&&r.bottom<=window.innerHeight&&r.left>=0&&r.right<=window.innerWidth,cut:[...m.querySelectorAll('.grow')].some(e=>e.scrollWidth>e.clientWidth+1)};
  });
  const labels=keys=>keys.map(k=>tr[k][col]);
  check(`${lang}: 5 round actions; fits; labels wrap; scrolls`,shape.round===5&&shape.fits&&!shape.cut&&shape.scroll);
  assert.deepEqual(shape.groups[1],labels(['history','clear_title','site_permissions']));
  assert.deepEqual(shape.groups[2],labels(['cabinet','dl_title','favorites','tabs','saved_pages','notes']));
  assert.deepEqual(shape.groups[3],[]);
  assert.deepEqual(shape.groups[4],labels(['share','find_in_page','reader_mode','copy_link','open_external','dt_mobile_site','full_screen']));
  assert.deepEqual(shape.groups[5].slice(0,3),labels(['settings','help_feedback','diagnostics']));
  check(`${lang}: Android group order`,true);
  if(['ru','ar','kk','hy'].includes(lang))await ui.screenshot({path:join(out,`menu-${lang}-top.png`)});
  await ui.evaluate(()=>{const m=document.querySelector('.main-menu');m.scrollTop=m.scrollHeight;});
  check(`${lang}: bottom actions reachable`,await ui.evaluate(()=>{const m=document.querySelector('.main-menu').getBoundingClientRect(),d=document.querySelector('[data-k="diag"]').getBoundingClientRect();return d.top>=m.top&&d.bottom<=m.bottom;}));
  if(['ru','ar','kk','hy'].includes(lang))await ui.screenshot({path:join(out,`menu-${lang}-bottom.png`)});
  await ui.keyboard.press('Escape');
 }
 await home.evaluate(()=>window.os.call('setSetting','lang','ru'));
 await ui.click('#more');await ui.click('[data-k="notes"]');
 check('Notes opens directly from the main menu',await wait(()=>main(()=>globalThis.osTest.windows()[0].state().panel?.startsWith('os://notes/'))));
 console.log('49 menu checks PASS');
} catch(e){appendFileSync(join(out,'checks.txt'),`FAIL ${e.stack}\n`);throw e;}
finally {if(app)await app.close().catch(()=>{});server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(data,{recursive:true,force:true});}
