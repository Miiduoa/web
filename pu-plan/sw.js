const CACHE='nolu-shell-20260913-runtime-shell13';
const GENERATION=CACHE.slice('nolu-shell-'.length);
const ROOT=new URL('./',self.registration.scope).href;
const PATHS=[
  './','./index.html','./manifest.webmanifest','./nolu-icon.svg','./nolu-mesh-jwks.json',
  './main.js','./auth-trace.js','./media-input-guard.js','./origin-gateway.js','./media-failback-guard.js','./login-transport-patience.js','./login-failover-budget.js','./app.js','./guest-privacy.js','./account-boundary.js','./session-recovery.js','./durable-store.js','./durable-bridge.js','./transport-bridge.js','./resilience.js','./offline-session-rescue.js','./cloud.js','./cloud-replication.js','./provider-config.js','./provider-mesh.js','./outage-mirror-bridge.js','./provider-status.js','./auth.js','./social-ui.js','./import.js','./semesters.js','./community.js','./discover.js','./pwa.js','./admin-failover.js','./admin.js','./admin-mobile.js','./privacy.js',
  './core/state.js','./features/analysis.js','./features/friends.js','./features/navigation.js','./features/planner.js','./features/schedule.js','./features/settings.js','./features/share.js',
  './views/assistant.js','./views/auth.js','./views/dialogs.js','./views/friends.js','./views/schedule.js','./views/settings.js','./views/shell.js',
  './styles/base.css','./styles/auth.css','./styles/layout.css','./styles/schedule.css','./styles/assistant.css','./styles/dialogs.css','./styles/schedule-ownership.css','./friends.css','./community.css','./discover.css','./admin.css','./pwa.css'
];
const SHELL=PATHS.map(path=>new URL(path,ROOT).href);

async function fetchedText(fetched,path){
  const url=new URL(path,ROOT).href;
  const entry=fetched.find(([candidate])=>candidate===url);
  if(!entry)throw new Error(`SHELL_GENERATION_METADATA_MISSING ${path}`);
  const copy=entry[1].clone();
  if(!copy||typeof copy.text!=='function')throw new Error(`SHELL_GENERATION_METADATA_UNREADABLE ${path}`);
  return copy.text();
}

async function verifyFetchedGeneration(fetched){
  const [html,pwa]=await Promise.all([
    fetchedText(fetched,'./index.html'),
    fetchedText(fetched,'./pwa.js')
  ]);
  const versions=[...html.matchAll(/\?v=([A-Za-z0-9_-]+)/g)].map(match=>match[1]);
  if(!versions.length||versions.some(version=>version!==GENERATION)){
    throw new Error(`SHELL_GENERATION_MISMATCH index.html expected=${GENERATION}`);
  }
  const pwaGeneration=pwa.match(/const SHELL_GENERATION='([^']+)'/)?.[1];
  if(pwaGeneration!==GENERATION){
    throw new Error(`SHELL_GENERATION_MISMATCH pwa.js expected=${GENERATION}`);
  }
}

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

  // A deploy can briefly expose files from different commits. Prove the fetched
  // HTML and PWA runtime belong to this exact worker generation before opening
  // or writing the new cache. Mixed releases fail closed and keep the active
  // last-known-good shell untouched.
  await verifyFetchedGeneration(fetched);

  const cache=await caches.open(CACHE);
  try{
    for(const [url,response] of fetched)await cache.put(url,response);
  }catch(error){
    await caches.delete(CACHE);
    throw error;
  }
}

self.addEventListener('install',event=>{
  // Do not take over an already-open Nolu window. In particular, never switch
  // service-worker control while iOS is returning from the Photos picker or while
  // the user is composing a post. The new shell becomes active after old clients
  // close naturally, then controls the next normal navigation.
  event.waitUntil(seed());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key.startsWith('nolu-shell-')&&key!==CACHE).map(key=>caches.delete(key)));
    // Intentionally no clients.claim(): mid-session takeover can fire
    // controllerchange and bounce a standalone iPhone PWA back to its start view.
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