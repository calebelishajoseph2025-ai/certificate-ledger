import test from 'node:test';
import assert from 'node:assert/strict';
import { scorePair, scanDuplicates, areNicknames } from './fuzzy.js';

test('Nickname equivalence dictionary', () => {
  assert.equal(areNicknames('Jon', 'John'), true);
  assert.equal(areNicknames('jonathan', 'jon'), true);
  assert.equal(areNicknames('Robert', 'Bob'), true);
  assert.equal(areNicknames('William', 'Bill'), true);
  assert.equal(areNicknames('Alice', 'Bob'), false);
});

test('F5-T1: Near-duplicate pairs receive score >= 0.70', () => {
  // Domain typo pair
  const priya1 = {
    id: 1,
    fullName: 'Priya Raman',
    emailNorm: 'priya.raman@gmail.com',
  };
  const priya2 = {
    id: 2,
    fullName: 'Priya Raman',
    emailNorm: 'priya.raman@gmial.com',
  };
  const resPriya = scorePair(priya1, priya2);
  assert.ok(resPriya.score >= 0.70, `Priya score ${resPriya.score} should be >= 0.70`);
  assert.ok(resPriya.reasons.some((r) => r.includes('typo of gmail.com')));

  // Nickname pair with 1-char email difference
  const jon = {
    id: 3,
    fullName: 'Jon Walker',
    emailNorm: 'jon.walker@example.test',
  };
  const john = {
    id: 4,
    fullName: 'John Walker',
    emailNorm: 'john.walker@example.test',
  };
  const resWalker = scorePair(jon, john);
  assert.ok(resWalker.score >= 0.70, `Walker score ${resWalker.score} should be >= 0.70`);
  assert.ok(resWalker.reasons.some((r) => r.includes('Nickname match')));
});

test('F5-T2: No false positives for same name with completely different emails', () => {
  // Two different people named Sam Taylor
  const sam1 = {
    id: 10,
    fullName: 'Sam Taylor',
    emailNorm: 'sam.taylor.dev@workplace.org',
  };
  const sam2 = {
    id: 11,
    fullName: 'Sam Taylor',
    emailNorm: 'sam.taylor99@personalmail.net',
  };
  const resSam = scorePair(sam1, sam2);
  assert.ok(resSam.score < 0.70, `Sam Taylor score ${resSam.score} must be < 0.70 to avoid false positives`);

  // Same email local part but entirely different names
  const userA = {
    id: 12,
    fullName: 'Lucas Meyer',
    emailNorm: 'admin@company.com',
  };
  const userB = {
    id: 13,
    fullName: 'Sarah Connor',
    emailNorm: 'admin@cyberdyne.org',
  };
  const resAdmin = scorePair(userA, userB);
  assert.equal(resAdmin.score, 0);
});

test('F5-T4: scanDuplicates scans people list and finds exactly expected pairs', () => {
  const people = [
    { id: 1, fullName: 'Elena Rostova', emailNorm: 'elena@test.org' },
    { id: 2, fullName: 'Jon Walker', emailNorm: 'jon.walker@example.test' },
    { id: 3, fullName: 'John Walker', emailNorm: 'john.walker@example.test' },
    { id: 4, fullName: 'Priya Raman', emailNorm: 'priya.raman@gmail.com' },
    { id: 5, fullName: 'Priya Raman', emailNorm: 'priya.raman@gmial.com' },
    { id: 6, fullName: 'Sam Taylor', emailNorm: 'sam.taylor.dev@workplace.org' },
    { id: 7, fullName: 'Sam Taylor', emailNorm: 'sam.taylor99@personalmail.net' },
  ];

  const candidates = scanDuplicates(people);
  assert.equal(candidates.length, 2, 'Should flag exactly the 2 suspected pairs');
  const pairA = candidates.find((c) => (c.personAId === 2 && c.personBId === 3) || (c.personAId === 3 && c.personBId === 2));
  const pairB = candidates.find((c) => (c.personAId === 4 && c.personBId === 5) || (c.personAId === 5 && c.personBId === 4));
  assert.ok(pairA, 'Jon/John Walker pair must be present');
  assert.ok(pairB, 'Priya Raman domain typo pair must be present');
});
