const PRIVACY_API=window.CAMPUS_SOCIAL_ENDPOINT||'https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-social';
const privacyToken=()=>localStorage.getItem('puplan_session')||'';
let privacyState='public',privacyBusy=false;

async function privacyCall(action,payload={}){
  const t=privacyToken();
  if(!t)throw new Error('請先登入');
  const r=await fetch(PRIVACY_API,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${t}`},body:JSON.stringify({action,...payload})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.message||'目前無法更新隱私設定');
  return d;
}

function privacyCopy(v){
  return v==='private'
    ?['私人帳號','只有你與已接受的好友能看到你的貼文。']
    :['公開帳號','登入的使用者可以看到你的公開貼文；只限好友的貼文仍不會公開。'];
}

function renderPrivacy(){
  const card=document.querySelector('#privacyCard');
  if(!card)return;
  const [title,desc]=privacyCopy(privacyState);
  const titleEl=card.querySelector('[data-privacy-title]'),descEl=card.querySelector('[data-privacy-desc]');
  if(titleEl)titleEl.textContent=title;
  if(descEl)descEl.textContent=desc;
  card.querySelectorAll('[data-privacy-value]').forEach(b=>{
    const active=b.dataset.privacyValue===privacyState;
    b.classList.toggle('on',active);
    b.setAttribute('aria-pressed',active?'true':'false');
    b.disabled=privacyBusy||!privacyToken();
  });
  const composer=document.querySelector('#postVisibility');
  if(composer){
    const pub=composer.querySelector('option[value="public"]');
    const priv=composer.querySelector('option[value="private"]');
    if(pub)pub.textContent=privacyState==='private'?'一般貼文（好友可見）':'公開貼文';
    if(priv)priv.textContent='只限好友';
  }
}

async function refreshPrivacy(){
  if(!privacyToken()){privacyState='public';renderPrivacy();return}
  try{
    const d=await privacyCall('privacy_get');
    privacyState=d.profile_visibility==='private'?'private':'public';
  }catch{}
  renderPrivacy();
}

async function setPrivacy(v){
  if(privacyBusy||!['public','private'].includes(v)||v===privacyState)return;
  const before=privacyState;
  privacyState=v;privacyBusy=true;renderPrivacy();
  try{
    const d=await privacyCall('privacy_set',{profile_visibility:v});
    privacyState=d.profile_visibility==='private'?'private':'public';
    window.PUPLAN_APP?.toast?.(privacyState==='private'?'已切換成私人帳號':'已切換成公開帳號');
    document.dispatchEvent(new CustomEvent('nolu:privacy-changed',{detail:{profile_visibility:privacyState}}));
  }catch(e){
    privacyState=before;
    window.PUPLAN_APP?.toast?.(e.message);
  }finally{
    privacyBusy=false;renderPrivacy();
  }
}

function installPrivacy(){
  const grid=document.querySelector('#settings .settings');
  if(!grid||document.querySelector('#privacyCard'))return;
  const card=document.createElement('article');
  card.id='privacyCard';card.className='setting-card privacy-card';
  card.innerHTML=`<div class="privacy-copy"><span class="settings-icon" aria-hidden="true">◎</span><div><h3 data-privacy-title>帳號隱私</h3><p data-privacy-desc></p></div></div><div class="privacy-choice" role="group" aria-label="帳號隱私"><button type="button" data-privacy-value="public">公開</button><button type="button" data-privacy-value="private">私人</button></div>`;
  const profile=grid.querySelector('.profile-settings');
  if(profile?.nextSibling)grid.insertBefore(card,profile.nextSibling);else grid.append(card);
  card.querySelectorAll('[data-privacy-value]').forEach(b=>b.addEventListener('click',()=>setPrivacy(b.dataset.privacyValue)));
  renderPrivacy();refreshPrivacy();
}

installPrivacy();
new MutationObserver(()=>{installPrivacy();renderPrivacy()}).observe(document.body,{childList:true,subtree:true});
document.addEventListener('puplan:profile-changed',()=>setTimeout(refreshPrivacy,20));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshPrivacy()});
window.NOLU_PRIVACY={refresh:refreshPrivacy,set:setPrivacy,get:()=>privacyState};
