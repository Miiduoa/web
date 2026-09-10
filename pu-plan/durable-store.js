const DB_NAME='nolu-resilience-v2';
const DB_VERSION=1;
const SNAPSHOTS='snapshots';
const OUTBOX='outbox';
let dbPromise=null;

const requestResult=request=>new Promise((resolve,reject)=>{
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error||new Error('IndexedDB request failed'));
});

function openDb(){
  if(dbPromise)return dbPromise;
  if(!('indexedDB'in window))return Promise.resolve(null);
  dbPromise=new Promise(resolve=>{
    let request;
    try{request=indexedDB.open(DB_NAME,DB_VERSION)}catch{return resolve(null)}
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains(SNAPSHOTS))db.createObjectStore(SNAPSHOTS,{keyPath:'uid'});
      if(!db.objectStoreNames.contains(OUTBOX)){
        const store=db.createObjectStore(OUTBOX,{keyPath:'id'});
        store.createIndex('by_uid','uid',{unique:false});
        store.createIndex('by_uid_changed',['uid','changedAt'],{unique:false});
      }
    };
    request.onsuccess=()=>{
      const db=request.result;
      db.onversionchange=()=>db.close();
      resolve(db);
    };
    request.onerror=()=>resolve(null);
    request.onblocked=()=>resolve(null);
  });
  return dbPromise;
}

async function run(storeName,mode,fn){
  const db=await openDb();
  if(!db)return null;
  return new Promise(resolve=>{
    let settled=false,completed=false,resultReady=false,result=null;
    const finish=value=>{if(!settled){settled=true;resolve(value)}};
    let tx;
    try{tx=db.transaction(storeName,mode)}catch{return finish(null)}
    tx.onabort=()=>finish(null);
    tx.onerror=()=>finish(null);
    tx.oncomplete=()=>{completed=true;if(resultReady)finish(result)};
    try{
      Promise.resolve(fn(tx.objectStore(storeName),tx)).then(value=>{
        result=value;resultReady=true;if(completed)finish(value);
      }).catch(()=>{
        try{tx.abort()}catch{}
        finish(null);
      });
    }catch{
      try{tx.abort()}catch{}
      finish(null);
    }
  });
}

export async function requestPersistentStorage(){
  try{
    if(!navigator.storage?.persist)return false;
    if(await navigator.storage.persisted?.())return true;
    return await navigator.storage.persist();
  }catch{return false}
}

export async function getSnapshot(uid){
  if(!uid)return null;
  return run(SNAPSHOTS,'readonly',store=>requestResult(store.get(uid)));
}

export async function putSnapshot(value){
  if(!value?.uid)return false;
  const ok=await run(SNAPSHOTS,'readwrite',store=>requestResult(store.put(value)).then(()=>true));
  return ok===true;
}

export async function putMutation(value){
  if(!value?.id||!value?.uid||!value?.action)return false;
  const ok=await run(OUTBOX,'readwrite',store=>requestResult(store.put(value)).then(()=>true));
  return ok===true;
}

export async function getMutation(id){
  if(!id)return null;
  return run(OUTBOX,'readonly',store=>requestResult(store.get(id)));
}

export async function listMutations(uid){
  if(!uid)return[];
  const rows=await run(OUTBOX,'readonly',store=>{
    const index=store.index('by_uid');
    return requestResult(index.getAll(IDBKeyRange.only(uid)));
  });
  return Array.isArray(rows)?rows.sort((a,b)=>(a.changedAt||0)-(b.changedAt||0)):[];
}

export async function deleteMutation(id){
  if(!id)return false;
  const ok=await run(OUTBOX,'readwrite',store=>requestResult(store.delete(id)).then(()=>true));
  return ok===true;
}

export async function clearUser(uid){
  if(!uid)return false;
  const db=await openDb();
  if(!db)return false;
  return new Promise(resolve=>{
    let tx;
    try{tx=db.transaction([SNAPSHOTS,OUTBOX],'readwrite')}catch{return resolve(false)}
    const snaps=tx.objectStore(SNAPSHOTS),outbox=tx.objectStore(OUTBOX),index=outbox.index('by_uid');
    snaps.delete(uid);
    const cursor=index.openCursor(IDBKeyRange.only(uid));
    cursor.onsuccess=()=>{const c=cursor.result;if(c){c.delete();c.continue()}};
    tx.oncomplete=()=>resolve(true);
    tx.onerror=()=>resolve(false);
    tx.onabort=()=>resolve(false);
  });
}

export async function updateMutation(id,patch={}){
  const current=await getMutation(id);
  if(!current)return false;
  return putMutation({...current,...patch,id:current.id,uid:current.uid,action:current.action});
}

export const DURABLE_STORE_VERSION=DB_NAME;
