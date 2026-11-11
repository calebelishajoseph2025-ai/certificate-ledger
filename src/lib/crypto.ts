import crypto from 'node:crypto';

// Crockford Base32 alphabet excluding easily confused characters: 0, 1, I, L, O
export const CROCKFORD_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/**
 * Computes a weighted checksum character for an 8-character Crockford string.
 */
export function computeCheckChar(str8: string): string {
  let sum = 0;
  for (let i = 0; i < str8.length; i++) {
    const idx = CROCKFORD_CHARS.indexOf(str8[i]);
    const val = idx >= 0 ? idx : 0;
    sum += val * (i + 1);
  }
  return CROCKFORD_CHARS[sum % CROCKFORD_CHARS.length];
}

/**
 * Validates whether a certificate ID adheres to format CL-{YY}-{8 chars}{1 check char}
 * and matches the computed checksum.
 */
export function validateCertId(certId: string): { valid: boolean; malformed: boolean } {
  if (!certId || typeof certId !== 'string') {
    return { valid: false, malformed: true };
  }
  const clean = certId.trim().toUpperCase();
  const match = /^CL-(\d{2})-([23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8})([23456789ABCDEFGHJKMNPQRSTUVWXYZ])$/.exec(clean);
  if (!match) {
    return { valid: false, malformed: true };
  }
  const [, , body, check] = match;
  const expectedCheck = computeCheckChar(body);
  if (check !== expectedCheck) {
    return { valid: false, malformed: true };
  }
  return { valid: true, malformed: false };
}

/**
 * Generates a non-sequential, cryptographically random certificate ID with checksum.
 */
export function generateCertId(yearYY: string = '26'): string {
  const bytes = crypto.randomBytes(8);
  let body = '';
  for (let i = 0; i < 8; i++) {
    body += CROCKFORD_CHARS[bytes[i] % CROCKFORD_CHARS.length];
  }
  const check = computeCheckChar(body);
  return `CL-${yearYY}-${body}${check}`;
}

/**
 * Domain-separated key derivation
 */
export function deriveKey(masterKey: string, purpose: string): Buffer {
  return crypto.createHmac('sha256', masterKey).update(Buffer.from(purpose, 'utf-8')).digest();
}

/**
 * Base64URL without padding
 */
export function base64urlNoPad(buf: Buffer): string {
  return buf.toString('base64url').replace(/=+$/, '');
}

/**
 * Signs a certificate ID: 16 characters base64url tag
 */
export function signCertId(certId: string, signingKey: string): string {
  const kCert = deriveKey(signingKey, 'certificate-link-v1');
  const hmac = crypto.createHmac('sha256', kCert).update(`v1|${certId}`).digest();
  return base64urlNoPad(hmac.subarray(0, 12));
}

/**
 * Verifies a certificate link signature using constant-time comparison.
 */
export function verifyCertSignature(
  certId: string,
  signature: string | undefined | null,
  signingKey: string,
  previousSigningKey?: string
): { valid: boolean; provided: boolean } {
  if (!signature || typeof signature !== 'string') {
    return { valid: false, provided: false };
  }
  const sig = signature.trim();
  if (sig.length !== 16 || !/^[A-Za-z0-9_-]+$/.test(sig)) {
    return { valid: false, provided: true };
  }

  const expectedCurrent = signCertId(certId, signingKey);
  const bufSig = Buffer.from(sig, 'utf-8');
  const bufCurrent = Buffer.from(expectedCurrent, 'utf-8');

  if (bufSig.length === bufCurrent.length && crypto.timingSafeEqual(bufSig, bufCurrent)) {
    return { valid: true, provided: true };
  }

  if (previousSigningKey && previousSigningKey.length >= 32) {
    const expectedPrev = signCertId(certId, previousSigningKey);
    const bufPrev = Buffer.from(expectedPrev, 'utf-8');
    if (bufSig.length === bufPrev.length && crypto.timingSafeEqual(bufSig, bufPrev)) {
      return { valid: true, provided: true };
    }
  }

  return { valid: false, provided: true };
}

/**
 * Canonical row hash for the tamper-evident audit log
 */
export function computeAuditRowHash(
  seq: number,
  atIsoUtc: string,
  action: string,
  entity: string,
  entityId: string | null | undefined,
  detail: Record<string, unknown>,
  prevHash: string
): string {
  // Deterministic JSON array string
  const canonicalArray = JSON.stringify([
    seq,
    atIsoUtc,
    action,
    entity,
    entityId ?? '',
    detail,
    prevHash
  ]);
  return crypto.createHash('sha256').update(canonicalArray, 'utf-8').digest('hex');
}

/**
 * Computes audit checkpoint MAC
 */
export function computeAuditCheckpointMac(
  upToSeq: number,
  headHash: string,
  signingKey: string
): string {
  const kAudit = deriveKey(signingKey, 'audit-checkpoint-v1');
  return crypto.createHmac('sha256', kAudit).update(`${upToSeq}:${headHash}`).digest('hex');
}

/**
 * Verifies audit checkpoint MAC
 */
export function verifyAuditCheckpointMac(
  upToSeq: number,
  headHash: string,
  mac: string,
  signingKey: string,
  previousKey?: string
): boolean {
  if (!mac || typeof mac !== 'string') return false;
  const expected = computeAuditCheckpointMac(upToSeq, headHash, signingKey);
  if (mac.length !== expected.length || !/^[0-9a-fA-F]+$/.test(mac)) {
    return false;
  }
  const bufA = Buffer.from(mac, 'hex');
  const bufB = Buffer.from(expected, 'hex');
  if (bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB)) {
    return true;
  }
  if (previousKey && previousKey.length >= 32) {
    const expectedPrev = computeAuditCheckpointMac(upToSeq, headHash, previousKey);
    const bufPrev = Buffer.from(expectedPrev, 'hex');
    if (bufA.length === bufPrev.length && crypto.timingSafeEqual(bufA, bufPrev)) {
      return true;
    }
  }
  return false;
}
