import test from 'node:test';
import assert from 'node:assert/strict';
import { LedgerEngine } from './ledgerEngine.js';

const TEST_CONFIG = {
  sessionSecret: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  signingKey: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
  organizerPasscode: 'testpasscode2026',
  issuerName: 'Northwind Learning Collective',
  signatory1Name: 'Dr. Amara Okonkwo',
  signatory1Title: 'Program Director',
  signatory2Name: 'Lucas Brandt',
  signatory2Title: 'Head of Faculty',
  publicBaseUrl: 'http://localhost:3000',
};

test('Core Test 1 & 9: Issue is idempotent; repeat call returns same certificate', () => {
  const engine = new LedgerEngine(TEST_CONFIG);
  const csv = `name,email,course,completion_date,status
Elena Rostova,elena@example.com,DS-101,2026-02-15,completed`;

  const imp = engine.commitImport(csv);
  assert.equal(imp.summary.inserted, 1);

  const en = Array.from(engine.enrollments.values())[0];
  const firstIssue = engine.issueCertificate(en.id);
  assert.equal(firstIssue.created, true);
  assert.ok(firstIssue.certificate.cert_id.startsWith('CL-26-'));

  // Repeat issue
  const secondIssue = engine.issueCertificate(en.id);
  assert.equal(secondIssue.created, false);
  assert.equal(secondIssue.certificate.cert_id, firstIssue.certificate.cert_id);
  assert.equal(engine.certificates.size, 1);
});

test('Core Test 2 & 3: Repeated import is idempotent, duplicate in file isolated', () => {
  const engine = new LedgerEngine(TEST_CONFIG);
  const csv = `name,email,course,completion_date,status
Marcus Vance,marcus@example.com,DS-101,2026-02-15,completed
Marcus Vance, MARCUS@EXAMPLE.COM ,ds-101,2026-02-15,completed`;

  const firstImp = engine.commitImport(csv);
  assert.equal(firstImp.already_imported, false);
  assert.equal(firstImp.summary.inserted, 1);
  assert.equal(firstImp.summary.duplicates, 1);

  // Re-importing exact file returns already_imported: true
  const secondImp = engine.commitImport(csv);
  assert.equal(secondImp.already_imported, true);
  assert.equal(engine.enrollments.size, 1);
});

test('Core Test 4 & 5: Incomplete record cannot be issued; patch makes it eligible', () => {
  const engine = new LedgerEngine(TEST_CONFIG);
  const csv = `name,email,course,completion_date,status
Diego Alvarez,,DS-101,2026-02-15,completed`;

  engine.commitImport(csv);
  const en = Array.from(engine.enrollments.values())[0];
  assert.equal(en.record_state, 'needs_correction');

  assert.throws(() => engine.issueCertificate(en.id), (err: any) => err.code === 'NOT_ELIGIBLE');

  // Correct record
  en.email_norm = 'diego.alvarez@example.test';
  en.problems = [];
  en.record_state = 'ready';

  const res = engine.issueCertificate(en.id);
  assert.equal(res.created, true);
  assert.equal(res.certificate.status, 'valid');
});

test('Core Test 6 & 7: Revocation, public verify lookup, and altered link detection', () => {
  const engine = new LedgerEngine(TEST_CONFIG);
  const csv = `name,email,course,completion_date,status
Aisha Khan,aisha@example.com,DS-101,2026-02-15,completed`;

  engine.commitImport(csv);
  const en = Array.from(engine.enrollments.values())[0];
  const { certificate } = engine.issueCertificate(en.id);

  // Lookup with authentic signature
  const validSig = certificate.verify_url.split('?s=')[1];
  const lookup1 = engine.verifyLookup(certificate.cert_id, validSig);
  assert.equal(lookup1.status, 'valid');
  assert.equal(lookup1.signature, 'valid');
  assert.equal(lookup1.holder_name, 'Aisha Khan');

  // Lookup with altered signature
  const alteredSig = validSig.slice(0, 15) + (validSig.endsWith('x') ? 'y' : 'x');
  const lookupAltered = engine.verifyLookup(certificate.cert_id, alteredSig);
  assert.equal(lookupAltered.status, 'invalid_signature');
  assert.equal(lookupAltered.signature, 'invalid');
  assert.equal(lookupAltered.holder_name, undefined); // No PII leak

  // Revoke
  engine.revokeCertificate(certificate.cert_id, 'Demo revocation reason');
  const lookupRevoked = engine.verifyLookup(certificate.cert_id, validSig);
  assert.equal(lookupRevoked.status, 'revoked');
  assert.ok(lookupRevoked.revoked_at);
});

test('F2: Ledger health checks all pass and invariant holds', () => {
  const engine = new LedgerEngine(TEST_CONFIG);
  const csv = `name,email,course,completion_date,status
Elena Rostova,elena@example.com,DS-101,2026-02-15,completed
Arthur Dent,,UX-201,2026-02-15,completed`;

  engine.commitImport(csv);
  const en = Array.from(engine.enrollments.values()).find((e) => e.email_norm === 'elena@example.com')!;
  engine.issueCertificate(en.id);

  const health = engine.checkLedgerHealth();
  assert.equal(health.ok, true);
  assert.ok(health.checks.every((c) => c.status !== 'fail'));

  const probe = engine.probeDuplicate();
  assert.equal(probe.blocked, true);
  assert.ok(probe.message.includes('unique constraint'));
});

test('F8: Undo import removes records safely and restores state', () => {
  const engine = new LedgerEngine(TEST_CONFIG);
  const csv = `name,email,course,completion_date,status
Liam Scott,liam@example.com,CL-150,2026-02-20,completed`;

  const imp = engine.commitImport(csv);
  assert.equal(engine.enrollments.size, 1);

  const undoRes = engine.undoImport(imp.import.id);
  assert.equal(undoRes.ok, true);
  assert.equal(undoRes.removed_count, 1);
  assert.equal(engine.enrollments.size, 0);
});

test('resetToFactoryState clears ledger and restores default courses', () => {
  const engine = new LedgerEngine(TEST_CONFIG);
  const csv = `name,email,course,completion_date,status
Elena Rostova,elena@example.com,DS-101,2026-02-15,completed`;
  engine.commitImport(csv);
  const en = Array.from(engine.enrollments.values())[0];
  engine.issueCertificate(en.id);
  assert.equal(engine.certificates.size, 1);

  engine.resetToFactoryState();
  assert.equal(engine.enrollments.size, 0);
  assert.equal(engine.certificates.size, 0);
  assert.equal(engine.people.size, 0);
  assert.equal(engine.imports.size, 0);
  assert.equal(engine.auditLog.length, 0);
  assert.equal(engine.courses.size, 3);
  assert.deepEqual(
    Array.from(engine.courses.values()).map((c) => c.code).sort(),
    ['CL-150', 'DS-101', 'UX-201'],
  );
});
