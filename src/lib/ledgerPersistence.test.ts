import test from 'node:test';
import assert from 'node:assert/strict';
import { LedgerEngine } from './ledgerEngine.js';
import {
  serializeEngine,
  hydrateEngine,
  createLedgerPersistence,
  type LedgerStateStore,
  type LedgerSnapshot,
} from './ledgerPersistence.js';

function makeConfiguredEngine(): LedgerEngine {
  return new LedgerEngine({
    sessionSecret: 's'.repeat(32),
    signingKey: 'k'.repeat(32),
    organizerPasscode: 'test-passcode',
    issuerName: 'Test Issuer',
    signatory1Name: 'A',
    signatory1Title: 'T',
    signatory2Name: 'B',
    signatory2Title: 'T2',
    publicBaseUrl: 'http://localhost:3000',
  });
}

function seedLedger(engine: LedgerEngine): { certId: string; verifyUrl: string } {
  const csv = [
    'name,email,course,completion_date,status',
    '"Ada Lovelace","ada@example.com","DS-101","2026-01-10","completed"',
    '"Grace Hopper","grace@example.com","DS-101","2026-01-11","completed"',
  ].join('\n');
  engine.commitImport(csv, 'test.csv');
  const result = engine.issueAll();
  assert.ok(result.created >= 2, 'expected at least 2 issued certificates');
  const certs = [...engine.certificates.values()];
  const target = certs[0];
  assert.ok(target, 'expected at least one certificate');
  const url = engine.issueCertificate(target.enrollment_id).certificate.verify_url;
  return { certId: target.cert_id, verifyUrl: url };
}

function memoryStore(): LedgerStateStore & { bumpVersion(): void } {
  let row: { state: string; version: number } | null = null;
  return {
    async currentVersion() {
      return row ? row.version : null;
    },
    async load() {
      return row ? { ...row } : null;
    },
    async save(state, expectedVersion) {
      if (!row || row.version !== expectedVersion) return null;
      row = { state, version: expectedVersion + 1 };
      return row.version;
    },
    async ensure(seedState) {
      if (!row) row = { state: seedState, version: 1 };
      return { ...row };
    },
    bumpVersion() {
      // Simulate another instance winning a write race.
      if (row) row = { ...row, version: row.version + 5 };
    },
  };
}

test('serialize → hydrate round-trip preserves the full ledger, chain and signatures', () => {
  const e1 = makeConfiguredEngine();
  const { certId } = seedLedger(e1);
  e1.revokeCertificate(certId, 'test revocation');

  const json = JSON.parse(JSON.stringify(serializeEngine(e1))) as LedgerSnapshot;
  const e2 = makeConfiguredEngine();
  hydrateEngine(e2, json);

  // Same tables
  assert.equal(e2.enrollments.size, e1.enrollments.size);
  assert.equal(e2.certificates.size, e1.certificates.size);
  assert.equal(e2.auditLog.length, e1.auditLog.length);

  // Audit chain intact on the hydrated engine
  const chain = e2.verifyAuditChain();
  assert.equal(chain.ok, true, JSON.stringify(chain.problems));
  assert.equal(chain.head_hash, e1.verifyAuditChain().head_hash);

  // Verification with signature works cross-engine
  const sigUrl = e1.issueCertificate(
    [...e1.certificates.values()].find((c) => c.cert_id === certId)!.enrollment_id
  ).certificate.verify_url;
  const sig = new URL(sigUrl).searchParams.get('s') ?? '';
  const lookup = e2.verifyLookup(certId, sig);
  assert.equal(lookup.status, 'revoked');
  assert.equal(lookup.signature, 'valid');
  assert.ok(lookup.revoked_at);

  // Stats agree
  assert.deepEqual(e2.getStats(), e1.getStats());
});

test('hydrate rebuilds auto-increment counters: new writes continue without collisions', () => {
  const e1 = makeConfiguredEngine();
  // Import two eligible attendees but do NOT issue yet — issuance is exercised
  // on the hydrated engine, which proves the rebuilt counters work.
  const csv = [
    'name,email,course,completion_date,status',
    '"Ada Lovelace","ada@example.com","DS-101","2026-01-10","completed"',
    '"Grace Hopper","grace@example.com","DS-101","2026-01-11","completed"',
  ].join('\n');
  e1.commitImport(csv, 'test.csv');

  const e2 = makeConfiguredEngine();
  hydrateEngine(e2, JSON.parse(JSON.stringify(serializeEngine(e1))) as LedgerSnapshot);

  const res = e2.issueAll();
  assert.ok(res.created >= 2, 'expected issuance to work after hydrate');
  const ids = [...e2.certificates.values()].map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate certificate row ids after hydrate');
  assert.equal(e2.verifyAuditChain().ok, true);
});

test('hydrate rejects unsupported snapshot versions', () => {
  const e = makeConfiguredEngine();
  assert.throws(() => hydrateEngine(e, { ...serializeEngine(e), v: 999 }));
});

test('persistence handle: boot, write-through, second handle hydrates the same ledger', async () => {
  const store = memoryStore();
  const e1 = makeConfiguredEngine();
  const p1 = createLedgerPersistence(e1, { store, logger: fakeLogger() });
  await p1.ready;

  const { certId } = seedLedger(e1);
  assert.equal(await p1.persistNow(), 'ok');

  const e2 = makeConfiguredEngine();
  const p2 = createLedgerPersistence(e2, { store, logger: fakeLogger() });
  await p2.ready;
  assert.equal(e2.certificates.size, e1.certificates.size);
  const lookup = e2.verifyLookup(certId);
  assert.equal(lookup.status, 'valid');
});

test('persistence handle: concurrent-writer conflict discards local divergence and adopts DB state', async () => {
  const store = memoryStore();
  const e1 = makeConfiguredEngine();
  const p1 = createLedgerPersistence(e1, { store, logger: fakeLogger() });
  await p1.ready;
  seedLedger(e1);

  // Another "instance" wins a write between our last save and our next one.
  store.bumpVersion();
  e1.addCourse('XX-999', 'Local-only course', 5); // local mutation, never persisted
  assert.equal(await p1.persistNow(), 'conflict');

  // Local divergence was discarded: engine now matches the persisted snapshot.
  assert.equal(e1.getCourseByCode('XX-999'), undefined);
});

test('memory mode: no DATABASE_URL → no-op persistence', async () => {
  const e = makeConfiguredEngine();
  const p = createLedgerPersistence(e, { databaseUrl: '', logger: fakeLogger() });
  assert.equal(p.mode, 'memory');
  await p.ready;
  assert.equal(await p.persistNow(), 'ok');
});

function fakeLogger() {
  return { log: () => undefined, error: () => undefined, warn: () => undefined } as unknown as Console;
}
