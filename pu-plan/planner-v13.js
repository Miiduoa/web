const $=s=>document.querySelector(s);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function waitForApp(){
  for(let i=0;i<120;i++){
    if(window.PUPLAN_APP&&$('#aiInput')&&$('#aiSend'))return window.PUPLAN_APP;
    await sleep(50);
  }
  throw new Error('課表助理初始化逾時');
}

const app=await waitForApp();
const DAYS=app.DAYS||[['一','星期一'],['二','星期二'],['三','星期三'],['四','星期四'],['五','星期五']];
const PERIODS=app.PERIODS||[];
const DAY_MAP={一:1,二:2,三:3,四:4,五:5,1:1,2:2,3:3,4:4,5:5};
const state={lastDay:null,lastCourseId:'',lastIntent:'',lastAnswer:''};
let engine=null,browserModel=null,loadingModel=false;

function accountId(){return window.PUPLAN_CLOUD?.getProfile?.()?.id||localStorage.getItem('puplan_username')||'guest'}
function historyKey(){return `puplan_planner_${accountId()}`}
let history=[];
try{history=JSON.parse(sessionStorage.getItem(historyKey())||'[]').slice(-24)}catch{}
function saveHistory(){try{sessionStorage.setItem(historyKey(),JSON.stringify(history.slice(-24)))}catch{}}

function courses(){return (app.courses?.()||[]).filter(c=>Number(c.day)>=1&&Number(c.day)<=5&&Number(c.start)>=1&&Number(c.end)>=Number(c.start))}
function selectedFriend(){return app.getSelectedFriend?.()||null}
function dayName(d){return DAYS[d-1]?.[1]||`星期${d}`}
function toMin(t='00:00'){const [h,m]=t.split(':').map(Number);return h*60+m}
function periodStart(p){return PERIODS[p-1]?.[0]||''}
function periodEnd(p){return PERIODS[p-1]?.[1]||''}
function courseLine(c){return `${periodStart(c.start)}–${periodEnd(c.end)}｜${c.name}${c.teacher?`｜${c.teacher}`:''}${c.room?`｜${c.room}`:''}`}
function normalize(s=''){return String(s).replace(/[\s()（）・·：:，,。.!！?？「」『』]/g,'').toLowerCase()}

function resolveDay(text){
  const q=String(text);
  let m=q.match(/(?:星期|週|禮拜)\s*([一二三四五1-5])/);
  if(m)return DAY_MAP[m[1]];
  m=q.match(/(?:週|星期)?([一二三四五])(?=有|上|沒|空|課|呢|怎|第|最)/);
  if(m)return DAY_MAP[m[1]];
  const now=new Date().getDay();
  if(/今天/.test(q)&&now>=1&&now<=5)return now;
  if(/明天/.test(q)){const d=now+1;return d>=1&&d<=5?d:null}
  if(/後天/.test(q)){const d=now+2;return d>=1&&d<=5?d:null}
  if(/那天|那一天|那週|那星期|那個星期|那呢/.test(q)&&state.lastDay)return state.lastDay;
  return null;
}

function resolveCourse(text){
  const q=normalize(text),all=courses();
  let hit=all.find(c=>{const n=normalize(c.name);return n.length>=2&&q.includes(n)});
  if(!hit)hit=all.find(c=>{const n=normalize(c.name);return n.length>=4&&q.includes(n.slice(0,4))});
  if(!hit&&/那堂|那門|那個課|這堂|這門|它|剛剛那/.test(text)&&state.lastCourseId)hit=all.find(c=>c.id===state.lastCourseId);
  if(hit){state.lastCourseId=hit.id;state.lastDay=hit.day}
  return hit||null;
}

function nextClass(){
  const all=courses(),now=new Date(),dow=now.getDay(),minute=now.getHours()*60+now.getMinutes();
  if(dow>=1&&dow<=5){
    for(const c of all.filter(x=>x.day===dow).sort((a,b)=>a.start-b.start)){
      const s=toMin(periodStart(c.start)),e=toMin(periodEnd(c.end));
      if(minute>=s&&minute<e)return{kind:'current',course:c,minutes:e-minute};
      if(minute<s)return{kind:'next',course:c,minutes:s-minute};
    }
  }
  for(let add=1;add<=7;add++){
    const d=((dow+add-1)%7)+1;
    if(d<1||d>5)continue;
    const c=all.filter(x=>x.day===d).sort((a,b)=>a.start-b.start)[0];
    if(c)return{kind:'future',course:c,day:d};
  }
  return null;
}

function freeBlocks(source=courses(),day=null,minLen=1){
  const out=[];
  for(let d=day||1;d<=(day||5);d++){
    const busy=new Set();
    source.filter(c=>c.day===d).forEach(c=>{for(let p=c.start;p<=c.end;p++)busy.add(p)});
    let s=null;
    for(let p=1;p<=9;p++){
      if(!busy.has(p)&&s===null)s=p;
      if((busy.has(p)||p===9)&&s!==null){const e=busy.has(p)?p-1:p;if(e-s+1>=minLen)out.push({day:d,start:s,end:e});s=null}
    }
  }
  return out;
}
function blockText(b){return `${dayName(b.day)} ${periodStart(b.start)}–${periodEnd(b.end)}`}

function commonFree(friend,minLen=1){
  if(!friend)return[];
  const both=[];
  for(let d=1;d<=5;d++){
    const mine=new Set(),theirs=new Set();
    courses().filter(c=>c.day===d).forEach(c=>{for(let p=c.start;p<=c.end;p++)mine.add(p)});
    (friend.courses||[]).filter(c=>c.day===d).forEach(c=>{for(let p=c.start;p<=c.end;p++)theirs.add(p)});
    let s=null;
    for(let p=1;p<=9;p++){
      const free=!mine.has(p)&&!theirs.has(p);
      if(free&&s===null)s=p;
      if((!free||p===9)&&s!==null){const e=!free?p-1:p;if(e-s+1>=minLen)both.push({day:d,start:s,end:e});s=null}
    }
  }
  return both;
}

function deterministic(text){
  const q=text.trim();if(!q)return'';
  const day=resolveDay(q),course=resolveCourse(q);if(day)state.lastDay=day;

  if(/下一堂|下一節|等等上|接下來|現在上|正在上/.test(q)){
    const n=nextClass();state.lastIntent='next';if(!n)return'目前課表裡找不到下一堂課。';state.lastCourseId=n.course.id;state.lastDay=n.course.day;
    if(n.kind==='current')return`你現在正在上「${n.course.name}」，約 ${n.minutes} 分鐘後下課${n.course.room?`，地點是 ${n.course.room}`:''}。`;
    if(n.kind==='next')return`下一堂是「${n.course.name}」，約 ${n.minutes} 分鐘後開始${n.course.room?`，地點是 ${n.course.room}`:''}。`;
    return`下一堂是${dayName(n.day)}的「${n.course.name}」，${periodStart(n.course.start)} 開始${n.course.room?`，地點是 ${n.course.room}`:''}。`;
  }
  if(course&&/老師|誰教|教授|授課/.test(q)){state.lastIntent='teacher';return`「${course.name}」的老師是 ${course.teacher||'課表沒有填老師'}。`}
  if(course&&/教室|哪裡|在哪|地點/.test(q)){state.lastIntent='room';return`「${course.name}」${course.room?`在 ${course.room}`:'目前課表沒有填教室'}。`}
  if(course&&/幾點|時間|第幾節|什麼時候/.test(q)){state.lastIntent='time';return`「${course.name}」是${dayName(course.day)}第 ${course.start}${course.end>course.start?`–${course.end}`:''} 節，${periodStart(course.start)}–${periodEnd(course.end)}。`}
  if(day&&/(有什麼課|有哪些課|上什麼|幾堂|課表|課程|怎麼排|呢)/.test(q)){
    const list=courses().filter(c=>c.day===day).sort((a,b)=>a.start-b.start);state.lastIntent='day';
    if(!list.length)return`${dayName(day)}沒有排課。`;
    return`${dayName(day)}有 ${list.length} 門課：\n${list.map((c,i)=>`${i+1}. ${courseLine(c)}`).join('\n')}`;
  }
  if(day&&/第一堂|最早/.test(q)){
    const list=courses().filter(c=>c.day===day).sort((a,b)=>a.start-b.start);state.lastIntent='first';
    if(!list.length)return`${dayName(day)}沒有課。`;state.lastCourseId=list[0].id;
    return`${dayName(day)}第一堂是「${list[0].name}」，${periodStart(list[0].start)} 開始${list[0].room?`，在 ${list[0].room}`:''}。`;
  }
  if(day&&/最後一堂|最晚/.test(q)){
    const list=courses().filter(c=>c.day===day).sort((a,b)=>b.end-a.end);state.lastIntent='last';
    if(!list.length)return`${dayName(day)}沒有課。`;state.lastCourseId=list[0].id;
    return`${dayName(day)}最後一堂是「${list[0].name}」，${periodEnd(list[0].end)} 下課。`;
  }
  if(/哪天.*(?:忙|滿|累)|最忙|最滿|最累/.test(q)){
    const loads=DAYS.map((_,i)=>({day:i+1,count:courses().filter(c=>c.day===i+1).length,slots:courses().filter(c=>c.day===i+1).reduce((n,c)=>n+c.end-c.start+1,0)})).sort((a,b)=>b.slots-a.slots||b.count-a.count);
    const x=loads[0];state.lastDay=x.day;state.lastIntent='load';return`${dayName(x.day)}最滿，共 ${x.count} 門、${x.slots} 節。`;
  }
  if(/空堂|空檔|有空|空時間|自由時間/.test(q)&&!/好友|朋友|共同/.test(q)){
    const blocks=freeBlocks(courses(),day,1).sort((a,b)=>(b.end-b.start)-(a.end-a.start));state.lastIntent='free';
    if(!blocks.length)return day?`${dayName(day)}沒有找到課間空檔。`:'這週沒有找到課間空檔。';
    return`${day?dayName(day):'這週'}比較好用的空檔：\n${blocks.slice(0,6).map((b,i)=>`${i+1}. ${blockText(b)}${b.end>b.start?`（${b.end-b.start+1} 節）`:''}`).join('\n')}`;
  }
  if(/好友|朋友|共同|一起/.test(q)&&/空|時間|有空|碰面|吃飯|讀書/.test(q)){
    const f=selectedFriend();state.lastIntent='friend_free';if(!f)return'先到好友頁選一位好友，我才能比對你們兩個的課表。';
    const blocks=commonFree(f,1);if(!blocks.length)return`目前找不到你和 ${f.name} 的共同空堂。`;
    return`你和 ${f.name} 的共同空檔：\n${blocks.slice(0,6).map((b,i)=>`${i+1}. ${blockText(b)}`).join('\n')}`;
  }
  if(/讀書|複習|作業|準備|安排|計畫|排一下|怎麼念/.test(q)){
    const blocks=freeBlocks(courses(),null,2).sort((a,b)=>(b.end-b.start)-(a.end-a.start)).slice(0,3);state.lastIntent='study';
    if(!blocks.length)return'目前沒有連續兩節以上的課間空檔。你可以告訴我哪天晚上有空、要準備哪一科，我再幫你細排。';
    return`如果先只看課表，我會優先用這些時段：\n${blocks.map((b,i)=>`${i+1}. ${blockText(b)}－${i===0?'最難的作業或考試準備':i===1?'練題與複習':'整理筆記或預習'}`).join('\n')}\n\n再告訴我要準備的科目和截止日，我可以繼續拆成具體任務。`;
  }
  if(/幾門課|總共幾門|課很多嗎|這週課量/.test(q)){
    const all=courses(),slots=all.reduce((n,c)=>n+c.end-c.start+1,0);state.lastIntent='summary';return`你目前這週有 ${all.length} 門固定時段課程，共 ${slots} 節。`;
  }
  if(/^那(呢|然後呢|怎麼辦)?[？?]?$/.test(q)&&state.lastDay){
    const list=courses().filter(c=>c.day===state.lastDay).sort((a,b)=>a.start-b.start);
    return list.length?`${dayName(state.lastDay)}有 ${list.length} 門：\n${list.map((c,i)=>`${i+1}. ${courseLine(c)}`).join('\n')}`:`${dayName(state.lastDay)}沒有排課。`;
  }
  return'';
}

function context(){
  const list=courses().sort((a,b)=>a.day-b.day||a.start-b.start).map(c=>`${dayName(c.day)} ${courseLine(c)}`).join('\n')||'目前沒有課程';
  const f=selectedFriend();
  const recent=history.slice(-10).map(m=>`${m.role==='user'?'使用者':'助理'}：${m.content}`).join('\n');
  return`你是 PU/PLAN 的課表與校園規劃助理。使用繁體中文與台灣常用說法。\n課表事實只能依照提供資料，不得猜課名、老師、教室或時間。要理解代名詞和上一輪脈絡。不確定就直接說資料不足。回答先給結論，再補必要理由，避免無關內容。\n\n使用者課表：\n${list}${f?`\n\n目前選中的好友：${f.name}\n${(f.courses||[]).map(c=>`${dayName(c.day)} ${c.name} ${periodStart(c.start)}-${periodEnd(c.end)}`).join('\n')}`:''}${recent?`\n\n最近對話：\n${recent}`:''}`;
}

function status(text,kind='ready'){
  const s=$('#aiStatus'),light=$('#aiLight'),mode=$('#aiModeLabel');
  if(s)s.textContent=text;if(light)light.className=`status-light ${kind}`;if(mode)mode.textContent=engine||browserModel?'進階理解':'課表理解';
}
function bubble(text,who='assistant'){
  const root=$('#aiMessages');if(!root)return null;
  const el=document.createElement('div');el.className=`bubble ${who==='user'?'me':'ai'}`;el.textContent=text;root.append(el);root.scrollTop=root.scrollHeight;return el;
}

async function enableModel(){
  if(engine||browserModel)return true;if(loadingModel)return false;loadingModel=true;
  const btn=$('#aiLaunch');if(btn){btn.disabled=true;btn.textContent='準備中…'};status('正在準備本機進階理解…','loading');
  try{
    if(globalThis.LanguageModel?.create){browserModel=await globalThis.LanguageModel.create({systemPrompt:context()});status('進階理解已啟用','ready');if(btn)btn.textContent='已啟用';return true}
    if(!navigator.gpu)throw new Error('這台裝置不支援本機模型；基本課表理解仍可直接使用。');
    const webllm=await import('https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm/+esm');
    engine=await webllm.CreateMLCEngine('Qwen2.5-0.5B-Instruct-q4f16_1-MLC',{initProgressCallback:r=>{const pct=typeof r.progress==='number'?` ${Math.round(r.progress*100)}%`:'';status((r.text||'下載模型')+pct,'loading')}});
    status('進階理解已啟用','ready');if(btn)btn.textContent='已啟用';return true;
  }catch(e){status(e.message||'本機模型無法啟用','error');if(btn)btn.textContent='重試進階理解';return false}
  finally{loadingModel=false;if(btn)btn.disabled=false}
}

async function modelReply(text){
  if(browserModel){return String(await browserModel.prompt(`${context()}\n\n現在問題：${text}`)||'').trim()}
  if(engine){const r=await engine.chat.completions.create({messages:[{role:'system',content:context()},{role:'user',content:text}],temperature:.25,max_tokens:420});return String(r.choices?.[0]?.message?.content||'').trim()}
  return'';
}

function smartFallback(text){
  if(state.lastAnswer&&/為什麼|原因|怎麼判斷/.test(text))return`剛剛的判斷是依照你課表裡的上課節數、時間和空堂計算，不是猜的。你要的話，我可以把每一天拆開比較。`;
  const all=courses();
  if(!all.length)return'你目前還沒有可讀取的課程。先新增或匯入課表後，我就能回答課程、空堂和讀書安排。';
  return'我可以直接讀你的課表，但這句目前不足以可靠判斷你想問什麼。你可以補一句目標，例如「幫我比較星期三和星期四哪天比較累」或「把空堂排成讀書計畫」。';
}

async function ask(){
  const input=$('#aiInput'),send=$('#aiSend');const text=input?.value.trim();if(!text)return;
  input.value='';bubble(text,'user');if(send)send.disabled=true;
  try{
    let answer=deterministic(text);
    if(!answer&&(engine||browserModel)){try{answer=await modelReply(text)}catch{answer=''}}
    if(!answer)answer=smartFallback(text);
    state.lastAnswer=answer;history.push({role:'user',content:text},{role:'assistant',content:answer});saveHistory();bubble(answer);
  }catch(e){bubble(`這次沒有處理成功：${e.message||'未知錯誤'}。基本課表功能仍可用，你可以再送一次。`)}
  finally{if(send)send.disabled=false;input?.focus()}
}

function install(){
  const oldInput=$('#aiInput'),oldSend=$('#aiSend'),oldLaunch=$('#aiLaunch');
  if(!oldInput||!oldSend)return;
  const input=oldInput.cloneNode(true),send=oldSend.cloneNode(true),launch=oldLaunch?.cloneNode(true);
  oldInput.replaceWith(input);oldSend.replaceWith(send);if(oldLaunch&&launch)oldLaunch.replaceWith(launch);
  const root=$('#aiMessages');if(root){root.innerHTML='';bubble('可以直接問我課表、下一堂、空堂、老師、教室或讀書安排，也可以接著上一題繼續問。基本功能不需要先下載模型。')}
  send.addEventListener('click',ask);
  input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();ask()}});
  launch?.addEventListener('click',enableModel);
  if(launch)launch.textContent='啟用進階理解';status('可直接使用','ready');
  document.querySelectorAll('[data-smart]').forEach(b=>{b.onclick=()=>{const map={stress:'我哪天最忙？',free:'幫我找這週長空堂',study:'幫我排讀書時間',friend:'我和目前選的好友有哪些共同空堂？'};input.value=map[b.dataset.smart]||'';ask()}});
  document.addEventListener('puplan:courses-changed',()=>{if(browserModel){try{browserModel.destroy?.()}catch{}browserModel=null}engine=null;status('課表已更新，可直接使用','ready')});
}

install();
window.PUPLAN_PLANNER={ask,enableModel};
