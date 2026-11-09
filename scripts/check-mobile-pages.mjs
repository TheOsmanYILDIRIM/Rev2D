/**
 * Browser-level smoke test of the exact static Pages bundle.
 * Exercises the real Session, WebGL2 viewport and IndexedDB persistence on a mobile viewport.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';

const chrome=['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/opt/google/chrome/chrome'].find(existsSync);
if(!chrome)throw Error('Chrome/Chromium unavailable on CI runner; cannot claim browser verified');

const port='4179';
const url='http://127.0.0.1:'+port+'/';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--config','editor/vite.config.ts','--host','127.0.0.1','--port',port,'--strictPort'],{stdio:'inherit'});
let browser;
try{
  let ready=false;
  for(let i=0;i<90;i++){
    try{const r=await fetch(url);if(r.ok){ready=true;break;}}catch{}
    await delay(200);
  }
  if(!ready)throw Error('Vite preview did not start');
  browser=await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox','--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1});
  const page=await context.newPage();
  const errors=[];
  const shots=process.env.REV2D_CAPTURE_SCREENSHOTS==='1';
  if(shots)mkdirSync('rev2d-screen-references',{recursive:true});
  const shot=async(name)=>{if(shots)await page.screenshot({path:'rev2d-screen-references/'+name+'.png',fullPage:true,animations:'disabled'});};
  page.on('pageerror',e=>errors.push(e.message));
  const res=await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  if(res?.status()!==200)throw Error('Unexpected index status: '+res?.status());
  await page.waitForFunction(()=>window.__rev2d?.stats()?.status==='empty',{timeout:30000});
  await shot('01-start-mobile');
  await page.getByTestId('start-new').click();
  await shot('02-new-project-dialog-mobile');
  await page.keyboard.press('Escape');
  const result=await page.evaluate(()=>window.__rev2d.session.createModel({file:'smoke.r2d.json',template:'minimal'}));
  if(!result.ok)throw Error('New model creation failed: '+JSON.stringify(result));
  await page.waitForFunction(()=>window.__rev2d?.stats()?.ready,{timeout:30000});
  const initial=await page.evaluate(()=>window.__rev2d.stats());
  // All primary actions must stay on the phone, especially Save (previously clipped).
  const saveBox=await page.getByTestId('save').boundingBox();
  if(!saveBox || saveBox.x<0 || saveBox.x+saveBox.width>391 || saveBox.y+saveBox.height>115)
    throw Error('Phone toolbar clipped the Save action: '+JSON.stringify(saveBox));
  await shot('03-rig-workspace-mobile');
  await page.getByTestId('mobile-workspace').waitFor();
  await page.getByTestId('mobile-wizard').waitFor();
  await page.getByTestId('mobile-enter-advanced').click();
  await page.getByTestId('mobile-tab-inspect').click();
  await page.getByTestId('inspector-panel').waitFor();
  await shot('05-inspect-mobile');
  await page.getByTestId('mobile-tab-timeline').click();
  await page.getByTestId('timeline').waitFor();
  await shot('06-timeline-half-mobile');
  await page.getByRole('button',{name:'Minimize panel'}).click();
  await page.waitForFunction(()=>document.querySelector('[data-testid="mobile-workspace"]')?.getAttribute('data-extent')==='peek');
  await shot('07-timeline-peek-mobile');
  await page.getByRole('button',{name:'Expand panel'}).click();
  await page.getByRole('button',{name:'Expand panel'}).click();
  await page.waitForFunction(()=>document.querySelector('[data-testid="mobile-workspace"]')?.getAttribute('data-extent')==='full');
  const expanded=await page.getByTestId('mobile-workspace').boundingBox();
  if(!expanded || expanded.y<240)throw Error('Expanded timeline hides too much of the canvas: '+JSON.stringify(expanded));
  await shot('08-timeline-full-mobile');
  await page.getByTestId('mobile-tab-panels').click();
  await page.getByTestId('outliner').waitFor();
  await shot('09-panels-mobile');
  const put=await page.evaluate(async()=>window.__rev2d.session.save(true));
  if(!put)throw Error('Model save failed');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__rev2d?.stats()?.ready,{timeout:30000});
  const restored=await page.evaluate(()=>window.__rev2d.stats());
  if(!restored.file.includes('smoke.r2d.json')||restored.errors)throw Error('Model restore failed: '+JSON.stringify(restored));
  // End-to-end wizard: import PNG, arrange, create bone and animation.
  await page.getByTestId('mobile-wizard').waitFor();
  await shot('10-guide-upload');
  await page.getByTestId('wizard-png').setInputFiles({
    name:'part.png',mimeType:'image/png',buffer:readFileSync('editor/src/assets/templates/minimal.png')
  });
  await page.getByTestId('wizard-import').click();
  await page.waitForFunction(()=>window.__rev2d?.session.get().doc?.parts?.some(p=>p.shape?.type==='image'),{timeout:30000});
  await page.getByTestId('wizard-preview').waitFor();
  await shot('11-guide-arrange');
  await page.getByTestId('wizard-next').click();
  await page.getByTestId('wizard-add-bone').click();
  await page.waitForFunction(()=>window.__rev2d?.session.get().doc?.bones?.length>0,{timeout:15000});
  await shot('12-guide-rig');
  await page.getByTestId('wizard-next').click();
  await page.getByTestId('wizard-make-animation').click();
  await page.waitForFunction(()=>window.__rev2d?.session.get().doc?.animations?.length>0,{timeout:15000});
  await page.getByTestId('wizard-another-animation').waitFor();
  await shot('13-guide-animations');
  if(errors.length)throw Error('Uncaught browser JS errors: '+errors.join(' | '));
  await shot('04-restored-project-mobile');
  console.log(JSON.stringify({ok:true,initial,restored,mobileViewport:[390,844],webgl:true,indexeddb:true,screenshots:shots},null,2));
}finally{
  await browser?.close();
  server.kill('SIGTERM');
}
