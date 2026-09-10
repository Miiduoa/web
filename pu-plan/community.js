import {cleanAvatar} from './core/state.js';
const SOCIAL_API=window.CAMPUS_SOCIAL_ENDPOINT||'https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-social';
const SUPABASE_URL='https://hrrmkrayvrgnwcroyttp.supabase.co';
const SUPABASE_KEY='sb_publishable_jXaj3aY5lPDvLEUBOzAuCQ_eKoAHTKN';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const app=window.PUPLAN_APP;
const esc=s=>app?.esc?.(String(s??''))||String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const token=()=>localStorage.getItem('puplan_session')||'';
const signedIn=()=>!!token()&&window.PUPLAN_CLOUD?.isSignedIn?.();
const profile=()=>window.PUPLAN_CLOUD?.getProfile?.()||{id:'',display_name:'我',username:''};
let currentTab='feed',currentConversation='',inboxData=[],feedData=[],feedCursor=null,selectedMedia=[],pollTimer=null,globalPoll=null,storageClient=null;

async function request(action,payload={}){
  if(!signedIn())throw new Error('請先登入');
  const res=await fetch(SOCIAL_API,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token()}`},body:JSON.stringify({action,...payload})});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data.message||'目前無法完成這個操作');
  return data;
}
function avatar(p,cls='avatar'){
  const src=cleanAvatar(p?.avatar_data||'');
  return src?`<div class="${cls}"><img src="${esc(src)}" alt=""></div>`:`<div class="${cls}">${esc((p?.display_name||'?').slice(0,1))}</div>`;
}
function timeAgo(v){
  const d=new Date(v),m=Math.floor((Date.now()-d.getTime())/60000);
  if(m<1)return'剛剛';if(m<60)return`${m} 分鐘前`;
  const h=Math.floor(m/60);if(h<24)return`${h} 小時前`;
  const days=Math.floor(h/24);if(days<7)return`${days} 天前`;
  return d.toLocaleDateString('zh-TW',{month:'numeric',day:'numeric'});
}
function editedLabel(x){return x?.updated_at&&x?.created_at&&new Date(x.updated_at)-new Date(x.created_at)>1500?' · 已編輯':''}

function installSection(){
  if($('#community'))return;
  const section=document.createElement('section');
  section.id='community';section.className='view';
  section.innerHTML=`<div class="section-head"><div><h2>動態</h2><p>看看朋友最近在幹嘛，也可以直接發一則。</p></div></div><div class="community-shell"><div class="community-tabs"><button class="on" data-community-tab="feed">動態</button><button data-community-tab="chat">聊天 <span id="chatUnreadBadge" class="tab-unread hidden"></span></button></div><div id="communityBody"></div></div>`;
  document.querySelector('.main')?.append(section);
  const nav=$('.nav');
  if(nav&&!nav.querySelector('[data-community-open]')){
    const b=document.createElement('button');b.dataset.communityOpen='1';b.innerHTML='動態 <span class="nav-unread hidden" id="navChatBadge"></span>';
    nav.insertBefore(b,nav.querySelector('[data-view="ai"]'));b.onclick=showCommunity;
  }
  const bottom=$('.bottom');
  if(bottom&&!bottom.querySelector('[data-community-open]')){
    const b=document.createElement('button');b.dataset.communityOpen='1';b.innerHTML='動態<span class="nav-unread mobile-badge hidden" id="bottomChatBadge"></span>';
    bottom.insertBefore(b,bottom.querySelector('[data-view="ai"]'));b.onclick=showCommunity;
  }
  section.querySelectorAll('[data-community-tab]').forEach(b=>b.onclick=()=>switchTab(b.dataset.communityTab));
  installNotificationSetting();
}
function installNotificationSetting(){
  const grid=$('#settings .settings');if(!grid||$('#chatNotificationCard'))return;
  const card=document.createElement('article');card.id='chatNotificationCard';card.className='setting-card';
  card.innerHTML=`<h3>聊天通知</h3><p>有新私訊或群聊時顯示未讀數；允許通知後，也能顯示系統提醒。</p><label class="reminder-toggle"><input type="checkbox" id="chatNotifyToggle"><span><b>開啟聊天通知</b><small>iPhone 建議先把 nolu 加到主畫面。</small></span></label>`;
  grid.append(card);
  const t=$('#chatNotifyToggle');t.checked=localStorage.getItem('puplan_chat_notifications')==='1';
  t.onchange=async()=>{
    if(t.checked){
      if(!('Notification'in window)){t.checked=false;return app?.toast?.('這個瀏覽器不支援通知')}
      const p=await Notification.requestPermission();if(p!=='granted'){t.checked=false;return app?.toast?.('沒有取得通知權限')}
    }
    localStorage.setItem('puplan_chat_notifications',t.checked?'1':'0');app?.toast?.(t.checked?'聊天通知已開啟':'聊天通知已關閉');
  };
}
function showCommunity(){
  document.querySelectorAll('.view').forEach(x=>x.classList.toggle('on',x.id==='community'));
  document.querySelectorAll('[data-view]').forEach(x=>x.classList.remove('on'));
  document.querySelectorAll('[data-community-open]').forEach(x=>x.classList.add('on'));
  if($('#title'))$('#title').textContent='動態';if($('#add'))$('#add').style.visibility='hidden';
  switchTab(currentTab);startPolling();
}
function switchTab(tab){
  currentTab=tab;$$('[data-community-tab]').forEach(x=>x.classList.toggle('on',x.dataset.communityTab===tab));
  tab==='feed'?renderFeedShell():renderChatShell();
}

function renderFeedShell(){
  const root=$('#communityBody');if(!root)return;
  if(!signedIn()){root.innerHTML='<div class="panel empty">登入後才能看動態。</div>';return}
  selectedMedia.forEach(m=>m.url&&URL.revokeObjectURL(m.url));selectedMedia=[];feedCursor=null;
  root.innerHTML=`<div class="feed-layout"><div><section class="composer-card"><div class="composer-row">${avatar(profile())}<div class="composer-main"><textarea id="postInput" maxlength="600" placeholder="分享現在想說的事…"></textarea><div id="postMediaPreview" class="post-media-preview hidden"></div></div></div><div class="composer-actions"><label class="media-pick"><input id="postMediaInput" type="file" accept="image/*,video/*" multiple hidden><span>相片 / 影片</span></label><label class="post-privacy"><select id="postVisibility"><option value="public">大家都看得到</option><option value="private">只給好友</option></select></label><button class="btn primary" id="publishPost">發佈</button></div><div class="upload-status hidden" id="postUploadStatus"></div></section><div class="feed-list" id="feedList"><div class="panel">載入中…</div></div><button class="btn hidden" id="loadMoreFeed" type="button" style="margin:14px auto 0">看更多</button></div></div>`;
  $('#publishPost').onclick=publishPost;$('#postMediaInput').onchange=e=>pickMedia([...e.target.files||[]]);$('#loadMoreFeed').onclick=()=>loadFeed(false);
  loadFeed(true);
}
function mediaKind(file){if(file.type.startsWith('image/'))return'image';if(file.type.startsWith('video/'))return'video';return''}
async function mediaMeta(file){
  const type=mediaKind(file);
  if(type==='image')return await new Promise(resolve=>{const img=new Image(),u=URL.createObjectURL(file);img.onload=()=>{const x={width:img.naturalWidth||0,height:img.naturalHeight||0,duration_ms:null};URL.revokeObjectURL(u);resolve(x)};img.onerror=()=>{URL.revokeObjectURL(u);resolve({width:null,height:null,duration_ms:null})};img.src=u});
  return await new Promise(resolve=>{const v=document.createElement('video'),u=URL.createObjectURL(file);v.preload='metadata';v.onloadedmetadata=()=>{const x={width:v.videoWidth||0,height:v.videoHeight||0,duration_ms:Number.isFinite(v.duration)?Math.round(v.duration*1000):null};URL.revokeObjectURL(u);resolve(x)};v.onerror=()=>{URL.revokeObjectURL(u);resolve({width:null,height:null,duration_ms:null})};v.src=u});
}
async function pickMedia(files){
  const allowed=[];let total=selectedMedia.reduce((n,m)=>n+m.file.size,0);
  for(const f of files){
    if(selectedMedia.length+allowed.length>=6)break;const kind=mediaKind(f);if(!kind)continue;
    const max=kind==='image'?12*1024*1024:80*1024*1024;
    if(f.size>max){app?.toast?.(kind==='image'?'單張圖片上限 12 MB':'單支影片上限 80 MB');continue}
    if(total+f.size>100*1024*1024){app?.toast?.('這篇貼文的照片和影片合計最多 100 MB');break}
    total+=f.size;allowed.push({file:f,type:kind,url:URL.createObjectURL(f),meta:await mediaMeta(f)});
  }
  selectedMedia.push(...allowed);renderSelectedMedia();
}
function renderSelectedMedia(){
  const box=$('#postMediaPreview');if(!box)return;box.classList.toggle('hidden',!selectedMedia.length);
  box.innerHTML=selectedMedia.map((m,i)=>`<div class="post-media-draft">${m.type==='image'?`<img src="${m.url}" alt="">`:`<video src="${m.url}" muted playsinline preload="metadata"></video>`}<button type="button" data-remove-media="${i}" aria-label="移除">×</button></div>`).join('');
  box.querySelectorAll('[data-remove-media]').forEach(b=>b.onclick=()=>{const i=Number(b.dataset.removeMedia);URL.revokeObjectURL(selectedMedia[i].url);selectedMedia.splice(i,1);renderSelectedMedia()});
}
async function storage(){
  if(storageClient)return storageClient;
  const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  storageClient=createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});return storageClient;
}
function uploadState(text){const b=$('#postUploadStatus');if(!b)return;b.classList.remove('hidden');b.textContent=text}
async function uploadSelected(){
  if(!selectedMedia.length)return[];
  const prep=await request('prepare_media',{items:selectedMedia.map(m=>({mime:m.file.type,size:m.file.size}))});
  const client=await storage(),out=[];
  for(let i=0;i<selectedMedia.length;i++){
    const m=selectedMedia[i],u=prep.uploads[i];uploadState(`正在上傳 ${i+1}/${selectedMedia.length}`);
    const {error}=await client.storage.from(u.bucket).uploadToSignedUrl(u.path,u.token,m.file,{contentType:m.file.type,cacheControl:'3600'});
    if(error)throw new Error(`媒體上傳失敗：${error.message}`);
    out.push({path:u.path,mime:m.file.type,size:m.file.size,width:m.meta.width,height:m.meta.height,duration_ms:m.meta.duration_ms});
  }
  return out;
}
async function loadFeed(reset=true){
  try{
    const mode=localStorage.getItem('nolu_feed_mode')==='latest'?'latest':'for_you';
    const data=await request('feed',{mode,limit:20,...(!reset&&feedCursor?{cursor:feedCursor}:{})});
    feedData=reset?(data.posts||[]):[...feedData,...(data.posts||[])];feedCursor=data.next_cursor||null;renderFeed();
    $('#loadMoreFeed')?.classList.toggle('hidden',!feedCursor);
  }catch(e){if($('#feedList'))$('#feedList').innerHTML=`<div class="panel">${esc(e.message)}</div>`}
}
function renderMedia(items=[]){
  if(!items.length)return'';
  return`<div class="feed-media ${items.length===1?'single':''}" data-count="${items.length}">${items.map((m,i)=>m.type==='image'?`<button class="feed-media-item" data-lightbox="${esc(m.url)}" aria-label="查看圖片"><img src="${esc(m.url)}" loading="lazy" alt="貼文圖片 ${i+1}"></button>`:`<div class="feed-media-item"><video src="${esc(m.url)}" controls playsinline preload="metadata"></video></div>`).join('')}</div>`;
}
function renderFeed(){
  const list=$('#feedList');if(!list)return;const me=profile();
  list.innerHTML=feedData.length?feedData.map(p=>`<article class="feed-card" data-post="${p.id}"><div class="feed-author">${avatar(p.author)}<div><b>${esc(p.author?.display_name||'使用者')}</b><small>@${esc(p.author?.username||'')} · ${timeAgo(p.created_at)}${editedLabel(p)}</small></div><span class="visibility-badge ${p.visibility==='private'?'private':''}">${p.visibility==='private'?'好友':'公開'}</span>${p.author_id===me.id?`<div class="post-owner-actions"><button data-edit-post="${p.id}">編輯</button><button data-delete-post="${p.id}">刪除</button></div>`:''}</div>${p.body?`<div class="feed-body">${esc(p.body)}</div>`:''}${renderMedia(p.media||[])}<div class="feed-actions"><button data-like-post="${p.id}">${p.liked?'♥':'♡'} ${Number(p.like_count||0)}</button><button data-reply-toggle="${p.id}">留言 ${Number(p.reply_count||0)}</button></div>${p.replies?.length?`<div class="reply-list">${p.replies.map(r=>`<div class="reply-item" data-reply="${r.id}">${avatar(r.author,'reply-avatar')}<div class="reply-copy"><div><b>${esc(r.author?.display_name||'使用者')}</b><small>${timeAgo(r.created_at)}${editedLabel(r)}</small></div><p>${esc(r.body)}</p>${(r.can_edit||r.author_id===me.id)?`<div class="reply-owner-actions"><button type="button" data-edit-reply="${r.id}">編輯</button><button type="button" data-delete-reply="${r.id}">刪除</button></div>`:''}</div></div>`).join('')}</div>`:''}<div class="reply-composer hidden" data-reply-box="${p.id}"><input maxlength="600" placeholder="寫個留言"><button class="btn" data-send-reply="${p.id}">送出</button></div></article>`).join(''):'<div class="panel empty">目前還沒有貼文。</div>';
  list.querySelectorAll('[data-like-post]').forEach(b=>b.onclick=()=>toggleLike(b.dataset.likePost));
  list.querySelectorAll('[data-reply-toggle]').forEach(b=>b.onclick=()=>list.querySelector(`[data-reply-box="${b.dataset.replyToggle}"]`)?.classList.toggle('hidden'));
  list.querySelectorAll('[data-send-reply]').forEach(b=>b.onclick=()=>sendReply(b.dataset.sendReply));
  list.querySelectorAll('[data-delete-post]').forEach(b=>b.onclick=()=>deletePost(b.dataset.deletePost));
  list.querySelectorAll('[data-edit-post]').forEach(b=>b.onclick=()=>editPost(b.dataset.editPost));
  list.querySelectorAll('[data-edit-reply]').forEach(b=>b.onclick=()=>startReplyEditor(b));
  list.querySelectorAll('[data-delete-reply]').forEach(b=>b.onclick=()=>deleteReply(b.dataset.deleteReply));
  list.querySelectorAll('[data-lightbox]').forEach(b=>b.onclick=()=>lightbox(b.dataset.lightbox));
}
function lightbox(url){
  let d=$('#mediaLightbox');if(!d){d=document.createElement('dialog');d.id='mediaLightbox';d.className='media-lightbox';document.body.append(d)}
  d.innerHTML=`<button class="media-lightbox-close">×</button><img src="${esc(url)}" alt="貼文圖片">`;d.querySelector('button').onclick=()=>d.close();d.onclick=e=>{if(e.target===d)d.close()};d.showModal();
}
async function publishPost(){
  const input=$('#postInput'),body=input?.value.trim()||'',visibility=$('#postVisibility')?.value||'public';
  if(!body&&!selectedMedia.length)return app?.toast?.('輸入文字或加入相片 / 影片');
  try{
    $('#publishPost').disabled=true;const media=await uploadSelected();await request('create_post',{body,media,visibility});
    input.value='';selectedMedia.forEach(m=>URL.revokeObjectURL(m.url));selectedMedia=[];renderSelectedMedia();if($('#postMediaInput'))$('#postMediaInput').value='';$('#postUploadStatus')?.classList.add('hidden');
    await loadFeed(true);app?.toast?.('已發佈');
  }catch(e){app?.toast?.(e.message)}finally{if($('#publishPost'))$('#publishPost').disabled=false}
}
async function editPost(id){
  const p=feedData.find(x=>x.id===id);if(!p)return;const next=prompt('編輯貼文',p.body||'');if(next===null)return;
  try{await request('edit_post',{post_id:id,body:next});await loadFeed(true);app?.toast?.('貼文已更新')}catch(e){app?.toast?.(e.message)}
}
async function deletePost(id){if(!confirm('刪除這篇貼文？'))return;try{await request('delete_post',{post_id:id});await loadFeed(true);app?.toast?.('貼文已刪除')}catch(e){app?.toast?.(e.message)}}
async function toggleLike(id){try{await request('toggle_like',{post_id:id});await loadFeed(true)}catch(e){app?.toast?.(e.message)}}
async function sendReply(id){
  const box=document.querySelector(`[data-reply-box="${id}"]`),input=box?.querySelector('input'),body=input?.value.trim();if(!body)return;
  try{await request('reply_post',{post_id:id,body});await loadFeed(true)}catch(e){app?.toast?.(e.message)}
}
function startReplyEditor(button){
  const id=String(button.dataset.editReply||'');
  const item=button.closest('.reply-item'),copy=item?.querySelector('.reply-copy'),text=copy?.querySelector('p');
  if(!id||!copy||!text||copy.querySelector('.reply-inline-editor'))return;
  const actions=copy.querySelector('.reply-owner-actions'),original=text.textContent||'';
  text.hidden=true;if(actions)actions.hidden=true;
  const editor=document.createElement('div');editor.className='reply-inline-editor';editor.innerHTML='<textarea maxlength="600" aria-label="編輯留言"></textarea><div class="reply-inline-actions"><button type="button" data-cancel>取消</button><button type="button" class="save" data-save>儲存</button></div>';copy.append(editor);
  const ta=editor.querySelector('textarea');ta.value=original;ta.focus();ta.setSelectionRange(ta.value.length,ta.value.length);
  const close=()=>{editor.remove();text.hidden=false;if(actions)actions.hidden=false};
  editor.querySelector('[data-cancel]').onclick=close;
  editor.querySelector('[data-save]').onclick=async()=>{
    const body=ta.value.trim();if(!body)return app?.toast?.('留言不能空白');
    const save=editor.querySelector('[data-save]');save.disabled=true;save.textContent='儲存中…';
    try{
      await request('edit_reply',{reply_id:id,body});
      close();
      await loadFeed(true);
      app?.toast?.('留言已更新');
    }catch(e){save.disabled=false;save.textContent='儲存';app?.toast?.(e.message)}
  };
  ta.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();close()}if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();editor.querySelector('[data-save]').click()}};
}
async function deleteReply(id){if(!confirm('刪除這則留言？'))return;try{await request('delete_reply',{reply_id:id});await loadFeed(true);app?.toast?.('留言已刪除')}catch(e){app?.toast?.(e.message)}}

function renderChatShell(){
  const root=$('#communityBody');if(!root)return;if(!signedIn()){root.innerHTML='<div class="panel empty">登入後才能聊天。</div>';return}
  root.innerHTML=`<div class="chat-layout" id="chatLayout"><section class="inbox-panel"><div class="inbox-head"><b>訊息</b><button class="btn" id="newChat">＋ 新對話</button></div><div class="inbox-list" id="inboxList"><div class="activity-empty">載入中…</div></div></section><section class="chat-panel" id="chatPanel"><div class="chat-empty">選一個對話，或開始新的私訊 / 群聊。</div></section></div>`;
  $('#newChat').onclick=openNewChat;loadInbox();
}
function conversationName(c){if(c.kind==='group')return c.title||'群聊';const me=profile(),other=(c.members||[]).find(m=>m.user_id!==me.id)?.profile;return other?.display_name||'私訊'}
function conversationAvatar(c){if(c.kind==='group')return`<div class="avatar">${esc((c.title||'群').slice(0,1))}</div>`;const me=profile(),other=(c.members||[]).find(m=>m.user_id!==me.id)?.profile;return avatar(other)}
function totalUnread(list=inboxData){return list.reduce((n,c)=>n+Number(c.unread||0),0)}
function updateBadges(n){
  for(const id of ['#chatUnreadBadge','#navChatBadge','#bottomChatBadge']){const b=$(id);if(!b)continue;b.textContent=n>99?'99+':String(n);b.classList.toggle('hidden',!n)}
  if('setAppBadge'in navigator){n?navigator.setAppBadge(n).catch(()=>{}):navigator.clearAppBadge?.().catch(()=>{})}
  document.title=n?`(${n}) nolu`:'nolu — 有空就碰面';
}
async function maybeNotify(next,previous){
  if(localStorage.getItem('puplan_chat_notifications')!=='1'||!('Notification'in window)||Notification.permission!=='granted')return;
  const old=new Map(previous.map(c=>[c.id,c]));
  for(const c of next){
    const before=old.get(c.id),last=c.last_message,isNew=Number(c.unread)>0&&last?.created_at&&last.created_at!==before?.last_message?.created_at&&last.sender_id!==profile().id;if(!isNew)continue;
    const reg=await navigator.serviceWorker?.ready.catch(()=>null),url=`${location.origin}${location.pathname}#chat=${encodeURIComponent(c.id)}`;
    try{if(reg)await reg.showNotification(conversationName(c),{body:last.body||'你有一則新訊息',icon:new URL('./nolu-icon.svg',import.meta.url).href,badge:new URL('./nolu-icon.svg',import.meta.url).href,tag:`chat-${c.id}`,data:{url,conversationId:c.id}});else new Notification(conversationName(c),{body:last.body||'你有一則新訊息',tag:`chat-${c.id}`})}catch{}
  }
}
async function loadInbox(silent=false,notificationCheck=false){
  try{const previous=inboxData.slice(),data=await request('inbox',{limit:30});inboxData=data.conversations||[];updateBadges(totalUnread());if(notificationCheck)await maybeNotify(inboxData,previous);renderInbox();if(currentConversation&&$('#chatPanel'))await openConversation(currentConversation,true)}catch(e){if(!silent&&$('#inboxList'))$('#inboxList').innerHTML=`<div class="activity-empty">${esc(e.message)}</div>`}
}
function renderInbox(){
  const list=$('#inboxList');if(!list)return;
  list.innerHTML=inboxData.length?inboxData.map(c=>`<button class="inbox-item ${c.id===currentConversation?'on':''}" data-open-conversation="${c.id}">${conversationAvatar(c)}<span class="inbox-copy"><b>${esc(conversationName(c))}</b><span>${esc(c.last_message?.body||'還沒有訊息')}</span></span>${c.unread?`<i class="unread">${Math.min(99,Number(c.unread))}</i>`:''}</button>`).join(''):'<div class="activity-empty">還沒有聊天。</div>';
  list.querySelectorAll('[data-open-conversation]').forEach(b=>b.onclick=()=>openConversation(b.dataset.openConversation));
}
async function openConversation(id,silent=false){
  try{
    currentConversation=id;const data=await request('conversation',{conversation_id:id}),panel=$('#chatPanel');if(!panel)return;
    const c=data.conversation,profiles=new Map((data.profiles||[]).map(p=>[p.id,p])),me=profile();
    panel.innerHTML=`<div class="chat-head"><button class="btn" id="chatBack" style="display:none">←</button><b>${esc(c.kind==='group'?(c.title||'群聊'):(data.profiles||[]).find(p=>p.id!==me.id)?.display_name||'私訊')}</b></div><div class="chat-messages" id="chatMessages">${(data.messages||[]).map(m=>{const mine=m.sender_id===me.id,p=profiles.get(m.sender_id);return`<div class="message-row ${mine?'mine':'theirs'}">${mine?'':`<span class="message-name">${esc(p?.display_name||'使用者')}</span>`}<div class="message-bubble">${esc(m.body)}</div><span class="message-time">${new Date(m.created_at).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit'})}${m.edited_at?' · 已編輯':''}</span></div>`}).join('')}</div><div class="chat-compose"><input id="messageInput" maxlength="2000" placeholder="輸入訊息"><button class="btn primary" id="sendMessage">送出</button></div>`;
    $('#sendMessage').onclick=sendMessage;$('#messageInput').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage()}};$('#chatLayout')?.classList.add('has-chat');
    const msg=$('#chatMessages');if(msg)msg.scrollTop=msg.scrollHeight;await request('mark_read',{conversation_id:id});const row=inboxData.find(x=>x.id===id);if(row)row.unread=0;updateBadges(totalUnread());renderInbox();
    const back=$('#chatBack');if(back){back.style.display=innerWidth<=940?'inline-flex':'none';back.onclick=()=>{currentConversation='';$('#chatLayout')?.classList.remove('has-chat')}};
  }catch(e){if(!silent)app?.toast?.(e.message)}
}
async function sendMessage(){
  const input=$('#messageInput'),body=input?.value.trim();if(!body||!currentConversation)return;
  try{$('#sendMessage').disabled=true;await request('send_message',{conversation_id:currentConversation,body});input.value='';await loadInbox(true);await openConversation(currentConversation,true)}catch(e){app?.toast?.(e.message)}finally{if($('#sendMessage'))$('#sendMessage').disabled=false}
}
async function openNewChat(){
  await window.PUPLAN_CLOUD?.loadSocial?.().catch(()=>{});const friends=(window.PUPLAN_CLOUD?.getSocial?.().friends||[]).filter(f=>f.cloud);
  if(!friends.length)return app?.toast?.('先加一位好友，才能開始聊天');
  let d=$('#newChatDialog');if(!d){d=document.createElement('dialog');d.id='newChatDialog';d.className='new-chat-dialog';document.body.append(d)}
  d.innerHTML=`<div class="modal-head"><h2>開始對話</h2><button class="x" type="button">×</button></div><label class="label">群聊名稱（多人時可填）<input class="field" id="groupTitle" maxlength="80" placeholder="例如：期末專案組"></label><div class="friend-picker">${friends.map(f=>`<label class="friend-pick"><input type="checkbox" value="${esc(f.id)}">${f.avatar?`<div class="avatar"><img src="${esc(f.avatar)}" alt=""></div>`:`<div class="avatar">${esc((f.name||'?').slice(0,1))}</div>`}<span>${esc(f.name)}<small>@${esc(f.username||'')}</small></span></label>`).join('')}</div><div class="row" style="justify-content:flex-end"><button class="btn primary" id="createConversation">建立對話</button></div>`;
  d.querySelector('.x').onclick=()=>d.close();$('#createConversation').onclick=async()=>{const ids=[...d.querySelectorAll('input[type=checkbox]:checked')].map(x=>x.value);if(!ids.length)return app?.toast?.('請選至少一位好友');try{const data=await request('create_chat',{user_ids:ids,title:$('#groupTitle').value.trim()});d.close();await loadInbox();await openConversation(data.conversation.id)}catch(e){app?.toast?.(e.message)}};d.showModal();
}
function startPolling(){
  clearInterval(pollTimer);
  pollTimer=setInterval(()=>{
    if(document.hidden)return;
    if($('#community')?.classList.contains('on')&&currentTab==='chat')loadInbox(true,true);
  },12000);
}
function startGlobalPolling(){clearInterval(globalPoll);globalPoll=setInterval(()=>{if(signedIn())loadInbox(true,true)},12000);setTimeout(()=>signedIn()&&loadInbox(true,false),1500)}
async function openHashChat(){const m=location.hash.match(/chat=([^&]+)/);if(!m||!signedIn())return;const id=decodeURIComponent(m[1]);history.replaceState(null,'',location.pathname);showCommunity();switchTab('chat');await loadInbox(true);await openConversation(id)}

installSection();startGlobalPolling();setTimeout(openHashChat,1500);
document.addEventListener('puplan:profile-changed',()=>{installNotificationSetting();if($('#community')?.classList.contains('on'))switchTab(currentTab)});
window.addEventListener('focus',()=>signedIn()&&loadInbox(true,true));
window.PUPLAN_COMMUNITY={show:showCommunity,openChatWith:async userId=>{showCommunity();switchTab('chat');const data=await request('create_chat',{user_ids:[userId]});await loadInbox();await openConversation(data.conversation.id)},refreshInbox:()=>loadInbox(true,true),reloadFeed:()=>loadFeed(true)};
