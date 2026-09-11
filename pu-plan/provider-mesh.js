import {putSnapshot} from './durable-store.js';
import {
  PROVIDER_MESH_VERSION,
  PROVIDER_MIRRORS,
  PORTABLE_MINT_ENDPOINTS,
  REQUIRED_REMOTE_PROVIDERS,
  MIRROR_READ_QUORUM
} from './provider-config.js';

const encoder=new TextEncoder();
const PORTABLE_KEY='puplan_portable_session_v1';
const state={
  version:PROVIDER_MESH_VERSION,
  busy:false,
  recovering:false,
  minting:false,
  lastAttemptAt:0,
  lastSuccessAt:0,
  lastRecoveryAt:0,
  lastMintAt:0,
  lastError:'',
  lastReason:'',
  configuredProviders:[],
  healthyProviders:[],
  acknowledgements:{},
  recoveryCandidates:0,
  remoteProviderCount:0,
  requiredRemoteProviders:REQUIRED_REMOTE_PROVIDERS,
  readQuorum:MIRROR_READ_QUORUM
};
let debounceTimer=null,mintPromise=null;

function clean(v,n=160){return String(v??'').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,n)}
function sessionToken(){return localStorage.getItem('puplan_session')||''}
function isGuest(){return localStorage.getItem('puplan_guest')==='1'}
function decodePart(part){
  try{
    const normalized=String(part||'').replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(String(part||'').length/4)*4,'=');
    return JSON.parse(decodeURIComponent(escape(atob(normalized))));
  }catch{return null}
}
function tokenUid(raw=sessionToken()){
  try{
    const [payload,signature,...extra]=String(raw||'').split('.');
    if(!payload||!signature||extra.length)return'';
    const data=decodePart(payload);
    if(data?.v!==4||!data?.uid||!data?.iat||!data?.exp||data.exp*1000<=Date.now())return'';
    if(data.iat*1000>Date.now()+5*60*1000)return'';
    return String(data.uid);
  }catch{return''}
}
function portableToken(minTtlSeconds=60){
  const raw=localStorage.getItem(PORTABLE_KEY)||'';
  const [header,payload,signature,...extra]=raw.split('.');
  if(!header||!payload||!signature||extra.length)return'';
  const data=decodePart(payload),now=Math.floor(Date.now()/1000);
  if(data?.v!==1||!data?.sub||data?.aud!=='nolu-provider-mesh'||!Number.isFinite(data?.exp)||data.exp<=now+minTtlSeconds)return'';
  if(String(data.sub)!==tokenUid())return'';
  return raw;
}
async function mintPortableToken(force=false){
  if(isGuest()||!tokenUid())return'';
  if(!force){const current=portableToken(300);if(current)return current}
  if(mintPromise)return mintPromise;
  mintPromise=(async()=>{
    state.minting=true;
    const source=sessionToken();
    for(const endpoint of PORTABLE_MINT_ENDPOINTS||[]){
      const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),3500);
      try{
        const response=await fetch(endpoint,{
          method:'POST',
          headers:{'Content-Type':'application/json','Authorization':`Bearer ${source}`},
          body:'{}',
          cache:'no-store',
          signal:ctrl.signal
        });
        const data=await response.json().catch(()=>({}));
        if(!response.ok||!data?.portable_token)continue;
        localStorage.setItem(PORTABLE_KEY,String(data.portable_token));
        state.lastMintAt=Date.now();
        document.dispatchEvent(new CustomEvent('nolu:portable-session',{detail:{at:state.lastMintAt}}));
        return portableToken(30)||String(data.portable_token);
      }catch{}
      finally{clearTimeout(timer)}
    }
    return'';
  })().finally(()=>{state.minting=false;mintPromise=null});
  return mintPromise;
}
async function ensurePortableToken(){return portableToken(120)||await mintPortableToken(false)}
async function fingerprint(raw=sessionToken()){
  if(!raw||!crypto?.subtle)return'';
  try{
    const digest=await crypto.subtle.digest('SHA-256',encoder.encode(raw));
    return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
  }catch{return''}
}
function validEndpoint(value){
  try{const u=new URL(value);return u.protocol==='https:'&&!!u.hostname}catch{return false}
}
function mirrors(){
  const seen=new Set();
  return PROVIDER_MIRRORS.filter(item=>{
    if(!item?.enabled||!item.id||!item.provider||!validEndpoint(item.endpoint))return false;
    if(item.provider==='supabase'||seen.has(item.provider))return false;
    seen.add(item.provider);return true;
  }).map(item=>({...item,id:clean(item.id,60),provider:clean(item.provider,40),kind:clean(item.kind||'action-api',30),endpoint:String(item.endpoint).replace(/\/$/,'')}));
}
function localRevision(snap){return Math.max(Number(snap?.revision||0),Number(snap?.savedAt||0),0)}
function sanitizeProfile(profile,uid){
  if(!profile||String(profile.id)!==uid)return null;
  const avatar=String(profile.avatar_data||'');
  return {
    id:uid,
    display_name:clean(profile.display_name||'使用者',80)||'使用者',
    username:clean(profile.username||'',24),
    bio:clean(profile.bio||'',120),
    avatar_data:avatar.length<=180000?avatar:'',
    discoverable:profile.discoverable!==false,
    role:'user',
    profile_visibility:profile.profile_visibility==='private'?'private':'public'
  };
}
function sanitizeSnapshot(snap,uid,sessionFingerprint){
  if(!snap||String(snap.uid)!==uid||String(snap.sessionFingerprint||'')!==sessionFingerprint)return null;
  const profile=sanitizeProfile(snap.profile,uid);if(!profile)return null;
  const courses=Array.isArray(snap.courses)?snap.courses.slice(0,80):[];
  const meta=snap.meta&&typeof snap.meta==='object'&&!Array.isArray(snap.meta)?snap.meta:{};
  const revision=localRevision(snap);if(!revision||revision>Date.now()+5*60*1000)return null;
  return {uid,profile,courses,meta,savedAt:Number(snap.savedAt||revision),revision,sessionFingerprint};
}
function canonical(value){
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
async function digestSnapshot(snap){
  try{
    const digest=await crypto.subtle.digest('SHA-256',encoder.encode(canonical(snap)));
    return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
  }catch{return''}
}
function recordConfigured(){
  const external=mirrors();
  state.configuredProviders=['supabase',...external.map(x=>x.provider)];
  state.remoteProviderCount=state.configuredProviders.length;
  return external;
}
function supabaseHealthy(){
  const r=window.NOLU_RESILIENCE?.state;
  return r?.mode==='online'&&/supabase\.co/.test(String(r?.activeApi||''));
}
function refreshHealthy(externalHealthy=[]){
  const providers=new Set(externalHealthy);
  if(supabaseHealthy())providers.add('supabase');
  state.healthyProviders=[...providers];
  document.documentElement.dataset.noluProviderCount=String(state.healthyProviders.length);
  document.documentElement.dataset.noluProviderTarget=String(REQUIRED_REMOTE_PROVIDERS);
  document.dispatchEvent(new CustomEvent('nolu:provider-mesh',{detail:{...state}}));
}
async function postgrestMirror(mirror,action,payload,auth,ctrl){
  const table=`${mirror.endpoint}/nolu_snapshots`;
  let response;
  if(action==='put_snapshot'){
    const snapshot=payload?.snapshot||{};
    response=await fetch(`${table}?on_conflict=uid`,{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Authorization':`Bearer ${auth}`,
        'Prefer':'resolution=merge-duplicates,return=representation',
        'X-Nolu-Mesh-Version':PROVIDER_MESH_VERSION
      },
      body:JSON.stringify({uid:snapshot.uid,revision:Number(payload.revision||snapshot.revision||0),digest:String(payload.digest||''),snapshot,updated_at:new Date().toISOString()}),
      cache:'no-store',signal:ctrl.signal
    });
    const data=await response.json().catch(()=>[]);
    if(!response.ok)throw Object.assign(new Error(data?.message||data?.details||`HTTP ${response.status}`),{status:response.status});
    return {ok:true,stored:true,row:Array.isArray(data)?data[0]:data};
  }
  if(action==='get_snapshot'){
    const uid=encodeURIComponent(String(payload?.uid||''));
    response=await fetch(`${table}?uid=eq.${uid}&select=uid,revision,digest,snapshot&limit=1`,{
      method:'GET',headers:{'Authorization':`Bearer ${auth}`,'Accept':'application/json','X-Nolu-Mesh-Version':PROVIDER_MESH_VERSION},cache:'no-store',signal:ctrl.signal
    });
    const data=await response.json().catch(()=>[]);
    if(!response.ok)throw Object.assign(new Error(data?.message||data?.details||`HTTP ${response.status}`),{status:response.status});
    const row=Array.isArray(data)?data[0]:null;
    return {ok:true,snapshot:row?.snapshot||null,digest:row?.digest||'',revision:Number(row?.revision||0)};
  }
  throw new Error('unsupported mirror action');
}
async function requestMirror(mirror,action,payload={},timeout=4200){
  let auth=await ensurePortableToken();if(!auth)throw new Error('portable session unavailable');
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),timeout);
  try{
    try{
      if(mirror.kind==='postgrest')return await postgrestMirror(mirror,action,payload,auth,ctrl);
      const response=await fetch(mirror.endpoint,{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${auth}`,'X-Nolu-Mesh-Version':PROVIDER_MESH_VERSION},
        body:JSON.stringify({action,...payload}),cache:'no-store',signal:ctrl.signal
      });
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw Object.assign(new Error(data?.message||`HTTP ${response.status}`),{status:response.status});
      return data;
    }catch(error){
      if(error?.status!==401)throw error;
      localStorage.removeItem(PORTABLE_KEY);
      auth=await mintPortableToken(true);if(!auth)throw error;
      if(mirror.kind==='postgrest')return await postgrestMirror(mirror,action,payload,auth,ctrl);
      const response=await fetch(mirror.endpoint,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${auth}`,'X-Nolu-Mesh-Version':PROVIDER_MESH_VERSION},body:JSON.stringify({action,...payload}),cache:'no-store',signal:ctrl.signal});
      const data=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(data?.message||`HTTP ${response.status}`);
      return data;
    }
  }finally{clearTimeout(timer)}
}
async function currentSnapshot(){
  const uid=tokenUid();if(!uid||isGuest())return null;
  const fp=await fingerprint();if(!fp)return null;
  let snap=null;try{snap=await window.NOLU_DURABLE?.getSnapshot?.(uid)}catch{}
  return sanitizeSnapshot(snap,uid,fp);
}
async function sync(reason='periodic',force=false){
  const external=recordConfigured();
  if(state.busy||!external.length||isGuest()||!tokenUid())return false;
  const at=Date.now();if(!force&&at-state.lastAttemptAt<3500)return false;
  const snap=await currentSnapshot();if(!snap)return false;
  const auth=await ensurePortableToken();if(!auth){state.lastError='portable session unavailable';return false}
  state.busy=true;state.lastAttemptAt=at;state.lastReason=reason;state.lastError='';
  const digest=await digestSnapshot(snap),healthy=[];
  try{
    const results=await Promise.allSettled(external.map(async mirror=>{
      const data=await requestMirror(mirror,'put_snapshot',{snapshot:snap,digest,revision:snap.revision});
      if(data?.ok!==true&&data?.stored!==true)throw new Error('mirror did not acknowledge snapshot');
      state.acknowledgements[mirror.provider]={at:Date.now(),revision:snap.revision,digest};
      healthy.push(mirror.provider);return true;
    }));
    const failures=results.filter(x=>x.status==='rejected');
    if(failures.length)state.lastError=failures.map(x=>String(x.reason?.message||x.reason||'mirror failed')).join(' | ');
    if(healthy.length){state.lastSuccessAt=Date.now();refreshHealthy(healthy)}else refreshHealthy([]);
    return healthy.length>0;
  }finally{state.busy=false}
}
async function readMirror(mirror,uid,sessionFingerprint){
  const data=await requestMirror(mirror,'get_snapshot',{uid});
  const snap=sanitizeSnapshot(data?.snapshot,uid,sessionFingerprint);if(!snap)return null;
  const digest=await digestSnapshot(snap);if(!digest)return null;
  if(data?.digest&&data.digest!==digest)return null;
  return {mirror,snapshot:snap,digest};
}
async function recover(reason='startup'){
  const external=recordConfigured();
  if(state.recovering||external.length<MIRROR_READ_QUORUM||isGuest()||!tokenUid())return false;
  if(!await ensurePortableToken())return false;
  const uid=tokenUid();if(!uid)return false;
  const fp=await fingerprint();if(!fp)return false;
  state.recovering=true;state.lastReason=`recover:${reason}`;state.lastError='';
  try{
    const settled=await Promise.allSettled(external.map(m=>readMirror(m,uid,fp)));
    const rows=settled.filter(x=>x.status==='fulfilled'&&x.value).map(x=>x.value);
    state.recoveryCandidates=rows.length;
    refreshHealthy(rows.map(x=>x.mirror.provider));
    if(rows.length<MIRROR_READ_QUORUM)return false;
    const groups=new Map();
    for(const row of rows){
      const key=`${row.snapshot.revision}:${row.digest}`;
      const g=groups.get(key)||{snapshot:row.snapshot,digest:row.digest,providers:new Set()};
      g.providers.add(row.mirror.provider);groups.set(key,g);
    }
    const winner=[...groups.values()].filter(g=>g.providers.size>=MIRROR_READ_QUORUM).sort((a,b)=>localRevision(b.snapshot)-localRevision(a.snapshot))[0];
    if(!winner)return false;
    let local=null;try{local=await window.NOLU_DURABLE?.getSnapshot?.(uid)}catch{}
    const current=sanitizeSnapshot(local,uid,fp);
    if(current&&localRevision(current)>=localRevision(winner.snapshot))return false;
    const stored=await putSnapshot(winner.snapshot);if(!stored)return false;
    await window.NOLU_DURABLE?.bindCurrentSession?.({allowHydrate:true});
    state.lastRecoveryAt=Date.now();
    document.dispatchEvent(new CustomEvent('nolu:provider-recovered',{detail:{uid,revision:winner.snapshot.revision,providers:[...winner.providers]}}));
    if(!window.PUPLAN_CLOUD?.isSignedIn?.()){
      const key='nolu_provider_recovery_reload_v1';
      if(sessionStorage.getItem(key)!=='1'){sessionStorage.setItem(key,'1');setTimeout(()=>location.reload(),60)}
    }else sessionStorage.removeItem('nolu_provider_recovery_reload_v1');
    return true;
  }catch(error){state.lastError=String(error?.message||error||'provider recovery failed');return false}
  finally{state.recovering=false}
}
function schedule(reason,delay=900){clearTimeout(debounceTimer);debounceTimer=setTimeout(()=>void sync(reason),delay)}

recordConfigured();refreshHealthy([]);
document.addEventListener('puplan:courses-changed',()=>schedule('schedule-change',900));
document.addEventListener('puplan:profile-changed',()=>schedule('profile-change',700));
document.addEventListener('nolu:session-rotated',()=>{void mintPortableToken(true);schedule('session-rotated',150);setTimeout(()=>void recover('session-rotated'),250)});
document.addEventListener('nolu:connectivity',e=>{if(e.detail?.mode==='online')schedule('connectivity-online',250);refreshHealthy([])});
addEventListener('online',()=>{schedule('browser-online',250);setTimeout(()=>void recover('browser-online'),300)});
addEventListener('focus',()=>{schedule('focus',500);setTimeout(()=>void recover('focus'),550)});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){schedule('visible',500);setTimeout(()=>void recover('visible'),550)}});
setInterval(()=>void sync('periodic'),45000);

if(tokenUid()&&!isGuest())setTimeout(()=>void mintPortableToken(false).then(()=>recover('startup')).then(()=>sync('startup',true)),350);

window.NOLU_PROVIDER_MESH={
  state,
  sync:(reason='manual',force=true)=>sync(reason,force),
  recover,
  mintPortableToken,
  configured:()=>recordConfigured(),
  target:REQUIRED_REMOTE_PROVIDERS
};
