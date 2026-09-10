const API='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-api';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const app=window.PUPLAN_APP;
let state={semesters:[],active_semester:null,courses:[]};
let socialState=null;
let loading=false;
let importSyncTimer=null;

const token=()=>localStorage.getItem('puplan_session')||'';
const profile=()=>window.PUPLAN_CLOUD?.getProfile?.()||null;
const signedIn=()=>!!token()&&window.PUPLAN_CLOUD?.isSignedIn?.()===true;
const esc=s=>app?.esc?.(String(s??''))||String(s??'');
const toast=s=>app?.toast?.(s);

async function api(action,payload={},auth=true){
  const headers={'Content-Type':'application/json'};
  if(auth&&token())headers.Authorization=`Bearer ${token()}`;
  let res;
  try{res=await fetch(API,{method:'POST',headers,body:JSON.stringify({action,...payload})})}
  catch{throw new Error('目前連不上服務，請稍後再試')}
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data.message||'目前無法完成這個操作');
  return data;
}

function active(){return state.active_semester||state.semesters?.find(x=>x.is_current)||state.semesters?.[0]||null}
function semesterMeta(s){
  if(!s)return{};
  const m=String(s.semester_key||'').match(/^(\d+)-(\d)$/);
  return {school:s.school||'',year:m?.[1]||'',semester:m?.[2]||'',className:s.class_name||'',credits:Number(s.credits||0),title:s.label||''};
}
function semesterLabel(s){return s?.label||s?.semester_key||'設定學期'}

function ensureDialogs(){
  if($('#semesterDialog'))return;
  document.body.insertAdjacentHTML('beforeend',`
  <dialog id="semesterDialog" class="nr-dialog"><div class="nr-shell">
    <div class="nr-title"><div><h2>我的學期</h2><p>切換不同學期，課表會一起切換。</p></div><button class="x" type="button" data-close="semesterDialog">×</button></div>
    <div id="semesterList" class="semester-list"></div>
    <div class="nr-grid">
      <label class="nr-label">學年度<input class="field" id="semYear" inputmode="numeric" placeholder="115"></label>
      <label class="nr-label">學期<select class="field" id="semTerm"><option value="1">第 1 學期</option><option value="2">第 2 學期</option></select></label>
      <label class="nr-label full">學校<input class="field" id="semSchool" placeholder="例如：靜宜大學"></label>
      <label class="nr-label">系所<input class="field" id="semDept" placeholder="例如：資訊管理學系"></label>
      <label class="nr-label">班級<input class="field" id="semClass" placeholder="例如：資管四 B"></label>
      <label class="nr-label">學分<input class="field" id="semCredits" type="number" min="0" max="60" placeholder="18"></label>
    </div>
    <div class="nr-actions"><button class="btn" id="fillSemester" type="button">帶入目前資料</button><button class="btn primary" id="saveSemester" type="button">儲存並切換</button></div>
  </div></dialog>
  <dialog id="forgotDialog" class="nr-dialog"><div class="nr-shell">
    <div class="nr-title"><div><h2>重設密碼</h2><p>用你先前保存的帳號救援碼設定新密碼。</p></div><button class="x" type="button" data-close="forgotDialog">×</button></div>
    <div class="nr-grid">
      <label class="nr-label full">Email<input class="field" id="fpEmail" type="email" autocomplete="email"></label>
      <label class="nr-label full">帳號救援碼<input class="field" id="fpCode" autocomplete="off" placeholder="XXXX-XXXX-XXXX-XXXX"></label>
      <label class="nr-label full">新密碼<input class="field" id="fpPassword" type="password" minlength="8" autocomplete="new-password"></label>
    </div>
    <div class="nr-actions"><button class="btn primary" id="fpSubmit" type="button">重設密碼</button></div>
  </div></dialog>
  <dialog id="recoveryDialog" class="nr-dialog"><div class="nr-shell">
    <div class="nr-title"><div><h2>帳號救援碼</h2><p>請存到密碼管理器或安全的地方。產生新碼後，舊碼會失效。</p></div><button class="x" type="button" data-close="recoveryDialog">×</button></div>
    <div class="recovery-code" id="recoveryCode">—</div>
    <div class="nr-actions"><button class="btn primary" id="copyRecovery" type="button">複製救援碼</button></div>
  </div></dialog>`);
  $$('[data-close]').forEach(b=>b.onclick=()=>$('#'+b.dataset.close)?.close());
}

function addTopControls(){
  const actions=$('.topbar .actions');
  if(!actions)return;
  if(!$('#notifyChip')){
    actions.insertAdjacentHTML('afterbegin',`<div class="notify-wrap"><button class="notify-chip" id="notifyChip" type="button" title="通知">○<span class="notify-badge hidden" id="notifyBadge">0</span></button><div class="notify-pop" id="notifyPop"><div class="notify-head"><b>通知</b><button class="mini-action" id="notifyRefresh" type="button">更新</button></div><div id="notifyList" class="notify-empty">目前沒有通知</div></div></div>`);
    $('#notifyChip').onclick=e=>{e.stopPropagation();$('#notifyPop').classList.toggle('on');if($('#notifyPop').classList.contains('on'))refreshNotifications()};
    $('#notifyRefresh').onclick=refreshNotifications;
    document.addEventListener('click',e=>{if(!e.target.closest('.notify-wrap'))$('#notifyPop')?.classList.remove('on')});
  }
  if(!$('#semesterChip')){
    const notify=$('.notify-wrap');
    notify?.insertAdjacentHTML('afterend',`<button class="semester-chip" id="semesterChip" type="button" title="切換學期"><b id="semesterTiny">—</b><span id="semesterChipText">學期</span></button>`);
    $('#semesterChip').onclick=()=>{fillSemester(active());renderSemesters();$('#semesterDialog')?.showModal()};
  }
}

function addAccountTools(){
  const card=$('.profile-settings');
  if(!card||$('#accountTools'))return;
  card.insertAdjacentHTML('beforeend',`<div class="account-tools" id="accountTools"><h3>帳號安全</h3><p>可以更新密碼，也可以先保存一組救援碼，忘記密碼時會用到。</p><div class="account-tool-grid"><button class="btn" id="makeRecovery" type="button">產生救援碼</button><button class="btn" id="changePasswordBtn" type="button">變更密碼</button></div><div id="changePasswordBox" class="change-password-box hidden"><div class="nr-grid"><label class="nr-label full">目前密碼<input class="field" id="cpCurrent" type="password" autocomplete="current-password"></label><label class="nr-label full">新密碼<input class="field" id="cpNext" type="password" minlength="8" autocomplete="new-password"></label></div><button class="btn primary setting-full" id="cpSubmit" type="button">更新密碼</button></div></div>`);
  $('#makeRecovery').onclick=rotateRecovery;
  $('#changePasswordBtn').onclick=()=>$('#changePasswordBox')?.classList.toggle('hidden');
  $('#cpSubmit').onclick=changePassword;
}

function addForgotLink(){
  const form=$('#loginForm');
  if(!form||$('#forgotPasswordLink'))return;
  const b=document.createElement('button');
  b.type='button';b.id='forgotPasswordLink';b.className='forgot-link';b.textContent='忘記密碼？使用帳號救援碼';
  b.onclick=()=>$('#forgotDialog')?.showModal();
  form.appendChild(b);
}

function fillSemester(s){
  const m=String(s?.semester_key||'').match(/^(\d+)-(\d)$/);
  $('#semYear').value=m?.[1]||'';
  $('#semTerm').value=m?.[2]||'1';
  $('#semSchool').value=s?.school||'';
  $('#semDept').value=s?.department||'';
  $('#semClass').value=s?.class_name||'';
  $('#semCredits').value=s?.credits||'';
}
function semesterPayload(){
  const year=$('#semYear').value.trim(),term=$('#semTerm').value;
  return {semester_key:`${year}-${term}`,label:`${year} 學年度・第 ${term} 學期`,school:$('#semSchool').value.trim(),department:$('#semDept').value.trim(),class_name:$('#semClass').value.trim(),credits:Number($('#semCredits').value)||0,set_current:true};
}
function renderSemesterChip(){
  const s=active();
  if($('#semesterChipText'))$('#semesterChipText').textContent=s?semesterLabel(s):'設定學期';
  if($('#semesterTiny'))$('#semesterTiny').textContent=s?.semester_key?String(s.semester_key).replace('-','/'):'＋';
}
function renderSemesters(){
  const box=$('#semesterList');if(!box)return;
  const list=state.semesters||[];
  if(!list.length){box.innerHTML='<div class="notify-empty">還沒有學期資料</div>';return}
  box.innerHTML=list.map(s=>`<div class="semester-row ${s.is_current?'current':''}"><div><b>${esc(semesterLabel(s))}${s.is_current?' · 使用中':''}</b><small>${esc([s.school,s.department,s.class_name,s.credits?`${s.credits} 學分`:'' ].filter(Boolean).join(' · ')||'還沒有補充資料')}</small></div><div class="semester-row-actions">${s.is_current?'':`<button type="button" data-switch-sem="${esc(s.semester_key)}">切換</button>`}${list.length>1?`<button type="button" data-delete-sem="${esc(s.semester_key)}">刪除</button>`:''}</div></div>`).join('');
  box.querySelectorAll('[data-switch-sem]').forEach(b=>b.onclick=()=>switchSemester(b.dataset.switchSem));
  box.querySelectorAll('[data-delete-sem]').forEach(b=>b.onclick=()=>deleteSemester(b.dataset.deleteSem));
}

async function loadSemesters(){
  if(!signedIn()||loading)return;
  loading=true;
  try{
    const data=await api('semesters');
    state=data||state;
    app?.setRemoteMeta?.(semesterMeta(active()));
    renderSemesterChip();
    renderSemesters();
    maybePromptSemester();
  }catch(e){console.warn('semester',e)}finally{loading=false}
}
async function saveSemester(){
  const payload=semesterPayload();
  if(!/^\d{2,3}-[12]$/.test(payload.semester_key))return toast('請填入正確的學年度');
  try{
    const data=await api('upsert_semester',payload);state=data;
    app?.setRemoteCourses?.(data.courses||[]);app?.setRemoteMeta?.(semesterMeta(active()));
    renderSemesterChip();renderSemesters();$('#semesterDialog')?.close();toast('學期已儲存');
  }catch(e){toast(e.message)}
}
async function switchSemester(key){
  try{
    const data=await api('switch_semester',{semester_key:key});state=data;
    app?.setRemoteCourses?.(data.courses||[]);app?.setRemoteMeta?.(semesterMeta(active()));
    renderSemesterChip();renderSemesters();$('#semesterDialog')?.close();toast(`已切換到 ${semesterLabel(active())}`);
  }catch(e){toast(e.message)}
}
async function deleteSemester(key){
  if(!confirm('要刪除這個學期嗎？這個學期的課表也會一起刪除。'))return;
  try{
    const data=await api('delete_semester',{semester_key:key});state=data;
    app?.setRemoteCourses?.(data.courses||[]);app?.setRemoteMeta?.(semesterMeta(active()));
    renderSemesterChip();renderSemesters();toast('學期已刪除');
  }catch(e){toast(e.message)}
}
function maybePromptSemester(){
  const id=profile()?.id;if(!id||state.semesters?.length)return;
  const key=`nolu_semester_prompted_${id}`;
  if(localStorage.getItem(key))return;
  localStorage.setItem(key,'1');
  setTimeout(()=>{$('#semesterDialog')?.showModal()},350);
}

async function rotateRecovery(){
  if(!signedIn())return toast('請先登入');
  try{const data=await api('rotate_recovery_code');$('#recoveryCode').textContent=data.recovery_code||'—';$('#recoveryDialog')?.showModal()}catch(e){toast(e.message)}
}
async function changePassword(){
  const current_password=$('#cpCurrent').value,new_password=$('#cpNext').value;
  if(new_password.length<8)return toast('新密碼至少 8 個字元');
  try{await api('change_password',{current_password,new_password});$('#cpCurrent').value='';$('#cpNext').value='';$('#changePasswordBox')?.classList.add('hidden');toast('密碼已更新')}catch(e){toast(e.message)}
}
async function recoverPassword(){
  const email=$('#fpEmail').value.trim(),recovery_code=$('#fpCode').value.trim(),new_password=$('#fpPassword').value;
  if(new_password.length<8)return toast('新密碼至少 8 個字元');
  try{const data=await api('recover_password',{email,recovery_code,new_password},false);$('#forgotDialog')?.close();toast(data.message||'密碼已重設')}catch(e){toast(e.message)}
}

function profileMap(s){return new Map((s?.profiles||[]).map(p=>[p.id,p]))}
function notificationItems(s){
  if(!s||!profile()?.id)return[];
  const uid=profile().id,pmap=profileMap(s),items=[];
  (s.relationships||[]).filter(r=>r.status==='pending'&&r.addressee_id===uid).forEach(r=>{const p=pmap.get(r.requester_id)||{};items.push({title:`${p.display_name||'有人'} 想加你好友`,sub:p.username?`@${p.username}`:'好友邀請'})});
  (s.meetups||[]).filter(m=>m.status==='pending'&&m.invitee_id===uid).forEach(m=>{const p=pmap.get(m.creator_id)||{};items.push({title:`${p.display_name||'好友'} 約你${m.kind==='meal'?'吃飯':'讀書'}`,sub:'到「找人」查看邀請'})});
  return items;
}
function renderNotifications(){
  const items=notificationItems(socialState),box=$('#notifyList'),badge=$('#notifyBadge');
  if(badge){badge.textContent=items.length;badge.classList.toggle('hidden',!items.length)}
  if(!box)return;
  box.className=items.length?'':'notify-empty';
  box.innerHTML=items.length?items.map(x=>`<button class="notify-item" type="button" data-open-friends><b>${esc(x.title)}</b><span>${esc(x.sub)}</span></button>`).join(''):'目前沒有待處理通知';
  box.querySelectorAll('[data-open-friends]').forEach(b=>b.onclick=()=>{app?.changeView?.('friends');$('#notifyPop')?.classList.remove('on')});
}
async function refreshNotifications(){
  if(!signedIn())return;
  try{await window.PUPLAN_CLOUD?.loadSocial?.();socialState=window.PUPLAN_CLOUD?.getSocial?.()||socialState;renderNotifications()}catch(e){console.warn('notifications',e)}
}

function syncImportedMeta(){
  clearTimeout(importSyncTimer);
  importSyncTimer=setTimeout(async()=>{
    if(!signedIn())return;
    const m=app?.scheduleMeta?.()||{},s=active();
    if(!s||(!m.school&&!m.year&&!m.semester&&!m.className&&!m.credits))return;
    const year=m.year||String(s.semester_key||'').split('-')[0],term=m.semester||String(s.semester_key||'').split('-')[1]||'1';
    if(!year)return;
    try{const data=await api('upsert_semester',{semester_key:`${year}-${term}`,label:m.title||`${year} 學年度・第 ${term} 學期`,school:m.school||s.school||'',department:s.department||'',class_name:m.className||s.class_name||'',credits:Number(m.credits||s.credits||0),set_current:true});state=data;renderSemesterChip()}catch(e){console.warn('semester sync',e)}
  },650);
}

function bind(){
  ensureDialogs();addTopControls();addAccountTools();addForgotLink();
  $('#fillSemester').onclick=()=>fillSemester(active());
  $('#saveSemester').onclick=saveSemester;
  $('#fpSubmit').onclick=recoverPassword;
  $('#copyRecovery').onclick=async()=>{const value=$('#recoveryCode').textContent||'';try{await navigator.clipboard.writeText(value);toast('救援碼已複製')}catch{prompt('請複製救援碼',value)}};
  document.addEventListener('puplan:social-changed',e=>{socialState=e.detail;renderNotifications()});
  document.addEventListener('puplan:courses-changed',syncImportedMeta);
  document.addEventListener('puplan:profile-changed',()=>{if(signedIn())loadSemesters();else{state={semesters:[],active_semester:null,courses:[]};renderSemesterChip();renderNotifications()}});
  if(signedIn())setTimeout(()=>{loadSemesters();refreshNotifications()},250);
}

bind();
window.PUPLAN_SEMESTERS={load:loadSemesters,open:()=>{fillSemester(active());renderSemesters();$('#semesterDialog')?.showModal()}};
