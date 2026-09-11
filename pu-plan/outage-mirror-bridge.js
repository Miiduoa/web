import {PROVIDER_MESH_VERSION,PROVIDER_MIRRORS,PORTABLE_MINT_ENDPOINTS} from './provider-config.js';

const encoder=new TextEncoder();
const PRIMARY_REF='hrrmkrayvrgnwcroyttp';
const STANDBY_REF='ltfurqaspqsvswmebyzw';
const PRIMARY_SESSION_KEY='puplan_session_primary_v1';
const STANDBY_SESSION_KEY='puplan_session_standby_v1';
const MAX_GRACE_MS=7*24*60*60*1000;
const MAX_SNAPSHOT_AGE_MS=45*24*60*60*1000;
const state={active:false,busy:false,lastAttemptAt:0,lastSuccessAt:0,lastError:'',acknowledgements:{}};
let timer=null;

function decodePart(part){try{const n=String(part||'').replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(String(part||'').length/4)*4,'=');return JSON.parse(decodeURIComponent(escape(atob(n))))}catch{return null}}
function parseSession(raw){
  const [payload,signature,...extra]=String(raw||'').split('.');if(!payload||!signature||extra.length)return null;
  const data=decodePart(payload),now=Date.now();
  if(data?.v!==4||!data?.uid||!Number.isFinite(data?.iat)||!Number.isFinite(data?.exp)||data.exp<=data.iat)return null;
  if(data.iat*1000>now+5*60*1000||data.exp*1000<now-MAX_GRACE_MS)return null;
  return {...data,raw:String(raw),expired:data.exp*1000<=now};
}
function localGraceIdentity(){
  if(localStorage.getItem('puplan_guest')==='1')return null;
  const recovery=window.NOLU_SESSION_RECOVERY?.result;
  if(recovery?.status!=='local-grace'||!recovery?.uid)return null;
  const raw=localStorage.getItem('puplan_session')||'',session=parseSession(raw);
  if(!session||String(session.uid)!==String(recovery.uid)||!session.expired)return null;
  return {uid:String(session.uid),raw,session,recovery};
}
async function fingerprint(raw){const digest=await crypto.subtle.digest('SHA-256',encoder.encode(raw));return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('')}
function canonical(value){if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;return JSON.stringify(value)}
async function digestSnapshot(snap){const digest=await crypto.subtle.digest('SHA-256',encoder.encode(canonical(snap)));return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('')}
function mirrorList(){const seen=new Set();return (PROVIDER_MIRRORS||[]).filter(m=>m?.enabled&&m.provider!=='supabase'&&m.endpoint&&!seen.has(m.provider)&&(seen.add(m.provider),true))}
function regionalSource(endpoint,identity){
  let host='';try{host=new URL(endpoint).hostname}catch{return''}
  const key=host.startsWith(PRIMARY_REF)?PRIMARY_SESSION_KEY:host.startsWith(STANDBY_REF)?STANDBY_SESSION_KEY:'';
  const raw=key?(localStorage.getItem(key)||''):'';
  const parsed=parseSession(raw);
  if(parsed&&String(parsed.uid)===identity.uid)return raw;
  const source=String(identity.recovery?.source||'');
  if((host.startsWith(PRIMARY_REF)&&source.startsWith('primary'))||(host.startsWith(STANDBY_REF)&&source.startsWith('standby')))return identity.raw;
  return'';
}
async function mint(identity){
  for(const endpoint of PORTABLE_MINT_ENDPOINTS||[]){
    const source=regionalSource(endpoint,identity);if(!source)continue;
    const ctrl=new AbortController(),timeout=setTimeout(()=>ctrl.abort(),3200);
    try{
      const res=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${source}`},body:'{}',cache:'no-store',signal:ctrl.signal});
      const data=await res.json().catch(()=>({}));
      if(res.ok&&data?.portable_token&&data?.outage_recovery===true)return String(data.portable_token);
    }catch{}
    finally{clearTimeout(timeout)}
  }
  return'';
}
async function trustedSnapshot(identity){
  const fp=await fingerprint(identity.raw);
  let snap=null;try{snap=await window.NOLU_DURABLE?.getSnapshot?.(identity.uid)}catch{}
  if(!snap||String(snap.uid)!==identity.uid||String(snap?.profile?.id)!==identity.uid||String(snap.sessionFingerprint||'')!==fp)return null;
  if(Date.now()-Number(snap.savedAt||0)>MAX_SNAPSHOT_AGE_MS)return null;
  const revision=Math.max(Number(snap.revision||0),Number(snap.savedAt||0),0);if(!revision||revision>Date.now()+5*60*1000)return null;
  return {...snap,revision};
}
async function postgrestRead(mirror,uid,auth,signal){
  const url=`${String(mirror.endpoint).replace(/\/$/,'')}/nolu_snapshots?uid=eq.${encodeURIComponent(uid)}&select=revision,digest&limit=1`;
  const res=await fetch(url,{headers:{Authorization:`Bearer ${auth}`,Accept:'application/json','X-Nolu-Mesh-Version':PROVIDER_MESH_VERSION},cache:'no-store',signal});
  const rows=await res.json().catch(()=>[]);if(!res.ok)throw new Error(`mirror read ${res.status}`);return Array.isArray(rows)?rows[0]||null:null;
}
async function postgrestWrite(mirror,snap,digest,auth,signal){
  const url=`${String(mirror.endpoint).replace(/\/$/,'')}/nolu_snapshots?on_conflict=uid`;
  const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${auth}`,Prefer:'resolution=merge-duplicates,return=representation','X-Nolu-Mesh-Version':PROVIDER_MESH_VERSION},body:JSON.stringify({uid:snap.uid,revision:snap.revision,digest,snapshot:snap,updated_at:new Date().toISOString()}),cache:'no-store',signal});
  if(!res.ok)throw new Error(`mirror write ${res.status}`);return true;
}
async function actionRead(mirror,uid,auth,signal){
  const res=await fetch(mirror.endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${auth}`,'X-Nolu-Mesh-Version':PROVIDER_MESH_VERSION},body:JSON.stringify({action:'get_snapshot',uid}),cache:'no-store',signal});
  const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(`mirror read ${res.status}`);return {revision:Number(data?.revision||data?.snapshot?.revision||0)};
}
async function actionWrite(mirror,snap,digest,auth,signal){
  const res=await fetch(mirror.endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${auth}`,'X-Nolu-Mesh-Version':PROVIDER_MESH_VERSION},body:JSON.stringify({action:'put_snapshot',snapshot:snap,digest,revision:snap.revision,outage_recovery:true}),cache:'no-store',signal});
  const data=await res.json().catch(()=>({}));if(!res.ok||!(data?.ok===true||data?.stored===true))throw new Error(`mirror write ${res.status}`);return true;
}
async function writeMirror(mirror,snap,digest,auth){
  const ctrl=new AbortController(),timeout=setTimeout(()=>ctrl.abort(),4200);
  try{
    const remote=mirror.kind==='postgrest'?await postgrestRead(mirror,snap.uid,auth,ctrl.signal):await actionRead(mirror,snap.uid,auth,ctrl.signal);
    if(Number(remote?.revision||0)>snap.revision)return {stored:false,newer:true};
    if(Number(remote?.revision||0)===snap.revision&&String(remote?.digest||'')===digest)return {stored:false,current:true};
    if(mirror.kind==='postgrest')await postgrestWrite(mirror,snap,digest,auth,ctrl.signal);else await actionWrite(mirror,snap,digest,auth,ctrl.signal);
    return {stored:true};
  }finally{clearTimeout(timeout)}
}
async function sync(reason='startup'){
  const identity=localGraceIdentity();state.active=!!identity;
  if(!identity||state.busy)return false;
  state.busy=true;state.lastAttemptAt=Date.now();state.lastError='';
  try{
    const snap=await trustedSnapshot(identity);if(!snap){state.lastError='trusted durable snapshot unavailable';return false}
    const auth=await mint(identity);if(!auth){state.lastError='outage mirror token unavailable';return false}
    const digest=await digestSnapshot(snap),mirrors=mirrorList();
    const settled=await Promise.allSettled(mirrors.map(async mirror=>{const result=await writeMirror(mirror,snap,digest,auth);state.acknowledgements[mirror.provider]={at:Date.now(),revision:snap.revision,digest,...result};return result}));
    const ok=settled.some(x=>x.status==='fulfilled');
    if(ok){state.lastSuccessAt=Date.now();document.dispatchEvent(new CustomEvent('nolu:outage-mirror-synced',{detail:{reason,revision:snap.revision,providers:Object.keys(state.acknowledgements)}}));return true}
    state.lastError=settled.map(x=>x.status==='rejected'?String(x.reason?.message||x.reason):'').filter(Boolean).join(' | ')||'all mirrors unavailable';
    return false;
  }catch(error){state.lastError=String(error?.message||error||'outage mirror sync failed');return false}
  finally{state.busy=false}
}
function schedule(reason,delay=700){clearTimeout(timer);timer=setTimeout(()=>void sync(reason),delay)}

if(localGraceIdentity())setTimeout(()=>void sync('startup'),350);
document.addEventListener('puplan:courses-changed',()=>schedule('schedule-change'));
document.addEventListener('puplan:profile-changed',()=>schedule('profile-change'));
addEventListener('online',()=>schedule('online',250));
addEventListener('focus',()=>schedule('focus',500));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')schedule('visible',500)});

window.NOLU_OUTAGE_MIRROR={state,sync:(reason='manual')=>sync(reason)};
