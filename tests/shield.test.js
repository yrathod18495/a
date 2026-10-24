import test from 'node:test';
import assert from 'node:assert/strict';
import { sizeLooksDocked, inspectShortcut, consoleLooksOpen, createShield, GAP, REPORT_EVERY_MS } from '../src/shield.js';

const key = (init) => ({ key: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...init });
test('shortcuts that open the developer tools or the source are recognised', () => {
  assert.deepEqual(inspectShortcut(key({ key: 'F12' })), { kind: 'shortcut', detail: 'F12' });
  assert.deepEqual(inspectShortcut(key({ key: 'I', ctrlKey: true, shiftKey: true })), { kind: 'shortcut', detail: 'Ctrl+Shift+I' });
  assert.deepEqual(inspectShortcut(key({ key: 'j', metaKey: true, shiftKey: true })), { kind: 'shortcut', detail: 'Cmd+Shift+J' });
  assert.deepEqual(inspectShortcut(key({ key: 'u', ctrlKey: true })), { kind: 'view-source', detail: 'Ctrl+U' });
  assert.deepEqual(inspectShortcut(key({ key: 'u', metaKey: true, altKey: true })), { kind: 'view-source', detail: 'Cmd+Option+U' });
  for (const normal of [{ key: 'u' }, { key: 'c', ctrlKey: true }, { key: 'z', ctrlKey: true }, { key: 'i', ctrlKey: true }, { key: 'F5' }, { key: 'U', ctrlKey: true, shiftKey: true }]) assert.equal(inspectShortcut(key(normal)), null, JSON.stringify(normal));
});
test('docked developer tools are told apart from a normal window', () => {
  assert.equal(sizeLooksDocked({ outerWidth: 1400, innerWidth: 1385, outerHeight: 900, innerHeight: 800 }), false);   // ordinary browser chrome
  assert.equal(sizeLooksDocked({ outerWidth: 1400, innerWidth: 1000, outerHeight: 900, innerHeight: 800 }), true);    // docked at the side
  assert.equal(sizeLooksDocked({ outerWidth: 1400, innerWidth: 1385, outerHeight: 900, innerHeight: 450 }), true);    // docked at the bottom
  assert.ok(GAP.width > 100 && GAP.height > 100);
});
test('the console probe fires only when the console draws the logged element', () => {
  const closed = { log() {}, clear() {} };
  assert.equal(consoleLooksOpen(closed, () => ({})), false);
  const open = { log(probe) { void probe.id; }, clear() {} };
  assert.equal(consoleLooksOpen(open, () => ({})), true);
  assert.equal(consoleLooksOpen({ log() { throw new Error('no console'); } }, () => ({})), false);
});

function fixture(overrides = {}) {
  const listeners = new Map(), reports = [], notices = [];
  let time = 1_000_000, probeOpen = false;
  const win = { outerWidth: 1400, innerWidth: 1390, outerHeight: 900, innerHeight: 800, location: { hash: '#/toons' }, setInterval: () => 7, clearInterval() {}, addEventListener() {}, removeEventListener() {}, ...overrides };
  const doc = { addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: (type) => listeners.delete(type) };
  const shield = createShield({ win, doc, now: () => time, probe: () => probeOpen, report: async (r) => { reports.push(r); }, notice: (m) => notices.push(m) });
  return { shield, listeners, reports, notices, win, tick: (ms) => { time += ms; }, setProbe: (v) => { probeOpen = v; } };
}
test('opening the console is reported once per ten minutes with a single notice', () => {
  const f = fixture(); f.shield.start();
  assert.equal(f.shield.check(), null);
  f.setProbe(true);
  assert.equal(f.shield.check(), 'console');
  assert.deepEqual(f.reports, [{ kind: 'devtools', detail: 'console', path: '#/toons' }]);
  assert.equal(f.notices.length, 1); assert.match(f.notices[0], /record ho gayi/);
  f.shield.check(); assert.equal(f.reports.length, 1);
  f.tick(REPORT_EVERY_MS + 1); f.shield.check(); assert.equal(f.reports.length, 2); assert.equal(f.notices.length, 1);
});
test('a window-size change must persist before it counts, and a side panel that goes away never reports', () => {
  const f = fixture({ outerWidth: 1400, innerWidth: 1000 }); f.shield.start();
  assert.equal(f.shield.check(), null);                       // first sighting only
  f.win.innerWidth = 1390; assert.equal(f.shield.check(), null); assert.equal(f.reports.length, 0);
  f.win.innerWidth = 1000; f.shield.check(); assert.equal(f.shield.check(), 'window-size');
  assert.deepEqual(f.reports.map((r) => r.detail), ['window-size']);
});
test('inspect shortcuts are blocked and reported; the context menu is blocked only on pictures and the stage', () => {
  const f = fixture(); f.shield.start();
  let prevented = 0; const ev = (init, target) => ({ ...key(init), target, preventDefault() { prevented++; }, stopPropagation() {} });
  f.listeners.get('keydown')(ev({ key: 'F12' })); f.listeners.get('keydown')(ev({ key: 'u', ctrlKey: true })); f.listeners.get('keydown')(ev({ key: 'a' }));
  assert.equal(prevented, 2); assert.deepEqual(f.reports.map((r) => r.kind), ['shortcut', 'view-source']);
  const inside = (match) => ({ closest: (selector) => (match && selector.includes('canvas') ? {} : null) });
  f.listeners.get('contextmenu')(ev({}, inside(true))); assert.equal(prevented, 3);
  f.listeners.get('contextmenu')(ev({}, inside(false))); assert.equal(prevented, 3);           // normal text, inputs, links keep their menu
  f.shield.stop(); assert.equal(f.listeners.size, 0); assert.equal(f.shield.check(), null);
});
