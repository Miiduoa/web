import {cleanCourse,cleanMeta} from './state.js';

export const MAX_SHARE_LENGTH=256*1024;
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const idPattern=/^[A-Za-z0-9._:-]{1,100}$/;
function text(value,max,label,required=false){
  if(value==null&&!required)return '';
  if(typeof value!=='string'||value.length>max||/[\u0000-\u001f\u007f]/.test(value)||required&&!value.trim()){
    throw new Error(`${label}格式不正確，未儲存任何資料。`);
  }
  return value.trim();
}

export function validateShare(value,now=Date.now()){
  if(!object(value)||value.v!==1)throw new Error('不支援這個版本的課表碼，請朋友重新分享。');
  if(typeof value.id!=='string'||!idPattern.test(value.id))throw new Error('課表來源識別碼不正確。');
  if(!Number.isSafeInteger(value.t)||value.t<=0||value.t>now+300000)throw new Error('課表建立時間不正確，請朋友重新分享。');
  if(!Array.isArray(value.courses)||value.courses.length>80)throw new Error('課表碼須包含完整課程清單，且不能超過 80 門。');
  const ids=new Set();
  const courses=value.courses.map((course,index)=>{
    if(!object(course))throw new Error(`第 ${index+1} 門課格式不正確。`);
    const name=text(course.name,100,`第 ${index+1} 門課名稱`,true);
    const day=course.day,start=course.start,end=course.end;
    if(!Number.isInteger(day)||day<0||day>5||!Number.isInteger(start)||!Number.isInteger(end)||
       (day===0?(start!==0||end!==0):(start<1||end<start||end>13))){
      throw new Error(`「${name}」的星期或節次不正確，沒有自動改動時間。`);
    }
    if(typeof course.id!=='string'||!idPattern.test(course.id)||ids.has(course.id))throw new Error('課程識別碼缺少或重複，請重新分享。');
    ids.add(course.id);
    return cleanCourse({...course,name,teacher:text(course.teacher,80,'老師'),room:text(course.room,80,'教室')});
  });
  const meta=value.meta??{};
  if(!object(meta))throw new Error('學期資料格式不正確。');
  for(const [key,max] of Object.entries({school:80,year:12,semester:12,className:80,title:80}))text(meta[key],max,'學期資料');
  if(meta.credits!=null&&(!Number.isFinite(meta.credits)||meta.credits<0||meta.credits>60))throw new Error('學分資料格式不正確。');
  // Whitelist fields: a share code is a snapshot, never an account, session or
  // friendship proof. Caller-supplied cloud/avatar/role fields cannot cross over.
  return {v:1,id:value.id,name:text(value.name,40,'名稱')||'朋友的課表',t:value.t,courses,meta:cleanMeta(meta)};
}

export function decodeShareCode(input){
  if(typeof input!=='string'||input.length>MAX_SHARE_LENGTH+4096)throw new Error('課表碼太長，請重新複製完整連結或課表碼。');
  let code=input.trim();
  if(!/^(?:NL1|PU1)-/.test(code)){
    try{
      const url=new URL(code);
      if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error();
      code=new URLSearchParams(url.hash.slice(1)).get('friend')||'';
    }catch{throw new Error('請貼上 nolu 分享連結或以 NL1- / PU1- 開頭的課表碼。')}
  }
  if(code.length>MAX_SHARE_LENGTH||!/^(?:NL1|PU1)-[A-Za-z0-9_-]+={0,2}$/.test(code))throw new Error('課表碼不完整或格式不正確，請重新複製。');
  let value;
  try{
    const bytes=Uint8Array.from(atob(code.slice(4).replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
    value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }catch{throw new Error('課表碼無法讀取，請朋友重新分享。')}
  return validateShare(value);
}

export function encodeShareCode(value){
  const bytes=new TextEncoder().encode(JSON.stringify(validateShare(value)));
  let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  const code='NL1-'+btoa(binary).replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
  if(code.length>MAX_SHARE_LENGTH)throw new Error('課表內容太多，請改用課表備份檔。');
  return code;
}
