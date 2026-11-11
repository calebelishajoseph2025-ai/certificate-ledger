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

/**
 * Explicit TLS decision for a DATABASE_URL.
 *
 * TLS is ON by default (fail-secure: a certificate ledger never sends its
 * password in plaintext). Opt out only for non-TLS endpoints (local docker)
 * by appending `sslmode=disable`.
 *
 * The `sslmode` URL parameter is deliberately NOT handed to the pg client:
 * recent pg-connection-string versions map `require`/`prefer` to verify-full
 * and the parsed string config OVERRIDES an explicit `ssl` option, which
 * breaks against endpoints presenting a private CA chain (e.g. the Supabase
 * pooler signs with "Supabase Intermediate 2021 CA"). `rejectUnauthorized:
 * false` matches libpq `sslmode=require` semantics: encrypted, no CA pinning.
 */
export function sslFor(databaseUrl: string): { rejectUnauthorized: false } | undefined {
  if (/[?&]sslmode=disable(?:[&#]|$)/i.test(databaseUrl)) {
    return undefined;
  }
  return { rejectUnauthorized: false };
}

/** DATABASE_URL with TLS-related params removed in a password-safe way (no new URL() corruption). */
export function stripTlsParams(databaseUrl: string): string {
  return databaseUrl
    .replace(/([?&])(sslmode|ssl|sslnegotiation)=[^&#]*/gi, '')
    .replace(/[?&]&+/g, '?')
    .replace(/[?&]$/, '');
}

async function queryWithRetry<T extends Record<string, any> = any>(
  pool: Pool,
  text: string,
  values?: any[]
): Promise<{ rows: T[] }> {
  try {
    return await pool.query<T>(text, values);
  } catch (err: any) {
    const isConnErr =
      err?.message?.includes('Connection terminated') ||
      err?.message?.includes('connection timeout') ||
      err?.code === 'ECONNRESET' ||
      err?.code === 'EPIPE' ||
      err?.code === 'ETIMEDOUT';
    if (isConnErr) {
      return await pool.query<T>(text, values);
    }
    throw err;
  }
}

export function createPostgresStore(databaseUrl: string, unpooledUrl?: string): LedgerStateStore {
  const isSupabaseDirect = databaseUrl.includes('.supabase.co') && !databaseUrl.includes('pooler.supabase.com');
  const poolLimit = Math.max(1, Math.min(20, Number(process.env.PG_POOL_MAX || 5)));
  const pool = new Pool({
    connectionString: stripTlsParams(databaseUrl),
    max: poolLimit,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 8_000,
    allowExitOnIdle: true,
    ssl: sslFor(databaseUrl),
  });
  pool.on('error', (err: any) => {
    console.error('[ledger] persistence: idle client error', err?.message || err);
  });

  function annotateError(err: any): Error {
    if (!err) return err;
    if (isSupabaseDirect && (err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND' || err.message?.includes('timeout'))) {
      err.message = `${err.message} (Supabase direct host db.[ref].supabase.co is IPv6-only on free tier and cannot be reached from Vercel Lambda IPv4. Please switch DATABASE_URL to the Supabase Transaction Pooler URL on port 6543: aws-0-[region].pooler.supabase.com:6543).`;
    } else if (err.code === '28P01' || err.message?.includes('password authentication')) {
      err.message = `${err.message} (Database password incorrect. Please update the password in DATABASE_URL in Vercel settings or reset it in Supabase Project Settings -> Database).`;
    } else if (err.message?.includes('Tenant or user not found')) {
      err.message = `${err.message} (Supabase Pooler requires username in the format postgres.[project-ref], e.g. postgres.abcdef:password@aws-0-...pooler.supabase.com:6543/postgres).`;
    } else if (err.code === '42P01' || err.message?.includes('does not exist') || err.message?.includes('relation "ledger_state"')) {
      err.message = `${err.message} (Table "ledger_state" does not exist in Supabase. Run supabase/persistence.sql in Supabase SQL Editor, or provide DATABASE_URL_UNPOOLED on port 5432).`;
    }
    return err;
  }

  return {
    async currentVersion() {
      try {
        const r = await queryWithRetry<{ version: number }>(pool, `SELECT version FROM ledger_state WHERE id = 1`);
        const row = r.rows[0];
        return row ? Number(row.version) : null;
      } catch (err) {
        throw annotateError(err);
      }
    },
    async load() {
      try {
        const r = await queryWithRetry<{ state: string; version: number }>(
          pool,
          `SELECT state, version FROM ledger_state WHERE id = 1`
        );
        const row = r.rows[0];
        return row ? { state: row.state, version: Number(row.version) } : null;
      } catch (err) {
        throw annotateError(err);
      }
    },
    async save(state, expectedVersion) {
      try {
        const r = await queryWithRetry<{ version: number }>(
          pool,
          `UPDATE ledger_state
              SET state = $1, version = version + 1, updated_at = now()
            WHERE id = 1 AND version = $2
            RETURNING version`,
          [state, expectedVersion]
        );
        const row = r.rows[0];
        return row ? Number(row.version) : null;
      } catch (err) {
        throw annotateError(err);
      }
    },
    async ensure(seedState) {
      // 1. Fast path: check if table already exists and has row 1 without sending DDL over pooler
      try {
        const check = await queryWithRetry<{ state: string; version: number }>(
          pool,
          `SELECT state, version FROM ledger_state WHERE id = 1`
        );
        if (check.rows[0]) {
          return { state: check.rows[0].state, version: Number(check.rows[0].version) };
        }
      } catch (err: any) {
        const needsCreate =
          err?.code === '42P01' ||
          err?.message?.includes('does not exist') ||
          err?.message?.includes('relation "ledger_state"');
        if (needsCreate) {
          const ddlTarget = unpooledUrl || databaseUrl;
          try {
            const ddlPool = new Pool({
              connectionString: stripTlsParams(ddlTarget),
              max: 1,
              connectionTimeoutMillis: 10_000,
              ssl: sslFor(ddlTarget),
            });
            await ddlPool.query(`
              CREATE TABLE IF NOT EXISTS ledger_state (
                id int primary key default 1 check (id = 1),
                state text not null,
                version bigint not null default 0,
                updated_at timestamptz not null default now()
              );
            `);
            await ddlPool.end().catch(() => undefined);
          } catch (createErr) {
            console.warn('[ledger] persistence: ensure table creation notice', createErr);
          }
        } else {
          throw annotateError(err);
        }
      }

      // 2. Insert initial seed row
      try {
        await queryWithRetry(
          pool,
          `INSERT INTO ledger_state (id, state, version) VALUES (1, $1, 1)
           ON CONFLICT (id) DO NOTHING`,
          [seedState]
        );
        const current = await this.load();
        if (!current) throw new Error('ledger_state row missing after ensure');
        return current;
      } catch (err) {
        throw annotateError(err);
      }
    },
  };
}

export function createSupabaseRestStore(supabaseUrl: string, serviceKey: string): LedgerStateStore {
  const base = supabaseUrl.replace(/\/+$/, '');
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  return {
    async currentVersion() {
      const res = await fetch(`${base}/rest/v1/ledger_state?id=eq.1&select=version`, { headers });
      if (!res.ok) return null;
      const rows = (await res.json()) as Array<{ version: number }>;
      return rows[0] ? Number(rows[0].version) : null;
    },
    async load() {
      const res = await fetch(`${base}/rest/v1/ledger_state?id=eq.1&select=state,version`, { headers });
      if (!res.ok) return null;
      const rows = (await res.json()) as Array<{ state: string; version: number }>;
      return rows[0] ? { state: rows[0].state, version: Number(rows[0].version) } : null;
    },
    async save(state, expectedVersion) {
      const res = await fetch(`${base}/rest/v1/ledger_state?id=eq.1&version=eq.${expectedVersion}`, {
        method: 'PATCH',
        headers: {
          ...headers,
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          state,
          version: expectedVersion + 1,
          updated_at: new Date().toISOString(),
        }),
      });
      if (!res.ok) return null;
      const rows = (await res.json()) as Array<{ version: number }>;
      return rows[0] ? Number(rows[0].version) : null;
    },
    async ensure(seedState) {
      const existing = await this.load();
      if (existing) return existing;

      await fetch(`${base}/rest/v1/ledger_state`, {
        method: 'POST',
        headers: {
          ...headers,
          Prefer: 'resolution=ignore-duplicates,return=representation',
        },
        body: JSON.stringify({
          id: 1,
          state: seedState,
          version: 1,
        }),
      });

      const loaded = await this.load();
      if (!loaded) throw new Error('ledger_state missing in Supabase after ensure');
      return loaded;
    },
  };
}

// ---------------------------------------------------------------------------
// Persistence handle + Express middleware
// ---------------------------------------------------------------------------

export interface LedgerPersistenceHandle {
  readonly mode: 'postgres' | 'supabase-rest' | 'memory';
  /** Resolves once boot hydration finished. Rejects (fail-closed) when the DB is unusable. */
  ready: Promise<void>;
  /** Install with app.use(...) BEFORE the API routes. */
  middleware: RequestHandler;
  /** Persist the current engine state now (used by tests and the smoke script). */
  persistNow(): Promise<'ok' | 'conflict' | 'error'>;
  getLastError(): Error | null;
  checkHealth(): Promise<boolean>;
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
  '/api/health/db-check',
  '/api/branding',
  '/api/auth/me',
  '/api/meta/problems',
  '/api/demo/csv',
]);

export function resolveDatabaseUrl(explicit?: string): string {
  return (
    explicit ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.SUPABASE_DB_URL ||
    process.env.SUPABASE_DATABASE_URL ||
    ''
  );
}

export function resolveDatabaseUrlUnpooled(): string {
  return (
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.DIRECT_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    ''
  );
}

export function resolveSupabaseRest(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    '';
  if (url && key) return { url, key };
  return null;
}

export function createLedgerPersistence(
  engine: LedgerEngine,
  opts: {
    databaseUrl?: string;
    databaseUrlUnpooled?: string;
    store?: LedgerStateStore;
    logger?: { log: (...a: unknown[]) => void; error: (...a: unknown[]) => void; warn: (...a: unknown[]) => void };
  } = {}
): LedgerPersistenceHandle {
  const log = opts.logger ?? console;
  const databaseUrl = resolveDatabaseUrl(opts.databaseUrl);
  const databaseUrlUnpooled = opts.databaseUrlUnpooled || resolveDatabaseUrlUnpooled();
  const supabaseRest = resolveSupabaseRest();

  let store: LedgerStateStore | null = opts.store ?? null;
  let mode: 'postgres' | 'supabase-rest' | 'memory' = 'memory';

  if (!store) {
    if (databaseUrl && !databaseUrl.includes('localhost') && !databaseUrl.includes('127.0.0.1')) {
      store = createPostgresStore(databaseUrl, databaseUrlUnpooled);
      mode = 'postgres';
    } else if (databaseUrl) {
      store = createPostgresStore(databaseUrl, databaseUrlUnpooled);
      mode = 'postgres';
    } else if (supabaseRest) {
      store = createSupabaseRestStore(supabaseRest.url, supabaseRest.key);
      mode = 'supabase-rest';
    }
  } else {
    mode = 'postgres';
  }

  if (!store) {
    log.log('[ledger] persistence: memory-only mode (no DATABASE_URL or Supabase keys set) — state resets on restart');
    return {
      mode: 'memory',
      ready: Promise.resolve(),
      middleware: (_req: Request, _res: Response, next: NextFunction) => next(),
      persistNow: async () => 'ok',
      getLastError: () => null,
      checkHealth: async () => true,
    };
  }

  const state = {
    version: 0,
    // Serialize persists on this instance so two concurrent mutations never race locally.
    queue: Promise.resolve() as Promise<void>,
  };

  const reload = async (): Promise<void> => {
    if (!store) return;
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

  let isConnected = false;
  let lastError: Error | null = null;
  let connectingPromise: Promise<void> | null = null;

  const connectAndHydrate = async (): Promise<void> => {
    if (isConnected) return;
    if (connectingPromise) return connectingPromise;

    connectingPromise = (async () => {
      try {
        if (!store) return;
        const current = await store.ensure(JSON.stringify(serializeEngine(engine)));
        hydrateEngine(engine, JSON.parse(current.state) as LedgerSnapshot);
        state.version = current.version;
        isConnected = true;
        lastError = null;
        log.log(`[ledger] persistence: ${mode} mode — hydrated snapshot v${current.version}`);
      } catch (err: any) {
        lastError = err;
        log.warn(`[ledger] persistence: ${mode} connection/hydration issue:`, err?.message || err);

        // If Postgres failed but Supabase REST is configured, try Supabase REST
        if (mode === 'postgres' && supabaseRest) {
          log.log('[ledger] persistence: attempting fallback to Supabase REST store...');
          try {
            const restStore = createSupabaseRestStore(supabaseRest.url, supabaseRest.key);
            const current = await restStore.ensure(JSON.stringify(serializeEngine(engine)));
            hydrateEngine(engine, JSON.parse(current.state) as LedgerSnapshot);
            store = restStore;
            mode = 'supabase-rest';
            state.version = current.version;
            isConnected = true;
            lastError = null;
            log.log(`[ledger] persistence: Supabase REST fallback succeeded — hydrated snapshot v${current.version}`);
            return;
          } catch (restErr: any) {
            log.warn('[ledger] persistence: Supabase REST fallback also failed:', restErr?.message || restErr);
          }
        }

        // Allow retry on subsequent request
        connectingPromise = null;
        throw err;
      }
    })();

    return connectingPromise;
  };

  // Trigger initial connect immediately, but don't crash if it fails during module load
  const ready: Promise<void> = connectAndHydrate().catch((err) => {
    throw err;
  });

  const checkHealth = async (): Promise<boolean> => {
    if (isConnected && store) {
      try {
        const v = await store.currentVersion();
        if (v !== null && v !== undefined) {
          lastError = null;
          return true;
        }
      } catch (err: any) {
        lastError = err;
        isConnected = false;
        log.warn('[ledger] persistence: health check currentVersion failed:', err?.message || err);
      }
    }
    try {
      await connectAndHydrate();
      return isConnected;
    } catch (err: any) {
      lastError = err;
      return false;
    }
  };

  const persistNow = async (): Promise<'ok' | 'conflict' | 'error'> => {
    if (!isConnected) return 'ok';
    // Serialize the state AT CALL TIME, together with the version it was based
    // on. Saves run serialized on the instance queue, but a queued save may
    // execute after an earlier save conflicted and rehydrated the engine —
    // serializing at execution time would then silently persist the rehydrated
    // state and ack the caller's lost write. Locking against the call-time
    // base version makes such a save a 409 conflict instead.
    const pending = JSON.stringify(serializeEngine(engine));
    const baseVersion = state.version;
    const run = async (): Promise<'ok' | 'conflict' | 'error'> => {
      try {
        const next = await store.save(pending, baseVersion);
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
    if (!isConnected) return;
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
      try {
        if (res.statusCode >= 400) {
          // Failed request — nothing was committed; pass the body through.
          write();
          return;
        }
        const outcome = await persistNow();
        if (outcome === 'ok') {
          write();
        } else if (outcome === 'conflict') {
          if (res.headersSent) {
            log.error('[ledger] persistence: conflict after headers sent — cannot inform client');
            return;
          }
          res.status(409).json({
            error: {
              code: 'LEDGER_STATE_CONFLICT',
              message: 'The ledger was updated by another process. Your change was discarded and the live state was reloaded — please retry.',
            },
          });
        } else {
          if (res.headersSent) {
            log.error('[ledger] persistence: persist failed after headers sent — cannot inform client');
            return;
          }
          res.status(503).json({
            error: {
              code: 'LEDGER_PERSIST_FAILED',
              message: 'Ledger state could not be saved durably. The operation was not committed — please retry shortly.',
            },
          });
        }
      } catch (err) {
        log.error('[ledger] persistence: response finalize failed', err);
        if (!res.headersSent) respondUnavailable(res);
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
    if (SYNC_SKIP.has(req.path)) {
      return next();
    }
    connectAndHydrate()
      .then(() => gate(req, res, next))
      .catch((err) => {
        if (!isConnected && (databaseUrl.includes('localhost') || databaseUrl.includes('127.0.0.1'))) {
          return gate(req, res, next);
        }
        log.error('[ledger] persistence: request hydration failed — failing closed', err?.message || err);
        respondUnavailable(res);
      });
  };

  return {
    get mode() {
      return mode;
    },
    ready,
    middleware,
    persistNow,
    getLastError: () => lastError,
    checkHealth,
  };
}
