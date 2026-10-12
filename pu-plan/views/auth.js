export function authView({hidden=false}={}){return `
<div class="auth-gate${hidden?' off':''}" id="authGate" role="dialog" aria-modal="true" aria-labelledby="authHeading" tabindex="-1">
  <section class="auth-poster" aria-label="nolu">
    <div class="auth-brand"><img src="nolu-icon.svg" alt=""><strong>nolu</strong></div>
    <div class="auth-copy"><h1 id="authHeading">有空，就碰面。</h1><p>課表、朋友、動態和聊天，都放在同一個地方。</p></div>
  </section>
  <section class="auth-card">
    <aside class="guest-workspace-notice" id="guestWorkspaceNotice" hidden><b>登入前，先保留你的課表</b><p id="guestWorkspaceText"></p><button class="btn" type="button" id="guestWorkspaceBackup">下載這份課表</button></aside>
    <div class="auth-tabs"><button class="on" data-auth-tab="register" type="button">註冊</button><button data-auth-tab="login" type="button">登入</button></div>
    <form id="registerForm" class="auth-form">
      <h2>建立帳號</h2>
      <label>顯示名稱<input class="field" id="regName" maxlength="24" placeholder="例如：小明" required></label>
      <label>@帳號<input class="field" id="regUsername" maxlength="24" pattern="[A-Za-z0-9_.]+" placeholder="例如：jinwei" required><small>英文、數字、底線、句點都可以，之後還能改。</small></label>
      <label>Email<input class="field" id="regEmail" type="email" autocomplete="email" required></label>
      <label>密碼<input class="field" id="regPassword" type="password" minlength="8" autocomplete="new-password" required></label>
      <button class="btn primary auth-submit">建立帳號</button>
    </form>
    <form id="loginForm" class="auth-form hidden">
      <h2>回來就繼續</h2>
      <label>Email<input class="field" id="loginEmail" type="email" autocomplete="email" required></label>
      <label>密碼<input class="field" id="loginPassword" type="password" autocomplete="current-password" required></label>
      <button class="btn primary auth-submit">登入</button>
    </form>
    <button class="guest" id="guestMode" type="button">先逛逛，不登入</button>
    <p class="guest-storage-hint">訪客課表只存於這個瀏覽器，不會跨裝置同步。</p>
    <div class="auth-status" id="authStatus" aria-live="polite"></div>
  </section>
</div>`}
