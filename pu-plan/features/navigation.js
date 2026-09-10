import {$,$$} from '../core/state.js';
import {renderFriends} from './friends.js';
import {renderShare} from './share.js';
import {renderSmartOverview} from './analysis.js';

export function changeView(view){
  $$('.view').forEach(x=>x.classList.toggle('on',x.id===view));
  $$('[data-view]').forEach(x=>x.classList.toggle('on',x.dataset.view===view));
  $$('[data-community-open]').forEach(x=>x.classList.remove('on'));
  const titles={schedule:'我的課表',friends:'找人',ai:'安排',settings:'我的'};
  if($('#title'))$('#title').textContent=titles[view]||'';
  const schedule=view==='schedule';
  if($('#add')){$('#add').hidden=!schedule;$('#add').style.visibility=''}
  if($('#mobileAdd'))$('#mobileAdd').hidden=!schedule;
  if($('#importSchedule'))$('#importSchedule').hidden=!schedule;
  if($('#shareTop'))$('#shareTop').hidden=!schedule;
  if(view==='friends')renderFriends();
  if(view==='settings')renderShare();
  if(view==='ai')renderSmartOverview();
}

export function initNavigation(){
  $$('[data-view]').forEach(b=>b.onclick=()=>changeView(b.dataset.view));
  $$('[data-close]').forEach(b=>b.onclick=()=>$('#'+b.dataset.close)?.close());
  changeView('schedule');
}
