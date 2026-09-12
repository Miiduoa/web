const PRIMARY_REF='hrrmkrayvrgnwcroyttp';
const STANDBY_REF='ltfurqaspqsvswmebyzw';
const PRIMARY=`https://${PRIMARY_REF}.supabase.co/functions/v1/pu-plan-admin`;
const STANDBY=`https://${STANDBY_REF}.supabase.co/functions/v1/pu-plan-admin`;
const READ_ONLY=new Set(['whoami','overview','users','user_detail','posts','conversations','conversation_detail']);
const nativeFetch=window.fetch.bind(window);
function tokenFor(tier){
  const canonical=localStorage.getItem('puplan_session')||'';
  const primary=localStorage.getItem('puplan_session_primary_v1')||'';
  const standby=localStorage.getItem('puplan_session_standby_v1')||'';
  if(tier==='standby')return standby;
  // Tokyo and Mumbai sign Session v4 independently. When the current canonical
  // login is Tokyo, an older Mumbai token may still be left on the device. That
  // stale token must not be treated as authoritative: doing so makes a valid
  // standby login look like an invalid login after Mumbai answers 401. In this
  // state, read-only admin calls may use Tokyo while writes stay fail-closed.
  const canonicalIsStandby=localStorage.getItem('nolu_preferred_cloud_v1')==='standby'||(standby&&canonical===standby);
  if(canonicalIsStandby)return'';
  if(primary)return primary;
  return canonical;
}
function adminTarget(raw){try{const u=new URL(typeof raw==='string'||raw instanceof URL?String(raw):raw?.url||'',location.href);return u.hostname===`${PRIMARY_REF}.supabase.co`&&u.pathname==='/functions/v1/pu-plan-admin'}catch{return false}}
function failoverEligible(response){return !response||response.status>=500}
async function call(url,options,tier){const token=tokenFor(tier);if(!token)return null;const headers=new Headers(options?.headers||{});headers.set('Authorization',`Bearer ${token}`);headers.set('Content-Type',headers.get('Content-Type')||'application/json');return nativeFetch(url,{...options,headers,cache:'no-store'})}
window.fetch=async function noluAdminRegionalFailover(input,options={}){
  if(!adminTarget(input)||String(options?.method||'GET').toUpperCase()!=='POST')return nativeFetch(input,options);
  let action='';
  try{action=String(JSON.parse(String(options?.body||'{}'))?.action||'')}catch{}
  const primary=await call(PRIMARY,options,'primary').catch(()=>null);
  if(primary?.ok){localStorage.setItem('nolu_admin_cloud_v1','primary');return primary}
  // A 4xx from the current authority is a decision, not an outage. In particular,
  // never turn an actual Mumbai 401/403 into a Tokyo retry when Mumbai owns the
  // current session. Tokyo is considered only when there is no trusted Mumbai
  // credential or Mumbai is unavailable.
  if(primary&&!failoverEligible(primary))return primary;
  if(!READ_ONLY.has(action))return primary||new Response(JSON.stringify({error:'PRIMARY_REQUIRED',message:'這個管理操作需要主雲端'}),{status:503,headers:{'Content-Type':'application/json'}});
  const standby=await call(STANDBY,options,'standby').catch(()=>null);
  if(standby){if(standby.ok)localStorage.setItem('nolu_admin_cloud_v1','standby');return standby}
  if(primary)return primary;
  return new Response(JSON.stringify({error:'ADMIN_UNAVAILABLE',message:'管理功能暫時無法使用'}),{status:503,headers:{'Content-Type':'application/json'}})
};
window.NOLU_ADMIN_FAILOVER={version:'20260912-admin-read-failover4',PRIMARY,STANDBY,READ_ONLY};
