-- ============================================================================
-- 0001_init.sql: Core schema for Certificate Ledger
-- ============================================================================

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

-- Partial unique index on active import sha256:
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

-- Add FK on people.created_by_import_id now that imports exists
alter table people add constraint fk_people_import foreign key (created_by_import_id) references imports(id) on delete set null;

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

-- Table: audit_log (base definition)
create table if not exists audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  action text not null,
  entity text not null,
  entity_id text,
  detail jsonb not null default '{}'::jsonb
);

-- Performance & Integrity Indexes
create index if not exists enrollments_state_completed_idx on enrollments(record_state, completed);
create index if not exists enrollments_course_id_idx on enrollments(course_id);
create index if not exists enrollments_person_id_idx on enrollments(person_id);
create index if not exists enrollments_last_import_idx on enrollments(last_import_id);
create index if not exists certificates_status_idx on certificates(status);
create index if not exists import_rows_import_id_idx on import_rows(import_id);
create index if not exists audit_log_at_idx on audit_log(at desc);
create index if not exists people_merged_into_idx on people(merged_into);

-- Trigger function for updated_at
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger people_updated_at before update on people for each row execute function set_updated_at();
create trigger enrollments_updated_at before update on enrollments for each row execute function set_updated_at();

-- Append-only trigger for audit_log: raise exception on UPDATE or DELETE
create or replace function audit_log_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only: modifications and deletions are forbidden';
end $$;

create trigger audit_log_no_update_delete before update or delete on audit_log
  for each row execute function audit_log_append_only();

-- Security: Enable RLS on all tables with no policies
alter table people enable row level security;
alter table courses enable row level security;
alter table enrollments enable row level security;
alter table certificates enable row level security;
alter table imports enable row level security;
alter table import_rows enable row level security;
alter table audit_log enable row level security;
