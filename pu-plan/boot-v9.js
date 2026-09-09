const asset=name=>new URL(name,import.meta.url).href;
function link(rel,href,key){if(document.querySelector(`[data-${key}]`))return;const el=document.createElement('link');el.rel=rel;el.href=href;el.dataset[key]='1';document.head.appendChild(el)}
link('manifest',asset('./manifest-v9.webmanifest'),'noluManifest');
link('apple-touch-icon',asset('./nolu-icon.svg'),'noluIcon');
for(const [name,content] of [['apple-mobile-web-app-capable','yes'],['apple-mobile-web-app-status-bar-style','default'],['apple-mobile-web-app-title','Nolu']]){let m=document.querySelector(`meta[name="${name}"]`);if(!m){m=document.createElement('meta');m.name=name;document.head.appendChild(m)}m.content=content}
await import(asset('./security-v17.js'));
await import(asset('./auth-v13.js'));
await import(asset('./next-round.js'));
await import(asset('./social-router-v12.js'));
await import(asset('./community-v12.js'));
await import(asset('./discovery-v16.js'));
await import(asset('./pwa-v9.js'));
await import(asset('./planner-v14.js'));
await import(asset('./admin-v14.js'));
await import(asset('./privacy-v19.js'));
