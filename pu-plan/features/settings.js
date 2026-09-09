import {$,toast} from '../core/state.js';
import {renderShare,copyText,encodeShare} from './share.js';
import {changeView} from './navigation.js';

export function initSettings(){
  $('#saveName').onclick=async()=>{const n=$('#name').value.trim(),u=($('#username')?.value||'').trim().replace(/^@/,'');if(!n)return toast('請輸入顯示名稱');if(u&&!/^[A-Za-z0-9_.]{2,24}$/.test(u))return toast('@帳號格式不正確');if(window.PUPLAN_CLOUD?.isSignedIn()){await window.PUPLAN_CLOUD.updateProfile(n,u,{bio:$('#bio')?.value||'',discoverable:$('#discoverable')?.checked!==false});return}localStorage.setItem('puplan_name',n);if(u)localStorage.setItem('puplan_username',u);renderShare();toast('名稱已儲存')};
  $('#copyCode').onclick=()=>copyText(renderShare(),'好友碼已複製');
  $('#copyLink').onclick=()=>copyText(location.origin+location.pathname+'#friend='+encodeURIComponent(renderShare()),'分享連結已複製');
  $('#shareTop').onclick=async()=>{const url=location.origin+location.pathname+'#friend='+encodeURIComponent(renderShare());if(navigator.share)try{await navigator.share({title:'我的 Nolu 課表',text:'加我好友，看我的課表',url})}catch{}else copyText(url,'分享連結已複製')};
  $('#accountChip').onclick=()=>changeView('settings');
  $('#logout').onclick=()=>window.PUPLAN_CLOUD?.logout?.();
}
