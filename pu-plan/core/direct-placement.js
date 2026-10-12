import {PERIODS} from './state.js';
import {reviewCourse} from './course-feedback.js';

// Planning is pure: previewing a drag must never write or mutate its source.
export function planCoursePlacement(current, id, day, start) {
  const course = current.find(item => item.id === id);
  if (!course) throw new Error('這門課已更新或移除，請重新選擇。');
  const end = start + course.end - course.start;
  if (course.day === 0 || !Number.isInteger(day) || day < 1 || day > 5 ||
      !Number.isInteger(start) || start < 1 || end > PERIODS.length) {
    throw new Error('請放在週一至週五的完整時段內，不會縮短原本的課程。');
  }
  const draft = {...course, day, start, end};
  const review = reviewCourse(draft, current);
  if (review.duplicate) throw new Error('這個時段已有相同課程，沒有重複移入。');
  return {
    course, draft, conflicts: review.conflicts,
    changed: course.day !== day || course.start !== start,
    next: current.map(item => item.id === id ? draft : item)
  };
}

export function selectedRange(anchor, target) {
  if (!anchor || !target || anchor.day !== target.day) return null;
  const start = Math.min(anchor.period, target.period), end = Math.max(anchor.period, target.period);
  if (!Number.isInteger(anchor.day) || anchor.day < 1 || anchor.day > 5 ||
      !Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > PERIODS.length) return null;
  return {day: anchor.day, start, end};
}
