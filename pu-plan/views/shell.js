import {scheduleView} from './schedule.js';
import {friendsView} from './friends.js';
import {assistantView} from './assistant.js';
import {settingsView} from './settings.js';

export function shellView(){return `
<div class="shell">
  <aside class="sidebar">
    <div class="brand"><div class="mark"><img src="nolu-icon.svg" alt="Nolu"></div><div><strong>nolu</strong><span>課表・朋友・現在</span></div></div>
    <nav class="nav"><button class="on" data-view="schedule">課表</button><button data-view="friends">找人</button><button data-view="ai">安排</button><button data-view="settings">我的</button></nav>
    <div class="semester"><b id="semesterLabel">我的學期</b><span id="semesterMeta">自己的課表<br>登入後自動同步</span></div>
  </aside>
  <main class="main">
    <header class="topbar"><div><div class="kicker" id="kicker"></div><h1 id="title">我的課表</h1></div><div class="actions"><button class="account-chip" id="accountChip" title="帳號設定"><span class="avatar mini-avatar" id="accountAvatar">?</span><span id="accountName">訪客</span></button><button class="btn" id="shareTop">分享</button><button class="btn import-top" id="importSchedule">匯入</button><button class="btn primary" id="add">新增</button></div></header>
    ${scheduleView()}${friendsView()}${assistantView()}${settingsView()}
  </main>
</div>
<nav class="bottom"><button class="on" data-view="schedule">課表</button><button data-view="friends">找人</button><button class="plus" id="mobileAdd">＋</button><button data-view="ai">安排</button><button data-view="settings">我的</button></nav>`}
