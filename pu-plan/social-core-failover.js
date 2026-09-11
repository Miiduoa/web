const STANDBY_REF='ltfurqaspqsvswmebyzw';
const STANDBY_API=`https://${STANDBY_REF}.supabase.co/functions/v1/pu-plan-social-core-v1`;
const STANDBY_SESSION_KEY='puplan_session_standby_v1';
const PREFERRED_KEY='nolu_preferred_cloud_v1';
const SOCIAL_ACTIONS=new Set(['social','search_people','send_request','accept_request','decline_request','remove_friend','create_meetup','respond_meetup','cancel_meetup']);
const MUTATIONS=new Set(['send_request','accept_request','decline_request','remove_friend','create_meetup','respond_meetup','cancel_meetup']);
const baseFetch=window.fetch.bind(window);

function bodyOf(options){
  if(typeof options?.body!=='string')return null;
  try{return JSON.parse(options.body)}catch{return null}
}
function standbySession(){return localStorage.getItem(STANDBY_SESSION_KEY)||''}
function markStandby(action){
  localStorage.setItem('nolu_social_core_cloud_v1','standby');
  if(MUTATIONS.has(action))document.dispatchEvent(new CustomEvent('nolu:standby-write',{detail:{source:'social-core',action,at:Date.now()}}));
}
async function standbyFetch(action,options){
  const token=standbySession();if(!token)return null;
  const headers=new Headers(options?.headers||{});headers.set('Content-Type','application/json');headers.set('Authorization',`Bearer ${token}`);
  try{
    const response=await baseFetch(STANDBY_API,{...options,headers,cache:'no-store'});
    if(response.ok)markStandby(action);
    return response;
  }catch{return null}
}

window.fetch=async function noluSocialCoreFailover(input,options={}){
  const body=bodyOf(options),action=String(body?.action||'');
  if(!SOCIAL_ACTIONS.has(action))return baseFetch(input,options);
  const url=typeof input==='string'?input:input?.url||'';
  if(!/supabase\.co\/functions\/v1\/(?:pu-plan-api-v8|pu-plan-api-v6|pu-plan-core-v1|pu-plan-api)$/.test(String(url)))return baseFetch(input,options);

  if(localStorage.getItem(PREFERRED_KEY)==='standby'&&standbySession()){
    const standby=await standbyFetch(action,options);
    if(standby&&(standby.ok||![401,500,502,503,504].includes(standby.status)))return standby;
  }

  let primaryResponse=null;
  try{
    primaryResponse=await baseFetch(input,options);
    if(primaryResponse.status<500)return primaryResponse;
  }catch{}

  const standby=await standbyFetch(action,options);
  if(standby)return standby;
  if(primaryResponse)return primaryResponse;
  throw new TypeError('Nolu social cloud temporarily unavailable');
};

window.NOLU_SOCIAL_CORE_FAILOVER={version:'20260911-social-core-failover1',endpoint:STANDBY_API,actions:[...SOCIAL_ACTIONS]};
