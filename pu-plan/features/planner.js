const $=s=>document.querySelector(s);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function waitForApp(){
  for(let i=0;i<100;i++){
    if(window.PUPLAN_APP&&$('#aiInput')&&$('#aiSend'))return window.PUPLAN_APP;
    await sleep(40);
  }
  throw new Error('安排功能暫時無法開啟');
}

const app=await waitForApp();
const DAYS=app.DAYS;
const PERIODS=app.PERIODS;
const memory={day:null,courseId:'',plan:null,advanced:false};
const history=[];

const dayName=d=>DAYS[d-1]?.[1]||'';
const startTime=p=>PERIODS[p-1]?.[0]||'';
const endTime=p=>PERIODS[p-1]?.[1]||'';
const toMin=t=>{const [h,m]=String(t||'0:0').split(':').map(Number);return h*60+m};
const clean=s=>String(s||'').replace(/[\s，,。.!！?？：:「」『』()（）]/g,'').toLowerCase();
const courses=()=>app.courses().filter(c=>Number(c.day)>=1&&Number(c.day)<=5&&Number(c.start)>=1&&Number(c.end)>=Number(c.start));

function resolveDay(text){
  const q=String(text);
  const m=q.match(/(?:星期|週|禮拜)\s*([一二三四五1-5])/);
  if(m){const map={一:1,二:2,三:3,四:4,五:5};return map[m[1]]||Number(m[1])}
  const today=new Date().getDay();
  if(q.includes('今天')&&today>=1&&today<=5)return today;
  if(q.includes('明天')&&today+1>=1&&today+1<=5)return today+1;
  if(/那天|那一天|那星期|那週|那呢/.test(q))return memory.day;
  return null;
}

function resolveCourse(text){
  const q=clean(text),all=courses();
  let found=all.find(c=>{const n=clean(c.name);return n.length>=2&&q.includes(n)});
  if(!found)found=all.find(c=>{const n=clean(c.name);return n.length>=4&&q.includes(n.slice(0,4))});
  if(!found&&/那堂|那門|這堂|這門|剛剛那|它/.test(text)&&memory.courseId)found=all.find(c=>c.id===memory.courseId);
  if(found){memory.courseId=found.id;memory.day=found.day}
  return found||null;
}

function nextClass(){
  const now=new Date(),day=now.getDay(),minute=now.getHours()*60+now.getMinutes();
  if(day>=1&&day<=5){
    for(const c of courses().filter(x=>x.day===day).sort((a,b)=>a.start-b.start)){
      const s=toMin(startTime(c.start)),e=toMin(endTime(c.end));
      if(minute>=s&&minute<e)return{kind:'now',course:c,minutes:e-minute};
      if(minute<s)return{kind:'next',course:c,minutes:s-minute};
    }
  }
  for(let plus=1;plus<=7;plus++){
    const d=((day+plus-1)%7)+1;if(d>5)continue;
    const c=courses().filter(x=>x.day===d).sort((a,b)=>a.start-b.start)[0];
    if(c)return{kind:'future',course:c};
  }
  return null;
}

function freeBlocks(day=null,minPeriods=1){
  const out=[];
  for(let d=day||1;d<=(day||5);d++){
    const busy=new Set();
    courses().filter(c=>c.day===d).forEach(c=>{for(let p=c.start;p<=c.end;p++)busy.add(p)});
    let start=null;
    for(let p=1;p<=13;p++){
      if(!busy.has(p)&&start===null)start=p;
      if((busy.has(p)||p===13)&&start!==null){
        const end=busy.has(p)?p-1:p;
        if(end-start+1>=minPeriods)out.push({day:d,start,end});
        start=null;
      }
    }
  }
  return out;
}

function commonFree(friend,day=null){
  if(!friend)return[];
  const mine=courses(),theirs=Array.isArray(friend.courses)?friend.courses:[];
  const out=[];
  for(let d=day||1;d<=(day||5);d++){
    const busy=new Set();
    [...mine,...theirs].filter(c=>Number(c.day)===d).forEach(c=>{for(let p=Number(c.start);p<=Number(c.end);p++)busy.add(p)});
    let start=null;
    for(let p=1;p<=13;p++){
      if(!busy.has(p)&&start===null)start=p;
      if((busy.has(p)||p===13)&&start!==null){const end=busy.has(p)?p-1:p;if(end-start+1>=2)out.push({day:d,start,end});start=null}
    }
  }
  return out;
}

function parseDuration(text){
  let m=String(text).match(/(\d+(?:\.\d+)?)\s*小時/);if(m)return Math.max(30,Math.round(Number(m[1])*60));
  m=String(text).match(/(\d+)\s*分鐘/);if(m)return Math.max(20,Number(m[1]));
  m=String(text).match(/(\d+)\s*節/);if(m)return Math.max(1,Number(m[1]))*50;
  return 100;
}

function blockMinutes(b){return Math.max(50,toMin(endTime(b.end))-toMin(startTime(b.start)))}
function blockLabel(b){return`${dayName(b.day)} ${startTime(b.start)}–${endTime(b.end)}`}

function plan(text){
  const day=resolveDay(text),duration=parseDuration(text),course=resolveCourse(text);
  const subject=course?.name||((String(text).match(/(?:準備|複習|讀|寫|做)\s*([^，。,.！？!?]{2,16})/)||[])[1]||memory.plan?.subject||'要完成的事').trim();
  const evening=/晚上|傍晚/.test(text),avoidLate=/不要太晚|別太晚|早點/.test(text),split=/分段|拆開|分兩/.test(text);
  let blocks=freeBlocks(day,1);
  if(evening)blocks=blocks.filter(b=>toMin(startTime(b.start))>=17*60);
  if(avoidLate)blocks=blocks.filter(b=>toMin(endTime(b.end))<=20*60+45);
  blocks.sort((a,b)=>split?(a.day-b.day||a.start-b.start):(blockMinutes(b)-blockMinutes(a)||a.day-b.day));
  if(!blocks.length)return'目前課表裡找不到符合這些條件的空檔。可以換一天或把時間限制放寬一點。';
  let remain=duration;const picks=[];
  for(const b of blocks){if(remain<=0)break;const use=Math.min(remain,blockMinutes(b));picks.push({...b,use});remain-=use;if(!split&&picks.length>=3)break}
  memory.plan={day,subject,duration,evening,avoidLate,split};memory.day=day||memory.day;
  const lines=picks.map((b,i)=>`${i+1}. ${blockLabel(b)}｜${subject}，約 ${b.use} 分鐘`);
  return`我會先這樣排：\n${lines.join('\n')}${remain>0?`\n還差約 ${remain} 分鐘，可以再補一段課後時間。`:''}`;
}

function reply(text){
  const q=String(text||'').trim();if(!q)return'';
  if(memory.plan&&/改到|改成|換到|分兩段|分段|不要太晚/.test(q))return plan(`${memory.plan.subject} ${memory.plan.duration}分鐘 ${q}`);
  const day=resolveDay(q),course=resolveCourse(q);if(day)memory.day=day;
  if(/下一堂|下一節|等等上|現在上|正在上/.test(q)){
    const n=nextClass();if(!n)return'目前找不到下一堂課。';memory.courseId=n.course.id;memory.day=n.course.day;
    if(n.kind==='now')return`現在是「${n.course.name}」，約 ${n.minutes} 分鐘後下課${n.course.room?`，在 ${n.course.room}`:''}。`;
    if(n.kind==='next')return`下一堂是「${n.course.name}」，約 ${n.minutes} 分鐘後開始${n.course.room?`，在 ${n.course.room}`:''}。`;
    return`下一堂是${dayName(n.course.day)}的「${n.course.name}」，${startTime(n.course.start)} 開始${n.course.room?`，在 ${n.course.room}`:''}。`;
  }
  if(course&&/老師|誰教|教授|授課/.test(q))return`「${course.name}」的老師是 ${course.teacher||'課表沒有填老師'}。`;
  if(course&&/教室|哪裡|在哪|地點/.test(q))return course.room?`「${course.name}」在 ${course.room}。`:`「${course.name}」目前沒有填教室。`;
  if(course&&/幾點|時間|第幾節|什麼時候/.test(q))return`「${course.name}」是${dayName(course.day)}第 ${course.start}${course.end>course.start?`–${course.end}`:''} 節，${startTime(course.start)}–${endTime(course.end)}。`;
  if(day&&/(有什麼課|有哪些課|上什麼|幾堂|課表|課程|那呢|呢)/.test(q)){
    const list=courses().filter(c=>c.day===day).sort((a,b)=>a.start-b.start);
    if(!list.length)return`${dayName(day)}沒有排課。`;
    return`${dayName(day)}有 ${list.length} 門課：\n${list.map((c,i)=>`${i+1}. ${startTime(c.start)}–${endTime(c.end)}｜${c.name}${c.room?`｜${c.room}`:''}`).join('\n')}`;
  }
  if(/最忙|最累|哪天.*忙|哪天.*累/.test(q)){
    const load=DAYS.map((_,i)=>{const list=courses().filter(c=>c.day===i+1);return{day:i+1,count:list.length,periods:list.reduce((n,c)=>n+c.end-c.start+1,0)}}).sort((a,b)=>b.periods-a.periods||b.count-a.count)[0];
    return`${dayName(load.day)}課最多，共 ${load.count} 門、${load.periods} 節。`;
  }
  if(/共同空堂|跟.*(?:好友|朋友).*空|一起有空/.test(q)){
    const friend=app.getSelectedFriend?.();if(!friend)return'先到好友頁選一位朋友，我才能比較你們兩個的課表。';
    const blocks=commonFree(friend,day).slice(0,5);if(!blocks.length)return'目前沒有找到至少兩節連續的共同空堂。';
    return`你們比較好約的時間：\n${blocks.map((b,i)=>`${i+1}. ${blockLabel(b)}`).join('\n')}`;
  }
  if(/空堂|空檔|有空|自由時間/.test(q)){
    const blocks=freeBlocks(day,2).sort((a,b)=>blockMinutes(b)-blockMinutes(a)).slice(0,5);if(!blocks.length)return'目前沒有找到兩節以上的連續空堂。';
    return`${day?dayName(day):'這週'}比較長的空檔：\n${blocks.map((b,i)=>`${i+1}. ${blockLabel(b)}`).join('\n')}`;
  }
  if(/安排|規劃|排.*(?:讀書|作業|複習|準備)|\d+\s*(?:小時|分鐘|節)/.test(q))return plan(q);
  if(course)return`你問的是「${course.name}」嗎？我可以接著查老師、教室、時間，或幫你安排這門課的準備時間。`;
  if(memory.day)return`我還記得我們剛剛在看${dayName(memory.day)}。你可以接著問那天的課、空堂，或叫我排一段讀書時間。`;
  return'我可以直接讀你的課表。試著問「星期三有什麼課」、「下一堂在哪」，或「星期五幫我排兩小時讀書」。';
}

function bubble(role,text){
  const box=$('#aiMessages');if(!box)return;
  const div=document.createElement('div');div.className=`bubble ${role}`;div.textContent=text;box.append(div);box.scrollTop=box.scrollHeight;
}

async function send(){
  const input=$('#aiInput'),text=input?.value.trim();if(!text)return;
  input.value='';bubble('me',text);history.push({role:'user',text});
  const answer=reply(text);history.push({role:'assistant',text:answer});bubble('ai',answer);
}

$('#aiSend').onclick=send;
$('#aiInput').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}};
$('#aiLaunch').onclick=()=>{
  memory.advanced=!memory.advanced;
  $('#aiModeLabel').textContent=memory.advanced?'進階安排':'一般模式';
  $('#aiStatus').textContent=memory.advanced?'進階安排已開啟':'可直接使用';
  $('#aiLaunch').textContent=memory.advanced?'回到一般模式':'進階安排';
  app.toast(memory.advanced?'進階安排已開啟，可以一次給我多個條件':'已回到一般模式');
};

window.NOLU_PLANNER={ask:reply,history};
