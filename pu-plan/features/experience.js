import {$, courses, scheduleMeta, toast} from '../core/state.js';
import {planImport, parseBackup} from '../core/import-plan.js';

const courseFields = ['courseId','courseName','day','start','end','teacher','room','color'];
const formSnapshot = () => JSON.stringify(courseFields.map(id => $('#'+id)?.value || ''));
const dataSnapshot = () => JSON.stringify([courses(), scheduleMeta(), localStorage.getItem('puplan_course_owner')]);
const icons = {
  schedule: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18M8 15h2m4 0h2"/>',
  friends: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m2-16a3 3 0 0 1 0 6m2 3a5 5 0 0 1 2 4v3"/>',
  ai: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  settings: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  community: '<path d="M21 11a8 8 0 0 1-8 8H7l-4 3V11a9 9 0 0 1 18 0Z"/><path d="M8 10h8m-8 4h5"/>'
};

export function initExperience() {
  const courseDialog = $('#courseDialog'), importDialog = $('#importDialog');
  let initialForm = '', initialData = '';
  const dirtyCourse = () => courseDialog.open && initialForm !== formSnapshot();
  function trackEditor() {
    if (courseDialog.open) { initialForm = formSnapshot(); initialData = dataSnapshot(); }
  }
  new MutationObserver(trackEditor).observe(courseDialog, {attributes:true, attributeFilter:['open']});
  function allowClose(dialog) {
    if (dialog === courseDialog && dirtyCourse()) return confirm('課程還沒儲存。確定捨棄這次修改？');
    if (dialog === importDialog && dialog.dataset.pending === 'true') return confirm('課表還沒匯入。確定關閉並捨棄這次辨識結果？');
    return true;
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    const dialog = button.dataset.close ? $('#'+button.dataset.close) : button.id === 'cancelImport' ? importDialog : null;
    if (dialog && !allowClose(dialog)) { event.preventDefault(); event.stopImmediatePropagation(); }
    if (['shareTop','copyLink','copyCode'].includes(button.id)) {
      const count = courses().length;
      if (!count || !confirm(`分享目前 ${count} 門課的副本？\n內容包含名稱、課程、老師與教室；任何取得連結的人都能讀取，副本不會自動更新，也無法撤回。`)) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!count) toast('課表還是空的，先新增課程再分享。');
      }
    }
  }, true);
  for (const dialog of [courseDialog, importDialog]) {
    dialog.addEventListener('cancel', event => { if (!allowClose(dialog)) event.preventDefault(); });
  }
  function rejectStaleEdit(event) {
    if (dataSnapshot() === initialData) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const error = $('#courseError'); error.hidden = false;
    error.textContent = '課表已在其他操作或裝置更新。這次尚未儲存，請保留你的修改，關閉後重新確認，避免覆蓋新資料。';
    $('#courseName').focus();
  }
  $('#courseForm').addEventListener('submit', rejectStaleEdit, true);
  $('#deleteCourse').addEventListener('click', rejectStaleEdit, true);
  window.addEventListener('beforeunload', event => {
    if (!dirtyCourse() && !(importDialog.open && importDialog.dataset.pending === 'true')) return;
    event.preventDefault(); event.returnValue = '';
  });

  // Keep controls behind the sign-in overlay out of the keyboard/accessibility tree.
  const gate = $('#authGate');
  function syncGate() {
    const open = !gate.classList.contains('off');
    for (const element of document.querySelectorAll('.shell,.bottom,#mobileAdd')) element.inert = open;
    document.body.classList.toggle('auth-is-open', open);
    gate.setAttribute('aria-hidden', String(!open));
    for (const tab of gate.querySelectorAll('[data-auth-tab]')) tab.setAttribute('aria-pressed', String(tab.classList.contains('on')));
  }
  new MutationObserver(syncGate).observe(gate, {attributes:true, subtree:true, attributeFilter:['class']});
  syncGate();
  for (const id of ['regPassword','loginPassword']) {
    const input = $('#'+id), control = document.createElement('div'), toggle = document.createElement('button');
    control.className = 'password-control'; input.before(control); control.append(input);
    toggle.type = 'button'; toggle.className = 'password-toggle'; toggle.textContent = '顯示';
    toggle.setAttribute('aria-label', '顯示密碼'); toggle.setAttribute('aria-pressed', 'false');
    toggle.setAttribute('aria-controls', id);
    toggle.addEventListener('click', () => {
      const show = input.type === 'password'; input.type = show ? 'text' : 'password';
      toggle.textContent = show ? '隱藏' : '顯示'; toggle.setAttribute('aria-pressed', String(show));
      toggle.setAttribute('aria-label', show ? '隱藏密碼' : '顯示密碼');
    });
    control.append(toggle);
  }
  const passwordHint = document.createElement('small');
  passwordHint.id = 'passwordHint'; passwordHint.textContent = '至少 8 個字元，建議使用未在其他網站用過的密碼。';
  $('#regPassword').closest('label').append(passwordHint); $('#regPassword').setAttribute('aria-describedby', 'passwordHint');
  for (const id of ['regEmail','loginEmail','regUsername']) {
    const input = $('#'+id); input.autocapitalize = 'none'; input.spellcheck = false;
  }
  $('#regUsername').minLength = 2;

  function decorateNavigation() {
    for (const button of document.querySelectorAll('.nav button,.bottom button')) {
      const kind = button.dataset.view || (button.hasAttribute('data-community-open') ? 'community' : '');
      if (icons[kind] && !button.querySelector('.nav-icon')) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
        svg.setAttribute('viewBox','0 0 24 24'); svg.setAttribute('class','nav-icon');
        svg.setAttribute('aria-hidden','true'); svg.setAttribute('fill','none');
        svg.setAttribute('stroke','currentColor'); svg.setAttribute('stroke-width','1.7');
        svg.setAttribute('stroke-linecap','round'); svg.setAttribute('stroke-linejoin','round');
        svg.innerHTML = icons[kind]; button.prepend(svg);
      }
      if (button.classList.contains('on')) button.setAttribute('aria-current','page');
      else button.removeAttribute('aria-current');
    }
    const title = $('#title')?.textContent;
    if (title) document.title = `${title} · nolu`;
  }
  for (const nav of document.querySelectorAll('.nav,.bottom')) {
    new MutationObserver(decorateNavigation).observe(nav, {childList:true, subtree:true, attributes:true, attributeFilter:['class']});
  }
  decorateNavigation();
  const skip = document.createElement('a'); skip.className = 'skip-link'; skip.href = '#mainContent'; skip.textContent = '跳到主要內容';
  const main = $('.main'); main.id = 'mainContent'; main.tabIndex = -1; $('.shell').prepend(skip);
  function syncEmpty() { document.body.classList.toggle('schedule-is-empty', courses().length === 0); }
  document.addEventListener('puplan:courses-changed', syncEmpty);
  document.addEventListener('puplan:profile-changed', syncEmpty); syncEmpty();
  installBackup();
}

function installBackup() {
  const card = document.createElement('article'); card.className = 'setting-card backup-card';
  card.innerHTML = '<h3>課表備份</h3><p>把這個瀏覽器的課程另存一份。檔案包含老師、教室等課表內容，但不包含帳號、密碼、登入憑證或聊天。請妥善保存。</p><div class="row"><button class="btn primary" type="button" id="downloadSchedule">下載課表備份</button><button class="btn" type="button" id="restoreSchedule">從備份合併課程</button></div><input id="backupInput" type="file" accept=".json,application/json" hidden><p id="backupStatus" class="backup-status" role="status"></p>';
  $('#settings .settings').prepend(card);
  $('#downloadSchedule').onclick = () => {
    if (!courses().length) { toast('目前沒有課程可以備份。'); return; }
    const backup = {format:'nolu-schedule', version:1, exportedAt:new Date().toISOString(), courses:courses(), meta:scheduleMeta()};
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)], {type:'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = 'nolu-schedule-'+new Date().toISOString().slice(0,10)+'.json';
    document.body.append(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),60000);
    $('#backupStatus').textContent = '已交給瀏覽器下載，請確認檔案已存到「下載項目」或「檔案」App。';
  };
  $('#restoreSchedule').onclick = () => $('#backupInput').click();
  $('#backupInput').onchange = async event => {
    const input = event.target, file = input.files?.[0]; input.value = '';
    if (!file) return;
    const status = $('#backupStatus'), before = dataSnapshot();
    try {
      if (file.size > 512*1024) throw new Error('備份檔超過 512 KB，未讀取或修改課表。');
      const parsed = parseBackup(await file.text());
      if (before !== dataSnapshot()) throw new Error('讀取期間課表已更新，請重新選擇備份。');
      const plan = planImport(courses(), parsed.courses, 'merge');
      if (!plan.added) { status.textContent = '這份備份的課程都已存在，沒有重複新增。'; return; }
      if (!confirm(`從備份新增 ${plan.added} 門課？\n保留目前課表與學期，略過 ${plan.duplicates} 門重複課程。${plan.conflicts ? `\n有 ${plan.conflicts} 門衝堂，請確認是否仍要合併。` : ''}`)) return;
      if (before !== dataSnapshot()) throw new Error('確認期間課表已更新，請重新選擇備份。');
      window.PUPLAN_APP.setCoursesFromUser(plan.courses);
      status.textContent = `已合併 ${plan.added} 門課，原有課程與學期設定均保留。`;
      toast('備份課程已合併，已儲存在此裝置。');
    } catch (error) { status.textContent = error.message || '讀取或儲存失敗，請保留備份檔。'; }
  };
}
