const CACHE='nolu-shell-20260911-cloud-reconnect1';
const ROOT=new URL('./',self.registration.scope).href;
const PATHS=[
  './','./index.html','./manifest.webmanifest','./nolu-icon.svg','./nolu-mesh-jwks.json',
  './main.js','./login-transport-patience.js','./app.js','./guest-privacy.js','./session-recovery.js','./durable-store.js','./durable-bridge.js','./transport-bridge.js','./resilience.js','./offline-session-rescue.js','./cloud.js','./cloud-replication.js','./provider-config.js','./provider-mesh.js','./outage-mirror-bridge.js','./provider-status.js','./auth.js','./social-ui.js','./import.js','./semesters.js','./community.js','./discover.js','./pwa.js','./admin.js','./privacy.js',
  './core/state.js','./features/analysis.js','./features/friends.js','./features/navigation.js','./features/planner.js','./features/schedule.js','./features/settings.js','./features/share.js',
  './views/assistant.js','./views/auth.js','./views/dialogs.js','./views/friends.js','./views/schedule.js','./views/settings.js','./views/shell.js',
  './styles/base.css','./styles/auth.css','./styles/layout.css','./styles/schedule.css','./styles/assistant.css','./styles/dialogs.css','./styles/schedule-ownership.css','./friends.css','./community.css','./discover.css','./admin.css','./pwa.css'
];
const SHELL=PATHS.map(path=>new URL(path,ROOT).href);

async function seed(cache){
  const keys=(await caches.keys()).filter(key=>key.startsWith('nolu-shell-')&&key!==CACHE);
  for(const key of keys){
    const old=await caches.open(key),requests=await old.keys();
    for(const request of requests){
      const hit=await old.match(request);if(hit)await cache.put(request,hit).catch(()=>{});
    }
  }
  await Promise.all(SHELL.map(async url=>{
    try{const response=await fetch(url,{cache:'no-store'});if(response.ok)await cache.put(url,response)}catch{}
  }));
}

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(seed).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key.startsWith('nolu-shell-')&&key!==CACHE).map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==location.origin)return;
  const dynamic=event.request.mode==='navigate'||/\.(?:html?|css|js|webmanifest)$/i.test(url.pathname);
  if(dynamic){
    event.respondWith((async()=>{
      try{
        const response=await fetch(event.request,{cache:'no-store'});
        if(response.ok){const cache=await caches.open(CACHE);cache.put(event.request,response.clone()).catch(()=>{})}
        return response;
      }catch{
        return (await caches.match(event.request))||(await caches.match(url.href.split('?')[0]))||(await caches.match(new URL('./index.html',ROOT).href))||Response.error();
      }
    })());
    return;
  }
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request)));
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=event.notification?.data?.url||ROOT;
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(async windows=>{
    for(const win of windows){try{await win.navigate(target);return win.focus()}catch{}}
    return clients.openWindow(target);
  })());
});