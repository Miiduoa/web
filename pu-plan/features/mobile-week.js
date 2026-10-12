import {$, DAYS, courses} from '../core/state.js';

// This is a view of the existing grid, never a second timetable or data store.
export function initMobileWeek(editor) {
  const classic = $('#classicSchedule'), grid = $('#grid'), wrap = grid?.closest('.table-wrap');
  if (!classic || !grid || !wrap || !editor || $('#weekScale')) return;
  const narrow = matchMedia('(max-width:680px)');
  const key = 'nolu_week_scale_v1';
  let scale = 'overview';
  try { if (localStorage.getItem(key) === 'detail') scale = 'detail'; } catch { /* In-memory choice still works. */ }
  const controls = document.createElement('section');
  controls.className = 'week-mobile-controls';
  controls.setAttribute('aria-label', '手機週課表');
  controls.innerHTML = '<div id="weekScale" role="group" aria-label="週課表縮放"><button type="button" data-week-scale="overview">整週總覽</button><button type="button" data-week-scale="detail">放大編輯</button></div><p id="weekMobileHint"></p><div id="weekDayJump" role="group" aria-label="捲動到星期"></div>';
  classic.prepend(controls);
  const hint = $('#weekMobileHint'), jumps = $('#weekDayJump');
  for (const [index, day] of DAYS.entries()) {
    const button = document.createElement('button'); button.type = 'button';
    button.dataset.weekJump = String(index + 1); button.textContent = day[1].replace('星期', '週');
    button.setAttribute('aria-label', `捲動到${day[1]}，仍保留整週課表`);
    button.onclick = () => jumpToDay(index + 1);
    jumps.append(button);
  }
  function weekly() { return narrow.matches && document.body.classList.contains('schedule-presentation-classic') && !document.body.classList.contains('schedule-day-mode'); }
  function jumpToDay(day) {
    const head = [...grid.querySelectorAll('.cell.head')][day];
    const corner = grid.querySelector('.cell.head');
    if (!head || !corner) return;
    wrap.scrollTo({left: head.offsetLeft - corner.offsetWidth, behavior: 'instant'});
    // Keep these controls as scroll shortcuts, not day filters.
    updateJumpState();
  }
  function updateJumpState() {
    if (!weekly() || scale !== 'detail') return;
    const first = grid.querySelector('[data-slot="1:1"]');
    if (!first) return;
    const day = Math.max(1, Math.min(5, 1 + Math.round(wrap.scrollLeft / first.getBoundingClientRect().width)));
    for (const button of jumps.children) {
      if (Number(button.dataset.weekJump) === day) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    }
  }
  function decorateGrid() {
    const heads = [...grid.querySelectorAll('.cell.head')];
    heads.forEach((head, index) => {
      if (!index || !DAYS[index - 1]) return;
      head.querySelector('b').textContent = narrow.matches ? DAYS[index - 1][1].replace('星期', '週') : DAYS[index - 1][1];
      head.setAttribute('aria-label', DAYS[index - 1][1]);
      head.classList.toggle('week-today', new Date().getDay() === index);
    });
    for (const node of grid.querySelectorAll('[data-course]')) {
      const course = courses().find(c => c.id === node.dataset.course);
      if (course) node.dataset.weekSpan = String(course.end - course.start + 1);
    }
    updateJumpState();
  }
  function setScale(next, remember = true) {
    editor.cancel();
    scale = next === 'detail' ? 'detail' : 'overview';
    classic.dataset.weekDensity = scale;
    for (const button of controls.querySelectorAll('[data-week-scale]')) button.setAttribute('aria-pressed', String(button.dataset.weekScale === scale));
    hint.textContent = scale === 'overview'
      ? '五天一起看。點課程編輯，點空白格新增；換時段可用點選，不必拖曳。'
      : '左右滑動，或點星期定位。點課程編輯；右上把手可拖曳，也可點選換時段。';
    jumps.hidden = scale !== 'detail';
    wrap.scrollLeft = 0;
    if (remember) { try { localStorage.setItem(key, scale); } catch { /* Do not block the timetable when storage is unavailable. */ } }
    decorateGrid();
  }
  controls.querySelectorAll('[data-week-scale]').forEach(button => button.onclick = () => setScale(button.dataset.weekScale));
  wrap.addEventListener('scroll', updateJumpState, {passive: true});
  new MutationObserver(decorateGrid).observe(grid, {childList: true});

  // Reuse the existing editor's discard guard and the existing conflict/undo path.
  const dialog = $('#courseDialog'), move = document.createElement('button');
  move.id = 'weekMoveFromEditor'; move.type = 'button'; move.className = 'btn'; move.hidden = true;
  move.textContent = '在週課表點選新時段';
  dialog.querySelector('.editor-hint').after(move);
  function syncEditor() {
    const course = courses().find(c => c.id === $('#courseId').value);
    move.hidden = !dialog.open || !weekly() || !course || course.day < 1;
  }
  move.onclick = () => {
    const id = $('#courseId').value;
    dialog.querySelector('[data-close]').click();
    if (dialog.open) return; // A canceled discard must not start placement.
    editor.pick(id);
    const course = courses().find(c => c.id === id);
    if (scale === 'detail' && course) jumpToDay(course.day);
    const cell = course && grid.querySelector(`[data-slot="${course.day}:${course.start}"]`);
    if (cell) wrap.scrollTop = Math.max(0, cell.offsetTop - grid.querySelector('.cell.head').offsetHeight - 60);
    controls.scrollIntoView({block: 'start', behavior: 'instant'});
    $('#cancelPlacement').focus({preventScroll: true});
  };
  new MutationObserver(syncEditor).observe(dialog, {attributes: true, attributeFilter: ['open']});
  document.addEventListener('puplan:courses-changed', syncEditor);
  new MutationObserver(() => { syncEditor(); updateJumpState(); }).observe(document.body, {attributes: true, attributeFilter: ['class']});
  narrow.addEventListener('change', () => {editor.cancel(); decorateGrid(); syncEditor();});
  setScale(scale, false);
}
