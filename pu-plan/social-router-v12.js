const SOCIAL='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-social-v16';
const LEGACY='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-social';
const originalFetch=window.fetch.bind(window);
window.fetch=async(input,init)=>{
  const url=typeof input==='string'?input:input instanceof Request?input.url:String(input||'');
  if(url!==LEGACY)return originalFetch(input,init);
  let nextInit={...(init||{})};
  if(typeof nextInit.body==='string'){
    try{
      const body=JSON.parse(nextInit.body);
      if(body?.action==='feed'&&!body.mode)body.mode=localStorage.getItem('campus_feed_mode')||'for_you';
      nextInit.body=JSON.stringify(body);
    }catch{}
  }
  if(input instanceof Request){
    const req=new Request(SOCIAL,input);
    return originalFetch(req,nextInit);
  }
  return originalFetch(SOCIAL,nextInit);
};
window.CAMPUS_SOCIAL_ENDPOINT=SOCIAL;
