const SOCIAL_V12='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-social-v12';
const originalFetch=window.fetch.bind(window);
window.fetch=(input,init)=>{
  const url=typeof input==='string'?input:input instanceof Request?input.url:String(input||'');
  if(url==='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-social'){
    if(input instanceof Request){const next=new Request(SOCIAL_V12,input);return originalFetch(next,init)}
    return originalFetch(SOCIAL_V12,init);
  }
  return originalFetch(input,init);
};
