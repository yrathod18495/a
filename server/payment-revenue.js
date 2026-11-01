import { AccessError } from './security-policy.js';

/** Revenue days follow Indian time (IST, UTC+5:30), the same day boundary the business uses. */
const IST_OFFSET_MS = 330 * 60 * 1000, DAY_MS = 86400000;
export const istDay = (ms) => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
const dayStart = (day) => Date.parse(`${day}T00:00:00Z`) - IST_OFFSET_MS;
const shiftDay = (day, days) => istDay(dayStart(day) + days * DAY_MS);
export const CHART_DAYS = 10;

/** `YYYY-MM-DD` that is a real calendar day, not in the future, and not absurdly old. Returns the clean string, or '' for "clear". */
export function checkPaidUntil(value, now = Date.now()) {
  if (value === null || value === '') return '';
  const text = typeof value === 'string' ? value.trim() : '';
  const real = /^\d{4}-\d{2}-\d{2}$/.test(text) && new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) === text;
  if (!real) throw new AccessError('invalid_date', 'Please choose a valid date.', 400);
  if (text < '2020-01-01') throw new AccessError('invalid_date', 'That date is too far in the past.', 400);
  if (text > istDay(now)) throw new AccessError('future_date', 'You cannot mark revenue as paid for a date that has not happened yet.', 400);
  return text;
}

/**
 * Revenue figures from every captured payment.
 *  lifetime  all captured revenue
 *  unpaid    captured revenue AFTER the paid-until date (everything, when no date is set)
 *  days      the last 10 days; a day is "settled" when it is on or before the paid-until date, "today" for the current day, otherwise "unpaid"
 */
export function buildRevenue(payments, paidUntil = '', now = Date.now()) {
  const today = istDay(now), byDay = new Map();
  let lifetime = 0, unpaid = 0;
  for (const p of payments) {
    if (p.status !== 'captured') continue;
    const amount = Math.max(0, Number(p.amountPaise || 0)), day = istDay(Number(p.capturedAt || p.createdAt || 0));
    lifetime += amount;
    if (!paidUntil || day > paidUntil) unpaid += amount;
    byDay.set(day, (byDay.get(day) || 0) + amount);
  }
  const days = Array.from({ length: CHART_DAYS }, (_, i) => {
    const day = shiftDay(today, i - (CHART_DAYS - 1));
    return { day, paise: byDay.get(day) || 0, state: day === today ? 'today' : paidUntil && day <= paidUntil ? 'settled' : 'unpaid' };
  });
  return { today, paidUntil: paidUntil || '', lifetimePaise: lifetime, unpaidPaise: unpaid, days };
}

/** What the admin sees for each payment record. Only a captured one has been credited. */
export const logStatus = (status) => status === 'captured' ? 'approved' : ['failed', 'cancelled'].includes(status) ? status : 'pending';
