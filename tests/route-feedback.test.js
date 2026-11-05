import test from 'node:test';
import assert from 'node:assert/strict';

// route-feedback.js touches document/navigator at module scope (it appends a bar to document.body), so a minimal fake DOM is
// set up before importing it — this only exercises stuckAfterMs(), the pure "how patient should we be" decision.
globalThis.document = {
  body: { append() {} },
  createElement: () => ({ classList: { add() {}, remove() {}, toggle() {} }, style: {}, append() {}, addEventListener() {} }),
};
const { stuckAfterMs } = await import('../src/route-feedback.js');
const setConnection = (c) => Object.defineProperty(globalThis.navigator, 'connection', { value: c, configurable: true });

test('with no Network Information API, the "stuck" threshold is the plain 12 s default', () => {
  setConnection(undefined);
  assert.equal(stuckAfterMs(), 12000);
});
test('a confirmed slow connection gets a longer, more patient threshold — a legitimately slow load is not mistaken for a stuck one', () => {
  setConnection({ effectiveType: '4g', downlink: 10 });
  assert.equal(stuckAfterMs(), 12000);
  setConnection({ effectiveType: '3g', downlink: 1.5 });
  assert.equal(stuckAfterMs(), 20000);
  setConnection({ effectiveType: '2g', downlink: 0.1 });
  assert.equal(stuckAfterMs(), 30000);
  setConnection({ effectiveType: 'slow-2g', downlink: 0.05 });
  assert.equal(stuckAfterMs(), 45000);
  setConnection({ effectiveType: '4g', downlink: 0.4 });          // the label says 4g but the real speed is under 1 Mbps
  assert.equal(stuckAfterMs(), 30000);
});
