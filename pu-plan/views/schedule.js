export function scheduleView(){return `
<section class="view on" id="schedule">
  <div class="hero">
    <article class="hero-main"><h2 id="greet">今天要上什麼？</h2><p id="summary"></p><div class="quote">點一下課程就能直接修改。</div></article>
    <aside class="hero-side"><div class="stat"><b id="today">0</b><span>今天</span></div><div class="stat"><b id="hours">0</b><span>本週節數</span></div><div class="stat"><b id="count">0</b><span>課程</span></div></aside>
  </div>
  <div class="floating-courses" id="floatingCourses"></div>
  <div class="schedule-toolbar"><div class="view-switch"><button class="on" data-schedule-mode="week">整週</button><button data-schedule-mode="day">單日</button></div><div class="presentation-switch"><button class="on" data-presentation="human">好讀</button><button data-presentation="classic">格狀</button></div></div>
  <div class="now-strip" id="nowStrip"></div><div class="human-week" id="humanWeek"></div>
  <div class="classic-schedule" id="classicSchedule"><div class="daytabs" id="tabs"></div><div class="table-wrap"><div class="grid" id="grid"></div></div><div class="mobile-week" id="mobileWeek"></div><div class="mobile-list" id="mobile"></div></div>
</section>`}
