import test from 'node:test';
import assert from 'node:assert/strict';
import {validateShare,decodeShareCode,encodeShareCode,MAX_SHARE_LENGTH} from '../../pu-plan/core/share-code.js';
import {scheduleGroups} from '../../pu-plan/core/schedule-layout.js';
import {addFriendCode} from '../../pu-plan/features/share.js';

const course=(id='a',extra={})=>({id,name:'資料庫管理 📚',day:1,start:3,end:4,room:'主顧 324',teacher:'林老師',color:'blue',...extra});
const payload=(extra={})=>({v:1,id:'snapshot-person',name:'同學甲',t:Date.now()-10000,courses:[course()],meta:{year:'115',semester:'1',school:'測試大學',credits:3},...extra});
const rawCode=value=>'NL1-'+Buffer.from(JSON.stringify(value)).toString('base64url');
function storage(initial={}){
  const map=new Map(Object.entries(initial));
  globalThis.localStorage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)};
  return map;
}

for(const prefix of ['NL1-','PU1-'])test(`${prefix} Chinese and emoji round trip`,()=>{
  const p=payload(),code=encodeShareCode(p).replace(/^NL1-/,prefix),decoded=decodeShareCode(code);
  assert.equal(decoded.courses[0].name,p.courses[0].name);assert.equal(decoded.name,p.name);assert.equal(decoded.meta.school,p.meta.school);
});
test('full URL preserves a share alongside unrelated hash parameters',()=>{
 const code=encodeShareCode(payload());assert.equal(decodeShareCode(`https://miiduoa.github.io/web/?utm_source=ig#x=1&friend=${code}&y=2`).id,'snapshot-person');
});
for(const [label,change] of [
 ['unsupported version',{v:2}],['object identity',{id:{cloud:true}}],['malformed identity',{id:'<img src=x>'}],
 ['future timestamp',{t:Date.now()+86400000}],['string timestamp',{t:'123'}],['missing timestamp',{t:undefined}],
 ['oversize course list',{courses:Array.from({length:81},(_,i)=>course(`c${i}`))}],
 ['array metadata',{meta:[]}],['invalid credits',{meta:{credits:61}}],['nontext name',{name:{}}]
])test(`reject ${label}`,()=>assert.throws(()=>decodeShareCode(rawCode(payload(change)))));
for(const [label,change] of [
 ['blank name',{name:'  '}],['long name',{name:'a'.repeat(101)}],['nontext teacher',{teacher:{}}],
 ['weekend',{day:6}],['string day',{day:'1'}],['reversed period',{start:5,end:2}],['period fourteen',{end:14}],
 ['fractional period',{start:1.5}],['unassigned with time',{day:0}],['missing course id',{id:undefined}]
])test(`reject course ${label}`,()=>assert.throws(()=>validateShare(payload({courses:[course('a',change)]}))));
test('duplicate ids are rejected rather than silently binding edits to the wrong course',()=>assert.throws(()=>validateShare(payload({courses:[course(),course('a',{day:2})]}))));
test('unassigned and empty snapshots remain explicit valid states',()=>{
 assert.equal(validateShare(payload({courses:[course('a',{day:0,start:0,end:0})]})).courses[0].day,0);
 assert.deepEqual(validateShare(payload({courses:[]})).courses,[]);
});
test('only whitelisted data can leave the decoder',()=>{
 const p=decodeShareCode(rawCode(payload({cloud:true,role:'admin',session:'secret',avatar:'bad'})));
 assert.equal(p.cloud,undefined);assert.equal(p.role,undefined);assert.equal(p.session,undefined);assert.equal(p.avatar,undefined);
});
test('maximum supported share can encode without stack overflow',()=>{
 const courses=Array.from({length:80},(_,i)=>course(`c${i}`,{name:'課'.repeat(100),room:'教'.repeat(80),teacher:'師'.repeat(80)}));
 assert.equal(decodeShareCode(encodeShareCode(payload({courses}))).courses.length,80);
});
for(const input of ['NL1-%%%','NL1-eyJ',`NL1-${'a'.repeat(MAX_SHARE_LENGTH+1)}`,'javascript:alert(1)','https://a:b@example.com/#friend=NL1-a'])test(`malformed input ${input.slice(0,35)}`,()=>assert.throws(()=>decodeShareCode(input)));
test('adding a snapshot cannot touch my courses or manufacture a cloud friendship',()=>{
 const own=JSON.stringify([course('mine')]),map=storage({puplan_courses:own});
 addFriendCode(rawCode(payload({cloud:true})));
 const result=JSON.parse(map.get('puplan_friends'))[0];assert.equal(result.cloud,false);assert.equal(map.get('puplan_courses'),own);
});
test('snapshot cannot overwrite an existing connected friend',()=>{
 const original=JSON.stringify([{...payload(),cloud:true}]),map=storage({puplan_friends:original});
 assert.throws(()=>addFriendCode(rawCode(payload())),/已連線好友/);assert.equal(map.get('puplan_friends'),original);
});
test('older share cannot roll back a newer snapshot',()=>{
 const current=payload(),map=storage();addFriendCode(rawCode(current));const original=map.get('puplan_friends');
 assert.throws(()=>addFriendCode(rawCode({...current,t:current.t-1})),/較新/);assert.equal(map.get('puplan_friends'),original);
});
test('same snapshot is idempotent; contradictory same-time data is rejected',()=>{
 const current=payload(),map=storage();addFriendCode(rawCode(current));const original=map.get('puplan_friends');
 assert.match(addFriendCode(rawCode(current)).message,/沒有重複/);assert.equal(map.get('puplan_friends'),original);
 assert.throws(()=>addFriendCode(rawCode({...current,courses:[]})),/不一致/);assert.equal(map.get('puplan_friends'),original);
});
test('newer snapshot updates once without adding another row',()=>{
 const current=payload(),map=storage();addFriendCode(rawCode(current));addFriendCode(rawCode({...current,t:current.t+1,courses:[]}));
 const list=JSON.parse(map.get('puplan_friends'));assert.equal(list.length,1);assert.equal(list[0].courses.length,0);
});
test('full friend list cannot silently drop its oldest record',()=>{
 const initial=JSON.stringify(Array.from({length:500},(_,i)=>({...payload({id:`person${i}`}),cloud:false}))),map=storage({puplan_friends:initial});
 assert.throws(()=>addFriendCode(rawCode(payload())),/500/);assert.equal(map.get('puplan_friends'),initial);
});
test('storage failures do not report success or destroy existing state',()=>{
 const map=storage({puplan_friends:'[]'});localStorage.setItem=()=>{throw new Error('quota')};
 assert.throws(()=>addFriendCode(rawCode(payload())),/沒有儲存/);assert.equal(map.get('puplan_friends'),'[]');
});
test('cannot import my own snapshot',()=>{
 storage({puplan_id:'snapshot-person'});assert.throws(()=>addFriendCode(rawCode(payload())),/自己的/);
});
test('overlap grouping preserves every course, without mutating source order',()=>{
 const input=[course('c',{start:5,end:6}),course('b',{start:3,end:5}),course('a',{start:2,end:3}),course('d',{day:2})];
 const original=JSON.stringify(input),groups=scheduleGroups(input);
 assert.deepEqual(groups.map(g=>g.courses.map(c=>c.id)),[['a','b','c'],['d']]);
 assert.equal(groups[0].start,2);assert.equal(groups[0].end,6);assert.equal(JSON.stringify(input),original);
});
test('adjacent classes do not count as a collision; pending courses are excluded',()=>{
 const groups=scheduleGroups([course('a',{start:2,end:3}),course('b',{start:4,end:5}),course('c',{day:0,start:0,end:0})]);
 assert.deepEqual(groups.map(g=>g.courses.length),[1,1]);
});
