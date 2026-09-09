export function assistantView(){return `
<section class="view" id="ai">
  <div class="section-head"><div><h2>幫我安排</h2><p>問今天去哪上課、找空堂，或把讀書和作業排進這週。</p></div></div>
  <div class="ai-layout">
    <article class="ai-card ai-chat"><div class="ai-head"><span class="ai-dot"></span><b>安排</b><small id="aiModeLabel">一般模式</small></div><div class="ai-messages" id="aiMessages"><div class="bubble ai">可以直接問「星期三有什麼課？」、「下一堂在哪？」或「幫我找兩小時讀書」。</div></div><div class="ai-compose"><textarea class="field" id="aiInput" rows="2" placeholder="想問課表或怎麼安排？"></textarea><button class="btn ai-send" id="aiSend">送出</button></div></article>
    <aside class="ai-side"><div class="panel"><h3>進階安排</h3><div class="ai-status"><span class="status-light" id="aiLight"></span><span id="aiStatus">可直接使用</span></div><button class="btn ai-launch" id="aiLaunch">進階安排</button><p class="ai-note">適合一次給多個條件，例如日期、科目、要排多久，以及不要太晚等限制。</p></div><div class="panel"><h3>快速問</h3><div class="quick-grid"><button class="quick" data-smart="stress">哪天最累？</button><button class="quick" data-smart="free">找長空堂</button><button class="quick" data-smart="study">排讀書時段</button><button class="quick" data-smart="friend">跟好友找共同空堂</button></div><div class="smart-result" id="smartResult">選一個就會直接幫你算。</div></div><div class="panel"><p class="ai-note">課表分析只會使用你目前的課表與這次對話內容。</p></div></aside>
  </div>
</section>`}
