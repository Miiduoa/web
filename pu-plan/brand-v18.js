const brandAsset=name=>new URL(name,import.meta.url).href;
const BRAND='Nolu';
const USER_CONTENT='.feed-body,.reply-copy p,.message-body,.chat-message,.bubble.user,[data-user-content]';
function applyBrand(){
  document.title='Nolu — 課表、朋友、現在';
  const authArt=document.querySelector('.auth-art');
  if(authArt&&!authArt.dataset.nolu){authArt.dataset.nolu='1';authArt.innerHTML=`<img src="${brandAsset('./nolu-icon.svg')}" alt=""><span class="hang-wordmark">Nolu</span>`}
  const poster=document.querySelector('.auth-poster');
  if(poster){const kicker=poster.querySelector('.kicker');if(kicker)kicker.textContent='';const h2=poster.querySelector('h2');if(h2)h2.innerHTML='今天有空，<br>就碰面。';const p=poster.querySelector('p');if(p)p.textContent='課表、朋友、動態和聊天，都放在同一個地方。'}
  const mark=document.querySelector('.sidebar .brand .mark');if(mark&&!mark.dataset.nolu){mark.dataset.nolu='1';mark.innerHTML=`<img src="${brandAsset('./nolu-icon.svg')}" alt="Nolu">`}
  const strong=document.querySelector('.sidebar .brand strong');if(strong)strong.textContent=BRAND;
  const sub=document.querySelector('.sidebar .brand span');if(sub)sub.textContent='課表・朋友・現在';
  const replacements=[[/PU\/PLAN/g,BRAND],[/PU PLAN/g,BRAND],[/PUPLAN/g,BRAND],[/hang\./gi,BRAND]];
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;const nodes=[];while(n=walker.nextNode())nodes.push(n);
  for(const node of nodes){const parent=node.parentElement;if(!parent||parent.closest(USER_CONTENT)||['SCRIPT','STYLE','TEXTAREA','INPUT','OPTION','CODE','PRE'].includes(parent.tagName))continue;let t=node.nodeValue||'';for(const [re,to] of replacements)t=t.replace(re,to);if(t!==node.nodeValue)node.nodeValue=t}
  document.querySelectorAll('[title],[aria-label]').forEach(el=>{for(const attr of ['title','aria-label']){let v=el.getAttribute(attr);if(!v)continue;for(const [re,to] of replacements)v=v.replace(re,to);el.setAttribute(attr,v)}});
}
applyBrand();
let scheduled=false;new MutationObserver(()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;applyBrand()})}).observe(document.body,{childList:true,subtree:true});
window.NOLU_BRAND={name:BRAND,icon:brandAsset('./nolu-icon.svg')};
window.HANG_BRAND=window.NOLU_BRAND;
