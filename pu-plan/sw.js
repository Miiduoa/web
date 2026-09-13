const CACHE='nolu-shell-20260913-atomic-shell9';
const ROOT=new URL('./',self.registration.scope).href;
const PATHS=[
  './','./index.html','./manifest.webmanifest','./nolu-icon.svg','./nolu-mesh-jwks.json',
  './main.js','./auth-trace.js','./media-input-guard.js','./origin-gateway.js','./media-failback-guard.js','./login-transport-patience.js','./login-failover-budget.js','./app.js','./guest-privacy.js','./account-boundary.js','./session-recovery.js','./durable-store.js','./durable-bridge.js','./transport-bridge.js','./resilience.js','./offline-session-rescue.js','./cloud.js','./cloud-replication.js','./provider-config.js','./provider-mesh.js','./outage-mirror-bridge.js','./provider-status.js','./auth.js','./social-ui.js','./import.js','./semesters.js','./community.js','./discover.js','./pwa.js','./admin-failover.js','./admin.js','./admin-mobile.js','./privacy.js',
  './core/state.js','./features/analysis.js','./features/friends.js','./features/navigation.js','./features/planner.js','./features/schedule.js','./features/settings.js','./features/share.js',
  './views/assistant.js','./views/auth.js','./views/dialogs.js','./views/friends.js','./views/schedule.js','./views/settings.js','./views/shell.js',
  './styles/base.css','./styles/auth.css','./styles/layout.css','./styles/schedule.css','./styles/assistant.css','./styles/dialogs.css','./styles/schedule-ownership.css','./friends.css','./community.css','./discover.css','./admin.css','./pwa.css'
];
const SHELL=PATHS.map(path=>new URL(path,ROOT).href);

async function seed(){
  const keys=await caches.keys();
  // Never mutate the cache used by the currently active worker. A worker code
  // change must use a new shell generation so a failed install cannot corrupt
  // the last-known-good offline shell.
  if(self.registration.active&&keys.includes(CACHE))throw new Error('SHELL_GENERATION_REUSE');

  // Clear only a stale/partial cache left by an earlier failed attempt for this
  // new generation. The active generation has a different name by contract.
  await caches.delete(CACHE);

  // Fetch the complete release before writing any new cache entries. If even one
  // asset is unavailable, installation fails and the old worker keeps control.
  const fetched=await Promise.all(SHELL.map(async url=>{
    const response=await fetch(url,{cache:'no-store'});
    if(!response.ok)throw new Error(`SHELL_FETCH_FAILED ${new URL(url).pathname} ${response.status}`);
    return [url,response];
  }));

  const cache=await caches.open(CACHE);
  try{
    for(const [url,response] of fetched)await cache.put(url,response);
  }catch(error){
    await caches.delete(CACHE);
    throw error;
  }
}

self.addEventListener('install',event=>{
  event.waitUntil(seed().then(()=>self.skipWaiting()));
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
  }));
});