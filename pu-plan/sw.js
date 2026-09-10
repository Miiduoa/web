const CACHE='nolu-shell-20260910-0004';
const ROOT=new URL('./',self.registration.scope).href;
const SHELL=['./','./index.html','./manifest.webmanifest','./nolu-icon.svg'].map(path=>new URL(path,ROOT).href);

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)));
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
        return (await caches.match(event.request))||(await caches.match(new URL('./index.html',ROOT).href))||Response.error();
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
