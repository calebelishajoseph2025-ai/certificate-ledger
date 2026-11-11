import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateCertId,
  validateCertId,
  signCertId,
  verifyCertSignature,
  computeAuditRowHash,
  computeAuditCheckpointMac,
  verifyAuditCheckpointMac
} from './crypto.js';

test('Certificate ID generation format and checksum verification', () => {
  for (let i = 0; i < 50; i++) {
    const id = generateCertId('26');
    assert.match(id, /^CL-26-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{9}$/);
    const { valid, malformed } = validateCertId(id);
    assert.equal(valid, true, `Generated ID ${id} should be valid`);
    assert.equal(malformed, false);
  }
});

test('Certificate ID catches typos and malformed strings', () => {
  const validId = generateCertId('26');
  // Mutate last check char
  const badCheckId = validId.slice(0, -1) + (validId.endsWith('2') ? '3' : '2');
  const resBad = validateCertId(badCheckId);
  assert.equal(resBad.valid, false);
  assert.equal(resBad.malformed, true);

  // Random garbage
  assert.equal(validateCertId('INVALID-ID').malformed, true);
  assert.equal(validateCertId('CL-26-12345678').malformed, true);
});

test('F3: Certificate Link Signing and Verification', () => {
  const masterKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const certId = 'CL-26-7K3M9QX4B';
  const sig = signCertId(certId, masterKey);
  assert.equal(sig.length, 16);

  // Authentic signature
  const checkValid = verifyCertSignature(certId, sig, masterKey);
  assert.equal(checkValid.valid, true);
  assert.equal(checkValid.provided, true);

  // Altered signature
  const alteredSig = sig.slice(0, 15) + (sig.endsWith('a') ? 'b' : 'a');
  const checkAltered = verifyCertSignature(certId, alteredSig, masterKey);
  assert.equal(checkAltered.valid, false);
  assert.equal(checkAltered.provided, true);

  // Key rotation support
  const newMasterKey = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
  const checkRotated = verifyCertSignature(certId, sig, newMasterKey, masterKey);
  assert.equal(checkRotated.valid, true);
});

test('F1: Audit Log Canonical Hash and Checkpoint MAC', () => {
  const rowHash1 = computeAuditRowHash(
    1,
    '2026-03-01T12:00:00.000000',
    'certificate.issue',
    'certificate',
    'CL-26-TEST',
    { person_id: 1, course_id: 2 },
    '0'.repeat(64)
  );
  assert.equal(rowHash1.length, 64);

  const rowHash2 = computeAuditRowHash(
    2,
    '2026-03-01T12:05:00.000000',
    'certificate.revoke',
    'certificate',
    'CL-26-TEST',
    { reason: 'Demo test' },
    rowHash1
  );
  assert.equal(rowHash2.length, 64);
  assert.notEqual(rowHash1, rowHash2);

  const signingKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const mac = computeAuditCheckpointMac(2, rowHash2, signingKey);
  assert.equal(verifyAuditCheckpointMac(2, rowHash2, mac, signingKey), true);
  assert.equal(verifyAuditCheckpointMac(2, rowHash2, mac + '1', signingKey), false);
});
