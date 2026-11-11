/**
 * Durable ledger persistence for serverless deployment (Vercel + Supabase Postgres).
 *
 * The LedgerEngine holds all business logic and state in memory (protected code,
 * left untouched by design). This module makes that state DURABLE and CONSISTENT
 * across serverless function instances:
 *
 *   1. Cold start: the engine is hydrated from the latest snapshot stored in
 *      Postgres (`ledger_state`, a single JSONB row guarded by a version column).
 *      If the store is empty, the current in-memory state (fresh engine + sample
 *      seed) is written as the first snapshot, so the database becomes the
 *      single source of truth from the very first boot.
 *   2. Mutating requests: after a handler produces a success response, the new
 *      state is persisted with optimistic locking. On a concurrent-writer
 *      conflict the local change is discarded, the server adopts the database
 *      state, and the client receives 409 LEDGER_STATE_CONFLICT — safe to retry,
 *      because every engine operation is idempotent by design.
 *   3. Read requests: a cheap version check keeps this instance in sync with
 *      writes performed by other instances (read-through), so public
 *      verification results are identical no matter which instance answers.
 *
 * Failure policy is FAIL-CLOSED on purpose:
 *   - No DATABASE_URL        → memory-only mode (local development, resets on restart).
 *   - DATABASE_URL unreachable at boot or during sync → 503 LEDGER_STATE_UNAVAILABLE.
 *     A verification endpoint must never answer "not found" for a certificate it
 *     could not actually check.
 *   - Persist fails          → 503 LEDGER_PERSIST_FAILED and the success body is
 *     NOT sent, so the client never sees an ack for state that was not saved.
 *
 * Rate limiting stays per-instance (brute-force limits are approximate across
 * replicas). Session cookies are statelessly signed and work across instances.
 */
import { Pool } from 'pg';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import {
  LedgerEngine,
  type Course,
  type Person,
  type Enrollment,
  type Certificate,
  type ImportRecord,
  type ImportRow,
  type AuditRow,
  type AuditCheckpoint,
  type DuplicateCandidate,
} from './ledgerEngine.js';

/** Bump when the snapshot shape changes; old snapshots refuse to hydrate. */
export const SNAPSHOT_VERSION = 1;

export interface LedgerSnapshot {
  v: number;
  courses: Course[];
  people: Person[];
  enrollments: Enrollment[];
  certificates: Certificate[];
  imports: ImportRecord[];
  importRows: ImportRow[];
  auditLog: AuditRow[];
  auditCheckpoints: AuditCheckpoint[];
  duplicateCandidates: DuplicateCandidate[];
}

/** Pluggable single-row snapshot store (implemented for Postgres; fake in tests). */
export interface LedgerStateStore {
  /** Cheap read: current version number, or null when the store is empty. */
  currentVersion(): Promise<number | null>;
  /** Full read of the persisted snapshot, or null when empty. */
  load(): Promise<{ state: string; version: number } | null>;
  /** Optimistic save. Returns the new version, or null when `expectedVersion` no longer matches. */
  save(state: string, expectedVersion: number): Promise<number | null>;
  /** Creates the row from `seedState` when empty. Returns the current row (never null). */
  ensure(seedState: string): Promise<{ state: string; version: number }>;
}

// ---------------------------------------------------------------------------
// Snapshot serialization
// ---------------------------------------------------------------------------

export function serializeEngine(engine: LedgerEngine): LedgerSnapshot {
  return {
    v: SNAPSHOT_VERSION,
    courses: [...engine.courses.values()],
    people: [...engine.people.values()],
    enrollments: [...engine.enrollments.values()],
    certificates: [...engine.certificates.values()],
    imports: [...engine.imports.values()],
    importRows: [...engine.importRows.values()],
    auditLog: engine.auditLog,
    auditCheckpoints: engine.auditCheckpoints,
    duplicateCandidates: [...engine.duplicateCandidates.values()],
  };
}

function maxMapId<K, V extends { id: number }>(map: Map<K, V>): number {
  let max = 0;
  for (const row of map.values()) if (row.id > max) max = row.id;
  return max;
}

function maxArrayId<T extends { id: number }>(rows: T[]): number {
  let max = 0;
  for (const row of rows) if (row.id > max) max = row.id;
  return max;
}

/**
 * Replaces the engine's state with the snapshot contents.
 * Snapshots are written only by this module, so the cast from JSONB round-trip
 * is trusted. Private auto-increment counters are TS-private (runtime visible)
 * and are rebuilt as max(id)+1 — exact, because the engine never deletes the
 * highest-id row without also clearing the whole table (factory reset).
 */
export function hydrateEngine(engine: LedgerEngine, snapshot: LedgerSnapshot): void {
  if (snapshot.v !== SNAPSHOT_VERSION) {
    throw new Error(`Unsupported ledger snapshot version: ${String(snapshot.v)} (expected ${SNAPSHOT_VERSION})`);
  }

  engine.courses.clear();
  for (const row of snapshot.courses) engine.courses.set(row.id, row);
  engine.people.clear();
  for (const row of snapshot.people) engine.people.set(row.id, row);
  engine.enrollments.clear();
  for (const row of snapshot.enrollments) engine.enrollments.set(row.id, row);
  engine.certificates.clear();
  for (const row of snapshot.certificates) engine.certificates.set(row.id, row);
  engine.imports.clear();
  for (const row of snapshot.imports) engine.imports.set(row.id, row);
  engine.importRows.clear();
  for (const row of snapshot.importRows) engine.importRows.set(row.id, row);
  engine.duplicateCandidates.clear();
  for (const row of snapshot.duplicateCandidates) engine.duplicateCandidates.set(row.id, row);
  engine.auditLog = snapshot.auditLog;
  engine.auditCheckpoints = snapshot.auditCheckpoints;

  // Engine counters are private by TS annotation only — visible at runtime.
  const counters = engine as unknown as Record<string, number>;
  counters.nextCourseId = maxMapId(engine.courses) + 1;
  counters.nextPersonId = maxMapId(engine.people) + 1;
  counters.nextEnrollmentId = maxMapId(engine.enrollments) + 1;
  counters.nextCertId = maxMapId(engine.certificates) + 1;
  counters.nextImportId = maxMapId(engine.imports) + 1;
  counters.nextImportRowId = maxMapId(engine.importRows) + 1;
  counters.nextAuditId = maxArrayId(engine.auditLog) + 1;
  counters.nextAuditCheckpointId = maxArrayId(engine.auditCheckpoints) + 1;
  counters.nextCandidateId = maxMapId(engine.duplicateCandidates) + 1;
}

// ---------------------------------------------------------------------------
// Postgres store
// ---------------------------------------------------------------------------

export function createPostgresStore(databaseUrl: string): LedgerStateStore {
  // TLS is governed by `sslmode` in the connection string itself (Supabase
  // pooler URIs include ?sslmode=require; local docker URLs carry no sslmode).
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 4,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
  });
  pool.on('error', (err) => {
    console.error('[ledger] persistence: idle client error', err);
  });

  return {
    async currentVersion() {
      const r = await pool.query<{ version: number }>(`SELECT version FROM ledger_state WHERE id = 1`);
      const row = r.rows[0];
      return row ? Number(row.version) : null;
    },
    async load() {
      const r = await pool.query<{ state: string; version: number }>(
        `SELECT state, version FROM ledger_state WHERE id = 1`
      );
      const row = r.rows[0];
      return row ? { state: row.state, version: Number(row.version) } : null;
    },
    async save(state, expectedVersion) {
      const r = await pool.query<{ version: number }>(
        `UPDATE ledger_state
            SET state = $1, version = version + 1, updated_at = now()
          WHERE id = 1 AND version = $2
          RETURNING version`,
        [state, expectedVersion]
      );
      const row = r.rows[0];
      return row ? Number(row.version) : null;
    },
    async ensure(seedState) {
      await pool.query(
        `INSERT INTO ledger_state (id, state, version) VALUES (1, $1, 1)
         ON CONFLICT (id) DO NOTHING`,
        [seedState]
      );
      const current = await this.load();
      if (!current) throw new Error('ledger_state row missing after ensure');
      return current;
    },
  };
}

// ---------------------------------------------------------------------------
// Persistence handle + Express middleware
// ---------------------------------------------------------------------------

export interface LedgerPersistenceHandle {
  mode: 'postgres' | 'memory';
  /** Resolves once boot hydration finished. Rejects (fail-closed) when the DB is unusable. */
  ready: Promise<void>;
  /** Install with app.use(...) BEFORE the API routes. */
  middleware: RequestHandler;
  /** Persist the current engine state now (used by tests and the smoke script). */
  persistNow(): Promise<'ok' | 'conflict' | 'error'>;
}

/** Mutating routes that never change engine state (session/cookie or read-only). */
const PERSIST_SKIP = new Set([
  '/api/auth/login',
  '/api/auth/logout',
  '/api/health/probe-duplicate',
  '/api/imports/preview',
]);

/** Read routes that do not read engine state — skip the version check. */
const SYNC_SKIP = new Set([
  '/api/health',
  '/api/branding',
  '/api/auth/me',
  '/api/meta/problems',
  '/api/demo/csv',
]);

export function createLedgerPersistence(
  engine: LedgerEngine,
  opts: { databaseUrl?: string; store?: LedgerStateStore; logger?: { log: (...a: unknown[]) => void; error: (...a: unknown[]) => void; warn: (...a: unknown[]) => void } } = {}
): LedgerPersistenceHandle {
  const log = opts.logger ?? console;
  const databaseUrl = opts.databaseUrl ?? process.env.DATABASE_URL ?? '';
  const store = opts.store ?? (databaseUrl ? createPostgresStore(databaseUrl) : null);

  if (!store) {
    log.log('[ledger] persistence: memory-only mode (DATABASE_URL not set) — state resets on restart');
    return {
      mode: 'memory',
      ready: Promise.resolve(),
      middleware: (_req: Request, _res: Response, next: NextFunction) => next(),
      persistNow: async () => 'ok',
    };
  }

  const state = {
    version: 0,
    // Serialize persists on this instance so two concurrent mutations never race locally.
    queue: Promise.resolve() as Promise<unknown>,
  };

  const reload = async (): Promise<void> => {
    const current = await store.load();
    if (!current) {
      // Row vanished (manual truncate): re-establish from current engine state.
      const created = await store.ensure(JSON.stringify(serializeEngine(engine)));
      hydrateEngine(engine, JSON.parse(created.state) as LedgerSnapshot);
      state.version = created.version;
      return;
    }
    hydrateEngine(engine, JSON.parse(current.state) as LedgerSnapshot);
    state.version = current.version;
  };

  const ready: Promise<void> = (async () => {
    const current = await store.ensure(JSON.stringify(serializeEngine(engine)));
    hydrateEngine(engine, JSON.parse(current.state) as LedgerSnapshot);
    state.version = current.version;
    log.log(`[ledger] persistence: postgres mode — hydrated snapshot v${current.version}`);
  })();

  const persistNow = async (): Promise<'ok' | 'conflict' | 'error'> => {
    const run = async (): Promise<'ok' | 'conflict' | 'error'> => {
      try {
        const next = await store.save(JSON.stringify(serializeEngine(engine)), state.version);
        if (next === null) {
          // Another instance won the race: adopt the DB truth, report conflict.
          await reload();
          log.warn(`[ledger] persistence: write conflict — rehydrated from DB (v${state.version})`);
          return 'conflict';
        }
        state.version = next;
        return 'ok';
      } catch (err) {
        log.error('[ledger] persistence: save failed', err);
        return 'error';
      }
    };
    const result = state.queue.then(run, run);
    state.queue = result.catch(() => undefined);
    return result;
  };

  const syncIfStale = async (): Promise<void> => {
    const current = await store.currentVersion();
    if (current === null || current === state.version) return;
    await reload();
  };

  const respondUnavailable = (res: Response): void => {
    if (res.headersSent) return;
    res.status(503).json({
      error: {
        code: 'LEDGER_STATE_UNAVAILABLE',
        message: 'Ledger database is unreachable. Serving stale or empty state is not allowed for a certificate ledger — try again shortly.',
      },
    });
  };

  const gate: RequestHandler = (req, res, next) => {
    if (!req.path.startsWith('/api/')) return next();

    const method = req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD') {
      if (SYNC_SKIP.has(req.path)) return next();
      syncIfStale().then(() => next()).catch((err) => {
        log.error('[ledger] persistence: read sync failed', err);
        respondUnavailable(res);
      });
      return;
    }

    if (method === 'OPTIONS' || PERSIST_SKIP.has(req.path)) return next();

    // Mutating request: hold the success body until the new state is durable.
    interceptForPersist(req, res, next);
  };

  const interceptForPersist: RequestHandler = (req, res, next) => {
    const origJson = res.json.bind(res) as (body?: unknown) => Response;
    const origSend = res.send.bind(res) as (body?: unknown) => Response;
    const origEnd = res.end.bind(res) as (...args: unknown[]) => Response;
    let settled = false;

    const finishWith = async (write: () => void): Promise<void> => {
      if (settled) return;
      settled = true;
      if (res.statusCode >= 400) {
        // Failed request — nothing was committed; pass the body through.
        write();
        return;
      }
      const outcome = await persistNow();
      if (outcome === 'ok') {
        write();
      } else if (outcome === 'conflict') {
        res.status(409).json({
          error: {
            code: 'LEDGER_STATE_CONFLICT',
            message: 'The ledger was updated by another process. Your change was discarded and the live state was reloaded — please retry.',
          },
        });
      } else {
        res.status(503).json({
          error: {
            code: 'LEDGER_PERSIST_FAILED',
            message: 'Ledger state could not be saved durably. The operation was not committed — please retry shortly.',
          },
        });
      }
    };

    // Every route in server.ts answers via res.json / res.send (which ends via
    // res.end). Wrap all three; the `settled` guard keeps persistence single-shot.
    res.json = ((body?: unknown) => {
      if (settled) return origJson(body);
      void finishWith(() => origJson(body));
      return res;
    }) as typeof res.json;
    res.send = ((body?: unknown) => {
      if (settled) return origSend(body);
      void finishWith(() => origSend(body));
      return res;
    }) as typeof res.send;
    res.end = ((...args: unknown[]) => {
      if (settled) return origEnd(...(args as []));
      void finishWith(() => origEnd(...(args as [])));
      return res;
    }) as typeof res.end;

    next();
  };

  const middleware: RequestHandler = (req, res, next) => {
    ready.then(() => gate(req, res, next)).catch((err) => {
      log.error('[ledger] persistence: boot hydration failed — failing closed', err);
      respondUnavailable(res);
    });
  };

  return { mode: 'postgres', ready, middleware, persistNow };
}
