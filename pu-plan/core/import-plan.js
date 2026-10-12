import {cleanCourse} from './state.js';
import {courseKey as key} from './course-feedback.js';

export function planImport(current, drafts, mode = 'merge') {
  if (!Array.isArray(current) || !Array.isArray(drafts)) throw new Error('課表格式不正確。');
  if (!['merge', 'replace'].includes(mode)) throw new Error('請選擇合併或取代課表。');
  const chosen = drafts.filter(c => c && c.selected !== false);
  if (!chosen.length) throw new Error('請至少選擇一門課。');
  const next = mode === 'merge' ? current.map(cleanCourse) : [];
  const keys = new Set(next.map(key));
  const ids = new Set(next.map(c => c.id));
  let added = 0, duplicates = 0, conflicts = 0;
  for (const [index, course] of chosen.entries()) {
    const name = typeof course.name === 'string' ? course.name.trim() : '';
    if (!name || name.length > 100) throw new Error(`第 ${index + 1} 門課：請填寫 1–100 字的課程名稱。`);
    const day = Number(course.day), start = Number(course.start), end = Number(course.end);
    if (!Number.isInteger(day) || day < 0 || day > 5) throw new Error(`「${name}」的星期不正確。`);
    if (day !== 0 && (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > 13)) {
      throw new Error(`「${name}」的節次不正確，結束節次不能早於開始。`);
    }
    const item = cleanCourse({...course, name, day, start, end});
    if (keys.has(key(item))) { duplicates++; continue; }
    if (item.day > 0 && next.some(c => c.day === item.day && c.start <= item.end && c.end >= item.start)) conflicts++;
    if (ids.has(item.id)) item.id = crypto.randomUUID();
    next.push(item); keys.add(key(item)); ids.add(item.id); added++;
  }
  if (next.length > 80) throw new Error(`合計 ${next.length} 門，超過 80 門上限。請減少勾選；原課表不會被修改。`);
  return {courses: next, added, duplicates, conflicts, replaced: mode === 'replace' ? current.length : 0};
}

export function parseBackup(text) {
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('這不是可讀取的課表備份檔。'); }
  if (!value || value.format !== 'nolu-schedule' || value.version !== 1 || !Array.isArray(value.courses)) {
    throw new Error('請選擇由 nolu「下載課表備份」產生的 JSON 檔案。');
  }
  if (value.courses.length > 80) throw new Error('備份超過 80 門課，未載入任何資料。');
  if (!value.courses.length) throw new Error('這份備份沒有課程，未修改目前課表。');
  // Reject invalid data rather than silently repairing times or dropping courses.
  return planImport([], value.courses, 'replace');
}
