const API_PRIMARY='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-api-v6';
const API_FALLBACK='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-core-v1';
const APIS=[API_PRIMARY,API_FALLBACK];
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const app=window.PUPLAN_APP;
let token=localStorage.getItem('puplan_session')||'', profile=null;
let preferredApi=Math.max(0,Math.min(APIS.length-1,Number(sessionStorage.getItem('puplan_api_index')||0)||0));
let socialData={relationships:[],profiles:[],friends:[],meetups:[]}, searchTimer=null, syncTimer=null, socialLoading=null, socialLoaded=false, socialSummary={};

const esc=s=>app?.esc?.(s)||String(s||'');
const initial=(s='?')=>[...String(s||'?')][0]?.toUpperCase()||'?';
const normalizeUsername=v=>String(v||'').trim().replace(/^@/,'').toLowerCase();
const avatarHTML=(p,cls='avatar')=>p?.avatar_data||p?.avatar?`<div class="${cls}"><img src="${p.avatar_data||p.avatar}" alt=""></div>`:`<div class="${cls}">${esc(initial(p?.display_name||p?.name))}</div>`;
const setAuthStatus=(msg='',bad=false)=>{const e=$('#authStatus');if(e){e.textContent=msg;e.style.color=bad?'#9b2133':'#226b43'}};
function showGate(tab='register'){localStorage.removeItem('puplan_guest');$('#authGate')?.classList.remove('off');switchTab(tab)}
function hideGate(){$('#authGate')?.classList.add('off')}
function switchTab(tab){$$('[data-auth-tab]').forEach(b=>b.classList.toggle('on',b.dataset.authTab===tab));$('#registerForm')?.classList.toggle('hidden',tab!=='register');$('#loginForm')?.classList.toggle('hidden',tab!=='login');setAuthStatus('')}

function cloudError(message,props={}){const e=new Error(message);Object.assign(e,props);return e}
async function fetchWithTimeout(url,options={},timeout=6500){
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),timeout);
  try{return await fetch(url,{...options,signal:ctrl.signal,cache:'no-store'})}
  finally{clearTimeout(timer)}
}
async function api(action,payload={},auth=true){
  const headers={'Content-Type':'application/json'};if(auth&&token)headers.Authorization=`Bearer ${token}`;
  const body=JSON.stringify({action,...payload});
  const order=[preferredApi,...APIS.map((_,i)=>i).filter(i=>i!==preferredApi)];
  let lastFailure=null;
  for(let n=0;n<order.length;n++){
    const index=order[n],url=APIS[index];
    let res;
    try{res=await fetchWithTimeout(url,{method:'POST',headers,body},6500)}
    catch(err){lastFailure=err;continue}
    const data=await res.json().catch(()=>({}));
    if(res.status>=500&&n<order.length-1){lastFailure=cloudError(data.message||`雲端服務錯誤 (${res.status})`,{status:res.status});continue}
    preferredApi=index;sessionStorage.setItem('puplan_api_index',String(index));
    if(!res.ok){
      if(res.status===401&&auth){clearSession(false);showGate('login')}
      throw cloudError(data.message||'操作失敗',{status:res.status,code:data.error||''});
    }
    return data;
  }
  const timedOut=lastFailure?.name==='AbortError';
  throw cloudError(timedOut?'雲端回應逾時，已自動切換備援仍失敗，請稍後再試':'目前連不上雲端，已自動切換備援仍失敗',{connectivity:true,cause:lastFailure});
}
function isSignedIn(){return !!token&&!!profile}
function purgeAccountCache(){
  localStorage.removeItem('puplan_courses');
  localStorage.removeItem('puplan_friends');
  localStorage.removeItem('puplan_schedule_meta');
  localStorage.removeItem('puplan_course_owner');
  app?.setRemoteCourses?.([]);
  app?.setFriends?.([]);
}
function isolateAccountCache(userId){
  const owner=localStorage.getItem('puplan_course_owner');
  if(owner&&owner!==userId){
    localStorage.removeItem('puplan_courses');
    localStorage.removeItem('puplan_friends');
    localStorage.removeItem('puplan_schedule_meta');
    app?.setRemoteCourses?.([]);
    app?.setRemoteMeta?.({});
    app?.setFriends?.([]);
  }
  localStorage.setItem('puplan_course_owner',userId);
}
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
  profile=p;localStorage.setItem('puplan_name',p.display_name);localStorage.setItem('puplan_username',p.username);localStorage.setItem('puplan_bio',p.bio||'');
  if(p.avatar_data)localStorage.setItem('puplan_avatar',p.avatar_data);else localStorage.removeItem('puplan_avatar');
  localStorage.setItem('puplan_discoverable',p.discoverable===false?'0':'1');updateAccountUI();app?.renderShare?.();
}
function clearSession(toast=true){token='';profile=null;socialLoaded=false;socialLoading=null;socialSummary={};socialData={relationships:[],profiles:[],friends:[],meetups:[]};localStorage.removeItem('puplan_session');const legacy=(app?.friends?.()||[]).filter(f=>!f.cloud);app?.setFriends?.(legacy);renderRequests();updateAccountUI();emitSocial();if(toast)app?.toast?.('已登出')}
function emitSocial(){document.dispatchEvent(new CustomEvent('puplan:social-changed',{detail:socialData}))}
function applySocial(social){socialData=social||{relationships:[],profiles:[],friends:[],meetups:[]};if(!socialData.meetups)socialData.meetups=[];const cloud=Array.isArray(socialData.friends)?socialData.friends:[];const legacy=(app?.friends?.()||[]).filter(f=>!f.cloud);app?.setFriends?.([...cloud,...legacy]);renderRequests();emitSocial()}
function relationFor(id){return (socialData.relationships||[]).find(r=>r.requester_id===id||r.addressee_id===id)}
function profileFor(id){return (socialData.profiles||[]).find(p=>p.id===id)||{display_name:'使用者',username:'',avatar_data:'',bio:''}}
function applyCoreBundle(data){isolateAccountCache(data.profile.id);saveProfileLocal(data.profile);app?.setRemoteCourses?.(Array.isArray(data.courses)?data.courses:[]);socialSummary=data.social_summary||{};applySocial(data.social||{relationships:[],profiles:[],friends:[],meetups:[]})}

async function bootstrap(){if(!token)return false;try{const data=await api('bootstrap');applyCoreBundle(data);hideGate();return true}catch(e){console.warn('cloud bootstrap',e);if(e?.status===401)clearSession(false);return false}}
async function login(email,password){const data=await api('login',{email,password},false);token=data.token;localStorage.setItem('puplan_session',token);localStorage.removeItem('puplan_guest');applyCoreBundle(data);hideGate();return data}
async function signup(display_name,username,email,password){const data=await api('signup',{display_name,username,email,password},false);token=data.token;localStorage.setItem('puplan_session',token);localStorage.removeItem('puplan_guest');applyCoreBundle(data);hideGate();return data}
async function logout(){clearSession(true);purgeAccountCache();localStorage.removeItem('puplan_guest');showGate('login')}
async function updateProfile(display_name,username,opts={}){
  username=normalizeUsername(username);if(!display_name?.trim())return app?.toast?.('請輸入顯示名稱');if(!/^[a-z0-9_.]{2,24}$/.test(username))return app?.toast?.('@帳號需 2–24 字，只能英文、數字、底線、句點');
  const payload={display_name:display_name.trim(),username,bio:String(opts.bio??profile?.bio??'').slice(0,120),discoverable:opts.discoverable!==false};if(Object.prototype.hasOwnProperty.call(opts,'avatar_data'))payload.avatar_data=opts.avatar_data||'';
  try{const data=await api('update_profile',payload);saveProfileLocal(data.profile);app?.toast?.('個人頁已更新');return data.profile}catch(e){app?.toast?.(e.message);throw e}
}
async function saveSchedule(courses){if(!isSignedIn())return;try{await api('save_schedule',{courses})}catch(e){console.warn('schedule sync',e.message)}}
function queueSchedule(courses){clearTimeout(syncTimer);syncTimer=setTimeout(()=>saveSchedule(courses),450)}
async function loadSocial(force=false){
  if(!isSignedIn())return;
  if(socialLoaded&&!force)return socialData;
  if(socialLoading)return socialLoading;
  socialLoading=(async()=>{try{const data=await api('social');applySocial(data.social);socialLoaded=true;return socialData}catch(e){app?.toast?.(e.message);throw e}finally{socialLoading=null}})();
  return socialLoading;
}

function renderRequests(){
  const box=$('#requestList');if(!box)return;if(!isSignedIn()){box.innerHTML='<small>登入後顯示好友邀請。</small>';return}
  const uid=profile.id,rels=socialData.relationships||[],incoming=rels.filter(r=>r.status==='pending'&&r.addressee_id===uid),outgoing=rels.filter(r=>r.status==='pending'&&r.requester_id===uid);let html='';
  incoming.forEach(r=>{const p=profileFor(r.requester_id);html+=`<div class="request-card">${avatarHTML(p)}<div><b>${esc(p.display_name)}</b><small>@${esc(p.username)} · 想加你好友</small></div><div><button class="mini-btn" data-accept="${r.id}">接受</button><button class="mini-btn secondary" data-decline="${r.id}" style="margin-left:3px">略過</button></div></div>`});
  outgoing.forEach(r=>{const p=profileFor(r.addressee_id);html+=`<div class="request-card">${avatarHTML(p)}<div><b>${esc(p.display_name)}</b><small>@${esc(p.username)} · 等待接受</small></div><button class="mini-btn secondary" data-cancel="${r.id}">取消</button></div>`});
  box.innerHTML=html||'<small style="font-size:9px;color:var(--muted)">目前沒有好友邀請。</small>';
  box.querySelectorAll('[data-accept]').forEach(b=>b.onclick=()=>respondRequest('accept_request',+b.dataset.accept));box.querySelectorAll('[data-decline]').forEach(b=>b.onclick=()=>respondRequest('decline_request',+b.dataset.decline));box.querySelectorAll('[data-cancel]').forEach(b=>b.onclick=()=>cancelOutgoing(+b.dataset.cancel));
}
async function respondRequest(action,id){try{const data=await api(action,{friendship_id:id});applySocial(data.social);socialLoaded=true;app?.toast?.(action==='accept_request'?'已成為好友':'已略過邀請')}catch(e){app?.toast?.(e.message)}}
async function cancelOutgoing(id){const r=(socialData.relationships||[]).find(x=>x.id===id);if(!r)return;try{const data=await api('remove_friend',{user_id:r.addressee_id});applySocial(data.social);socialLoaded=true;app?.toast?.('邀請已取消')}catch(e){app?.toast?.(e.message)}}
async function sendRequest(id){try{const data=await api('send_request',{user_id:id});applySocial(data.social);socialLoaded=true;app?.toast?.('好友邀請已送出');await searchPeople($('#cloudFriendSearch')?.value||'')}catch(e){app?.toast?.(e.message)}}
async function removeFriend(id){try{const data=await api('remove_friend',{user_id:id});applySocial(data.social);socialLoaded=true;app?.setSelectedFriend?.(null);app?.toast?.('好友已移除')}catch(e){app?.toast?.(e.message)}}
async function searchPeople(raw){
  const box=$('#cloudSearchResults');if(!box)return;if(!isSignedIn()){box.innerHTML='<small>登入後才能搜尋使用者。</small>';return}const q=String(raw||'').trim().replace(/^@/,'');if(q.length<2){box.innerHTML=q?'<small>至少輸入 2 個字。</small>':'';return}
  try{const data=await api('search_people',{query:q});const people=data.people||[];box.innerHTML=people.length?people.map(p=>{const r=relationFor(p.id);let ctl=r?.status==='accepted'?'<span class="mini-btn secondary">已是好友</span>':r?.status==='pending'?'<span class="mini-btn secondary">邀請中</span>':`<button class="mini-btn" data-add-person="${p.id}">＋ 好友</button>`;return `<div class="person-result">${avatarHTML(p)}<div><b>${esc(p.display_name)}</b><small>@${esc(p.username)}${p.bio?` · ${esc(p.bio.slice(0,28))}`:''}</small></div>${ctl}</div>`}).join(''):'<small>找不到符合的使用者。</small>';box.querySelectorAll('[data-add-person]').forEach(b=>b.onclick=()=>sendRequest(b.dataset.addPerson))}catch(e){box.innerHTML=`<small>${esc(e.message)}</small>`}
}
async function createMeetup(user_id,kind,day,start_period,end_period,note=''){try{const data=await api('create_meetup',{user_id,kind,day,start_period,end_period,note});applySocial(data.social);socialLoaded=true;app?.toast?.(kind==='meal'?'吃飯邀約已送出 🍜':'讀書邀約已送出 📚');return true}catch(e){app?.toast?.(e.message);return false}}
async function respondMeetup(meetup_id,decision){try{const data=await api('respond_meetup',{meetup_id,decision});applySocial(data.social);socialLoaded=true;app?.toast?.(decision==='accepted'?'已接受邀約 ✦':'已婉拒邀約');return true}catch(e){app?.toast?.(e.message);return false}}
async function cancelMeetup(meetup_id){try{const data=await api('cancel_meetup',{meetup_id});applySocial(data.social);socialLoaded=true;app?.toast?.('邀約已取消');return true}catch(e){app?.toast?.(e.message);return false}}

$$('[data-auth-tab]').forEach(b=>b.onclick=()=>switchTab(b.dataset.authTab));
$('#guestMode')?.addEventListener('click',()=>{clearSession(false);purgeAccountCache();localStorage.setItem('puplan_guest','1');hideGate();app?.toast?.('目前使用訪客模式')});
$('#registerForm')?.addEventListener('submit',async e=>{e.preventDefault();const display_name=$('#regName').value.trim(),username=normalizeUsername($('#regUsername').value),email=$('#regEmail').value.trim(),password=$('#regPassword').value;if(!/^[a-z0-9_.]{2,24}$/.test(username))return setAuthStatus('@帳號需 2–24 字，只能英文、數字、底線、句點',true);if(password.length<8)return setAuthStatus('密碼至少 8 個字元',true);setAuthStatus('建立帳號中…');try{await signup(display_name,username,email,password);setAuthStatus('註冊完成');app?.toast?.('帳號建立完成')}catch(err){setAuthStatus(err.message,true)}});
$('#loginForm')?.addEventListener('submit',async e=>{e.preventDefault();setAuthStatus('登入中…');try{await login($('#loginEmail').value.trim(),$('#loginPassword').value);setAuthStatus('');app?.toast?.('登入成功')}catch(err){setAuthStatus(err.message,true)}});
$('#cloudFriendSearch')?.addEventListener('input',e=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>searchPeople(e.target.value),260)});
document.addEventListener('puplan:courses-changed',e=>queueSchedule(e.detail||[]));
$$('[data-view="friends"]').forEach(b=>b.addEventListener('click',()=>{if(isSignedIn()&&!socialLoaded)loadSocial().catch(()=>{})}));

window.PUPLAN_CLOUD={isSignedIn,showGate,logout,updateProfile,removeFriend,searchPeople,loadSocial,syncSchedule:()=>saveSchedule(app?.courses?.()||[]),getProfile:()=>profile,getSocial:()=>socialData,getSocialSummary:()=>socialSummary,createMeetup,respondMeetup,cancelMeetup,avatarHTML};

updateAccountUI();
if(token){const ok=await bootstrap();if(!ok&&!localStorage.getItem('puplan_guest'))showGate('login')}else if(localStorage.getItem('puplan_guest')==='1')hideGate();else showGate('register');
