const PRIMARY_REF='hrrmkrayvrgnwcroyttp';
const STANDBY_REF='ltfurqaspqsvswmebyzw';
const PRIMARY_SESSION_KEY='puplan_session_primary_v1';
const STANDBY_SESSION_KEY='puplan_session_standby_v1';
const PREFERRED_KEY='nolu_preferred_cloud_v1';
const baseFetch=window.fetch.bind(window);

function decodeUid(raw=''){
  try{
    const [payload,signature,...extra]=String(raw||'').split('.');
    if(!payload||!signature||extra.length)return'';
    const normalized=payload.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(payload.length/4)*4,'=');
    const data=JSON.parse(decodeURIComponent(escape(atob(normalized))));
    if(data?.v!==4||!data?.uid||!data?.exp||data.exp*1000<=Date.now())return'';
    return String(data.uid);
  }catch{return''}
}
function canonical(){return localStorage.getItem('puplan_session')||''}
function sameAccount(raw,id=decodeUid(canonical())){return !!id&&decodeUid(raw)===id}
function preferred(){return localStorage.getItem(PREFERRED_KEY)==='standby'?'standby':'primary'}
function regionalToken(tier){
  const current=canonical(),id=decodeUid(current);
  if(!id)return'';
  const primary=localStorage.getItem(PRIMARY_SESSION_KEY)||'';
  const standby=localStorage.getItem(STANDBY_SESSION_KEY)||'';
  const primaryOk=sameAccount(primary,id),standbyOk=sameAccount(standby,id);

  // If both slots contain the same regional token, treat the preferred tier as
  // authoritative and fail closed for the other tier. Independent Supabase
  // projects must never share a v4 session signature.
  if(primaryOk&&standbyOk&&primary===standby){
    return tier===preferred()?(tier==='primary'?primary:standby):'';
  }
  if(tier==='primary'){
    if(primaryOk)return primary;
    // Backward compatibility for installations that predate per-region slots:
    // only a primary-preferred account with no valid standby session may treat
    // the canonical token as the historical Mumbai session.
    if(preferred()==='primary'&&!standbyOk&&sameAccount(current,id))return current;
    return'';
  }
  return standbyOk?standby:'';
}
function tierForUrl(raw){
  try{
    const url=new URL(String(raw||''),location.href);
    if(url.hostname===`${PRIMARY_REF}.supabase.co`)return'primary';
    if(url.hostname===`${STANDBY_REF}.supabase.co`)return'standby';
  }catch{}
  return'';
}
function requestHeaders(input,options){
  try{return new Headers(options?.headers||(input instanceof Request?input.headers:{}))}
  catch{return new Headers()}
}

window.fetch=function noluRegionalCredentialGuard(input,options={}){
  const rawUrl=typeof input==='string'||input instanceof URL?String(input):input?.url;
  const tier=tierForUrl(rawUrl);
  if(!tier)return baseFetch(input,options);

  const headers=requestHeaders(input,options);
  if(!headers.has('Authorization'))return baseFetch(input,options);

  const token=regionalToken(tier);
  if(token)headers.set('Authorization',`Bearer ${token}`);
  else headers.delete('Authorization');
  return baseFetch(input,{...options,headers});
};

window.NOLU_REGIONAL_CREDENTIALS={
  primary:()=>regionalToken('primary'),
  standby:()=>regionalToken('standby'),
  uid:()=>decodeUid(canonical())
};
