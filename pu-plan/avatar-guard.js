import {cleanAvatar} from './core/state.js';

const AVATAR_IMG_SELECTOR=[
  '#accountAvatar img',
  '#profileAvatarPreview img',
  '.avatar img',
  '.reply-avatar img',
  '.discover-avatar img',
  '.admin-avatar img'
].join(',');

function scrubImage(img){
  if(!(img instanceof HTMLImageElement)||!img.matches(AVATAR_IMG_SELECTOR))return;
  const src=img.getAttribute('src')||'';
  if(src&&cleanAvatar(src)!==src){
    const parent=img.parentElement;
    img.remove();
    if(parent&&!parent.textContent.trim())parent.textContent='?';
  }
}
function scrub(root=document){
  if(root instanceof HTMLImageElement)scrubImage(root);
  root.querySelectorAll?.(AVATAR_IMG_SELECTOR).forEach(scrubImage);
}

scrub();
const observer=new MutationObserver(records=>{
  for(const record of records){
    if(record.type==='attributes')scrubImage(record.target);
    for(const node of record.addedNodes)if(node instanceof Element)scrub(node);
  }
});
observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['src']});
