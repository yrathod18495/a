// Support information shown on the Help and support page: office hours, the reply time, and whether the office is open right now.
// EDIT THIS FILE to change the hours or the reply time; the page and the tests follow it.
export const SUPPORT = Object.freeze({
  timeZone: 'Asia/Kolkata',
  zoneLabel: 'IST (Indian Standard Time)',
  replyWindow: '1 to 2 hours',
  // 0 = Sunday ... 6 = Saturday; null = closed. Times are 24-hour "HH:MM" in the time zone above.
  week: Object.freeze([null, ['10:00', '19:00'], ['10:00', '19:00'], ['10:00', '19:00'], ['10:00', '19:00'], ['10:00', '19:00'], ['10:00', '19:00']]),
});
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const minutes = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
/** "10:00" -> "10:00 AM", "19:00" -> "7:00 PM" */
export function clock(hhmm) {
  const [h, m] = hhmm.split(':').map(Number), suffix = h >= 12 ? 'PM' : 'AM', hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}
/** the day (0-6) and minutes since midnight in the support time zone */
export function localParts(now = Date.now(), support = SUPPORT) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: support.timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(now));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { day, minute: (Number(get('hour')) % 24) * 60 + Number(get('minute')) };
}
/** is the office open now, and when does it open next: { open, closesAt, opensAt: { day, time, today } } */
export function supportStatus(now = Date.now(), support = SUPPORT) {
  const { day, minute } = localParts(now, support), today = support.week[day];
  if (today && minute >= minutes(today[0]) && minute < minutes(today[1])) return { open: true, closesAt: today[1] };
  for (let step = 0; step < 8; step++) {
    const d = (day + step) % 7, hours = support.week[d];
    if (!hours) continue;
    if (step === 0 && minute >= minutes(hours[0])) continue;           // today's hours are already over
    return { open: false, opensAt: { day: d, dayName: DAYS[d], time: hours[0], today: step === 0, tomorrow: step === 1 } };
  }
  return { open: false, opensAt: null };
}
/** the table for the page: neighbouring days with the same hours are joined ("Monday to Saturday") */
export function hoursRows(support = SUPPORT) {
  const rows = [];
  for (let d = 0; d < 7; d++) {
    const key = support.week[d] ? `${support.week[d][0]}-${support.week[d][1]}` : 'closed', last = rows.at(-1);
    if (last && last.key === key) last.to = d; else rows.push({ key, from: d, to: d, hours: support.week[d] });
  }
  return rows.map((r) => ({ days: r.from === r.to ? DAYS[r.from] : `${DAYS[r.from]} to ${DAYS[r.to]}`, time: r.hours ? `${clock(r.hours[0])} to ${clock(r.hours[1])}` : 'Closed' }));
}
/** one plain sentence about the office right now */
export function statusText(status) {
  if (status.open) return `We are online now. Office hours end at ${clock(status.closesAt)}.`;
  if (!status.opensAt) return 'Our office is closed right now.';
  const when = status.opensAt.today ? 'today' : status.opensAt.tomorrow ? 'tomorrow' : `on ${status.opensAt.dayName}`;
  return `Our office is closed right now. We open ${when} at ${clock(status.opensAt.time)}.`;
}
