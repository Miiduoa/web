const q=s=>document.querySelector(s),qa=s=>[...document.querySelectorAll(s)];
const setText=(el,value)=>{if(el&&el.textContent!==value)el.textContent=value};
const setHtml=(el,value)=>{if(el&&el.innerHTML!==value)el.innerHTML=value};
function labelNav(){
  const names=new Map([['schedule','課表'],['friends','找人'],['ai','安排'],['settings','我的']]);
  qa('.nav [data-view]').forEach(b=>{const v=b.dataset.view;if(names.has(v))setText(b,names.get(v))});
  qa('.bottom [data-view]').forEach(b=>{const v=b.dataset.view;if(names.has(v))setHtml(b,names.get(v))});
  qa('[data-community-open]').forEach(b=>{const html=b.closest('.bottom')?'動態<span class="nav-unread mobile-badge hidden" id="bottomChatBadge"></span>':'動態 <span class="nav-unread hidden" id="navChatBadge"></span>';setHtml(b,html)});
  qa('[data-admin-open]').forEach(b=>setText(b,b.closest('.bottom')?'管理':'網站管理'));
}
function authCopy(){
  const poster=q('.auth-poster');if(poster){const h=poster.querySelector('h2'),p=poster.querySelector('p');setHtml(h,'今天有空，<br>就碰面。');setText(p,'課表、朋友、動態和聊天，都放在同一個地方。')}
  setText(q('#registerForm h3'),'先留一個大家認得出的名字');setText(q('#loginForm h3'),'回來了就繼續');setText(q('#guestMode'),'先逛逛，不登入');setText(q('#registerForm .auth-submit'),'建立帳號');setText(q('#loginForm .auth-submit'),'登入');
}
function sectionCopy(){
  const friends=q('#friends .section-head');if(friends){setText(friends.querySelector('h2'),'找人');setText(friends.querySelector('p'),'搜名字或 @帳號，點一下就能看個人頁。成為好友後才能互看私人內容和課表。')}
  const community=q('#community .section-head');if(community){setText(community.querySelector('h2'),'動態');setText(community.querySelector('p'),'看看朋友最近在幹嘛，也可以直接發一則。')}
  const planner=q('#ai .section-head');if(planner){setText(planner.querySelector('h2'),'幫我安排');setText(planner.querySelector('p'),'問今天去哪上課、找空堂，或把讀書和作業排進這週。')}
  setText(q('#ai .ai-head b'),'安排');const launch=q('#aiLaunch');if(launch){const desired=launch.textContent.includes('關閉')?'回到一般安排':'進階安排';setText(launch,desired)}setText(q('#ai .ai-side .panel:nth-child(2) h3'),'快速問');
}
function feedModes(){qa('.feed-mode-bar [data-feed-mode]').forEach(b=>{setText(b,b.dataset.feedMode==='for_you'?'推薦':'最新');if(b.dataset.noluModeBound)return;b.dataset.noluModeBound='1';b.onclick=()=>{localStorage.setItem('nolu_feed_mode',b.dataset.feedMode);localStorage.setItem('hang_feed_mode',b.dataset.feedMode);localStorage.setItem('campus_feed_mode',b.dataset.feedMode);qa('.feed-mode-bar [data-feed-mode]').forEach(x=>x.classList.toggle('on',x===b));q('[data-community-tab="feed"]')?.click()}})}
function postVisibility(){const select=q('#postVisibility');if(!select||select.dataset.noluPills)return;select.dataset.noluPills='1';select.style.display='none';const pills=document.createElement('div');pills.className='visibility-pills';pills.innerHTML='<button type="button" data-v="public">大家</button><button type="button" data-v="private">好友</button>';select.parentElement?.after(pills);const sync=()=>pills.querySelectorAll('[data-v]').forEach(b=>b.classList.toggle('on',b.dataset.v===select.value));pills.querySelectorAll('[data-v]').forEach(b=>b.onclick=()=>{select.value=b.dataset.v;select.dispatchEvent(new Event('change',{bubbles:true}));sync()});sync();document.addEventListener('hang:privacy-changed',e=>{const privateAccount=e.detail?.profile_visibility==='private';setText(pills.querySelector('[data-v="public"]'),privateAccount?'一般':'大家')},{once:false})}
function profileEditor(){const card=q('.profile-settings');if(!card||card.dataset.noluEditor)return;card.dataset.noluEditor='1';card.classList.add('hang-profile-collapsed');const toggle=document.createElement('button');toggle.type='button';toggle.className='btn hang-profile-edit-toggle';toggle.textContent='編輯個人頁';card.querySelector('.profile-editor-head')?.after(toggle);toggle.onclick=()=>{const collapsed=card.classList.toggle('hang-profile-collapsed');setText(toggle,collapsed?'編輯個人頁':'收起編輯')};q('#saveName')?.addEventListener('click',()=>setTimeout(()=>{card.classList.add('hang-profile-collapsed');setText(toggle,'編輯個人頁')},150))}
function settingsHeader(){const grid=q('#settings .settings');if(!grid||q('.hang-settings-header'))return;const h=document.createElement('div');h.className='hang-settings-header';h.innerHTML='<h2>我的</h2><p>個人頁、隱私、通知和課表分享都在這裡。</p>';grid.before(h)}
function simplifySettings(){settingsHeader();profileEditor();const share=q('#settings .setting-card:not(.profile-settings):not(.privacy-v19)');if(share)setText(share.querySelector('h2'),'分享課表');setText(q('#deviceCard h3'),'手機與提醒');setText(q('#chatNotificationCard h3'),'聊天通知');qa('#settings .setting-card p').forEach(p=>{const next=p.innerHTML.replace(/PWA/gi,'主畫面版本').replace(/瀏覽器通知/g,'通知');if(next!==p.innerHTML)p.innerHTML=next})}
function replaceVisibleTechWords(){const skip='.feed-body,.reply-copy p,.message-body,.chat-message,.bubble.me,input,textarea,option,code,pre';const map=[[/PU\/PLAN/g,'Nolu'],[/PU PLAN/g,'Nolu'],[/hang\./gi,'Nolu'],[/\bAI\b/g,'安排'],[/Local AI/gi,'進階安排'],[/WebGPU/gi,'裝置支援'],[/API Key/gi,'額外金鑰'],[/BETA/gi,''],[/QUICK MODE/gi,'一般模式'],[/READY\.?/g,'好了']];const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);const nodes=[];let n;while(n=walker.nextNode())nodes.push(n);for(const node of nodes){const p=node.parentElement;if(!p||p.closest(skip)||['SCRIPT','STYLE'].includes(p.tagName))continue;let v=node.nodeValue||'';for(const [re,to] of map)v=v.replace(re,to);if(v!==node.nodeValue)node.nodeValue=v}}
function enhance(){labelNav();authCopy();sectionCopy();feedModes();postVisibility();simplifySettings();replaceVisibleTechWords();const search=q('#cloudFriendSearch');if(search&&search.placeholder!=='搜尋名字或 @帳號')search.placeholder='搜尋名字或 @帳號';setText(q('#addFriend'),'找人');setText(q('#importSchedule'),'匯入');setText(q('#add'),'新增');setText(q('#shareTop'),'分享')}
enhance();let scheduled=false;new MutationObserver(()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;enhance()})}).observe(document.body,{childList:true,subtree:true});
document.addEventListener('puplan:profile-changed',()=>setTimeout(enhance,20));
window.NOLU_UI={refresh:enhance};
window.HANG_UI=window.NOLU_UI;
