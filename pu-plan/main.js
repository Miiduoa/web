import './guest-privacy.js';
import './avatar-guard.js';
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

await import('./app.js');
const scheduleUI=await import('./features/schedule.js');

// Keep the old social-ui preference aligned until its remaining social code is
// fully separated from the schedule feature. This prevents it from switching a
// saved classic timetable back to the old human presentation while it loads.
localStorage.setItem('puplan_presentation',localStorage.getItem('puplan_schedule_presentation')||'human');

// Restore the signed-in account's durable IndexedDB snapshot/outbox first. This
// gives iPhone/PWA launches a second local copy before any cloud bootstrap runs.
await import('./durable-bridge.js');

// Some older modules still call the original API path directly. Give those
// requests the same three-path transport failover before resilience captures fetch.
await import('./transport-bridge.js');

// Install the transport/offline resilience layer before cloud bootstrap. It can
// fail over between cloud endpoints, serve the signed-in user's own cached data
// during an outage, and queue safe writes until a cloud backend is healthy again.
await import('./resilience.js');

// cloud.js exposes window.PUPLAN_CLOUD before its authenticated bootstrap finishes.
// Await the whole module so the signed-in user's profile and schedule are hydrated
// before semesters/auth/social/import modules can read or write account state.
await import('./cloud.js');

// Bind account controls first. The remaining modules all depend only on the shell,
// app state, and the cloud bootstrap above, so fetch/evaluate them concurrently.
// Keeping auth first preserves account-control ordering while removing the serial
// feature-module waterfall that is especially costly on mobile/PWA connections.
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

// social-ui.js still contains a legacy timetable renderer. Until that module is
// split, make features/schedule.js the final owner of schedule DOM and controls.
// This prevents the legacy renderer from hiding #classicSchedule or replacing
// #humanWeek after the current schedule renderer has already finished.
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
