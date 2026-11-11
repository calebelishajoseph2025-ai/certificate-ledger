-- ============================================================================
-- Certificate Ledger — durable engine state (single-row snapshot store)
-- Paste once in Supabase SQL Editor, AFTER supabase/schema.sql.
-- (Dashboard → SQL → New query → Run)
--
-- The Node API persists its whole ledger state as one JSON snapshot guarded
-- by a monotonically increasing `version` column (optimistic locking), so any
-- number of Vercel function instances share one consistent ledger.
--
-- NOTE: the column is deliberately `text`, NOT `jsonb`. jsonb normalizes
-- object key order, which would break recomputation of the tamper-evident
-- audit hash chain (hashes are computed over JSON.stringify output, whose
-- key order must be preserved byte-exactly across round-trips).
-- Safe to re-run: IF NOT EXISTS everywhere.
-- ============================================================================

create table if not exists ledger_state (
  id int primary key default 1 check (id = 1),
  state text not null,
  version bigint not null default 0,
  updated_at timestamptz not null default now()
);

-- Same hardening posture as the rest of the schema: RLS on, no policies.
-- The anon/public REST API can read nothing; the backend connects with the
-- database password (postgres role), which bypasses RLS.
alter table ledger_state enable row level security;
