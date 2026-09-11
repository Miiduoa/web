const SUPABASE_URL=Deno.env.get('SUPABASE_URL')||'';
const SERVICE_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const PROJECT_REF=new URL(SUPABASE_URL).hostname.split('.')[0]||'unknown';
const REGION_ID=PROJECT_REF==='ltfurqaspqsvswmebyzw'?'tokyo':'mumbai';
const KID=`mesh-${REGION_ID}-20260911-5`;
const encoder=new TextEncoder();
const decoder=new TextDecoder();
const ALLOWED_ORIGINS=new Set(['https://miiduoa.github.io','http://localhost:3000','http://localhost:5173','http://127.0.0.1:5500']);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const P256_N=BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
const OUTAGE_GRACE_SECONDS=7*24*60*60;
const PORTABLE_TTL_SECONDS=5*60;
const CREDENTIAL_TIMEOUT_MS=1800;
let signingMaterialPromise=null;

function b64url(bytes){let raw='';for(const b of bytes)raw+=String.fromCharCode(b);return btoa(raw).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'')}
function fromB64url(value){let n=String(value||'').replace(/-/g,'+').replace(/_/g,'/');while(n.length%4)n+='=';const raw=atob(n),out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out}
function equalBytes(a,b){if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a[i]^b[i];return d===0}
function bytesToBigInt(bytes){let value=0n;for(const byte of bytes)value=(value<<8n)|BigInt(byte);return value}
function pkcs8FromScalar(scalar){const prefix=Uint8Array.from([0x30,0x41,0x02,0x01,0x00,0x30,0x13,0x06,0x07,0x2a,0x86,0x48,0xce,0x3d,0x02,0x01,0x06,0x08,0x2a,0x86,0x48,0xce,0x3d,0x03,0x01,0x07,0x04,0x27,0x30,0x25,0x02,0x01,0x01,0x04,0x20]);const out=new Uint8Array(prefix.length+scalar.length);out.set(prefix);out.set(scalar,prefix.length);return out}
function fail(status,message){throw Object.assign(new Error(message),{status})}

async function signingMaterial(){
  if(signingMaterialPromise)return signingMaterialPromise;
  signingMaterialPromise=(async()=>{
    if(!SERVICE_KEY)throw new Error('service key unavailable');
    let scalar=null;
    for(let i=0;i<16;i++){
      const candidate=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(`nolu-portable-es256-v5:${PROJECT_REF}:${i}:${SERVICE_KEY}`)));
      const n=bytesToBigInt(candidate);
      if(n>0n&&n<P256_N){scalar=candidate;break}
    }
    if(!scalar)throw new Error('unable to derive signing key');
    const key=await crypto.subtle.importKey('pkcs8',pkcs8FromScalar(scalar),{name:'ECDSA',namedCurve:'P-256'},true,['sign']);
    const privateJwk=await crypto.subtle.exportKey('jwk',key);
    const jwk={kty:'EC',crv:'P-256',x:privateJwk.x,y:privateJwk.y,use:'sig',alg:'ES256',kid:KID};
    return {key,jwk};
  })();
  return signingMaterialPromise;
}
async function hmac(message){if(!SERVICE_KEY)fail(503,'service key unavailable');const key=await crypto.subtle.importKey('raw',encoder.encode(SERVICE_KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);return new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(message)))}
async function credentialVersion(passwordSalt){const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(`nolu-session-v4:${passwordSalt}`)));return b64url(digest).slice(0,22)}
async function sessionFingerprint(raw){const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(raw)));return [...digest].map(x=>x.toString(16).padStart(2,'0')).join('')}

async function verifySourceV4(raw){
  const[p,s,...extra]=String(raw||'').split('.');
  if(!p||!s||extra.length)fail(401,'invalid session');
  const expected=await hmac(p),actual=fromB64url(s);
  if(!equalBytes(expected,actual))fail(401,'invalid session');
  let claims;
  try{claims=JSON.parse(decoder.decode(fromB64url(p)))}catch{fail(401,'invalid session')}
  const now=Math.floor(Date.now()/1000);
  if(claims?.v!==4||!UUID.test(String(claims.uid||''))||typeof claims.cv!=='string'||claims.cv.length<8||claims.cv.length>160||!Number.isFinite(claims.iat)||!Number.isFinite(claims.exp)||claims.iat>now+300||claims.exp<=claims.iat||claims.exp-claims.iat>45*24*60*60)fail(401,'invalid session');
  const expiredBy=Math.max(0,now-Number(claims.exp));
  if(expiredBy>OUTAGE_GRACE_SECONDS)fail(401,'session expired');
  return {...claims,raw:String(raw),expired:claims.exp<=now,expiredBy};
}

async function credentialState(source){
  const ctrl=new AbortController();
  const timer=setTimeout(()=>ctrl.abort(),CREDENTIAL_TIMEOUT_MS);
  try{
    const endpoint=`${SUPABASE_URL}/rest/v1/puplan_app_users?id=eq.${encodeURIComponent(source.uid)}&select=id,password_salt&limit=1`;
    const res=await fetch(endpoint,{headers:{apikey:SERVICE_KEY,Authorization:`Bearer ${SERVICE_KEY}`,Accept:'application/json'},cache:'no-store',signal:ctrl.signal});
    if(!res.ok)return {status:'unavailable',http:res.status};
    const rows=await res.json().catch(()=>[]),row=Array.isArray(rows)?rows[0]:null;
    if(!row?.id||!row?.password_salt)return {status:'invalid'};
    const current=await credentialVersion(String(row.password_salt));
    if(current!==String(source.cv))return {status:'revoked'};
    return {status:'ok'};
  }catch(error){return {status:'unavailable',error:String(error)}}
  finally{clearTimeout(timer)}
}

async function signPortable(source,outageRecovery){
  const now=Math.floor(Date.now()/1000);
  const exp=outageRecovery?now+PORTABLE_TTL_SECONDS:Math.min(Number(source.exp),now+PORTABLE_TTL_SECONDS);
  if(!outageRecovery&&exp<=now+30)fail(401,'session nearly expired');
  const header={alg:'ES256',typ:'NOLU',kid:KID};
  const payload={v:1,sub:String(source.uid),cv:String(source.cv),role:'authenticated',iat:now,exp,iss:'nolu',aud:'nolu-provider-mesh',jti:crypto.randomUUID(),auth_domain:REGION_ID,...(outageRecovery?{outage_recovery:true,purpose:'mirror-continuity',source_exp:Number(source.exp),source_session_fp:await sessionFingerprint(source.raw)}:{})};
  const hp=b64url(encoder.encode(JSON.stringify(header))),pp=b64url(encoder.encode(JSON.stringify(payload)));
  const {key}=await signingMaterial();
  const sig=new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,encoder.encode(`${hp}.${pp}`)));
  return `${hp}.${pp}.${b64url(sig)}`;
}
function headers(origin){const h=new Headers({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Headers':'authorization, content-type','Access-Control-Allow-Methods':'GET, POST, OPTIONS'});if(ALLOWED_ORIGINS.has(origin))h.set('Access-Control-Allow-Origin',origin);return h}
function json(origin,status,body){const h=headers(origin);if(status===503)h.set('Retry-After','5');return new Response(JSON.stringify(body),{status,headers:h})}

Deno.serve(async(req)=>{
  const origin=req.headers.get('origin')||'';
  if(req.method==='OPTIONS'){if(origin&&!ALLOWED_ORIGINS.has(origin))return new Response('forbidden',{status:403});return new Response(null,{status:204,headers:headers(origin)})}
  if(origin&&!ALLOWED_ORIGINS.has(origin))return json(origin,403,{error:'ORIGIN_NOT_ALLOWED'});
  if(req.method==='GET'){try{const {jwk}=await signingMaterial();return json(origin,200,{keys:[jwk],outage_grace_seconds:OUTAGE_GRACE_SECONDS})}catch{return json(origin,503,{error:'TEMPORARILY_UNAVAILABLE'})}}
  if(req.method!=='POST')return json(origin,405,{error:'METHOD_NOT_ALLOWED'});
  try{
    const auth=req.headers.get('authorization')||'';
    if(!auth.startsWith('Bearer '))return json(origin,401,{error:'UNAUTHORIZED',message:'missing bearer token'});
    const source=await verifySourceV4(auth.slice(7));
    const credential=await credentialState(source);
    let outageRecovery=false;
    if(source.expired){
      if(credential.status!=='unavailable')fail(401,'expired session');
      outageRecovery=true;
    }else if(credential.status==='ok'){
      outageRecovery=false;
    }else if(credential.status==='unavailable'){
      outageRecovery=true;
    }else fail(401,'session revoked');
    const portable_token=await signPortable(source,outageRecovery);
    const claims=JSON.parse(decoder.decode(fromB64url(portable_token.split('.')[1])));
    return json(origin,200,{ok:true,portable_token,token_type:'Bearer',expires_at:claims.exp,kid:KID,auth_domain:REGION_ID,outage_recovery:outageRecovery,purpose:outageRecovery?'mirror-continuity':'provider-mesh'});
  }catch(error){
    if(Number(error?.status)===503)return json(origin,503,{error:'TEMPORARILY_UNAVAILABLE',message:'憑證服務暫時無法使用'});
    return json(origin,401,{error:'UNAUTHORIZED',message:'登入狀態無效、過期超過救援期限或已撤銷'});
  }
});
