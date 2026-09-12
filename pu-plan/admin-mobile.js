const VERSION='20260912-admin-mobile1';
const $=selector=>document.querySelector(selector);

function currentProfile(){
  return window.PUPLAN_CLOUD?.getProfile?.()||null;
}

function removeMobileEntry(){
  $('[data-admin-mobile]')?.remove();
}

function markActive(button){
  document.querySelectorAll('.bottom [data-view],.bottom [data-community-open]').forEach(node=>node.classList.remove('on'));
  button?.classList.add('on');
}

function sync(profile=currentProfile()){
  if(profile?.role!=='admin'){
    removeMobileEntry();
    return;
  }

  const bottom=$('.bottom');
  if(!bottom)return;

  let button=bottom.querySelector('[data-admin-mobile]');
  if(!button){
    button=document.createElement('button');
    button.type='button';
    button.dataset.adminMobile='1';
    button.textContent='管理';
    button.setAttribute('aria-label','網站管理');
    button.addEventListener('click',async()=>{
      if(!window.PUPLAN_ADMIN)await import('./admin.js?v=20260912-admin-mobile1');
      window.PUPLAN_ADMIN?.install?.();
      window.PUPLAN_ADMIN?.open?.();
      markActive(button);
      $('#mobileAdd')?.setAttribute('hidden','');
    });
    bottom.append(button);
  }
}

sync();
document.addEventListener('puplan:profile-changed',event=>sync(event.detail||null));
document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync()});

window.NOLU_ADMIN_MOBILE={sync,version:VERSION};
