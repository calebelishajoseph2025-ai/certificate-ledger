/**
 * Live-database smoke check for ledger persistence.
 *
 * Simulates what happens on Vercel: several independent serverless instances
 * booting cold from the same Postgres (Supabase) state and staying consistent.
 *
 * Prereqs:
 *   docker compose -f docker-compose.dev.yml up -d
 *   Get-Content supabase/persistence.sql | docker exec -i cl-pg psql -U postgres -d postgres
 *
 * Run:
 *   npx tsx scripts/db-smoke.ts
 */
import 'dotenv/config';
import { Pool } from 'pg';
import assert from 'node:assert/strict';
import { LedgerEngine } from '../src/lib/ledgerEngine.js';
import { createLedgerPersistence, createPostgresStore } from '../src/lib/ledgerPersistence.js';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set — add it to .env or the environment.');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });
const store = createPostgresStore(DATABASE_URL);

function newEngine() {
  return new LedgerEngine({
    sessionSecret: 's'.repeat(32),
    signingKey: 'k'.repeat(32),
    organizerPasscode: 'smoke-passcode',
    issuerName: 'Smoke Issuer',
    signatory1Name: 'A',
    signatory1Title: 'T',
    signatory2Name: 'B',
    signatory2Title: 'T2',
    publicBaseUrl: 'http://localhost:3000',
  });
}

function smokeCsv(): string {
  const rows = ['name,email,course,completion_date,status'];
  for (let i = 1; i <= 6; i++) {
    rows.push(`"Attendee ${i}","attendee${i}@example.com","DS-101","2026-01-0${i}","completed"`);
  }
  return rows.join('\n');
}

async function main() {
  await pool.query('TRUNCATE ledger_state');
  console.log('— store truncated (fresh start) —');

  // ── Instance A: cold boot on an empty store, then a real work session ──
  const eA = newEngine();
  const pA = createLedgerPersistence(eA, { store, logger: console });
  await pA.ready;
  eA.commitImport(smokeCsv(), 'smoke.csv');
  eA.issueAll();
  const issued = await pA.persistNow();
  assert.equal(issued, 'ok');
  const certA = [...eA.certificates.values()][0];
  assert.ok(certA, 'instance A issued certificates');
  console.log(`✔ instance A: imported 6 attendees, issued ${eA.certificates.size} certs, persisted`);
  console.log(`  sample certificate: ${certA.cert_id}`);

  // ── Instance B: independent cold boot from the SAME database ──
  const eB = newEngine();
  const pB = createLedgerPersistence(eB, { store, logger: console });
  await pB.ready;
  assert.equal(eB.certificates.size, eA.certificates.size, 'instance B hydrated all certificates');
  const url = eB.issueCertificate(certA.enrollment_id).certificate.verify_url; // idempotent re-issue
  const sig = new URL(url).searchParams.get('s') ?? '';
  const lookup = eB.verifyLookup(certA.cert_id, sig);
  assert.equal(lookup.status, 'valid');
  assert.equal(lookup.signature, 'valid');
  assert.equal(eB.verifyAuditChain().ok, true);
  console.log('✔ instance B: cold-booted, hydrated, verified signature cross-instance');
  console.log('✔ instance B: audit hash chain intact after hydration');

  // ── Concurrent-writer conflict: another instance wins a write between B's saves ──
  const store2 = createPostgresStore(DATABASE_URL);
  const snapshot = (await store2.load())!;
  await store2.save(snapshot.state, snapshot.version); // bumps version: simulates a competing write
  eB.addCourse('ZZ-LOCAL', 'Local-only course', 5); // B's local mutation that will lose the race
  assert.equal(await pB.persistNow(), 'conflict');
  assert.equal(eB.getCourseByCode('ZZ-LOCAL'), undefined, 'local divergence discarded after conflict');
  console.log('✔ conflict: stale write rejected, instance B re-hydrated from DB truth');

  // ── Instance C: brand-new boot sees everything, chain verifies ──
  const eC = newEngine();
  const pC = createLedgerPersistence(eC, { store, logger: console });
  await pC.ready;
  const lookupC = eC.verifyLookup(certA.cert_id, sig);
  assert.equal(lookupC.status, 'valid');
  assert.equal(lookupC.signature, 'valid');
  assert.equal(eC.verifyAuditChain().ok, true);
  assert.equal(eC.getStats().issued, eA.certificates.size);
  console.log('✔ instance C: third cold boot — certificate, signature and stats identical');

  await pool.end();
  console.log('\nSMOKE PASS — persistence is consistent across independent cold boots.');
  process.exit(0);
}

main().catch((err) => {
  console.error('SMOKE FAIL', err);
  process.exit(1);
});
