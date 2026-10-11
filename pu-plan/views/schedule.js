export function scheduleView(){return `
<section class="view on" id="schedule">
  <div class="hero">
    <article class="hero-main"><h2 id="greet">今天要上什麼？</h2><p id="summary"></p><div class="quote">點一下課程就能直接修改。</div></article>
    <aside class="hero-side"><div class="stat"><b id="today">0</b><span>今天</span></div><div class="stat"><b id="hours">0</b><span>本週節數</span></div><div class="stat"><b id="count">0</b><span>課程</span></div></aside>
  </div>
  <div class="floating-courses" id="floatingCourses"></div>
  <div class="schedule-toolbar"><div class="view-switch" role="group" aria-label="課表範圍"><button class="on" data-schedule-mode="week">整週</button><button data-schedule-mode="day">單日</button></div><div class="presentation-switch" role="group" aria-label="課表樣式"><button class="on" data-presentation="human">列表</button><button data-presentation="classic">格狀</button></div><button class="btn today-shortcut" id="jumpToday" type="button">看今天</button></div>
  <div class="schedule-warnings" id="scheduleWarnings" role="status" hidden></div>
  <div class="daytabs" id="tabs"></div>
  <div class="now-strip" id="nowStrip"></div>
  <div class="human-week" id="humanWeek"></div>
  <div class="classic-schedule" id="classicSchedule"><p class="grid-help">每週固定課表。左右滑動查看整週；重疊課程可點開逐門調整。</p><div class="table-wrap" tabindex="0" role="region" aria-label="整週格狀課表，可左右捲動"><div class="grid" id="grid"></div></div><div class="mobile-week" id="mobileWeek"></div><div class="mobile-list" id="mobile"></div></div>
</section>`}
