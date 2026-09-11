const fs=require('fs');
const vm=require('vm');
const assert=require('assert');

const privacy=fs.readFileSync('pu-plan/guest-privacy.js','utf8');
const UID='11111111-1111-4111-8111-111111111111';
const now=Math.floor(Date.now()/1000);
const token=`${Buffer.from(JSON.stringify({v:4,uid:UID,iat:now-60,exp:now+3600,cv:'cv-test'})).toString('base64url')}.test-signature`;

function storage(seed={}){
  const map=new Map(Object.entries(seed));
  return {
    get length(){return map.size},
    key(i){return [...map.keys()][i]??null},
    getItem(k){return map.has(k)?map.get(k):null},
    setItem(k,v){map.set(k,String(v))},
    removeItem(k){map.delete(k)}
  };
}

const localStorage=storage({
  puplan_guest:'1',
  puplan_session:token,
  puplan_course_owner:UID,
  [`nolu_standby_dirty_v3:${UID}`]:'1',
  [`nolu_standby_seeded_v3:${UID}`]:'1',
  [`nolu_pending_mutations_v1:${UID}`]:'{"schedule":{}}'
});
const sessionStorage=storage();
const document={addEventListener(){}};
vm.runInNewContext(privacy,{localStorage,sessionStorage,document,window:{},Date});
assert.equal(localStorage.getItem(`nolu_standby_dirty_v3:${UID}`),null,'guest boundary must clear v3 standby dirty marker');
assert.equal(localStorage.getItem(`nolu_standby_seeded_v3:${UID}`),null,'guest boundary must clear v3 standby seeded marker');
assert.equal(localStorage.getItem(`nolu_pending_mutations_v1:${UID}`),null,'guest boundary must clear pending mutations');

const resilience=fs.readFileSync('pu-plan/resilience.js','utf8');
assert.match(resilience,/const STANDBY_DIRTY_PREFIX='nolu_standby_dirty_v3:';/);
assert.match(resilience,/if\(api===STANDBY\)markStandbyMutation\(uid,'update_profile'\)/);
assert.match(resilience,/if\(api===STANDBY\)markStandbyMutation\(uid,'save_schedule'\)/);
assert.match(resilience,/localStorage\.setItem\(`\$\{STANDBY_DIRTY_PREFIX\}\$\{uid\}`,'1'\)/);
assert.match(resilience,/new CustomEvent\('nolu:standby-write'/);

console.log('standby replay safety: ok');
