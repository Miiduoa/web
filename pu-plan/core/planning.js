import {DAYS, PERIODS} from './state.js';

export const minutes = value => {
  const [h, m] = String(value).split(':').map(Number);
  return h * 60 + m;
};
export const clock = value => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
export const dateLabel = date => `${date.getMonth() + 1}/${date.getDate()}（${DAYS[date.getDay() - 1]?.[0] || '週末'}）`;
const dayMap = {'一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0};
const normalize = text => String(text || '').replace(/[０-９]/g, c => String(c.charCodeAt(0) - 65296));
const validCourses = data => (Array.isArray(data) ? data : []).filter(c => c && Number.isInteger(c.day) && c.day >= 1 && c.day <= 5 && Number.isInteger(c.start) && c.start >= 1 && Number.isInteger(c.end) && c.end >= c.start && c.end <= PERIODS.length);

function numberWord(value) {
  if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value);
  const digits = {'零': 0, '一': 1, '二': 2, '兩': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9};
  if (value.includes('百')) {
    const [a,b]=value.split('百');return (digits[a]||0)*100+(b?numberWord(b.replace(/^零/,'')):0);
  }
  if (value.includes('十')) {
    const [a, b] = value.split('十');
    return (a ? digits[a] : 1) * 10 + (b ? digits[b] : 0);
  }
  return digits[value];
}

export function parseDuration(text, fallback = 120) {
  const q = normalize(text);
  const matches=[...q.matchAll(/(-?\d+(?:\.\d+)?|[零一二兩三四五六七八九十百]{1,6})\s*(?:個)?\s*(半)?\s*(小時|分鐘|節)(半)?/g)];
  let value=fallback;
  if(matches.length){
    value=matches.reduce((total,m)=>total+numberWord(m[1])*(m[3]==='小時'?60:m[3]==='節'?50:1)+(m[2]||m[4]?(m[3]==='小時'?30:m[3]==='分鐘'?.5:25):0),0);
  }else if(/半(?:個)?小時/.test(q))value=30;
  if (!Number.isFinite(value) || value <= 0 || value > 720) throw new Error('請使用 1–720 分鐘的時間長度。');
  return Math.ceil(value);
}

export function resolveDay(text, now = new Date(), remembered = null) {
  const q = normalize(text);
  if (/週末|周末/.test(q)) return {error: '目前課表只支援星期一到星期五，不能把週末當成已確認的空檔。'};
  const relative = q.includes('後天') ? 2 : q.includes('明天') ? 1 : q.includes('今天') ? 0 : null;
  if (relative !== null) {
    const date = new Date(now); date.setDate(date.getDate() + relative);
    return date.getDay() === 0 || date.getDay() === 6
      ? {error: '指定的是週末。目前沒有週末課表資料，請改選星期一到星期五。'}
      : {day: date.getDay(), offset: relative, date};
  }
  const match = q.match(/(?:星期|週|周|禮拜)\s*([一二三四五六日天1-7])/);
  if (match) {
    const day = dayMap[match[1]] ?? Number(match[1]) % 7;
    if (day === 0 || day === 6) return {error: '目前課表只支援星期一到星期五，無法判斷這一天的空檔。'};
    let offset = (day - now.getDay() + 7) % 7;
    if (/下(?:週|周|星期|禮拜)/.test(q)) offset = (8 - (now.getDay() || 7)) + day - 1;
    return {day, offset};
  }
  if (/那天|那一天/.test(q) && remembered) return {day: remembered};
  return {day: null};
}

// Use real minute intervals, rather than whole free-period groups. This allows a
// daytime opening to be clipped to an evening request without losing the opening.
export function availableWindows(data, options = {}) {
  const {now = new Date(), day = null, offset = null, earliest = minutes(PERIODS[0][0]), latest = minutes(PERIODS.at(-1)[1]), thisWeek = false} = options;
  const all = validCourses(data), output = [];
  const offsets = Number.isInteger(offset) ? [offset] : Array.from({length: 7}, (_, i) => i);
  for (const plus of offsets) {
    if (plus < 0) continue;
    if (thisWeek && plus > 7 - (now.getDay() || 7)) continue;
    const date = new Date(now); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() + plus);
    const d = date.getDay();
    if (d < 1 || d > 5 || (day && day !== d)) continue;
    let cursor = Math.max(earliest, plus === 0 ? Math.ceil((now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60) / 5) * 5 : earliest);
    const endOfDay = latest;
    const busy = all.filter(c => c.day === d).map(c => [minutes(PERIODS[c.start - 1][0]), minutes(PERIODS[c.end - 1][1])]).sort((a, b) => a[0] - b[0]);
    for (const [start, end] of busy) {
      if (end <= cursor || start >= endOfDay) continue;
      if (start > cursor) output.push({day: d, date: new Date(date), start: cursor, end: Math.min(start, endOfDay)});
      cursor = Math.max(cursor, end);
    }
    if (cursor < endOfDay) output.push({day: d, date: new Date(date), start: cursor, end: endOfDay});
  }
  return output.filter(b => b.end > b.start).sort((a, b) => a.date - b.date || a.start - b.start);
}

export function allocatePlan(windows, duration, split = false) {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 720) throw new Error('安排時間必須介於 1–720 分鐘。');
  if (!split) {
    const block = windows.find(b => b.end - b.start >= duration);
    return {picks: block ? [{...block, end: block.start + duration}] : [], remaining: block ? 0 : duration};
  }
  let remaining = duration;
  const picks = [], chunk = Math.max(1, Math.min(60, Math.ceil(duration / 2)));
  for (const b of windows) {
    let cursor = b.start;
    while (remaining > 0 && cursor < b.end) {
      const use = Math.min(remaining, chunk, b.end - cursor);
      if (use < Math.min(20, remaining)) break;
      picks.push({...b, start: cursor, end: cursor + use});
      remaining -= use;
      cursor += use + 10;
    }
    if (!remaining) break;
  }
  return {picks, remaining};
}

export function nextClass(data, now = new Date()) {
  const all = validCourses(data), minute = now.getHours() * 60 + now.getMinutes();
  for (let plus = 0; plus <= 7; plus++) {
    const date = new Date(now); date.setDate(date.getDate() + plus);
    for (const course of all.filter(c => c.day === date.getDay()).sort((a, b) => a.start - b.start)) {
      const start = minutes(PERIODS[course.start - 1][0]), end = minutes(PERIODS[course.end - 1][1]);
      if (!plus && minute >= end) continue;
      return {course, date, kind: !plus && minute >= start ? 'now' : 'next', minutes: !plus ? (minute >= start ? end - minute : start - minute) : null};
    }
  }
  return null;
}
