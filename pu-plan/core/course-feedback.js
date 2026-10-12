import {PERIODS} from './state.js';

// Manual entry and import must agree about what counts as the same course.
export const courseKey = course => {
  const day = Number(course.day);
  const start = day === 0 ? 0 : Number(course.start);
  const end = day === 0 ? 0 : Number(course.end);
  const name = String(course.name ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  return `${day}|${start}|${end}|${name}`;
};
const minutes = value => {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
};

export function reviewCourse(draft = {}, current = []) {
  const day = Number(draft.day), start = Number(draft.start), end = Number(draft.end);
  const validTime = Number.isInteger(day) && day >= 0 && day <= 5 &&
    (day === 0 || Number.isInteger(start) && Number.isInteger(end) && start >= 1 && end >= start && end <= PERIODS.length);
  const result = {validTime, day, start, end, duplicate: null, conflicts: [], periods: 0, teachingMinutes: 0, spanMinutes: 0, breakMinutes: 0, from: '', to: ''};
  if (!validTime) return result;
  const others = (Array.isArray(current) ? current : []).filter(c => c && typeof c === 'object' && (!draft.id || c.id !== draft.id));
  if (String(draft.name ?? '').trim()) result.duplicate = others.find(c => courseKey(c) === courseKey(draft)) || null;
  if (day === 0) return result;
  result.conflicts = others.filter(c => Number(c.day) === day && Number(c.start) <= end && Number(c.end) >= start)
    .sort((a, b) => Number(a.start) - Number(b.start) || Number(a.end) - Number(b.end));
  result.periods = end - start + 1;
  result.from = PERIODS[start - 1][0]; result.to = PERIODS[end - 1][1];
  result.teachingMinutes = PERIODS.slice(start - 1, end).reduce((sum, [from, to]) => sum + minutes(to) - minutes(from), 0);
  result.spanMinutes = minutes(result.to) - minutes(result.from);
  result.breakMinutes = result.spanMinutes - result.teachingMinutes;
  return result;
}
