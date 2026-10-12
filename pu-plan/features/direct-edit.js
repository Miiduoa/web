import {$, DAYS, PERIODS, courses, scheduleMeta, toast, time} from '../core/state.js';
import {planCoursePlacement, selectedRange} from '../core/direct-placement.js';
import {openCourse, applyPresentation, applyScheduleMode} from './schedule.js';

// Keep account/session identity in memory only; never put it in DOM or telemetry.
const snapshot = () => JSON.stringify([courses(), scheduleMeta(),
  ...['puplan_course_owner','puplan_guest','puplan_session'].map(key => localStorage.getItem(key))]);
const label = course => `${DAYS[course.day - 1][1]} ${time(course)}`;

export function initDirectEdit() {
  const grid = $('#grid'), wrap = grid?.closest('.table-wrap'), classic = $('#classicSchedule');
  if (!grid || !wrap || $('#directStatus')) return;
  let gesture = null, picked = null, pending = null, undo = null, undoTimer = 0;
  let frame = 0, suppressUntil = 0, hoverKey = '', lastCell = {day: 1, period: 1};
  const help = classic.querySelector('.grid-help');
  help.id = 'directHelp';
  help.textContent = '空白格點一下新增；電腦可拖選連續節次。課程點一下編輯，拖曳右上把手可換時段。也可以點把手，再點目的格。';
  const tools = document.createElement('div'); tools.className = 'direct-tools';
  tools.innerHTML = '<p id="directStatus" role="status" aria-live="polite" aria-atomic="true">拖曳會保留原節數；有衝堂會先確認，移錯可復原。</p><button type="button" class="btn" id="cancelPlacement" hidden>取消移動</button>';
  help.after(tools); wrap.setAttribute('aria-describedby', 'directHelp directStatus');
  const entry = document.createElement('button'); entry.type = 'button';
  entry.className = 'btn direct-grid-entry'; entry.textContent = '在週課表上點選或拖曳排課 →';
  entry.onclick = () => {applyScheduleMode('week'); applyPresentation('classic'); wrap.scrollIntoView({block:'start',behavior:'instant'}); grid.querySelector('[data-slot][tabindex="0"]')?.focus({preventScroll:true});};
  $('#humanWeek').before(entry);
  const status = $('#directStatus'), cancel = $('#cancelPlacement');
  const preview = document.createElement('div'); preview.className = 'direct-preview'; preview.id = 'directPreview';
  preview.setAttribute('aria-hidden', 'true'); preview.hidden = true;
  preview.innerHTML = '<b></b><span></span>'; document.body.append(preview);
  const confirmDialog = document.createElement('dialog'); confirmDialog.id = 'moveConflictDialog';
  confirmDialog.setAttribute('aria-labelledby','moveConflictTitle');
  confirmDialog.innerHTML = '<div class="modal-head"><h2 id="moveConflictTitle">這個時段有其他課程</h2><button type="button" class="x" aria-label="取消移動">×</button></div><p class="move-course-name"></p><p class="move-route"></p><ul class="move-conflicts"></ul><p>其他課程不會被移除。仍要保留這個重疊時段嗎？</p><p id="moveError" class="form-error" role="alert" hidden></p><div class="row modal-actions"><button type="button" class="btn" id="cancelCourseMove">取消</button><button type="button" class="btn primary" id="confirmCourseMove">仍要移動</button></div>';
  document.body.append(confirmDialog);
  const undoBox = document.createElement('aside'); undoBox.className = 'course-undo direct-undo'; undoBox.id = 'directUndo'; undoBox.hidden = true;
  undoBox.setAttribute('aria-label','復原課程移動');
  undoBox.innerHTML = '<div role="status"><b></b><small>30 秒內可復原；其他課表更新後即不再提供。</small></div><button type="button" class="btn" id="undoCourseMove">復原移動</button><button type="button" class="x" aria-label="關閉復原提示">×</button>';
  document.body.append(undoBox);
  function announce(message) { if (status.textContent !== message) status.textContent = message; }
  function available() {return $('#schedule').classList.contains('on') && document.body.classList.contains('schedule-presentation-classic') && !document.body.classList.contains('schedule-day-mode') && $('#authGate').classList.contains('off') && !document.querySelector('dialog[open]');}
  function cellFor(day, period) {return grid.querySelector(`[data-slot="${day}:${period}"]`);}
  function cellValue(node) {return node?.dataset.slot ? {day:Number(node.dataset.slotDay),period:Number(node.dataset.slotPeriod)} : null;}
  function courseNode(id) {return [...grid.querySelectorAll('[data-course]')].find(node => node.dataset.course === id);}
  function focusCourse(id) { (courseNode(id) || grid.querySelector('[data-conflict]') || wrap).focus({preventScroll:true}); }
  function clearPreview() {
    preview.hidden = true; hoverKey = '';
    grid.querySelectorAll('.direct-target').forEach(node => node.classList.remove('direct-target'));
  }
  function cancelGesture(message = '') {
    const old = gesture; gesture = null; cancelAnimationFrame(frame); frame = 0;
    if (old?.dragging) suppressUntil = performance.now() + 450;
    if (old && grid.hasPointerCapture?.(old.id)) grid.releasePointerCapture(old.id);
    picked = null; grid.classList.remove('direct-dragging','direct-picking');
    grid.querySelectorAll('.direct-source').forEach(node => node.classList.remove('direct-source'));
    cancel.hidden = true; clearPreview();
    if (message) announce(message);
  }
  cancel.onclick = () => cancelGesture('已取消移動，原課表沒有變更。');
  function clearUndo() {undo = null; clearTimeout(undoTimer); undoBox.hidden = true;}
  undoBox.querySelector('.x').onclick = clearUndo;
  function checkState() {
    const now = snapshot();
    if (undo && (undo.after !== now || Date.now() > undo.until)) clearUndo();
    if ((gesture && gesture.before !== now) || (picked && picked.before !== now)) cancelGesture('課表已更新，已取消操作，沒有覆蓋新資料。');
  }
  function decorate() {
    checkState();
    const all = courses(); let focusCell = null;
    for (const node of grid.querySelectorAll('.cell:not(.head):not(.time)')) {
      const day = parseInt(node.style.gridColumn,10) - 1, period = parseInt(node.style.gridRow,10) - 1;
      node.dataset.slot = `${day}:${period}`; node.dataset.slotDay = day; node.dataset.slotPeriod = period;
      const occupied = all.some(c => c.day === day && c.start <= period && c.end >= period);
      node.dataset.occupied = String(occupied);
      node.tabIndex = -1;
      if (!occupied) {
        node.setAttribute('role','button'); node.setAttribute('aria-label',`新增${DAYS[day-1][1]}第 ${period} 節，${PERIODS[period-1].join('–')}`);
        if (!focusCell || day === lastCell.day && period === lastCell.period) focusCell = node;
      } else {node.removeAttribute('role'); node.removeAttribute('aria-label');}
    }
    if (focusCell) focusCell.tabIndex = 0;
    for (const node of grid.querySelectorAll('.course[data-course]')) {
      const course = all.find(c => c.id === node.dataset.course); if (!course) continue;
      const slot = node.parentElement; slot.classList.add('direct-course-slot');
      node.setAttribute('aria-label', `編輯「${course.name}」，${label(course)}`);
      // The move button is a sibling, not a button nested inside another control.
      if (!slot.querySelector('[data-move-course]')) {
        const handle = document.createElement('button'); handle.type = 'button'; handle.className = 'course-move-handle'; handle.dataset.moveCourse = course.id;
        handle.textContent = '⠿'; handle.title = '拖曳移動；也可以點一下，再點目的格';
        handle.setAttribute('aria-label', `移動「${course.name}」：拖曳，或點一下後選目的時段`); slot.append(handle);
      }
      const small = node.querySelector('small');
      if (small) {small.replaceChildren(); const timing = document.createElement('span'); timing.textContent = time(course); small.append(timing);
        if (course.end > course.start && (course.teacher || course.room)) {const info = document.createElement('span');info.textContent = [course.teacher,course.room].filter(Boolean).join(' · ');small.append(info);}}
    }
  }
  new MutationObserver(decorate).observe(grid, {childList:true}); decorate();
  new MutationObserver(checkState).observe($('#count'), {childList:true});
  document.addEventListener('puplan:courses-changed', checkState);
  document.addEventListener('puplan:profile-changed', checkState);
  window.addEventListener('storage',checkState);
  function slotAt(x,y) {
    const box = wrap.getBoundingClientRect();
    if (x < box.left || x >= box.right || y < Math.max(0,box.top) || y >= Math.min(innerHeight,box.bottom)) return null;
    const hit=document.elementFromPoint(x,y);if(hit&&!wrap.contains(hit))return null;
    // Pinned labels cover older rows/columns: never drop through those labels.
    const topLabel=grid.querySelector('.cell.head'), timeLabel=grid.querySelector('.cell.time');
    if(getComputedStyle(topLabel).position==='sticky' && (y<topLabel.getBoundingClientRect().bottom || x<timeLabel.getBoundingClientRect().right))return null;
    for (const node of grid.querySelectorAll('[data-slot]')) {
      const r = node.getBoundingClientRect();
      if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) return cellValue(node);
    }
    return null;
  }
  function paint(range, name, warning = false) {
    if (!range) return clearPreview();
    const first = cellFor(range.day,range.start), last = cellFor(range.day,range.end);
    if (!first || !last) return clearPreview();
    const a=first.getBoundingClientRect(), b=last.getBoundingClientRect(), w=wrap.getBoundingClientRect();
    const pinned=getComputedStyle(grid.querySelector('.cell.head')).position==='sticky';
    const visibleLeft=pinned?grid.querySelector('.cell.time').getBoundingClientRect().right:w.left;
    const visibleTop=pinned?grid.querySelector('.cell.head').getBoundingClientRect().bottom:w.top;
    const left=Math.max(a.left,visibleLeft), right=Math.min(a.right,w.right), top=Math.max(a.top,visibleTop,0), bottom=Math.min(b.bottom,w.bottom,innerHeight);
    preview.hidden = right <= left || bottom <= top;
    preview.style.left=`${left+3}px`; preview.style.top=`${top+3}px`; preview.style.width=`${Math.max(0,right-left-6)}px`; preview.style.height=`${Math.max(0,bottom-top-6)}px`;
    preview.dataset.warning=String(warning); preview.querySelector('b').textContent = name;
    preview.querySelector('span').textContent = `${label(range)}${warning?' · 有衝堂':''}`;
    const key=`${range.day}:${range.start}:${range.end}:${warning}`;
    if (key !== hoverKey) {
      grid.querySelectorAll('.direct-target').forEach(node=>node.classList.remove('direct-target'));
      for(let period=range.start;period<=range.end;period++)cellFor(range.day,period)?.classList.add('direct-target');
      hoverKey=key;
    }
  }
  function proposal(task,target) {
    if (!target) return null;
    if (task.kind === 'create') return {draft:selectedRange(task.anchor,target), conflicts:[]};
    return planCoursePlacement(courses(),task.courseId,target.day,target.period-task.offset);
  }
  function showProposal(task, target) {
    try {
      const plan=proposal(task,target); if(!plan?.draft){clearPreview();announce('請放在課表內；新增範圍需在同一天。');return null;}
      paint(plan.draft,task.kind==='create'?'新增課程':plan.draft.name,plan.conflicts.length>0);
      announce(`${task.kind==='create'?'新增':'移至'}${label(plan.draft)}，${plan.draft.end-plan.draft.start+1} 節${plan.conflicts.length?'；有衝堂，放開後先確認':'；放開套用'}。Esc 可取消。`);
      return plan;
    }catch(error){clearPreview();announce(error.message);return null;}
  }
  function openAt(range) {
    openCourse(); $('#day').value=String(range.day); $('#start').value=String(range.start); $('#end').value=String(range.end);
    $('#day').dispatchEvent(new Event('change',{bubbles:true})); $('#start').dispatchEvent(new Event('change',{bubbles:true}));
  }
  function commitMove(task,plan) {
    if(task.before!==snapshot()) throw new Error('課表已在其他操作或裝置更新，沒有覆蓋新資料。請重新移動。');
    try {window.PUPLAN_APP.setCoursesFromUser(plan.next)}
    catch {throw new Error('尚未儲存：瀏覽器空間不足或存取被阻擋，原課表沒有變更。請勿清除網站資料。')}
    const after=snapshot();
    if (JSON.stringify(courses()) !== JSON.stringify(plan.next)) {announce('課表同時有其他更新，請以目前內容為準。');return;}
    clearUndo(); undo={courses:task.previous,after,until:Date.now()+30000,id:plan.draft.id};
    undoBox.querySelector('b').textContent=`已移動「${plan.draft.name}」至${label(plan.draft)}`;
    undoBox.querySelector('small').textContent='30 秒內可復原；其他課表更新後即不再提供。';
    undoBox.hidden=false;undoTimer=setTimeout(clearUndo,30000);
    announce(`已移至${label(plan.draft)}，已儲存在此裝置。`);focusCourse(plan.draft.id);
  }
  function requestMove(task,plan) {
    if(!plan.changed){announce('時段沒有變更。');focusCourse(plan.draft.id);return;}
    if(task.before!==snapshot())return announce('課表已更新，沒有覆蓋新資料。');
    if(plan.conflicts.length){
      pending={task,plan}; confirmDialog.querySelector('.move-course-name').textContent=plan.draft.name;
      confirmDialog.querySelector('.move-route').textContent=`${label(plan.course)} → ${label(plan.draft)}`;
      const list=confirmDialog.querySelector('.move-conflicts');list.replaceChildren();
      for(const c of plan.conflicts){const li=document.createElement('li');li.textContent=`${c.name} · ${label(c)}`;list.append(li);}
      $('#moveError').hidden=true;$('#confirmCourseMove').disabled=false;confirmDialog.showModal();$('#cancelCourseMove').focus();return;
    }
    try{commitMove(task,plan)}catch(error){announce(error.message||'儲存失敗，原課表沒有變更。');toast(error.message||'儲存失敗，請勿清除網站資料。');}
  }
  const closeConfirmation=()=>{const id=pending?.plan.draft.id;pending=null;confirmDialog.close();announce('已取消移動，原課表沒有變更。');if(id)focusCourse(id);};
  confirmDialog.querySelector('.x').onclick=$('#cancelCourseMove').onclick=closeConfirmation;
  confirmDialog.addEventListener('cancel',event=>{event.preventDefault();closeConfirmation()});
  confirmDialog.addEventListener('close',()=>{pending=null});
  $('#confirmCourseMove').onclick=()=>{
    if(!pending)return;const {task,plan}=pending;
    try{commitMove(task,plan);pending=null;confirmDialog.close();focusCourse(plan.draft.id)}
    catch(error){$('#moveError').hidden=false;$('#moveError').textContent=error.message||'儲存失敗，原課表沒有變更，請勿清除網站資料。';}
  };
  $('#undoCourseMove').onclick=()=>{
    checkState();if(!undo)return toast('課表已有更新或超過復原時間，沒有覆蓋目前資料。');
    const saved=undo;
    try{window.PUPLAN_APP.setCoursesFromUser(saved.courses);clearUndo();announce('課程已回到移動前的時段。');focusCourse(saved.id)}
    catch{undoBox.querySelector('small').textContent='尚未復原：儲存空間不足或被阻擋，請勿清除網站資料，可再試一次。';}
  };
  function pickCourse(id){
    if(!available())return;
    const course=courses().find(c=>c.id===id);if(!course)return;
    cancelGesture();picked={kind:'move',courseId:id,offset:0,before:snapshot(),previous:courses()};
    cancel.hidden=false;grid.classList.add('direct-picking');courseNode(id)?.classList.add('direct-source');
    announce(`已選「${course.name}」，請點目的時段的第一節；保留 ${course.end-course.start+1} 節。取消移動或 Esc 可返回。`);
  }
  function autoScroll(){
    if(!gesture?.dragging)return;
    if(!available()){cancelGesture();return;}
    const {x,y}=gesture,b=wrap.getBoundingClientRect(), edge=32;
    if(y>=Math.max(b.top,0)&&y<Math.min(b.bottom,innerHeight)){
      const dx=x>b.right-edge&&x<b.right+8?10:x<b.left+edge&&x>b.left-8?-10:0;
      if(dx)wrap.scrollLeft+=dx;
      const insideScroll=wrap.scrollHeight>wrap.clientHeight+1;
      const dy=insideScroll?(y>Math.min(b.bottom,innerHeight)-32?12:y<Math.max(b.top,0)+72?-12:0):(y>innerHeight-72?12:y<72?-12:0);
      if(dy){if(insideScroll)wrap.scrollTop+=dy;else window.scrollBy(0,dy);}
    }
    showProposal(gesture,slotAt(x,y));frame=requestAnimationFrame(autoScroll);
  }
  grid.addEventListener('pointerdown',event=>{
    if(gesture&&event.pointerId!==gesture.id){cancelGesture('已取消多點觸控操作，原課表沒有變更。');return;}
    suppressUntil=0;
    if(!available()||event.button!==0||!event.isPrimary||picked)return;
    if(classic.dataset.weekDensity==='overview' && matchMedia('(max-width:680px)').matches)return;
    const handle=event.target.closest('[data-move-course]'),node=event.target.closest('.course[data-course]'),cell=event.target.closest('[data-slot]');
    const courseId=handle?.dataset.moveCourse||node?.dataset.course;
    if(courseId && event.pointerType!=='mouse' && !handle)return;
    if(!courseId && (!cell || cell.dataset.occupied==='true' || event.pointerType!=='mouse'))return;
    const anchor=slotAt(event.clientX,event.clientY);if(!anchor)return;
    const course=courseId?courses().find(c=>c.id===courseId):null;
    if(courseId&&!course)return;
    gesture={id:event.pointerId,kind:courseId?'move':'create',courseId,anchor,offset:course?anchor.period-course.start:0,previous:courses(),before:snapshot(),x0:event.clientX,y0:event.clientY,x:event.clientX,y:event.clientY,dragging:false};
    // Capture only after movement threshold; ordinary clicks retain their target.
    if(handle)event.preventDefault();
  });
  document.addEventListener('pointermove',event=>{
    if(!gesture||gesture.id!==event.pointerId)return;
    gesture.x=event.clientX;gesture.y=event.clientY;
    if(!gesture.dragging&&Math.hypot(gesture.x-gesture.x0,gesture.y-gesture.y0)<7)return;
    if(!gesture.dragging){gesture.dragging=true;grid.setPointerCapture(event.pointerId);grid.classList.add('direct-dragging');cancel.hidden=false;courseNode(gesture.courseId)?.classList.add('direct-source');frame=requestAnimationFrame(autoScroll);}
    event.preventDefault();showProposal(gesture,slotAt(event.clientX,event.clientY));
  },{passive:false});
  document.addEventListener('pointerup',event=>{
    if(!gesture||gesture.id!==event.pointerId)return;
    const task=gesture;
    if(!task.dragging){gesture=null;return;}
    const target=slotAt(event.clientX,event.clientY),valid=available(),plan=valid?showProposal(task,target):null;
    cancelGesture();
    if(task.before!==snapshot())return announce('課表已更新，沒有套用這次操作。');
    if(!plan?.draft)return announce('已取消操作，請放在課表內的完整時段，原課表沒有變更。');
    if(task.kind==='create')openAt(plan.draft);else requestMove(task,plan);
  });
  document.addEventListener('pointercancel',event=>{if(gesture?.id===event.pointerId)cancelGesture('操作已中斷，原課表沒有變更。')});
  // Touch starts with implicit capture on the handle. Its capture hand-off
  // bubbles a lost event; only loss from our grid can cancel an active drag.
  grid.addEventListener('lostpointercapture',event=>{if(event.target===grid&&gesture?.id===event.pointerId)cancelGesture('操作已中斷，原課表沒有變更。')});
  // Capture before existing card click/keydown handlers to prevent post-drag editing.
  grid.addEventListener('click',event=>{
    if(performance.now()<suppressUntil && event.detail!==0){event.preventDefault();event.stopImmediatePropagation();return;}
    if(!available())return;
    const handle=event.target.closest('[data-move-course]');
    if(handle&&!picked){event.preventDefault();event.stopImmediatePropagation();pickCourse(handle.dataset.moveCourse);return;}
    if(picked){
      event.preventDefault();event.stopImmediatePropagation();
      if(handle){pickCourse(handle.dataset.moveCourse);return;}
      const target=event.detail===0?cellValue(event.target.closest('[data-slot]')):slotAt(event.clientX,event.clientY);
      if(!target)return;const task=picked;const plan=showProposal(task,target);if(!plan)return;
      cancelGesture();requestMove(task,plan);return;
    }
    const cell=event.target.closest('[data-slot]');
    if(cell&&cell.dataset.occupied!=='true'){const value=cellValue(cell);lastCell=value;openAt({day:value.day,start:value.period,end:value.period});}
  },true);
  grid.addEventListener('keydown',event=>{
    const node=event.target.closest('[data-slot]');if(!node)return;
    if(['Enter',' '].includes(event.key)){event.preventDefault();node.click();return;}
    if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();let {day,period}=cellValue(node);
    const dx=event.key==='ArrowRight'?1:event.key==='ArrowLeft'?-1:0;
    const dy=event.key==='ArrowDown'?1:event.key==='ArrowUp'?-1:0;
    if(event.key==='Home')period=1;if(event.key==='End')period=PERIODS.length;
    for(let attempt=0;attempt<PERIODS.length;attempt++){
      day+=dx;period+=dy;
      if(day<1||day>5||period<1||period>PERIODS.length)break;
      const next=cellFor(day,period);
      if(next&&next.dataset.occupied!=='true'){node.tabIndex=-1;next.tabIndex=0;lastCell={day,period};next.focus();break;}
      if(!dx&&!dy)break;
    }
  },true);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&(gesture||picked)){event.preventDefault();event.stopImmediatePropagation();cancelGesture('已取消操作，原課表沒有變更。')}},true);
  window.addEventListener('blur',()=>cancelGesture());
  window.addEventListener('resize',()=>cancelGesture());
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelGesture()});
  document.addEventListener('puplan:view-changed',()=>cancelGesture());
  document.addEventListener('click',event=>{if(event.target.closest('[data-presentation],[data-schedule-mode],#accountChip'))cancelGesture()},true);
  document.addEventListener('pointerdown',event=>{if(picked&&!grid.contains(event.target)&&event.target!==cancel&&!event.target.closest('[data-week-jump]'))cancelGesture()},true);
  return Object.freeze({pick:pickCourse,cancel:()=>cancelGesture(gesture||picked?'已取消移動，原課表沒有變更。':'')});
}
