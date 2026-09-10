const $=s=>document.querySelector(s);
const cloud=window.PUPLAN_CLOUD;
if(!cloud)throw new Error('帳號功能載入失敗');

const ACCOUNT_KEYS=[
  'puplan_session','puplan_portable_session_v1','nolu_preferred_cloud_v1','puplan_guest','puplan_courses','puplan_friends','puplan_schedule_meta','puplan_course_owner',
  'puplan_name','puplan_username','puplan_bio','puplan_avatar','puplan_discoverable'
];
let loggingOut=false;

function clearAccountCache(){
  for(const key of ACCOUNT_KEYS)localStorage.removeItem(key);
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
  localStorage.removeItem('puplan_guest');
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

for(const form of [$('#loginForm'),$('#registerForm')]){
  if(!form)continue;
  form.addEventListener('submit',()=>{
    const submit=form.querySelector('[type="submit"],button:not([type])');
    if(!submit)return;
    submit.disabled=true;
    const original=submit.textContent;
    submit.dataset.authOriginal=original||'';
    setTimeout(()=>{
      if(!cloud.isSignedIn?.()&&document.body.contains(submit)){
        submit.disabled=false;
        if(submit.dataset.authOriginal)submit.textContent=submit.dataset.authOriginal;
      }
    },15000);
  },true);
}

document.addEventListener('puplan:profile-changed',()=>setTimeout(syncAuthUI,0));
syncAuthUI();
window.PUPLAN_AUTH={logout:safeLogout,login:openLogin,clearAccountCache};
