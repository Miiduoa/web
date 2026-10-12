import test from 'node:test';
import assert from 'node:assert/strict';
import {courseKey, reviewCourse} from '../../pu-plan/core/course-feedback.js';
const base = {id: 'a', name: '資料庫', day: 1, start: 3, end: 4};
test('full-width, spaces and letter case use the import identity', () => {
  assert.equal(courseKey({...base,name:'Ｗｅｂ Development'}),courseKey({...base,name:' webdevelopment '}));
});
test('an exact duplicate is identified without mutating current data', () => {
  const current = [Object.freeze({...base})];
  const before = JSON.stringify(current);
  assert.equal(reviewCourse({...base,id:''},current).duplicate.id,'a');
  assert.equal(JSON.stringify(current),before);
});
test('editing the same record does not conflict with itself', () => {
  const result = reviewCourse(base,[base]);
  assert.equal(result.duplicate,null); assert.equal(result.conflicts.length,0);
});
test('same title at a different time is not a duplicate', () => {
  assert.equal(reviewCourse({...base,id:'',day:2},[base]).duplicate,null);
});
test('all overlaps are listed in period order; adjacent periods are free', () => {
  const c = [{...base,id:'later',start:4,end:6},{...base,id:'early',start:1,end:3},{...base,id:'adjacent',start:5,end:5}];
  assert.deepEqual(reviewCourse({...base,id:''},c).conflicts.map(x=>x.id),['early','later']);
});
test('two periods distinguish teaching time from the break', () => {
  const r = reviewCourse(base); assert.equal(r.teachingMinutes,100); assert.equal(r.spanMinutes,110); assert.equal(r.breakMinutes,10);
  assert.equal(r.from,'10:10'); assert.equal(r.to,'12:00');
});
test('lunch is not counted as teaching time', () => {
  const r = reviewCourse({...base,start:4,end:5}); assert.equal(r.teachingMinutes,100); assert.equal(r.breakMinutes,70);
});
test('evening uses actual five-minute gaps', () => {
  const r = reviewCourse({...base,start:10,end:13}); assert.equal(r.teachingMinutes,200); assert.equal(r.spanMinutes,215); assert.equal(r.breakMinutes,15);
});
test('unscheduled courses never claim a busy or free timetable slot', () => {
  const r = reviewCourse({...base,id:'',day:0},[base]); assert.equal(r.validTime,true); assert.equal(r.conflicts.length,0); assert.equal(r.periods,0);
  assert.equal(courseKey({...base,day:0,start:7,end:9}),courseKey({...base,day:0,start:0,end:0}));
});
test('unscheduled duplicate follows the same identity as import', () => {
  assert.equal(reviewCourse({...base,id:'',day:0},[{...base,day:0,start:0,end:0}]).duplicate.id,'a');
});
for (const values of [{day:6},{day:-1},{day:1.5},{day:NaN},{start:0},{start:2.5},{start:6,end:5},{end:14}]) {
  test(`invalid time is rejected: ${JSON.stringify(values)}`, () => assert.equal(reviewCourse({...base,...values}).validTime,false));
}
test('empty name can preview time but is never treated as a duplicate', () => {
  const r = reviewCourse({...base,id:'',name:' '},[{...base,name:' '}]); assert.equal(r.validTime,true); assert.equal(r.duplicate,null);
});
test('partial malformed collection does not crash feedback', () => {
  assert.equal(reviewCourse(base,[null,undefined,'x']).conflicts.length,0);
});
