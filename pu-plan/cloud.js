const API='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-api';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const app=window.PUPLAN_APP;
let token=localStorage.getItem('puplan_session')||'', profile=null;
let socialData={relationships:[],profiles:[],friends:[],meetups:[]}, searchTimer=null, syncTimer=null;

const esc=s=>app?.esc?.(s)||String(s||'');
const initial=(s='?')=>[...String(s||'?')][0]?.toUpperCase()||'?';
const normalizeUsername=v=>String(v||'').trim().replace(/^@/,'').toLowerCase();
const avatarHTML=(p,cls='avatar')=>p?.avatar_data||p?.avatar?`<div class="${cls}"><img src="${p.avatar_data||p.avatar}" alt=""></div>`:`<div class="${cls}">${esc(initial(p?.display_name||p?.name))}</div>`;
const setAuthStatus=(msg='',bad=false)=>{const e=$('#authStatus');if(e){e.textContent=msg;e.style.color=bad?'#9b2133':'#226b43'}};
function showGate(tab='register'){localStorage.removeItem('puplan_guest');$('#authGate')?.classList.remove('off');switchTab(tab)}
function hideGate(){$('#authGate')?.classList.add('off')}
function switchTab(tab){$$('[data-auth-tab]').forEach(b=>b.classList.toggle('on',b.dataset.authTab===tab));$('#registerForm')?.classList.toggle('hidden',tab!=='register');$('#loginForm')?.classList.toggle('hidden',tab!=='login');setAuthStatus('')}

async function api(action,payload={},auth=true){
  const headers={'Content-Type':'application/json'}; if(auth&&token)headers.Authorization=`Bearer ${token}`;
  let res; try{res=await fetch(API,{method:'POST',headers,body:JSON.stringify({action,...payload})})}catch{throw new Error('目前連不上雲端，請檢查網路後再試')}
  const data=await res.json().catch(()=>({}));
  if(!res.ok){if(res.status===401&&auth){clearSession(false);showGate('login')}throw new Error(data.message||'操作失敗')}
  return data;
}
function isSignedIn(){return !!token&&!!profile}
function updateAccountUI(){
  const name=profile?.display_name||'訪客';
  if($('#accountName'))$('#accountName').textContent=name;
  if($('#accountAvatar'))$('#accountAvatar').innerHTML=profile?.avatar_data?`<img src="${profile.avatar_data}" alt="">`:esc(initial(name));
  if($('#name'))$('#name').value=profile?.display_name||localStorage.getItem('puplan_name')||'';
  if($('#username'))$('#username').value=profile?.username||localStorage.getItem('puplan_username')||'';
  if($('#bio'))$('#bio').value=profile?.bio||localStorage.getItem('puplan_bio')||'';
  if($('#discoverable'))$('#discoverable').checked=profile?profile.discoverable!==false:true;
  if($('#profileAvatarPreview'))$('#profileAvatarPreview').innerHTML=(profile?.avatar_data||localStorage.getItem('puplan_avatar'))?`<img src="${profile?.avatar_data||localStorage.getItem('puplan_avatar')}" alt="">`:esc(initial(name));
  if($('#cloudState'))$('#cloudState').innerHTML=profile?`已登入<br><b>${esc(name)}</b> · @${esc(profile.username)}<br><span>課表會自動同步，只有已接受的好友能查看。</span>`:'訪客模式 · 好友搜尋與跨裝置同步停用';
  document.dispatchEvent(new CustomEvent('puplan:profile-changed',{detail:profile}));
}
function saveProfileLocal(p){
  profile=p; localStorage.setItem('puplan_name',p.display_name);localStorage.setItem('puplan_username',p.username);localStorage.setItem('puplan_bio',p.bio||'');
  if(p.avatar_data)localStorage.setItem('puplan_avatar',p.avatar_data);else localStorage.removeItem('puplan_avatar');
  localStorage.setItem('puplan_discoverable',p.discoverable===false?'0':'1'); updateAccountUI();app?.renderShare?.();
}
function clearSession(toast=true){token='';profile=null;socialData={relationships:[],profiles:[],friends:[],meetups:[]};localStorage.removeItem('puplan_session');const legacy=(app?.friends?.()||[]).filter(f=>!f.cloud);app?.setFriends?.(legacy);renderRequests();updateAccountUI();emitSocial();if(toast)app?.toast?.('已登出')}
function emitSocial(){document.dispatchEvent(new CustomEvent('puplan:social-changed',{detail:socialData}))}
function applySocial(social){socialData=social||{relationships:[],profiles:[],friends:[],meetups:[]};if(!socialData.meetups)socialData.meetups=[];const cloud=Array.isArray(socialData.friends)?socialData.friends:[];const legacy=(app?.friends?.()||[]).filter(f=>!f.cloud);app?.setFriends?.([...cloud,...legacy]);renderRequests();emitSocial()}
function relationFor(id){return (socialData.relationships||[]).find(r=>r.requester_id===id||r.addressee_id===id)}
function profileFor(id){return (socialData.profiles||[]).find(p=>p.id===id)||{display_name:'使用者',username:'',avatar_data:'',bio:''}}

async function bootstrap(){if(!token)return false;try{const data=await api('bootstrap');saveProfileLocal(data.profile);if(Array.isArray(data.courses))app?.setRemoteCourses?.(data.courses);applySocial(data.social);hideGate();return true}catch(e){console.warn(e);clearSession(false);return false}}
async function login(email,password){const data=await api('login',{email,password},false);token=data.token;localStorage.setItem('puplan_session',token);localStorage.removeItem('puplan_guest');saveProfileLocal(data.profile);if(Array.isArray(data.courses))app?.setRemoteCourses?.(data.courses);applySocial(data.social);hideGate();return data}
async function signup(display_name,username,email,password){const data=await api('signup',{display_name,username,email,password},false);token=data.token;localStorage.setItem('puplan_session',token);localStorage.removeItem('puplan_guest');saveProfileLocal(data.profile);app?.setRemoteCourses?.(Array.isArray(data.courses)?data.courses:[]);applySocial(data.social);hideGate();return data}
async function logout(){clearSession(true);localStorage.setItem('puplan_guest','1');localStorage.removeItem('puplan_courses');localStorage.removeItem('puplan_friends');app?.setRemoteCourses?.([]);app?.setFriends?.([]);hideGate()}
async function updateProfile(display_name,username,opts={}){
  username=normalizeUsername(username);if(!display_name?.trim())return app?.toast?.('請輸入顯示名稱');if(!/^[a-z0-9_.]{2,24}$/.test(username))return app?.toast?.('@帳號需 2–24 字，只能英文、數字、底線、句點');
  const payload={display_name:display_name.trim(),username,bio:String(opts.bio??profile?.bio??'').slice(0,120),discoverable:opts.discoverable!==false};if(Object.prototype.hasOwnProperty.call(opts,'avatar_data'))payload.avatar_data=opts.avatar_data||'';
  try{const data=await api('update_profile',payload);saveProfileLocal(data.profile);app?.toast?.('個人頁已更新');return data.profile}catch(e){app?.toast?.(e.message);throw e}
}
async function saveSchedule(courses){if(!isSignedIn())return;try{await api('save_schedule',{courses})}catch(e){console.warn('schedule sync',e.message)}}
function queueSchedule(courses){clearTimeout(syncTimer);syncTimer=setTimeout(()=>saveSchedule(courses),450)}
async function loadSocial(){if(!isSignedIn())return;try{const data=await api('social');applySocial(data.social);return socialData}catch(e){app?.toast?.(e.message)}}

function renderRequests(){
  const box=$('#requestList');if(!box)return;if(!isSignedIn()){box.innerHTML='<small>登入後顯示好友邀請。</small>';return}
  const uid=profile.id,rels=socialData.relationships||[],incoming=rels.filter(r=>r.status==='pending'&&r.addressee_id===uid),outgoing=rels.filter(r=>r.status==='pending'&&r.requester_id===uid);let html='';
  incoming.forEach(r=>{const p=profileFor(r.requester_id);html+=`<div class="request-card">${avatarHTML(p)}<div><b>${esc(p.display_name)}</b><small>@${esc(p.username)} · 想加你好友</small></div><div><button class="mini-btn" data-accept="${r.id}">接受</button><button class="mini-btn secondary" data-decline="${r.id}" style="margin-left:3px">略過</button></div></div>`});
  outgoing.forEach(r=>{const p=profileFor(r.addressee_id);html+=`<div class="request-card">${avatarHTML(p)}<div><b>${esc(p.display_name)}</b><small>@${esc(p.username)} · 等待接受</small></div><button class="mini-btn secondary" data-cancel="${r.id}">取消</button></div>`});
  box.innerHTML=html||'<small style="font-size:9px;color:var(--muted)">目前沒有好友邀請。</small>';
  box.querySelectorAll('[data-accept]').forEach(b=>b.onclick=()=>respondRequest('accept_request',+b.dataset.accept));box.querySelectorAll('[data-decline]').forEach(b=>b.onclick=()=>respondRequest('decline_request',+b.dataset.decline));box.querySelectorAll('[data-cancel]').forEach(b=>b.onclick=()=>cancelOutgoing(+b.dataset.cancel));
}
async function respondRequest(action,id){try{const data=await api(action,{friendship_id:id});applySocial(data.social);app?.toast?.(action==='accept_request'?'已成為好友':'已略過邀請')}catch(e){app?.toast?.(e.message)}}
async function cancelOutgoing(id){const r=(socialData.relationships||[]).find(x=>x.id===id);if(!r)return;try{const data=await api('remove_friend',{user_id:r.addressee_id});applySocial(data.social);app?.toast?.('邀請已取消')}catch(e){app?.toast?.(e.message)}}
async function sendRequest(id){try{const data=await api('send_request',{user_id:id});applySocial(data.social);app?.toast?.('好友邀請已送出');await searchPeople($('#cloudFriendSearch')?.value||'')}catch(e){app?.toast?.(e.message)}}
async function removeFriend(id){try{const data=await api('remove_friend',{user_id:id});applySocial(data.social);app?.setSelectedFriend?.(null);app?.toast?.('好友已移除')}catch(e){app?.toast?.(e.message)}}
async function searchPeople(raw){
  const box=$('#cloudSearchResults');if(!box)return;if(!isSignedIn()){box.innerHTML='<small>登入後才能搜尋使用者。</small>';return}const q=String(raw||'').trim().replace(/^@/,'');if(q.length<2){box.innerHTML=q?'<small>至少輸入 2 個字。</small>':'';return}
  try{const data=await api('search_people',{query:q});const people=data.people||[];box.innerHTML=people.length?people.map(p=>{const r=relationFor(p.id);let ctl=r?.status==='accepted'?'<span class="mini-btn secondary">已是好友</span>':r?.status==='pending'?'<span class="mini-btn secondary">邀請中</span>':`<button class="mini-btn" data-add-person="${p.id}">＋ 好友</button>`;return `<div class="person-result">${avatarHTML(p)}<div><b>${esc(p.display_name)}</b><small>@${esc(p.username)}${p.bio?` · ${esc(p.bio.slice(0,28))}`:''}</small></div>${ctl}</div>`}).join(''):'<small>找不到符合的使用者。</small>';box.querySelectorAll('[data-add-person]').forEach(b=>b.onclick=()=>sendRequest(b.dataset.addPerson))}catch(e){box.innerHTML=`<small>${esc(e.message)}</small>`}
}
async function createMeetup(user_id,kind,day,start_period,end_period,note=''){try{const data=await api('create_meetup',{user_id,kind,day,start_period,end_period,note});applySocial(data.social);app?.toast?.(kind==='meal'?'吃飯邀約已送出 🍜':'讀書邀約已送出 📚');return true}catch(e){app?.toast?.(e.message);return false}}
async function respondMeetup(meetup_id,decision){try{const data=await api('respond_meetup',{meetup_id,decision});applySocial(data.social);app?.toast?.(decision==='accepted'?'已接受邀約 ✦':'已婉拒邀約');return true}catch(e){app?.toast?.(e.message);return false}}
async function cancelMeetup(meetup_id){try{const data=await api('cancel_meetup',{meetup_id});applySocial(data.social);app?.toast?.('邀約已取消');return true}catch(e){app?.toast?.(e.message);return false}}

$$('[data-auth-tab]').forEach(b=>b.onclick=()=>switchTab(b.dataset.authTab));
$('#guestMode')?.addEventListener('click',()=>{localStorage.setItem('puplan_guest','1');clearSession(false);hideGate();app?.toast?.('目前使用訪客模式')});
$('#registerForm')?.addEventListener('submit',async e=>{e.preventDefault();const display_name=$('#regName').value.trim(),username=normalizeUsername($('#regUsername').value),email=$('#regEmail').value.trim(),password=$('#regPassword').value;if(!/^[a-z0-9_.]{2,24}$/.test(username))return setAuthStatus('@帳號需 2–24 字，只能英文、數字、底線、句點',true);if(password.length<8)return setAuthStatus('密碼至少 8 個字元',true);setAuthStatus('建立帳號中…');try{await signup(display_name,username,email,password);setAuthStatus('註冊完成');app?.toast?.('Welcome to PU/PLAN ✦')}catch(err){setAuthStatus(err.message,true)}});
$('#loginForm')?.addEventListener('submit',async e=>{e.preventDefault();setAuthStatus('登入中…');try{await login($('#loginEmail').value.trim(),$('#loginPassword').value);setAuthStatus('');app?.toast?.('登入成功')}catch(err){setAuthStatus(err.message,true)}});
$('#cloudFriendSearch')?.addEventListener('input',e=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>searchPeople(e.target.value),260)});
document.addEventListener('puplan:courses-changed',e=>queueSchedule(e.detail||[]));

window.PUPLAN_CLOUD={isSignedIn,showGate,logout,updateProfile,removeFriend,searchPeople,loadSocial,syncSchedule:()=>saveSchedule(app?.courses?.()||[]),getProfile:()=>profile,getSocial:()=>socialData,createMeetup,respondMeetup,cancelMeetup,avatarHTML};

updateAccountUI();
if(token){const ok=await bootstrap();if(!ok&&!localStorage.getItem('puplan_guest'))showGate('login')}else if(localStorage.getItem('puplan_guest')==='1')hideGate();else showGate('register');