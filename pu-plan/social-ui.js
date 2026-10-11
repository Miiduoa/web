import {cleanAvatar} from './core/state.js';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
for(let i=0;i<80&&(!window.PUPLAN_APP||!window.PUPLAN_CLOUD);i++)await sleep(50);
const app=window.PUPLAN_APP, cloud=window.PUPLAN_CLOUD;
if(!app||!cloud)throw new Error('社群功能載入失敗');
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const DAYS=app.DAYS, PERIODS=app.PERIODS, esc=app.esc;
let friendTool='profile', pendingAvatar=undefined;

const toMin=t=>{const [h,m]=t.split(':').map(Number);return h*60+m};
const courseStart=c=>toMin(PERIODS[c.start-1][0]);
const courseEnd=c=>toMin(PERIODS[c.end-1][1]);
const fmtMins=n=>n<60?`${n} 分鐘`:`${Math.floor(n/60)} 小時${n%60?` ${n%60} 分`:''}`;
const initial=(s='?')=>[...String(s||'?')][0]?.toUpperCase()||'?';
const avatar=(person,cls='avatar')=>{const src=cleanAvatar(person?.avatar||person?.avatar_data||'');const name=person?.name||person?.display_name||'?';return `<div class="${cls}">${src?`<img src="${src}" alt="${esc(name)}">`:esc(initial(name))}</div>`};
const today=()=>new Date().getDay();
const dayName=d=>DAYS[d-1]?.[1]||`星期${d}`;
const periodLabel=(s,e)=>`${PERIODS[s-1][0]}–${PERIODS[e-1][1]}`;
function building(room=''){
  const s=String(room); const map=[['主顧','主顧樓'],['任垣','任垣樓'],['伯鐸','伯鐸樓'],['方濟','方濟樓'],['文興','文興樓'],['靜安','靜安樓'],['思源','思源樓'],['至善','至善樓'],['格倫','格倫樓'],['宜園','宜園']];
  for(const [k,v] of map)if(s.includes(k))return v; const m=s.match(/^([^（(\d\s]{2,6})/);return m?m[1].trim():'';
}
function commonFree(friend){
  const mine=app.courses(),out=[];if(!friend?.courses?.some(c=>c.day>=1&&c.day<=5)||!mine.some(c=>c.day>=1&&c.day<=5))return out;
  for(let d=1;d<=5;d++){
    const busy=new Set();[mine,friend.courses||[]].forEach(list=>list.filter(c=>c.day===d).forEach(c=>{for(let p=c.start;p<=c.end;p++)busy.add(p)}));
    const windows=[[3,9],[10,13]];for(const [lo,hi] of windows){let st=null;for(let p=lo;p<=hi;p++){const free=!busy.has(p);if(free&&st===null)st=p;if((!free||p===hi)&&st!==null){const en=free&&p===hi?p:p-1;if(en-st+1>=2)out.push({day:d,start:st,end:en,slots:en-st+1});st=null}}}
  }
  return out.sort((a,b)=>b.slots-a.slots||a.day-b.day||a.start-b.start);
}
function sameBuildingMatches(){
  const wd=today();if(wd<1||wd>5)return[];const mine=app.courses().filter(c=>c.day===wd),friends=app.friends().filter(f=>f.cloud);const out=[];
  for(const f of friends){for(const mc of mine){const mb=building(mc.room);if(!mb)continue;for(const fc of (f.courses||[]).filter(c=>c.day===wd)){const fb=building(fc.room);if(fb!==mb)continue;const distance=Math.max(0,Math.max(mc.start,fc.start)-Math.min(mc.end,fc.end)-1);out.push({friend:f,building:mb,mine:mc,theirs:fc,close:distance<=1});break}if(out.some(x=>x.friend.id===f.id))break}}
  return out;
}
function busyMask(courses,day){const a=Array(13).fill(false);(courses||[]).filter(c=>c.day===day).forEach(c=>{for(let p=c.start;p<=c.end;p++)a[p-1]=true});return a}
function selectedFriend(){const selected=app.getSelectedFriend?.();let f=typeof selected==='string'?app.friends().find(x=>x.id===selected):selected;if(!f){const first=app.friends().find(x=>x.cloud)||app.friends()[0];if(first){app.setSelectedFriend?.(first.id);f=first}}return f}
function friendStats(f){const slots=(f.courses||[]).filter(c=>c.day>=1&&c.start>0).reduce((n,c)=>n+c.end-c.start+1,0);const busiest=DAYS.map((_,i)=>({d:i+1,n:(f.courses||[]).filter(c=>c.day===i+1).reduce((n,c)=>n+c.end-c.start+1,0)})).sort((a,b)=>b.n-a.n)[0];return {slots,busiest}}
function bindInviteButtons(root,f){if(!f?.cloud){root.querySelectorAll('[data-invite-kind]').forEach(b=>{b.disabled=true;b.title='課表副本不是已驗證好友，無法發送邀約'});return}root.querySelectorAll('[data-invite-kind]').forEach(b=>b.onclick=()=>cloud.createMeetup(f.id,b.dataset.inviteKind,+b.dataset.day,+b.dataset.start,+b.dataset.end,b.dataset.inviteKind==='meal'?'一起吃飯？':'一起讀書？'))}
function renderFriendProfile(f){
  const stats=friendStats(f),free=commonFree(f).slice(0,4),wd=today(),todays=(f.courses||[]).filter(c=>c.day===wd).sort((a,b)=>a.start-b.start),same=sameBuildingMatches().find(x=>x.friend.id===f.id);
  return `<div class="profile-page"><div class="profile-hero">${avatar(f,'avatar avatar-profile')}<div class="profile-title"><h2>${esc(f.name)}</h2><b>@${esc(f.username||'user')}</b><p>${esc(f.bio||'這位好友還沒有寫自介。')}</p></div><div class="profile-actions"><button class="btn lime" data-open-tool="overlay">一起看課表</button><button class="btn" data-open-tool="meetups">看邀約</button></div></div><div class="profile-stats"><div><b>${(f.courses||[]).length}</b><span>門課</span></div><div><b>${stats.slots}</b><span>每週節數</span></div><div><b>${stats.busiest?.n||0}</b><span>${stats.busiest?.d?dayName(stats.busiest.d):'最忙日'}</span></div></div>${same?`<div class="encounter-note"><b>今天可能遇到</b><span>你們今天都會在 ${esc(same.building)}。${same.close?'而且時間很接近。':'不同時段，但同一棟。'}</span></div>`:''}<div class="profile-columns"><section><h3>${wd>=1&&wd<=5?`${dayName(wd)}的課`:'今天是週末'}</h3>${todays.length?todays.map(c=>`<div class="profile-class ${c.color||'gray'}"><time>${periodLabel(c.start,c.end)}</time><div><b>${esc(c.name)}</b><small>${esc(c.room||'')}</small></div></div>`).join(''):'<div class="soft-empty">今天沒課。</div>'}</section><section><h3>你們都能喘氣的時段</h3>${free.length?free.map(b=>`<div class="free-invite"><div><b>${dayName(b.day)} ${periodLabel(b.start,b.end)}</b><small>連續 ${b.slots} 節都空</small></div><div><button class="mini-btn" data-invite-kind="meal" data-day="${b.day}" data-start="${b.start}" data-end="${b.end}">🍜 吃飯</button><button class="mini-btn secondary" data-invite-kind="study" data-day="${b.day}" data-start="${b.start}" data-end="${b.end}">📚 讀書</button></div></div>`).join(''):'<div class="soft-empty">白天沒有連續兩節以上的共同空堂。</div>'}</section></div></div>`;
}
function renderSameBuilding(){
  const matches=sameBuildingMatches();return `<div class="same-building-view"><div class="social-feature-head"><div><h2>今天可能遇到誰？</h2><p>依照雙方課表的教室名稱推算，同棟不代表一定會碰面，但很適合揪下課吃東西。</p></div><div class="big-count">${matches.length}</div></div>${matches.length?matches.map(m=>`<article class="encounter-card">${avatar(m.friend)}<div><b>${esc(m.friend.name)}</b><small>@${esc(m.friend.username||'')} · ${esc(m.building)}</small><p>你：${periodLabel(m.mine.start,m.mine.end)} ${esc(m.mine.name)}<br>對方：${periodLabel(m.theirs.start,m.theirs.end)} ${esc(m.theirs.name)}</p></div><span class="encounter-badge ${m.close?'hot':''}">${m.close?'很可能遇到':'今天同棟'}</span></article>`).join(''):'<div class="soft-empty roomy">今天沒有找到同棟好友。等好友多一點後這區會更有感。</div>'}</div>`;
}
function renderOverlay(f){
  if(!f)return '<div class="empty">先選一位好友。</div>';let rows='';for(let d=1;d<=5;d++){const me=busyMask(app.courses(),d),them=busyMask(f.courses,d);rows+=`<div class="overlay-row"><b>${DAYS[d-1][0]}</b><div class="overlay-cells">${me.map((m,i)=>`<span class="${m&&them[i]?'both':m?'me':them[i]?'them':'free'}" title="第 ${i+1} 節"></span>`).join('')}</div></div>`}const free=commonFree(f).slice(0,5);return `<div class="overlay-view"><div class="social-feature-head"><div><h2>兩張課表疊起來看</h2><p>黑色是你、粉色是好友、藍色代表兩個人都在上課；空白只代表雙方課表都沒排課，仍需確認私人行程。</p></div>${avatar(f,'avatar avatar-lg')}</div><div class="overlay-legend"><span><i class="me"></i>你有課</span><span><i class="them"></i>${esc(f.name)} 有課</span><span><i class="both"></i>兩人都有課</span><span><i class="free"></i>共同空堂</span></div><div class="overlay-board"><div class="overlay-scale"><b></b>${PERIODS.map((_,i)=>`<span>${i+1}</span>`).join('')}</div>${rows}</div><h3 class="overlay-sub">最實用的共同空堂</h3>${free.length?`<div class="free-grid">${free.map(b=>`<div class="free-card"><b>${dayName(b.day)}</b><strong>${periodLabel(b.start,b.end)}</strong><small>${b.slots} 節都空</small><div><button class="mini-btn" data-invite-kind="meal" data-day="${b.day}" data-start="${b.start}" data-end="${b.end}">🍜 約吃飯</button><button class="mini-btn secondary" data-invite-kind="study" data-day="${b.day}" data-start="${b.start}" data-end="${b.end}">📚 約讀書</button></div></div>`).join('')}</div>`:'<div class="soft-empty">沒有找到連續兩節以上的共同空堂。</div>'}</div>`;
}
function meetupOther(m){const me=cloud.getProfile?.()?.id,id=m.creator_id===me?m.invitee_id:m.creator_id;return app.friends().find(f=>f.id===id)||cloud.getSocial?.().profiles?.find(p=>p.id===id)||{id,name:'好友',display_name:'好友',username:''}}
function renderMeetupCards(limit=100){
  const me=cloud.getProfile?.()?.id,ms=(cloud.getSocial?.().meetups||[]).slice(0,limit);if(!cloud.isSignedIn())return '<div class="soft-empty">登入後才能收發邀約。</div>';if(!ms.length)return '<div class="soft-empty roomy">目前沒有邀約。到好友個人頁或課表疊圖，看到共同空堂就能一鍵約。</div>';
  return ms.map(m=>{const other=meetupOther(m),incoming=m.invitee_id===me,kind=m.kind==='meal'?'🍜 吃飯':'📚 讀書';let ctl='';if(m.status==='pending'&&incoming)ctl=`<div><button class="mini-btn" data-meet-accept="${m.id}">接受</button><button class="mini-btn secondary" data-meet-decline="${m.id}">婉拒</button></div>`;else if(m.status==='pending')ctl=`<button class="mini-btn secondary" data-meet-cancel="${m.id}">取消</button>`;else if(m.status==='accepted'&&m.creator_id===me)ctl=`<button class="mini-btn secondary" data-meet-cancel="${m.id}">取消約</button>`;else ctl=`<span class="meet-status ${m.status}">${({accepted:'已成局',declined:'已婉拒',cancelled:'已取消'})[m.status]||m.status}</span>`;return `<article class="meet-card">${avatar(other)}<div class="meet-main"><b>${kind} · ${dayName(m.day)} ${periodLabel(m.start_period,m.end_period)}</b><small>${incoming?'來自':'邀請'} ${esc(other.name||other.display_name)} · @${esc(other.username||'')}</small>${m.note?`<p>${esc(m.note)}</p>`:''}</div>${ctl}</article>`}).join('');
}
function bindMeetupControls(root=document){root.querySelectorAll('[data-meet-accept]').forEach(b=>b.onclick=()=>cloud.respondMeetup(b.dataset.meetAccept,'accepted'));root.querySelectorAll('[data-meet-decline]').forEach(b=>b.onclick=()=>cloud.respondMeetup(b.dataset.meetDecline,'declined'));root.querySelectorAll('[data-meet-cancel]').forEach(b=>b.onclick=()=>cloud.cancelMeetup(b.dataset.meetCancel))}
function renderMeetups(){return `<div class="meetups-view"><div class="social-feature-head"><div><h2>不要只看課表，直接約。</h2><p>共同空堂發出去後，對方可以直接接受或婉拒。</p></div></div><div class="meetup-stack">${renderMeetupCards()}</div></div>`}
function renderFriendTool(){
  const view=$('#friendView');if(!view)return;const f=selectedFriend();$$('[data-friend-tool]').forEach(b=>b.classList.toggle('on',b.dataset.friendTool===friendTool));
  if(f&&!f.cloud&&friendTool==='profile'){app.renderFriends();return}
  if(friendTool==='same-building')view.innerHTML=renderSameBuilding();else if(friendTool==='overlay')view.innerHTML=renderOverlay(f);else if(friendTool==='meetups')view.innerHTML=renderMeetups();else view.innerHTML=f?renderFriendProfile(f):'<div class="empty">還沒有好友。<br><br>先用左邊搜尋名字加一個朋友。</div>';
  if(f&&!f.cloud&&friendTool==='overlay'){const note=document.createElement('p');note.className='share-preview';note.textContent='對方資料來自未驗證的分享副本，不會即時更新；無法直接發送邀約。';view.prepend(note)}
  if(f)bindInviteButtons(view,f);view.querySelectorAll('[data-open-tool]').forEach(b=>b.onclick=()=>{friendTool=b.dataset.openTool;renderFriendTool()});bindMeetupControls(view);
}
function renderSocialSummary(){
  const box=$('#socialHighlights');if(!box)return;const f=app.friends().filter(x=>x.cloud),same=sameBuildingMatches(),me=cloud.getProfile?.()?.id,meet=cloud.getSocial?.().meetups||[],pending=meet.filter(m=>m.invitee_id===me&&m.status==='pending').length;
  box.innerHTML=`<button class="social-stat" data-jump-tool="profile"><span>好友</span><b>${f.length}</b><small>已接受好友</small></button><button class="social-stat blue" data-jump-tool="same-building"><span>今天附近</span><b>${same.length}</b><small>今天可能遇到</small></button><button class="social-stat pink" data-jump-tool="meetups"><span>待回覆</span><b>${pending}</b><small>好友邀約</small></button>`;box.querySelectorAll('[data-jump-tool]').forEach(b=>b.onclick=()=>{friendTool=b.dataset.jumpTool;renderFriendTool();$('#friendView')?.scrollIntoView({behavior:'smooth',block:'start'})});
  const left=$('#meetupList');if(left){left.innerHTML=renderMeetupCards(3);bindMeetupControls(left)}
}

async function imageToAvatar(file){
  if(!file)return undefined;if(file.size>12*1024*1024)throw new Error('照片太大，請選 12MB 以下的圖片');
  const url=URL.createObjectURL(file);try{const img=new Image();img.src=url;await img.decode();const size=192,canvas=document.createElement('canvas');canvas.width=canvas.height=size;const ctx=canvas.getContext('2d');const side=Math.min(img.naturalWidth,img.naturalHeight),sx=(img.naturalWidth-side)/2,sy=(img.naturalHeight-side)/2;ctx.drawImage(img,sx,sy,side,side,0,0,size,size);return canvas.toDataURL('image/jpeg',.76)}finally{URL.revokeObjectURL(url)}
}
function previewAvatar(data){const box=$('#profileAvatarPreview');if(!box)return;const name=$('#name')?.value||cloud.getProfile?.()?.display_name||localStorage.getItem('puplan_name')||'?';box.innerHTML=data?`<img src="${data}" alt="">`:esc(initial(name))}
async function saveProfileFromForm(){
  const name=$('#name')?.value.trim(),username=$('#username')?.value.trim().replace(/^@/,''),bio=$('#bio')?.value.trim()||'',discoverable=$('#discoverable')?.checked!==false;
  if(!name)return app.toast('請輸入顯示名稱');if(!/^[A-Za-z0-9_.]{2,24}$/.test(username))return app.toast('@帳號格式不正確');
  if(cloud.isSignedIn()){const opts={bio,discoverable};if(pendingAvatar!==undefined)opts.avatar_data=pendingAvatar;await cloud.updateProfile(name,username,opts);pendingAvatar=undefined}else{localStorage.setItem('puplan_name',name);localStorage.setItem('puplan_username',username);localStorage.setItem('puplan_bio',bio);localStorage.setItem('puplan_discoverable',discoverable?'1':'0');if(pendingAvatar!==undefined){if(pendingAvatar)localStorage.setItem('puplan_avatar',pendingAvatar);else localStorage.removeItem('puplan_avatar')}app.renderShare();app.toast('個人資料已存在這台裝置')}
}

$$('[data-friend-tool]').forEach(b=>b.onclick=()=>{friendTool=b.dataset.friendTool;renderFriendTool()});
document.addEventListener('click',e=>{if(e.target.closest?.('[data-friend]'))setTimeout(()=>{friendTool='profile';renderFriendTool()},0)});
$('#avatarInput')?.addEventListener('change',async e=>{try{pendingAvatar=await imageToAvatar(e.target.files?.[0]);previewAvatar(pendingAvatar);app.toast('頭像已準備好，記得按儲存')}catch(err){app.toast(err.message)}});
$('#removeAvatar')?.addEventListener('click',()=>{pendingAvatar='';previewAvatar('');app.toast('按儲存後會移除頭像')});
if($('#saveName'))$('#saveName').onclick=async()=>{const button=$('#saveName');if(button.disabled)return;button.disabled=true;try{await saveProfileFromForm()}catch(error){app.toast(error?.name==='QuotaExceededError'?'儲存空間不足，尚未儲存。':error.message||'這次尚未儲存，請稍後重試')}finally{button.disabled=false}};
document.addEventListener('puplan:profile-changed',e=>{const p=e.detail;if($('#bio'))$('#bio').value=p?.bio||localStorage.getItem('puplan_bio')||'';if($('#discoverable'))$('#discoverable').checked=p?p.discoverable!==false:localStorage.getItem('puplan_discoverable')!=='0';previewAvatar(p?.avatar_data||localStorage.getItem('puplan_avatar')||'');renderSocialSummary()});
document.addEventListener('puplan:social-changed',()=>{renderSocialSummary();renderFriendTool()});
document.addEventListener('puplan:courses-changed',()=>{renderSocialSummary();renderFriendTool()});

renderSocialSummary();renderFriendTool();

