// Connected overlap groups share a grid cell; none of their courses may be
// painted on top of another. Input is the already-sanitized local schedule.
export function scheduleGroups(courses){
  const groups=[];
  for(let day=1;day<=5;day++){
    const list=courses.filter(c=>c.day===day).sort((a,b)=>a.start-b.start||a.end-b.end||a.id.localeCompare(b.id));
    let group=null;
    for(const course of list){
      if(!group||course.start>group.end){
        group={day,start:course.start,end:course.end,courses:[course]};groups.push(group);
      }else{group.end=Math.max(group.end,course.end);group.courses.push(course)}
    }
  }
  return groups;
}
