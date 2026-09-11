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
  const replication=window.NOLU_REPLICATION?.state;
  if(replication?.manualReconcileRequired===true){
    card.dataset.reconcileRequired='1';
    $('#providerMeshSummary').textContent='備援資料需要確認：已停止自動回切覆寫。';
    $('#providerMeshState').textContent='Tokyo 有未合併變更｜Mumbai → Tokyo 自動覆寫已暫停';
    $('#providerMeshHint').textContent='為避免資料遺失，系統會保留目前資料，不會自動用主區域覆蓋備援區域；請先不要清除網站資料，等待安全合併流程。';
    return;
  }
  delete card.dataset.reconcileRequired;
  const mesh=window.NOLU_PROVIDER_MESH?.state;
  if(!mesh){$('#providerMeshSummary').textContent='備援模組尚未啟動';return}
  const configured=[...new Set(mesh.configuredProviders||[])];
  const healthy=[...new Set(mesh.healthyProviders||[])];
  const target=Number(mesh.requiredRemoteProviders||3);
  const configuredReady=configured.length>=target;
  const healthyReady=healthy.length>=target;
  $('#providerMeshSummary').textContent=healthyReady
    ?`跨供應商備援正常：${healthy.length}/${target} 個獨立雲端目前可用。`
    :configuredReady
      ?`已設定 ${configured.length} 個獨立雲端供應商；目前只有 ${healthy.length}/${target} 個通過即時可用性檢查。`
      :`目前只有 ${configured.length}/${target} 個獨立雲端供應商完成正式啟用。`;
  $('#providerMeshState').textContent=`目標 ${target} 雲端 + 本機副本｜正式啟用：${configured.join(' · ')||'尚未設定'}｜即時可用：${healthy.join(' · ')||'尚未確認'}`;
  $('#providerMeshHint').textContent=healthyReady
    ?'遠端救援仍採至少兩個不同供應商對同一 revision 與 SHA-256 摘要達成一致，不採先回應者優先。'
    :configuredReady
      ?'目前處於降級狀態；本機 IndexedDB 會繼續保留資料。只有通過實際驗證的供應商才算入可用數。'
      :'還需要至少一個通過實際讀寫驗證的獨立雲端。Render、Netlify、Railway 等候選在驗證完成前都不會被算成正式備援。';
}

document.addEventListener('nolu:provider-mesh',render);
document.addEventListener('nolu:provider-recovered',render);
document.addEventListener('nolu:replica-manual-reconcile-required',render);
document.addEventListener('nolu:replica-synced',render);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')render()});
setTimeout(render,0);setInterval(render,15000);
