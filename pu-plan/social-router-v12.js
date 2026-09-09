const SOCIAL='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-social-v16';
const PROFILE='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/campus-member-profile';
const LEGACY='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-social';
const originalFetch=window.fetch.bind(window);
window.CAMPUS_SOCIAL_ENDPOINT=SOCIAL;
window.fetch=async(input,init)=>{
  const url=typeof input==='string'?input:input instanceof Request?input.url:String(input||'');
  let nextInit={...(init||{})},body=null;
  if(typeof nextInit.body==='string'){
    try{
      body=JSON.parse(nextInit.body);
      if(body?.action==='feed'){
        body.mode=body.mode||localStorage.getItem('hang_feed_mode')||localStorage.getItem('campus_feed_mode')||'for_you';
        body.limit=Math.max(5,Math.min(30,Number(body.limit)||20));
      }
      if(body?.action==='inbox')body.limit=Math.max(10,Math.min(50,Number(body.limit)||30));
      nextInit.body=JSON.stringify(body);
    }catch{}
  }
  if(url===SOCIAL&&body?.action==='profile_view'){
    const profileBody={...body};delete profileBody.action;nextInit.body=JSON.stringify(profileBody);
    return originalFetch(PROFILE,nextInit);
  }
  if(url!==LEGACY)return originalFetch(input,nextInit);
  if(input instanceof Request){const req=new Request(SOCIAL,input);return originalFetch(req,nextInit)}
  return originalFetch(SOCIAL,nextInit);
};
