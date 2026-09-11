import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ed25519 } from 'npm:@noble/curves@1.8.2/ed25519';

const URL=Deno.env.get('SUPABASE_URL')||'';
const KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const db=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const STANDBY='ltfurqaspqsvswmebyzw',PRIMARY='hrrmkrayvrgnwcroyttp';
const STANDBY_PUBLIC_KEY='y8vSmYdAMI209EvhUa-mRgXk2U6MV4GJN5ksnrF_R0c';
const enc=new TextEncoder(),dec=new TextDecoder();
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY=900000;
class ApiError extends Error{status:number;code:string;constructor(status:number,message:string,code:string){super(message);this.status=status;this.code=code}}
function unb64(v:string){let n=String(v||'').replace(/-/g,'+').replace(/_/g,'/');while(n.length%4)n+='=';const r=atob(n),o=new Uint8Array(r.length);for(let i=0;i<r.length;i++)o[i]=r.charCodeAt(i);return o}
function json(status:number,body:any){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}})}
async function readJson(req:Request){const text=await req.text();if(enc.encode(text).byteLength>MAX_BODY)throw new ApiError(413,'failback payload too large','PAYLOAD_TOO_LARGE');try{return JSON.parse(text||'{}')}catch{throw new ApiError(400,'invalid json','INVALID_JSON')}}
Deno.serve(async req=>{
  if(req.method==='GET')return json(200,{ok:true,service:'pu-plan-failback-ingest-v1',protocol:2,role:'primary'});
  if(req.method!=='POST')return json(405,{error:'METHOD_NOT_ALLOWED'});
  if(req.headers.get('origin'))return json(403,{error:'BROWSER_ORIGIN_NOT_ALLOWED'});
  try{
    const body=await readJson(req),envelope=String(body.envelope||''),[p,s,...x]=envelope.split('.');
    if(!p||!s||x.length)throw new ApiError(401,'invalid failback envelope','FAILBACK_REJECTED');
    if(!ed25519.verify(unb64(s),enc.encode(p),unb64(STANDBY_PUBLIC_KEY)))throw new ApiError(401,'invalid failback signature','FAILBACK_REJECTED');
    let payload:any;try{payload=JSON.parse(dec.decode(unb64(p)))}catch{throw new ApiError(400,'invalid failback payload','FAILBACK_REJECTED')}
    const now=Date.now(),iat=Date.parse(String(payload.iat||'')),exp=Date.parse(String(payload.exp||'')),base=Number(payload.base_primary_revision);
    if(payload?.v!==2||payload.kind!=='failback-snapshot'||payload.iss!==STANDBY||payload.aud!==PRIMARY||!UUID.test(String(payload.uid||''))||!UUID.test(String(payload.nonce||''))||!Number.isSafeInteger(base)||base<0||!Number.isFinite(iat)||!Number.isFinite(exp)||exp<=now||iat>now+30000||exp-iat>180000||now-iat>180000)throw new ApiError(400,'invalid failback payload','FAILBACK_REJECTED');
    await db.from('puplan_failback_nonces').delete().lt('expires_at',new Date().toISOString());
    const replay=await db.from('puplan_failback_nonces').insert({nonce:String(payload.nonce),expires_at:new Date(exp).toISOString()});
    if(replay.error){if(replay.error.code==='23505')throw new ApiError(409,'failback envelope already used','FAILBACK_REPLAY');throw new ApiError(503,'failback replay protection unavailable','FAILBACK_UNAVAILABLE')}
    const {data,error}=await db.rpc('puplan_apply_failback_snapshot',{p_payload:payload});
    if(error)throw new ApiError(503,'failback apply failed','FAILBACK_UNAVAILABLE');
    if(data?.conflict===true||data?.ok===false)return json(409,{error:'FAILBACK_CONFLICT',message:'主雲端已有較新的資料，已停止自動覆寫',conflict:true,base_primary_revision:data?.base_primary_revision,current_primary_revision:data?.current_primary_revision});
    return json(200,{ok:true,result:data});
  }catch(e){
    if(e instanceof ApiError)return json(e.status,{error:e.code,message:e.message});
    console.error('failback ingest failed',String(e));
    return json(503,{error:'FAILBACK_UNAVAILABLE',message:'備援回灌暫時無法完成'});
  }
});
