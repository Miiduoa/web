export const DAYS=[['一','星期一'],['二','星期二'],['三','星期三'],['四','星期四'],['五','星期五']];
export const PERIODS=[['08:10','09:00'],['09:10','10:00'],['10:10','11:00'],['11:10','12:00'],['13:10','14:00'],['14:10','15:00'],['15:10','16:00'],['16:10','17:00'],['17:10','18:00'],['18:05','18:55'],['19:00','19:50'],['19:55','20:45'],['20:50','21:40']];
export const $=s=>document.querySelector(s);
export const $$=s=>[...document.querySelectorAll(s)];
export const uid=()=>crypto.randomUUID?.()||String(Date.now())+Math.random().toString(36).slice(2);
export const esc=(s='')=>String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

const COURSE_COLORS=new Set(['violet','blue','mint','orange','pink','lime','gray']);
const cleanText=(value,max=100)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,max);
function stableId(value){const raw=cleanText(value,160);if(/^[A-Za-z0-9._:-]{1,100}$/.test(raw))return raw;let h=2166136261;for(let i=0;i<raw.length;i++){h^=raw.charCodeAt(i);h=Math.imul(h,16777619)}return`local-${(h>>>0).toString(36)}`}
export function cleanAvatar(value){const s=String(value??'');if(/^data:image\/(?:jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(s)&&s.length<=180000)return s;return''}
export function cleanCourse(c={}){let day=Number(c.day),start=Number(c.start),end=Number(c.end);if(!Number.isInteger(day)||day<0||day>5)day=0;if(day===0){start=0;end=0}else{if(!Number.isInteger(start)||start<1||start>13)start=1;if(!Number.isInteger(end)||end<start||end>13)end=start}return{id:stableId(c.id||uid()),name:cleanText(c.name,100)||'未命名課程',day,start,end,teacher:cleanText(c.teacher,80),room:cleanText(c.room,80),color:COURSE_COLORS.has(c.color)?c.color:'gray'}}
export const cleanCourses=value=>Array.isArray(value)?value.slice(0,80).map(cleanCourse):[];
export function cleanMeta(value={}){return{school:cleanText(value.school,80),year:cleanText(value.year,12),semester:cleanText(value.semester,12),className:cleanText(value.className,80),credits:Math.max(0,Math.min(60,Number(value.credits)||0)),title:cleanText(value.title,80)}}
export function cleanFriend(f={}){return{id:stableId(f.id),name:cleanText(f.name,40)||'好友',username:cleanText(f.username,24),avatar:cleanAvatar(f.avatar),bio:cleanText(f.bio,120),courses:cleanCourses(f.courses),meta:cleanMeta(f.meta),cloud:f.cloud===true,t:Number(f.t)||Date.now()}}
function sanitize(key,value){if(key==='puplan_courses')return cleanCourses(value);if(key==='puplan_friends')return Array.isArray(value)?value.slice(0,500).map(cleanFriend):[];if(key==='puplan_schedule_meta')return cleanMeta(value);return value}
export const read=(k,d)=>{try{const value=JSON.parse(localStorage.getItem(k));return value==null?d:sanitize(k,value)}catch{return d}};
export const write=(k,v)=>localStorage.setItem(k,JSON.stringify(sanitize(k,v)));

export const courses=()=>read('puplan_courses',[]);
export const friends=()=>read('puplan_friends',[]);
export const scheduleMeta=()=>read('puplan_schedule_meta',{});
export const displayName=()=>localStorage.getItem('puplan_name')||'我的課表';
export const time=c=>c.day===0||c.start===0?'時間待定':`${PERIODS[c.start-1]?.[0]||''}–${PERIODS[c.end-1]?.[1]||''}`;
let selectedDay=Math.min(Math.max(new Date().getDay(),1),5),selectedFriend=null;
export const getSelectedDay=()=>selectedDay;
export const setSelectedDay=v=>{selectedDay=Math.min(5,Math.max(1,Number(v)||1))};
export const getSelectedFriend=()=>selectedFriend;
export const setSelectedFriend=id=>{selectedFriend=id||null};
export function toast(msg){const e=$('#toast');if(!e)return;e.textContent=msg;e.classList.add('on');clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove('on'),1700)}
