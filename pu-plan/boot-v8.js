const asset=(name)=>new URL(name,import.meta.url).href;
function ensureLink(rel,href,marker){if(document.querySelector(`[data-${marker}]`))return;const l=document.createElement('link');l.rel=rel;l.href=href;l.dataset[marker]='1';document.head.appendChild(l)}
ensureLink('stylesheet',asset('./pwa-v8.css'),'puplanV8Style');
ensureLink('manifest',asset('./manifest.webmanifest'),'puplanManifest');
ensureLink('apple-touch-icon',asset('./icon.svg'),'puplanIcon');
document.querySelector('.profile-settings')?.classList.add('profile-editor');
await import(asset('./pwa-v8.js'));
