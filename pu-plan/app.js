import {$,$$,DAYS,PERIODS,courses,friends,scheduleMeta,read,write,esc,time,toast,getSelectedFriend,setSelectedFriend} from './core/state.js';
import {renderSchedule,renderScheduleMeta,initSchedule} from './features/schedule.js';
import {renderFriends,initFriends} from './features/friends.js';
import {renderShare,addFriendCode} from './features/share.js';
import {smartAnalysis,renderSmartOverview,buildAIContext} from './features/analysis.js';
import {changeView,initNavigation} from './features/navigation.js';
import {initSettings} from './features/settings.js';

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

initNavigation();initSchedule();initFriends();initSettings();
$$('[data-smart]').forEach(b=>b.onclick=()=>smartAnalysis(b.dataset.smart));
renderAll();

const shared=location.hash.match(/friend=([^&]+)/);
if(shared)try{const result=addFriendCode(decodeURIComponent(shared[1]));setSelectedFriend(result.id);renderFriends();history.replaceState(null,'',location.pathname);changeView('friends');toast(result.message)}catch{toast('分享連結無法讀取')}
