const CACHE='nolu-shell-20260909-2310';
const CORE=[
  './','./index.html','./main.js','./app.js','./nolu-icon.svg','./manifest.webmanifest',
  './core/state.js',
  './features/schedule.js','./features/friends.js','./features/share.js','./features/analysis.js','./features/navigation.js','./features/settings.js',
  './styles/base.css','./styles/auth.css','./styles/layout.css','./styles/schedule.css','./styles/assistant.css','./styles/dialogs.css','./styles/mobile.css',
  './views/auth.js','./views/shell.js','./views/schedule.js','./views/friends.js','./views/assistant.js','./views/settings.js','./views/dialogs.js',
  './friends.css','./community.css','./discover.css','./admin.css','./pwa.css',
  './cloud.js','./social-ui.js','./import.js','./boot.js','./security.js','./auth.js','./semesters.js','./community.js','./discover.js','./planner.js','./admin.js','./privacy.js','./pwa.js'
];
self.addEventListener('install',event=>{event.waitUntil((async()=>{const cache=await caches.open(CACHE);for(const item of CORE){try{await cache.add(item)}catch{}}})());self.skipWaiting()});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))));self.clients.claim()});
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;const url=new URL(event.request.url);if(url.origin!==location.origin)return;const fresh=/\.(?:html?|css|js|webmanifest)$/i.test(url.pathname)||event.request.mode==='navigate';event.respondWith((async()=>{try{const response=await fetch(event.request,{cache:fresh?'reload':'default'});if(response.ok){const cache=await caches.open(CACHE);cache.put(event.request,response.clone()).catch(()=>{})}return response}catch{return(await caches.match(event.request))||(await caches.match('./'))||Response.error()}})())});
self.addEventListener('notificationclick',event=>{event.notification.close();const target=event.notification?.data?.url||new URL('./',self.location.href).href;event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(async windows=>{for(const win of windows){try{await win.navigate(target);return win.focus()}catch{}}return clients.openWindow(target)}))});
