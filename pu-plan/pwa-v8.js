(()=>{
  const $=s=>document.querySelector(s);
  let installPrompt=null,lastReminder='';
  const isIOS=/iPad|iPhone|iPod/.test(navigator.userAgent)||(/Macintosh/.test(navigator.userAgent)&&navigator.maxTouchPoints>1);
  const toast=m=>window.PUPLAN_APP?.toast?.(m);
  const wait=()=>window.PUPLAN_APP?init():setTimeout(wait,180);
  function minutesOf(t){const [h,m]=t.split(':').map(Number);return h*60+m}
  function dayName(d){return window.PUPLAN_APP?.DAYS?.[d-1]?.[1]||`星期${d}`}
  function nextState(){
    const app=window.PUPLAN_APP, periods=app.PERIODS, courses=app.courses().filter(c=>c.day>0);
    const now=new Date(), dow=now.getDay(), cur=now.getHours()*60+now.getMinutes();
    if(dow>=1&&dow<=5){
      for(const c of courses.filter(x=>x.day===dow).sort((a,b)=>a.start-b.start)){
        const s=minutesOf(periods[c.start-1][0]),e=minutesOf(periods[c.end-1][1]);
        if(cur>=s&&cur<e)return{mode:'now',course:c,mins:e-cur,label:`${e-cur} 分鐘後下課`};
        if(cur<s)return{mode:'next',course:c,mins:s-cur,label:`${s-cur} 分鐘後上課`};
      }
    }
    for(let add=1;add<=7;add++){
      const d=((dow+add-1)%7)+1;if(d<1||d>5)continue;
      const cs=courses.filter(x=>x.day===d).sort((a,b)=>a.start-b.start);if(cs.length)return{mode:'future',course:cs[0],day:d,mins:null,label:`下一堂在${add===1?'明天':dayName(d)}`};
    }
    return null;
  }
  function renderPulse(){
    const root=$('#schedule');if(!root)return;let el=$('#classPulse');if(!el){el=document.createElement('div');el.id='classPulse';el.className='class-pulse';const target=$('#nowStrip')||root.firstElementChild;target?.parentNode?.insertBefore(el,target)}
    const s=nextState();if(!s){el.innerHTML='<b>NO CLASS QUEUED</b><span>目前沒有可計算的下一堂課。</span>';return}
    const c=s.course,room=c.room?` · ${c.room}`:'';
    el.innerHTML=`<div><small>${s.mode==='now'?'RIGHT NOW':s.mode==='next'?'UP NEXT':'NEXT CLASS'}</small><b>${c.name}</b><span>${s.label}${room}</span></div>${s.mins!=null?`<strong>${s.mins}<em>MIN</em></strong>`:''}`;
    maybeNotify(s);
  }
  async function maybeNotify(s){
    if(localStorage.getItem('puplan_reminders')!=='1'||s.mode!=='next'||s.mins>10||s.mins<1||Notification.permission!=='granted')return;
    const key=`${new Date().toDateString()}-${s.course.id}-${s.course.start}`;if(lastReminder===key||localStorage.getItem('puplan_last_reminder')===key)return;
    lastReminder=key;localStorage.setItem('puplan_last_reminder',key);
    const body=`${s.mins} 分鐘後上課${s.course.room?' · '+s.course.room:''}`;
    try{const reg=await navigator.serviceWorker?.ready;reg?reg.showNotification(`等等要上 ${s.course.name}`,{body,icon:'/icon.svg',badge:'/icon.svg',tag:key}):new Notification(`等等要上 ${s.course.name}`,{body})}catch{}
  }
  function addInstallUI(){
    const actions=$('.actions');if(actions&&!$('#installApp')){const b=document.createElement('button');b.id='installApp';b.className='btn install-app';b.textContent='＋ 加到主畫面';b.onclick=install;actions.insertBefore(b,actions.firstChild)}
    const settings=$('#settings .settings');if(settings&&!$('#deviceCard')){const card=document.createElement('article');card.id='deviceCard';card.className='setting-card device-card';card.innerHTML=`<div class="kicker">APP / REMINDERS</div><h3>把 PU/PLAN 當 App 用</h3><p>加入主畫面後開啟更像原生 App。上課提醒目前在 PU/PLAN 開啟時最可靠。</p><button class="btn lime" id="installSettings">加入主畫面</button><label class="reminder-toggle"><input type="checkbox" id="reminderToggle"><span><b>上課前 10 分鐘提醒</b><small>需要允許瀏覽器通知。</small></span></label>`;settings.append(card);$('#installSettings').onclick=install;const t=$('#reminderToggle');t.checked=localStorage.getItem('puplan_reminders')==='1';t.onchange=async()=>{if(t.checked){if(!('Notification'in window)){t.checked=false;return toast('這個瀏覽器不支援通知')}const p=await Notification.requestPermission();if(p!=='granted'){t.checked=false;return toast('沒有取得通知權限')}}localStorage.setItem('puplan_reminders',t.checked?'1':'0');toast(t.checked?'上課提醒已開啟':'上課提醒已關閉')}}
  }
  async function install(){
    if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;return}
    if(isIOS){showIOS();return}
    toast('如果瀏覽器支援安裝，請從網址列或瀏覽器選單選「安裝 App」/「加入主畫面」');
  }
  function showIOS(){let d=$('#iosInstallDialog');if(!d){d=document.createElement('dialog');d.id='iosInstallDialog';d.className='ios-install-dialog';d.innerHTML='<div class="modal-head"><h2>加入 iPhone 主畫面</h2><button class="x" type="button">×</button></div><div class="ios-steps"><b>1.</b><span>用 Safari 打開 PU/PLAN</span><b>2.</b><span>按下方「分享」按鈕</span><b>3.</b><span>往下選「加入主畫面」</span><b>4.</b><span>按「新增」就完成</span></div>';document.body.append(d);d.querySelector('.x').onclick=()=>d.close()}d.showModal()}
  function renderActivity(){
    const f=$('#friends');if(!f||!window.PUPLAN_CLOUD)return;let box=$('#friendActivity');if(!box){box=document.createElement('section');box.id='friendActivity';box.className='friend-activity';const h=$('#socialHighlights');h?.parentNode?.insertBefore(box,h)}
    const s=window.PUPLAN_CLOUD.getSocial?.()||{},profile=window.PUPLAN_CLOUD.getProfile?.(),items=[];
    (s.relationships||[]).filter(r=>r.status==='pending'&&r.addressee_id===profile?.id).forEach(r=>items.push({t:r.created_at||'',icon:'＋',text:'你有新的好友邀請'}));
    (s.meetups||[]).filter(m=>m.status==='pending'&&m.invitee_id===profile?.id).forEach(m=>items.push({t:m.created_at||'',icon:m.kind==='meal'?'🍜':'📚',text:m.kind==='meal'?'有人約你吃飯':'有人約你讀書'}));
    (s.friends||[]).forEach(x=>{if(x.t)items.push({t:x.t,icon:'↻',text:`${x.name} 更新了課表`})});
    items.sort((a,b)=>new Date(b.t)-new Date(a.t));
    box.innerHTML=`<div class="friend-activity-head"><div><small>FRIEND ACTIVITY</small><b>最近動態</b></div><span>${items.length?items.length+' UPDATES':'QUIET MODE'}</span></div><div class="activity-row">${items.slice(0,5).map(i=>`<div class="activity-chip"><i>${i.icon}</i><span>${i.text}</span></div>`).join('')||'<div class="activity-empty">目前沒有新的好友動態。</div>'}</div>`;
    const pending=(s.relationships||[]).filter(r=>r.status==='pending'&&r.addressee_id===profile?.id).length+(s.meetups||[]).filter(m=>m.status==='pending'&&m.invitee_id===profile?.id).length;
    if('setAppBadge'in navigator){pending?navigator.setAppBadge(pending):navigator.clearAppBadge?.()}
  }
  function init(){
    addInstallUI();renderPulse();renderActivity();
    setInterval(renderPulse,30000);
    document.addEventListener('puplan:courses-changed',renderPulse);
    document.addEventListener('puplan:social-changed',renderActivity);
    document.addEventListener('puplan:profile-changed',renderActivity);
    window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('#installApp')?.classList.add('ready')});
    if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
  }
  wait();
})();