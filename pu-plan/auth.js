const $=s=>document.querySelector(s);
const cloud=window.PUPLAN_CLOUD;
if(!cloud)throw new Error('帳號功能載入失敗');

const ACCOUNT_KEYS=[
  'puplan_session','puplan_session_primary_v1','puplan_session_standby_v1','puplan_portable_session_v1','nolu_preferred_cloud_v1',
  'puplan_guest','puplan_courses','puplan_friends','puplan_schedule_meta','puplan_course_owner',
  'puplan_name','puplan_username','puplan_bio','puplan_avatar','puplan_discoverable'
];
const ACCOUNT_PREFIXES=[
  'nolu_standby_dirty_v1:','nolu_standby_seeded_v1:',
  'nolu_standby_dirty_v2:','nolu_standby_seeded_v2:',
  'nolu_standby_dirty_v3:','nolu_standby_seeded_v3:'
];
let loggingOut=false;

function clearAccountCache(){
  for(const key of ACCOUNT_KEYS)localStorage.removeItem(key);
  for(let i=localStorage.length-1;i>=0;i--){
    const key=localStorage.key(i)||'';
    if(ACCOUNT_PREFIXES.some(prefix=>key.startsWith(prefix)))localStorage.removeItem(key);
  }
  for(let i=sessionStorage.length-1;i>=0;i--){
    const key=sessionStorage.key(i)||'';
    if(key.startsWith('puplan_assistant_')||key==='puplan_assistant_history')sessionStorage.removeItem(key);
  }
}

async function safeLogout(){
  if(loggingOut)return;
  loggingOut=true;
  const btn=$('#logout');
  if(btn){btn.disabled=true;btn.textContent='登出中…'}
  try{
    clearAccountCache();
    await cloud.logout?.();
    cloud.showGate?.('login');
    const status=$('#authStatus');
    if(status){status.textContent='已登出，可以登入其他帳號。';status.style.color='#226b43'}
  }finally{
    loggingOut=false;
    syncAuthUI();
  }
}

function openLogin(){
  loggingOut=false;
  cloud.showGate?.('login');
  setTimeout(()=>$('#loginEmail')?.focus(),80);
}

function syncAuthUI(){
  const signed=cloud.isSignedIn?.()===true;
  const logout=$('#logout');
  if(logout){
    logout.disabled=false;
    logout.textContent=signed?'登出':'登入 / 註冊';
    logout.onclick=signed?safeLogout:openLogin;
  }
  const chip=$('#accountChip');
  if(chip&&!signed){
    const name=$('#accountName');
    if(name)name.textContent='登入';
  }
  if(signed){
    $('#loginPassword')&&($('#loginPassword').value='');
    $('#regPassword')&&($('#regPassword').value='');
  }
}

$('#accountChip')?.addEventListener('click',e=>{
  if(cloud.isSignedIn?.())return;
  e.preventDefault();
  e.stopImmediatePropagation();
  openLogin();
},true);

const gate=$('#authGate');
let gateWasOpen=false,returnFocus=null;
function syncGuestEntry(){
  const open=!gate.classList.contains('off');
  const resume=window.NOLU_GUEST_PRIVACY?.canResumeGuest?.()===true;
  const count=resume?window.PUPLAN_APP?.courses?.().length||0:0;
  $('#guestMode').textContent=resume?'返回我的課表':'先用訪客課表，不登入';
  $('#guestWorkspaceNotice').hidden=!count;
  if(count)$('#guestWorkspaceText').textContent=`這裡有 ${count} 門訪客課程。登入後會顯示帳號課表，不會自動合併這份內容。`;
  if(open&&!gateWasOpen){
    returnFocus=document.activeElement;
    queueMicrotask(()=>gate.querySelector('.auth-form:not(.hidden) input:not(:disabled)')?.focus({preventScroll:true}));
  }else if(!open&&gateWasOpen){
    const target=returnFocus?.isConnected&&!gate.contains(returnFocus)?returnFocus:$('#title');
    if(target){if(target===$('#title'))target.tabIndex=-1;target.focus({preventScroll:true})}
  }
  gateWasOpen=open;
}
$('#guestWorkspaceBackup').addEventListener('click',()=>$('#downloadSchedule')?.click());
gate.addEventListener('keydown',event=>{
  if(gate.classList.contains('off')||event.isComposing)return;
  if(event.key==='Escape'&&window.NOLU_GUEST_PRIVACY?.canResumeGuest?.()){
    event.preventDefault();$('#guestMode').click();return;
  }
  if(event.key!=='Tab')return;
  const controls=[...gate.querySelectorAll('button,input,a[href],[tabindex="0"]')].filter(element=>!element.disabled&&element.getClientRects().length);
  if(!controls.length){event.preventDefault();gate.focus();return}
  const first=controls[0],last=controls.at(-1),active=document.activeElement;
  if(event.shiftKey&&(active===first||!controls.includes(active))){event.preventDefault();last.focus()}
  else if(!event.shiftKey&&(active===last||!controls.includes(active))){event.preventDefault();first.focus()}
});
new MutationObserver(syncGuestEntry).observe(gate,{attributes:true,attributeFilter:['class']});
syncGuestEntry();

document.addEventListener('puplan:profile-changed',()=>setTimeout(syncAuthUI,0));
syncAuthUI();
window.PUPLAN_AUTH={logout:safeLogout,login:openLogin,clearAccountCache};