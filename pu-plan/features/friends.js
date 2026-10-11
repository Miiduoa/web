import {$,esc,friends,write,time,DAYS,getSelectedFriend,setSelectedFriend,toast} from '../core/state.js';
import {addFriendCode,decodeShare} from './share.js';

export function renderFriends(q=$('#search')?.value||''){
  const list=$('#friendList');if(!list)return;
  const focused=document.activeElement?.dataset?.friend;
  const all=friends().filter(f=>(`${f.name||''} ${f.username||''}`).toLowerCase().includes(String(q||'').toLowerCase()));
  list.innerHTML=all.length?all.map(f=>`<button type="button" class="friend-card ${getSelectedFriend()===f.id?'on':''}" data-friend="${esc(f.id)}" aria-pressed="${getSelectedFriend()===f.id}"><div class="avatar">${f.avatar?`<img src="${esc(f.avatar)}" alt="">`:esc((f.name||'?')[0])}</div><div><b>${esc(f.name)}</b><small>${f.username?'@'+esc(f.username)+' · ':''}${Array.isArray(f.courses)?f.courses.length:0} 門課${f.cloud?'':' · 副本'}</small></div></button>`).join(''):`<div class="empty friend-empty">${q?'沒有符合的好友，試試其他名字。':'還沒有好友或課表副本。'}</div>`;
  list.querySelectorAll('[data-friend]').forEach(e=>e.onclick=()=>{setSelectedFriend(e.dataset.friend);renderFriends(q)});
  if(focused)list.querySelector(`[data-friend="${CSS.escape(focused)}"]`)?.focus({preventScroll:true});
  const f=friends().find(x=>x.id===getSelectedFriend()),view=$('#friendView');if(!view)return;
  if(!f){view.innerHTML='<div class="empty">先找一個人看看。</div>';return}
  const days=DAYS.map((d,i)=>`<div class="friend-day"><h4>${d[1]}</h4>${(f.courses||[]).filter(c=>c.day===i+1).sort((a,b)=>a.start-b.start).map(c=>`<div class="friend-course ${c.color||'gray'}"><b>${esc(c.name)}</b><br><small>${time(c)}<br>${esc(c.room||'')}</small></div>`).join('')||'<small>無課</small>'}</div>`).join('');
  view.innerHTML=`<div class="friend-top"><div class="avatar">${f.avatar?`<img src="${esc(f.avatar)}" alt="">`:esc((f.name||'?')[0])}</div><div><b>${esc(f.name)}</b><br><small>${(f.courses||[]).length} 門課</small></div><button class="btn danger" id="removeFriend">移除</button></div><div class="friend-days">${days}</div>${f.cloud?'':`<p class="share-preview">這是 ${esc(new Date(f.t).toLocaleString('zh-TW'))} 建立的未驗證課表副本，不會自動更新，也不能用來發送邀約。</p>`}`;
  $('#removeFriend').onclick=async()=>{try{if(!confirm(`移除好友「${f.name}」？`))return;if(f.cloud&&window.PUPLAN_CLOUD){await window.PUPLAN_CLOUD.removeFriend(f.id);return}write('puplan_friends',friends().filter(x=>x.id!==f.id));setSelectedFriend(null);renderFriends();toast(f.cloud?'好友已移除':'課表副本已移除')}catch(error){toast(error.message||'移除失敗，請再試一次。')}};
}
export function commonFreeWithFriend(f,courses){if(!f)return[];const out=[];for(let d=1;d<=5;d++){const a=new Set(),b=new Set();courses().filter(c=>c.day===d).forEach(c=>{for(let i=c.start;i<=c.end;i++)a.add(i)});(f.courses||[]).filter(c=>c.day===d).forEach(c=>{for(let i=c.start;i<=c.end;i++)b.add(i)});let start=null;for(let i=1;i<=9;i++){const free=!a.has(i)&&!b.has(i);if(free&&start===null)start=i;if((!free||i===9)&&start!==null){const end=!free?i-1:i;if(end-start+1>=2)out.push({day:d,start,end});start=null}}}return out}
export function initFriends(){
  $('#addFriend').onclick=()=>{if(window.PUPLAN_CLOUD?.isSignedIn()){window.PUPLAN_APP?.changeView?.('friends');$('#cloudFriendSearch')?.focus();toast('直接搜尋名字或 @帳號')}else if(window.PUPLAN_CLOUD)window.PUPLAN_CLOUD.showGate('login');else $('#friendDialog')?.showModal()};
  const field=$('#friendCode'),dialog=$('#friendDialog'),form=$('#friendForm');
  const preview=document.createElement('p');preview.id='sharePreview';preview.className='share-preview';preview.setAttribute('role','status');
  field.setAttribute('maxlength','266240');field.setAttribute('aria-describedby','sharePreview');field.after(preview);
  const submit=form.querySelector('button.btn.lime');submit.type='submit';submit.textContent='儲存課表副本';
  $('#friendTitle').textContent='讀取朋友的課表';
  const updatePreview=()=>{
    field.removeAttribute('aria-invalid');
    if(!field.value.trim()){preview.textContent='先預覽再儲存。課表碼只是副本，不會讓雙方成為已驗證好友，也不會取代你自己的課表。';submit.disabled=true;return}
    try{
      const p=decodeShare(field.value);preview.textContent=`${p.name}・${p.courses.length} 門課・${new Date(p.t).toLocaleString('zh-TW')} 建立。這是未驗證的課表副本，儲存後不會自動更新。`;
      submit.disabled=false;
    }catch(error){preview.textContent=error.message;submit.disabled=true;field.setAttribute('aria-invalid','true')}
  };
  field.addEventListener('input',updatePreview);updatePreview();
  form.onsubmit=e=>{
    e.preventDefault();
    try{
      const r=addFriendCode(field.value);setSelectedFriend(r.id);renderFriends();field.value='';updatePreview();dialog.close();toast(r.message);
      window.PUPLAN_APP?.changeView?.('friends');
    }catch(error){preview.textContent=error.message;field.setAttribute('aria-invalid','true');field.focus()}
  };
  $('#search').setAttribute('aria-label','搜尋已加入的好友或課表副本');
  $('#cloudFriendSearch')?.setAttribute('aria-label','搜尋公開使用者');
  $('#search').oninput=e=>renderFriends(e.target.value);
}
