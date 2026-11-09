/** Shared phone workspace. Reuse desktop panes without duplicating document state. */
import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type PointerEvent } from 'react';
import { Icon } from '../design/index.js';
import { useApp, useSession } from '../state/context.js';
import { Timeline } from '../panels/Timeline.js';
import { MobileWizard } from './MobileWizard.js';
import './mobile-workspace.css';
type Page = 'panels' | 'inspect' | 'timeline';
type Extent = 'peek' | 'half' | 'full';
interface Props {
  leading?: ComponentType;
  trailing?: ComponentType;
  bottom?: ComponentType<{ collapsed: boolean }>;
  modeId: string;
  onHeightChange: (height: number) => void;
}
export function MobileWorkspace({ leading: Leading, trailing: Trailing, bottom: Bottom, modeId, onHeightChange }: Props) {
  const session=useSession();
  const [page,setPage]=useState<Page>('panels');
  const [guided,setGuided]=useState(modeId==='rig');
  const [extent,setExtent]=useState<Extent>('half');
  const compact=useApp(s=>s.compactPanels);
  const selected=useApp(s=>s.selection[0]??'');
  const host=useRef<HTMLDivElement>(null);
  const dragY=useRef<number|null>(null);
  const didDrag=useRef(false);
  const choices=[
    {id:'panels' as const,label:'Panels',icon:'layers' as const,available:!!Leading},
    {id:'inspect' as const,label:'Inspect',icon:'sidebarRight' as const,available:!!Trailing},
    {id:'timeline' as const,label:'Timeline',icon:'film' as const,available:!!Bottom},
  ].filter(x=>x.available);
  const active:Page=choices.some(x=>x.id===page)?page:(choices[0]?.id??'panels');
  useLayoutEffect(()=>{
    const el=host.current;if(!el)return;
    const measure=()=>onHeightChange(Math.ceil(el.getBoundingClientRect().height)+4);
    measure();const obs=new ResizeObserver(measure);obs.observe(el);
    return()=>obs.disconnect();
  },[onHeightChange]);
  // Toolbar/Inspector actions still use the native Session panel API.
  useEffect(()=>{
    if(compact.inspector&&Trailing){setPage('inspect');setExtent('half');}
    else if(compact.outliner&&Leading){setPage('panels');setExtent('half');}
  },[compact.inspector,compact.outliner,Leading,Trailing]);
  const show=(next:Page)=>{
    setPage(next);setExtent('half');
    if(next==='panels')session.setPanel('outliner',true);
    else if(next==='inspect')session.setPanel('inspector',true);
    else{session.setPanel('outliner',false);session.setPanel('inspector',false);}
  };
  const resize=(delta:1|-1)=>{
    const sizes:Extent[]=['peek','half','full'];
    setExtent(v=>sizes[Math.max(0,Math.min(2,sizes.indexOf(v)+delta))]);
  };
  const dragDown=(e:PointerEvent<HTMLButtonElement>)=>{
    if(e.button!==0)return;
    dragY.current=e.clientY;didDrag.current=false;e.currentTarget.setPointerCapture(e.pointerId);
  };
  const dragUp=(e:PointerEvent<HTMLButtonElement>)=>{
    if(dragY.current===null)return;
    const dy=e.clientY-dragY.current;dragY.current=null;
    if(Math.abs(dy)>35)didDrag.current=true;
    if(dy < -35)resize(1);else if(dy > 35)resize(-1);
  };
  return <div ref={host} className="ed-mobile-workspace" data-testid="mobile-workspace" data-page={active} data-extent={extent} data-guided={guided ? "" : undefined}>
    <section className="ed-mobile-sheet" aria-label={active+' workspace'}>
      <header className="ed-mobile-sheet-head">
        <button type="button" className="ed-mobile-drag" aria-label="Expand or collapse panel"
          onPointerDown={dragDown} onPointerUp={dragUp} onPointerCancel={()=>{dragY.current=null;}}
          onClick={()=>{if(didDrag.current){didDrag.current=false;return;}resize(extent==='peek'?1:-1);}}>
          <span className="ed-mobile-drag-line"/>
        </button>
        <div className="ed-mobile-heading"><strong>{guided ? 'Karakter oluşturma' : choices.find(x=>x.id===active)?.label}</strong>
          {active==='inspect'&&selected&&<span className="ed-mobile-selection" title={selected}>Selected: {selected.split(':').slice(1).join(':')}</span>}
        </div>
        <div className="ed-mobile-resize">
          <button type="button" disabled={extent==='peek'} onClick={()=>resize(-1)} aria-label="Minimize panel"><Icon name="chevronDown" size={18}/></button>
          <button type="button" disabled={extent==='full'} onClick={()=>resize(1)} aria-label="Expand panel"><Icon name="chevronUp" size={18}/></button>
        </div>
      </header>
      <div className="ed-mobile-sheet-content" data-testid="mobile-panel-content">
        {guided && modeId==="rig" && <MobileWizard />}
        {!guided && <>

        {active==='panels'&&extent!=='peek'&&Leading&&<Leading/>}
        {active==='inspect'&&extent!=='peek'&&Trailing&&<Trailing/>}
        {active==='timeline'&&Bottom&&(modeId==='rig'
          ? <Timeline collapsed={extent==='peek'} onToggleMobile={()=>setExtent(v=>v==='peek'?'half':'peek')}/>
          : <Bottom collapsed={extent==='peek'}/>)}
        </>}
      </div>
    </section>
    <nav className="ed-mobile-nav" aria-label="Editor workspace" data-testid="mobile-workspace-tabs">
      {guided && <button type="button" className="ed-mobile-guide-action" data-testid="mobile-enter-advanced" onClick={()=>setGuided(false)}>Gelişmiş araçlar</button>}
      {!guided && modeId==='rig' && <button type="button" className="ed-mobile-guide-action" data-testid="mobile-enter-guide" onClick={()=>{setGuided(true);setExtent('half');}}>Adım adım</button>}
      {!guided && choices.map(({id,label,icon})=><button key={id} type="button" className="ed-mobile-nav-item"
        aria-current={active===id?'page':undefined} onClick={()=>show(id)} data-testid={'mobile-tab-'+id}>
        <Icon name={icon} size={20}/><span>{label}</span>
      </button>)}
    </nav>
  </div>;
}
