const $=s=>document.querySelector(s);

function ensureCard(){
  const grid=$('#settings .settings');if(!grid)return null;
  let card=$('#providerMeshCard');if(card)return card;
  card=document.createElement('article');
  card.id='providerMeshCard';card.className='setting-card';
  card.innerHTML=`<h3>資料備援</h3><p id="providerMeshSummary">正在檢查備援狀態…</p><div class="cloud-state" id="providerMeshState"></div><small id="providerMeshHint"></small>`;
  grid.append(card);return card;
}
function render(){
  const card=ensureCard();if(!card)return;
  const mesh=window.NOLU_PROVIDER_MESH?.state;
  if(!mesh){$('#providerMeshSummary').textContent='備援模組尚未啟動';return}
  const configured=[...new Set(mesh.configuredProviders||[])];
  const healthy=[...new Set(mesh.healthyProviders||[])];
  const target=Number(mesh.requiredRemoteProviders||3);
  const ready=configured.length>=target;
  $('#providerMeshSummary').textContent=ready
    ?`已設定 ${configured.length} 個獨立雲端供應商；目前偵測 ${healthy.length} 個可用。`
    :`目前只有 ${configured.length}/${target} 個獨立雲端供應商完成設定。`;
  $('#providerMeshState').textContent=`目標 ${target} 雲端 + 本機副本｜${configured.join(' · ')||'尚未設定'}`;
  $('#providerMeshHint').textContent=ready
    ?'遠端救援必須至少兩個獨立鏡像對同一版資料達成一致，避免單一故障或錯誤副本覆寫。'
    :'目前仍會使用本機 IndexedDB 與既有 Supabase 備援，但要達到真正跨供應商容錯，還需要啟用 Neon 與 Render 鏡像。';
}

document.addEventListener('nolu:provider-mesh',render);
document.addEventListener('nolu:provider-recovered',render);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')render()});
setTimeout(render,0);setInterval(render,15000);
