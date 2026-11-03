import test from 'node:test';
import assert from 'node:assert/strict';
import { SUPPORT, supportStatus, statusText, hoursRows, clock, localParts } from '../shared/support-info.js';

// 2026-11-02 is a Monday. India is UTC+5:30, so 10:00 IST = 04:30 UTC.
const ist = (iso) => Date.parse(iso + '+05:30');

test('times are shown the way people read them', () => {
  assert.equal(clock('10:00'), '10:00 AM'); assert.equal(clock('19:00'), '7:00 PM'); assert.equal(clock('12:30'), '12:30 PM'); assert.equal(clock('00:05'), '12:05 AM');
});
test('the day and time are read in Indian time, whatever the visitor\'s own time zone is', () => {
  assert.deepEqual(localParts(ist('2026-11-02T10:30:00')), { day: 1, minute: 630 });
  assert.deepEqual(localParts(Date.parse('2026-11-02T04:30:00Z')), { day: 1, minute: 600 });
  assert.deepEqual(localParts(ist('2026-11-01T23:59:00')), { day: 0, minute: 1439 });          // Sunday night
});
test('open during office hours, closed before and after', () => {
  assert.deepEqual(supportStatus(ist('2026-11-02T10:00:00')), { open: true, closesAt: '19:00' });
  assert.equal(supportStatus(ist('2026-11-02T18:59:00')).open, true);
  assert.equal(supportStatus(ist('2026-11-02T19:00:00')).open, false);                          // closing time itself is closed
  assert.equal(supportStatus(ist('2026-11-02T09:59:00')).open, false);
});
test('when closed it says when the office opens next: later today, tomorrow, or after the weekend', () => {
  assert.deepEqual(supportStatus(ist('2026-11-02T08:00:00')).opensAt, { day: 1, dayName: 'Monday', time: '10:00', today: true, tomorrow: false });
  assert.equal(statusText(supportStatus(ist('2026-11-02T08:00:00'))), 'Our office is closed right now. We open today at 10:00 AM.');
  assert.equal(statusText(supportStatus(ist('2026-11-02T20:00:00'))), 'Our office is closed right now. We open tomorrow at 10:00 AM.');
  assert.equal(statusText(supportStatus(ist('2026-11-07T20:00:00'))), 'Our office is closed right now. We open on Monday at 10:00 AM.');     // Saturday night: Sunday is closed
  assert.equal(statusText(supportStatus(ist('2026-11-01T12:00:00'))), 'Our office is closed right now. We open tomorrow at 10:00 AM.');           // Sunday
  assert.equal(statusText(supportStatus(ist('2026-11-02T12:00:00'))), 'We are online now. Office hours end at 7:00 PM.');
});
test('the hours table joins days with the same hours', () => {
  assert.deepEqual(hoursRows(), [{ days: 'Sunday', time: 'Closed' }, { days: 'Monday to Saturday', time: '10:00 AM to 7:00 PM' }]);
  const split = { ...SUPPORT, week: [null, ['09:00', '18:00'], ['09:00', '18:00'], ['09:00', '18:00'], ['09:00', '18:00'], ['09:00', '18:00'], ['10:00', '14:00']] };
  assert.deepEqual(hoursRows(split), [{ days: 'Sunday', time: 'Closed' }, { days: 'Monday to Friday', time: '9:00 AM to 6:00 PM' }, { days: 'Saturday', time: '10:00 AM to 2:00 PM' }]);
});
test('a office that is always closed does not break the text', () => {
  const closed = { ...SUPPORT, week: [null, null, null, null, null, null, null] };
  assert.deepEqual(supportStatus(Date.now(), closed), { open: false, opensAt: null });
  assert.equal(statusText(supportStatus(Date.now(), closed)), 'Our office is closed right now.');
});
test('the reply time and zone are written in plain English', () => {
  assert.equal(SUPPORT.replyWindow, '1 to 2 hours'); assert.match(SUPPORT.zoneLabel, /IST/);
});
