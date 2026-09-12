const trace=(type,details={})=>window.NOLU_AUTH_TRACE?.record?.(type,details);
const MAX_EDGE=2048;
const QUALITY=0.82;
const CONVERTIBLE=new Set(['image/jpeg','image/png','image/webp','image/heic','image/heif']);

function outputName(file){
  const base=String(file?.name||'photo').replace(/\.[^.]+$/,'').slice(0,80)||'photo';
  return `${base}.webp`;
}

function canvasBlob(canvas,type='image/webp',quality=QUALITY){
  return new Promise(resolve=>canvas.toBlob(resolve,type,quality));
}

async function resizeWithBitmap(file){
  if(typeof createImageBitmap!=='function')return null;
  let bitmap=null;
  try{
    // Supplying one resize edge lets the browser decode near the target size instead
    // of first materialising a 12/24/48 MP iPhone photo at full RGBA resolution.
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

document.addEventListener('change',event=>{
  const input=event.target;
  if(!(input instanceof HTMLInputElement)||input.id!=='postMediaInput')return;
  const handler=input.onchange,files=[...(input.files||[])];
  if(typeof handler!=='function'||!files.length)return;
  if(!files.some(file=>CONVERTIBLE.has(String(file.type||'').toLowerCase())))return;

  // community.js normally starts decoding every selected original immediately.
  // Stop that target handler, process photos sequentially, then hand the smaller
  // files to the existing composer without changing its upload/post semantics.
  event.preventDefault();event.stopImmediatePropagation();
  input.setAttribute('aria-busy','true');
  handoff(input,handler,files).catch(error=>{
    trace('media-select',{action:'post-media',stage:'optimise-failure',outcome:'fallback-original'});
    return handler.call(input,{target:{files},currentTarget:input});
  }).finally(()=>input.removeAttribute('aria-busy'));
},true);

window.NOLU_MEDIA_INPUT_GUARD={version:'20260913-media-input1',maxEdge:MAX_EDGE,quality:QUALITY};
