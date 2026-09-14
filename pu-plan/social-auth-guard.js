const SOCIAL_PRIMARY='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-social';
const SOCIAL_STANDBY='https://ltfurqaspqsvswmebyzw.supabase.co/functions/v1/pu-plan-social';
const GATEWAY_SLUG='nolu-browser-gateway-v1';
const PRIMARY_HOST='hrrmkrayvrgnwcroyttp.supabase.co';
const STANDBY_HOST='ltfurqaspqsvswmebyzw.supabase.co';
const PRIMARY_SESSION_KEY='puplan_session_primary_v1';
const STANDBY_SESSION_KEY='puplan_session_standby_v1';
const PREFERRED_KEY='nolu_preferred_cloud_v1';
const baseFetch=window.fetch.bind(window);

function trace(type,details={}){window.NOLU_AUTH_TRACE?.record?.(type,details)}
function requestUrl(input){try{return new URL(typeof input==='string'?input:input?.url||'',location.href)}catch{return null}}
function actionOf(options){if(typeof options?.body!=='string')return'';try{return String(JSON.parse(options.body)?.action||'')}catch{return''}}
function authorizationOf(options){try{return new Headers(options?.headers||{}).get('Authorization')||''}catch{return''}}
function bearerToken(options){const auth=authorizationOf(options);return auth.startsWith('Bearer ')?auth.slice(7):''}

function sessionInfo(raw){
  try{
    const [payloadPart,signaturePart,...extra]=String(raw||'').split('.');
    if(!payloadPart||!signaturePart||extra.length)return null;
    const normalized=payloadPart.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(payloadPart.length/4)*4,'=');
    const bytes=Uint8Array.from(atob(normalized),char=>char.charCodeAt(0));
    const payload=JSON.parse(new TextDecoder().decode(bytes));
    if(payload?.v!==4||!payload.uid||!Number.isFinite(payload.iat)||!Number.isFinite(payload.exp))return null;
    if(payload.exp<=payload.iat||payload.exp*1000<=Date.now())return null;
    return{uid:String(payload.uid),iat:Number(payload.iat),exp:Number(payload.exp),raw:String(raw)};
  }catch{return null}
}
function tierOf(url){
  if(!url)return'';
  const target=`${url.origin}${url.pathname}`;
  if(target===SOCIAL_PRIMARY)return'primary';
  if(target===SOCIAL_STANDBY)return'standby';
  if(url.pathname===`/functions/v1/${GATEWAY_SLUG}`&&url.searchParams.get('target')==='pu-plan-social'){
    if(url.hostname===PRIMARY_HOST)return'primary';
    if(url.hostname===STANDBY_HOST)return'standby';
  }
  return'';
}
function addCandidate(list,raw,uid=''){
  const info=sessionInfo(raw);
  if(!info||(uid&&info.uid!==uid)||list.includes(raw))return;
  list.push(raw);
}
function tokenCandidates(tier,options){
  const current=localStorage.getItem('puplan_session')||'';
  const currentInfo=sessionInfo(current),uid=currentInfo?.uid||'';
  const explicitKey=tier==='standby'?STANDBY_SESSION_KEY:PRIMARY_SESSION_KEY;
  const explicit=localStorage.getItem(explicitKey)||'';
  const resilience=window.NOLU_RESILIENCE;
  let regional='';
  try{
    const api=tier==='standby'?resilience?.STANDBY:resilience?.PRIMARY;
    regional=api?resilience?.tierSession?.(api)||'':'';
  }catch{}
  const list=[];
  addCandidate(list,bearerToken(options),uid);
  addCandidate(list,regional,uid);
  addCandidate(list,explicit,uid);
  // The canonical token is always a safe final candidate for the same uid. It may
  // belong to the other region, in which case the server simply returns 401 and the
  // request still falls through to the session-preserving uncertain response.
  addCandidate(list,current,uid);
  return list;
}
function withToken(options,token){
  const headers=new Headers(options?.headers||{});
  headers.set('Authorization',`Bearer ${token}`);
  return{...options,headers};
}
function preserveSessionResponse(){
  return new Response(JSON.stringify({
    error:'SOCIAL_AUTH_UNCERTAIN',
    message:'動態服務暫時無法驗證登入狀態，已保留登入狀態，請稍後再試'
  }),{
    status:503,
    headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}
  });
}
function canonicalStillPresent(){
  return !!sessionInfo(localStorage.getItem('puplan_session')||'')||window.PUPLAN_CLOUD?.isSignedIn?.()===true;
}
function healTierSession(tier,token){
  const key=tier==='standby'?STANDBY_SESSION_KEY:PRIMARY_SESSION_KEY;
  localStorage.setItem(key,token);
  const current=localStorage.getItem('puplan_session')||'';
  if(token===current)localStorage.setItem(PREFERRED_KEY,tier);
}

window.fetch=async function noluSocialAuthGuard(input,options={}){
  const url=requestUrl(input),tier=tierOf(url);
  if(!tier)return baseFetch(input,options);
  const action=actionOf(options),candidates=tokenCandidates(tier,options);
  if(!candidates.length)return baseFetch(input,options);

  let lastResponse=null;
  for(let index=0;index<candidates.length;index++){
    if(options?.signal?.aborted)throw new DOMException('Aborted','AbortError');
    const candidate=candidates[index];
    const response=await baseFetch(input,withToken(options,candidate));
    lastResponse=response;
    if(response.status!==401){
      if(response.ok&&index>0){
        healTierSession(tier,candidate);
        trace('social-auth-recovered',{action,status:'session-healed',outcome:tier});
      }
      return response;
    }
    trace('social-auth-401',{action,status:'retrying',httpStatus:401,outcome:tier});
  }

  if(lastResponse?.status===401&&canonicalStillPresent()){
    trace('social-auth-401',{action,status:'auth-uncertain',httpStatus:401,outcome:'session-preserved'});
    return preserveSessionResponse();
  }
  return lastResponse||baseFetch(input,options);
};

window.NOLU_SOCIAL_AUTH_GUARD={
  version:'20260914-social-gateway2',
  preservesCanonicalSession:true,
  retriesTierTokens:true,
  recognizesBrowserGateway:true
};
