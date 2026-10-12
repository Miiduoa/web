import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../../pu-plan/guest-privacy.js',import.meta.url),'utf8');
const uid='11111111-1111-4111-8111-111111111111';
function storage(seed={}){const map=new Map(Object.entries(seed));return{get length(){return map.size},key:i=>[...map.keys()][i]??null,getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,String(value)),removeItem:key=>map.delete(key)}}
function boot(seed){const localStorage=storage(seed),sessionStorage=storage(),listeners={},window={};const document={addEventListener:(event,fn)=>listeners[event]=fn};vm.runInNewContext(source,{localStorage,sessionStorage,document,window,Date});return{localStorage,sessionStorage,window,listeners,guest:()=>listeners.click({target:{closest:selector=>selector==='#guestMode'?{}:null}})}}
const guest={puplan_guest:'1',nolu_guest_scope_v1:'1',puplan_courses:'[{"name":"Guest course"}]',puplan_schedule_meta:'{"school":"My school"}',puplan_friends:'[{"name":"Shared friend","cloud":false}]'};
test('returning to an established guest preserves courses, metadata and imported friends',()=>{const state=boot(guest);state.guest();state.guest();for(const [key,value]of Object.entries(guest))assert.equal(state.localStorage.getItem(key),value);assert.equal(state.window.NOLU_GUEST_PRIVACY.canResumeGuest(),true)});
test('a scope marker without the guest identity is not sufficient',()=>{const state=boot({...guest,puplan_guest:'0'});assert.equal(state.localStorage.getItem('puplan_courses'),null);assert.equal(state.window.NOLU_GUEST_PRIVACY.canResumeGuest(),false)});
for(const key of ['puplan_course_owner','puplan_session','puplan_session_primary_v1','puplan_session_standby_v1','puplan_portable_session_v1']){
 test(`guest startup quarantines conflicting ${key}`,()=>{const state=boot({...guest,[key]:uid});assert.equal(state.localStorage.getItem('puplan_courses'),null);assert.equal(state.localStorage.getItem(key),null)});
 test(`guest resume quarantines an account ${key} introduced after startup`,()=>{const state=boot(guest);state.localStorage.setItem(key,uid);state.guest();assert.equal(state.localStorage.getItem('puplan_courses'),null);assert.equal(state.localStorage.getItem(key),null)});
}
test('a tracked signed-in profile invalidates the old guest scope',()=>{const state=boot(guest);state.listeners['puplan:profile-changed']({detail:{id:uid}});assert.equal(state.window.NOLU_GUEST_PRIVACY.canResumeGuest(),false);state.guest();assert.equal(state.localStorage.getItem('puplan_courses'),null)});
test('routing preference alone is not an account credential',()=>{const state=boot({...guest,nolu_preferred_cloud_v1:'primary'});assert.equal(state.window.NOLU_GUEST_PRIVACY.canResumeGuest(),true);state.guest();assert.equal(state.localStorage.getItem('puplan_courses'),guest.puplan_courses)});
