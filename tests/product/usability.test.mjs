import test from 'node:test';
import assert from 'node:assert/strict';
import {planImport, parseBackup} from '../../pu-plan/core/import-plan.js';
const course = (id, extra={}) => ({id:String(id), name:`課程 ${id}`, day:1, start:1, end:2, room:'主顧 324', ...extra});

test('merge preserves existing courses and deduplicates within the import',()=>{
 const original=[course(1)]; const draft=[course(2),course(2),course(3,{name:'課程 1'})];
 const copy=JSON.stringify(original); const plan=planImport(original,draft);
 assert.equal(plan.added,1); assert.equal(plan.duplicates,2); assert.equal(plan.courses.length,2); assert.equal(JSON.stringify(original),copy);
});
test('replacement is explicit and reports what it will remove',()=>{
 const plan=planImport([course(1),course(2)],[course(3)],'replace');
 assert.equal(plan.replaced,2); assert.equal(plan.courses.length,1);
});
test('invalid or empty names are never silently dropped',()=>{
 for(const name of ['', '   ', 'a'.repeat(101)]) assert.throws(()=>planImport([], [course(1,{name})]),/名稱/);
});
test('invalid periods are rejected instead of silently moved',()=>{
 for(const [start,end] of [[5,3],[0,2],[1,14],[1.5,2]]) assert.throws(()=>planImport([], [course(1,{start,end})]),/節次/);
});
test('weekends and malformed days cannot become floating courses',()=>{
 for(const day of [-1,6,7,1.2,'x']) assert.throws(()=>planImport([], [course(1,{day})]),/星期/);
});
test('unscheduled courses normalize to zero periods',()=>{
 const p=planImport([], [course(1,{day:0,start:4,end:7})]); assert.equal(p.courses[0].start,0);assert.equal(p.courses[0].end,0);
});
test('the 80-course limit fails before mutation',()=>{
 const all=Array.from({length:80},(_,i)=>course(i)); const before=JSON.stringify(all);
 assert.throws(()=>planImport(all,[course(81)]),/81.*80/); assert.equal(JSON.stringify(all),before);
 assert.equal(planImport(all,[course(79)]).courses.length,80);
});
test('duplicate IDs for different courses receive unique IDs',()=>{
 const p=planImport([course(1)],[course(1,{name:'不同的課'})]);assert.equal(new Set(p.courses.map(c=>c.id)).size,2);
});
test('conflicts count only overlapping, scheduled courses',()=>{
 assert.equal(planImport([course(1)],[course(2,{start:2,end:3})]).conflicts,1);
 assert.equal(planImport([course(1)],[course(2,{start:3,end:4})]).conflicts,0);
 assert.equal(planImport([], [course(1,{day:0}),course(2,{day:0})]).conflicts,0);
});
test('backup rejects wrong schemas, corrupt JSON and oversized course lists',()=>{
 for(const data of ['{}','null','[]','not-json',JSON.stringify({format:'nolu-schedule',version:2,courses:[]}),JSON.stringify({format:'nolu-schedule',version:1,courses:Array.from({length:81},(_,i)=>course(i))})]) assert.throws(()=>parseBackup(data));
});
test('backup produces only sanitized course fields, not arbitrary properties',()=>{
 const value={format:'nolu-schedule',version:1,session:'must-not-import',courses:[course(1,{token:'must-not-import',color:'red" onclick=evil()'})]};
 const p=parseBackup(JSON.stringify(value)); assert.equal(p.courses[0].token,undefined);assert.equal(p.courses[0].color,'gray');
});
test('invalid backup time remains an error',()=>assert.throws(()=>parseBackup(JSON.stringify({format:'nolu-schedule',version:1,courses:[course(1,{start:8,end:2})]})),/節次/));
