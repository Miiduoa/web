import './origin-gateway.js';
import './login-transport-patience.js';
import './avatar-guard.js';
import {authView} from './views/auth.js';
import {shellView} from './views/shell.js';
import {dialogsView} from './views/dialogs.js';

window.CAMPUS_SOCIAL_ENDPOINT='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-social';

async function startModule(path){
  try{return await import(path)}
  catch(error){console.error(`nolu module failed: ${path}`,error);return null}
}

await import('./session-recovery.js');
await import('./guest-privacy.js');
await import('./account-boundary.js');

const root=document.querySelector('#app');
root.innerHTML=authView()+shellView()+dialogsView();

await import('./durable-bridge.js');
await import('./app.js');
const scheduleUI=await import('./features/schedule.js');

localStorage.setItem('puplan_presentation',localStorage.getItem('puplan_schedule_presentation')||'human');
await import('./transport-bridge.js');
await import('./resilience.js');
await import('./login-failover-budget.js');
await import('./offline-session-rescue.js');
await import('./cloud.js');
await import('./cloud-replication.js');
await import('./provider-mesh.js');
await import('./outage-mirror-bridge.js');
await startModule('./provider-status.js');

// Install the admin transport wrapper before admin.js boots. Read-only admin
// screens can fail over to Tokyo with a Tokyo-local session; all mutations stay
// primary-only to avoid split-brain moderation or account changes.
await startModule('./admin-failover.js');

await startModule('./auth.js');
await Promise.all([
  './social-ui.js',
  './import.js',
  './semesters.js',
  './community.js',
  './discover.js',
  './pwa.js',
  './features/planner.js',
  './admin.js',
  './privacy.js'
].map(startModule));

function reclaimScheduleUI(){
  const human=document.querySelector('#humanWeek');
  const classic=document.querySelector('#classicSchedule');
  const legacyStrip=document.querySelector('#nowStrip');
  human?.classList.remove('hidden');
  classic?.classList.remove('hidden');
  legacyStrip?.classList.add('hidden');
  const presentation=localStorage.getItem('puplan_schedule_presentation')||'human';
  localStorage.setItem('puplan_presentation',presentation);
  scheduleUI.renderSchedule();
  document.querySelectorAll('[data-presentation]').forEach(button=>{
    button.onclick=()=>{
      const mode=button.dataset.presentation||'human';
      localStorage.setItem('puplan_presentation',mode);
      scheduleUI.applyPresentation(mode);
    };
  });
}

reclaimScheduleUI();
document.addEventListener('puplan:courses-changed',()=>queueMicrotask(reclaimScheduleUI));
document.addEventListener('click',event=>{
  if(event.target.closest?.('[data-day],[data-schedule-mode]'))setTimeout(reclaimScheduleUI,0);
});
