const asset=name=>new URL(name,import.meta.url).href;
for(const [name,content] of [['apple-mobile-web-app-capable','yes'],['apple-mobile-web-app-status-bar-style','default'],['apple-mobile-web-app-title','nolu']]){let m=document.querySelector(`meta[name="${name}"]`);if(!m){m=document.createElement('meta');m.name=name;document.head.appendChild(m)}m.content=content}
await import(asset('./security.js'));
await import(asset('./auth.js'));
await import(asset('./semesters.js'));
await import(asset('./community.js'));
await import(asset('./discover.js'));
await import(asset('./pwa.js'));
await import(asset('./planner.js'));
await import(asset('./admin.js'));
await import(asset('./privacy.js'));
