/** Capture real, unmodified Rev2D desktop UI in Chromium on GitHub Actions. */
import { existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';

const chrome=['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/opt/google/chrome/chrome'].find(existsSync);
if(!chrome)throw Error('Chromium unavailable');
const port='4180',url='http://127.0.0.1:'+port+'/';
const server=spawn(process.execPath,['node_modules/vite/bin/vite.js','preview','--config','editor/vite.config.ts','--host','127.0.0.1','--port',port,'--strictPort'],{stdio:'inherit'});
let browser;
try {
 let ok=false;
 for(let i=0;i<100;i++){try{if((await fetch(url)).ok){ok=true;break}}catch{}await delay(200)}
 if(!ok)throw Error('Preview server not ready');
 browser=await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox','--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:1600,height:900},deviceScaleFactor:1});
 const page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 mkdirSync('rev2d-desktop-screens',{recursive:true});
 const snap=async(name)=>{await delay(400);await page.screenshot({path:'rev2d-desktop-screens/'+name+'.png',animations:'disabled'});console.log('SCREENSHOT',name)};
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__rev2d?.stats()?.status==='empty',{timeout:30000});
 await snap('01-start-desktop');
 await page.getByTestId('start-new').click();
 await snap('02-new-project-dialog');
 await page.keyboard.press('Escape');
 const result=await page.evaluate(()=>window.__rev2d.session.createModel({file:'desktop-reference.r2d.json',template:'minimal'}));
 if(!result.ok)throw Error('createModel: '+JSON.stringify(result));
 await page.waitForFunction(()=>window.__rev2d?.stats()?.ready,{timeout:30000});
 await page.evaluate(()=>{const s=window.__rev2d.session;s.setPanel('outliner',true);s.setPanel('inspector',true);s.setPanel('dock',true)});
 await snap('03-rig-editor-full-desktop');
 for(const [i,tab] of ['tree','parts','warps','params','animations','rig'].entries()){
   await page.evaluate(tab=>window.__rev2d.session.store.set({outlinerTab:tab}),tab);
   await snap(String(i+4).padStart(2,'0')+'-outliner-'+tab);
 }
 await page.evaluate(()=>window.__rev2d.session.openDialog({kind:'open'}));
 await snap('10-open-project-dialog');
 await page.keyboard.press('Escape');
 await page.evaluate(()=>window.__rev2d.session.openDialog({kind:'saveAs'}));
 await snap('11-save-as-dialog');
 await page.keyboard.press('Escape');
 await page.evaluate(()=>window.__rev2d.session.store.set({outlinerTab:'tree'}));
 await snap('12-rig-desktop-overview');
 if(errors.length)console.warn('Browser warnings:',errors);
 console.log('Desktop original screenshot capture complete');
}finally{await browser?.close();server.kill('SIGTERM')}
