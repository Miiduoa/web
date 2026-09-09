import {authView} from './views/auth.js';
import {shellView} from './views/shell.js';
import {dialogsView} from './views/dialogs.js';

const root=document.querySelector('#app');
root.innerHTML=authView()+shellView()+dialogsView();

function loadScript(src){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>reject(new Error(`無法載入 ${src}`));document.head.appendChild(s)})}

await import('./app.js');
await import('./cloud.js');
await import('./social-ui.js');
try{if(!window.Tesseract)await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@6/dist/tesseract.min.js');await import('./import.js')}catch(e){console.error('課表辨識載入失敗',e)}
await import('./boot.js');
