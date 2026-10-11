import './auth-trace.js';
import './media-input-guard.js';
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

// Reconstruct the canonical device credential before any privacy/cache decision.
// This keeps regional failover usable after an interrupted cloud-auth attempt.
await import('./session-recovery.js');

// Apply guest/account isolation before the application can render storage-backed data.
await import('./guest-privacy.js');

// Once an authenticated owner has been established, any logout, guest transition,
// or A -> B account switch gets a hard page boundary. This prevents feature-module
// memory caches and in-flight responses from surviving into another identity.
await import('./account-boundary.js');

const root=document.querySelector('#app');
const recoveryStatus=String(window.NOLU_SESSION_RECOVERY?.result?.status||'');
const hideInitialAuthGate=localStorage.getItem('puplan_guest')==='1'||['canonical-ok','recovered','local-grace'].includes(recoveryStatus);
root.innerHTML=authView({hidden:hideInitialAuthGate})+shellView()+dialogsView();
window.NOLU_AUTH_TRACE?.record?.('auth-gate-initial',{status:hideInitialAuthGate?'hidden':'visible',source:recoveryStatus||'none'});

// Bind the current raw session to its exact durable IndexedDB snapshot before app.js
// reads profile/schedule state. If no exact binding exists, the cache stays empty and
// the authenticated cloud bootstrap below becomes the only source of account data.
await import('./durable-bridge.js');

await import('./app.js');
const scheduleUI=await import('./features/schedule.js');

// Some older modules still call the original API path directly. Give those
// requests the same multi-path transport failover before resilience captures fetch.
await import('./transport-bridge.js');

// Install the transport/offline resilience layer before cloud bootstrap. It can
// fail over between the Mumbai primary, Tokyo standby, compatibility endpoints,
// and the signed-in user's own durable local cache.
await import('./resilience.js');

// A login may legitimately spend several seconds waiting on Mumbai before Tokyo
// is attempted. Preserve a bounded end-to-end window so cloud.js's legacy request
// timeout cannot abort the standby leg before it has a fair chance to authenticate.
await import('./login-failover-budget.js');

// If the database is unreachable, a previously authenticated device can still
// prove possession of its exact session-bound IndexedDB snapshot. This wrapper
// only rescues bootstrap/profile/schedule requests; it never accepts a password
// or creates a new identity while the cloud cannot verify one.
await import('./offline-session-rescue.js');

// cloud.js exposes window.PUPLAN_CLOUD before its authenticated bootstrap finishes.
// Await the whole module so the signed-in user's profile and schedule are hydrated
// before semesters/auth/social/import modules can read or write account state.
await import('./cloud.js');

// Reconcile core account/profile/schedule/semester state to the independent Tokyo
// project through the audited primary -> standby replica-v3 enrollment path.
await import('./cloud-replication.js');

// Fan the same session-bound durable snapshot to independent provider failure
// domains (Supabase + Neon + Render once provisioned). Remote recovery requires
// two non-Supabase mirrors to agree on the exact revision+digest before it can
// replace a local copy, so one corrupted provider cannot silently overwrite data.
await import('./provider-mesh.js');

// If the authoritative Supabase database is unreachable and the device only has
// a recently-expired, still-cryptographically-valid regional session, keep the
// exact fingerprint-bound IndexedDB snapshot backed up to independent mirrors.
// This bridge is write-only continuity: it cannot create an account or authenticate
// against the app APIs, and it never replaces local state from a single mirror.
await import('./outage-mirror-bridge.js');
await startModule('./provider-status.js');

// Read-only management screens may use the Tokyo copy during a Mumbai outage.
// Mutating admin actions remain primary-only to prevent split-brain moderation.
await startModule('./admin-failover.js');

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

// Mobile hides the desktop sidebar entirely. Mount a dedicated admin entry only
// after the authenticated profile and the guarded admin module are ready.
await startModule('./admin-mobile.js');

// The schedule feature is the sole owner of timetable DOM and controls.
scheduleUI.renderSchedule();
