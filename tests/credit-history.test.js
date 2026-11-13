import test from 'node:test';
import assert from 'node:assert/strict';
import { historyRows, totalAdded, ledgerRows, allRows } from '../shared/credit-history.js';

test('payments become rows, newest first; only a captured payment counts as Coins received', () => {
  const rows = historyRows([
    { orderId: 'o1', planName: 'Starter', credits: 500, amountPaise: 9900, status: 'captured', createdAt: 1000, capturedAt: 2000 },
    { orderId: 'o2', planName: 'Pro', credits: 3000, amountPaise: 49900, status: 'failed', createdAt: 5000 },
    { orderId: 'o3', planName: 'Studio', credits: 10000, amountPaise: 149900, status: 'created', createdAt: 4000 },
    { orderId: 'o4', planName: 'Starter', credits: 500, amountPaise: 9900, status: 'captured', createdAt: 3000 },
  ]);
  assert.deepEqual(rows.map((r) => r.id), ['o2', 'o3', 'o4', 'o1']);
  assert.deepEqual(rows.map((r) => r.state), ['failed', 'waiting', 'added', 'added']);
  assert.deepEqual(rows.map((r) => r.label), ['Failed', 'Awaiting payment', 'Added', 'Added']);
  assert.equal(rows[3].when, 2000);                                          // the capture time is used when there is one
  assert.equal(rows[0].rupees, '₹499');
  assert.equal(totalAdded(rows), 1000);                                      // the failed and unpaid ones add nothing
});
test('missing or odd data does not break the list', () => {
  assert.deepEqual(historyRows(undefined), []);
  assert.deepEqual(historyRows(null), []);
  const [row] = historyRows([null, 'x', { status: 'something-new' }]);
  assert.deepEqual([row.title, row.coins, row.label, row.state, row.rupees], ['Coins purchase', 0, 'Unknown', 'failed', '₹0']);
});

test('the welcome gift and support changes show in the Coin history, newest first', () => {
  const rows = allRows([{ orderId: 'order_1', planName: 'Starter', status: 'captured', credits: 100, amountPaise: 9900, capturedAt: 2000 }], [
    { delta: 20, kind: 'signup_bonus', at: 1000, balance: 20 }, { delta: 1000, kind: 'admin_add', reason: 'Support gift', at: 3000, balance: 1120 }, { delta: -5, kind: 'admin_remove', reason: 'Correction', at: 4000, balance: 1115 }, { delta: 0, at: 5 }]);
  assert.deepEqual(rows.map((r) => [r.title, r.state, r.coins]), [['Correction', 'removed', 5], ['Support gift', 'added', 1000], ['Starter', 'added', 100], ['Welcome gift', 'added', 20]]);
  assert.deepEqual(ledgerRows(undefined), []);
});
