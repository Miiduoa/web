import {$, DAYS, PERIODS, courses, time, getSelectedDay} from '../core/state.js';
import {reviewCourse} from '../core/course-feedback.js';
import {openCourse} from './schedule.js';

const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };

export function initEditorFeedback() {
  const dialog = $('#courseDialog'), form = $('#courseForm');
  if (!dialog || !form || $('#coursePreview')) return;
  // The field labels already identify the period. Keep the selected option short
  // enough for a narrow phone and show the end boundary, not its start time.
  for (const [id, boundary] of [['start', 0], ['end', 1]]) {
    for (const option of $('#'+id).options) {
      const period = PERIODS[Number(option.value) - 1];
      if (period) option.textContent = `${option.value} · ${period[boundary]}`;
    }
  }
  const preview = document.createElement('section');
  preview.id = 'coursePreview'; preview.className = 'course-preview';
  preview.setAttribute('aria-label', '上課時段預覽');
  preview.innerHTML = '<b id="courseTimeSummary"></b><small id="courseDuration"></small><div id="courseChecks" role="status" aria-live="polite" aria-atomic="true"></div>';
  $('#courseError').before(preview);
  $('#courseName').autofocus = true;
  for (const id of ['day', 'start', 'end']) $('#'+id).setAttribute('aria-describedby', 'courseTimeSummary courseDuration');
  let checkSignature = '';
  const draft = () => ({id: $('#courseId').value, name: $('#courseName').value, day: +$('#day').value, start: +$('#start').value, end: +$('#end').value});
  function refresh() {
    if (!dialog.open) return;
    const review = reviewCourse(draft(), courses());
    preview.dataset.state = !review.validTime ? 'invalid' : review.duplicate ? 'duplicate' : review.conflicts.length ? 'warning' : 'ready';
    text($('#courseTimeSummary'), !review.validTime ? '請確認星期與開始、結束節次' : review.day === 0 ? '未排定時間 · 依最新公告' : `每週${DAYS[review.day - 1][1]} · ${review.from}–${review.to}`);
    text($('#courseDuration'), !review.validTime ? '結束節次不能早於開始節次。' : review.day === 0 ? '會保留在未排定課程，不計入可約時間的課表占用。' : `${review.periods} 節課 · 實際授課 ${review.teachingMinutes} 分鐘${review.breakMinutes ? ` · 時段另含 ${review.breakMinutes} 分鐘課間休息` : ''}`);
    const signature = JSON.stringify([preview.dataset.state, review.day === 0, review.duplicate?.name, review.conflicts.map(c => [c.name, c.start, c.end])]);
    if (signature === checkSignature) return;
    checkSignature = signature;
    const checks = $('#courseChecks'); checks.replaceChildren();
    const message = document.createElement('p');
    if (!review.validTime) message.textContent = '時段尚未完整，請先調整上方欄位。';
    else if (review.duplicate) message.textContent = `課表已有「${review.duplicate.name}」的相同時段，不會重複新增。請取消後直接點選原課程編輯。`;
    else if (review.conflicts.length) message.textContent = `與 ${review.conflicts.length} 門課時間重疊。可以調整節次；仍要保留時，儲存會再請你確認。`;
    else message.textContent = review.day === 0 ? '尚未確認時間，不代表這門課不會衝堂。' : '目前課表沒有重疊課程；不代表沒有其他行程。';
    checks.append(message);
    if (review.conflicts.length && !review.duplicate) {
      const list = document.createElement('ul');
      for (const course of review.conflicts) {
        const item = document.createElement('li'); item.textContent = `${course.name} · ${time(course)}`; list.append(item);
      }
      checks.append(list);
    }
  }
  form.addEventListener('input', refresh);
  form.addEventListener('change', refresh);
  // The existing stale-snapshot guard is registered first and remains authoritative.
  form.addEventListener('submit', event => {
    if (!dialog.open) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    const review = reviewCourse(draft(), courses());
    if (!review.duplicate) return;
    event.preventDefault(); event.stopImmediatePropagation(); refresh();
    const error = $('#courseError'); error.hidden = false;
    error.textContent = '這門課與現有課程重複，尚未新增。請修改名稱或時段，或取消後編輯原課程。';
    $('#courseName').setAttribute('aria-invalid', 'true'); $('#courseName').focus();
  }, true);
  new MutationObserver(refresh).observe(dialog, {attributes: true, attributeFilter: ['open']});
  document.addEventListener('puplan:courses-changed', refresh);
  if ($('#count')) new MutationObserver(refresh).observe($('#count'), {childList: true});
  window.addEventListener('storage', event => { if (event.key === 'puplan_courses') refresh(); });

  // The file input is hidden, so its label needs an explicit keyboard entry point.
  const drop = $('#importDrop'), image = $('#scheduleImageInput');
  if (drop && image) {
    drop.tabIndex = 0; drop.setAttribute('role', 'button');
    drop.setAttribute('aria-label', '選擇課表截圖，PNG、JPEG 或 WebP，最多 20 MB');
    drop.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault(); if (!event.repeat) image.click();
    });
  }
  function addForDay(day) {
    // Prefill only the editor. Cancelling must not silently change the weekday
    // stored behind the currently displayed tabs and single-day content.
    openCourse();
    $('#day').value = String(day);
    $('#day').dispatchEvent(new Event('change', {bubbles: true}));
  }
  const week = $('#humanWeek');
  function decorateWeek() {
    for (const section of week?.querySelectorAll('[data-week-day]') || []) {
      const header = section.querySelector('header');
      if (!header || header.querySelector('[data-day-add]')) continue;
      const day = Number(section.dataset.weekDay);
      if (!DAYS[day - 1]) continue;
      const button = document.createElement('button'); button.type = 'button';
      button.className = 'day-add'; button.dataset.dayAdd = String(day); button.textContent = '＋ 新增';
      button.setAttribute('aria-label', `新增${DAYS[day - 1][1]}的課程`); header.append(button);
    }
  }
  week?.addEventListener('click', event => {
    const button = event.target.closest?.('[data-day-add]');
    if (button && week.contains(button)) addForDay(+button.dataset.dayAdd);
  });
  if (week) new MutationObserver(decorateWeek).observe(week, {childList: true});
  decorateWeek();
  const mobile = $('#mobile');
  function decorateEmptyDay() {
    if (!mobile || mobile.querySelector('[data-course],.day-empty-add')) return;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'btn day-empty-add';
    button.textContent = `新增${DAYS[getSelectedDay() - 1][1]}的課程`;
    button.onclick = () => addForDay(getSelectedDay()); mobile.append(button);
  }
  if (mobile) new MutationObserver(decorateEmptyDay).observe(mobile, {childList: true});
  decorateEmptyDay();
  function fitEditor() {
    const height = window.visualViewport?.height || window.innerHeight;
    if (Number.isFinite(height) && height > 0) dialog.style.setProperty('--editor-viewport', `${Math.round(height)}px`);
  }
  window.visualViewport?.addEventListener('resize', fitEditor, {passive: true});
  window.addEventListener('resize', fitEditor, {passive: true}); fitEditor();
}
