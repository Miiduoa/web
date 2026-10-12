import {$,$$,DAYS,PERIODS,courses,friends,scheduleMeta,read,write,esc,time,toast,getSelectedFriend,setSelectedFriend} from './core/state.js';
import {renderSchedule,renderScheduleMeta,initSchedule} from './features/schedule.js';
import {renderFriends,initFriends} from './features/friends.js';
import {renderShare,prepareShareImport,decodeShare} from './features/share.js';
import {smartAnalysis,renderSmartOverview,buildAIContext} from './features/analysis.js';
import {changeView,initNavigation} from './features/navigation.js';
import {initSettings} from './features/settings.js';
import {initExperience} from './features/experience.js';
import {initDirectEdit} from './features/direct-edit.js';
import {initEditorFeedback} from './features/editor-feedback.js';
import {initDailyUI} from './features/daily-ui.js';

function renderAll(){renderSchedule();renderFriends();renderShare()}
window.PUPLAN_AI={courses,friends,getSelectedFriend:()=>friends().find(x=>x.id===getSelectedFriend()),buildAIContext,smartAnalysis,esc,time,DAYS,PERIODS,toast};
window.PUPLAN_APP={
  courses,friends,scheduleMeta,render:renderAll,renderFriends,renderShare,toast,esc,time,DAYS,PERIODS,write,read,changeView,
  setRemoteCourses:a=>{write('puplan_courses',Array.isArray(a)?a:[]);renderSchedule()},
  setCoursesFromUser:a=>{const next=Array.isArray(a)?a:[];write('puplan_courses',next);document.dispatchEvent(new CustomEvent('puplan:courses-changed',{detail:next}));renderSchedule()},
  setScheduleMetaFromUser:m=>{write('puplan_schedule_meta',m&&typeof m==='object'?m:{});renderScheduleMeta()},
  setRemoteMeta:m=>{write('puplan_schedule_meta',m&&typeof m==='object'?m:{});renderScheduleMeta()},
  setFriends:a=>{write('puplan_friends',Array.isArray(a)?a:[]);renderFriends()},
  getSelectedFriend,
  setSelectedFriend:id=>{setSelectedFriend(id);renderFriends()}
};

initNavigation();initSchedule();initFriends();initSettings();initExperience();initEditorFeedback();initDirectEdit();initDailyUI();
$$('[data-smart]').forEach(b=>b.onclick=()=>smartAnalysis(b.dataset.smart));
renderAll();

const shared=new URLSearchParams(location.hash.slice(1)).get('friend');
if(shared){
  const url=new URL(location.href);url.hash='';history.replaceState(history.state,'',url.href);
  try{
    decodeShare(shared);
    const offer=()=>{const gate=document.querySelector('#authGate');if(gate&&!gate.classList.contains('off'))return false;prepareShareImport(shared);return true};
    if(!offer()){
      const gate=document.querySelector('#authGate');
      const observer=new MutationObserver(()=>{if(offer())observer.disconnect()});
      observer.observe(gate,{attributes:true,attributeFilter:['class']});
    }
  }catch(error){toast(error.message||'分享連結無法讀取')}
}
