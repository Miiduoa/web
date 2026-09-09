const asset=name=>new URL(name,import.meta.url).href;
function link(rel,href,key){if(document.querySelector(`[data-${key}]`))return;const el=document.createElement('link');el.rel=rel;el.href=href;el.dataset[key]='1';document.head.appendChild(el)}
link('stylesheet',asset('./social-v6.css'),'puplanSocial');
link('stylesheet',asset('./pwa-v8.css'),'puplanPwa');
link('stylesheet',asset('./ui-v9.css'),'puplanV9Style');
link('stylesheet',asset('./product-v9.css'),'puplanProduct');
link('stylesheet',asset('./community-v12.css'),'puplanCommunityV12');
link('stylesheet',asset('./admin-v14.css'),'puplanAdminV14');
link('stylesheet',asset('./mobile-v10.css'),'puplanMobile');
link('stylesheet',asset('./mobile-v12.css'),'puplanMobileV12');
link('stylesheet',asset('./layout-v13.css'),'puplanLayoutV13');
link('stylesheet',asset('./discovery-v16.css'),'campusDiscoveryV16');
link('manifest',asset('./manifest-v9.webmanifest'),'puplanManifestV9');
link('apple-touch-icon',asset('./icon.svg'),'puplanIconV9');
for(const [name,content] of [['apple-mobile-web-app-capable','yes'],['apple-mobile-web-app-status-bar-style','default'],['apple-mobile-web-app-title','PLAN']]){if(!document.querySelector(`meta[name="${name}"]`)){const m=document.createElement('meta');m.name=name;m.content=content;document.head.appendChild(m)}}
await import(asset('./security-v17.js'));
await import(asset('./auth-v13.js'));
await import(asset('./next-round.js'));
await import(asset('./polish-v9.js'));
await import(asset('./social-router-v12.js'));
await import(asset('./community-v12.js'));
await import(asset('./discovery-v16.js'));
await import(asset('./pwa-v9.js'));
await import(asset('./planner-v14.js'));
await import(asset('./admin-v14.js'));
await import(asset('./language-v14.js'));
