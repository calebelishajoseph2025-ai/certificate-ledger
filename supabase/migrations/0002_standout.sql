-- ============================================================================
-- 0002_standout.sql: Stand-out features (audit hash chain, checkpoints, rate limits, fuzzy duplicates)
-- ============================================================================

-- ===== F1: audit hash chain =====
alter table audit_log add column if not exists seq bigint;
alter table audit_log add column if not exists prev_hash text;
alter table audit_log add column if not exists row_hash text;

-- Canonical row hash function
create or replace function audit_row_hash(
  p_seq bigint,
  p_at timestamptz,
  p_action text,
  p_entity text,
  p_entity_id text,
  p_detail jsonb,
  p_prev text
) returns text language sql stable as $$
  select encode(sha256(convert_to(jsonb_build_array(
           p_seq,
           to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
           p_action,
           p_entity,
           coalesce(p_entity_id, ''),
           p_detail,
           p_prev
         )::text, 'UTF8')), 'hex')
$$;

-- Backfill any pre-existing audit rows in id order:
do $$
declare
  r record;
  v_seq bigint := 0;
  v_last_hash text := repeat('0', 64);
  v_hash text;
begin
  -- Temporarily drop the append-only trigger for migration backfill
  drop trigger if exists audit_log_no_update_delete on audit_log;

  for r in select id, at, action, entity, entity_id, detail from audit_log order by id asc loop
    v_seq := v_seq + 1;
    v_hash := audit_row_hash(v_seq, r.at, r.action, r.entity, r.entity_id, r.detail, v_last_hash);
    update audit_log
      set seq = v_seq,
          prev_hash = v_last_hash,
          row_hash = v_hash
      where id = r.id;
    v_last_hash := v_hash;
  end loop;

  -- Re-add append-only trigger
  create trigger audit_log_no_update_delete before update or delete on audit_log
    for each row execute function audit_log_append_only();
end $$;

alter table audit_log alter column seq set not null;
alter table audit_log alter column prev_hash set not null;
alter table audit_log alter column row_hash set not null;

create unique index if not exists audit_log_seq_uq on audit_log(seq);

-- Chain trigger function using advisory transaction lock to prevent race conditions:
create or replace function audit_log_chain() returns trigger language plpgsql as $$
declare
  last_seq bigint;
  last_hash text;
begin
  perform pg_advisory_xact_lock(hashtext('audit_log_chain'));
  select seq, row_hash into last_seq, last_hash from audit_log order by seq desc limit 1;
  new.seq       := coalesce(last_seq, 0) + 1;
  new.prev_hash := coalesce(last_hash, repeat('0', 64));
  new.row_hash  := audit_row_hash(new.seq, new.at, new.action, new.entity, new.entity_id, new.detail, new.prev_hash);
  return new;
end $$;

drop trigger if exists audit_log_chain_bi on audit_log;
create trigger audit_log_chain_bi before insert on audit_log
  for each row execute function audit_log_chain();

-- Add truncate prevention
create or replace function audit_log_no_truncate() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log cannot be truncated: table is strictly append-only';
end $$;

drop trigger if exists audit_log_truncate_guard on audit_log;
create trigger audit_log_truncate_guard before truncate on audit_log
  execute function audit_log_no_truncate();

-- Table: audit_checkpoints
create table if not exists audit_checkpoints (
  id bigint generated always as identity primary key,
  up_to_seq bigint not null unique,
  head_hash text not null,
  mac text not null,
  created_at timestamptz not null default now()
);

create trigger audit_checkpoints_no_update_delete before update or delete on audit_checkpoints
  for each row execute function audit_log_append_only();

create trigger audit_checkpoints_truncate_guard before truncate on audit_checkpoints
  execute function audit_log_no_truncate();

-- ===== F4: rate limiting =====
create table if not exists rate_limits (
  bucket text not null,
  key text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (bucket, key, window_start)
);
create index if not exists rate_limits_window_idx on rate_limits(window_start);

-- ===== F5: fuzzy duplicates =====
create table if not exists duplicate_candidates (
  id bigint generated always as identity primary key,
  person_a_id bigint not null references people(id) on delete cascade,
  person_b_id bigint not null references people(id) on delete cascade,
  score numeric(4,3) not null,
  reasons jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open','merged','dismissed','superseded')),
  resolved_at timestamptz,
  resolved_note text,
  created_at timestamptz not null default now(),
  check (person_a_id < person_b_id),
  unique (person_a_id, person_b_id)
);
create index if not exists duplicate_candidates_status_idx on duplicate_candidates(status);

-- Enable RLS on all newly added tables:
alter table audit_checkpoints enable row level security;
alter table rate_limits enable row level security;
alter table duplicate_candidates enable row level security;
