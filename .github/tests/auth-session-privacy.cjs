const fs=require('fs');
const vm=require('vm');
const assert=require('assert');

const source=fs.readFileSync('pu-plan/auth.js','utf8');

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

function boot({local={},session={},signed=false}={}){
  const localStorage=makeStorage(local);
  const sessionStorage=makeStorage(session);
  const listeners={};
  const cloud={
    isSignedIn:()=>signed,
    showGate:()=>{},
    logout:async()=>{}
  };
  const window={PUPLAN_CLOUD:cloud};
  const document={
    querySelector:()=>null,
    addEventListener:(type,fn)=>{listeners[type]=fn},
    body:{contains:()=>true}
  };
  vm.runInNewContext(source,{window,document,localStorage,sessionStorage,setTimeout:()=>0,console});
  return {window,localStorage,sessionStorage,listeners};
}

// A valid signed-in account keeps its own assistant session.
{
  const x=boot({signed:true,local:{puplan_session:'valid'},session:{puplan_assistant_history:'mine'}});
  assert.equal(x.sessionStorage.getItem('puplan_assistant_history'),'mine');
}

// Guest-created assistant state survives ordinary guest reloads.
{
  const x=boot({signed:false,local:{puplan_guest:'1'},session:{puplan_assistant_history:'guest chat'}});
  assert.equal(x.sessionStorage.getItem('puplan_assistant_history'),'guest chat');
}

// An expired/invalid account session must not leave AI history for the next login.
{
  const x=boot({signed:false,session:{puplan_assistant_history:'previous account',puplan_assistant_thread_1:'secret'}});
  assert.equal(x.sessionStorage.getItem('puplan_assistant_history'),null);
  assert.equal(x.sessionStorage.getItem('puplan_assistant_thread_1'),null);
}

// Losing the profile after startup also scrubs account-scoped assistant state.
{
  const x=boot({signed:true,local:{puplan_session:'valid'},session:{puplan_assistant_history:'private'}});
  x.localStorage.removeItem('puplan_session');
  x.listeners['puplan:profile-changed']({detail:null});
  assert.equal(x.sessionStorage.getItem('puplan_assistant_history'),null);
}

// Explicitly opening login from guest mode starts a clean account session.
{
  const x=boot({signed:false,local:{puplan_guest:'1'},session:{puplan_assistant_history:'guest chat'}});
  x.window.PUPLAN_AUTH.login();
  assert.equal(x.localStorage.getItem('puplan_guest'),null);
  assert.equal(x.sessionStorage.getItem('puplan_assistant_history'),null);
}

console.log('auth assistant-session privacy: ok');
