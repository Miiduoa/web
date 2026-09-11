import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ed25519 } from 'npm:@noble/curves@1.8.2/ed25519';
const URL=Deno.env.get('SUPABASE_URL')||'';
const KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const db=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const SELF='ltfurqaspqsvswmebyzw',PRIMARY='hrrmkrayvrgnwcroyttp';
const PRIMARY_INGEST=`https://${PRIMARY}.supabase.co/functions/v1/pu-plan-failback-ingest-v1`;
const DOMAIN='nolu-failback-ed25519-v1-20260911';
const enc=new TextEncoder(),dec=new TextDecoder();
const ALLOWED=new Set(['https://miiduoa.github.io','https://nolu.tw','https://www.nolu.tw','https://nolu-8r2.pages.dev','http://localhost:3000','http://localhost:5173','http://127.0.0.1:5500']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
class ApiError extends Error{status:number;code:string;constructor(status:number,message:string,code:string){super(message);this.status=status;this.code=code}}
function b64(bytes:Uint8Array){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function unb64(v:string){let n=String(v||'').replace(/-/g,'+').replace(/_/g,'/');while(n.length%4)n+='=';const r=atob(n),o=new Uint8Array(r.length);for(let i=0;i<r.length;i++)o[i]=r.charCodeAt(i);return o}
function eq(a:Uint8Array,b:Uint8Array){if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a[i]^b[i];return d===0}
async function hmac(m:string){const k=await crypto.subtle.importKey('raw',enc.encode(KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);return new Uint8Array(await crypto.subtle.sign('HMAC',k,enc.encode(m)))}
async function verifySession(raw:string){const[p,s,...x]=String(raw||'').split('.');if(!p||!s||x.length)throw new ApiError(401,'登入狀態無效','UNAUTHORIZED');if(!eq(await hmac(p),unb64(s)))throw new ApiError(401,'登入狀態無效','UNAUTHORIZED');let c:any;try{c=JSON.parse(dec.decode(unb64(p)))}catch{throw new ApiError(401,'登入狀態無效','UNAUTHORIZED')}const now=Math.floor(Date.now()/1000);if(c?.v!==4||!UUID.test(String(c.uid||''))||!c.exp||c.exp<now||!c.cv)throw new ApiError(401,'登入已過期','UNAUTHORIZED');const {data,error}=await db.from('puplan_app_users').select('id,password_salt').eq('id',c.uid).maybeSingle();if(error||!data?.id||!data.password_salt)throw new ApiError(401,'找不到帳號','UNAUTHORIZED');const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(`nolu-session-v4:${data.password_salt}`)));if(b64(digest).slice(0,22)!==String(c.cv))throw new ApiError(401,'登入憑證已變更','SESSION_REVOKED');return String(c.uid)}
async function seed(){if(!KEY)throw new ApiError(503,'signing unavailable','FAILBACK_UNAVAILABLE');return new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(`${DOMAIN}:${KEY}`)))}
async function publicKey(){return b64(ed25519.getPublicKey(await seed()))}
function headers(origin=''){const h:any={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Headers':'authorization, content-type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'};if(ALLOWED.has(origin))h['Access-Control-Allow-Origin']=origin;return h}
function json(origin:string,status:number,body:any){return new Response(JSON.stringify(body),{status,headers:headers(origin)})}
Deno.serve(async req=>{
  const origin=req.headers.get('origin')||'';
  if(req.method==='OPTIONS'){if(origin&&!ALLOWED.has(origin))return new Response('forbidden',{status:403});return new Response(null,{status:204,headers:headers(origin)})}
  if(req.method==='GET')return json(origin,200,{ok:true,service:'pu-plan-failback-v1',protocol:2,role:'standby',public_key:await publicKey()});
  if(req.method!=='POST')return json(origin,405,{error:'METHOD_NOT_ALLOWED'});
  if(origin&&!ALLOWED.has(origin))return json(origin,403,{error:'ORIGIN_NOT_ALLOWED'});
  try{
    const auth=req.headers.get('authorization')||'';if(!auth.startsWith('Bearer '))throw new ApiError(401,'缺少備援登入狀態','UNAUTHORIZED');
    const uid=await verifySession(auth.slice(7));
    const {data,error}=await db.rpc('puplan_build_failback_snapshot',{p_uid:uid});if(error||!data)throw new ApiError(503,'無法建立備援快照','FAILBACK_UNAVAILABLE');
    const payload=JSON.stringify(data),encoded=b64(enc.encode(payload)),signature=b64(ed25519.sign(enc.encode(encoded),await seed())),envelope=`${encoded}.${signature}`;
    const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),12000);
    try{
      const res=await fetch(PRIMARY_INGEST,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({envelope}),signal:ctrl.signal,cache:'no-store'});
      const out=await res.json().catch(()=>({}));
      if(res.status===409)return json(origin,409,{error:'FAILBACK_CONFLICT',message:out.message||'主雲端已有較新的資料，暫不自動覆寫',conflict:true});
      if(!res.ok||out.ok!==true)return json(origin,res.status>=500?503:res.status,{error:out.error||'FAILBACK_FAILED',message:out.message||'主雲端回灌失敗'});
      return json(origin,200,{ok:true,reconciled:true,uid,primary_applied:true,protocol:2});
    }catch(e){if(e instanceof DOMException&&e.name==='AbortError')throw new ApiError(503,'主雲端回灌逾時','FAILBACK_UNAVAILABLE');throw e}finally{clearTimeout(timer)}
  }catch(e){
    if(e instanceof ApiError)return json(origin,e.status,{error:e.code,message:e.message});
    console.error('failback failed',String(e));
    return json(origin,503,{error:'FAILBACK_UNAVAILABLE',message:'備援回灌暫時無法完成'});
  }
});
