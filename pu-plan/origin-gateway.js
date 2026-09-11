(()=>{
  const baseFetch=window.fetch.bind(window);
  const GATEWAY_SLUG='nolu-browser-gateway-v1';
  const SUPABASE_PROJECTS=new Set(['hrrmkrayvrgnwcroyttp','ltfurqaspqsvswmebyzw']);
  const TARGETS=new Set([
    'pu-plan-api',
    'pu-plan-api-v6',
    'pu-plan-api-v8',
    'pu-plan-core-v1',
    'pu-plan-social',
    'pu-plan-admin',
    'pu-plan-portable-v2',
    'pu-plan-replica-v3',
    'pu-plan-sync-v1',
    'campus-member-profile'
  ]);

  function routedUrl(raw){
    let url;
    try{url=new URL(String(raw||''),location.href)}catch{return null}
    const match=url.hostname.match(/^([a-z0-9]+)\.supabase\.co$/i);
    if(!match||!SUPABASE_PROJECTS.has(match[1]))return null;
    const pathMatch=url.pathname.match(/^\/functions\/v1\/([^/]+)\/?$/);
    if(!pathMatch)return null;
    const target=decodeURIComponent(pathMatch[1]||'');
    if(target===GATEWAY_SLUG||!TARGETS.has(target))return null;
    url.pathname=`/functions/v1/${GATEWAY_SLUG}`;
    url.searchParams.set('target',target);
    return url.href;
  }

  window.fetch=function noluOriginGatewayFetch(input,options){
    const raw=typeof input==='string'||input instanceof URL?String(input):input?.url;
    const routed=routedUrl(raw);
    if(!routed)return baseFetch(input,options);
    if(input instanceof Request){
      try{return baseFetch(new Request(routed,input),options)}catch{return baseFetch(routed,options)}
    }
    return baseFetch(routed,options);
  };

  window.NOLU_ORIGIN_GATEWAY={
    version:'20260911-origin-gateway1',
    route:routedUrl,
    gateway:GATEWAY_SLUG
  };
})();
