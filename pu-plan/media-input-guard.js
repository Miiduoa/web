const trace=(type,details={})=>window.NOLU_AUTH_TRACE?.record?.(type,details);
const MAX_EDGE=1600;
const QUALITY=0.8;
const CONVERTIBLE=new Set(['image/jpeg','image/png','image/webp','image/heic','image/heif']);
const SERVER_IMAGE_TYPES=new Set(['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif']);
const SERVER_VIDEO_TYPES=new Set(['video/mp4','video/quicktime','video/webm']);
const SOCIAL_PRIMARY='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-social';
const SUPABASE_URL='https://hrrmkrayvrgnwcroyttp.supabase.co';
const SUPABASE_KEY='sb_publishable_jXaj3aY5lPDvLEUBOzAuCQ_eKoAHTKN';
const ua=navigator.userAgent||'';
const IOS=/iPad|iPhone|iPod/.test(ua)||(/Macintosh/.test(ua)&&navigator.maxTouchPoints>1);
let iosFiles=[];
let iosInput=null;
let storageClient=null;
let publishing=false;

function outputName(file){
  const base=String(file?.name||'photo').replace(/\.[^.]+$/,'').slice(0,80)||'photo';
  return `${base}.webp`;
}
function canvasBlob(canvas,type='image/webp',quality=QUALITY){return new Promise(resolve=>canvas.toBlob(resolve,type,quality))}
function fileKind(file){
  const type=String(file?.type||'').toLowerCase();
  if(SERVER_IMAGE_TYPES.has(type))return'image';
  if(SERVER_VIDEO_TYPES.has(type))return'video';
  const name=String(file?.name||'').toLowerCase();
  if(/\.(?:jpe?g|png|webp|gif|heic|heif)$/.test(name))return'image';
  if(/\.(?:mp4|mov|webm)$/.test(name))return'video';
  return'';
}
function mimeFor(file){
  const type=String(file?.type||'').toLowerCase();
  if(type)return type;
  const name=String(file?.name||'').toLowerCase();
  if(/\.heic$/.test(name))return'image/heic';
  if(/\.heif$/.test(name))return'image/heif';
  if(/\.png$/.test(name))return'image/png';
  if(/\.webp$/.test(name))return'image/webp';
  if(/\.gif$/.test(name))return'image/gif';
  if(/\.jpe?g$/.test(name))return'image/jpeg';
  if(/\.mov$/.test(name))return'video/quicktime';
  if(/\.webm$/.test(name))return'video/webm';
  if(/\.mp4$/.test(name))return'video/mp4';
  return'application/octet-stream';
}
function emptyMeta(){return{width:null,height:null,duration_ms:null}}
function toast(message){window.PUPLAN_APP?.toast?.(message)}
function totalBytes(){return iosFiles.reduce((sum,file)=>sum+Number(file.size||0),0)}
function mediaInput(){return document.querySelector('#postMediaInput')}

function hardenIosInput(input=mediaInput()){
  if(!IOS||!(input instanceof HTMLInputElement)||input.id!=='postMediaInput')return false;
  input.multiple=false;
  input.removeAttribute('multiple');
  input.dataset.iosSafeInput='1';
  // community.js still owns the legacy full-resolution preview path. On iPhone we
  // deliberately disconnect that target handler and keep all selected File objects
  // inside this module, where they are never decoded before publish.
  if(input.onchange)input.onchange=null;
  return true;
}
function hardenCurrentComposer(){
  const input=mediaInput();
  if(input)hardenIosInput(input);
}
if(IOS){
  const observer=new MutationObserver(hardenCurrentComposer);
  observer.observe(document.documentElement,{childList:true,subtree:true});
  queueMicrotask(hardenCurrentComposer);
}

async function resizeWithBitmap(file){
  if(typeof createImageBitmap!=='function')return null;
  let bitmap=null;
  try{
    bitmap=await createImageBitmap(file,{resizeWidth:MAX_EDGE,resizeQuality:'high',imageOrientation:'from-image'});
    if(!bitmap?.width||!bitmap?.height)return null;
    const canvas=document.createElement('canvas');
    canvas.width=bitmap.width;canvas.height=bitmap.height;
    const ctx=canvas.getContext('2d',{alpha:true});
    if(!ctx)return null;
    ctx.drawImage(bitmap,0,0);
    const blob=await canvasBlob(canvas);
    canvas.width=1;canvas.height=1;
    return blob;
  }catch{return null}
  finally{try{bitmap?.close?.()}catch{}}
}
async function resizeWithImage(file){
  if(IOS)return null;
  const url=URL.createObjectURL(file);
  try{
    const img=new Image();img.decoding='async';img.src=url;
    try{await img.decode()}catch{await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject})}
    const width=Number(img.naturalWidth)||0,height=Number(img.naturalHeight)||0;
    if(!width||!height)return null;
    const scale=Math.min(1,MAX_EDGE/Math.max(width,height));
    if(scale>=1)return null;
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(width*scale));canvas.height=Math.max(1,Math.round(height*scale));
    const ctx=canvas.getContext('2d',{alpha:true});if(!ctx)return null;
    ctx.drawImage(img,0,0,canvas.width,canvas.height);
    const blob=await canvasBlob(canvas);
    canvas.width=1;canvas.height=1;
    return blob;
  }catch{return null}
  finally{URL.revokeObjectURL(url)}
}
async function optimise(file){
  if(!file||!CONVERTIBLE.has(String(file.type||'').toLowerCase()))return file;
  let blob=await resizeWithBitmap(file);
  if(!blob)blob=await resizeWithImage(file);
  if(!blob)return file;
  return new File([blob],outputName(file),{type:'image/webp',lastModified:file.lastModified||Date.now()});
}
async function handoff(input,handler,files){
  const images=files.filter(file=>CONVERTIBLE.has(String(file.type||'').toLowerCase())).length;
  trace('media-select',{action:'post-media',stage:'optimise-start',source:`images:${images};total:${files.length}`});
  const converted=[];
  for(const file of files.slice(0,6))converted.push(await optimise(file));
  const changed=converted.some((file,index)=>file!==files[index]);
  let target={files:converted};
  try{
    if(typeof DataTransfer==='function'){
      const transfer=new DataTransfer();converted.forEach(file=>transfer.items.add(file));
      input.files=transfer.files;target=input;
    }
  }catch{}
  trace('media-select',{action:'post-media',stage:'optimise-complete',outcome:changed?'reduced':'passthrough'});
  return handler.call(input,{target,currentTarget:input});
}

function resetIosState(input=null){
  iosFiles=[];
  iosInput=input;
  renderIosPreview();
}
function renderIosPreview(){
  const box=document.querySelector('#postMediaPreview');
  if(!box)return;
  box.classList.toggle('hidden',!iosFiles.length);
  box.replaceChildren();
  iosFiles.forEach((file,index)=>{
    const tile=document.createElement('div');tile.className='post-media-draft';
    const placeholder=document.createElement('div');
    placeholder.style.cssText='width:100%;height:100%;min-height:118px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:12px;text-align:center;background:rgba(127,127,127,.09);border-radius:inherit;overflow:hidden';
    const icon=document.createElement('span');icon.textContent=fileKind(file)==='video'?'🎬':'🖼️';icon.style.fontSize='28px';
    const label=document.createElement('b');label.textContent=fileKind(file)==='video'?`影片 ${index+1}`:`照片 ${index+1}`;
    const note=document.createElement('small');note.textContent='已安全保留，不預覽原圖';note.style.opacity='.6';
    const hint=document.createElement('small');hint.textContent=iosFiles.length<6?'可再按「相片 / 影片」加入下一個':'已達 6 個上限';hint.style.opacity='.48';
    placeholder.append(icon,label,note,hint);
    const remove=document.createElement('button');remove.type='button';remove.dataset.iosSafeRemove=String(index);remove.setAttribute('aria-label','移除');remove.textContent='×';
    tile.append(placeholder,remove);box.append(tile);
  });
  box.querySelectorAll('[data-ios-safe-remove]').forEach(button=>button.addEventListener('click',()=>{
    const index=Number(button.dataset.iosSafeRemove);if(!Number.isInteger(index))return;
    iosFiles.splice(index,1);
    if(!iosFiles.length&&iosInput)iosInput.value='';
    renderIosPreview();
  }));
}
function selectIosFiles(input,files){
  if(iosInput&&iosInput!==input)resetIosState(input);else iosInput=input;
  const incoming=files.slice(0,1);
  let total=totalBytes(),added=0;
  for(const file of incoming){
    if(iosFiles.length>=6){toast('一篇貼文最多 6 個媒體');break}
    const kind=fileKind(file);
    if(!kind){toast('這個檔案格式目前不支援');continue}
    const max=kind==='image'?12*1024*1024:80*1024*1024;
    if(file.size>max){toast(kind==='image'?'單張圖片上限 12 MB':'單支影片上限 80 MB');continue}
    if(total+file.size>100*1024*1024){toast('這篇貼文的照片和影片合計最多 100 MB');break}
    total+=file.size;iosFiles.push(file);added++;
  }
  trace('media-safe-held',{action:'post-media',count:iosFiles.length,totalBytes:totalBytes(),outcome:added?'stored':'no-change'});
  renderIosPreview();
  if(files.length>1)toast('iPhone 安全模式一次加入 1 個，可重複加入最多 6 個');
  else if(added)toast('已選取；不會先載入原圖預覽');
}

function primaryToken(){return localStorage.getItem('puplan_session_primary_v1')||localStorage.getItem('puplan_session')||''}
async function primaryRequest(action,payload={},timeoutMs=15000){
  const token=primaryToken();if(!token)throw new Error('登入狀態正在恢復，請稍後再試');
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),timeoutMs);
  try{
    const response=await fetch(SOCIAL_PRIMARY,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({action,...payload}),signal:ctrl.signal,cache:'no-store'});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.message||`雲端服務錯誤 (${response.status})`);
    return data;
  }catch(error){if(error?.name==='AbortError')throw new Error('雲端回應逾時，請再試一次');throw error}
  finally{clearTimeout(timer)}
}
async function storage(){
  if(storageClient)return storageClient;
  const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  storageClient=createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});return storageClient;
}
function uploadState(text){const box=document.querySelector('#postUploadStatus');if(!box)return;box.classList.remove('hidden');box.textContent=text}
async function uploadIosFiles(){
  const files=iosFiles.slice();if(!files.length)return[];
  const prep=await primaryRequest('prepare_media',{items:files.map(file=>({mime:mimeFor(file),size:file.size}))});
  const client=await storage(),out=[];
  for(let index=0;index<files.length;index++){
    const file=files[index],upload=prep.uploads?.[index];if(!upload)throw new Error('媒體上傳資訊不完整，請再試一次');
    const mime=mimeFor(file);
    uploadState(`正在上傳 ${index+1}/${files.length}`);
    trace('media-publish-file',{stage:'start',index:index+1,total:files.length,size:Number(file.size||0)});
    const {error}=await client.storage.from(upload.bucket).uploadToSignedUrl(upload.path,upload.token,file,{contentType:mime,cacheControl:'3600'});
    if(error)throw new Error(`媒體上傳失敗：${error.message}`);
    out.push({path:upload.path,mime,size:file.size,...emptyMeta()});
    trace('media-publish-file',{stage:'complete',index:index+1,total:files.length});
  }
  return out;
}
async function publishIosSafe(){
  if(publishing||!iosFiles.length)return;
  const button=document.querySelector('#publishPost'),input=document.querySelector('#postInput');
  const body=input?.value.trim()||'',visibility=document.querySelector('#postVisibility')?.value||'public';
  publishing=true;if(button)button.disabled=true;
  trace('media-publish',{action:'post-media',stage:'ios-safe-upload-start',source:`total:${iosFiles.length}`});
  try{
    const media=await uploadIosFiles();
    await primaryRequest('create_post',{body,media,visibility});
    if(input)input.value='';
    resetIosState(mediaInput());
    if(iosInput)iosInput.value='';
    document.querySelector('#postUploadStatus')?.classList.add('hidden');
    await window.PUPLAN_COMMUNITY?.reloadFeed?.();
    trace('media-publish',{action:'post-media',stage:'ios-safe-upload-complete',outcome:'ok'});
    toast('已發佈');
  }catch(error){
    trace('media-publish',{action:'post-media',stage:'ios-safe-upload-error',outcome:'kept-selection'});
    toast(error?.message||'發佈失敗，請再試一次');
  }finally{publishing=false;if(button)button.disabled=false}
}

if(IOS){
  const preparePicker=event=>{
    const label=event.target?.closest?.('.media-pick');
    const input=event.target?.closest?.('#postMediaInput')||label?.querySelector?.('#postMediaInput');
    if(!input)return;
    hardenIosInput(input);
    if(event.type==='pointerdown'||event.type==='touchstart')trace('media-picker-open',{action:'post-media',mode:'single-file-no-preview'});
  };
  document.addEventListener('pointerdown',preparePicker,true);
  document.addEventListener('touchstart',preparePicker,{capture:true,passive:true});
  document.addEventListener('click',preparePicker,true);
}

document.addEventListener('change',event=>{
  const input=event.target;
  if(!(input instanceof HTMLInputElement)||input.id!=='postMediaInput')return;
  const files=[...(input.files||[])];
  if(!files.length)return;
  const bytes=files.reduce((sum,file)=>sum+Number(file.size||0),0);
  const maxBytes=files.reduce((max,file)=>Math.max(max,Number(file.size||0)),0);
  trace('media-files-received',{action:'post-media',count:files.length,totalBytes:bytes,maxBytes});
  if(IOS){
    event.preventDefault();event.stopImmediatePropagation();
    hardenIosInput(input);
    selectIosFiles(input,files);
    input.value='';
    return;
  }
  const handler=input.onchange;
  if(typeof handler!=='function'||!files.some(file=>CONVERTIBLE.has(String(file.type||'').toLowerCase())))return;
  event.preventDefault();event.stopImmediatePropagation();
  input.setAttribute('aria-busy','true');
  handoff(input,handler,files).catch(()=>{
    trace('media-select',{action:'post-media',stage:'optimise-failure',outcome:'fallback-original'});
    return handler.call(input,{target:{files},currentTarget:input});
  }).finally(()=>input.removeAttribute('aria-busy'));
},true);

document.addEventListener('click',event=>{
  const button=event.target?.closest?.('#publishPost');
  if(!IOS||!button||!iosFiles.length)return;
  event.preventDefault();event.stopImmediatePropagation();
  publishIosSafe();
},true);

window.NOLU_MEDIA_INPUT_GUARD={version:'20260913-media-input3',maxEdge:MAX_EDGE,quality:QUALITY,iosSafeMode:IOS,iosSingleFilePicker:IOS};
