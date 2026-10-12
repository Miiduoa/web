export function authView({hidden=false}={}){return `
<div class="auth-gate${hidden?' off':''}" id="authGate">
  <section class="auth-poster" aria-label="nolu">
    <div class="auth-brand"><img src="nolu-icon.svg" alt=""><strong>nolu</strong></div>
    <div class="auth-copy"><span class="entry-eyebrow">課表・朋友・剛剛好的空檔</span><h1>把時間整理好，<br>把空檔留給生活。</h1><p>下一堂在哪裡、今天什麼時候有空，<br class="entry-break">打開課表就知道。</p></div>
    <div class="entry-guide"><div><span>01</span><b>放進你的課表</b><p>手動新增，或匯入學校課表截圖。</p></div><div><span>02</span><b>看清楚今天</b><p>查看下一堂與上課地點，隨時調整。</p></div><div><span>03</span><b>有空再碰面</b><p>登入加好友，找彼此的共同空堂。</p></div></div>
  </section>
  <section class="auth-card" aria-label="開始使用">
    <div class="entry-local"><button class="guest" id="guestMode" type="button">先使用課表，不登入 <span aria-hidden="true">→</span></button><p>訪客課表只保存在這個瀏覽器，可另存備份。</p></div>
    <div class="entry-divider"><span>登入後使用好友與跨裝置功能</span></div>
    <div class="auth-tabs"><button class="on" data-auth-tab="register" type="button">註冊</button><button data-auth-tab="login" type="button">登入</button></div>
    <form id="registerForm" class="auth-form">
      <h2>建立你的帳號</h2>
      <label>顯示名稱<input class="field" id="regName" maxlength="24" autocomplete="nickname" placeholder="朋友怎麼稱呼你？" required></label>
      <label>@帳號<input class="field" id="regUsername" maxlength="24" pattern="[A-Za-z0-9_.]+" autocomplete="username" placeholder="例如：jinwei" required><small>英文、數字、底線、句點，2–24 個字元。</small></label>
      <label>Email<input class="field" id="regEmail" type="email" inputmode="email" autocomplete="email" required></label>
      <label>密碼<input class="field" id="regPassword" type="password" minlength="8" autocomplete="new-password" required></label>
      <button class="btn primary auth-submit" type="submit">建立帳號</button>
    </form>
    <form id="loginForm" class="auth-form hidden">
      <h2>回來就繼續</h2>
      <label>Email<input class="field" id="loginEmail" type="email" inputmode="email" autocomplete="username" required></label>
      <label>密碼<input class="field" id="loginPassword" type="password" autocomplete="current-password" required></label>
      <button class="btn primary auth-submit" type="submit">登入</button>
    </form>
    <div class="auth-status" id="authStatus" role="status" aria-live="polite" aria-atomic="true"></div>
  </section>
</div>`}
