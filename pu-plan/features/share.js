import {$,courses,friends,scheduleMeta,displayName,uid,write} from '../core/state.js';
import {decodeShareCode,encodeShareCode} from '../core/share-code.js';

export function encodeShare(){
  let id=localStorage.getItem('puplan_id');
  if(!id){id=uid();localStorage.setItem('puplan_id',id)}
  return encodeShareCode({v:1,id,name:displayName(),t:Date.now(),courses:courses(),meta:scheduleMeta()});
}
export const decodeShare=decodeShareCode;
let profileScope;
export function renderShare(){
  // Do not regenerate a large token or write an identity during background
  // renders. Sharing is an explicit user action, and profile drafts stay intact.
  const all=courses(),meta=scheduleMeta(),scope=JSON.stringify([localStorage.getItem('puplan_course_owner'),localStorage.getItem('puplan_guest')]);
  const reset=scope!==profileScope;profileScope=scope;
  if($('#code'))$('#code').textContent=`${all.length} 門課・${meta.title||'目前課表'}\n按下複製時建立副本；更新課表後，請重新分享。`;
  for(const [id,value] of [['name',displayName()],['username',localStorage.getItem('puplan_username')||'']]){
    const input=$('#'+id);if(!input)continue;
    if(reset||input.dataset.savedValue===undefined||input.value===input.dataset.savedValue||input.value===value){input.value=value;input.dataset.savedValue=value}
  }
}
export async function copyText(text,message){
  try{await navigator.clipboard.writeText(text);window.PUPLAN_APP?.toast?.(message);return true}
  catch{prompt('瀏覽器未允許自動複製，請手動複製以下內容',text);return false}
}
export function addFriendCode(input){
  const p=decodeShare(input);
  if(p.id===localStorage.getItem('puplan_id'))throw new Error('這是你自己的課表碼。');
  const list=friends(),index=list.findIndex(x=>x.id===p.id),previous=list[index];
  if(previous?.cloud)throw new Error('這個識別碼屬於已連線好友，分享副本不能覆蓋好友資料。');
  if(previous&&previous.t>p.t)throw new Error('你已經有較新的課表副本，這份舊連結不會覆蓋它。');
  if(previous&&previous.t===p.t){
    if(JSON.stringify(previous.courses)!==JSON.stringify(p.courses)||JSON.stringify(previous.meta)!==JSON.stringify(p.meta)||previous.name!==p.name)throw new Error('相同時間的課表內容不一致，請朋友重新分享。');
    return {message:'這份課表副本已經儲存，沒有重複加入。',id:p.id};
  }
  if(index<0&&list.length>=500)throw new Error('已達 500 筆上限，請先整理舊副本，不會移除既有資料。');
  const friend={id:p.id,name:p.name,courses:p.courses,meta:p.meta,t:p.t,cloud:false};
  if(index<0)list.unshift(friend);else list[index]=friend;
  try{write('puplan_friends',list)}catch{throw new Error('這次沒有儲存：瀏覽器空間不足或存取被阻擋，原有資料未變動。')}
  return {message:index<0?'課表副本已儲存，不會自動更新。':'課表副本已更新。',id:p.id};
}

export function prepareShareImport(input=''){
  const dialog=$('#friendDialog'),field=$('#friendCode');if(!dialog||!field)return;
  field.value=input;field.dispatchEvent(new Event('input',{bubbles:true}));
  if(!dialog.open)dialog.showModal();
  (input?dialog.querySelector('[type="submit"]'):field)?.focus();
}
