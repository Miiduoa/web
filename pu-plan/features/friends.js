import {$,esc,friends,write,time,DAYS,getSelectedFriend,setSelectedFriend,toast} from '../core/state.js';
import {addFriendCode} from './share.js';

export function renderFriends(q=''){
  const list=$('#friendList');if(!list)return;
  const all=friends().filter(f=>(`${f.name||''} ${f.username||''}`).toLowerCase().includes(String(q||'').toLowerCase()));
  list.innerHTML=all.length?all.map(f=>`<div class="friend-card ${getSelectedFriend()===f.id?'on':''}" data-friend="${esc(f.id)}"><div class="avatar">${f.avatar?`<img src="${esc(f.avatar)}" alt="">`:esc((f.name||'?')[0])}</div><div><b>${esc(f.name)}</b><small>${f.username?'@'+esc(f.username)+' · ':''}${Array.isArray(f.courses)?f.courses.length:0} 門課</small></div></div>`).join(''):'<div class="empty friend-empty">還沒有好友</div>';
  list.querySelectorAll('[data-friend]').forEach(e=>e.onclick=()=>{setSelectedFriend(e.dataset.friend);renderFriends(q)});
  const f=friends().find(x=>x.id===getSelectedFriend()),view=$('#friendView');if(!view)return;
  if(!f){view.innerHTML='<div class="empty">先找一個人看看。</div>';return}
  const days=DAYS.map((d,i)=>`<div class="friend-day"><h4>${d[1]}</h4>${(f.courses||[]).filter(c=>c.day===i+1).sort((a,b)=>a.start-b.start).map(c=>`<div class="friend-course ${c.color||'gray'}"><b>${esc(c.name)}</b><br><small>${time(c)}<br>${esc(c.room||'')}</small></div>`).join('')||'<small>無課</small>'}</div>`).join('');
  view.innerHTML=`<div class="friend-top"><div class="avatar">${f.avatar?`<img src="${esc(f.avatar)}" alt="">`:esc((f.name||'?')[0])}</div><div><b>${esc(f.name)}</b><br><small>${(f.courses||[]).length} 門課</small></div><button class="btn danger" id="removeFriend">移除</button></div><div class="friend-days">${days}</div>`;
  $('#removeFriend').onclick=async()=>{if(!confirm(`移除好友「${f.name}」？`))return;if(f.cloud&&window.PUPLAN_CLOUD){await window.PUPLAN_CLOUD.removeFriend(f.id);return}write('puplan_friends',friends().filter(x=>x.id!==f.id));setSelectedFriend(null);renderFriends();toast('好友已移除')};
}
export function commonFreeWithFriend(f,courses){if(!f)return[];const out=[];for(let d=1;d<=5;d++){const a=new Set(),b=new Set();courses().filter(c=>c.day===d).forEach(c=>{for(let i=c.start;i<=c.end;i++)a.add(i)});(f.courses||[]).filter(c=>c.day===d).forEach(c=>{for(let i=c.start;i<=c.end;i++)b.add(i)});let start=null;for(let i=1;i<=9;i++){const free=!a.has(i)&&!b.has(i);if(free&&start===null)start=i;if((!free||i===9)&&start!==null){const end=!free?i-1:i;if(end-start+1>=2)out.push({day:d,start,end});start=null}}}return out}
export function initFriends(){
  $('#addFriend').onclick=()=>{if(window.PUPLAN_CLOUD?.isSignedIn()){window.PUPLAN_APP?.changeView?.('friends');$('#cloudFriendSearch')?.focus();toast('直接搜尋名字或 @帳號')}else if(window.PUPLAN_CLOUD)window.PUPLAN_CLOUD.showGate('login');else $('#friendDialog')?.showModal()};
  $('#friendForm').onsubmit=e=>{e.preventDefault();try{const r=addFriendCode($('#friendCode').value);setSelectedFriend(r.id);renderFriends();$('#friendCode').value='';$('#friendDialog').close();toast(r.message)}catch(err){toast(err.message)}};
  $('#search').oninput=e=>renderFriends(e.target.value);
}
