import {$, courses, setSelectedDay} from '../core/state.js';
import {renderSchedule} from './schedule.js';

export function initDailyUI(){
  // Keep existing choices. Only a new narrow-screen workspace starts in day view.
  if(!localStorage.getItem('puplan_schedule_mode')&&matchMedia('(max-width:680px)').matches){
    localStorage.setItem('puplan_schedule_mode','day');
  }
  const setText=(element,value)=>{if(element&&element.textContent!==value)element.textContent=value};
  function syncOverview(){
    const all=courses();
    const guest=localStorage.getItem('puplan_guest')==='1'&&!localStorage.getItem('puplan_course_owner');
    $('#workspaceMode').hidden=!guest;
    $('#quickBackup').disabled=all.length===0;
    setText($('#scheduleDate'),new Intl.DateTimeFormat('zh-TW',{month:'long',day:'numeric',weekday:'long'}).format(new Date()));
    setText($('#summary'),all.some(c=>c.day>=1&&c.day<=5)?'每週固定課表 · 點選課程，就能修改時間與教室。':'新增課程或匯入課表截圖，將時間整理在同一個地方。');
  }
  $('#quickBackup').onclick=()=>$('#downloadSchedule')?.click();
  document.addEventListener('puplan:courses-changed',syncOverview);
  document.addEventListener('puplan:profile-changed',syncOverview);
  new MutationObserver(syncOverview).observe($('#count'),{childList:true,characterData:true,subtree:true});
  window.addEventListener('focus',syncOverview);
  // The existing submit handler and capture-phase stale/duplicate guards run
  // first. A successful save closes the dialog; a rejected save leaves it open.
  $('#courseForm').addEventListener('submit',()=>{
    if($('#courseDialog').open)return;
    const day=Number($('#day').value);
    if(day>=1&&day<=5){setSelectedDay(day);renderSchedule()}
  });
  syncOverview();
}
