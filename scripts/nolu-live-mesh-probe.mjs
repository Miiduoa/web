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
function decodePart(part){try{return JSON.parse(Buffer.from(part,'base64url').toString('utf8'))}catch{return null}}

const authDomains=[
  {
    id:'tokyo',
    login:'https://ltfurqaspqsvswmebyzw.supabase.co/functions/v1/pu-plan-api-v8',
    mint:'https://ltfurqaspqsvswmebyzw.supabase.co/functions/v1/pu-plan-portable-v1'
  },
  {
    id:'mumbai',
    login:'https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-api-v8',
    mint:'https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-portable-v1'
  }
];
const netlify='https://nolu-mirror.netlify.app/mirror';
const neon='https://ep-delicate-frost-b3q46ijf.apirest.c-4.ap-southeast-1.aws.neon.tech/neondb/rest/v1/nolu_snapshots';
const jwksUrl='https://miiduoa.github.io/web/nolu-mesh-jwks.json';

let login=null,authDomain=null;
for(const candidate of authDomains){
  try{
    const result=await jsonFetch(candidate.login,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'login',email,password})});
    console.log(`${candidate.id} login`,result.res.status);
    if(result.res.ok&&typeof result.data.token==='string'){login=result;authDomain=candidate;break}
  }catch(error){console.log(`${candidate.id} login network error`,String(error?.name||'error'))}
}
assert(login&&authDomain,'all auth domains failed');

const minted=await jsonFetch(authDomain.mint,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${login.data.token}`},body:'{}'});
console.log('portable mint',minted.res.status,authDomain.id);
if(!minted.res.ok) console.log('portable mint body',minted.text.slice(0,300));
assert(minted.res.ok&&typeof minted.data.portable_token==='string','portable mint failed');
const token=minted.data.portable_token;
const [tokenHeaderPart,tokenPayloadPart]=token.split('.');
const tokenHeader=decodePart(tokenHeaderPart),tokenPayload=decodePart(tokenPayloadPart);
console.log('portable token meta',JSON.stringify({kid:tokenHeader?.kid,alg:tokenHeader?.alg,typ:tokenHeader?.typ,aud:tokenPayload?.aud,role:tokenPayload?.role,iss:tokenPayload?.iss,subMatches:tokenPayload?.sub===uid}));
const jwks=await jsonFetch(jwksUrl);
console.log('jwks',jwks.res.status,JSON.stringify({kids:Array.isArray(jwks.data?.keys)?jwks.data.keys.map(k=>k?.kid):[]}));

const revision=Date.now();
const snapshot={uid,profile:{id:uid,display_name:'Nolu Mesh Probe',username:'nolu_mesh_probe',bio:'',avatar_data:'',discoverable:false,role:'user',profile_visibility:'private'},courses:[],meta:{probe:true},savedAt:revision,revision,sessionFingerprint:'probe'};
const digest=createHash('sha256').update(canonical(snapshot)).digest('hex');

const putNetlify=await jsonFetch(netlify,{method:'POST',headers:{origin:'https://miiduoa.github.io','content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({action:'put_snapshot',snapshot,digest,revision})});
console.log('netlify put',putNetlify.res.status);
if(!putNetlify.res.ok) console.log('netlify put body',putNetlify.text.slice(0,500));
assert(putNetlify.res.ok&&putNetlify.data.ok===true,'netlify write failed');
const getNetlify=await jsonFetch(netlify,{method:'POST',headers:{origin:'https://miiduoa.github.io','content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({action:'get_snapshot'})});
console.log('netlify get',getNetlify.res.status);
if(!getNetlify.res.ok) console.log('netlify get body',getNetlify.text.slice(0,500));
assert(getNetlify.res.ok&&getNetlify.data.digest===digest&&Number(getNetlify.data.revision)===revision,'netlify readback failed');

const putNeon=await jsonFetch(`${neon}?on_conflict=uid`,{method:'POST',headers:{'content-type':'application/json','prefer':'resolution=merge-duplicates,return=representation',authorization:`Bearer ${token}`},body:JSON.stringify({uid,revision,digest,snapshot,updated_at:new Date().toISOString()})});
console.log('neon put',putNeon.res.status);
if(!putNeon.res.ok) console.log('neon put body',putNeon.text.slice(0,500));
assert(putNeon.res.ok,'neon write failed');
const getNeon=await jsonFetch(`${neon}?uid=eq.${encodeURIComponent(uid)}&select=uid,revision,digest,snapshot&limit=1`,{headers:{accept:'application/json',authorization:`Bearer ${token}`}});
console.log('neon get',getNeon.res.status);
if(!getNeon.res.ok) console.log('neon get body',getNeon.text.slice(0,500));
assert(getNeon.res.ok&&Array.isArray(getNeon.data)&&getNeon.data[0]?.digest===digest&&Number(getNeon.data[0]?.revision)===revision,'neon readback failed');

const unauth=await jsonFetch(netlify,{method:'POST',headers:{origin:'https://miiduoa.github.io','content-type':'application/json'},body:JSON.stringify({action:'get_snapshot'})});
console.log('netlify unauth',unauth.res.status);
assert(unauth.res.status===401,'netlify auth boundary failed');

const health=await jsonFetch('https://nolu-mirror.netlify.app/health');
console.log('netlify health',health.res.status,health.data?.status||'');
assert(health.res.ok&&health.data?.ok===true,'netlify health failed');

console.log('authenticated provider round trip passed');
