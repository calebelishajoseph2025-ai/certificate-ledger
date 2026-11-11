import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFunnel, verifyCountInvariant } from './funnel.js';

test('F13-T1: Funnel stages are monotonically non-increasing and drop-offs match exactly', () => {
  const funnel = computeFunnel(11, 9, 8, 5, 4, 12, 1);
  assert.equal(funnel.uniqueRecords, 11);
  assert.equal(funnel.ready, 9);
  assert.equal(funnel.eligible, 8);
  assert.equal(funnel.issuedEver, 5);
  assert.equal(funnel.currentlyValid, 4);

  assert.equal(funnel.dropOffs.needsCorrection, 2); // 11 - 9
  assert.equal(funnel.dropOffs.notCompleted, 1);    // 9 - 8
  assert.equal(funnel.dropOffs.pending, 3);         // 8 - 5
  assert.equal(funnel.dropOffs.revoked, 1);         // 5 - 4

  assert.ok(funnel.uniqueRecords >= funnel.ready);
  assert.ok(funnel.ready >= funnel.eligible);
  assert.ok(funnel.eligible >= funnel.issuedEver);
  assert.ok(funnel.issuedEver >= funnel.currentlyValid);
});

test('Count invariant formula verification', () => {
  const inv1 = verifyCountInvariant(10, 0, 9, 1);
  assert.equal(inv1.holds, true);
  assert.equal(inv1.formula, '10 eligible = 0 pending + 9 issued + 1 revoked');

  const inv2 = verifyCountInvariant(10, 1, 9, 1);
  assert.equal(inv2.holds, false);
});
