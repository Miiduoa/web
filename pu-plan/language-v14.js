const DEV_WORDING=new Map([
['STUDENT SOCIAL TIMETABLE','校園課表與好友'],['CREATE YOUR ID','建立你的帳號'],['WELCOME BACK','歡迎回來'],['NO BORING TIMETABLE',''],['MY SEMESTER','我的學期'],['MY WEEK / PU PLAN',''],['WEEK MODE: ON','本週課表'],['FRIENDS / CHECK THEIR WEEK',''],['FIND PEOPLE','找同學'],['REQUESTS','好友邀請'],['MEETUPS / 約一下','約一下'],['MY FRIENDS','我的好友'],['LOCAL AI / ZERO API FEE',''],['BETA / ON-DEVICE','裝置內處理'],['PU/PLAN AI','課表助理'],['QUICK MODE','基本模式'],['FREE / RUNS ON YOUR DEVICE',''],['ONE TAP / NO MODEL NEEDED','快速整理'],['READY.','準備好了'],['PRIVACY','隱私說明'],['SHARE / YOUR WEEK',''],['PROFILE / SEARCHABLE',''],['IMAGE → TIMETABLE','匯入課表'],['CHECK BEFORE IMPORT','匯入前確認'],['AFTER IMPORT','匯入後預覽'],['SEMESTERS / SWITCH FAST',''],['ADD / EDIT','新增或修改'],['WELCOME / SET YOUR WEEK',''],['HOW TO START',''],['FASTEST','上傳課表'],['MANUAL','手動加入'],['ACCOUNT RECOVERY','帳號救援'],['SAVE THIS ONCE','請妥善保存'],['FREE',''],['MY WEEK / PU MIS',''],['PROJECT / 專案實作(二)','專案實作（二）']
]);
const replacements=[
  [/Local AI/gi,'裝置內助理'],[/AI 助理/g,'課表助理'],[/免費 Local AI/g,'進階理解'],[/API Key/gi,'額外金鑰'],[/WebGPU/gi,'裝置運算支援'],[/BETA/gi,''],[/DEBUG/gi,''],[/payload/gi,'資料'],[/JSON/gi,'資料'],[/MODE/gi,'模式']
];
function cleanText(text){let out=text;for(const [from,to] of DEV_WORDING)if(out.trim()===from)out=out.replace(from,to);for(const [re,to] of replacements)out=out.replace(re,to);return out}
function cleanNode(root=document.body){
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;const nodes=[];while(n=walker.nextNode())nodes.push(n);
  for(const node of nodes){const parent=node.parentElement;if(!parent||['SCRIPT','STYLE','TEXTAREA','INPUT','OPTION','CODE','PRE'].includes(parent.tagName))continue;const next=cleanText(node.nodeValue||'');if(next!==node.nodeValue)node.nodeValue=next}
  document.querySelectorAll('.kicker').forEach(el=>{const t=(el.textContent||'').trim();if(DEV_WORDING.has(t))el.textContent=DEV_WORDING.get(t)||'';if(!el.textContent.trim())el.style.display='none'});
  const mode=document.querySelector('#aiModeLabel');if(mode&&/QUICK|LOCAL|BROWSER|MODE|AI/i.test(mode.textContent||''))mode.textContent='基本模式';
  const pill=document.querySelector('.model-pill');if(pill)pill.textContent='進階理解會在這台裝置上運算';
  const aiBadge=document.querySelector('#ai .badge');if(aiBadge)aiBadge.textContent='裝置內處理';
  const semester=document.querySelector('#semesterLabel');if(semester&&semester.textContent.trim()==='MY SEMESTER')semester.textContent='我的學期';
}
cleanNode();
new MutationObserver(muts=>{for(const m of muts)for(const node of m.addedNodes)if(node.nodeType===Node.ELEMENT_NODE)cleanNode(node)}).observe(document.body,{childList:true,subtree:true});
