import test from 'node:test';
import assert from 'node:assert/strict';
import {planCoursePlacement, selectedRange} from '../../pu-plan/core/direct-placement.js';
const base = Object.freeze({id:'a',name:'資料庫',day:1,start:3,end:4,teacher:'林老師',room:'324',color:'mint'});
test('move preserves duration, id, metadata and the immutable original',()=>{
 const source=Object.freeze([base]);const plan=planCoursePlacement(source,'a',2,5);
 assert.deepEqual(plan.draft,{...base,day:2,start:5,end:6});assert.equal(source[0],base);assert.equal(plan.changed,true);
});
test('unchanged drop is a no-op',()=>assert.equal(planCoursePlacement([base],'a',1,3).changed,false));
test('full final period fits without truncation',()=>assert.equal(planCoursePlacement([base],'a',5,12).draft.end,13));
for (const [day,start] of [[0,1],[6,1],[1,0],[1,13],[1,2.5],[1,NaN],[NaN,3]])
 test(`invalid or truncated range ${day}/${start} is rejected`,()=>assert.throws(()=>planCoursePlacement([base],'a',day,start)));
test('removed course is not recreated',()=>assert.throws(()=>planCoursePlacement([],'a',1,1)));
test('unscheduled course has no guessed duration',()=>assert.throws(()=>planCoursePlacement([{...base,day:0,start:0,end:0}],'a',1,1)));
test('lists every overlap without deleting or mutating it',()=>{
 const x=Object.freeze({...base,id:'b',name:'分析',day:2,start:3,end:3});
 const y=Object.freeze({...base,id:'c',name:'管理',day:2,start:4,end:4});
 const plan=planCoursePlacement(Object.freeze([base,x,y]),'a',2,3);
 assert.deepEqual(plan.conflicts,[x,y]);assert.equal(plan.next[1],x);assert.equal(plan.next.length,3);
});
test('duplicate uses the same fullwidth/whitespace identity as manual entry and imports',()=>{
 assert.throws(()=>planCoursePlacement([{...base,name:'WEB'},{...base,id:'b',name:'Ｗｅ ｂ',day:2}],'a',2,3),/相同課程/);
});
test('adjacent periods and other days are not overlaps',()=>{
 const plan=planCoursePlacement([base,{...base,id:'b',day:2,start:1,end:2}],'a',2,3);
 assert.deepEqual(plan.conflicts,[]);
});
test('new selection works downwards, upwards and for a single period',()=>{
 assert.deepEqual(selectedRange({day:2,period:5},{day:2,period:3}),{day:2,start:3,end:5});
 assert.deepEqual(selectedRange({day:2,period:3},{day:2,period:5}),{day:2,start:3,end:5});
 assert.deepEqual(selectedRange({day:2,period:3},{day:2,period:3}),{day:2,start:3,end:3});
});
test('new selection never crosses days or the supported period range',()=>{
 for(const [a,b] of [[{day:1,period:3},{day:2,period:5}],[null,{day:1,period:3}],[{day:1,period:0},{day:1,period:14}]])assert.equal(selectedRange(a,b),null);
});
