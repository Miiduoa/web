const fs=require('fs');
const vm=require('vm');
const assert=require('assert');

const source=fs.readFileSync('pu-plan/guest-privacy.js','utf8');

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

function boot(localSeed,sessionSeed={}){
  const localStorage=makeStorage(localSeed);
  const sessionStorage=makeStorage(sessionSeed);
  const listeners={};
  const document={addEventListener(type,fn,capture){listeners[type]={fn,capture}}};
  vm.runInNewContext(source,{localStorage,sessionStorage,document});
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
  puplan_course_owner:'user-a'
};

// Legacy guest sessions created before the privacy guard are scrubbed once.
{
  const x=boot({...privateSeed,puplan_guest:'1'},{puplan_assistant_history:'private chat'});
  const data=x.localStorage.dump();
  assert.equal(data.puplan_guest,'1');
  assert.equal(data.nolu_guest_scope_v1,'1');
  for(const key of Object.keys(privateSeed))assert.equal(data[key],undefined,`legacy guest leaked ${key}`);
  assert.equal(x.sessionStorage.getItem('puplan_assistant_history'),null);
}

// Once migrated, a guest keeps only data created inside the guest scope.
{
  const x=boot({puplan_guest:'1',nolu_guest_scope_v1:'1',puplan_courses:'[{"name":"Guest class"}]'});
  assert.equal(x.localStorage.getItem('puplan_courses'),'[{"name":"Guest class"}]');
}

// Signed-in users keep their own account cache until they explicitly enter guest mode.
{
  const x=boot({...privateSeed,puplan_session:'valid-token'});
  assert.equal(x.localStorage.getItem('puplan_name'),'Alice');
  assert.equal(x.localStorage.getItem('puplan_courses'),'[{"name":"Private class"}]');
}

// Entering guest mode clears account data before cloud.js' click handler runs.
{
  const x=boot({...privateSeed,puplan_session:'valid-token'},{puplan_assistant_history:'private chat'});
  const target={closest(selector){return selector==='#guestMode'?{}:null}};
  x.listeners.click.fn({target});
  const data=x.localStorage.dump();
  assert.equal(data.puplan_guest,'1');
  assert.equal(data.nolu_guest_scope_v1,'1');
  assert.equal(data.puplan_session,undefined);
  for(const key of Object.keys(privateSeed))assert.equal(data[key],undefined,`guest transition leaked ${key}`);
  assert.equal(x.sessionStorage.getItem('puplan_assistant_history'),null);
}

console.log('guest privacy isolation: ok');
