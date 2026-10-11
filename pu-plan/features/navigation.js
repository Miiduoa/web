import {$,$$} from '../core/state.js';
import {renderFriends} from './friends.js';
import {renderShare} from './share.js';
import {renderSmartOverview} from './analysis.js';

const titles={schedule:'我的課表',friends:'找人',ai:'安排',settings:'我的',community:'動態'};
let current='',restoring=false,scrollFrame=0;

function remember(view,y=0,replace=false){
  try{
    const state={...history.state,noluView:view,noluScroll:y};
    history[replace?'replaceState':'pushState'](state,'',location.href);
  }catch{/* Navigation still works when browser history is unavailable. */}
}

// Community mounts later and owns its feed. Reconcile the shared shell rather
// than maintaining a second set of header, focus and browser-history rules.
function reconcile(){
  const view=$('.view.on')?.id;
  if(!Object.hasOwn(titles,view)||view===current)return;
  const hadView=!!current;current=view;
  $$('.view').forEach(el=>{el.inert=el.id!==view;el.setAttribute('aria-hidden',String(el.id!==view))});
  $$('[data-view]').forEach(el=>el.classList.toggle('on',el.dataset.view===view));
  $$('[data-community-open]').forEach(el=>el.classList.toggle('on',view==='community'));
  if($('#title'))$('#title').textContent=titles[view];
  for(const id of ['add','mobileAdd','importSchedule','shareTop']){
    const el=$('#'+id);if(el){el.hidden=view!=='schedule';el.style.visibility=''}
  }
  if(!restoring){
    remember(view,hadView?0:window.scrollY,!hadView);
    if(hadView){
      window.scrollTo({top:0,behavior:'instant'});
      const title=$('#title');if(title){title.tabIndex=-1;title.focus({preventScroll:true})}
    }
  }
  document.dispatchEvent(new CustomEvent('puplan:view-changed',{detail:{view}}));
}

export function changeView(view){
  if(!Object.hasOwn(titles,view))return false;
  if(view==='community'){
    const button=$('[data-community-open]');if(!button)return false;
    button.click();reconcile();return true;
  }
  if(!$('#'+view)?.classList.contains('view'))return false;
  if($('.view.on')?.id===view){reconcile();return true}
  $$('.view').forEach(el=>el.classList.toggle('on',el.id===view));
  if(view==='friends')renderFriends();
  if(view==='settings')renderShare();
  if(view==='ai')renderSmartOverview();
  reconcile();return true;
}

function restore(state){
  const dialog=$('dialog[open]');
  if(dialog){
    if(!dialog.dispatchEvent(new Event('cancel',{cancelable:true}))){remember(current,window.scrollY);return}
    dialog.close();
  }
  const view=Object.hasOwn(titles,state?.noluView)?state.noluView:'schedule';
  restoring=true;
  try{
    if(view==='community'){
      $('[data-community-open]')?.click();reconcile();
    }else{
      // Retain the existing cloud/social navigation listeners.
      const button=$(`[data-view="${view}"]`);
      if(button)button.click();else changeView('schedule');
    }
    const y=Number.isFinite(state?.noluScroll)?Math.max(0,state.noluScroll):0;
    window.scrollTo({top:y,behavior:'instant'});
  }finally{restoring=false}
}

export function initNavigation(){
  const initial=history.state;
  $$('[data-view]').forEach(b=>b.onclick=()=>changeView(b.dataset.view));
  $$('[data-close]').forEach(b=>b.onclick=()=>$('#'+b.dataset.close)?.close());
  changeView('schedule');
  const main=$('.main');
  if(main)new MutationObserver(reconcile).observe(main,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
  window.addEventListener('popstate',event=>restore(event.state));
  window.addEventListener('scroll',()=>{
    if(restoring||scrollFrame)return;
    scrollFrame=requestAnimationFrame(()=>{scrollFrame=0;if(current&&!restoring)remember(current,window.scrollY,true)});
  },{passive:true});
  if('scrollRestoration'in history)history.scrollRestoration='manual';
  // Selecting the current primary tab must not reset a half-written feed.
  document.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-view],[data-community-open]');
    if(!button||!button.closest('.nav,.bottom'))return;
    const view=button.dataset.view||(button.hasAttribute('data-community-open')?'community':'');
    if(view===current&&!restoring){event.preventDefault();event.stopImmediatePropagation()}
  },true);
  if(initial?.noluView&&initial.noluView!=='schedule'){
    const attempt=()=>{
      if(!Object.hasOwn(titles,initial.noluView))return true;
      if(initial.noluView==='community'&&!$('[data-community-open]'))return false;
      restore(initial);remember(current,window.scrollY,true);return true;
    };
    if(!attempt()){
      const observer=new MutationObserver(()=>{if(attempt())observer.disconnect()});
      observer.observe(main,{childList:true,subtree:true});
      setTimeout(()=>observer.disconnect(),15000);
    }
  }
}
