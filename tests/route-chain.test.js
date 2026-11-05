import test from 'node:test';
import assert from 'node:assert/strict';

// Mirrors the exact chaining pattern in src/shell.js's route(): every navigation is chained onto the one before it ("routing"),
// so a single navigation whose work never settles must never block every navigation that comes after it forever. This is a
// plain-logic reproduction (shell.js itself needs a DOM/Firebase environment this test does not set up) proving the pattern:
// routing.catch(()=>{}).then(() => withTimeout(work(), ms)) ... keeps the queue moving even when one `work()` never resolves.
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(Error('timeout')), ms))]);

test('a navigation that never settles does not block the next one forever (old, broken pattern vs the fix)', async () => {
  const hang = () => new Promise(() => {});   // never resolves or rejects — exactly what a stuck network call looks like
  const quick = () => Promise.resolve('ok');

  // the OLD pattern (what shell.js did before this fix): each call chains straight onto the raw previous promise, no timeout
  let brokenRouting = Promise.resolve();
  let secondRanOldWay = false;
  brokenRouting = brokenRouting.then(hang);                                   // the first navigation hangs forever
  const secondOld = brokenRouting.then(quick).then(() => { secondRanOldWay = true; });
  const oldSettledInTime = await Promise.race([secondOld.then(() => true), new Promise((r) => setTimeout(() => r(false), 300))]);
  assert.equal(oldSettledInTime, false);        // confirms the bug: the second navigation never gets a chance to run
  assert.equal(secondRanOldWay, false);

  // the FIXED pattern: routing.catch(()=>{}).then(() => withTimeout(work(), ms))
  let fixedRouting = Promise.resolve();
  const first = fixedRouting.catch(() => {}).then(() => withTimeout(hang(), 50)).catch(() => {});
  fixedRouting = first;
  let secondRanFixedWay = false;
  const second = fixedRouting.catch(() => {}).then(() => withTimeout(quick(), 50)).then(() => { secondRanFixedWay = true; });
  fixedRouting = second;
  const fixedSettledInTime = await Promise.race([second.then(() => true), new Promise((r) => setTimeout(() => r(false), 500))]);
  assert.equal(fixedSettledInTime, true);       // the second navigation runs and completes, even though the first hung forever
  assert.equal(secondRanFixedWay, true);
});
