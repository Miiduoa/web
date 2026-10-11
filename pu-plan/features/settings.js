import {$,toast} from '../core/state.js';
import {renderShare,copyText,encodeShare,prepareShareImport} from './share.js';
import {changeView} from './navigation.js';

export function initSettings(){
  $('#saveName').onclick=async()=>{const n=$('#name').value.trim(),u=($('#username')?.value||'').trim().replace(/^@/,'');if(!n)return toast('請輸入顯示名稱');if(u&&!/^[A-Za-z0-9_.]{2,24}$/.test(u))return toast('@帳號格式不正確');if(window.PUPLAN_CLOUD?.isSignedIn()){await window.PUPLAN_CLOUD.updateProfile(n,u,{bio:$('#bio')?.value||'',discoverable:$('#discoverable')?.checked!==false});return}localStorage.setItem('puplan_name',n);if(u)localStorage.setItem('puplan_username',u);renderShare();toast('名稱已儲存')};
  const makeLink=()=>{const url=new URL(location.href);url.searchParams.delete('utm_source');url.searchParams.delete('utm_medium');url.searchParams.delete('utm_content');url.hash='friend='+encodeURIComponent(encodeShare());return url.href};
  const shareError=error=>toast(error?.message||'目前無法建立分享內容，請再試一次。');
  $('#copyCode').onclick=()=>{try{copyText(encodeShare(),'課表碼已複製')}catch(error){shareError(error)}};
  $('#copyLink').onclick=()=>{try{copyText(makeLink(),'分享連結已複製')}catch(error){shareError(error)}};
  $('#shareTop').onclick=async()=>{
    let url;try{url=makeLink()}catch(error){shareError(error);return}
    if(!navigator.share){await copyText(url,'分享連結已複製');return}
    try{await navigator.share({title:'我的 nolu 課表',text:'這是我建立當下的課表副本，不會自動更新。',url})}
    catch(error){if(error?.name!=='AbortError')await copyText(url,'分享功能暫時無法使用，已改為複製連結')}
  };
  $('#readShare')?.addEventListener('click',()=>prepareShareImport());
  $('#accountChip').onclick=()=>changeView('settings');
  $('#logout').onclick=()=>window.PUPLAN_CLOUD?.logout?.();
}
