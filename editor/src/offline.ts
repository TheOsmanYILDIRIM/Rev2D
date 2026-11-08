/* Local browser workspace for the GitHub Pages build. No network file uploads. */
import { parseJsonc, parseModelText } from '../../src/core/index.js';
import { formatModelJson } from '../../src/core/format.js';
import minimal from '../../examples/minimal/minimal.r2d.json?raw';
import hana from '../../examples/hana/hana.r2d.json?raw';
import robot from '../../examples/robot-arm/robot-arm.r2d.json?raw';
import slime from '../../examples/slime/slime.r2d.json?raw';
import textured from '../../examples/textured/textured.r2d.json?raw';
type Entry={path:string;text?:string;image?:Blob;mtimeMs:number};
const examples:Record<string,string>={minimal,hana,'robot-arm':robot,slime,textured};
const assets=import.meta.glob('../../examples/**/*.png',{eager:true,query:'?url',import:'default'}) as Record<string,string>;
const root='/mobile', entries=new Map<string,Entry>();
let db:IDBDatabase, selected:string|null=null, recent:string[]=[];
const originalFetch=globalThis.fetch.bind(globalThis);
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const fail=(status:number,error:string)=>response({error},status);
function absolute(input:string):string{
  const rel=String(input).replaceAll('\\','/').replace(/^\/mobile\//,'').replace(/^\/+/,'');
  if(!rel||rel.split('/').some(s=>!s||s==='.'||s==='..'||/[<>:"|?*\x00-\x1f]/.test(s))) throw Error('Invalid workspace path');
  return root+'/'+rel;
}
const relative=(path:string)=>path.slice(root.length+1);
const folder=(path:string)=>relative(path).split('/').slice(0,-1).join('/');
function done<T>(tx:IDBTransaction,request:IDBRequest<T>):Promise<T>{
  return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);tx.onerror=()=>reject(tx.error);});
}
async function setting(key:string,value:unknown){const tx=db.transaction('settings','readwrite');await done(tx,tx.objectStore('settings').put(value,key));}
async function store(f:Entry){const tx=db.transaction('files','readwrite');await done(tx,tx.objectStore('files').put(f));entries.set(f.path,f);}
async function save(path:string,text:string){const e={path,text,mtimeMs:Date.now()};await store(e);return e;}
function active(){
  const e=selected&&entries.get(selected);
  if(!e?.text) throw Error('no model is open');
  return {file:e.path,text:e.text,mtimeMs:e.mtimeMs,notes:[]};
}
async function choose(path:string){
  if(!entries.get(path)?.text) throw Error('model not found: '+path);
  selected=path;recent=[path,...recent.filter(x=>x!==path)].slice(0,10);
  await setting('current',selected);await setting('recent',recent);
  return active();
}
function document(){
  if(!selected) return null;
  const txt=entries.get(selected)?.text;
  const v=txt?parseJsonc(txt):null;
  return v?.ok?v.value as {textures?:Array<{id:string;path:string}>}:null;
}
function newDoc(name:string,width:number,height:number,empty:boolean):Record<string,any>{
  if(empty)return {format:'rev2d',version:1,meta:{name,width,height}};
  const cx=Math.round(width/2),cy=Math.round(height/2),r=Math.round(Math.min(width,height)*0.25);
  return {
    format:'rev2d',version:1,meta:{name,width,height,background:'#20242c'},
    parameters:[{id:'Lean',min:-1,max:1,default:0},{id:'Squash',min:0,max:1,default:0}],
    bones:[{id:'root',x:cx,y:cy+r,length:0}],
    warps:[{id:'bodyWarp',parent:'root',rect:[cx-r-8,cy-r-8,2*r+16,2*r+16],cols:2,rows:2}],
    parts:[
      {id:'body',parent:'bodyWarp',shape:{type:'ellipse',cx,cy,rx:r,ry:r,detail:12},
        fill:{type:'radial',center:[cx-r*.3,cy-r*.3],radius:r*1.4,stops:[[0,'#9be7ff'],[1,'#2f7fd8']]},
        stroke:{color:'#10325e',width:3}},
      {id:'eye',parent:'bodyWarp',shape:{type:'ellipse',cx,cy:cy-Math.round(r*.15),rx:Math.round(r*.12),ry:Math.round(r*.2)},
        fill:'#10325e',z:1},
    ],
    bindings:[
      {target:'warp:bodyWarp.offsets',params:['Lean'],keys:[
        {at:[-1],value:{'0':[-r*.4,0],'1':[-r*.4,0],'2':[-r*.4,0],'3':[-r*.2,0],'4':[-r*.2,0],'5':[-r*.2,0]}},
        {at:[0],value:{}},
        {at:[1],value:{'0':[r*.4,0],'1':[r*.4,0],'2':[r*.4,0],'3':[r*.2,0],'4':[r*.2,0],'5':[r*.2,0]}}],
      },
      {target:'bone:root.scaleY',params:['Squash'],keys:[{at:[0],value:1},{at:[1],value:.8}]},
      {target:'bone:root.scaleX',params:['Squash'],keys:[{at:[0],value:1},{at:[1],value:1.15}]},
    ],
    animations:[{id:'idle',duration:2,loop:true,tracks:[
      {target:'param:Lean',keys:[{t:0,v:-.5,ease:'inOutSine'},{t:1,v:.5,ease:'inOutSine'},{t:2,v:-.5}]},
      {target:'param:Squash',keys:[{t:0,v:0,ease:'inOutSine'},{t:.5,v:.4,ease:'inOutSine'},{t:1,v:0,ease:'inOutSine'},{t:1.5,v:.4,ease:'inOutSine'},{t:2,v:0}]}]}],
  };
}
async function endpoint(url:URL,init:RequestInit):Promise<Response>{
  const method=(init.method||'GET').toUpperCase(),p=url.pathname;
  let b:Record<string,any>={};
  if(typeof init.body==='string'){try{b=JSON.parse(init.body);}catch{return fail(400,'Invalid JSON');}}
  try{
    if(p==='/api/workspace')return response({root,current:selected,recent});
    if(p==='/api/templates')return response([{name:'blank',description:'Starter model'},{name:'empty',description:'Empty canvas'},...Object.keys(examples).map(name=>({name,description:'Example '+name}))]);
    if(p==='/api/files'){
      const dir=url.searchParams.get('dir')||'',prefix=dir?absolute(dir)+'/':root+'/';
      const names=new Set<string>(),out:Array<{name:string;path:string;type:string;size:number;mtimeMs:number}>=[];
      for(const e of entries.values()){
        if(!e.path.startsWith(prefix))continue;
        const rest=e.path.slice(prefix.length),slash=rest.indexOf('/');
        if(slash>=0){names.add(rest.slice(0,slash));continue;}
        if(rest)out.push({name:rest,path:dir?dir+'/'+rest:rest,type:e.text?'model':'image',size:e.text?.length??e.image?.size??0,mtimeMs:e.mtimeMs});
      }
      for(const name of names)out.push({name,path:dir?dir+'/'+name:name,type:'dir',size:0,mtimeMs:0});
      out.sort((a,b)=>(a.type==='dir'?0:1)-(b.type==='dir'?0:1)||a.name.localeCompare(b.name));
      return response({dir,parent:dir?(dir.includes('/')?dir.slice(0,dir.lastIndexOf('/')):''):null,entries:out});
    }
    if(p==='/api/model'){
      if(!selected||!entries.get(selected)?.text)return fail(409,'no model is open');
      if(method==='GET')return response(active());
      if(method==='PUT'){
        if(b.file&&absolute(b.file)!==selected)return response({error:'model switched',file:selected},409);
        const old=entries.get(selected)!;
        if(typeof b.baseMtimeMs==='number'&&b.baseMtimeMs!==old.mtimeMs)return response({error:'file changed',mtimeMs:old.mtimeMs},409);
        const text=typeof b.text==='string'?b.text:formatModelJson(b.doc);
        const diagnostics=parseModelText(text).diagnostics;
        if(!url.searchParams.has('force')&&diagnostics.some(d=>d.severity==='error'))return response({ok:false,written:false,diagnostics,mtimeMs:old.mtimeMs});
        const next=await save(selected,text);
        return response({ok:true,written:true,diagnostics,mtimeMs:next.mtimeMs});
      }
    }
    if(p==='/api/new'&&method==='POST'){
      const input=String(b.file||'');
      const dest=absolute(/\.jsonc?$/i.test(input)?input:input+'.r2d.json');
      if(entries.has(dest)&&!b.overwrite)return fail(409,'file already exists: '+dest);
      const template=String(b.template||'blank');
      if(template!=='blank'&&template!=='empty'&&!(template in examples))return fail(400,'unknown template');
      const w=Number(b.width)||512,h=Number(b.height)||512;
      if(w<1||h<1||w>8192||h>8192)return fail(400,'Invalid canvas size');
      const name=String(b.name||relative(dest).split('/').pop()?.replace(/(\.r2d)?\.jsonc?$/i,'')||'untitled');
      const doc=template in examples?JSON.parse(examples[template]):newDoc(name,w,h,template==='empty');
      doc.meta.name=name;
      await save(dest,formatModelJson(doc));
      if(template in examples){
        for(const t of doc.textures||[]){
          if(typeof t.path!=='string'||t.path.startsWith('data:'))continue;
          const link=assets['../../examples/'+template+'/'+t.path];
          if(!link)continue;
          const res=await originalFetch(link);
          if(res.ok)await store({path:absolute((folder(dest)?folder(dest)+'/':'')+t.path),image:await res.blob(),mtimeMs:Date.now()});
        }
      }
      return response(await choose(dest));
    }
    if(p==='/api/open'&&method==='POST')return response(await choose(absolute(String(b.file))));
    if(p==='/api/save-as'&&method==='POST'){
      if(!selected)return fail(409,'no model is open');
      const input=String(b.file||''),dest=absolute(/\.jsonc?$/i.test(input)?input:input+'.r2d.json');
      if(entries.has(dest)&&dest!==selected&&!b.overwrite)return fail(409,'file already exists: '+dest);
      const old=selected,tx=b.doc?formatModelJson(b.doc):typeof b.text==='string'?b.text:active().text;
      const tex=document()?.textures||[];
      await save(dest,tx);
      for(const t of tex){
        if(typeof t.path!=='string'||t.path.startsWith('data:'))continue;
        const from=absolute((folder(old)?folder(old)+'/':'')+t.path),to=absolute((folder(dest)?folder(dest)+'/':'')+t.path);
        const f=entries.get(from);
        if(f?.image&&from!==to)await store({...f,path:to});
      }
      return response(await choose(dest));
    }
    if(p==='/api/import'&&method==='POST'){
      const dir=String(b.dir||''),files=b.files as Array<{name:string;text?:string;base64?:string}>;
      if(!Array.isArray(files))return fail(400,'Missing files');
      const model=files.find(x=>/\.jsonc?$/i.test(x.name)&&typeof x.text==='string'&&parseModelText(x.text).model);
      if(!model)return fail(422,'Browser mode imports Rev2D JSON + PNG. Spine conversion needs Node.');
      const dest=absolute((dir?dir+'/':'')+model.name);
      if(entries.has(dest)&&!b.overwrite)return fail(409,'file already exists: '+dest);
      for(const f of files){
        const target=absolute((dir?dir+'/':'')+f.name);
        if(typeof f.text==='string')await save(target,f.text);
        else if(f.base64){
          const raw=atob(f.base64.replace(/^data:[^,]*,/,''));
          const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
          await store({path:target,image:new Blob([bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer],{type:'image/png'}),mtimeMs:Date.now()});
        }
      }
      return response(await choose(dest));
    }
    if(p==='/api/close'&&method==='POST'){selected=null;await setting('current',null);return response({root,current:null,recent});}
    if(p.startsWith('/api/texture/')){
      const id=decodeURIComponent(p.slice('/api/texture/'.length));
      const tex=document()?.textures?.find(t=>t.id===id);
      if(!tex)return fail(404,'texture not found: '+id);
      if(tex.path.startsWith('data:'))return originalFetch(tex.path);
      const img=entries.get(absolute((folder(selected!)?folder(selected!)+'/':'')+tex.path))?.image;
      return img?new Response(img,{headers:{'content-type':'image/png'}}):fail(404,'missing PNG '+tex.path);
    }
    if(p==='/api/state'&&method==='POST')return response({ok:true});
    if(p==='/api/screenshot'){
      const canvas=document.querySelector<HTMLCanvasElement>('.ed-viewport-gl');
      if(!canvas)return fail(409,'No viewport');
      const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/png'));
      return blob?new Response(blob,{headers:{'content-type':'image/png'}}):fail(500,'PNG export failed');
    }
    if(p.startsWith('/api/avatar/')||p.startsWith('/api/agent/')||p==='/api/export'||p==='/api/live2d-import')return fail(501,'Requires the Rev2D Node server; unavailable on GitHub Pages');
    return fail(404,'Unsupported browser endpoint '+method+' '+p);
  }catch(e){return fail(400,e instanceof Error?e.message:String(e));}
}
export async function installOfflineBackend():Promise<void>{
  db=await new Promise((resolve,reject)=>{
    const r=indexedDB.open('rev2d-mobile-files',1);
    r.onupgradeneeded=()=>{
      if(!r.result.objectStoreNames.contains('files'))r.result.createObjectStore('files',{keyPath:'path'});
      if(!r.result.objectStoreNames.contains('settings'))r.result.createObjectStore('settings');
    };
    r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
  });
  const tx=db.transaction('files','readonly');
  for(const f of await done(tx,tx.objectStore('files').getAll()) as Entry[])entries.set(f.path,f);
  const getSetting=async(key:string)=>{const t=db.transaction('settings','readonly');return done(t,t.objectStore('settings').get(key));};
  const s=await getSetting('current');selected=typeof s==='string'&&entries.has(s)?s:null;
  const r=await getSetting('recent');recent=Array.isArray(r)?r.filter((x):x is string=>typeof x==='string'&&entries.has(x)).slice(0,10):[];
  globalThis.fetch=((input:RequestInfo|URL,init:RequestInit={})=>{
    const url=new URL(input instanceof Request?input.url:String(input),location.href);
    return url.origin===location.origin&&url.pathname.startsWith('/api/')?endpoint(url,init):originalFetch(input,init);
  }) as typeof fetch;
}
