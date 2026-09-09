export const DAYS=[['一','星期一'],['二','星期二'],['三','星期三'],['四','星期四'],['五','星期五']];
export const PERIODS=[['08:10','09:00'],['09:10','10:00'],['10:10','11:00'],['11:10','12:00'],['13:10','14:00'],['14:10','15:00'],['15:10','16:00'],['16:10','17:00'],['17:10','18:00'],['18:05','18:55'],['19:00','19:50'],['19:55','20:45'],['20:50','21:40']];
export const $=s=>document.querySelector(s);
export const $$=s=>[...document.querySelectorAll(s)];
export const read=(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}};
export const write=(k,v)=>localStorage.setItem(k,JSON.stringify(v));
export const uid=()=>crypto.randomUUID?.()||String(Date.now())+Math.random().toString(36).slice(2);
export const esc=(s='')=>String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
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
