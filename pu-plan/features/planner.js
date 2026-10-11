import {availableWindows, allocatePlan, clock, dateLabel, nextClass, parseDuration, resolveDay} from '../core/planning.js';

const app = window.PUPLAN_APP;
if (!app) throw new Error('安排功能暫時無法開啟');
const $ = s => document.querySelector(s);
const memory = {day: null, courseId: '', plan: null};
const history = [];
const courses = () => app.courses().filter(c => c.day >= 1 && c.day <= 5);
const dayName = d => app.DAYS[d - 1]?.[1] || '';
const label = b => `${dateLabel(b.date)} ${clock(b.start)}–${clock(b.end)}`;
const clean = s => String(s || '').replace(/[\s，,。.!！?？：:「」『』()（）]/g, '').toLowerCase();

function resolveCourse(text) {
  const q = clean(text);
  let found = courses().find(c => clean(c.name).length >= 2 && q.includes(clean(c.name)));
  if (!found && /那堂|那門|這堂|這門|剛剛那|它/.test(text)) found = courses().find(c => c.id === memory.courseId);
  if (found) memory.courseId = found.id;
  return found;
}

function plan(text) {
  if (!courses().length) return '先新增或匯入課程，才能依照課表找空檔。沒有排課資料，不代表整天都有空。';
  const requested = resolveDay(text, new Date(), memory.day);
  if (requested.error) return requested.error;
  const duration = parseDuration(text), course = resolveCourse(text);
  const subject = course?.name || memory.plan?.subject || '讀書／作業';
  const options = {...requested, thisWeek: /這週|本週/.test(text)};
  if (/晚上|傍晚/.test(text)) options.earliest = 18 * 60;
  if (/不要太晚|別太晚|早點/.test(text)) options.latest = 20 * 60 + 45;
  const split = /分段|拆開|分兩/.test(text);
  const {picks, remaining} = allocatePlan(availableWindows(courses(), options), duration, split);
  memory.plan = {subject, duration}; memory.day = requested.day || memory.day;
  if (!picks.length) return `找不到符合條件、連續 ${duration} 分鐘的時段。可以改用「分段安排」，或換一天。`;
  const lines = picks.map((b, i) => `${i + 1}. ${label(b)}｜${subject}，${b.end - b.start} 分鐘`);
  return `建議時段（共 ${duration - remaining} 分鐘）：\n${lines.join('\n')}${remaining ? `\n還差 ${remaining} 分鐘，尚未排滿。` : ''}\n這是依目前課表計算的建議，未建立行程，也未發出邀約；請另外確認私人行程與學校公告。`;
}

function reply(text) {
  const q = String(text || '').trim();
  if (!q) return '';
  if (q.length > 500) return '請把問題縮短到 500 字以內。';
  try {
    if (memory.plan && /^(?:改到|改成|換到|分兩段|分段|不要太晚)/.test(q)) return plan(`${memory.plan.subject} ${q}${/小時|分鐘|節/.test(q)?'':` ${memory.plan.duration}分鐘`}`);
    const requested = resolveDay(q, new Date(), memory.day), course = resolveCourse(q);
    if (requested.error) return requested.error;
    const day = requested.day;
    if (day) memory.day = day;
    if (/下一堂|下一節|等等上|現在上|正在上/.test(q)) {
      const n = nextClass(courses());
      if (!n) return '目前沒有可查詢的已排定課程。請先新增或匯入課表。';
      memory.courseId = n.course.id; memory.day = n.course.day;
      return n.kind === 'now'
        ? `現在是「${n.course.name}」，約 ${n.minutes} 分鐘後下課${n.course.room ? `，在 ${n.course.room}` : ''}。`
        : `下一堂是 ${dateLabel(n.date)} 的「${n.course.name}」，${app.PERIODS[n.course.start - 1][0]} 開始${n.course.room ? `，在 ${n.course.room}` : ''}。`;
    }
    if (course && /老師|誰教|教授|授課/.test(q)) return course.teacher ? `「${course.name}」的老師是 ${course.teacher}。` : `「${course.name}」尚未填寫授課老師。`;
    if (course && /教室|哪裡|在哪|地點/.test(q)) return course.room ? `「${course.name}」在 ${course.room}。` : `「${course.name}」尚未填寫教室。`;
    if (course && /幾點|時間|第幾節|什麼時候/.test(q)) return `「${course.name}」是${dayName(course.day)}，${app.time(course)}。`;
    if (day && /有什麼課|有哪些課|上什麼|幾堂|課表|課程|那呢|呢/.test(q)) {
      const list = courses().filter(c => c.day === day).sort((a, b) => a.start - b.start);
      return list.length ? `${dayName(day)}有 ${list.length} 門課：\n${list.map((c, i) => `${i + 1}. ${app.time(c)}｜${c.name}${c.room ? `｜${c.room}` : ''}`).join('\n')}` : `目前課表中，${dayName(day)}沒有排課。`;
    }
    if (/最忙|最累|哪天.*忙|哪天.*累/.test(q)) {
      if (!courses().length) return '課表還是空的，暫時無法比較哪一天最忙。';
      const load = app.DAYS.map((_, i) => {
        const list = courses().filter(c => c.day === i + 1), slots = new Set();
        list.forEach(c => {for (let p = c.start; p <= c.end; p++) slots.add(p)});
        return {day: i + 1, count: list.length, periods: slots.size};
      }).sort((a, b) => b.periods - a.periods || b.count - a.count)[0];
      return `依目前課表，${dayName(load.day)}最滿：${load.count} 門課，占用 ${load.periods} 節（衝堂不重複計算）。`;
    }
    if (/共同空堂|共同空檔|跟.*(?:好友|朋友).*空|一起有空/.test(q)) {
      const selected = app.getSelectedFriend?.();
      const friend = typeof selected === 'string' ? app.friends().find(f => f.id === selected) : selected;
      if (!friend) return '先到「找人」選一位朋友，再比較雙方課表。';
      if (!courses().length || !friend.courses?.length) return '目前有一方沒有排課資料，不能把缺少資料當成共同有空。';
      const windows = availableWindows([...courses(), ...friend.courses], requested).filter(b => b.end - b.start >= 100).slice(0, 5);
      return windows.length ? `你和 ${friend.name} 的共同課表空檔：\n${windows.map((b, i) => `${i + 1}. ${label(b)}`).join('\n')}\n僅依雙方目前的課表判斷，尚未發出邀約。` : '未來七天沒有找到 100 分鐘以上的共同課表空檔。';
    }
    if (/安排|規劃|(?:\d+|兩|一|二|三|半)\s*(?:個)?\s*(?:小時|分鐘|節)/.test(q)) return plan(q);
    if (/空堂|空檔|有空|自由時間/.test(q)) {
      if (!courses().length) return '請先新增或匯入課表，才能判斷課表空檔。';
      const windows = availableWindows(courses(), {...requested, thisWeek: /這週|本週/.test(q)}).filter(b => b.end - b.start >= 100).slice(0, 5);
      return windows.length ? `接下來的課表空檔：\n${windows.map((b, i) => `${i + 1}. ${label(b)}`).join('\n')}\n未包含私人行程，請自行確認。` : '指定範圍內沒有找到 100 分鐘以上的課表空檔。';
    }
    return '目前支援查課程、找空堂及安排讀書時段。可以問「星期三有什麼課」或「晚上安排兩小時讀書，不要太晚」。';
  } catch (error) { return error.message || '這次條件無法計算，請改用明確的星期與分鐘數。'; }
}

function bubble(role, text) {
  const box = $('#aiMessages');
  const div = document.createElement('div'); div.className = `bubble ${role}`; div.textContent = text;
  box.append(div);
  while (box.children.length > 60) box.firstElementChild.remove();
  box.scrollTop = box.scrollHeight;
}
function send(value) {
  const input = $('#aiInput'), text = typeof value === 'string' ? value.trim() : input.value.trim();
  if (!text) return;
  if (text.length > 500) return app.toast('請把問題縮短到 500 字以內');
  input.value = ''; bubble('me', text);
  const answer = reply(text); bubble('ai', answer);
  history.push({role: 'user', text}, {role: 'assistant', text: answer});
  if (history.length > 60) history.splice(0, history.length - 60);
}
$('#aiSend').onclick = () => send();
$('#aiInput').onkeydown = e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {e.preventDefault(); send()}
};
const prompts = {stress: '哪天最忙？', free: '找長空堂', study: '安排兩小時讀書', friend: '跟好友找共同空堂'};
document.querySelectorAll('[data-smart]').forEach(button => button.onclick = () => send(prompts[button.dataset.smart]));
$('#plannerApply').onclick = () => {
  const day = $('#plannerDay').value, length = $('#plannerDuration').value;
  send(`${day ? `星期${day} ` : ''}安排 ${length} 分鐘讀書${$('#plannerEvening').checked ? '，晚上' : ''}${$('#plannerSplit').checked ? '，分段安排' : ''}`);
};
window.NOLU_PLANNER = {ask: reply, history};
