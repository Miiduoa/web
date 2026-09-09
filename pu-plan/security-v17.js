const COURSE_COLORS=new Set(['violet','blue','mint','orange','pink','lime','gray']);
const originalSetItem=Storage.prototype.setItem;

function cleanText(value,max=100){return String(value??'').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,max)}
function stableId(value){
  const raw=cleanText(value,160);
  if(/^[A-Za-z0-9._:-]{1,100}$/.test(raw))return raw;
  let h=2166136261;for(let i=0;i<raw.length;i++){h^=raw.charCodeAt(i);h=Math.imul(h,16777619)}
  return `local-${(h>>>0).toString(36)}`;
}
function cleanAvatar(value){
  const s=String(value??'');
  if(/^data:image\/(?:jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(s)&&s.length<=180000)return s;
  return '';
}
function cleanCourse(c={}){
  let day=Number(c.day),start=Number(c.start),end=Number(c.end);
  if(!Number.isInteger(day)||day<0||day>5)day=0;
  if(day===0){start=0;end=0}else{
    if(!Number.isInteger(start)||start<1||start>13)start=1;
    if(!Number.isInteger(end)||end<start||end>13)end=start;
  }
  return {
    id:stableId(c.id||crypto.randomUUID?.()||Date.now()),
    name:cleanText(c.name,100)||'未命名課程',day,start,end,
    teacher:cleanText(c.teacher,80),room:cleanText(c.room,80),
    color:COURSE_COLORS.has(c.color)?c.color:'gray'
  };
}
function cleanCourses(value){return Array.isArray(value)?value.slice(0,80).map(cleanCourse):[]}
function cleanMeta(value={}){return {
  school:cleanText(value.school,80),year:cleanText(value.year,12),semester:cleanText(value.semester,12),
  className:cleanText(value.className,80),credits:Math.max(0,Math.min(60,Number(value.credits)||0)),
  title:cleanText(value.title,80)
}}
function cleanFriend(f={}){return {
  ...f,
  id:stableId(f.id),name:cleanText(f.name,40)||'好友',username:cleanText(f.username,24),
  avatar:cleanAvatar(f.avatar),bio:cleanText(f.bio,120),courses:cleanCourses(f.courses),
  meta:cleanMeta(f.meta),cloud:f.cloud===true,t:f.t||Date.now()
}}
function sanitizeForKey(key,value){
  try{
    const parsed=JSON.parse(value);
    if(key==='puplan_courses')return JSON.stringify(cleanCourses(parsed));
    if(key==='puplan_friends')return JSON.stringify(Array.isArray(parsed)?parsed.slice(0,500).map(cleanFriend):[]);
    if(key==='puplan_schedule_meta')return JSON.stringify(cleanMeta(parsed));
  }catch{}
  return value;
}
Storage.prototype.setItem=function(key,value){
  if(this===localStorage&&['puplan_courses','puplan_friends','puplan_schedule_meta'].includes(String(key))){
    value=sanitizeForKey(String(key),String(value));
  }
  return originalSetItem.call(this,key,value);
};

for(const key of ['puplan_courses','puplan_friends','puplan_schedule_meta']){
  const value=localStorage.getItem(key);if(value!==null)originalSetItem.call(localStorage,key,sanitizeForKey(key,value));
}
queueMicrotask(()=>window.PUPLAN_APP?.render?.());
window.PUPLAN_SECURITY={cleanCourse,cleanCourses,cleanFriend};
