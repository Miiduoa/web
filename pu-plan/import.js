const $=s=>document.querySelector(s);
const app=window.PUPLAN_APP;
const DAYS=app.DAYS, PERIODS=app.PERIODS;
const COLORS=['violet','orange','blue','pink','mint','gray','lime'];
let selectedFile=null, previewUrl='', drafts=[], scanBusy=false, ocrWorker=null, scanToken=0, autoScanTimer=null, workerWarmed=false, scanMeta={};

const clamp=(n,a,b)=>Math.min(b,Math.max(a,n));
const uid=()=>crypto.randomUUID?.()||`imp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const esc=s=>app.esc(String(s??''));
function setHidden(el,hidden){el?.classList.toggle('hidden',!!hidden)}
function setProgress(p,text){p=clamp(Number(p)||0,0,1);if($('#ocrBar'))$('#ocrBar').style.width=`${Math.round(p*100)}%`;if($('#ocrPercent'))$('#ocrPercent').textContent=`${Math.round(p*100)}%`;if(text&&$('#ocrStatus'))$('#ocrStatus').textContent=text}
function normalizeChineseSpaces(s=''){
  let x=String(s).replace(/[\r\n]+/g,' ').replace(/[｜|]/g,' / ').replace(/[（]/g,'(').replace(/[）]/g,')').replace(/\s+/g,' ').trim();
  for(let i=0;i<3;i++)x=x.replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g,'$1');
  return x.replace(/\s*\/\s*/g,' / ').trim();
}
function buildingRoom(text=''){
  const t=normalizeChineseSpaces(text);
  const re=/((?:主顧|伯鐸|任垣|文興|思源|方濟|格倫|至善|靜安|計中|圖書館|體育館|宜園|司鐸|主顧|任垣)[^/，,;；]{0,22}?(?:\d{2,4}|[A-Z]\d{2,4})(?:\([^)]{1,14}\))?)/i;
  const m=t.match(re);if(m)return m[1].trim();
  const code=t.match(/([^/，,;；]{0,15}(?:\([A-Z\u4e00-\u9fff]{1,5}[-A-Z0-9]*\d{2,4}\)|[A-Z]{1,4}\d{2,4}))/i);return code?code[1].trim():'';
}
function parseCellText(lines){
  const rawLines=lines.map(l=>normalizeChineseSpaces(l.text)).filter(Boolean);
  let full=normalizeChineseSpaces(rawLines.join(' '));
  full=full.replace(/\b(?:第?\d{1,2}節|\d{1,2}:\d{2}\s*[-–~]\s*\d{1,2}:\d{2})\b/g,'').trim();
  let room=buildingRoom(full), remain=room?normalizeChineseSpaces(full.replace(room,' ')):full;
  let name='',teacher='';
  const slash=remain.split(/\s*[\/／]\s*/).map(x=>x.trim()).filter(Boolean);
  if(slash.length>=2){name=slash.shift();teacher=normalizeChineseSpaces(slash.join(' '));}
  else{
    const short=rawLines.slice().reverse().find(x=>/^[\u3400-\u9fff·]{2,5}$/.test(x)&&!/(大學|課表|星期|節次|資管)/.test(x));
    if(short&&remain.endsWith(short)){teacher=short;name=remain.slice(0,-short.length).trim()}else name=remain;
  }
  teacher=teacher.replace(room,'').replace(/^(老師|教師)[:：]?/,'').trim();
  name=name.replace(/^\d+[.、]?\s*/,'').replace(/^(課程名稱|科目)[:：]?/,'').trim();
  if(!name&&rawLines.length)name=rawLines[0];
  return {name:name.slice(0,100)||'未命名課程',teacher:teacher.slice(0,50),room:room.slice(0,80),raw:full};
}
function clusterPositions(values){
  const out=[];if(!values.length)return out;let s=values[0],e=values[0];for(const v of values.slice(1)){if(v<=e+2)e=v;else{out.push((s+e)/2);s=e=v}}out.push((s+e)/2);return out;
}
function detectPuGrid(canvas){
  const ctx=canvas.getContext('2d',{willReadFrequently:true}),w=canvas.width,h=canvas.height,img=ctx.getImageData(0,0,w,h).data;
  const isDark=(x,y)=>{const i=(y*w+x)*4;return (img[i]*.299+img[i+1]*.587+img[i+2]*.114)<190};
  const rowScores=new Float32Array(h);const sx=Math.max(1,Math.floor(w/900));
  for(let y=0;y<h;y++){let n=0,total=0;for(let x=0;x<w;x+=sx){total++;if(isDark(x,y))n++}rowScores[y]=n/total}
  const candidateRows=[];for(let y=Math.floor(h*.06);y<Math.floor(h*.82);y++)if(rowScores[y]>.42)candidateRows.push(y);
  const rows=clusterPositions(candidateRows);let best=null;
  for(let i=0;i<rows.length;i++)for(let j=i+1;j<Math.min(rows.length,i+5);j++){
    const d=rows[j]-rows[i];if(d<34||d>120)continue;let score=0;for(let k=0;k<=15;k++){const want=rows[i]+k*d;if(rows.some(r=>Math.abs(r-want)<Math.max(4,d*.12)))score++}
    if(score>=9&&(!best||score>best.score))best={top:rows[i],rowH:d,score};
  }
  if(!best)return null;
  const top=best.top,rowH=best.rowH,bottom=Math.min(h-1,top+rowH*15);
  const colScores=new Float32Array(w),sy=Math.max(1,Math.floor((bottom-top)/850));
  for(let x=0;x<w;x++){let n=0,total=0;for(let y=Math.max(0,Math.floor(top));y<Math.min(h,Math.ceil(bottom));y+=sy){total++;if(isDark(x,y))n++}colScores[x]=n/total}
  const candidateCols=[];for(let x=0;x<w;x++)if(colScores[x]>.55)candidateCols.push(x);const cols=clusterPositions(candidateCols);
  if(cols.length<7)return null;
  let xlines=null,bestScore=Infinity;
  for(let i=0;i<=cols.length-9;i++){const g=cols.slice(i,i+9),ds=g.slice(1).map((x,k)=>x-g[k]),mean=ds.reduce((a,b)=>a+b,0)/ds.length,variance=ds.reduce((a,b)=>a+(b-mean)**2,0)/ds.length,cv=Math.sqrt(variance)/mean;if(mean>35&&mean<w*.25&&cv<bestScore){bestScore=cv;xlines=g}}
  if(!xlines&&cols.length>=9)xlines=cols.slice(0,9);if(!xlines)return null;
  function strength(day,boundaryY){const x0=Math.floor(xlines[day]+4),x1=Math.floor(xlines[day+1]-4),yy=Math.round(boundaryY);let n=0,total=0;for(let y=yy-2;y<=yy+2;y++)for(let x=x0;x<=x1;x+=2){if(y>=0&&y<h&&x>=0&&x<w){total++;if(isDark(x,y))n++}}return total?n/total:1}
  return {top,rowH,bottom,xlines,strength,score:best.score};
}
function visualToPeriod(r){if(r>=1&&r<=4)return r;if(r>=6&&r<=14)return r-1;return null}
function spanForY(grid,day,y){let r=clamp(Math.floor((y-grid.top)/grid.rowH),1,14);if(r===5)r=y<grid.top+5.5*grid.rowH?4:6;let a=r,b=r;
  while(a>1&&a!==6){const boundary=grid.top+a*grid.rowH;if(grid.strength(day,boundary)<.28)a--;else break}
  while(b<14&&b!==4){const boundary=grid.top+(b+1)*grid.rowH;if(grid.strength(day,boundary)<.28)b++;else break}
  const start=visualToPeriod(a),end=visualToPeriod(b);return start&&end?{start,end}:null;
}
function flattenLines(blocks=[],offsetX=0,offsetY=0){const out=[];for(const block of blocks||[])for(const p of block.paragraphs||[])for(const line of p.lines||[]){if(!line?.text?.trim()||!line.bbox)continue;out.push({text:line.text.trim(),confidence:Number(line.confidence??block.confidence??75),bbox:{x0:line.bbox.x0+offsetX,y0:line.bbox.y0+offsetY,x1:line.bbox.x1+offsetX,y1:line.bbox.y1+offsetY}})}return out}
function parsePuSchedule(lines,grid,fullText=''){
  const groups=new Map();
  for(const l of lines){const cx=(l.bbox.x0+l.bbox.x1)/2,cy=(l.bbox.y0+l.bbox.y1)/2;if(cy<grid.top+grid.rowH||cy>grid.bottom)continue;let day=0;for(let d=1;d<=5;d++)if(cx>grid.xlines[d]&&cx<grid.xlines[d+1]){day=d;break}if(!day)continue;const span=spanForY(grid,day,cy);if(!span)continue;const key=`${day}-${span.start}-${span.end}`;if(!groups.has(key))groups.set(key,{day,...span,lines:[]});groups.get(key).lines.push(l)}
  const courses=[];for(const g of groups.values()){g.lines.sort((a,b)=>a.bbox.y0-b.bbox.y0||a.bbox.x0-b.bbox.x0);const parsed=parseCellText(g.lines);if(!parsed.name||/^(一|二|三|四|五|六|日|節次)$/.test(parsed.name))continue;const conf=Math.round(g.lines.reduce((n,l)=>n+l.confidence,0)/g.lines.length);courses.push({id:uid(),name:parsed.name,day:g.day,start:g.start,end:g.end,teacher:parsed.teacher,room:parsed.room,color:COLORS[(g.day*2+g.start)%COLORS.length],confidence:conf,raw:parsed.raw})}
  courses.sort((a,b)=>a.day-b.day||a.start-b.start);
  const text=normalizeChineseSpaces(fullText);if(/專案實作\s*\(?\s*(?:二|2)\s*\)?/.test(text)&&!courses.some(c=>/專案實作/.test(c.name))){const code=(text.match(/(?:^|\s)(1\d{3,4})\s+[^\n]{0,25}專案實作/)||[])[1]||'';courses.push({id:uid(),name:'專案實作(二)',day:0,start:0,end:0,teacher:code?`課號 ${code}`:'',room:'時間地點依最新公告',color:'lime',confidence:85,raw:'偵測到無固定時段課程'})}
  return courses.filter(c=>!/^(節次|午|注意|學期總學分)/.test(c.name));
}
function genericFallback(text){
  const out=[];const dayMap={'一':1,'二':2,'三':3,'四':4,'五':5};for(const raw of String(text||'').split(/\n+/)){const line=normalizeChineseSpaces(raw);const dm=line.match(/星期([一二三四五])/),tm=line.match(/(\d{1,2}):(\d{2})\s*[-–~]\s*(\d{1,2}):(\d{2})/);if(!dm||!tm)continue;const startMin=+tm[1]*60+(+tm[2]),endMin=+tm[3]*60+(+tm[4]);let start=PERIODS.findIndex(p=>{const [h,m]=p[0].split(':').map(Number);return h*60+m===startMin})+1,end=PERIODS.findIndex(p=>{const [h,m]=p[1].split(':').map(Number);return h*60+m===endMin})+1;if(!start||!end)continue;let name=line.replace(dm[0],'').replace(tm[0],'').trim();if(name)out.push({id:uid(),name,day:dayMap[dm[1]],start,end,teacher:'',room:'',color:COLORS[out.length%COLORS.length],confidence:55,raw:line})}return out;
}

function normalizeCourseName(s=''){return normalizeChineseSpaces(s).toLowerCase().replace(/[（(].*?[）)]/g,m=>m).replace(/\s+/g,'').replace(/[・·]/g,'')}
function parseScheduleMetadata(text=''){
  const raw=String(text||'').replace(/\r/g,'');
  const flat=normalizeChineseSpaces(raw);
  const school=(flat.match(/([\u3400-\u9fff]{2,12}(?:大學|學院))/)||[])[1]||'';
  const ym=flat.match(/(\d{2,3})\s*學年度[^\n]{0,24}?第\s*([12一二])\s*學期/);
  const year=ym?.[1]||''; const semester=ym?.[2]?({'一':'1','二':'2'}[ym[2]]||ym[2]):'';
  let className='';
  const classPatterns=[/(?:系級|班級|班別)\s*[:：]?\s*([\u3400-\u9fffA-Za-z0-9_-]{2,20})/,/(資管|資科|資工|企管|會計|財金|外文|西文|中文|法律|社工|觀光|化科|食營|應化|大傳)[一二三四1234][A-Za-z]?/];
  for(const r of classPatterns){const m=flat.match(r);if(m){className=m[1]&&m[0].includes(':')?m[1]:m[0].replace(/^(系級|班級|班別)\s*[:：]?\s*/,'');break}}
  const cm=flat.match(/(?:學期總學分|總學分|本學期學分)\s*[:：]?\s*(\d+(?:\.\d+)?)/); const credits=cm?.[1]||'';
  const title=[year?`${year} 學年度`:'',semester?`第 ${semester} 學期`:''].filter(Boolean).join('・');
  return {school,year,semester,className,credits,title};
}
function sameCourse(a,b){return a&&b&&a.day===b.day&&a.start===b.start&&a.end===b.end&&normalizeCourseName(a.name)===normalizeCourseName(b.name)}
function overlaps(a,b){return a&&b&&a.day>0&&a.day===b.day&&!(a.end<b.start||a.start>b.end)}
function analyzeDrafts(){
  const current=app.courses();const mode=document.querySelector('input[name="importMode"]:checked')?.value||'replace';
  drafts.forEach((c,i)=>{
    if(typeof c.selected!=='boolean')c.selected=true;
    const flags=[];
    if((c.confidence||0)<65)flags.push({type:'low',label:'需確認'});
    if(mode==='merge'&&current.some(x=>sameCourse(c,x)))flags.push({type:'duplicate',label:'已有相同課'});
    else if(mode==='merge'&&current.some(x=>overlaps(c,x)))flags.push({type:'conflict',label:'與現有課衝堂'});
    const earlier=drafts.slice(0,i);
    if(earlier.some(x=>sameCourse(c,x)))flags.push({type:'duplicate',label:'圖片內重複'});
    else if(earlier.some(x=>overlaps(c,x)))flags.push({type:'conflict',label:'圖片內衝堂'});
    c.flags=flags;
  });
}
function selectedDrafts(){return drafts.filter(c=>c.selected!==false&&c.name?.trim())}
function projectedSchedule(){
  const chosen=selectedDrafts().map(c=>({...c,name:c.name.trim()}));
  const mode=document.querySelector('input[name="importMode"]:checked')?.value||'replace';
  if(mode==='replace')return chosen;
  const current=app.courses();const seen=new Set(current.map(c=>`${c.day}|${c.start}|${c.end}|${normalizeCourseName(c.name)}`));
  return [...current,...chosen.filter(c=>!seen.has(`${c.day}|${c.start}|${c.end}|${normalizeCourseName(c.name)}`))];
}
function renderMetadata(){
  const box=$('#importMetadata');if(!box)return;
  const items=[];
  if(scanMeta.school)items.push(['學校',scanMeta.school]);
  if(scanMeta.title)items.push(['學期',scanMeta.title]);
  if(scanMeta.className)items.push(['系級',scanMeta.className]);
  if(scanMeta.credits)items.push(['學分',`${scanMeta.credits} 學分`]);
  box.innerHTML=items.length?items.map(([k,v])=>`<div><small>${k}</small><b>${esc(v)}</b></div>`).join(''):`<div class="metadata-empty"><small>METADATA</small><b>沒有可靠辨識到學期資訊</b></div>`;
}
function renderWeekPreview(){
  const box=$('#importWeekPreview');if(!box)return;
  const all=projectedSchedule();const scheduled=all.filter(c=>c.day>=1&&c.day<=5);
  if($('#importPreviewCount'))$('#importPreviewCount').textContent=`${selectedDrafts().length} 門將匯入 · 預覽共 ${all.length} 門`;
  box.innerHTML=DAYS.map((d,i)=>{const cs=scheduled.filter(c=>c.day===i+1).sort((a,b)=>a.start-b.start);return `<section class="preview-day"><header><b>${d[1]}</b><span>${cs.length}</span></header><div>${cs.length?cs.map(c=>`<article class="preview-course ${c.color||'gray'}"><time>${PERIODS[c.start-1]?.[0]||''}</time><b>${esc(c.name)}</b><small>${esc(c.room||'')}</small></article>`).join(''):'<em>FREE</em>'}</div></section>`}).join('');
}
function renderImportOverview(){analyzeDrafts();renderMetadata();renderWeekPreview();updateResultHeader()}
function renderDrafts(){
  analyzeDrafts();
  const list=$('#recognizedList');if(!list)return;const dayOpts=['未排定','星期一','星期二','星期三','星期四','星期五'];const periodOpts=['—',...PERIODS.map((p,i)=>`第 ${i+1} 節 ${p[0]}`)];
  list.innerHTML=drafts.length?drafts.map((c,i)=>{const flags=(c.flags||[]).map(f=>`<span class="draft-flag ${f.type}">${esc(f.label)}</span>`).join('');return `<article class="recognized-card ${c.confidence<65?'needs-check':''} ${c.selected===false?'draft-off':''}" data-draft="${i}"><div class="recognized-top"><label class="draft-check"><input type="checkbox" data-select-draft="${i}" ${c.selected===false?'':'checked'}><span></span></label><span class="recognized-num">${String(i+1).padStart(2,'0')}</span><span class="confidence-mini ${c.confidence>=80?'good':c.confidence>=65?'mid':'low'}">${Math.round(c.confidence||0)}%</span><div class="draft-flags">${flags}</div><button class="recognized-remove" type="button" data-remove-draft="${i}">×</button></div><label>課程名稱<input class="field" data-draft-field="name" value="${esc(c.name)}"></label><div class="recognized-row"><label>星期<select class="field" data-draft-field="day">${dayOpts.map((x,d)=>`<option value="${d}" ${c.day===d?'selected':''}>${x}</option>`).join('')}</select></label><label>開始<select class="field" data-draft-field="start" ${c.day===0?'disabled':''}>${periodOpts.map((x,p)=>`<option value="${p}" ${c.start===p?'selected':''}>${x}</option>`).join('')}</select></label><label>結束<select class="field" data-draft-field="end" ${c.day===0?'disabled':''}>${periodOpts.map((x,p)=>`<option value="${p}" ${c.end===p?'selected':''}>${x}</option>`).join('')}</select></label></div><div class="recognized-row two"><label>老師<input class="field" data-draft-field="teacher" value="${esc(c.teacher)}"></label><label>教室<input class="field" data-draft-field="room" value="${esc(c.room)}"></label></div>${c.raw?`<details><summary>OCR 原文</summary><small>${esc(c.raw)}</small></details>`:''}</article>`}).join(''):'<div class="import-empty"><b>沒有抓到可匯入的課程。</b><span>可以換一張更清楚、完整包含課表格線的截圖。</span></div>';
  list.querySelectorAll('[data-draft]').forEach(card=>{const i=+card.dataset.draft;card.querySelectorAll('[data-draft-field]').forEach(el=>el.onchange=el.oninput=()=>{const k=el.dataset.draftField;drafts[i][k]=['day','start','end'].includes(k)?+el.value:el.value;if(k==='day'){if(+el.value===0){drafts[i].start=0;drafts[i].end=0}else if(!drafts[i].start){drafts[i].start=1;drafts[i].end=1}renderDrafts();return}renderImportOverview()})});
  list.querySelectorAll('[data-select-draft]').forEach(b=>b.onchange=()=>{drafts[+b.dataset.selectDraft].selected=b.checked;renderDrafts()});
  list.querySelectorAll('[data-remove-draft]').forEach(b=>b.onclick=()=>{drafts.splice(+b.dataset.removeDraft,1);renderDrafts()});
  renderImportOverview();
}
function updateResultHeader(){
  const chosen=selectedDrafts();const avg=chosen.length?Math.round(chosen.reduce((n,c)=>n+(c.confidence||0),0)/chosen.length):0;
  const high=chosen.filter(c=>(c.confidence||0)>=80).length, mid=chosen.filter(c=>(c.confidence||0)>=65&&(c.confidence||0)<80).length, low=chosen.filter(c=>(c.confidence||0)<65).length;
  const duplicates=chosen.filter(c=>(c.flags||[]).some(f=>f.type==='duplicate')).length, conflicts=chosen.filter(c=>(c.flags||[]).some(f=>f.type==='conflict')).length;
  if($('#importConfidence'))$('#importConfidence').textContent=chosen.length?`${chosen.length}/${drafts.length} 門 · 平均 ${avg}%`:'0 門';
  if($('#importSummary'))$('#importSummary').innerHTML=chosen.length?`<b>準備匯入 ${chosen.length} 門課</b><span>${high} 門高信心${mid?` · ${mid} 門中等`:''}${low?` · ${low} 門低信心`:''}</span>`:'<b>目前沒有選課</b><span>勾選至少一門課再匯入</span>';
  if($('#confirmImport')){$('#confirmImport').textContent=`確認匯入 ${chosen.length} 門`;$('#confirmImport').disabled=!chosen.length}
  let warnings=[];if(duplicates)warnings.push(`${duplicates} 門疑似重複`);if(conflicts)warnings.push(`${conflicts} 門有衝堂`);if(low)warnings.push(`${low} 門低信心`);
  if($('#importWarning'))$('#importWarning').innerHTML=warnings.length?`<b>匯入前建議確認：</b> ${warnings.join('、')}。系統不會偷偷刪課，最後決定仍由你勾選。`:'<b>看起來很乾淨。</b> 沒有偵測到重複、衝堂或低信心課程。';
}
async function canvasFromFile(file){const url=URL.createObjectURL(file);try{const img=new Image();img.src=url;await img.decode();let scale=img.naturalWidth<1400?Math.min(2,1500/img.naturalWidth):Math.min(1,1800/img.naturalWidth);const c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.naturalWidth*scale));c.height=Math.max(1,Math.round(img.naturalHeight*scale));const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);return c}finally{URL.revokeObjectURL(url)}}
async function ensureWorker(){if(ocrWorker)return ocrWorker;if(!window.Tesseract)throw new Error('OCR 模組載入失敗，請重新整理頁面');ocrWorker=await Tesseract.createWorker(['eng','chi_tra'],1,{logger:m=>{if(m.status==='recognizing text')setProgress(.30+.65*(m.progress||0),'正在讀取課表文字');else if(/loading|initializing/.test(m.status||''))setProgress(.08+.20*(m.progress||0),'第一次載入繁中辨識模型')}});try{await ocrWorker.setParameters({tessedit_pageseg_mode:Tesseract.PSM.SPARSE_TEXT,preserve_interword_spaces:'1'})}catch{}workerWarmed=true;return ocrWorker}
async function warmWorker(){
  if(workerWarmed||ocrWorker||navigator.connection?.saveData)return;
  try{
    setHidden($('#ocrProgress'),false);
    setProgress(.03,'正在預載辨識模型');
    await ensureWorker();
    if(!selectedFile){setProgress(0,'模型已就緒，選圖片後會自動辨識');setHidden($('#ocrProgress'),true)}
  }catch(err){console.warn('OCR warmup skipped',err)}
}
async function scan(token=scanToken){
  if(!selectedFile||scanBusy||token!==scanToken)return;
  const file=selectedFile;
  scanBusy=true;
  $('#startOcr').disabled=true;
  $('#startOcr').textContent='辨識中…';
  setHidden($('#ocrProgress'),false);
  setHidden($('#importEmpty'),true);
  setHidden($('#importResults'),true);
  setProgress(.02,'正在分析圖片格線');
  try{
    const canvas=await canvasFromFile(file);
    if(token!==scanToken)return;
    const grid=detectPuGrid(canvas);
    setProgress(.08,grid?'找到課表格線，開始讀文字':'沒有辨識到標準格線，改用文字模式');
    const worker=await ensureWorker();
    if(token!==scanToken)return;
    let target=canvas,ox=0,oy=0;
    if(grid){
      const left=Math.max(0,Math.floor(grid.xlines[0]-4)),top=Math.max(0,Math.floor(grid.top-4)),right=Math.min(canvas.width,Math.ceil(grid.xlines[8]+4)),bottom=Math.min(canvas.height,Math.ceil(grid.top+grid.rowH*18));
      const crop=document.createElement('canvas');crop.width=right-left;crop.height=bottom-top;crop.getContext('2d').drawImage(canvas,left,top,crop.width,crop.height,0,0,crop.width,crop.height);target=crop;ox=left;oy=top;
    }
    const ret=await worker.recognize(target,{}, {text:true,blocks:true});
    if(token!==scanToken)return;
    setProgress(.97,'正在整理課程');
    const lines=flattenLines(ret.data.blocks,ox,oy);
    drafts=grid?parsePuSchedule(lines,grid,ret.data.text):genericFallback(ret.data.text);scanMeta=parseScheduleMetadata(ret.data.text||'');drafts.forEach(c=>c.selected=true);
    const looksPu=/靜宜大學|第\s*1\s*學期課表|學期總學分/.test(ret.data.text||'');
    if(grid&&looksPu)drafts.forEach(c=>c.confidence=Math.min(99,(c.confidence||70)+5));
    setProgress(1,'辨識完成');
    renderDrafts();
    setHidden($('#importResults'),false);
    setHidden($('#ocrProgress'),false);
    $('#ocrHint').textContent=grid?(looksPu?'已套用「靜宜大學課表」專用格線解析，再用繁中 OCR 讀文字。':'已偵測到規則課表格線並完成文字辨識。'):'這張圖片不是標準格狀課表，因此只做文字模式辨識；建議逐門確認。';
    const low=drafts.filter(c=>(c.confidence||0)<65).length;
    if(drafts.length)app.toast(low?`找到 ${drafts.length} 門課，${low} 門需要確認`:`找到 ${drafts.length} 門課 ✓`);
  }catch(err){
    if(token!==scanToken)return;
    console.error(err);app.toast(err.message||'辨識失敗');$('#ocrStatus').textContent='辨識失敗';$('#ocrHint').textContent='請換一張更清楚的原始截圖，或確認網路能載入 OCR 模型。';
  }finally{
    scanBusy=false;
    $('#startOcr').disabled=false;
    $('#startOcr').textContent='重新辨識';
    if(token!==scanToken&&selectedFile)setTimeout(()=>scan(scanToken),60);
  }
}
function scheduleAutoScan(){
  clearTimeout(autoScanTimer);
  const token=scanToken;
  autoScanTimer=setTimeout(()=>scan(token),180);
}
function selectFile(file){
  if(!file)return;
  if(!file.type.startsWith('image/'))return app.toast('請選擇圖片檔');
  if(file.size>18*1024*1024)return app.toast('圖片太大，請選 18MB 以下');
  selectedFile=file;drafts=[];scanMeta={};scanToken++;
  if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(file);$('#importPreview').src=previewUrl;
  setHidden($('#importDrop'),true);setHidden($('#importPreviewWrap'),false);setHidden($('#startOcr'),false);setHidden($('#ocrProgress'),false);setHidden($('#importResults'),true);setHidden($('#importEmpty'),false);
  $('#startOcr').textContent='重新辨識';
  $('#importEmpty').innerHTML='<b>圖片已收到，正在自動辨識。</b><span>會先找課表格線，再讀課名、老師與教室；完成後才讓你確認匯入。</span>';
  setProgress(.01,'圖片已收到，準備自動辨識');
  scheduleAutoScan();
}
function resetImport(){
  clearTimeout(autoScanTimer);scanToken++;selectedFile=null;drafts=[];scanMeta={};
  if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl='';
  $('#scheduleImageInput').value='';
  setHidden($('#importDrop'),false);setHidden($('#importPreviewWrap'),true);setHidden($('#startOcr'),true);setHidden($('#ocrProgress'),true);setHidden($('#importResults'),true);setHidden($('#importEmpty'),false);
  $('#importEmpty').innerHTML='<b>把課表截圖丟進來就好。</b><span>選圖、拖曳或貼上圖片後會自動辨識；不會直接覆蓋課表。</span>';
  setProgress(0,'準備辨識');
}
function pickClipboardImage(e){
  const item=[...(e.clipboardData?.items||[])].find(x=>x.type?.startsWith('image/'));
  if(item){e.preventDefault();const file=item.getAsFile();if(file)selectFile(file)}
}
function handleDrop(e){
  e.preventDefault();$('#importDrop')?.classList.remove('dragging');
  const file=[...(e.dataTransfer?.files||[])].find(f=>f.type.startsWith('image/'));if(file)selectFile(file);
}
function confirmImport(){
  const valid=selectedDrafts().map(c=>{let day=+c.day,start=+c.start,end=+c.end;if(day===0){start=0;end=0}else{start=clamp(start||1,1,13);end=clamp(end||start,start,13)}return{id:c.id||uid(),name:c.name.trim(),day,start,end,teacher:(c.teacher||'').trim(),room:(c.room||'').trim(),color:c.color||COLORS[Math.floor(Math.random()*COLORS.length)]}});
  if(!valid.length)return app.toast('請至少勾選一門課');
  const mode=document.querySelector('input[name="importMode"]:checked')?.value||'replace';let next=valid;
  if(mode==='merge'){const current=app.courses();const seen=new Set(current.map(c=>`${c.day}|${c.start}|${c.end}|${normalizeCourseName(c.name)}`));next=[...current,...valid.filter(c=>!seen.has(`${c.day}|${c.start}|${c.end}|${normalizeCourseName(c.name)}`))]}
  app.setCoursesFromUser(next);if(app.setScheduleMetaFromUser)app.setScheduleMetaFromUser(scanMeta);$('#importDialog').close();app.toast(`已匯入 ${valid.length} 門課 ✓`);resetImport();
}

$('#scheduleImageInput')?.addEventListener('change',e=>selectFile(e.target.files?.[0]));
$('#importDrop')?.addEventListener('click',()=>$('#scheduleImageInput')?.click());
$('#importDrop')?.addEventListener('dragover',e=>{e.preventDefault();$('#importDrop')?.classList.add('dragging')});
$('#importDrop')?.addEventListener('dragleave',()=>$('#importDrop')?.classList.remove('dragging'));
$('#importDrop')?.addEventListener('drop',handleDrop);
$('#changeImportImage')?.addEventListener('click',()=>$('#scheduleImageInput')?.click());
$('#startOcr')?.addEventListener('click',()=>scan(scanToken));
$('#confirmImport')?.addEventListener('click',confirmImport);
$('#selectAllDrafts')?.addEventListener('click',()=>{drafts.forEach(c=>c.selected=true);renderDrafts()});
$('#clearDrafts')?.addEventListener('click',()=>{drafts.forEach(c=>c.selected=false);renderDrafts()});
document.querySelectorAll('input[name="importMode"]').forEach(r=>r.addEventListener('change',()=>renderDrafts()));
$('#cancelImport')?.addEventListener('click',()=>$('#importDialog')?.close());
$('#importDialog')?.addEventListener('paste',pickClipboardImage);
$('#importDialog')?.addEventListener('close',()=>{if(!scanBusy)resetImport()});
document.addEventListener('puplan:import-opened',()=>setTimeout(warmWorker,80));
