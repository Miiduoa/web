import http from 'node:http';
import {createHash, timingSafeEqual, webcrypto} from 'node:crypto';
import pg from 'pg';

const {Pool}=pg;
const {subtle}=webcrypto;
const PORT=Number(process.env.PORT||10000);
const DATABASE_URL=process.env.DATABASE_URL||'';
const ALLOWED_ORIGIN='https://miiduoa.github.io';
const AUDIENCE='nolu-provider-mesh';
const ISSUER='nolu';
const KID='mesh-20260911-1';
const MAX_BODY=360_000;
const PUBLIC_JWK={
  kty:'EC',crv:'P-256',
  x:'4MhrmOPNbv2fphbk4Exsj9BLwyhIQnwK03Lj9uhXRds',
  y:'VWSU7m8SyzOsph0f9k70HOZj6-MBpcF7HF_6pwCnHqg',
  ext:true,key_ops:['verify'],alg:'ES256',kid:KID
};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX64=/^[0-9a-f]{64}$/i;
const pool=DATABASE_URL?new Pool({connectionString:DATABASE_URL,ssl:{rejectUnauthorized:false},max:5,idleTimeoutMillis:20_000,connectionTimeoutMillis:4_000}):null;
let schemaReady=false;
let verifyKeyPromise=null;

function headers(origin=''){
  const h={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin'};
  if(origin===ALLOWED_ORIGIN)h['Access-Control-Allow-Origin']=origin;
  h['Access-Control-Allow-Headers']='authorization, content-type, x-nolu-mesh-version';
  h['Access-Control-Allow-Methods']='GET, POST, OPTIONS';
  return h;
}
function send(res,status,body,origin=''){
  res.writeHead(status,headers(origin));
  res.end(JSON.stringify(body));
}
function fromB64url(value){
  try{return Buffer.from(String(value||''),'base64url')}catch{return Buffer.alloc(0)}
}
function safeJson(buffer){try{return JSON.parse(buffer.toString('utf8'))}catch{return null}}
function constantEqualText(a,b){
  const aa=Buffer.from(String(a||'')),bb=Buffer.from(String(b||''));
  return aa.length===bb.length&&timingSafeEqual(aa,bb);
}
function canonical(value){
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function snapshotDigest(snapshot){return createHash('sha256').update(canonical(snapshot)).digest('hex')}
async function verifyPortable(token){
  const [h,p,s,...extra]=String(token||'').split('.');
  if(!h||!p||!s||extra.length)throw new Error('invalid token');
  const header=safeJson(fromB64url(h)),claims=safeJson(fromB64url(p));
  if(header?.alg!=='ES256'||header?.kid!==KID||header?.typ!=='NOLU')throw new Error('unsupported token');
  if(claims?.v!==1||claims?.iss!==ISSUER||claims?.aud!==AUDIENCE||!UUID.test(String(claims?.sub||'')))throw new Error('invalid claims');
  const now=Math.floor(Date.now()/1000);
  if(!Number.isFinite(claims?.iat)||!Number.isFinite(claims?.exp)||claims.exp<=now||claims.iat>now+300||claims.exp-claims.iat>31*24*60*60)throw new Error('expired token');
  if(!claims.cv||String(claims.cv).length>160)throw new Error('invalid credential version');
  verifyKeyPromise ||= subtle.importKey('jwk',PUBLIC_JWK,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
  const key=await verifyKeyPromise;
  const ok=await subtle.verify({name:'ECDSA',hash:'SHA-256'},key,fromB64url(s),Buffer.from(`${h}.${p}`));
  if(!ok)throw new Error('bad signature');
  return claims;
}
async function readBody(req){
  const declared=Number(req.headers['content-length']||0);
  if(declared>MAX_BODY)throw Object.assign(new Error('payload too large'),{status:413});
  const parts=[];let size=0;
  for await(const chunk of req){
    size+=chunk.length;if(size>MAX_BODY)throw Object.assign(new Error('payload too large'),{status:413});
    parts.push(chunk);
  }
  const parsed=safeJson(Buffer.concat(parts));
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Object.assign(new Error('invalid json'),{status:400});
  return parsed;
}
async function ensureSchema(){
  if(schemaReady)return true;
  if(!pool)throw new Error('database not configured');
  await pool.query(`create table if not exists public.nolu_snapshots (
    uid uuid primary key,
    revision bigint not null check (revision > 0),
    digest text not null check (length(digest)=64),
    snapshot jsonb not null,
    updated_at timestamptz not null default now()
  )`);
  await pool.query('create index if not exists nolu_snapshots_updated_at_idx on public.nolu_snapshots(updated_at desc)');
  schemaReady=true;return true;
}
function validateSnapshot(snapshot,uid,revision,digest){
  if(!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot))throw Object.assign(new Error('invalid snapshot'),{status:400});
  if(String(snapshot.uid||'')!==uid)throw Object.assign(new Error('snapshot owner mismatch'),{status:403});
  if(!Number.isSafeInteger(revision)||revision<=0)throw Object.assign(new Error('invalid revision'),{status:400});
  if(!HEX64.test(digest))throw Object.assign(new Error('invalid digest'),{status:400});
  const encoded=Buffer.byteLength(JSON.stringify(snapshot));
  if(encoded>320_000)throw Object.assign(new Error('snapshot too large'),{status:413});
  const calculated=snapshotDigest(snapshot);
  if(!constantEqualText(calculated,digest))throw Object.assign(new Error('digest mismatch'),{status:400});
}
async function putSnapshot(uid,body){
  await ensureSchema();
  const snapshot=body.snapshot,revision=Number(body.revision??snapshot?.revision),digest=String(body.digest||'').toLowerCase();
  validateSnapshot(snapshot,uid,revision,digest);
  const client=await pool.connect();
  try{
    await client.query('begin');
    const existing=await client.query('select revision,digest from public.nolu_snapshots where uid=$1 for update',[uid]);
    if(existing.rowCount){
      const oldRevision=Number(existing.rows[0].revision),oldDigest=String(existing.rows[0].digest||'');
      if(oldRevision>revision){await client.query('rollback');return {ok:true,stored:false,reason:'older_revision',revision:oldRevision,digest:oldDigest}}
      if(oldRevision===revision&&!constantEqualText(oldDigest,digest)){
        await client.query('rollback');throw Object.assign(new Error('revision conflict'),{status:409});
      }
    }
    await client.query(`insert into public.nolu_snapshots(uid,revision,digest,snapshot,updated_at)
      values($1,$2,$3,$4::jsonb,now())
      on conflict(uid) do update set revision=excluded.revision,digest=excluded.digest,snapshot=excluded.snapshot,updated_at=now()
      where excluded.revision >= public.nolu_snapshots.revision`,[uid,revision,digest,JSON.stringify(snapshot)]);
    await client.query('commit');
    return {ok:true,stored:true,revision,digest};
  }catch(error){try{await client.query('rollback')}catch{}throw error}finally{client.release()}
}
async function getSnapshot(uid){
  await ensureSchema();
  const result=await pool.query('select revision,digest,snapshot,updated_at from public.nolu_snapshots where uid=$1 limit 1',[uid]);
  if(!result.rowCount)return {ok:true,snapshot:null,digest:'',revision:0};
  const row=result.rows[0];
  return {ok:true,snapshot:row.snapshot,digest:row.digest,revision:Number(row.revision),updated_at:row.updated_at};
}
async function health(){
  if(!pool)return {ok:false,storage:'unconfigured'};
  try{await ensureSchema();await pool.query('select 1');return {ok:true,storage:'render-postgres'}}catch{return {ok:false,storage:'unavailable'}}
}

const server=http.createServer(async(req,res)=>{
  const origin=String(req.headers.origin||'');
  if(req.method==='OPTIONS'){
    if(origin&&origin!==ALLOWED_ORIGIN)return send(res,403,{error:'ORIGIN_NOT_ALLOWED'},origin);
    res.writeHead(204,headers(origin));return res.end();
  }
  const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
  if(req.method==='GET'&&url.pathname==='/health'){
    const result=await health();return send(res,result.ok?200:503,{...result,provider:'render'},origin);
  }
  if(url.pathname!=='/mirror'||req.method!=='POST')return send(res,404,{error:'NOT_FOUND'},origin);
  if(origin!==ALLOWED_ORIGIN)return send(res,403,{error:'ORIGIN_NOT_ALLOWED'},origin);
  try{
    const auth=String(req.headers.authorization||'');
    if(!auth.startsWith('Bearer '))throw Object.assign(new Error('missing bearer token'),{status:401});
    const claims=await verifyPortable(auth.slice(7));
    const body=await readBody(req),action=String(body.action||'');
    let result;
    if(action==='put_snapshot')result=await putSnapshot(String(claims.sub),body);
    else if(action==='get_snapshot')result=await getSnapshot(String(claims.sub));
    else throw Object.assign(new Error('unsupported action'),{status:400});
    return send(res,200,result,origin);
  }catch(error){
    const status=Number(error?.status)||(/token|signature|claims|bearer|expired/i.test(String(error?.message||''))?401:500);
    const safe=status>=500?'mirror temporarily unavailable':String(error?.message||'request failed');
    return send(res,status,{ok:false,error:status===401?'UNAUTHORIZED':'MIRROR_ERROR',message:safe},origin);
  }
});

server.listen(PORT,'0.0.0.0',()=>console.log(`nolu-render-mirror listening on ${PORT}`));
process.on('SIGTERM',()=>server.close(()=>pool?.end().finally(()=>process.exit(0))));
