import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryFirestore } from './fake-firestore.js';
import { grantSignupBonus, adjustCredits, SIGNUP_BONUS_COINS } from '../server/signup-bonus.js';

const base = { uid: 'user_12345678901234567890', email: 'a@gmail.com', emailVerified: true, deviceId: 'device_111111111111' };

test('a new verified account gets 20 Coins once, stays on the free tier, and the gift is on the ledger', async () => {
  const db = memoryFirestore();
  const first = await grantSignupBonus(db, base);
  assert.deepEqual([first.granted, first.balance], [true, SIGNUP_BONUS_COINS]);
  assert.equal(SIGNUP_BONUS_COINS, 20);
  assert.equal(db.data.get(`workspaces/${base.uid}`).credits, 20);
  assert.equal(db.data.get(`entitlements/${base.uid}`).tier, 'free');          // a gift does not make the account paid
  const again = await grantSignupBonus(db, base);
  assert.deepEqual([again.granted, again.reason], [false, 'already']);
  assert.equal(db.data.get(`workspaces/${base.uid}`).credits, 20);              // never twice
  const lines = [...db.data.entries()].filter(([k]) => k.startsWith(`workspaces/${base.uid}/creditLedger/`));
  assert.equal(lines.length, 1); assert.equal(lines[0][1].delta, 20);
});

test('no gift without a verified email, and none for a second account on the same browser', async () => {
  const db = memoryFirestore();
  assert.equal((await grantSignupBonus(db, { ...base, emailVerified: false })).granted, false);
  assert.equal(db.data.has(`workspaces/${base.uid}`), false);
  assert.equal((await grantSignupBonus(db, base)).granted, true);
  const second = await grantSignupBonus(db, { ...base, uid: 'user_98765432109876543210', email: 'b@gmail.com' });
  assert.deepEqual([second.granted, second.reason], [false, 'device_used']);
  assert.equal(db.data.has('workspaces/user_98765432109876543210'), false);
});

test('admin Coins tools: add / remove / set need a reason, never go below zero, and are audited', async () => {
  const db = memoryFirestore();
  await grantSignupBonus(db, base);
  const args = { uid: base.uid, by: 'admin_1234567890123456' };
  assert.equal((await adjustCredits(db, { ...args, mode: 'add', amount: 30, reason: 'Support gift' })).balance, 50);
  assert.equal((await adjustCredits(db, { ...args, mode: 'remove', amount: 5, reason: 'Correction' })).balance, 45);
  assert.equal((await adjustCredits(db, { ...args, mode: 'set', amount: 7, reason: 'Reset after abuse' })).balance, 7);
  await assert.rejects(adjustCredits(db, { ...args, mode: 'remove', amount: 8, reason: 'Too much' }), (e) => e.code === 'insufficient_coins');
  await assert.rejects(adjustCredits(db, { ...args, mode: 'add', amount: 1, reason: '' }), (e) => e.code === 'reason_required');
  await assert.rejects(adjustCredits(db, { ...args, mode: 'add', amount: -1, reason: 'negative' }), (e) => e.code === 'invalid_amount');
  await assert.rejects(adjustCredits(db, { ...args, mode: 'add', amount: 1.5, reason: 'fraction' }), (e) => e.code === 'invalid_amount');
  await assert.rejects(adjustCredits(db, { ...args, mode: 'steal', amount: 1, reason: 'bad mode' }), (e) => e.code === 'invalid_action');
  assert.equal(db.data.get(`workspaces/${base.uid}`).credits, 7);
  const audit = [...db.data.entries()].filter(([k]) => k.startsWith('securityAudit/')).map(([, v]) => v.action);
  assert.deepEqual(audit, ['credits_add', 'credits_remove', 'credits_set']);
  assert.equal(db.data.get(`entitlements/${base.uid}`).tier, 'free');
});

test('Coins given by an admin to an account with no tier record do not make it paid', async () => {
  const db = memoryFirestore();
  await adjustCredits(db, { uid: 'user_55555555555555555555', mode: 'add', amount: 10, reason: 'Contest prize', by: 'admin_1234567890123456' });
  assert.equal(db.data.get('entitlements/user_55555555555555555555').tier, 'free');
});

test('the same admin click sent twice (same opId) changes the balance once', async () => {
  const db = memoryFirestore();
  await grantSignupBonus(db, base);
  const args = { uid: base.uid, by: 'admin_1234567890123456', mode: 'add', amount: 10, reason: 'Support gift', opId: 'op-1234567890abcdef' };
  const first = await adjustCredits(db, args), second = await adjustCredits(db, args);
  assert.equal(first.balance, 30); assert.equal(second.balance, 30); assert.equal(second.duplicate, true);
  assert.equal(db.data.get(`workspaces/${base.uid}`).credits, 30);
  const lines = [...db.data.keys()].filter((k) => k.startsWith(`workspaces/${base.uid}/creditLedger/`));
  assert.equal(lines.length, 2);          // the gift and one admin line
  await assert.rejects(adjustCredits(db, { ...args, opId: 'x' }), (e) => e.code === 'invalid_action');
});
