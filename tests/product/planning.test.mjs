import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDuration,resolveDay,availableWindows,allocatePlan,nextClass,clock} from '../../pu-plan/core/planning.js';
import {cleanCourses} from '../../pu-plan/core/state.js';
const monday = new Date(2026,9,12,7,0);
const course=(day,start,end=start)=>({id:`${day}-${start}`,name:'測試課程',day,start,end});
for(const [input,expected] of [['兩小時',120],['半小時',30],['兩個半小時',150],['一小時半',90],['三十分鐘',30],['２小時',120],['2.5小時',150],['2節',100],['1小時30分鐘',90],['一百二十分鐘',120]]){
  test(`duration: ${input}`,()=>assert.equal(parseDuration(input),expected));
}
for(const input of ['0分鐘','零小時','-2小時','13小時'])test(`reject invalid duration ${input}`,()=>assert.throws(()=>parseDuration(input)));
test('Friday tomorrow is a weekend, not all weekdays',()=>assert.ok(resolveDay('明天',new Date(2026,9,16,8)).error));
test('Sunday tomorrow is Monday',()=>assert.equal(resolveDay('明天',new Date(2026,9,11,8)).day,1));
test('next Monday has an explicit following-week offset',()=>assert.equal(resolveDay('下週一',monday).offset,7));
test('unsupported weekends are explicit',()=>assert.ok(resolveDay('星期六').error));
test('evening intersects an all-day free window',()=>{
 const windows=availableWindows([course(1,1,2)],{now:monday,day:1,earliest:1080,latest:1245});
 assert.deepEqual(windows.map(b=>[b.start,b.end]),[[1080,1245]]);
});
test('two hours allocates exactly two hours, not the whole opening',()=>{
 const result=allocatePlan(availableWindows([],{now:monday,day:1,earliest:1080}),120);
 assert.equal(result.picks[0].end-result.picks[0].start,120);assert.equal(clock(result.picks[0].end),'20:00');
});
test('past times are never recommended',()=>{
 const now=new Date(2026,9,12,17,37,40);
 assert.equal(availableWindows([],{now,day:1})[0].start,1060);
});
test('overlapping courses are merged into one busy interval',()=>{
 const windows=availableWindows([course(1,1,3),course(1,2,4)],{now:monday,day:1});
 assert.deepEqual(windows.map(b=>[b.start,b.end]),[[720,1300]]);
});
test('friends busy intervals are excluded from common availability',()=>{
 const windows=availableWindows([course(1,1,2),course(1,3,5)],{now:monday,day:1});
 assert.deepEqual(windows.map(b=>[b.start,b.end]),[[600,610],[840,1300]]);
});
test('no unrequested split when a continuous plan cannot fit',()=>{
 const windows=[{start:0,end:60},{start:100,end:160}];
 assert.equal(allocatePlan(windows,120).picks.length,0);
 assert.equal(allocatePlan(windows,120,true).remaining,0);
});
test('split plans reserve rest and report exact duration',()=>{
 const r=allocatePlan([{start:1080,end:1300}],120,true);
 assert.deepEqual(r.picks.map(b=>[b.start,b.end]),[[1080,1140],[1150,1210]]);assert.equal(r.remaining,0);
});
test('class end is exclusive, and the next week is considered',()=>{
 const data=[course(1,1)];const r=nextClass(data,new Date(2026,9,12,9));
 assert.equal(r.kind,'next');assert.equal(r.date.getDate(),19);
});
test('floating courses never crash next class',()=>assert.equal(nextClass([course(0,0)]),null));
test('malformed entries do not erase valid courses',()=>{
 const result=cleanCourses([null,course(1,1),false,'bad',[],course(2,1)]);assert.equal(result.length,2);
});
test('this week does not wrap a Sunday into next week',()=>assert.deepEqual(availableWindows([],{now:new Date(2026,9,11),thisWeek:true}),[]));
