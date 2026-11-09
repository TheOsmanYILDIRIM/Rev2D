/** Beginner path over the real Rev2D document. Uses regular file import and validated edits. */
import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent } from 'react';
import { textureUrl } from '../api.js';
import { useApp, useSession } from '../state/context.js';
import type { RawDoc } from '../state/doc.js';
import './mobile-wizard.css';

type Item=Record<string, any>;
const steps=[
  {title:'PNG yükle',tip:'Karakter parçalarının şeffaf PNG dosyalarını seç.'},
  {title:'Parçaları yerleştir',tip:'Parçaya dokunup küçük tuvalde sürükle; ölçülerini değiştir.'},
  {title:'Rig oluştur',tip:'Parçaları kemiklere bağla ve eklem noktalarını ayarla.'},
  {title:'İlk animasyon',tip:'Seçtiğin kemiğe basit bir salınım animasyonu ekle.'},
  {title:'Diğer animasyonlar',tip:'Yeni animasyonlar ekle, seç, oynat ve projeyi kaydet.'},
] as const;
const arr=(v:unknown):Item[]=>Array.isArray(v)?v as Item[]:[];
const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
function docSize(doc:RawDoc|null) {
  const meta=(doc?.meta??{}) as Item;
  return {w:Number(meta.width)||512,h:Number(meta.height)||512};
}
function plainName(name:string):string {
  return name.normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,36)||'piece';
}
export function MobileWizard() {
  const session=useSession(),doc=useApp(s=>s.doc),file=useApp(s=>s.file),playing=useApp(s=>s.playing);
  const animation=useApp(s=>s.animation);
  const [step,setStep]=useState(0),[selected,setSelected]=useState('');
  const [pngs,setPngs]=useState<File[]>([]);
  const [previewUrls,setPreviewUrls]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [duration,setDuration]=useState(2),[angle,setAngle]=useState(20),[motionName,setMotionName]=useState('idle');
  const [draft,setDraft]=useState<{id:string;x:number;y:number}|null>(null);
  const preview=useRef<HTMLDivElement>(null);
  const contentRef=useRef<HTMLDivElement>(null);
  const dragging=useRef<{id:string;x:number;y:number;left:number;top:number}|null>(null);
  const pieces=arr(doc?.parts).filter(p=>p.shape?.type==='image');
  const textures=arr(doc?.textures),bones=arr(doc?.bones),animations=arr(doc?.animations);
  const {w,h}=docSize(doc);
  const chosen=pieces.find(p=>p.id===selected)??pieces[0];
  const boneTarget=bones.find(b=>b.id===selected)||bones.find(b=>b.id===chosen?.parent)||bones[0];
  const bound=pieces.filter(p=>typeof p.parent==='string'&&bones.some(b=>b.id===p.parent)).length;
  const complete=[textures.length>0,pieces.length>0,bound>0,animations.length>0,true];
  const textureKey=JSON.stringify(textures.map(t=>[t.id,t.path]));
  useEffect(()=>{
    let live=true;
    const urls:string[]=[];
    setPreviewUrls({});
    void Promise.all(textures.map(async tex=>{
      const res=await fetch(textureUrl(tex.id,session.textureVersion));
      if(!res.ok)throw new Error('Texture unavailable: '+tex.id);
      const url=URL.createObjectURL(await res.blob());
      urls.push(url);
      return [tex.id,url] as const;
    })).then(pairs=>{
      if(live)setPreviewUrls(Object.fromEntries(pairs));
    }).catch(()=>{if(live)setPreviewUrls({});});
    return()=>{live=false;for(const u of urls)URL.revokeObjectURL(u);};
  },[file,textureKey,session.textureVersion]);
  useEffect(()=>{
    const saved=Number(sessionStorage.getItem('rev2d-guide:'+file));
    const initial=textures.length?1:0;
    setStep(Number.isInteger(saved)&&saved>=initial&&saved<=4?saved:initial);
    setSelected('');setPngs([]);setError('');
  },[file]);
  useEffect(()=>{if(contentRef.current)contentRef.current.scrollTop=0;},[step]);
  const go=(n:number)=>{
    const next=clamp(n,0,4);
    setError('');setStep(next);
    if(file)sessionStorage.setItem('rev2d-guide:'+file,String(next));
  };
  const notify=(message:string)=>{setError(message);if(message)session.toast('error',message);};
  const selectFiles=(e:ChangeEvent<HTMLInputElement>)=>{
    const files=Array.from(e.currentTarget.files??[]);
    setPngs(files);setError('');
  };
  const importPngs=async()=>{
    if(!pngs.length){notify('Önce en az bir PNG seç.');return;}
    if(pngs.length>20||pngs.some(f=>f.type!=='image/png'&&!f.name.toLowerCase().endsWith('.png'))||pngs.reduce((n,f)=>n+f.size,0)>40*1024*1024){
      notify('En fazla 20 PNG (toplam 40 MB) seçilebilir.');return;
    }
    setBusy(true);setError('');
    try {
      const sizes=await Promise.all(pngs.map(async f=>{const img=await createImageBitmap(f);const d={w:img.width,h:img.height};img.close();return d;}));
      const columns=Math.min(3,pngs.length),rows=Math.ceil(pngs.length/columns),cell=214;
      const width=Math.max(512,columns*cell+32),height=Math.max(512,rows*cell+32);
      const stamp=Date.now().toString(36);
      const textures:Item[]=[],parts:Item[]=[],files:File[]=[];
      pngs.forEach((f,i)=>{
        const id=plainName(f.name.replace(/\.png$/i,''))+'_'+(i+1),tex='tex_'+(i+1);
        const name='wizard_'+stamp+'_piece_'+(i+1)+'.png';
        const scale=Math.min(1,180/Math.max(sizes[i].w,sizes[i].h));
        const pw=Math.max(1,Math.round(sizes[i].w*scale)),ph=Math.max(1,Math.round(sizes[i].h*scale));
        const x=16+(i%columns)*cell+Math.round((cell-pw)/2),y=16+Math.floor(i/columns)*cell+Math.round((cell-ph)/2);
        textures.push({id:tex,path:name,width:sizes[i].w,height:sizes[i].h});
        parts.push({id,shape:{type:'image',texture:tex,x,y,w:pw,h:ph},z:i});
        files.push(new File([f],name,{type:'image/png'}));
      });
      const model={format:'rev2d',version:1,meta:{name:'Karakter Parçaları',width,height,background:'transparent',fps:30},textures,parts};
      files.unshift(new File([JSON.stringify(model,null,2)],'karakter_'+stamp+'.r2d.json',{type:'application/json'}));
      const result=await session.importFiles(files,'');
      if(!result.ok){notify(('error' in result&&result.error)||'PNG içe aktarımı başarısız.');return;}
      setPngs([]);go(1);session.toast('success','PNG projesi oluşturuldu: '+pngs.length+' parça.');
    }catch(e){notify(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  };
  const changePart=async(p:Item,shape:Item)=>{
    if(busy)return;
    setBusy(true);
    const result=await session.applyEdit({kind:'part',id:p.id},{...p,shape:{...p.shape,...shape}});
    if(!result.ok)notify(result.message||'Parça düzenlenemedi; model doğrulamasını kontrol et.');
    setBusy(false);
  };
  const selectPiece=(p:Item)=>{setSelected(p.id);session.select(['part:'+p.id]);};
  const onDragStart=(e:PointerEvent<HTMLImageElement>,p:Item)=>{
    if(e.button!==0)return;
    selectPiece(p);e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current={id:p.id,x:e.clientX,y:e.clientY,left:Number(p.shape.x),top:Number(p.shape.y)};
  };
  const onDragMove=(e:PointerEvent<HTMLImageElement>)=>{
    const d=dragging.current,b=preview.current?.getBoundingClientRect();
    if(!d||!b)return;
    setDraft({id:d.id,x:Math.round(d.left+(e.clientX-d.x)*w/b.width),y:Math.round(d.top+(e.clientY-d.y)*h/b.height)});
  };
  const onDragEnd=async()=>{
    const d=dragging.current;dragging.current=null;
    if(!d||!draft||draft.id!==d.id)return;
    const p=pieces.find(p=>p.id===d.id);const moved=draft;
    setDraft(null);
    if(p&&(p.shape.x!==moved.x||p.shape.y!==moved.y))await changePart(p,{x:moved.x,y:moved.y});
  };
  const attachBone=async()=>{
    if(!doc||!chosen){notify('Önce bir PNG parçası seç.');return;}
    if(bound===pieces.length&&chosen.parent){go(3);return;}
    const id='bone_'+plainName(chosen.id),existing=new Set(bones.map(b=>b.id));
    const nextId=existing.has(id)?id+'_'+(bones.length+1):id;
    const sx=Number(chosen.shape.x),sy=Number(chosen.shape.y),sw=Number(chosen.shape.w),sh=Number(chosen.shape.h);
    const next={...doc,bones:[...bones,{id:nextId,x:sx+sw/2,y:sy+sh/2,length:0}],
      parts:arr(doc.parts).map(p=>p.id===chosen.id?{...p,parent:nextId}:p)};
    setBusy(true);
    const result=await session.applyGuidedDoc(next,'Kemik ekle: '+chosen.id);
    if(!result.ok)notify(result.error||'Kemik eklenemedi.');else session.select(['bone:'+nextId]);
    setBusy(false);
  };
  const makeAnimation=async()=>{
    if(!doc||!bones.length){notify('Önce en az bir kemik oluştur.');return;}
    const bone=boneTarget??bones[0];
    const clean=plainName(motionName);
    if(!clean){notify('Animasyon adı boş olamaz.');return;}
    if(animations.some(a=>a.id===clean)){notify('Bu isimde animasyon var, farklı isim seç.');return;}
    const param='Motion_'+plainName(bone.id);
    const params=arr(doc.parameters),bindings=arr(doc.bindings);
    const existing=params.some(p=>p.id===param);
    const nextParams=existing?params:[...params,{id:param,min:-1,max:1,default:0,group:'Motion'}];
    const nextBindings=existing?bindings:[...bindings,{target:'bone:'+bone.id+'.rotation',params:[param],
      keys:[{at:[-1],value:-angle},{at:[0],value:0},{at:[1],value:angle}]}];
    const d=clamp(Number(duration)||2,0.25,30);
    const nextAnim={id:clean,duration:d,loop:true,tracks:[{target:'param:'+param,keys:[
      {t:0,v:-1,ease:'inOutSine'},{t:d/2,v:1,ease:'inOutSine'},{t:d,v:-1}]}]};
    const next={...doc,parameters:nextParams,bindings:nextBindings,animations:[...animations,nextAnim]};
    setBusy(true);
    const result=await session.applyGuidedDoc(next,'Animasyon ekle: '+clean);
    if(!result.ok)notify(result.error||'Animasyon oluşturulamadı.');
    else {session.setAnimation(clean);go(4);}
    setBusy(false);
  };
  const setBoneField=async(key:string,value:number)=>{
    if(!boneTarget||!Number.isFinite(value))return;
    setBusy(true);const result=await session.applyEdit({kind:'bone',id:boneTarget.id},{...boneTarget,[key]:value});
    if(!result.ok)notify(result.message||'Kemik güncellenemedi.');setBusy(false);
  };
  const nextDisabled=(step===0&&!complete[0])||(step===1&&!complete[1])||(step===2&&!complete[2])||(step===3&&!complete[3]);
  return <div className="ed-guide" data-testid="mobile-wizard">
    <div className="ed-guide-progress">
      {steps.map((item,i)=><button key={i} className="ed-guide-progress-item" aria-current={step===i?'step':undefined}
        disabled={i>step&&!complete.slice(0,i).every(Boolean)} onClick={()=>go(i)} data-testid={'wizard-step-'+i}><span>{i+1}</span><small>{item.title}</small></button>)}
    </div>
    <div className="ed-guide-heading"><strong>{step+1}. {steps[step].title}</strong><span>{steps[step].tip}</span></div>
    <div className="ed-guide-body" ref={contentRef}>
      {step===0&&<div className="ed-guide-stack">
        <label className="ed-guide-upload">PNG dosyalarını seç
          <input type="file" accept=".png,image/png" multiple onChange={selectFiles} data-testid="wizard-png"/>
        </label>
        <p>{pngs.length?pngs.map(f=>f.name).join(' · '):'Her kol, bacak, gövde ve kafa ayrı PNG olabilir. Şeffaf alanlar korunur.'}</p>
        <button className="ed-guide-primary" type="button" disabled={busy||!pngs.length} onClick={()=>void importPngs()} data-testid="wizard-import">PNG’lerle proje oluştur</button>
        {textures.length>0&&<p>{textures.length} PNG zaten projede. Sonraki adıma geçebilirsin. Yeni yükleme ayrı proje açar.</p>}
      </div>}
      {step===1&&<div className="ed-guide-stack">
        {pieces.length?<><div ref={preview} className="ed-guide-preview" style={{aspectRatio:w+'/'+h}} data-testid="wizard-preview">
          {pieces.map(p=>{const d=draft?.id===p.id?draft:null;const sh=p.shape;
            return <img key={p.id} alt={p.id} src={previewUrls[sh.texture]||undefined} data-testid={"wizard-image-"+p.id}
              className={chosen?.id===p.id?'ed-guide-part-selected':''}
              style={{left:((d?.x??sh.x)/w*100)+'%',top:((d?.y??sh.y)/h*100)+'%',width:(sh.w/w*100)+'%',height:(sh.h/h*100)+'%',zIndex:Number(p.z)||0}}
              onPointerDown={e=>onDragStart(e,p)} onPointerMove={onDragMove} onPointerUp={()=>void onDragEnd()} onPointerCancel={()=>{dragging.current=null;setDraft(null);}}/>;
          })}
        </div><div className="ed-guide-parts">{pieces.map(p=><button key={p.id} type="button" onClick={()=>selectPiece(p)} aria-pressed={chosen?.id===p.id}>{p.id}</button>)}</div>
        {chosen&&<div className="ed-guide-fields">{(['x','y','w','h'] as const).map(k=><label key={chosen.id+k}>{k.toUpperCase()}
          <input key={chosen.id+k} type="number" defaultValue={Number(chosen.shape[k])} onBlur={e=>{const n=Number(e.target.value);if(Number.isFinite(n)&&n!==(Number(chosen.shape[k])))void changePart(chosen,{[k]:k==='w'||k==='h'?Math.max(1,n):n});}}/>
        </label>)}</div>}
        </>:<p>Önce PNG yükleme aşamasını tamamla.</p>}
      </div>}
      {step===2&&<div className="ed-guide-stack">
        <div className="ed-guide-parts">{pieces.map(p=><button key={p.id} type="button" onClick={()=>selectPiece(p)} aria-pressed={chosen?.id===p.id}>{p.id} {bones.some(b=>b.id===p.parent)?'✓':''}</button>)}</div>
        <p>{bound} / {pieces.length} parça kemiğe bağlı. Bir parça seçip kemik ekle. Eklem noktası parçanın merkezine yerleşir ve aşağıdan düzenlenir.</p>
        <button type="button" className="ed-guide-primary" disabled={busy||!chosen||!!chosen.parent&&bones.some(b=>b.id===chosen.parent)}
          onClick={()=>void attachBone()} data-testid="wizard-add-bone">Seçili parçaya kemik ekle</button>
        {!!bones.length&&<><label>Eklem seç <select value={boneTarget?.id||bones[0].id} onChange={e=>setSelected(e.target.value)}>
            {bones.map(b=><option key={b.id} value={b.id}>{b.id}</option>)}
          </select></label>
          {boneTarget&&<div className="ed-guide-fields">{(['x','y','length','rotation'] as const).map(k=><label key={boneTarget.id+k}>{k.toUpperCase()}
            <input key={boneTarget.id+k} type="number" defaultValue={Number(boneTarget[k]??0)}
              onBlur={e=>{const v=Number(e.target.value);if(Number.isFinite(v))void setBoneField(k,v);}}/>
          </label>)}</div>}</>}
      </div>}
      {step===3&&<div className="ed-guide-stack">
        <p>{bones.length} kemik · {animations.length} mevcut animasyon. İlk hareket için bir kemik seç, süre ve dönüş miktarını belirle.</p>
        <label>Kemik <select value={boneTarget?.id||''} onChange={e=>setSelected(e.target.value)}>
          {bones.map(b=><option key={b.id} value={b.id}>{b.id}</option>)}
        </select></label>
        <label>Animasyon adı <input value={motionName} onChange={e=>setMotionName(e.target.value)}/></label>
        <div className="ed-guide-fields">
          <label>Süre (sn) <input type="number" min=".25" max="30" step=".25" value={duration} onChange={e=>setDuration(Number(e.target.value))}/></label>
          <label>Açı (°) <input type="number" min="1" max="90" value={angle} onChange={e=>setAngle(clamp(Number(e.target.value),1,90))}/></label>
        </div>
        <button type="button" className="ed-guide-primary" disabled={busy||!bones.length} onClick={()=>void makeAnimation()} data-testid="wizard-make-animation">Salınım animasyonu oluştur</button>
        {!!animations.length&&<button type="button" onClick={()=>{session.setAnimation(animations[0].id);session.play();}}>Mevcut animasyonu oynat</button>}
      </div>}
      {step===4&&<div className="ed-guide-stack">
        <div className="ed-guide-animation-list">{animations.map(a=><button type="button" key={a.id} aria-pressed={animation===a.id} onClick={()=>{session.setAnimation(a.id);session.play();}}>
          <strong>{a.id}</strong><span>{a.duration}s · {a.loop?'Döngü':'Tekrar yok'}</span></button>)}</div>
        <button type="button" onClick={()=>playing?session.pause():session.play()}>{playing?'Duraklat':'Oynat'}</button>
        <label>Yeni animasyon adı <input value={motionName} onChange={e=>setMotionName(e.target.value)}/></label>
        <button type="button" className="ed-guide-primary" disabled={busy||!bones.length} onClick={()=>void makeAnimation()} data-testid="wizard-another-animation">Yeni animasyon oluştur</button>
        <button type="button" onClick={()=>session.downloadCopy()}>Model JSON’unu indir</button>
        <p>Not: Dışa aktarılan JSON dosyasını orijinal PNG’lerle birlikte sakla. Ayrıntılı keyframe düzenleme için Gelişmiş → Timeline kullan.</p>
      </div>}
      {error&&<p className="ed-guide-error" role="alert">{error}</p>}
    </div>
    <footer className="ed-guide-footer">
      <button type="button" onClick={()=>go(step-1)} disabled={step===0||busy}>Önceki</button>
      <span>Adım {step+1} / 5</span>
      <button type="button" className="ed-guide-primary" onClick={()=>go(step+1)} disabled={step===4||busy||nextDisabled} data-testid="wizard-next">Devam</button>
    </footer>
  </div>;
}
