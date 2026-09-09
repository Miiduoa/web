const asset=name=>new URL(name,import.meta.url).href;
function link(rel,href,key){if(document.querySelector(`[data-${key}]`))return;const el=document.createElement('link');el.rel=rel;el.href=href;el.dataset[key]='1';document.head.appendChild(el)}
link('stylesheet',asset('./ui-v9.css'),'puplanV9Style');
link('manifest',asset('./manifest-v9.webmanifest'),'puplanManifestV9');
link('apple-touch-icon',asset('./icon.svg'),'puplanIconV9');
await import(asset('./pwa-v9.js')).catch(e=>console.warn('PWA v9',e));