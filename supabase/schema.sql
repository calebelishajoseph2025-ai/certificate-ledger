-- ============================================================================
-- Certificate Ledger — paste once in Supabase SQL Editor
-- (Dashboard → SQL → New query → Run)
--
-- Same objects as supabase/migrations/0001_init.sql + 0002_standout.sql,
-- plus pgcrypto and the three default courses the Node engine seeds.
-- Safe to re-run: IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / ON CONFLICT.
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists schema_migrations (
  filename text primary key,
  checksum text not null,
  applied_at timestamptz not null default now()
);

-- Table: people
create table if not exists people (
  id bigint generated always as identity primary key,
  email_norm text not null unique,
  full_name text not null,
  merged_into bigint references people(id),
  created_by_import_id bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (merged_into is null or merged_into <> id)
);

-- Table: courses
create table if not exists courses (
  id bigint generated always as identity primary key,
  code text not null unique,
  title text not null,
  hours numeric(5,1),
  theme text not null default 'classic' check (theme in ('classic','modern','midnight','forest','slate')),
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

-- Table: imports
create table if not exists imports (
  id bigint generated always as identity primary key,
  filename text,
  sha256 text not null,
  mapping jsonb,
  is_demo boolean not null default false,
  row_count int,
  inserted int,
  updated int,
  corrected int not null default 0,
  duplicates int,
  needs_correction int,
  unchanged int,
  undone_at timestamptz,
  undone_note text,
  created_at timestamptz not null default now()
);

create unique index if not exists imports_sha256_active_uq on imports(sha256) where undone_at is null;

-- Table: enrollments
create table if not exists enrollments (
  id bigint generated always as identity primary key,
  person_id bigint references people(id),
  course_id bigint references courses(id),
  raw_name text,
  raw_email text,
  raw_course_code text,
  raw_completion_date text,
  raw_status text,
  full_name text,
  email_norm text,
  course_code text,
  completion_date date,
  completed boolean not null default false,
  record_state text not null check (record_state in ('ready','needs_correction')),
  problems jsonb not null default '[]'::jsonb,
  source_import_id bigint references imports(id) on delete set null,
  source_row integer,
  raw_fingerprint text,
  last_import_id bigint references imports(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (email_norm, course_code)
);

create unique index if not exists enrollments_raw_fp_uq on enrollments(raw_fingerprint) where raw_fingerprint is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fk_people_import'
  ) then
    alter table people
      add constraint fk_people_import
      foreign key (created_by_import_id) references imports(id) on delete set null;
  end if;
end $$;

-- Table: certificates
create table if not exists certificates (
  id bigint generated always as identity primary key,
  cert_id text not null unique,
  person_id bigint not null references people(id),
  course_id bigint not null references courses(id),
  enrollment_id bigint not null references enrollments(id),
  status text not null check (status in ('valid','revoked')),
  issued_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoke_reason text,
  unique (person_id, course_id),
  check ((status = 'valid' and revoked_at is null) or (status = 'revoked' and revoked_at is not null))
);

-- Table: import_rows
create table if not exists import_rows (
  id bigint generated always as identity primary key,
  import_id bigint not null references imports(id) on delete cascade,
  row_number int not null,
  raw jsonb not null,
  outcome text not null check (outcome in ('new','updated','unchanged','duplicate','needs_correction','corrected')),
  problems jsonb not null default '[]'::jsonb,
  before jsonb,
  enrollment_id bigint references enrollments(id) on delete set null
);

-- Table: audit_log
create table if not exists audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  action text not null,
  entity text not null,
  entity_id text,
  detail jsonb not null default '{}'::jsonb
);

create index if not exists enrollments_state_completed_idx on enrollments(record_state, completed);
create index if not exists enrollments_course_id_idx on enrollments(course_id);
create index if not exists enrollments_person_id_idx on enrollments(person_id);
create index if not exists enrollments_last_import_idx on enrollments(last_import_id);
create index if not exists certificates_status_idx on certificates(status);
create index if not exists import_rows_import_id_idx on import_rows(import_id);
create index if not exists audit_log_at_idx on audit_log(at desc);
create index if not exists people_merged_into_idx on people(merged_into);

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists people_updated_at on people;
create trigger people_updated_at before update on people
  for each row execute function set_updated_at();

drop trigger if exists enrollments_updated_at on enrollments;
create trigger enrollments_updated_at before update on enrollments
  for each row execute function set_updated_at();

create or replace function audit_log_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only: modifications and deletions are forbidden';
end $$;

drop trigger if exists audit_log_no_update_delete on audit_log;
create trigger audit_log_no_update_delete before update or delete on audit_log
  for each row execute function audit_log_append_only();

alter table people enable row level security;
alter table courses enable row level security;
alter table enrollments enable row level security;
alter table certificates enable row level security;
alter table imports enable row level security;
alter table import_rows enable row level security;
alter table audit_log enable row level security;

-- ===== F1: audit hash chain =====
alter table audit_log add column if not exists seq bigint;
alter table audit_log add column if not exists prev_hash text;
alter table audit_log add column if not exists row_hash text;

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

do $$
declare
  r record;
  v_seq bigint := 0;
  v_last_hash text := repeat('0', 64);
  v_hash text;
begin
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

  create trigger audit_log_no_update_delete before update or delete on audit_log
    for each row execute function audit_log_append_only();
end $$;

alter table audit_log alter column seq set not null;
alter table audit_log alter column prev_hash set not null;
alter table audit_log alter column row_hash set not null;

create unique index if not exists audit_log_seq_uq on audit_log(seq);

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

create or replace function audit_log_no_truncate() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log cannot be truncated: table is strictly append-only';
end $$;

drop trigger if exists audit_log_truncate_guard on audit_log;
create trigger audit_log_truncate_guard before truncate on audit_log
  execute function audit_log_no_truncate();

create table if not exists audit_checkpoints (
  id bigint generated always as identity primary key,
  up_to_seq bigint not null unique,
  head_hash text not null,
  mac text not null,
  created_at timestamptz not null default now()
);

drop trigger if exists audit_checkpoints_no_update_delete on audit_checkpoints;
create trigger audit_checkpoints_no_update_delete before update or delete on audit_checkpoints
  for each row execute function audit_log_append_only();

drop trigger if exists audit_checkpoints_truncate_guard on audit_checkpoints;
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

alter table audit_checkpoints enable row level security;
alter table rate_limits enable row level security;
alter table duplicate_candidates enable row level security;
alter table schema_migrations enable row level security;

insert into courses (code, title, hours, theme, is_demo)
values
  ('DS-101', 'Intro to Data Storytelling', 18.0, 'classic', false),
  ('UX-201', 'Accessible Interface Design', 24.0, 'modern', false),
  ('CL-150', 'Cloud Basics for Teams', 12.0, 'midnight', false)
on conflict (code) do nothing;

insert into schema_migrations (filename, checksum)
values
  ('0001_init.sql', 'schema.sql'),
  ('0002_standout.sql', 'schema.sql'),
  ('schema.sql', 'applied')
on conflict (filename) do nothing;
