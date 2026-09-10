import {authView} from './views/auth.js';
import {shellView} from './views/shell.js';
import {dialogsView} from './views/dialogs.js';

window.CAMPUS_SOCIAL_ENDPOINT='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-social';

const root=document.querySelector('#app');
root.innerHTML=authView()+shellView()+dialogsView();

async function startModule(path){
  try{return await import(path)}
  catch(error){console.error(`nolu module failed: ${path}`,error);return null}
}

async function waitForCloudController(timeout=1800){
  const started=performance.now();
  while(!window.PUPLAN_CLOUD&&performance.now()-started<timeout){
    await new Promise(resolve=>setTimeout(resolve,30));
  }
  return !!window.PUPLAN_CLOUD;
}

await import('./app.js');

// cloud.js performs an authenticated bootstrap with top-level await. Start it first,
// but do not let a slow/unreachable API freeze every other Nolu module (including PWA recovery).
const cloudLoad=startModule('./cloud.js');
await waitForCloudController();

for(const path of [
  './auth.js',
  './social-ui.js',
  './import.js',
  './semesters.js',
  './community.js',
  './discover.js',
  './pwa.js',
  './features/planner.js',
  './admin.js',
  './privacy.js'
])await startModule(path);

// Keep the bootstrap alive in the background; startModule already reports failures.
void cloudLoad;
