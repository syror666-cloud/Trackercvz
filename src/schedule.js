'use strict';

// Time-zone aware scheduling for recurring push messages (no dependencies; uses Intl).

const DAY_MS = 86400000;

function tzOffsetMs(utcMs, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Local date (YYYY-MM-DD) of an instant in the given time zone. */
function localDate(utcMs, tz) {
  return new Date(utcMs + tzOffsetMs(utcMs, tz)).toISOString().slice(0, 10);
}

/** Converts a wall-clock date + time in `tz` to a UTC timestamp. */
function zonedToUtc(date, time, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - tzOffsetMs(guess, tz);
  const second = guess - tzOffsetMs(first, tz);
  return second;
}

/** ISO weekday 1 (Mon) … 7 (Sun) of a YYYY-MM-DD date. */
function isoWeekday(date) {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/**
 * Next run strictly after `afterMs` for a recurring schedule.
 * schedule: 'daily' | 'weekly'; time 'HH:MM'; weekdays: array of ISO weekdays (weekly only).
 */
function nextRecurringRun({ schedule, time, weekdays }, afterMs, tz) {
  const start = localDate(afterMs, tz);
  for (let i = 0; i <= 8; i++) {
    const date = new Date(Date.parse(`${start}T00:00:00Z`) + i * DAY_MS).toISOString().slice(0, 10);
    if (schedule === 'weekly' && !weekdays.includes(isoWeekday(date))) continue;
    const at = zonedToUtc(date, time, tz);
    if (at > afterMs) return at;
  }
  return null;
}

module.exports = { nextRecurringRun, localDate, zonedToUtc, isoWeekday };
