const $=s=>document.querySelector(s);
const cloud=window.PUPLAN_CLOUD;
if(!cloud)throw new Error('帳號功能載入失敗');

const ACCOUNT_KEYS=[
  'puplan_session','puplan_guest','puplan_courses','puplan_friends','puplan_schedule_meta','puplan_course_owner',
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

function redirectToLogin(message=''){
  sessionStorage.setItem('puplan_auth_target','login');
  if(message)sessionStorage.setItem('puplan_auth_message',message);
  const url=new URL(location.href);
  url.hash='';
  url.searchParams.delete('logout');
  location.replace(url.pathname+url.search);
}

async function safeLogout(){
  if(loggingOut)return;
  loggingOut=true;
  const btn=$('#logout');
  if(btn){btn.disabled=true;btn.textContent='登出中…'}
  clearAccountCache();
  redirectToLogin('已登出，可以登入其他帳號。');
}

function openLogin(){
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
    sessionStorage.removeItem('puplan_auth_target');
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
    },4500);
  },true);
}

document.addEventListener('puplan:profile-changed',()=>setTimeout(syncAuthUI,0));

const target=sessionStorage.getItem('puplan_auth_target');
if(target==='login'&&!cloud.isSignedIn?.()){
  setTimeout(()=>{
    openLogin();
    const msg=sessionStorage.getItem('puplan_auth_message')||'';
    sessionStorage.removeItem('puplan_auth_message');
    const status=$('#authStatus');
    if(status&&msg){status.textContent=msg;status.style.color='#226b43'}
  },0);
}

syncAuthUI();
window.PUPLAN_AUTH={logout:safeLogout,login:openLogin,clearAccountCache};
