import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDate, cleanName, classifyRecord } from './classifier.js';

test('parseDate handles ISO, European, and text formats', () => {
  assert.equal(parseDate('2026-02-15').date, '2026-02-15');
  assert.equal(parseDate('15/02/2026').date, '2026-02-15');
  assert.equal(parseDate('21-Feb-2026').date, '2026-02-21');
  assert.equal(parseDate('32/13/2026').error, 'INVALID_DATE');
});

test('cleanName collapses whitespace and Title Cases correctly', () => {
  assert.equal(cleanName('   john    doe   '), 'John Doe');
  assert.equal(cleanName('MARCUS VANCE'), 'Marcus Vance');
  assert.equal(cleanName('Elena Rostova'), 'Elena Rostova');
});

test('classifyRecord flags missing email, unknown course, and invalid status', () => {
  const knownCourses = new Set(['DS-101', 'UX-201']);

  // Valid record
  const rec1 = classifyRecord(
    { name: 'Elena Rostova', email: 'elena@example.com', course: 'DS-101', completion_date: '2026-02-15', status: 'completed' },
    knownCourses
  );
  assert.equal(rec1.recordState, 'ready');
  assert.equal(rec1.completed, true);
  assert.equal(rec1.problems.length, 0);

  // Missing email
  const rec2 = classifyRecord(
    { name: 'Diego Alvarez', email: '', course: 'DS-101', completion_date: '2026-02-15', status: 'completed' },
    knownCourses
  );
  assert.equal(rec2.recordState, 'needs_correction');
  assert.ok(rec2.problems.includes('MISSING_EMAIL'));

  // Unknown course
  const rec3 = classifyRecord(
    { name: 'Arthur Dent', email: 'arthur@galaxy.org', course: 'UNKNOWN-42', completion_date: '2026-02-15', status: 'completed' },
    knownCourses
  );
  assert.equal(rec3.recordState, 'needs_correction');
  assert.ok(rec3.problems.includes('UNKNOWN_COURSE'));

  // Dropped status: ready but completed = false
  const rec4 = classifyRecord(
    { name: 'Frank Lee', email: 'frank@test.com', course: 'DS-101', completion_date: '2026-02-15', status: 'dropped' },
    knownCourses
  );
  assert.equal(rec4.recordState, 'ready');
  assert.equal(rec4.completed, false);
});
