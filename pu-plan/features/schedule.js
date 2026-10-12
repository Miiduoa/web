import {$,$$,DAYS,PERIODS,courses,scheduleMeta,write,uid,esc,time,toast,getSelectedDay,setSelectedDay} from '../core/state.js';
import {nextClass,dateLabel} from '../core/planning.js';
import {scheduleGroups} from '../core/schedule-layout.js';

function renderStats(){
  const all=courses(),scheduled=all.filter(c=>c.day>=1&&c.day<=5),now=new Date(),today=scheduled.filter(c=>c.day===now.getDay()),occupied=new Set();
  scheduled.forEach(c=>{for(let p=c.start;p<=c.end;p++)occupied.add(`${c.day}:${p}`)});
  $('#today').textContent=today.length;$('#hours').textContent=occupied.size;$('#count').textContent=all.length;
  const hello=now.getHours()<12?'早安':now.getHours()<18?'下午好':'晚上好';
  $('#greet').textContent=!scheduled.length?`${hello}，從這週的課表開始。`:today.length?`${hello}，今天有 ${today.length} 門課。`:`${hello}，今天沒有排課。`;
  const next=nextClass(scheduled,now);
  $('#summary').textContent=next?`${next.kind==='now'?'正在上課':'下一堂'}：${next.course.name} · ${dateLabel(next.date)} ${time(next.course)}${next.course.room?' · '+next.course.room:''}`:'新增課程或匯入課表截圖，將時間整理在同一個地方。';
}
function bindCourses(root){
  root.querySelectorAll('[data-course]').forEach(el=>{
    el.onclick=()=>openCourse(el.dataset.course);
    if(el.tagName!=='BUTTON'){
      el.tabIndex=0;el.setAttribute('role','button');
      el.setAttribute('aria-label',`編輯課程：${courses().find(c=>c.id===el.dataset.course)?.name||'課程'}`);
      el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openCourse(el.dataset.course)}};
    }
  });
}

function renderTabs(){
  const root=$('#tabs');if(!root)return;
  root.setAttribute('role','group');root.setAttribute('aria-label','選擇星期');
  root.innerHTML=DAYS.map((d,i)=>`<button type="button" class="${getSelectedDay()===i+1?'on':''}" data-day="${i+1}" aria-pressed="${getSelectedDay()===i+1}">${d[1]}</button>`).join('');
  const select=day=>{setSelectedDay(day);renderTabs();renderMobile();renderHumanWeek();$(`#tabs [data-day="${day}"]`)?.focus({preventScroll:true})};
  root.querySelectorAll('[data-day]').forEach(button=>{
    button.onclick=()=>select(+button.dataset.day);
    button.onkeydown=event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();
      const next=event.key==='Home'?1:event.key==='End'?5:((+button.dataset.day-1+(event.key==='ArrowRight'?1:4))%5)+1;
      select(next);
    };
  });
}

function showConflicts(id){
  const groups=scheduleGroups(courses()).filter(g=>g.courses.length>1&&(!id||g.courses[0].id===id));
  if(!groups.length)return toast('課表已更新，目前沒有這組重疊課程。');
  let dialog=$('#scheduleConflictDialog');
  if(!dialog){dialog=document.createElement('dialog');dialog.id='scheduleConflictDialog';dialog.setAttribute('aria-labelledby','conflictTitle');document.body.append(dialog)}
  dialog.innerHTML=`<div class="modal-head"><h2 id="conflictTitle">確認重疊的課程</h2><button type="button" class="x" aria-label="關閉">×</button></div><p class="editor-hint">課程都已保留。點選其中一門，調整星期或節次。</p>${groups.map(g=>`<section class="conflict-group"><h3>${DAYS[g.day-1][1]}・第 ${g.start}–${g.end} 節</h3>${g.courses.map(c=>`<button type="button" class="conflict-course" data-edit-conflict="${esc(c.id)}"><b>${esc(c.name)}</b><span>${time(c)}${c.room?' · '+esc(c.room):''}</span><small>編輯課程 →</small></button>`).join('')}</section>`).join('')}`;
  dialog.querySelector('.x').onclick=()=>dialog.close();
  dialog.querySelectorAll('[data-edit-conflict]').forEach(button=>button.onclick=()=>{dialog.close();openCourse(button.dataset.editConflict)});
  dialog.showModal();
}

export function renderGrid(target='#grid',data=courses(),editable=true){
  const root=$(target);if(!root)return;
  let html='<div class="cell head" style="grid-column:1;grid-row:1"><b>節次</b><small>時間</small></div>';
  DAYS.forEach((d,i)=>html+=`<div class="cell head" style="grid-column:${i+2};grid-row:1"><b>${d[1]}</b><small>每週課表</small></div>`);
  PERIODS.forEach((p,i)=>{
    html+=`<div class="cell time" style="grid-column:1;grid-row:${i+2}"><b>${i+1}</b><small aria-label="${p[0]} 至 ${p[1]}"><span>${p[0]}</span><span>– ${p[1]}</span></small></div>`;
    DAYS.forEach((_,j)=>html+=`<div class="cell" style="grid-column:${j+2};grid-row:${i+2}"></div>`);
  });
  for(const group of scheduleGroups(data)){
    const {day,start,end,courses:items}=group;
    const content=items.length===1||!editable?items.map(c=>`<article class="course ${c.color||'violet'}" data-course="${esc(c.id)}"><b>${esc(c.name)}</b><small>${esc(c.teacher||'未填老師')}<br>${esc(c.room||'未填教室')}<br>${time(c)}</small></article>`).join(''):
      `<button type="button" class="grid-conflict" data-conflict="${esc(items[0].id)}" aria-label="${DAYS[day-1][1]}，${items.length} 門課重疊，查看並調整"><b>${items.length} 門課重疊</b><span>${items.map(c=>esc(c.name)).join(' / ')}</span><small>查看與調整 →</small></button>`;
    html+=`<div class="course-slot${items.length>1?' has-conflict':''}" style="grid-column:${day+1};grid-row:${start+1}/span ${end-start+1}">${content}</div>`;
  }
  root.innerHTML=html;
  if(editable){bindCourses(root);root.querySelectorAll('[data-conflict]').forEach(b=>b.onclick=()=>showConflicts(b.dataset.conflict))}
}

function renderWarnings(){
  const box=$('#scheduleWarnings');if(!box)return;
  const count=scheduleGroups(courses()).filter(g=>g.courses.length>1).length;
  box.hidden=!count;
  box.innerHTML=count?`<span>有 ${count} 組上課時間重疊，所有課程都已保留。</span><button type="button" class="btn">檢查衝堂</button>`:'';
  if(count)box.querySelector('button').onclick=()=>showConflicts();
}

function renderHumanWeek(){const root=$('#humanWeek');if(!root)return;const all=courses().filter(c=>c.day>=1&&c.day<=5),today=new Date().getDay(),selected=getSelectedDay();
if(!all.length){
  root.innerHTML=`<div class="schedule-empty"><h3>這一週，從這裡開始。</h3><p>把學校課表截圖匯入，確認辨識結果後再儲存；也可以手動加入第一門課。</p><div class="row"><button class="btn primary" data-empty-import type="button">匯入課表截圖</button><button class="btn" data-empty-add type="button">手動新增課程</button></div><small>目前支援週一至週五。未定時間的課程可先存為「未排定」。</small></div>`;
  root.querySelector('[data-empty-import]').onclick=()=>$('#importSchedule').click();
  root.querySelector('[data-empty-add]').onclick=()=>openCourse();return;
}
root.innerHTML=DAYS.map((d,i)=>{const day=i+1,cs=all.filter(c=>c.day===day).sort((a,b)=>a.start-b.start);return `<section class="human-day${today===day?' today':''}${selected===day?' focus':''}" data-week-day="${day}"><header><div><b>${d[1]}</b><small>${today===day?'今天 · ':''}${cs.length} 門課</small></div></header><div class="human-day-body">${cs.length?cs.map(c=>`<article class="human-course ${c.color||'gray'}" data-course="${esc(c.id)}"><time class="human-course-time"><b>${time(c)}</b><small>第 ${c.start}${c.end>c.start?'–'+c.end:''} 節</small></time><div class="human-course-main"><b>${esc(c.name)}</b><p>${[c.teacher,c.room].filter(Boolean).map(esc).join(' · ')||'尚未填寫老師 / 教室'}</p></div></article>`).join(''):'<div class="human-free">這天沒有排課。</div>'}</div></section>`}).join('');bindCourses(root)}

function renderMobile(){const root=$('#mobile');if(!root)return;const list=courses().filter(c=>c.day===getSelectedDay()&&c.day>=1).sort((a,b)=>a.start-b.start);root.innerHTML=list.length?list.map(c=>`<article class="mobile-course ${c.color||'gray'}" data-course="${esc(c.id)}"><time>${time(c)}<br><span>第 ${c.start}${c.end>c.start?'–'+c.end:''} 節</span></time><div><b>${esc(c.name)}</b><p>${esc(c.teacher||'')} ${c.teacher&&c.room?'·':''} ${esc(c.room||'')}</p></div></article>`).join(''):'<div class="project-note">這天沒有排課。</div>';bindCourses(root)}

function clearLegacyMobileWeek(){const root=$('#mobileWeek');if(root)root.replaceChildren()}

function renderFloatingCourses(){const box=$('#floatingCourses');if(!box)return;const list=courses().filter(c=>c.day===0);box.innerHTML=list.length?list.map(c=>`<button class="project-note floating-note" data-course="${esc(c.id)}"><b>待定 / ${esc(c.name)}</b><span>${esc(c.teacher||'')} ${esc(c.room||'時間地點依最新公告')}</span></button>`).join(''):'';box.querySelectorAll('[data-course]').forEach(e=>e.onclick=()=>openCourse(e.dataset.course))}

export function renderScheduleMeta(){const m=scheduleMeta(),title=m.title||[m.year?`${m.year} 學年度`:'',m.semester?`第 ${m.semester} 學期`:''].filter(Boolean).join('・');if($('#semesterLabel'))$('#semesterLabel').textContent=title||'我的學期';const bits=[m.school,m.className,m.credits?`${m.credits} 學分`:''].filter(Boolean);if($('#semesterMeta'))$('#semesterMeta').innerHTML=bits.length?bits.map(esc).join('<br>'):'自己的課表<br>匯入圖片後可自動辨識學期資訊'}

function syncScheduleVisibility(){
  const dayMode=document.body.classList.contains('schedule-day-mode');
  const classic=document.body.classList.contains('schedule-presentation-classic');
  const human=$('#humanWeek'),classicRoot=$('#classicSchedule'),tabs=$('#tabs'),table=$('.table-wrap'),mobile=$('#mobile');
  if(human)human.style.display=classic?'none':'grid';
  if(classicRoot)classicRoot.style.display=classic?'block':'none';
  if(tabs)tabs.style.display=dayMode?'flex':'none';
  if(classic){
    if(table)table.style.display=dayMode?'none':'block';
    if(mobile)mobile.style.display=dayMode?'grid':'none';
  }else{
    if(table)table.style.display='';
    if(mobile)mobile.style.display='';
  }
}

export function applyScheduleMode(mode=localStorage.getItem('puplan_schedule_mode')||'week'){const next=mode==='day'?'day':'week';document.body.classList.toggle('schedule-day-mode',next==='day');$$('[data-schedule-mode]').forEach(b=>{b.classList.toggle('on',b.dataset.scheduleMode===next);b.setAttribute('aria-pressed',String(b.dataset.scheduleMode===next))});localStorage.setItem('puplan_schedule_mode',next);syncScheduleVisibility()}

export function applyPresentation(mode=localStorage.getItem('puplan_schedule_presentation')||'human'){const next=mode==='classic'?'classic':'human';document.body.classList.toggle('schedule-presentation-classic',next==='classic');document.body.classList.toggle('schedule-presentation-human',next==='human');$$('[data-presentation]').forEach(b=>{b.classList.toggle('on',b.dataset.presentation===next);b.setAttribute('aria-pressed',String(b.dataset.presentation===next))});localStorage.setItem('puplan_schedule_presentation',next);syncScheduleVisibility()}

export function renderSchedule(){renderStats();renderTabs();renderGrid();renderHumanWeek();renderMobile();clearLegacyMobileWeek();renderWarnings();checkUndo();renderFloatingCourses();renderScheduleMeta();applyScheduleMode();applyPresentation();syncScheduleVisibility()}

function clearCourseError(){const el=$('#courseError');el.hidden=true;el.textContent='';$('#courseName').removeAttribute('aria-invalid')}
function courseError(message,field){const el=$('#courseError');el.textContent=message;el.hidden=false;if(field){field.setAttribute('aria-invalid','true');field.focus()}return false}
function toggleCourseTimeFields(){
  const off=+$('#day').value===0;$('#start').disabled=off;$('#end').disabled=off;
  if(!off&&+$('#end').value<+$('#start').value)$('#end').value=$('#start').value;
  [...$('#end').options].forEach(option=>option.disabled=!off&&+option.value<+$('#start').value);
}
function persistCourses(next){
  try{write('puplan_courses',next)}catch{return courseError('這次尚未儲存：瀏覽器儲存空間不足或存取被阻擋。請保留目前內容，不要清除網站資料。')}
  document.dispatchEvent(new CustomEvent('puplan:courses-changed',{detail:courses()}));return true;
}

export function openCourse(id){clearCourseError();const c=id?courses().find(x=>x.id===id):null;if(id&&!c)return toast('這門課已被移除或更新，請重新選擇。');$('#courseTitle').textContent=c?'編輯課程':'新增課程';$('#courseId').value=c?.id||'';$('#courseName').value=c?.name||'';$('#day').value=c?.day??getSelectedDay();$('#start').value=c?.start>0?c.start:3;$('#end').value=c?.end>0?c.end:4;toggleCourseTimeFields();$('#teacher').value=c?.teacher||'';$('#room').value=c?.room||'';$('#color').value=c?.color||['violet','blue','mint','orange','pink','lime','gray'][courses().length%7];$('#deleteCourse').hidden=!c;$('#courseDialog').showModal()}

export function initSchedule(){
  $('#day').innerHTML='<option value="0">未排定 / 依公告</option>'+DAYS.map((d,i)=>`<option value="${i+1}">${d[1]}</option>`).join('');
  ['start','end'].forEach(id=>$('#'+id).innerHTML=PERIODS.map((p,i)=>`<option value="${i+1}">第 ${i+1} 節　${p[0]}–${p[1]}</option>`).join(''));
  $('#day').addEventListener('change',toggleCourseTimeFields);
  $('#start').addEventListener('change',toggleCourseTimeFields);
  $('#courseForm').addEventListener('input',clearCourseError);
  $('#courseForm').onsubmit=e=>{
    e.preventDefault();clearCourseError();const all=courses(),oldId=$('#courseId').value,id=oldId||uid(),start=+$('#start').value,end=+$('#end').value,day=+$('#day').value,name=$('#courseName').value.trim();
    if(!name)return courseError('請輸入課程名稱，不能只填空白。',$('#courseName'));
    if(name.length>100)return courseError('課程名稱請控制在 100 字以內。',$('#courseName'));
    if(!Number.isInteger(day)||day<0||day>5||day!==0&&(!Number.isInteger(start)||!Number.isInteger(end)||start<1||end<start||end>PERIODS.length))return courseError('請確認星期與節次，結束節次不能早於開始。');
    const index=all.findIndex(c=>c.id===id);
    if(oldId&&index<0)return courseError('這門課已被其他更新移除，請關閉後重新確認課表。');
    if(index<0&&all.length>=80)return courseError('目前已達 80 門課的上限，請先整理課程，不會覆蓋既有資料。');
    const item={id,name,day,start:day===0?0:start,end:day===0?0:end,teacher:$('#teacher').value.trim(),room:$('#room').value.trim(),color:$('#color').value};
    const hit=day===0?null:all.find(c=>c.id!==id&&c.day===day&&!(end<c.start||start>c.end));
    if(hit&&!confirm(`與「${hit.name}」衝堂，仍要儲存？`))return;
    index<0?all.push(item):all[index]=item;
    if(!persistCourses(all))return;
    $('#courseDialog').close();toast(`${index<0?'課程已新增':'課程已更新'}，已儲存在此裝置`);
  };
  $('#deleteCourse').onclick=()=>{
    const before=courses(),id=$('#courseId').value,course=before.find(x=>x.id===id),scope=undoScope();
    if(!course||!confirm(`刪除「${course.name}」？`))return;
    const after=before.filter(x=>x.id!==id);
    if(!persistCourses(after))return;
    $('#courseDialog').close();offerUndo(before,after,scope,course.name);
  };
  $('#jumpToday')?.addEventListener('click',()=>{
    const day=new Date().getDay();setSelectedDay(day>=1&&day<=5?day:1);
    applyScheduleMode('day');renderTabs();renderHumanWeek();renderMobile();
    $('#tabs .on')?.focus({preventScroll:true});
  });
  if($('#jumpToday'))$('#jumpToday').textContent=[0,6].includes(new Date().getDay())?'看週一':'看今天';
  document.addEventListener('puplan:courses-changed',renderSchedule);
  $$('[data-schedule-mode]').forEach(b=>b.onclick=()=>applyScheduleMode(b.dataset.scheduleMode));
  $$('[data-presentation]').forEach(b=>b.onclick=()=>applyPresentation(b.dataset.presentation));
  $('#add').onclick=$('#mobileAdd').onclick=()=>openCourse();
  $('#importSchedule')?.addEventListener('click',()=>{$('#importDialog')?.showModal();document.dispatchEvent(new CustomEvent('puplan:import-opened'))});
  window.addEventListener('resize',syncScheduleVisibility,{passive:true});
}

// Undo only the exact deletion we just made. Never replace a newer remote edit,
// another semester or another account with an old in-memory schedule.
let undoState=null,undoTimer=0;
function undoScope(){return JSON.stringify([localStorage.getItem('puplan_course_owner'),localStorage.getItem('puplan_guest'),scheduleMeta()])}
function clearUndo(){undoState=null;clearTimeout(undoTimer);if($('#courseUndo'))$('#courseUndo').hidden=true}
function checkUndo(){if(undoState&&(Date.now()>undoState.until||undoScope()!==undoState.scope||JSON.stringify(courses())!==undoState.after))clearUndo()}
function offerUndo(before,after,scope,name){
  clearUndo();
  if(undoScope()!==scope||JSON.stringify(courses())!==JSON.stringify(after))return toast('課程已刪除，課表同時有其他更新，請以最新內容為準。');
  undoState={before,after:JSON.stringify(after),scope,until:Date.now()+30000};
  let box=$('#courseUndo');
  if(!box){box=document.createElement('aside');box.id='courseUndo';box.className='course-undo';box.setAttribute('aria-label','復原刪除');$('.main').append(box)}
  box.innerHTML='<div role="status"><b></b><small>30 秒內可復原；離開或重新整理後不保留。</small></div><button type="button" class="btn" id="undoDelete">復原刪除</button><button type="button" class="x" aria-label="關閉復原提示">×</button>';
  box.querySelector('b').textContent=`已刪除「${name}」`;box.hidden=false;
  box.querySelector('.x').onclick=clearUndo;
  $('#undoDelete').onclick=()=>{
    const pending=undoState;checkUndo();
    if(!pending||!undoState)return toast('課表已有變更或超過復原時間，沒有覆蓋目前資料。');
    try{write('puplan_courses',pending.before)}catch{box.querySelector('small').textContent='儲存空間不足，尚未復原。請勿清除網站資料，可再試一次。';return}
    clearUndo();document.dispatchEvent(new CustomEvent('puplan:courses-changed',{detail:courses()}));toast('課程已復原');
  };
  undoTimer=setTimeout(clearUndo,30000);$('#undoDelete').focus({preventScroll:true});
}
