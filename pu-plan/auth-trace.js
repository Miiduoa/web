const TRACE_KEY='nolu_auth_trace_v1';
const TAB_KEY='nolu_auth_trace_tab_v1';
const MAX_EVENTS=80;
const VERSION='20260913-auth-trace2';
const ALLOWED_FIELDS=new Set([
  'reason','status','source','transition','action','outcome','mode','stage',
  'httpStatus','reload','controller','recovered','expired','connectivity','guest'
]);

function tabId(){
  try{
    let id=sessionStorage.getItem(TAB_KEY)||'';
    if(!id){
      id=`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
      sessionStorage.setItem(TAB_KEY,id);
    }
    return id;
  }catch{return 'tab-unknown'}
}

function read(){
  try{
    const value=JSON.parse(localStorage.getItem(TRACE_KEY)||'[]');
    return Array.isArray(value)?value.slice(-MAX_EVENTS):[];
  }catch{return[]}
}

function cleanValue(value){
  if(typeof value==='boolean')return value;
  if(typeof value==='number'&&Number.isFinite(value))return value;
  if(typeof value==='string')return value.replace(/[\r\n\t]+/g,' ').slice(0,96);
  return undefined;
}

function cleanDetails(details){
  const out={};
  if(!details||typeof details!=='object')return out;
  for(const [key,value] of Object.entries(details)){
    if(!ALLOWED_FIELDS.has(key))continue;
    const clean=cleanValue(value);
    if(clean!==undefined&&clean!=='')out[key]=clean;
  }
  return out;
}

function record(type,details={}){
  try{
    const event={
      at:Date.now(),
      tab:tabId(),
      type:String(type||'event').replace(/[^a-z0-9:_-]/gi,'').slice(0,48)||'event',
      ...cleanDetails(details)
    };
    const events=read();
    events.push(event);
    localStorage.setItem(TRACE_KEY,JSON.stringify(events.slice(-MAX_EVENTS)));
    return event;
  }catch{return null}
}

function navigationSource(){
  try{return performance.getEntriesByType?.('navigation')?.[0]?.type||'unknown'}catch{return'unknown'}
}
function snapshot(){return read().map(event=>({...event}))}
function clear(){try{localStorage.removeItem(TRACE_KEY)}catch{}}
function exportText(){return JSON.stringify({version:VERSION,events:snapshot()},null,2)}

window.NOLU_AUTH_TRACE={
  version:VERSION,
  key:TRACE_KEY,
  maxEvents:MAX_EVENTS,
  record,
  snapshot,
  clear,
  exportText
};

record('trace-ready',{stage:'startup',source:navigationSource()});
addEventListener('pageshow',event=>record('page-lifecycle',{stage:'pageshow',source:event.persisted?'bfcache':'document'}));
addEventListener('pagehide',event=>record('page-lifecycle',{stage:'pagehide',outcome:event.persisted?'bfcache':'unload'}));
addEventListener('beforeunload',()=>record('page-lifecycle',{stage:'beforeunload'}));
addEventListener('error',()=>record('page-runtime-error',{stage:'error',status:'uncaught'}));
addEventListener('unhandledrejection',()=>record('page-runtime-error',{stage:'promise',status:'unhandled'}));
