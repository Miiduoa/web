const fs=require('fs');
const vm=require('vm');
const assert=require('assert');

const source=fs.readFileSync('pu-plan/guest-privacy.js','utf8');
const UID_A='11111111-1111-4111-8111-111111111111';
const UID_B='22222222-2222-4222-8222-222222222222';
const now=()=>Math.floor(Date.now()/1000);
function tokenFor(uid,exp=now()+3600,version=4,iat=null){
  const issued=iat??Math.min(now(),Number(exp)-3600);
  return `${Buffer.from(JSON.stringify({v:version,uid,iat:issued,exp,cv:'cv-test'})).toString('base64url')}.test-signature`;
}

function makeStorage(seed={}){
  const map=new Map(Object.entries(seed));
  return {
    get length(){return map.size},
    key(i){return [...map.keys()][i]??null},
    getItem(k){return map.has(k)?map.get(k):null},
    setItem(k,v){map.set(k,String(v))},
    removeItem(k){map.delete(k)},
    dump(){return Object.fromEntries(map)}
  };
}

function boot(localSeed,sessionSeed={},recovery=null){
  const localStorage=makeStorage(localSeed);
  const sessionStorage=makeStorage(sessionSeed);
  const listeners={};
  const document={addEventListener(type,fn,capture){listeners[type]={fn,capture}}};
  const window=recovery?{NOLU_SESSION_RECOVERY:{result:recovery}}:{};
  vm.runInNewContext(source,{localStorage,sessionStorage,document,window,Date});
  return {localStorage,sessionStorage,listeners};
}

const privateSeed={
  puplan_name:'Alice',
  puplan_username:'alice',
  puplan_bio:'secret',
  puplan_avatar:'data:image/png;base64,AA==',
  puplan_discoverable:'1',
  puplan_courses:'[{"name":"Private class"}]',
  puplan_friends:'[{"name":"Bob"}]',
  puplan_schedule_meta:'{"school":"Private"}',
  puplan_course_owner:UID_A
};

{
  const x=boot({...privateSeed,puplan_guest:'1'},{puplan_assistant_history:'private chat'});
  const data=x.localStorage.dump();
  assert.equal(data.puplan_guest,'1');
  assert.equal(data.nolu_guest_scope_v1,'1');
  for(const key of Object.keys(privateSeed))assert.equal(data[key],undefined,`legacy guest leaked ${key}`);
  assert.equal(x.sessionStorage.getItem('puplan_assistant_history'),null);
}

{
  const x=boot({puplan_guest:'1',nolu_guest_scope_v1:'1',puplan_courses:'[{"name":"Guest class"}]'});
  assert.equal(x.localStorage.getItem('puplan_courses'),'[{"name":"Guest class"}]');
}

{
  const x=boot({...privateSeed,puplan_guest:'1',nolu_guest_scope_v1:'1',puplan_session:tokenFor(UID_A)});
  const data=x.localStorage.dump();
  assert.equal(data.puplan_guest,'1');
  assert.equal(data.puplan_session,undefined);
  for(const key of Object.keys(privateSeed))assert.equal(data[key],undefined,`guest/token conflict leaked ${key}`);
}

{
  const session=tokenFor(UID_A);
  const x=boot({
    ...privateSeed,
    puplan_session:session,
    puplan_session_primary_v1:session,
    [`nolu_account_snapshot_v1:${UID_A}`]:'{"trusted":"later"}'
  },{puplan_assistant_history:'private chat'});
  const data=x.localStorage.dump();
  assert.equal(data.puplan_session,session,'canonical session must remain available for verification');
  assert.equal(data.puplan_session_primary_v1,session,'same-account regional recovery credential should survive quarantine');
  assert.equal(data[`nolu_account_snapshot_v1:${UID_A}`],'{"trusted":"later"}','same-account recovery material should survive quarantine');
  for(const key of Object.keys(privateSeed))assert.equal(data[key],undefined,`pre-render cache survived quarantine: ${key}`);
  assert.equal(x.sessionStorage.getItem('puplan_assistant_history'),null);
}

{
  const oldRegional=tokenFor(UID_A),newToken=tokenFor(UID_B);
  const x=boot({
    ...privateSeed,
    puplan_session:newToken,
    puplan_session_primary_v1:oldRegional,
    [`nolu_account_snapshot_v1:${UID_A}`]:'{"old":true}',
    [`nolu_pending_mutations_v1:${UID_A}`]:'{"old":true}'
  },{puplan_assistant_history:'private chat'});
  const data=x.localStorage.dump();
  assert.equal(data.puplan_session,newToken);
  assert.equal(data.puplan_session_primary_v1,undefined);
  assert.equal(data[`nolu_account_snapshot_v1:${UID_A}`],undefined);
  assert.equal(data[`nolu_pending_mutations_v1:${UID_A}`],undefined);
  for(const key of Object.keys(privateSeed))assert.equal(data[key],undefined,`account switch leaked ${key}`);
}

{
  const expired=tokenFor(UID_A,now()-1);
  const x=boot({...privateSeed,puplan_session:expired},{puplan_assistant_history:'private chat'},{status:'local-grace',uid:UID_A});
  const data=x.localStorage.dump();
  assert.equal(data.puplan_session,expired);
  for(const key of Object.keys(privateSeed))assert.equal(data[key],undefined,`local grace exposed ${key}`);
}

{
  const expired=tokenFor(UID_A,now()-1);
  const x=boot({...privateSeed,puplan_session:expired},{puplan_assistant_history:'private chat'});
  assert.equal(x.localStorage.getItem('puplan_session'),null);
}
{
  const x=boot({...privateSeed,puplan_session:tokenFor(UID_A,now()+3600,3)});
  assert.equal(x.localStorage.getItem('puplan_session'),null);
}
{
  const x=boot({...privateSeed,puplan_session:'malformed-token'});
  assert.equal(x.localStorage.getItem('puplan_session'),null);
}

// If the server rejects a syntactically valid session, the UID tracked before
// quarantine must still be available to remove recovery snapshots and pending data.
{
  const session=tokenFor(UID_A);
  const x=boot({
    ...privateSeed,
    puplan_session:session,
    puplan_session_primary_v1:session,
    [`nolu_account_snapshot_v1:${UID_A}`]:'{"private":true}',
    [`nolu_pending_mutations_v1:${UID_A}`]:'{"private":true}'
  });
  assert.equal(x.localStorage.getItem(`nolu_account_snapshot_v1:${UID_A}`),'{"private":true}');
  x.localStorage.removeItem('puplan_session');
  x.listeners['puplan:profile-changed'].fn({detail:null});
  assert.equal(x.localStorage.getItem(`nolu_account_snapshot_v1:${UID_A}`),null);
  assert.equal(x.localStorage.getItem(`nolu_pending_mutations_v1:${UID_A}`),null);
  assert.equal(x.localStorage.getItem('puplan_session_primary_v1'),null);
}

{
  const session=tokenFor(UID_A);
  const x=boot({...privateSeed,puplan_session:session,puplan_session_primary_v1:session,[`nolu_account_snapshot_v1:${UID_A}`]:'{}'});
  const target={closest(selector){return selector==='#guestMode'?{}:null}};
  x.listeners.click.fn({target});
  const data=x.localStorage.dump();
  assert.equal(data.puplan_guest,'1');
  assert.equal(data.nolu_guest_scope_v1,'1');
  assert.equal(data.puplan_session,undefined);
  assert.equal(data.puplan_session_primary_v1,undefined);
  assert.equal(data[`nolu_account_snapshot_v1:${UID_A}`],undefined);
}

console.log('guest privacy isolation: ok');
