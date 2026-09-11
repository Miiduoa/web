import { createHash } from 'node:crypto';

const uid=process.env.NOLU_PROBE_UID||'';
const email=process.env.NOLU_PROBE_EMAIL||'';
const password=process.env.NOLU_PROBE_PASSWORD||'';
if(!uid||!email||!password) throw new Error('probe credentials missing');

function canonical(value){
  if(Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object') return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
async function jsonFetch(url,options={}){
  const res=await fetch(url,{...options,signal:AbortSignal.timeout(30000)});
  const text=await res.text();
  let data={}; try{data=JSON.parse(text)}catch{}
  return {res,data,text};
}
function assert(condition,message){if(!condition) throw new Error(message)}

const standby='https://ltfurqaspqsvswmebyzw.supabase.co/functions/v1/pu-plan-api-v8';
const mint='https://ltfurqaspqsvswmebyzw.supabase.co/functions/v1/pu-plan-portable-v1';
const netlify='https://nolu-mirror.netlify.app/mirror';
const neon='https://ep-delicate-frost-b3q46ijf.apirest.c-4.ap-southeast-1.aws.neon.tech/neondb/rest/v1/nolu_snapshots';

const login=await jsonFetch(standby,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'login',email,password})});
console.log('standby login',login.res.status);
assert(login.res.ok&&typeof login.data.token==='string','standby login failed');

const minted=await jsonFetch(mint,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${login.data.token}`},body:'{}'});
console.log('portable mint',minted.res.status);
assert(minted.res.ok&&typeof minted.data.portable_token==='string','portable mint failed');
const token=minted.data.portable_token;

const revision=Date.now();
const snapshot={uid,profile:{id:uid,display_name:'Nolu Mesh Probe',username:'nolu_mesh_probe',bio:'',avatar_data:'',discoverable:false,role:'user',profile_visibility:'private'},courses:[],meta:{probe:true},savedAt:revision,revision,sessionFingerprint:'probe'};
const digest=createHash('sha256').update(canonical(snapshot)).digest('hex');

const putNetlify=await jsonFetch(netlify,{method:'POST',headers:{origin:'https://miiduoa.github.io','content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({action:'put_snapshot',snapshot,digest,revision})});
console.log('netlify put',putNetlify.res.status);
assert(putNetlify.res.ok&&putNetlify.data.ok===true,'netlify write failed');
const getNetlify=await jsonFetch(netlify,{method:'POST',headers:{origin:'https://miiduoa.github.io','content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({action:'get_snapshot'})});
console.log('netlify get',getNetlify.res.status);
assert(getNetlify.res.ok&&getNetlify.data.digest===digest&&Number(getNetlify.data.revision)===revision,'netlify readback failed');

const putNeon=await jsonFetch(`${neon}?on_conflict=uid`,{method:'POST',headers:{'content-type':'application/json','prefer':'resolution=merge-duplicates,return=representation',authorization:`Bearer ${token}`},body:JSON.stringify({uid,revision,digest,snapshot,updated_at:new Date().toISOString()})});
console.log('neon put',putNeon.res.status);
assert(putNeon.res.ok,'neon write failed');
const getNeon=await jsonFetch(`${neon}?uid=eq.${encodeURIComponent(uid)}&select=uid,revision,digest,snapshot&limit=1`,{headers:{accept:'application/json',authorization:`Bearer ${token}`}});
console.log('neon get',getNeon.res.status);
assert(getNeon.res.ok&&Array.isArray(getNeon.data)&&getNeon.data[0]?.digest===digest&&Number(getNeon.data[0]?.revision)===revision,'neon readback failed');

const unauth=await jsonFetch(netlify,{method:'POST',headers:{origin:'https://miiduoa.github.io','content-type':'application/json'},body:JSON.stringify({action:'get_snapshot'})});
console.log('netlify unauth',unauth.res.status);
assert(unauth.res.status===401,'netlify auth boundary failed');

const health=await jsonFetch('https://nolu-mirror.netlify.app/health');
console.log('netlify health',health.res.status,health.data?.status||'');
assert(health.res.ok&&health.data?.ok===true,'netlify health failed');

console.log('authenticated provider round trip passed');
