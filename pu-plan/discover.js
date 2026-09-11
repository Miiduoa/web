const SOCIAL=window.CAMPUS_SOCIAL_ENDPOINT||'https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-social';
const CORE='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-api';
const token=()=>localStorage.getItem('puplan_session_primary_v1')||localStorage.getItem('puplan_session')||'';
const esc=s=>window.PUPLAN_APP?.esc?.(String(s??''))||String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const profileCache=new Map();

async function call(url,action,payload={}){
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token()}`},body:JSON.stringify({action,...payload})});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.message||'目前無法完成這個操作');
  return d;
}
function usernameFrom(node){const s=node?.querySelector?.('small')?.textContent||'';return (s.match(/@([a-z0-9_.]{2,24})/i)||[])[1]?.toLowerCase()||''}
function avatar(p){return p?.avatar_data?`<img src="${esc(p.avatar_data)}" alt="">`:`<span>${esc((p?.display_name||'?').slice(0,1))}</span>`}
function media(items=[]){if(!items.length)return'';return`<div class="profile-post-media">${items.slice(0,4).map(m=>m.type==='video'?`<video src="${esc(m.url)}" muted playsinline preload="metadata"></video>`:`<img src="${esc(m.url)}" alt="">`).join('')}</div>`}
async function getProfile(username,force=false){if(!force&&profileCache.has(username))return profileCache.get(username);const d=await call(SOCIAL,'profile_view',{username});profileCache.set(username,d);return d}

function ensureProfileDialog(){
  let d=document.querySelector('#memberProfileDialog');
  if(d)return d;
  d=document.createElement('dialog');d.id='memberProfileDialog';d.className='member-profile-dialog';d.innerHTML='<div id="memberProfileBody"></div>';document.body.appendChild(d);
  d.addEventListener('click',e=>{if(e.target===d)d.close()});
  return d;
}
async function openProfile(username){
  username=String(username||'').replace(/^@/,'').toLowerCase();
  if(!username||!token())return;
  const d=ensureProfileDialog(),body=d.querySelector('#memberProfileBody');
  body.innerHTML='<div class="profile-loading">正在開啟個人頁…</div>';d.showModal();
  try{
    const data=await getProfile(username),p=data.profile||{},mine=window.PUPLAN_CLOUD?.getProfile?.()?.id===p.id;
    let action='';
    if(!mine){
      if(data.is_friend)action=`<button class="profile-action" disabled>已是好友</button><button class="profile-action primary" data-profile-message="${esc(p.id)}">傳訊息</button>`;
      else if(data.relationship?.status==='pending')action='<button class="profile-action" disabled>好友邀請已送出</button>';
      else action=`<button class="profile-action primary" data-profile-add="${esc(p.id)}">加好友</button>`;
    }
    const locked=!data.can_view_posts;
    body.innerHTML=`<div class="profile-sheet-head"><button class="profile-close" type="button" aria-label="關閉">×</button></div><section class="profile-hero"><div class="profile-avatar">${avatar(p)}</div><div class="profile-copy"><h2>${esc(p.display_name||'使用者')}</h2><div class="profile-handle">@${esc(p.username||'')}</div>${p.bio?`<p>${esc(p.bio)}</p>`:''}<div class="profile-flags"><span>${p.profile_visibility==='private'?'私人帳號':'公開帳號'}</span>${data.is_friend?'<span>好友</span>':''}</div></div></section><div class="profile-stats"><div><b>${Number(data.post_count||0)}</b><span>貼文</span></div><div><b>${Number(data.friend_count||0)}</b><span>好友</span></div></div>${action?`<div class="profile-actions">${action}</div>`:''}<section class="profile-posts"><h3>貼文</h3>${locked?'<div class="profile-locked"><b>這是私人帳號</b><span>成為好友後才能查看貼文。</span></div>':(data.posts||[]).length?(data.posts||[]).map(x=>`<article class="profile-post"><p>${esc(x.body||'')}</p>${media(x.media||[])}<small>♡ ${Number(x.like_count||0)}　留言 ${Number(x.reply_count||0)}</small></article>`).join(''):'<div class="profile-locked"><span>目前沒有貼文。</span></div>'}</section>`;
    body.querySelector('.profile-close').onclick=()=>d.close();
    body.querySelector('[data-profile-add]')?.addEventListener('click',async e=>{
      const b=e.currentTarget;b.disabled=true;
      try{await call(CORE,'send_request',{user_id:p.id});profileCache.delete(username);await window.PUPLAN_CLOUD?.loadSocial?.();await openProfile(username)}catch(err){b.disabled=false;window.PUPLAN_APP?.toast?.(err.message)}
    });
    body.querySelector('[data-profile-message]')?.addEventListener('click',async e=>{
      const b=e.currentTarget;b.disabled=true;
      try{await window.PUPLAN_COMMUNITY?.openChatWith?.(p.id);d.close()}catch(err){window.PUPLAN_APP?.toast?.(err.message)}finally{b.disabled=false}
    });
  }catch(err){body.innerHTML=`<div class="profile-loading">${esc(err.message)}</div>`}
}

function ensurePreferenceDialog(){
  let d=document.querySelector('#feedPreferenceDialog');if(d)return d;
  d=document.createElement('dialog');d.id='feedPreferenceDialog';d.className='feed-pref-dialog';
  d.innerHTML=`<form method="dialog"><div class="feed-pref-head"><div><b>調整推薦</b><small>只有你看得到這項設定</small></div><button value="cancel" aria-label="關閉">×</button></div><div class="feed-pref-days"><button type="button" data-days="1">1 天</button><button type="button" data-days="3">3 天</button><button type="button" class="on" data-days="7">7 天</button></div><div id="feedPrefActions"></div><div class="feed-pref-custom"><input id="feedPrefTerm" maxlength="24" placeholder="例如：實習、攝影、籃球"><button type="button" data-term-dir="1">多看這個主題</button><button type="button" data-term-dir="-1">少看這個主題</button></div></form>`;
  document.body.appendChild(d);let days=7;
  d.querySelectorAll('[data-days]').forEach(b=>b.onclick=()=>{days=Number(b.dataset.days);d.querySelectorAll('[data-days]').forEach(x=>x.classList.toggle('on',x===b))});
  d._getDays=()=>days;return d;
}
async function savePreference(payload){
  try{await call(SOCIAL,'set_feed_preference',payload);window.PUPLAN_APP?.toast?.('推薦內容已調整');document.querySelector('#feedPreferenceDialog')?.close();window.PUPLAN_COMMUNITY?.reloadFeed?.()}catch(e){window.PUPLAN_APP?.toast?.(e.message)}
}
async function openPreference(username,post){
  const d=ensurePreferenceDialog(),box=d.querySelector('#feedPrefActions');let data;
  try{data=await getProfile(username)}catch{return}
  const p=data.profile,tags=[...new Set((post?.querySelector('.feed-body')?.textContent?.match(/#[\p{L}\p{N}_]{2,24}/gu)||[]).slice(0,3))];
  box.innerHTML=`<button type="button" data-author-dir="1">多看 @${esc(p.username)}</button><button type="button" data-author-dir="-1">少看 @${esc(p.username)}</button>${tags.map(t=>`<div class="feed-topic-row"><span>${esc(t)}</span><button type="button" data-topic="${esc(t.slice(1))}" data-dir="1">多看</button><button type="button" data-topic="${esc(t.slice(1))}" data-dir="-1">少看</button></div>`).join('')}`;
  box.querySelectorAll('[data-author-dir]').forEach(b=>b.onclick=()=>savePreference({author_id:p.id,direction:Number(b.dataset.authorDir),days:d._getDays()}));
  box.querySelectorAll('[data-topic]').forEach(b=>b.onclick=()=>savePreference({term:b.dataset.topic,direction:Number(b.dataset.dir),days:d._getDays()}));
  d.querySelectorAll('[data-term-dir]').forEach(b=>b.onclick=()=>{const term=d.querySelector('#feedPrefTerm').value.trim();if(term)savePreference({term,direction:Number(b.dataset.termDir),days:d._getDays()})});
  d.showModal();
}
function installFeedMode(){
  const host=document.querySelector('#communityBody .feed-layout > div');if(!host||host.querySelector('.feed-mode-bar'))return;
  const bar=document.createElement('div');bar.className='feed-mode-bar';bar.innerHTML='<button data-feed-mode="for_you">推薦</button><button data-feed-mode="latest">最新</button>';host.prepend(bar);
  const mode=localStorage.getItem('nolu_feed_mode')||'for_you';
  bar.querySelectorAll('[data-feed-mode]').forEach(b=>{b.classList.toggle('on',b.dataset.feedMode===mode);b.onclick=()=>{localStorage.setItem('nolu_feed_mode',b.dataset.feedMode);window.PUPLAN_COMMUNITY?.reloadFeed?.()}});
}
function enhance(){
  installFeedMode();
  document.querySelectorAll('.person-result').forEach(card=>{
    if(card.dataset.profileReady)return;card.dataset.profileReady='1';card.classList.add('profile-clickable');const u=usernameFrom(card);
    if(u){card.title='查看個人頁';card.addEventListener('click',e=>{if(e.target.closest('button,input,a'))return;openProfile(u)})}
  });
  document.querySelectorAll('.feed-card').forEach(card=>{
    const author=card.querySelector('.feed-author');if(!author)return;const u=usernameFrom(author);
    if(u&&!author.dataset.profileReady){author.dataset.profileReady='1';author.classList.add('profile-clickable');author.addEventListener('click',e=>{if(e.target.closest('button'))return;openProfile(u)})}
    if(u&&!card.querySelector('.feed-tune')&&u!==window.PUPLAN_CLOUD?.getProfile?.()?.username){const b=document.createElement('button');b.type='button';b.className='feed-tune';b.textContent='•••';b.setAttribute('aria-label','調整推薦');b.onclick=e=>{e.stopPropagation();openPreference(u,card)};author.appendChild(b)}
  });
}
new MutationObserver(enhance).observe(document.body,{childList:true,subtree:true});
document.addEventListener('click',e=>{const t=e.target.closest?.('[data-profile-username]');if(t)openProfile(t.dataset.profileUsername)});
setTimeout(enhance,0);
window.CAMPUS_DISCOVERY={openProfile,openMemberProfile:openProfile};
