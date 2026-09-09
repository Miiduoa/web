const $=s=>document.querySelector(s);
const app=window.PUPLAN_APP;
const DAYS=app.DAYS, PERIODS=app.PERIODS;
const COLORS=['violet','orange','blue','pink','mint','gray','lime'];
let selectedFile=null, previewUrl='', drafts=[], scanBusy=false, ocrWorker=null;

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
function renderDrafts(){
  const list=$('#recognizedList');if(!list)return;const dayOpts=['未排定','星期一','星期二','星期三','星期四','星期五'];const periodOpts=['—',...PERIODS.map((p,i)=>`第 ${i+1} 節 ${p[0]}`)];
  list.innerHTML=drafts.length?drafts.map((c,i)=>`<article class="recognized-card ${c.confidence<65?'needs-check':''}" data-draft="${i}"><div class="recognized-top"><span class="recognized-num">${String(i+1).padStart(2,'0')}</span><span class="confidence-mini ${c.confidence>=80?'good':c.confidence>=65?'mid':'low'}">${Math.round(c.confidence||0)}%</span><button class="recognized-remove" type="button" data-remove-draft="${i}">×</button></div><label>課程名稱<input class="field" data-draft-field="name" value="${esc(c.name)}"></label><div class="recognized-row"><label>星期<select class="field" data-draft-field="day">${dayOpts.map((x,d)=>`<option value="${d}" ${c.day===d?'selected':''}>${x}</option>`).join('')}</select></label><label>開始<select class="field" data-draft-field="start" ${c.day===0?'disabled':''}>${periodOpts.map((x,p)=>`<option value="${p}" ${c.start===p?'selected':''}>${x}</option>`).join('')}</select></label><label>結束<select class="field" data-draft-field="end" ${c.day===0?'disabled':''}>${periodOpts.map((x,p)=>`<option value="${p}" ${c.end===p?'selected':''}>${x}</option>`).join('')}</select></label></div><div class="recognized-row two"><label>老師<input class="field" data-draft-field="teacher" value="${esc(c.teacher)}"></label><label>教室<input class="field" data-draft-field="room" value="${esc(c.room)}"></label></div>${c.raw?`<details><summary>OCR 原文</summary><small>${esc(c.raw)}</small></details>`:''}</article>`).join(''):'<div class="import-empty"><b>沒有抓到可匯入的課程。</b><span>可以換一張更清楚、完整包含課表格線的截圖。</span></div>';
  list.querySelectorAll('[data-draft]').forEach(card=>{const i=+card.dataset.draft;card.querySelectorAll('[data-draft-field]').forEach(el=>el.onchange=el.oninput=()=>{const k=el.dataset.draftField;drafts[i][k]=['day','start','end'].includes(k)?+el.value:el.value;if(k==='day'){if(+el.value===0){drafts[i].start=0;drafts[i].end=0}else if(!drafts[i].start){drafts[i].start=1;drafts[i].end=1}renderDrafts()}})});list.querySelectorAll('[data-remove-draft]').forEach(b=>b.onclick=()=>{drafts.splice(+b.dataset.removeDraft,1);renderDrafts();updateResultHeader()});
  updateResultHeader();
}
function updateResultHeader(){const avg=drafts.length?Math.round(drafts.reduce((n,c)=>n+(c.confidence||0),0)/drafts.length):0;if($('#importConfidence'))$('#importConfidence').textContent=drafts.length?`${drafts.length} 門 · 平均 ${avg}%`:'0 門';if($('#confirmImport'))$('#confirmImport').textContent=`確認匯入 ${drafts.length} 門`;if($('#importWarning'))$('#importWarning').innerHTML=drafts.some(c=>c.confidence<65)?'<b>有幾門需要你看一下。</b> 紅框代表 OCR 信心較低，確認名稱、老師與教室再匯入。':'<b>已先幫你整理成課程。</b> 匯入前仍建議快速掃一眼，避免截圖模糊造成誤字。'}
async function canvasFromFile(file){const url=URL.createObjectURL(file);try{const img=new Image();img.src=url;await img.decode();let scale=img.naturalWidth<1400?Math.min(2,1500/img.naturalWidth):Math.min(1,1800/img.naturalWidth);const c=document.createElement('canvas');c.width=Math.max(1,Math.round(img.naturalWidth*scale));c.height=Math.max(1,Math.round(img.naturalHeight*scale));const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);return c}finally{URL.revokeObjectURL(url)}}
async function ensureWorker(){if(ocrWorker)return ocrWorker;if(!window.Tesseract)throw new Error('OCR 模組載入失敗，請重新整理頁面');ocrWorker=await Tesseract.createWorker(['eng','chi_tra'],1,{logger:m=>{if(m.status==='recognizing text')setProgress(.30+.65*(m.progress||0),'正在讀取課表文字');else if(/loading|initializing/.test(m.status||''))setProgress(.08+.20*(m.progress||0),'第一次載入繁中辨識模型')}});try{await ocrWorker.setParameters({tessedit_pageseg_mode:Tesseract.PSM.SPARSE_TEXT,preserve_interword_spaces:'1'})}catch{}return ocrWorker}
async function scan(){
  if(!selectedFile||scanBusy)return;scanBusy=true;$('#startOcr').disabled=true;setHidden($('#ocrProgress'),false);setHidden($('#importEmpty'),true);setHidden($('#importResults'),true);setProgress(.02,'正在分析圖片格線');
  try{
    const canvas=await canvasFromFile(selectedFile);const grid=detectPuGrid(canvas);setProgress(.08,grid?'找到課表格線，開始 OCR':'沒有辨識到標準格線，改用文字模式');const worker=await ensureWorker();let target=canvas,ox=0,oy=0;
    if(grid){const left=Math.max(0,Math.floor(grid.xlines[0]-4)),top=Math.max(0,Math.floor(grid.top-4)),right=Math.min(canvas.width,Math.ceil(grid.xlines[8]+4)),bottom=Math.min(canvas.height,Math.ceil(grid.top+grid.rowH*18));const crop=document.createElement('canvas');crop.width=right-left;crop.height=bottom-top;crop.getContext('2d').drawImage(canvas,left,top,crop.width,crop.height,0,0,crop.width,crop.height);target=crop;ox=left;oy=top}
    const ret=await worker.recognize(target,{}, {text:true,blocks:true});setProgress(.97,'正在整理課程');const lines=flattenLines(ret.data.blocks,ox,oy);drafts=grid?parsePuSchedule(lines,grid,ret.data.text):genericFallback(ret.data.text);const looksPu=/靜宜大學|第\s*1\s*學期課表|學期總學分/.test(ret.data.text||'');if(grid&&looksPu)drafts.forEach(c=>c.confidence=Math.min(99,(c.confidence||70)+5));setProgress(1,'辨識完成');renderDrafts();setHidden($('#importResults'),false);setHidden($('#ocrProgress'),false);$('#ocrHint').textContent=grid?(looksPu?'已套用「靜宜大學課表」專用格線解析，再用繁中 OCR 讀文字。':'已偵測到規則課表格線並完成文字辨識。'):'這張圖片不是標準格狀課表，因此只做文字模式辨識；建議逐門確認。';
  }catch(err){console.error(err);app.toast(err.message||'辨識失敗');$('#ocrStatus').textContent='辨識失敗';$('#ocrHint').textContent='請換一張更清楚的原始截圖，或確認網路能載入 OCR 模型。'}finally{scanBusy=false;$('#startOcr').disabled=false}
}
function selectFile(file){if(!file)return;if(!file.type.startsWith('image/'))return app.toast('請選擇圖片檔');if(file.size>18*1024*1024)return app.toast('圖片太大，請選 18MB 以下');selectedFile=file;drafts=[];if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(file);$('#importPreview').src=previewUrl;setHidden($('#importDrop'),true);setHidden($('#importPreviewWrap'),false);setHidden($('#startOcr'),false);setHidden($('#ocrProgress'),true);setHidden($('#importResults'),true);setHidden($('#importEmpty'),false);$('#importEmpty').innerHTML='<b>圖片已準備好。</b><span>按「開始辨識」後，會先找格線，再用繁中 OCR 讀課名、老師與教室。</span>'}
function resetImport(){selectedFile=null;drafts=[];if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl='';$('#scheduleImageInput').value='';setHidden($('#importDrop'),false);setHidden($('#importPreviewWrap'),true);setHidden($('#startOcr'),true);setHidden($('#ocrProgress'),true);setHidden($('#importResults'),true);setHidden($('#importEmpty'),false);$('#importEmpty').innerHTML='<b>先丟一張圖片進來。</b><span>辨識完不會直接覆蓋課表，會先讓你逐門確認。</span>';setProgress(0,'準備辨識')}
function confirmImport(){const valid=drafts.filter(c=>c.name?.trim()).map(c=>{let day=+c.day,start=+c.start,end=+c.end;if(day===0){start=0;end=0}else{start=clamp(start||1,1,13);end=clamp(end||start, start,13)}return{id:c.id||uid(),name:c.name.trim(),day,start,end,teacher:(c.teacher||'').trim(),room:(c.room||'').trim(),color:c.color||COLORS[Math.floor(Math.random()*COLORS.length)]}});if(!valid.length)return app.toast('沒有可匯入的課程');const mode=document.querySelector('input[name="importMode"]:checked')?.value||'replace';let next=valid;if(mode==='merge'){const current=app.courses();const seen=new Set(current.map(c=>`${c.day}|${c.start}|${c.end}|${c.name}`));next=[...current,...valid.filter(c=>!seen.has(`${c.day}|${c.start}|${c.end}|${c.name}`))]}app.setCoursesFromUser(next);$('#importDialog').close();app.toast(`已匯入 ${valid.length} 門課 ✓`);resetImport()}

$('#scheduleImageInput')?.addEventListener('change',e=>selectFile(e.target.files?.[0]));$('#importDrop')?.addEventListener('click',()=>$('#scheduleImageInput')?.click());$('#changeImportImage')?.addEventListener('click',()=>$('#scheduleImageInput')?.click());$('#startOcr')?.addEventListener('click',scan);$('#confirmImport')?.addEventListener('click',confirmImport);$('#cancelImport')?.addEventListener('click',()=>$('#importDialog')?.close());$('#importDialog')?.addEventListener('close',()=>{if(!scanBusy)resetImport()});