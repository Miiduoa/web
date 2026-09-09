const asset=name=>new URL(name,import.meta.url).href;
try{
  await import(asset('./boot-v9.js'));
}catch(error){
  console.error('hang. 啟動失敗',error);
  const toast=document.querySelector('#toast');
  if(toast){toast.textContent='剛剛載入不完整，請重新整理一次';toast.classList.add('on')}
}
