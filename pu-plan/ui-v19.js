const q=s=>document.querySelector(s),qa=s=>[...document.querySelectorAll(s)];
const text=(sel,value)=>{const el=q(sel);if(el&&el.textContent!==value)el.textContent=value};
function labelNav(){
  const names=new Map([['schedule','課表'],['friends','找人'],['ai','安排'],['settings','我的']]);
  qa('.nav [data-view]').forEach(b=>{const v=b.dataset.view;if(names.has(v))b.textContent=names.get(v)});
  qa('.bottom [data-view]').forEach(b=>{const v=b.dataset.view;if(names.has(v))b.innerHTML=names.get(v)});
  qa('[data-community-open]').forEach(b=>{if(b.closest('.bottom'))b.innerHTML='動態<span class="nav-unread mobile-badge hidden" id="bottomChatBadge"></span>';else b.innerHTML='動態 <span class="nav-unread hidden" id="navChatBadge"></span>'});
  qa('[data-admin-open]').forEach(b=>{b.textContent=b.closest('.bottom')?'管理':'網站管理'});
}
function authCopy(){
  const poster=q('.auth-poster');if(poster){const h=poster.querySelector('h2'),p=poster.querySelector('p');if(h)h.innerHTML='課表對上了，<br>就約。';if(p)p.textContent='看課表、找朋友、發動態、聊天，都放在同一個地方。'}
  const reg=q('#registerForm h3');if(reg)reg.textContent='先留一個大家認得出的名字';
  const login=q('#loginForm h3');if(login)login.textContent='回來了就繼續';
  const guest=q('#guestMode');if(guest)guest.textContent='先逛逛，不登入';
  const submitReg=q('#registerForm .auth-submit');if(submitReg)submitReg.textContent='建立帳號';
  const submitLogin=q('#loginForm .auth-submit');if(submitLogin)submitLogin.textContent='登入';
}
function sectionCopy(){
  const friends=q('#friends .section-head');if(friends){const h=friends.querySelector('h2'),p=friends.querySelector('p');if(h)h.textContent='找人';if(p)p.textContent='搜名字或 @帳號，點一下就能看個人頁。成為好友後才能互看私人內容和課表。'}
  const community=q('#community .section-head');if(community){const h=community.querySelector('h2'),p=community.querySelector('p');if(h)h.textContent='動態';if(p)p.textContent='看看朋友最近在幹嘛，也可以直接發一則。'}
  const planner=q('#ai .section-head');if(planner){const h=planner.querySelector('h2'),p=planner.querySelector('p');if(h)h.textContent='幫我安排';if(p)p.textContent='問今天去哪上課、找空堂，或把讀書和作業排進這週。'}
  const aiHead=q('#ai .ai-head b');if(aiHead)aiHead.textContent='安排';
  const launch=q('#aiLaunch');if(launch){launch.textContent=launch.textContent.includes('關閉')?'回到一般安排':'進階安排'}
  const quickTitle=q('#ai .ai-side .panel:nth-child(2) h3');if(quickTitle)quickTitle.textContent='快速問';
  text('#title',q('.view.on')?.id==='ai'?'幫我安排':q('#title')?.textContent||'');
}
function feedModes(){qa('.feed-mode-bar [data-feed-mode]').forEach(b=>{if(b.dataset.feedMode==='for_you')b.textContent='推薦';if(b.dataset.feedMode==='latest')b.textContent='最新';b.onclick=()=>{localStorage.setItem('hang_feed_mode',b.dataset.feedMode);localStorage.setItem('campus_feed_mode',b.dataset.feedMode);qa('.feed-mode-bar [data-feed-mode]').forEach(x=>x.classList.toggle('on',x===b));q('[data-community-tab="feed"]')?.click()}})}
function postVisibility(){const select=q('#postVisibility');if(!select||select.dataset.hangPills)return;select.dataset.hangPills='1';select.style.display='none';const pills=document.createElement('div');pills.className='visibility-pills';pills.innerHTML='<button type="button" data-v="public">大家</button><button type="button" data-v="private">好友</button>';select.parentElement?.after(pills);const sync=()=>pills.querySelectorAll('[data-v]').forEach(b=>b.classList.toggle('on',b.dataset.v===select.value));pills.querySelectorAll('[data-v]').forEach(b=>b.onclick=()=>{select.value=b.dataset.v;select.dispatchEvent(new Event('change',{bubbles:true}));sync()});sync();document.addEventListener('hang:privacy-changed',e=>{const privateAccount=e.detail?.profile_visibility==='private',pub=pills.querySelector('[data-v="public"]');if(pub)pub.textContent=privateAccount?'一般':'大家'})}
function profileEditor(){const card=q('.profile-settings');if(!card||card.dataset.hangEditor)return;card.dataset.hangEditor='1';card.classList.add('hang-profile-collapsed');const toggle=document.createElement('button');toggle.type='button';toggle.className='btn hang-profile-edit-toggle';toggle.textContent='編輯個人頁';const head=card.querySelector('.profile-editor-head');head?.after(toggle);toggle.onclick=()=>{const open=card.classList.toggle('hang-profile-collapsed');toggle.textContent=open?'編輯個人頁':'收起編輯'};q('#saveName')?.addEventListener('click',()=>setTimeout(()=>{card.classList.add('hang-profile-collapsed');toggle.textContent='編輯個人頁'},150))}
function settingsHeader(){const grid=q('#settings .settings');if(!grid||q('.hang-settings-header'))return;const h=document.createElement('div');h.className='hang-settings-header';h.innerHTML='<h2>我的</h2><p>個人頁、隱私、通知和課表分享都在這裡。</p>';grid.before(h)}
function simplifySettings(){settingsHeader();profileEditor();const share=q('#settings .setting-card:not(.profile-settings)');if(share){const h=share.querySelector('h2');if(h)h.textContent='分享課表'}const dev=q('#deviceCard h3');if(dev)dev.textContent='手機與提醒';const chat=q('#chatNotificationCard h3');if(chat)chat.textContent='聊天通知';qa('#settings .setting-card p').forEach(p=>{p.innerHTML=p.innerHTML.replace(/PWA/gi,'主畫面版本').replace(/瀏覽器通知/g,'通知')})}
function replaceVisibleTechWords(){const skip='.feed-body,.reply-copy p,.message-body,.chat-message,.bubble.me,input,textarea,option,code,pre';const map=[[/PU\/PLAN/g,'hang.'],[/PU PLAN/g,'hang.'],[/\bAI\b/g,'安排'],[/Local AI/gi,'進階安排'],[/WebGPU/gi,'裝置支援'],[/API Key/gi,'額外金鑰'],[/BETA/gi,''],[/QUICK MODE/gi,'一般模式'],[/READY\.?/g,'好了']];const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);const nodes=[];let n;while(n=walker.nextNode())nodes.push(n);for(const node of nodes){const p=node.parentElement;if(!p||p.closest(skip)||['SCRIPT','STYLE'].includes(p.tagName))continue;let v=node.nodeValue||'';for(const [re,to] of map)v=v.replace(re,to);if(v!==node.nodeValue)node.nodeValue=v}}
function enhance(){labelNav();authCopy();sectionCopy();feedModes();postVisibility();simplifySettings();replaceVisibleTechWords();const search=q('#cloudFriendSearch');if(search)search.placeholder='搜尋名字或 @帳號';const add=q('#addFriend');if(add)add.textContent='找人';const imp=q('#importSchedule');if(imp)imp.textContent='匯入';const addCourse=q('#add');if(addCourse)addCourse.textContent='新增';const share=q('#shareTop');if(share)share.textContent='分享'}
enhance();let scheduled=false;new MutationObserver(()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;enhance()})}).observe(document.body,{childList:true,subtree:true});
document.addEventListener('puplan:profile-changed',()=>setTimeout(enhance,20));
window.HANG_UI={refresh:enhance};
