# PROMPT: Build "Certificate Ledger" (A-B-01) — a production-quality, tamper-evident certificate issuance & verification system, deployable on Supabase + Vercel

You are a senior full-stack engineer and product designer. Build the complete project described below. Work in the phases listed in section 17, and output **every file in full** (path as a heading, then a code block). Do not use placeholders like "...rest of code". Do not skip tests. If a decision is ambiguous, choose the option stated here; do not ask questions.

**Secrets rule:** never hard-code credentials. All environment-specific values live in a `.env` file that the owner will fill in (see section 3). You create `.env.example` (committed) and make sure `.env` is in `.gitignore`.

**How this document is organized:** sections 1–14 define the core system (the base task). Section 15 defines the **stand-out features** that prove the ledger cannot lie (tamper-evident audit log, ledger health, signed QR codes, rate limiting, fuzzy duplicate review, guided demo, and more), each with requirements, API, UI and **verification checks**. Section 16 is the **verification matrix and release gate** that ties every requirement to an automated test, a manual check, and evidence. Section 17 is the delivery order. Where section 15 changes something defined earlier (schema, importer, API), the earlier section already contains the change and is marked **[v2]**.

**Priorities (what to protect if output budget runs short):** correctness and trust first, visual polish second.
- **Tier 1 (must, build first):** F1 audit hash chain, F2 ledger health, F3 signed QR, F5 fuzzy duplicates + merge, F14 guided demo.
- **Tier 2 (must):** F4 rate limiting, F6 fix-in-Excel round trip, F7 column mapping, F8 undo import, F13 funnel, F16 engineering signals (Playwright, GitHub Actions, duplicates page, smoke script).
- **Tier 3 (should):** F9 LinkedIn + badge, F10 social preview, F11 revocation list + API docs, F12 batch print, F15 per-course themes. Only Tier 3 items may be shipped as "documented but not implemented" if absolutely necessary, and then they must be flagged honestly in the self-review (section 17, step 10). Tiers 1 and 2 are never cut.

---

## 1. Product summary

An organization runs short courses and issues completion certificates. Their spreadsheet is unreliable: people appear twice, nobody knows which certificates were issued or revoked, and recipients cannot check validity.

Build **Certificate Ledger**: a small system that keeps accurate records from **attendee import → correction → eligibility → issuance → printing → public verification → revocation**, with correct counts at every step, and that can **prove its own integrity** (hash-chained audit log, live ledger-health checks, signed QR codes).

All people, courses, and data are **fictional**.

### Required capabilities (all must work end to end)

1. Import (CSV upload) or manually enter attendee records; **detect and flag records that need correction** (incomplete, malformed, duplicate).
2. Issue **exactly one certificate per person per course**, each with a **unique certificate ID**.
3. Generate a **printable certificate** from an issued record (printable web page is sufficient; PDF export optional).
4. **Look up a certificate ID** and show whether it is **VALID or REVOKED** (or NOT FOUND).
5. Show **accurate counts** for **eligible, issued, and revoked** certificates.
6. **Re-importing the same file, double-clicking Issue, or calling the issue API twice must never create a second valid certificate** for the same person and course.
7. Store everything in a **database** (Supabase Postgres here), with **setup instructions** and **automated tests** for important failure cases (sections 12 and 15).
8. **[v2] Prove integrity:** a tamper-evident audit log, a live ledger-health page that proves the count invariant and constraint presence, and cryptographically signed QR/verify links (section 15).

### Out of scope
Email sending, payments, per-user accounts. (A single shared organizer passcode is **in** scope, see 4.9, because the app will be on the public internet.)

---

## 2. Tech stack (fixed, do not substitute)

| Layer | Choice | Notes |
|---|---|---|
| Hosting | **Vercel** | Static frontend + Python serverless function for the API |
| Database | **Supabase (managed Postgres)** | Used as a plain Postgres database; **not** via the Supabase JS client or PostgREST. **Migrations must run on vanilla Postgres 15/16 too** (no Supabase-only roles, schemas or extensions) because CI uses a plain Postgres container. |
| Backend | **Python 3.11+, FastAPI**, deployed as a Vercel Python Function | Entry point `api/index.py` exports `app` |
| DB driver | **psycopg 3** (`psycopg[binary,pool]`) with raw SQL | Real transactions are required for the integrity rules, which the Supabase REST API cannot do |
| Config | **pydantic-settings** reading `.env` locally and Vercel env vars in production | Fail fast with a clear message listing missing variables |
| Validation | **Pydantic v2** | |
| Crypto | Python stdlib `hmac`, `hashlib`, `secrets`, `base64` only | No third-party crypto dependency. Postgres built-in `sha256()` for the audit chain (no `pgcrypto`). |
| Imaging | **Pillow ≥ 10.1** (social-preview PNG only) | Use `ImageFont.load_default(size=N)`; no font files to ship |
| Migrations | Plain SQL files in `supabase/migrations/` + `backend/scripts/migrate.py` runner (tracks applied files in a `schema_migrations` table) | Also pasteable into the Supabase SQL editor. Files: `0001_init.sql`, `0002_standout.sql` |
| Tests | **pytest** + FastAPI `TestClient` + `concurrent.futures` | Runs against a scratch Postgres schema, see section 12 |
| E2E tests | **Playwright** (+ `@axe-core/playwright`) | `e2e/` at repo root, section 15 F16 |
| Frontend unit tests | **Vitest** + Testing Library | Pure utilities and key components |
| CI | **GitHub Actions** with a `postgres:16` service container | Section 15 F16 |
| Frontend | **React 18 + TypeScript + Vite** | Built to `frontend/dist` |
| Styling | **Tailwind CSS 3.4** + **shadcn/ui** (Radix) + CSS variables | |
| Motion | **Framer Motion** | |
| Data viz | **Recharts** | |
| Tables | **TanStack Table v8** + `@tanstack/react-virtual` | |
| Server state | **TanStack Query v5** | |
| Routing | **React Router v6** | |
| Command palette | **cmdk** | |
| Toasts | **sonner** | |
| Icons | **lucide-react** | |
| QR | **qrcode.react** | |
| Fonts | `@fontsource-variable/inter`, `@fontsource/fraunces`, `@fontsource/jetbrains-mono` | Bundled, no CDN |
| Optional stretch | `reportlab` | Only for the optional ZIP-of-PDFs export (F12) |

**Do not** put any Supabase keys or signing keys in the frontend. The browser only talks to `/api/*` on the same Vercel domain. The frontend needs **no** environment variables. **All cryptography (signatures, hashes, checkpoints) happens on the server**; the frontend never computes a signature.

Dev mode: Vite on `:5173` proxying `/api` to `uvicorn` on `:8000`, both reading the same `.env`.

---

## 3. Environment variables and the `.env` file

Create **`.env.example`** with every variable below, each with a comment explaining exactly where to find it. The owner copies it to `.env` and fills it in. `.env` must be git-ignored. Provide the same list in the README as a table, plus the instruction "add each of these under Vercel → Project → Settings → Environment Variables".

```dotenv
# ---------- Database (Supabase → open your project → "Connect") ----------
# Runtime connection used by the deployed API on Vercel and by local dev.
# Use the POOLED / "Transaction pooler" connection string (host contains "pooler", port 6543).
DATABASE_URL=postgresql://postgres.<project-ref>:<db-password>@<region>.pooler.supabase.com:6543/postgres

# Used ONLY by the migration script and (optionally) tests.
# Use the "Session pooler" string (port 5432). Do NOT use the "Direct connection" string
# unless your network supports IPv6; it is IPv6-only on Supabase.
DIRECT_URL=postgresql://postgres.<project-ref>:<db-password>@<region>.pooler.supabase.com:5432/postgres

# Optional: a separate scratch database/project for automated tests. Falls back to DIRECT_URL.
TEST_DATABASE_URL=

# ---------- App security ----------
# Shared passcode organizers type to unlock the organizer UI. Choose something strong.
ORGANIZER_PASSCODE=
# Long random string (>= 32 chars) used to sign the session cookie. Generate with: openssl rand -hex 32
SESSION_SECRET=

# ---------- Integrity & signing (NEW) ----------
# Long random string (>= 32 chars, must differ from SESSION_SECRET). Used to sign QR/verify links
# and audit-log checkpoints. Generate with: openssl rand -hex 32
# WARNING: changing it invalidates QR signatures on already-printed certificates unless you move the
# old value to LEDGER_SIGNING_KEY_PREVIOUS (accepted for verification only).
LEDGER_SIGNING_KEY=
# Optional: the previous key during rotation.
LEDGER_SIGNING_KEY_PREVIOUS=

# ---------- Rate limiting for public endpoints (NEW, all optional; defaults shown) ----------
RATE_LIMIT_VERIFY_PER_MIN=30
RATE_LIMIT_NOTFOUND_PER_10MIN=10
RATE_LIMIT_LOGIN_FAILS_PER_15MIN=5
RATE_LIMIT_SOCIAL_PER_MIN=120

# ---------- Branding / certificate ----------
ISSUER_NAME=Northwind Learning Collective
SIGNATORY_1_NAME=Dr. Amara Okonkwo
SIGNATORY_1_TITLE=Program Director
SIGNATORY_2_NAME=Lucas Brandt
SIGNATORY_2_TITLE=Head of Faculty

# Public site URL, used in the QR code on certificates. No trailing slash.
# Example: https://certificate-ledger.vercel.app  (locally: http://localhost:5173)
PUBLIC_BASE_URL=http://localhost:5173
```

Rules for config code (`backend/app/config.py`):
- Load with `pydantic-settings`; on missing required values (`DATABASE_URL`, `ORGANIZER_PASSCODE`, `SESSION_SECRET`, `LEDGER_SIGNING_KEY`) raise an error that names each missing variable and says "copy .env.example to .env".
- Validate `SESSION_SECRET` and `LEDGER_SIGNING_KEY` are ≥ 32 characters and **not equal to each other**; otherwise raise a clear error naming the variable.
- `PUBLIC_BASE_URL` falls back to `https://$VERCEL_URL` when unset on Vercel.
- Rate-limit variables parse as positive integers with the defaults above.
- Never log secrets or full connection strings.
- Derive sub-keys with domain separation (never use the raw key for two purposes): `K_cert = HMAC(LEDGER_SIGNING_KEY, b"certificate-link-v1")` and `K_audit = HMAC(LEDGER_SIGNING_KEY, b"audit-checkpoint-v1")`. Same for the previous key.
- Supabase note to include in the README: the app does **not** use the anon key, the service-role key, or the Supabase URL, so the owner does not need to copy those.

---

## 4. Domain model & rules (the heart of the task — implement precisely)

### 4.1 Identity and normalization
- A **person** is identified by **normalized email**: trim + lowercase. Names are not identity: two "Priya Raman"s with different emails are different people; the same email with differently spelled names is the same person (first name seen wins; editable in the UI).
- A **course** is identified by `code` (uppercase, trimmed, e.g. `DS-101`).
- **Natural key for an enrollment = (email_norm, course_code).** This is what "same person, same course" means everywhere.
- Normalize names: collapse internal whitespace, trim; Title Case only if the entire name is upper- or lowercase.
- **[v2] Merged people:** a person row that was merged into another (F5) stays as a **tombstone** (`merged_into` set). Any lookup by `email_norm` that lands on a tombstone is transparently resolved to the surviving person. Tombstones are excluded from lists, counts and duplicate scans.

### 4.2 Schema (`supabase/migrations/0001_init.sql`, real constraints, Postgres types)

Lines marked `-- [v2]` are additions required by the stand-out features. Stand-out-only objects live in `0002_standout.sql` (section 15.0).

```sql
people(
  id bigint generated always as identity primary key,
  email_norm text not null unique,
  full_name text not null,
  merged_into bigint references people(id),     -- [v2] tombstone pointer; null = active person
  created_by_import_id bigint,                  -- [v2] FK added after imports exists, ON DELETE SET NULL
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (merged_into is null or merged_into <> id))

courses(
  id bigint generated always as identity primary key,
  code text not null unique, title text not null, hours numeric(5,1),
  theme text not null default 'classic'         -- [v2] F15
        check (theme in ('classic','modern','midnight','forest','slate')),
  is_demo boolean not null default false,       -- [v2] F14
  created_at timestamptz not null default now())

enrollments(
  id bigint generated always as identity primary key,
  person_id bigint references people(id),       -- null until the record is complete enough to link
  course_id bigint references courses(id),
  raw_name text, raw_email text, raw_course_code text, raw_completion_date text, raw_status text,
  full_name text, email_norm text, course_code text,
  completion_date date,
  completed boolean not null default false,
  record_state text not null check (record_state in ('ready','needs_correction')),
  problems jsonb not null default '[]',
  source_import_id bigint, source_row integer,
  raw_fingerprint text,                         -- [v2] sha256 of the normalized RAW row (see 4.7); never changes after creation
  last_import_id bigint,                        -- [v2] import that last created/changed this record; set to NULL by any manual edit or merge
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (email_norm, course_code))             -- NULLs are distinct in Postgres, so incomplete rows never collide
-- [v2] create unique index enrollments_raw_fp_uq on enrollments(raw_fingerprint) where raw_fingerprint is not null;

certificates(
  id bigint generated always as identity primary key,
  cert_id text not null unique,
  person_id bigint not null references people(id),
  course_id bigint not null references courses(id),
  enrollment_id bigint not null references enrollments(id),
  status text not null check (status in ('valid','revoked')),
  issued_at timestamptz not null default now(),
  revoked_at timestamptz, revoke_reason text,
  unique (person_id, course_id),                -- THE guarantee: at most one certificate ever per person+course
  check ((status = 'valid' and revoked_at is null) or (status = 'revoked' and revoked_at is not null)))

imports(
  id bigint generated always as identity primary key,
  filename text,
  sha256 text not null,                         -- [v2] NOT column-unique; see partial unique index below
  mapping jsonb,                                -- [v2] F7: explicit column mapping used, null = auto-detected
  is_demo boolean not null default false,       -- [v2] F14
  row_count int, inserted int, updated int, corrected int not null default 0,   -- [v2] corrected
  duplicates int, needs_correction int, unchanged int,
  undone_at timestamptz, undone_note text,      -- [v2] F8
  created_at timestamptz not null default now())
-- [v2] create unique index imports_sha256_active_uq on imports(sha256) where undone_at is null;

import_rows(                                    -- every raw row of every import, with its outcome
  id bigint generated always as identity primary key,
  import_id bigint not null references imports(id) on delete cascade,
  row_number int not null, raw jsonb not null,
  outcome text not null check (outcome in ('new','updated','unchanged','duplicate','needs_correction','corrected')),  -- [v2] + corrected
  problems jsonb not null default '[]',
  before jsonb,                                 -- [v2] F8: previous values of the enrollment for 'updated'/'corrected' rows
  enrollment_id bigint references enrollments(id) on delete set null)  -- for 'duplicate': the enrollment it duplicated

audit_log(id bigint generated always as identity primary key, at timestamptz not null default now(),
          action text not null, entity text not null, entity_id text, detail jsonb not null default '{}')
-- [v2] hash-chain columns (seq, prev_hash, row_hash) and checkpoints are added in 0002_standout.sql
```

Additional requirements for the migration:
- Indexes on `enrollments(record_state, completed)`, `enrollments(course_id)`, `certificates(status)`, `import_rows(import_id)`, `audit_log(at desc)`, and **[v2]** `enrollments(person_id)`, `enrollments(last_import_id)`, `people(merged_into)`.
- A trigger or application code keeps `updated_at` current.
- **Make `audit_log` append-only** with a trigger that raises on `UPDATE`/`DELETE` (and **[v2]** `TRUNCATE`).
- **Security: enable Row Level Security on every table and create NO policies.** Supabase exposes tables through a public REST API by default; with RLS on and no policies, anyone holding the public anon key can read nothing. The backend connects with the database password, which bypasses RLS. This protects attendee emails. Add a README note explaining this and a test or script check that RLS is enabled on all tables (`pg_tables.rowsecurity`). **[v2]** This applies to every table added in `0002_standout.sql` too; the RLS test iterates over *all* tables in the schema, so a forgotten table fails the build.

**Design decision (state it in the README):** `unique(person_id, course_id)` is unconditional. A revoked certificate is **not** re-issuable under a new ID; it stays revoked so history is unambiguous. (Reissue = clearly labelled future work.)

### 4.3 Record classification (importer and manual entry use the same function)
Problem codes (JSON array; the UI shows human labels, served from one backend mapping `problem_labels.py`, see F6): `MISSING_NAME`, `MISSING_EMAIL`, `INVALID_EMAIL`, `MISSING_COURSE`, `UNKNOWN_COURSE` (code not in courses; UI offers inline "create course"), `MISSING_COMPLETION_DATE` (status says completed but no date), `INVALID_DATE`, `FUTURE_DATE`, `UNRECOGNIZED_STATUS`.

- `record_state = 'needs_correction'` if any problem code exists, else `'ready'`.
- **Duplicates are not enrollment rows.** There is exactly one enrollment per natural key. A later row with an existing key is recorded in `import_rows` with `outcome='duplicate'` and `enrollment_id` pointing at the original. It can never be issued. In the UI, the surviving enrollment shows a "1 duplicate row merged" chip that opens the details.
- **Eligible** = `record_state='ready' AND completed`. Rows with `completed=false` (dropped, no-show, in progress) are `ready` but not eligible.
- Editing a record re-runs classification. A `needs_correction` record that becomes complete flips to `ready`, links/creates the person and course, and becomes eligible automatically.
- If a correction would change the natural key to one that already exists, `PATCH` returns 409 `DUPLICATE_KEY` naming the conflicting record.
- **[v2]** Any manual `PATCH` sets `last_import_id = NULL` (the record is now human-edited).

### 4.4 Certificate IDs
Format `CL-{YY}-{8 chars Crockford base32}{1 check char}` e.g. `CL-26-7K3M9QX4B`. Generate with `secrets`; non-sequential; no `0/O/1/I/L`. The final character is a checksum so typos are reported as "malformed" before any DB query. On a `cert_id` unique violation, retry with a fresh ID inside a savepoint (max 5).

### 4.5 Issuing — idempotent and race-safe on Postgres
`issue(enrollment_id)` in one transaction (READ COMMITTED is fine):
1. `SELECT ... FROM enrollments WHERE id=%s FOR UPDATE` (serializes against concurrent edits and issues of the same enrollment).
2. Reject with 422 `NOT_ELIGIBLE` if not eligible.
3. `INSERT INTO certificates (...) VALUES (...) ON CONFLICT (person_id, course_id) DO NOTHING RETURNING *`. If nothing returned, `SELECT` the existing certificate.
4. Return `{certificate, created: true|false}`. A repeat call returns the **same certificate** with `created:false` and HTTP 200. Never a second row, never a new ID.
5. Write an `audit_log` row only when `created:true` (the DB trigger from F1 chains it automatically).

Bulk "Issue all eligible" runs the same function per row in a single transaction and returns `{created, already_issued, skipped:[{id, reason}]}`; limit batch size to keep within serverless time limits (process in chunks of 200, loop until done, return a summary). **[v2]** It accepts `scope` (`real` default | `demo` | `all`) and an optional `course` filter, so real actions can never issue demo records and the demo story can never issue real ones (F14).

### 4.6 Revoking
`revoke(cert_id, reason)`: non-empty reason required; `UPDATE ... WHERE cert_id=%s AND status='valid'`; if already revoked return it unchanged (idempotent); audit-logged. The public verify page shows status + revoke date, **not** the private reason or email.

### 4.7 Imports are idempotent
- Compute SHA-256 of the file bytes. **[v2]** If the user supplied an explicit column mapping (F7), the idempotency key is `sha256(file_bytes || b"\n--mapping--\n" || canonical_json(mapping))`; otherwise it is the plain file hash. Take `pg_advisory_xact_lock(hashtext(sha256))` first so two simultaneous uploads of the same file serialize. If an **active** (not undone) `imports.sha256` exists, return the earlier summary with `already_imported:true` and change nothing.
- **[v2] Importer hardening (a stale or modified re-import must never resurrect records):** compute for every row a `raw_fingerprint` = sha256 of the normalized raw fields (`name` trimmed/lowercased/whitespace-collapsed, `email` trimmed/lowercased, `course` trimmed/uppercased, `completion_date` trimmed, `status` trimmed/lowercased). Matching order for each row:
  1. **Fingerprint match** → the row is the same source row seen before. If the matched enrollment was already matched or created earlier **in this same run**, outcome `duplicate`; otherwise outcome `unchanged`. (This is what stops an old, uncorrected spreadsheet from re-creating a record whose email was later corrected, or a blank-email row from re-appearing as a new incomplete record.)
  2. Else **resolve the email through tombstones** (4.1), then match the **natural key** (`ON CONFLICT (email_norm, course_code) DO UPDATE` that only **fills blank fields**, never overwrites corrected values, never touches an enrollment that already has a certificate) → `updated` / `unchanged` / `duplicate` (same-run repeat).
  3. Else insert a new enrollment → `new` or `needs_correction`. New rows store `raw_fingerprint`, `source_import_id`, `last_import_id`.
  Rows `new`/`updated`/`corrected` set `last_import_id`; for `updated`/`corrected` the previous values are saved in `import_rows.before`.
- Column aliases (case-insensitive): `name|full_name|attendee`, `email|e-mail|email_address`, `course|course_code|code`, `completion_date|completed_on|date`, `status|completion_status|result`, optional `course_title|title`, `hours`, and **[v2]** optional `record_id|ledger_id` (corrections files, F6). Unrecognized headers can be mapped manually (F7). Strip a UTF-8 BOM; sniff the delimiter (`,` `;` or tab).
- All five core columns (name, email, course, completion_date, status) must be mapped; otherwise commit returns 422 `MISSING_COLUMNS` naming them and preview returns `column_errors`.
- Status `completed|complete|passed|yes|y|true` → completed; `dropped|no-show|absent|incomplete|failed|no|n|false|in progress` → not completed; anything else → `UNRECOGNIZED_STATUS`.
- Dates: `YYYY-MM-DD`, `DD/MM/YYYY`, `DD-MMM-YYYY`; otherwise `INVALID_DATE`.
- **Serverless limits:** reject files over 2 MB or 5,000 rows with a friendly error (Vercel request bodies are capped at 4.5 MB). Use set-based/batched SQL (`executemany` or multi-row inserts), not one round trip per row, so a full import finishes well within the function timeout.
- Dry-run `POST /api/imports/preview` returns per-row classification **without writing**; `POST /api/imports/commit` writes. After a successful commit, run the fuzzy duplicate scan (F5) **in a separate transaction**; a scan failure never rolls back the import.

### 4.8 Counts (single source of truth in `stats.py`; the UI never computes counts)
Overall and per course, optionally filtered by **[v2]** `scope=all|real|demo` (default `all`):
- `eligible_total` = eligible enrollments (includes those already issued or revoked)
- `issued` = certificates with `status='valid'`
- `revoked` = certificates with `status='revoked'`
- `pending` = eligible with no certificate
- `needs_correction`, `not_completed`, `enrollments_with_duplicates`
- **Invariant (assert in tests and on the ledger-health page):** `eligible_total == pending + issued + revoked`.
- **[v2] `funnel`** (F13): `{unique_records, ready, eligible, issued_ever, currently_valid}` plus exact drop-off reasons `{needs_correction, not_completed, pending, revoked}` and annotations `{rows_received, duplicate_rows_merged}`. Definitions: `unique_records` = all enrollments; `ready` = `record_state='ready'`; `eligible` as above; `issued_ever` = all certificates (valid + revoked); `currently_valid` = valid certificates. Drop-offs must sum exactly: `unique_records − ready = needs_correction`, `ready − eligible = not_completed`, `eligible − issued_ever = pending`, `issued_ever − currently_valid = revoked`.

### 4.9 Organizer access (shared passcode)
Because the app is public on Vercel, organizer endpoints must not be open.
- `POST /api/auth/login {passcode}` compares with `ORGANIZER_PASSCODE` using `hmac.compare_digest`, then sets an **HttpOnly, Secure, SameSite=Lax** signed cookie (HMAC with `SESSION_SECRET`, 12-hour expiry). `POST /api/auth/logout`, `GET /api/auth/me`.
- A FastAPI dependency protects **all** `/api/*` routes **except** the **public set**: `/api/verify/*`, `/api/health` (but **not** `/api/health/ledger`), `/api/auth/*`, `/api/revocations`, `/api/og/*`, `/api/share/*`, and the non-`/api` path `/verify/{cert_id}` (bot preview). Unauthenticated calls to anything else return 401 `UNAUTHENTICATED`. The test suite enumerates `app.routes` and asserts that every route not in this explicit allow-list returns 401 without a session (so a newly added route cannot be left open by accident).
- **[v2]** Failed logins are rate-limited (F4: `RATE_LIMIT_LOGIN_FAILS_PER_15MIN`) in addition to the small constant delay on failure.
- The public routes (`/verify`, `/verify/:id`, `/developers`, `/how-it-works/duplicates`) never require login. The print page and everything else do.

---

## 5. API (REST, JSON, prefix `/api`, OpenAPI at `/api/docs`)

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | public | `{ok, db:true}` (does `select 1`); powers a status chip in the UI |
| GET | `/api/health/ledger` | organizer | **[v2]** Ledger health report (F2) |
| POST | `/api/health/probe-duplicate` | organizer | **[v2]** "Try to break it": attempts a duplicate certificate insert inside a rolled-back transaction (F2) |
| POST/POST/GET | `/api/auth/login`, `/logout`, `/me` | public | Passcode session |
| GET | `/api/stats?scope=` | organizer | Counts overall + per course + 30-day issuance series + **[v2]** `funnel` |
| GET | `/api/attendees?state=&course=&cert=&q=&page=` | organizer | Enrollment list with filters, search, pagination, certificate summary |
| GET | `/api/attendees/export-corrections.csv?course=` | organizer | **[v2]** F6 "needs correction" export (plain-language problems) |
| POST | `/api/attendees` | organizer | Manual entry (same classifier) |
| PATCH | `/api/attendees/{id}` | organizer | Correct a record; re-classify |
| DELETE | `/api/attendees/{id}` | organizer | Only if no certificate exists, else 409 |
| POST | `/api/imports/preview` | organizer | Multipart CSV (+ optional `mapping`) → classified rows, detected headers, suggested mapping; no writes |
| POST | `/api/imports/commit` | organizer | Multipart CSV (+ optional `mapping`) → writes; idempotent |
| POST | `/api/imports/{id}/undo` | organizer | **[v2]** F8 undo an import |
| GET | `/api/imports`, `/api/imports/{id}/rows` | organizer | History and per-row outcomes |
| GET/POST | `/api/courses` | organizer | List / create |
| PATCH | `/api/courses/{code}` | organizer | **[v2]** Edit title, hours, theme (F15); audit-logged |
| GET | `/api/meta/problems` | organizer | **[v2]** Problem-code → label/how-to-fix mapping |
| POST | `/api/attendees/{id}/issue` | organizer | Idempotent issue |
| POST | `/api/certificates/issue-all` | organizer | Bulk issue (`course`, `scope` filters) |
| GET | `/api/certificates?course=&status=&page=&limit=` | organizer | **[v2]** Paged certificate payloads for batch print (F12) |
| POST | `/api/certificates/{cert_id}/revoke` | organizer | Body `{reason}` |
| GET | `/api/certificates/{cert_id}` | organizer | Detail incl. audit trail, **[v2]** `verify_url` (signed) and `theme` |
| GET | `/api/certificates/export.zip?course=` | organizer | **[v2, optional stretch]** ZIP of PDFs (F12) |
| GET | `/api/verify/{cert_id}?s=` | **public, rate-limited** | `{status: valid\|revoked\|not_found\|malformed\|invalid_signature, signature: valid\|invalid\|not_provided, holder_name, course_title, issuer_name, issued_at, revoked_at?}` — never email or reason |
| GET | `/api/verify/{cert_id}/badge.svg` | **public, rate-limited** | **[v2]** F9 status badge |
| GET | `/api/og/{cert_id}.png` | **public, rate-limited** | **[v2]** F10 social preview image |
| GET | `/api/share/{cert_id}` and `/verify/{cert_id}` | **public, rate-limited** | **[v2]** F10 HTML with OpenGraph tags (for link unfurlers) |
| GET | `/api/revocations?since=&page=&format=json\|csv` | **public, rate-limited** | **[v2]** F11 `[{cert_id, revoked_at}]` only |
| GET | `/api/audit` | organizer | Paginated audit log (rows include `seq`, `row_hash`, `prev_hash`) |
| POST | `/api/audit/verify` | organizer | **[v2]** F1 walk the hash chain and checkpoints, write a new checkpoint on success |
| GET | `/api/duplicates?status=` | organizer | **[v2]** F5 review queue |
| POST | `/api/duplicates/scan` | organizer | **[v2]** F5 (re)scan |
| GET | `/api/duplicates/{id}` | organizer | **[v2]** Side-by-side data for both people |
| GET | `/api/duplicates/{id}/merge-preview?survivor=` | organizer | **[v2]** Exact consequences of a merge, no writes |
| POST | `/api/duplicates/{id}/merge` | organizer | **[v2]** Body `{survivor_person_id, full_name?}` |
| POST | `/api/duplicates/{id}/dismiss` | organizer | **[v2]** Body `{note?}` |
| GET | `/api/demo/status`, `/api/demo/story`, `/api/demo/csv?variant=` | organizer | **[v2]** F14 |
| POST | `/api/demo/load`, `/api/demo/import`, `/api/demo/reset` | organizer | **[v2]** F14 |

Error shape everywhere: `{error: {code, message, details?}}`. Idempotent re-issue is 200 with `created:false`; use 409 only for true conflicts; **[v2]** rate-limited calls return 429 `RATE_LIMITED` with a `Retry-After` header.

---

## 6. Deployment on Vercel + Supabase (implement and document all of it)

Files to produce:
- **`api/index.py`**: `from backend.app.main import app` (Vercel's Python runtime serves the ASGI `app`).
- **`requirements.txt` at repo root** (Vercel installs from here): fastapi, uvicorn, psycopg[binary,pool], pydantic, pydantic-settings, python-multipart, **Pillow**, plus test deps in `requirements-dev.txt` (pytest, httpx, and so on; `reportlab` only if the ZIP stretch is built, as an optional extra).
- **`vercel.json`** (verify the exact shape against current Vercel docs for Python functions, header-conditional rewrites and SPA fallbacks, and adjust if needed):
  ```json
  {
    "buildCommand": "cd frontend && npm install && npm run build",
    "outputDirectory": "frontend/dist",
    "functions": { "api/index.py": { "maxDuration": 30 } },
    "rewrites": [
      { "source": "/api/(.*)", "destination": "/api/index" },
      { "source": "/verify/:id",
        "has": [{ "type": "header", "key": "user-agent",
                  "value": "(?i)(facebookexternalhit|twitterbot|slackbot|linkedinbot|whatsapp|discordbot|telegrambot|skypeuripreview|embedly|pinterest|redditbot)" }],
        "destination": "/api/index" },
      { "source": "/(.*)", "destination": "/index.html" }
    ]
  }
  ```
  Ensure the original request path (`/api/...` or, for link unfurlers, `/verify/{id}`) reaches FastAPI so the routes match; FastAPI therefore serves **both** `/api/share/{id}` and `/verify/{id}` from the same handler. Confirm on a preview deployment with `curl -A "Slackbot-LinkExpanding 1.0" https://<preview>/verify/<id>` (must return HTML with `og:` tags) and a normal `curl` (must return the SPA `index.html`). Note `maxDuration` limits depend on the Vercel plan; keep every request well below 10 s.
- **DB pooling for serverless:** use a module-level `psycopg_pool.ConnectionPool` with small `max_size` (≈3–5), opened lazily; connect to the **transaction pooler** (`DATABASE_URL`, port 6543) and pass `prepare_threshold=None` (transaction-mode poolers do not support prepared statements). Keep every transaction short and self-contained: no session-level state, no `SET` outside `SET LOCAL`, advisory locks must be the `xact` variety. **Test-only exception:** when `DB_SCHEMA` is set (used by the test harness and the E2E server), `db.py` runs `SET search_path` on each new connection; production never sets it.
- **Migrations are NOT run at runtime.** The owner runs `python -m backend.scripts.migrate` once (it uses `DIRECT_URL`), or pastes `supabase/migrations/0001_init.sql` then `0002_standout.sql` into Supabase's SQL editor. The runner applies each file in a transaction, records it in `schema_migrations`, and refuses to run if an already-applied file's checksum changed.
- **README "Deploy" section** with numbered steps: create Supabase project → copy the two connection strings into `.env` → generate `SESSION_SECRET` and `LEDGER_SIGNING_KEY` → run migrate → (optional) run seed → push to GitHub → import repo in Vercel → add env vars → deploy → open URL, log in with the passcode → set `PUBLIC_BASE_URL` to the final domain and redeploy so QR codes point to the live verify page → **run `make smoke URL=https://<your-domain>`** (F16) and confirm all checks are green.
- Provide `/api/health` as a smoke test and list common failures (IPv6 direct connection, wrong pooler port, missing env var, prepared-statement errors, link previews not showing because the bot rewrite was not deployed, signature "invalid" after changing `LEDGER_SIGNING_KEY`) with fixes.
- `.gitignore` includes `.env`, `node_modules`, `__pycache__`, `.venv`, `frontend/dist`, `.vercel`, `e2e/test-results`, `e2e/playwright-report`.

---

## 7. Repository layout

```
certificate-ledger/
├── .env.example               # all variables from section 3
├── .gitignore
├── .github/workflows/ci.yml   # F16: backend tests, frontend checks, Playwright E2E
├── README.md                  # setup, run, test, deploy, sample run, architecture, design notes, threat model
├── DUPLICATE_PREVENTION.md    # the short required note (≤ 1 page)
├── Makefile                   # make setup | migrate | seed | dev | build | test | test-e2e | test-perf | verify | smoke
├── vercel.json
├── requirements.txt, requirements-dev.txt
├── api/index.py               # Vercel entry
├── supabase/migrations/0001_init.sql, 0002_standout.sql
├── sample_data/attendees.csv
├── e2e/                       # Playwright specs + fixtures (F16)
├── backend/
│   ├── app/ main.py, config.py, db.py (pool + transaction ctx manager), auth.py, models.py,
│   │        normalize.py, importer.py, certificates.py, stats.py, problem_labels.py,
│   │        signing.py (F3), audit.py (F1), health.py (F2), ratelimit.py (F4),
│   │        duplicates.py + fuzzy.py (F5), corrections.py (F6), mapping.py (F7),
│   │        undo.py (F8), social.py (F9/F10), demo.py (F14), assets/demo_story_base.csv,
│   │        routes/*.py
│   ├── scripts/ migrate.py, seed.py (loads the sample CSV through the real importer and prints counts; `--demo` loads the story),
│   │            smoke.py (F16 post-deploy checks), e2e_server.py (scratch schema + uvicorn for Playwright)
│   └── tests/
└── frontend/
    ├── package.json, vite.config.ts, tailwind.config.ts, tsconfig.json
    └── src/ main.tsx, App.tsx, index.css (design tokens), lib/, hooks/, components/ (ui/ + features),
             pages/ Login, Dashboard, Attendees, Import, Courses, CertificateDetail, Print, BatchPrint,
                    Verify, ActivityLog, Duplicates, LedgerHealth, Developers, HowDuplicatesArePrevented
```

---

## 8. Frontend: pages and behavior

SPA with a collapsible sidebar (**[v2]** items: Dashboard, Attendees, Import, Courses, **Duplicates** with an open-count badge, Activity, **Ledger health** with a live green/red dot), top bar with global search, ⌘K hint, theme toggle, and a small **system status chip** (from `/api/health`). Unauthenticated users hitting organizer routes see **Login**; `/verify`, `/verify/:id`, `/developers` and `/how-it-works/duplicates` are public.

1. **Login** — centered glass card over the aurora background, passcode field with show/hide, shake animation on error, a clear message on 429 with the retry time, link "Verify a certificate instead".
2. **Dashboard** — the showpiece (see 9). **[v2]** Includes the funnel chart (F13), an integrity chip ("Ledger verified ✓ 2 min ago" or "Not verified yet"), and the "Load sample story" call-to-action when the ledger is empty (F14).
3. **Attendees** — virtualized TanStack table: Name, Email, Course, Completion date, State badge, Problems (chips), Duplicate-merged chip, Certificate (ID chip or "Issue" button), Actions. Faceted filters (state, course, certificate status), instant search, multi-select with a floating bulk bar ("Issue selected"), sticky header, column visibility. Row click opens a **right-side drawer** with an inline correction form: live re-validation as you type, problems shrinking as you fix them, "Save & mark ready" animation, "now eligible" pulse. "+ Add attendee" uses the same form in a modal. **[v2]** Toolbar button **"Export needs-correction (CSV)"** (F6).
4. **Import** — **[v2]** 4-step wizard with animated stepper: (1) dropzone with type/size validation and "Use sample file"; (2) **Map columns** (shown automatically when a required column is not recognized, and always reachable via "Adjust mapping"; F7); (3) **preview diff table** colored by outcome (new / will update / corrected / unchanged / duplicate / needs correction) with summary tiles and problem chips; (4) confirm → animated success counts. Re-uploading the same file shows "Already imported on <date> — nothing changed". A detected corrections file (has `record_id`) shows "Corrections file: N existing records will be updated". Import history below with drill-down into per-row outcomes and an **Undo import** button (F8) that is disabled with an explanatory tooltip when blocked.
5. **Courses** — cards with progress ring (issued/eligible), counts, theme picker with live preview (F15), "Issue all eligible" with a confirm dialog stating exactly how many will be created, **[v2]** "Print all certificates" (F12).
6. **Certificate detail** — preview, metadata, status timeline, audit trail (with short hash chips), **Revoke** (reason required), Print, Copy verify link (signed URL).
7. **Print page** (`/certificate/:id/print`) and **batch print page** (`/courses/:code/print`) — see 10 and F12.
8. **Verify** (`/verify`, `/verify/:id`) — public, minimal chrome. Large input that uppercases and auto-formats, paste detection, animated seal result: green ✓ **VALID**, red ✕ **REVOKED**, amber ? **NOT FOUND / MALFORMED**, red ⚠ **LINK ALTERED** for an invalid signature. Shows holder name, course, issue date, and revoke date if revoked. **[v2]** Shows a signature line: "✓ Authentic link signed by <issuer>" (signature valid) or "ID found in the ledger. This was a manual lookup; scan the QR on the certificate for cryptographic link verification." (no signature). Valid certificates show **Add to LinkedIn**, **Copy badge embed** (F9). Handles 429 with a friendly countdown. Reachable by URL for the QR code.
9. **Activity log** — filterable timeline of audit events, **[v2]** with a prominent **"Verify ledger integrity"** button (F1): animated chain walk, then a green "Chain intact: N events, head `a3f9…c21b`" (with copy button) or a red result naming the first broken event.
10. **[v2] Duplicates** — review queue with score, reasons and "Review" (F5).
11. **[v2] Ledger health** (`/health`) — live checks (F2).
12. **[v2] Developers** (`/developers`, public) — verify API, revocation list, badge, signature semantics (F11).
13. **[v2] How duplicates are prevented** (`/how-it-works/duplicates`, public) — renders `DUPLICATE_PREVENTION.md` at build time plus a live "Try to break it" panel for organizers (F16).

**Global UX:** ⌘K palette (navigate, jump to certificate ID, "Issue all eligible", "Import file", "Verify ledger integrity", "Load sample story", toggle theme, log out); shortcuts (`g d`, `g a`, `g i`, `/`); optimistic updates with rollback + toast; skeleton loaders; empty states with a clear next action; every destructive action behind a confirm dialog; Issue buttons disabled while pending **and** safe at the backend; graceful handling of 401 (redirect to Login), 429 (countdown) and of cold-start latency (show a skeleton, never a blank page).

---

## 9. UI / visual design direction — "stunning, complex, modern"

Aim for the polish of Linear / Vercel / Stripe dashboards with a premium "credentials" identity. (Polish is a bonus on top of correctness; never trade correctness or accessibility for it.)

**Aesthetic**
- Default **dark theme** plus a full **light theme** (CSS variables, `class` strategy, stored in localStorage, respects `prefers-color-scheme`).
- Deep ink background (`#07080d`) with a slow-drifting **aurora/mesh gradient** (indigo → violet → teal, very low opacity) and faint grain overlay. **Glassmorphic** cards: `backdrop-blur`, 1px hairline borders (~8% white), soft inner glow, layered shadows.
- Accents: **indigo-violet gradient** primary, **emerald** success, **rose** danger, **amber** warning. Gradient borders on hero cards (CSS mask). Cursor-following spotlight on cards.
- Type: **Inter Variable** (tight heading tracking, tabular numerals), **Fraunces** for certificate and large display numerals, **JetBrains Mono** for IDs and hashes.
- 8px grid, 12–16px radii, generous whitespace.

**Dashboard (responsive bento grid)**
- 4 **KPI tiles** — Eligible, Issued, Revoked, Needs correction — with animated count-up, sparkline, gradient icon chip, hover spotlight; click navigates to Attendees pre-filtered.
- **Donut chart** (issued / pending / revoked) with center label and animated segments.
- 30-day **area chart** of issuance with gradient fill and custom tooltip.
- **[v2] Funnel chart** (unique records → ready → eligible → issued → currently valid) with labelled drop-off reasons that sum exactly.
- **Per-course progress** with animated bars.
- **"Needs attention"** panel with one-click "Fix" opening the drawer, plus open duplicate candidates.
- **Live activity feed** with animated entries.
- Embedded **quick verify** input.

**Motion** (Framer Motion): staggered card entrance, shared-layout transition between table row and drawer, number tickers, spring dialogs, animated stepper, route cross-fade, "seal stamp" animation on issue, chain-link walk animation on integrity verification, check-ticks on the health page. Respect `prefers-reduced-motion`.

**Accessibility & quality:** WCAG AA contrast, visible focus rings, full keyboard navigation, `aria-live` for toasts and verify results, semantic table markup, labeled fields with inline errors, responsive down to 360px with no horizontal page scroll, Lighthouse performance ≥ 90 on the built app, **zero `serious`/`critical` axe violations** on Login, Dashboard, Verify, Ledger health (enforced in E2E, F16).

---

## 10. Certificate layout & printing

- Landscape **A4** (297×210mm): `@page { size: A4 landscape; margin: 0 }`, `print:` variants so only the certificate prints, `print-color-adjust: exact`.
- Design: ivory background, double border with CSS/SVG corner ornaments, `ISSUER_NAME` header (served via an API `/api/branding` or embedded in the certificate payload, so the frontend needs no env vars; this endpoint is organizer-only, and the public verify payload may include the issuer name), "Certificate of Completion" in Fraunces, very large recipient name, course title + hours + completion date, two signature lines using the `SIGNATORY_*` values, SVG embossed-style **seal**, **certificate ID in monospace**, and a **QR code** captioned "Scan to verify".
- **[v2] The QR encodes the server-provided signed `verify_url`** (`{PUBLIC_BASE_URL}/verify/{cert_id}?s={sig}`, F3). The frontend must render exactly the string the server returns, and expose it as a `data-verify-url` attribute on the QR element so E2E tests can read it.
- **[v2] Themes (F15):** colors/ornaments come from CSS variables selected by `theme` in the certificate payload.
- **Revoked** certificates show a diagonal "REVOKED" watermark and a screen-only warning banner.
- Toolbar: **Print**, **Copy verify link**, **Back**; live preview scales to fit with a subtle 3D hover tilt (disabled in print).
- Only `valid` or `revoked` certificates render; otherwise a friendly not-found. Optional stretch: "Save as PDF" instructions via the browser print dialog.

---

## 11. Sample data (`sample_data/attendees.csv`, fictional)

≥ 3 courses (e.g., `DS-101 Intro to Data Storytelling`, `UX-201 Accessible Interface Design`, `CL-150 Cloud Basics for Teams`), ~34 rows, deliberately including:
- **A repeated attendee-course entry** (same email and course, different casing/whitespace) → duplicate detection.
- **Incomplete entries**: missing email; missing name; missing completion date with status completed; invalid date; unknown course code.
- Attendees with status `dropped` / `no-show` (ready but not eligible).
- One person in **two courses** (two certificates allowed).
- Two different people with the same name but different emails, **which must NOT be flagged as a fuzzy duplicate** (score below threshold; proves the detector avoids false positives).
- **[v2] Near-duplicate people that MUST be flagged (different courses so a merge is clean):** one email-domain typo pair (e.g. `priya.raman@gmail.com` vs `priya.raman@gmial.com`) and one nickname pair (`Jon Walker` / `John Walker` with emails differing by one character).
- Mixed date formats.
- Several clean complete rows so the first "Issue all eligible" gives clear numbers.

The README's **sample run** must show exact counts after: (1) import, (2) correcting incomplete rows, (3) issue-all, (4) re-import of the same file, (5) issue-all again, (6) revoking one certificate, **(7) resolving the fuzzy duplicates (one merge, one dismiss), (8) a modified file re-import (adds only genuinely new rows), (9) ledger integrity verification and ledger health result**. The seed script prints these numbers; use real values from your CSV. Tests assert the same numbers.

---

## 12. Automated tests (pytest) — all must pass with `make test`

**Test harness:** `TEST_DATABASE_URL` (fallback `DIRECT_URL`). Each test session creates a uniquely named Postgres **schema** (e.g., `test_<random>`), applies **all migration files in order** into it via `SET search_path`, and drops it afterward, so tests never touch real data. Each concurrent worker thread uses its own connection. Provide fixtures to: apply only `0001` (for the backfill test), disable/enable the audit triggers inside the scratch schema (tamper tests), drop constraints (failure-injection tests), and inject a fake clock into the rate limiter.

Required core tests:
1. **Concurrent double issue:** 20 threads call `issue(enrollment_id)` simultaneously → exactly **one** certificate row, all responses return the same `cert_id`, exactly one has `created:true`.
2. **Repeated import:** the same CSV twice → identical row counts, second response `already_imported:true`; a modified second file adds only genuinely new rows and never duplicates certificates. Also test **two simultaneous uploads of the same file** (advisory lock) → one import record. **[v2]** Also: a stale re-import containing a row whose email was later corrected, and a row that was blank-email, creates **no** new enrollment (fingerprint rule, 4.7).
3. **Duplicate entry in one file:** produces one enrollment and one `import_rows` row with outcome `duplicate`; only one certificate can ever exist.
4. **Incomplete cannot be issued:** 422 `NOT_ELIGIBLE`, no certificate row.
5. **Correction flow:** patching an incomplete row to valid values flips it to `ready`/eligible and counts update; patching to a colliding key returns 409 `DUPLICATE_KEY`.
6. **Revoked verifies as revoked;** revoking twice is idempotent; revoke without reason → 422.
7. **Verify:** unknown ID → `not_found`; bad checksum → `malformed`; public response never contains email or revoke reason.
8. **Counts invariant:** `eligible_total == pending + issued + revoked` after every step of the sample run **and after every merge, undo and demo step**.
9. **DB constraint test:** a raw `INSERT` of a second certificate for the same (person, course) raises `UniqueViolation`, proving the guarantee is in the database, not just the app.
10. **Delete protection:** cannot delete an enrollment that has a certificate.
11. **Auth:** organizer endpoints return 401 without a session; `/api/verify/*` and `/api/health` work without one; wrong passcode rejected; tampered cookie rejected. **[v2]** Route-enumeration test: every route in `app.routes` outside the explicit public allow-list returns 401 without a session.
12. **RLS check:** every application table (iterate all tables in the schema) has `rowsecurity = true`.
13. **Config:** missing required env vars produce an error naming them; **[v2]** short keys, or `SESSION_SECRET == LEDGER_SIGNING_KEY`, are rejected.

**Plus every feature test in section 15** (IDs `F1-T1` … `F16-…`). `make test` runs core + feature tests. `make test-perf` runs the performance budgets (section 16). `make test-e2e` runs Playwright. `make verify` runs everything (section 16).

---

## 13. Required note: `DUPLICATE_PREVENTION.md` (≤ 1 page, plain language)

In this order:
1. What "same person, same course" means (normalized email + course code).
2. **Layer 1 – Database:** `unique(person_id, course_id)` on `certificates` and `unique(email_norm, course_code)` on `enrollments` make duplicates *impossible*, regardless of app bugs.
3. **Layer 2 – Transaction:** row lock (`FOR UPDATE`) + `INSERT … ON CONFLICT DO NOTHING` + re-select, so concurrent or repeated calls return the existing certificate.
4. **Layer 3 – Import:** file-hash idempotency with an advisory lock, **raw-row fingerprints** (a stale spreadsheet can't resurrect corrected records), row-level upsert on the natural key, duplicate rows recorded but never issued.
5. **Layer 4 – Human review of near-duplicates:** fuzzy matching (typo'd emails, nicknames) feeds a review queue; merges are explicit, audit-logged, and refuse to merge two people who both hold certificates.
6. **Layer 5 – UI:** buttons disabled while pending; confirm dialogs state exact counts.
7. Where it is tested (test names) and how to see the proof live (Ledger health → "Try to break it").
8. Trade-off: revoked certificates are never re-issued under a new ID.

---

## 14. README requirements

- Prerequisites (Python 3.11+, Node 20+, a free Supabase account, a Vercel account).
- **Local setup in a few commands:** create venv, `pip install -r requirements-dev.txt`, `cp .env.example .env` (fill it in; generate both secrets with `openssl rand -hex 32`), `python -m backend.scripts.migrate`, optional `python -m backend.scripts.seed`, `npm install` in `frontend/`, then `make dev`.
- How to run tests (`make test`, `make test-e2e`, `make test-perf`, `make verify`). Table of environment variables with "where to find it".
- **Deploy** section (section 6), including `make smoke URL=...`.
- Architecture diagram (Mermaid): CSV → importer/classifier → enrollments → issue (transaction) → certificates → verify/print; audit hash chain + checkpoints; with Vercel (static + Python function) ⇄ Supabase Postgres.
- **Integrity & threat model section (required, honest):** what the hash chain, checkpoints and signatures *do* protect against (silent edits, row deletion, whole-chain rewrite without the signing key, forged or altered QR links, ID brute-forcing) and what they do **not** (an attacker with both database superuser rights **and** the signing key; truncation of the log after the last checkpoint; signatures are not a secrecy control and do not stop someone who knows a valid ID from looking it up; HMAC is symmetric so third parties cannot verify offline). State that Ed25519 public-key verification is future work.
- Sample run transcript (section 11), screenshots placeholder, design decisions and trade-offs, limitations, future work (reissue flow, per-user accounts, PDF export, email, Ed25519 signatures, external anchoring of the audit head hash).
- State clearly that the challenge's "SQLite is sufficient" is a minimum, and that Postgres on Supabase is used so the app can be deployed; note that the same integrity rules would hold on SQLite.
- A CI badge and a "Reviewer's 2-minute path" (load sample story → watch counts → verify integrity → open ledger health).

---

## 15. Stand-out features (build all; Tier 1 first)

### 15.0 Schema additions — `supabase/migrations/0002_standout.sql`

Write it as one transaction. It must run on vanilla Postgres. Required contents:

```sql
-- ===== F1: audit hash chain =====
alter table audit_log add column seq bigint, add column prev_hash text, add column row_hash text;

-- Canonical row hash. jsonb_build_array(...)::text has a deterministic text form, and the timestamp is
-- rendered in UTC with fixed precision so it does not depend on the session TimeZone.
create or replace function audit_row_hash(p_seq bigint, p_at timestamptz, p_action text, p_entity text,
                                          p_entity_id text, p_detail jsonb, p_prev text)
returns text language sql stable as $$
  select encode(sha256(convert_to(jsonb_build_array(
           p_seq, to_char(p_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'),
           p_action, p_entity, coalesce(p_entity_id,''), p_detail, p_prev)::text, 'UTF8')), 'hex') $$;

-- Backfill any pre-existing audit rows (temporarily disable the append-only trigger, in this transaction only),
-- in id order, then enforce NOT NULL + uniqueness.
-- (write the DO block: loop over audit_log order by id, set seq, prev_hash = previous row_hash or 64 zeros, row_hash)
alter table audit_log alter column seq set not null, alter column prev_hash set not null,
                      alter column row_hash set not null;
create unique index audit_log_seq_uq on audit_log(seq);

-- The chain is ordered by SEQ, NOT by identity id: ids are assigned before the BEFORE trigger gets the lock,
-- so concurrent transactions could otherwise interleave ids and break the chain.
create or replace function audit_log_chain() returns trigger language plpgsql as $$
declare last_seq bigint; last_hash text;
begin
  perform pg_advisory_xact_lock(hashtext('audit_log_chain'));        -- xact variety: pooler-safe
  select seq, row_hash into last_seq, last_hash from audit_log order by seq desc limit 1;
  new.seq       := coalesce(last_seq, 0) + 1;                         -- contiguous: a rolled-back tx leaves no gap
  new.prev_hash := coalesce(last_hash, repeat('0', 64));
  new.row_hash  := audit_row_hash(new.seq, new.at, new.action, new.entity, new.entity_id, new.detail, new.prev_hash);
  return new;
end $$;
create trigger audit_log_chain_bi before insert on audit_log for each row execute function audit_log_chain();
-- plus: append-only triggers (UPDATE, DELETE, TRUNCATE) re-asserted for audit_log (TRUNCATE is statement-level)

create table audit_checkpoints(
  id bigint generated always as identity primary key,
  up_to_seq bigint not null unique, head_hash text not null,
  mac text not null,                                  -- HMAC(K_audit, up_to_seq || ':' || head_hash), computed by the app
  created_at timestamptz not null default now());
-- append-only triggers (UPDATE/DELETE/TRUNCATE) on audit_checkpoints too

-- ===== F4: rate limiting =====
create table rate_limits(
  bucket text not null, key text not null, window_start timestamptz not null, hits int not null default 0,
  primary key (bucket, key, window_start));
create index rate_limits_window_idx on rate_limits(window_start);

-- ===== F5: fuzzy duplicates =====
create table duplicate_candidates(
  id bigint generated always as identity primary key,
  person_a_id bigint not null references people(id) on delete cascade,
  person_b_id bigint not null references people(id) on delete cascade,
  score numeric(4,3) not null, reasons jsonb not null default '[]',
  status text not null default 'open' check (status in ('open','merged','dismissed','superseded')),
  resolved_at timestamptz, resolved_note text,
  created_at timestamptz not null default now(),
  check (person_a_id < person_b_id), unique (person_a_id, person_b_id));
create index duplicate_candidates_status_idx on duplicate_candidates(status);

-- ===== misc FKs / indexes from 0001 [v2] items that need imports to exist =====
-- people.created_by_import_id, enrollments.source_import_id/last_import_id -> imports(id) ON DELETE SET NULL
-- (if not already added in 0001)

-- Every table above: ENABLE ROW LEVEL SECURITY, no policies.
```

**Verification of the migration itself:** (a) apply 0001 only, write 3 audit rows, apply 0002, run the chain verification → ok (test `F1-T10`); (b) run `migrate` twice → second run is a no-op; (c) change a byte of an applied migration file → runner aborts with a checksum error; (d) the RLS test sees all new tables; (e) the same migrations apply cleanly in the CI vanilla-Postgres container.

---

### F1. Tamper-evident audit log (Tier 1)

**Goal:** make it provable that no audit row was edited, deleted, reordered or inserted behind the application's back.

**Requirements**
- Every `audit_log` row is chained **inside the database** by the trigger in 15.0, so every write path (all app code, scripts, even manual SQL inserts) is chained and none can forget to.
- `backend/app/audit.py` provides:
  - `verify_chain(conn) -> ChainReport` using **one set-based query**: for each row ordered by `seq`, compare `prev_hash` to the previous row's `row_hash` (or 64 zeros for the first), recompute `row_hash` with `audit_row_hash(...)`, and check `seq = row_number()` (detects deleted/missing rows even if someone re-linked hashes). Report up to 20 problems: `{seq, kind: 'hash_mismatch'|'link_broken'|'seq_gap'}`.
  - Checkpoint check: for every `audit_checkpoints` row, the chain row at `up_to_seq` must exist with `row_hash == head_hash` (kind `checkpoint_mismatch`, which catches a **whole-chain rewrite** that recomputed every hash), and `mac` must equal `HMAC(K_audit, f"{up_to_seq}:{head_hash}")` (also accepting the previous key; kind `checkpoint_mac_invalid`, which catches forged checkpoints). Truncation *below* a checkpoint is detected because `up_to_seq` would no longer exist.
  - `ChainReport = {ok, checked, head_seq, head_hash, checkpoints_checked, problems[], verified_at}`.
  - On `ok`, write a new checkpoint (idempotent on `up_to_seq`).
- `POST /api/audit/verify` returns the report. `/api/audit` rows include `seq`, `prev_hash`, `row_hash`.
- Verification cost: one query + one checkpoint pass; budget 50k rows < 5 s (section 16).

**UI (Activity page):** button **"Verify ledger integrity"** → animated chain walk (blocks lighting up) → green "Chain intact: N events · head `a3f9…c21b`" with a copy button and the note "Record this hash somewhere outside this system to anchor it", or red "Chain BROKEN at event #K (kind)" with the offending row highlighted. Rows show 8-hex hash chips with a tooltip of the full hashes. Dashboard integrity chip shows the time of the last successful verification (from the latest checkpoint).

**Tests (all in `tests/test_f1_audit_chain.py`)**
- **F1-T1** After running the full sample run, `seq` is contiguous `1..n`, each `prev_hash` equals the previous `row_hash`, the first `prev_hash` is 64 zeros, and `verify_chain` is `ok`.
- **F1-T2** 20 threads each issue a different enrollment concurrently → no duplicate `seq`, chain verifies, `seq` contiguous.
- **F1-T3** Disable the append-only trigger in the scratch schema, `UPDATE` one row's `detail` → report `ok:false`, first problem `hash_mismatch` at exactly that `seq`; re-enable and restore → `ok:true`.
- **F1-T4** Delete a middle row (trigger disabled) → problem `seq_gap`/`link_broken` at the right `seq`.
- **F1-T5** **Whole-chain rewrite attack:** tamper row k, then recompute every later `prev_hash`/`row_hash` in SQL so the chain is internally consistent → the chain walk passes but a prior checkpoint makes the report `ok:false` with `checkpoint_mismatch`.
- **F1-T6** Insert a checkpoint with a wrong `mac` → `checkpoint_mac_invalid`. A checkpoint MAC computed with the *certificate* sub-key is also rejected (domain separation).
- **F1-T7** `UPDATE`, `DELETE`, `TRUNCATE` on `audit_log` and on `audit_checkpoints` all raise.
- **F1-T8** A transaction that inserts an audit row and then raises leaves **no** `seq` gap on the next successful write.
- **F1-T9** `POST /api/audit/verify`: 401 without session; response shape; a checkpoint row is created; `head_hash` equals the last row's `row_hash`; calling twice does not duplicate the checkpoint.
- **F1-T10** Migration backfill: rows written under 0001 only are chained correctly by 0002.
- **F1-T11** (Frontend, Vitest) hash-chip component truncates to 8 hex and exposes the full value via `title`/`aria-label`.

**Manual check:** run the demo story, open Activity, click Verify (green). In a SQL console with the trigger disabled, edit one `detail`, click Verify again (red, names the event).

---

### F2. Ledger health page (Tier 1)

**Goal:** a reviewer sees the invariants being *proven live*, not merely asserted.

**Requirements — `backend/app/health.py`, `GET /api/health/ledger`**
Returns `{ok, generated_at, duration_ms, checks:[{id, label, status:'pass'|'fail'|'warn', detail, evidence}]}`. Each check is an independent SQL query with its own `evidence` (numbers or offending ids, capped at 20). Required checks:

| id | What it proves |
|---|---|
| `count_invariant_overall` | `eligible_total = pending + issued + revoked`; evidence shows the actual numbers as an equation |
| `count_invariant_per_course` | same, for every course; evidence lists any failing course |
| `counts_two_ways` | the numbers from `stats.py` equal an **independent recount** from raw tables with different SQL (guards against a stats bug) |
| `one_cert_per_person_course` | `group by person_id, course_id having count(*) > 1` returns 0 rows |
| `one_enrollment_per_key` | same for `(email_norm, course_code)` |
| `cert_matches_enrollment` | each certificate's `person_id`/`course_id` equals its enrollment's |
| `no_orphans` | no certificate, enrollment, import_row, duplicate candidate points at a missing/tombstoned parent; no `ready` enrollment lacks `person_id`/`course_id`; no enrollment or certificate references a tombstoned person |
| `status_consistency` | no `valid` with `revoked_at`, no `revoked` without `revoked_at`/non-empty reason |
| `cert_id_format` | every `cert_id` matches the format and **checksum** (recomputed in Python) |
| `constraints_present` | the expected constraint/index/trigger names exist **and are enabled** (queried from `pg_constraint`, `pg_indexes`, `pg_trigger.tgenabled`): both unique constraints, the partial unique indexes, the status checks, the append-only triggers, the chain trigger |
| `rls_enabled` | `rowsecurity` true on all tables |
| `migrations_applied` | every file in `supabase/migrations/` is recorded in `schema_migrations` with matching checksum |
| `audit_chain` | `verify_chain` result summary (does **not** write a checkpoint here) |
| `audit_coverage` | every certificate has a `certificate.issue` audit row and every revoked one a `certificate.revoke` row |
| `fuzzy_duplicates_open` | `warn` (not fail) if open candidates exist, with the count |
| `needs_correction_open` | `warn` with the count, if any |
| `db_latency` | `select 1` round trip in ms (warn above 500 ms) |

Overall `ok` is false if any check is `fail`. Warnings do not fail the report.

**"Try to break it" — `POST /api/health/probe-duplicate`:** inside a transaction that is **always rolled back** (`force_rollback`), pick any existing certificate and attempt a raw `INSERT` of a second certificate for the same (person, course) with a fresh `cert_id`. Return `{blocked: true, constraint: "<name>", message}` when the unique violation fires (the expected result). If no certificate exists return `{skipped: true, reason}`. It must never leave data behind.

**UI (`/health`):** overall banner (green "All N checks passed" / red), a list of check rows with animated ticks, the **equation rendered with real numbers** ("11 eligible = 0 pending + 10 issued + 1 revoked ✓"), expandable evidence, "Run again", the "Try to break it" button showing the database's own error text, auto-refresh every 30 s while the page is visible, and `aria-live` announcements for status changes. Sidebar dot reflects the last result.

**Tests (`tests/test_f2_health.py`)**
- **F2-T1** After the full sample run, every check is `pass` (or the two expected `warn`s), and `ok:true`.
- **F2-T2** **Failure injection, parametrized per check** (in the scratch schema, drop the relevant constraint/trigger first, then insert the bad data): duplicate certificate, orphan certificate, enrollment/certificate mismatch, `valid` with `revoked_at`, corrupted `cert_id` checksum, missing trigger, disabled trigger, RLS disabled on one table, missing `schema_migrations` row, removed audit row for a certificate → exactly the matching check is `fail` and `ok:false`.
- **F2-T3** Monkeypatch `stats.py` to be off by one → `counts_two_ways` fails while `count_invariant_overall` may still pass.
- **F2-T4** Displayed equation numbers equal `/api/stats`.
- **F2-T5** `probe-duplicate`: `blocked:true`, names the certificates unique constraint, certificate and audit row counts are unchanged afterwards; with an empty ledger returns `skipped:true`.
- **F2-T6** `/api/health/ledger` and `/api/health/probe-duplicate` return 401 without a session; `/api/health` stays public.
- **F2-T7** Health report finishes in the budget (section 16) on a 5,000-enrollment ledger.

**Manual check:** open `/health` after the demo story: all green with real numbers; press "Try to break it" and read the genuine `UniqueViolation` text.

---

### F3. Signed certificates / QR links (Tier 1)

**Goal:** a forged or altered QR/link is detected by the verify page, in addition to the database lookup. (Threat model, honestly: the signature authenticates *links we minted*; it is not a secrecy control, so the public API never returns a signature, and manual ID lookup still works without one.)

**Requirements — `backend/app/signing.py`**
- `sign(cert_id) = base64url_nopad( HMAC_SHA256(K_cert, b"v1|" + cert_id.encode())[:12] )` → 16 characters.
- `verify_sig(cert_id, sig) -> bool` using `hmac.compare_digest`; accepts `K_cert` derived from `LEDGER_SIGNING_KEY` **or** `LEDGER_SIGNING_KEY_PREVIOUS`. Reject sigs of the wrong length/charset without computing.
- `verify_url(cert_id) = f"{PUBLIC_BASE_URL}/verify/{cert_id}?s={sig}"`. Included as `verify_url` in organizer certificate payloads (detail, batch listing). The Print page's QR encodes exactly this string.
- Verify endpoint order of operations: (1) malformed ID → `malformed`; (2) rate limit (F4); (3) if `s` is present **and invalid** → `{status:'invalid_signature', signature:'invalid'}` **with no holder data and an identical response whether or not the ID exists** (no existence oracle); (4) DB lookup → `valid`/`revoked`/`not_found`, with `signature:'valid'` or `'not_provided'`.
- The signature is also checked when the signature is valid but the certificate does not exist (e.g. data removed): `not_found` with `signature:'valid'`.

**UI:** Verify page shows the signature line described in section 8 and a red "LINK ALTERED" state; Certificate detail shows a "Signed verify link" copy button.

**Tests (`tests/test_f3_signing.py`)**
- **F3-T1** `sign` is deterministic, 16 chars, base64url charset; different IDs give different sigs.
- **F3-T2** A valid sig verifies; flipping any single character of the sig or of the `cert_id` fails.
- **F3-T3** A sig made with a different key fails; with `LEDGER_SIGNING_KEY_PREVIOUS` passes (rotation).
- **F3-T4** Domain separation: a certificate sig is not accepted as an audit checkpoint MAC and vice versa.
- **F3-T5** `/api/verify/{id}?s=<valid>` → `valid` + `signature:'valid'`; no `s` → `valid` + `signature:'not_provided'`; bad `s` → `invalid_signature` with **no** `holder_name`/`course_title`.
- **F3-T6** Bad `s` on an existing ID and on a non-existing ID produce **byte-identical** response bodies (no existence oracle).
- **F3-T7** The organizer certificate payload and the QR source (`verify_url`) contain a sig that verifies; the public API never returns a sig anywhere in its JSON.
- **F3-T8** `hmac.compare_digest` is the only comparison used (static test grepping `signing.py`), and malformed sigs (too long, non-base64url) are rejected cheaply.
- **F3-T9** (E2E, F16) open the print page, read `data-verify-url`, visit it → "Authentic link"; edit one character of `s` → "LINK ALTERED".

**Manual check:** open the QR URL (authentic), change one character of `s` (altered), remove `s` (ledger-only wording).

---

### F4. Rate-limited public lookups (Tier 2)

**Goal:** stop ID brute-forcing and login guessing, and make it easy to demo.

**Requirements — `backend/app/ratelimit.py`**
- Fixed-window counter in Postgres (works across serverless instances): `INSERT INTO rate_limits(bucket,key,window_start,hits) VALUES (...,1) ON CONFLICT (bucket,key,window_start) DO UPDATE SET hits = rate_limits.hits + 1 RETURNING hits`. The window start is `now()` truncated to the window size. One short autocommit transaction, no session state.
- `key` = hex of `HMAC(SESSION_SECRET, client_ip)` truncated to 32 chars (**never store raw IPs**). Client IP: `x-vercel-forwarded-for` if present, else the first entry of `x-forwarded-for`, else `request.client.host`. Document in the README that this header handling must be reviewed for the hosting platform.
- Buckets and defaults: `verify` 30/min; `notfound` 10 per 10 min (incremented only when the outcome was `not_found`, `malformed` or `invalid_signature`; checked **before** the DB lookup); `social` 120/min (badge, og, share, revocations); `login` 5 failed attempts per 15 min (checked before the passcode comparison).
- Requests carrying a **valid organizer session cookie are exempt** (so organizers and E2E tests are never throttled).
- On limit: HTTP 429, body `{error:{code:'RATE_LIMITED', message, details:{retry_after_seconds}}}`, header `Retry-After`. Responses to allowed requests carry `X-RateLimit-Limit` and `X-RateLimit-Remaining` for the `verify` bucket.
- Opportunistic cleanup: ~1% of calls delete windows older than 1 hour.
- A `get_now()` dependency/clock is injectable for tests. Failure policy: if the limiter's own DB write fails, **fail open for verify** (log, do not block recipients) and **fail closed for login**.

**UI:** Verify page shows "Too many lookups. Try again in 42 s" with a live countdown; Login shows the same.

**Tests (`tests/test_f4_ratelimit.py`)**
- **F4-T1** With limit 30/min, requests 1–30 succeed and the 31st gets 429 with `Retry-After` > 0 and the error shape.
- **F4-T2** Two different client IPs have independent counters.
- **F4-T3** After advancing the fake clock by one window, requests succeed again.
- **F4-T4** 10 `not_found`/`malformed` lookups trigger the `notfound` limiter on the 11th **before** any certificate query is executed (assert via a query counter), while valid lookups from the same IP still pass under the `verify` limit until it is reached.
- **F4-T5** A valid organizer session is never limited; a tampered cookie is limited like anyone else.
- **F4-T6** 5 wrong passcodes → 6th attempt (even with the right passcode) is 429; a different IP is unaffected.
- **F4-T7** `rate_limits.key` never contains the raw IP (assert the stored key differs from the IP and has the expected length).
- **F4-T8** Concurrent requests (20 threads, same IP, limit 5) → exactly 5 pass, the rest are 429 (atomic counter).
- **F4-T9** Limiter DB failure: verify fails open (200), login fails closed (503/429).

**Manual check / demo:** `make smoke` includes a burst of 40 verify calls and expects at least one 429 (section 16). Or in a terminal: `for i in $(seq 1 40); do curl -s -o /dev/null -w "%{http_code} " $URL/api/verify/CL-26-AAAAAAAAA; done`.

---

### F5. Fuzzy duplicate review queue + audit-logged merge (Tier 1)

**Goal:** catch the near-matches the exact key cannot (typo'd domains, nicknames) and let a human merge them safely.

**Detection — `backend/app/fuzzy.py` (pure functions, no DB) and `duplicates.py`**
- Scan active people (non-tombstone). To avoid O(n²) use **blocking**: candidate pairs only inside blocks keyed by (a) canonical last name token + first letter of first name, (b) email local part with dots/`+tags` removed (first 4 chars), (c) canonical email with the domain replaced by its typo-corrected form. Cap any block at 200 people (log a warning, skip). Pairs are stored once with `person_a_id < person_b_id`.
- Signals (score = sum of the **best** name signal + the **best** email signal + overlap bonus, capped at 1.0):
  - Name: exact normalized equality **0.45**; nickname-equivalent first name with the same last name **0.40** (table of ≥ 20 pairs: Jon/John/Jonathan, Bill/Will/William, Bob/Rob/Robert, Liz/Beth/Betty/Elizabeth, Mike/Michael, Kate/Katie/Katherine, Dave/David, Tom/Thomas, Jim/James, Steve/Steven, Chris/Christopher, …); close (Damerau–Levenshtein distance ≤ 1 on the full normalized name, or Jaro–Winkler ≥ 0.92) **0.35**. Normalize by lowercasing, stripping accents and punctuation.
  - Email: same local part and the domains differ only by a typo (known-typo map such as gmial/gmal/gnail→gmail.com, yaho/yahooo→yahoo.com, hotmial→hotmail.com, outlok→outlook.com, plus **any domain within distance 1 of a more frequent domain in this ledger with ≥ 3 people**) **0.50**; full-address Damerau–Levenshtein distance ≤ 2 **0.40**; same local part with dots/`+tag` removed **0.30**; same local part, different domain **0.25**.
  - Bonus **0.10** if the two people share a course and completion date.
- A pair becomes a candidate at **score ≥ 0.70** and with at least one email signal and one name signal. (Same name alone, or email alone, is **not** enough; this is what keeps two different people called "Sam Taylor" unflagged.) Thresholds are constants in one place.
- `reasons` is a list of human sentences (e.g. "Email domain looks like a typo of gmail.com", "Nickname match: Jon ≈ John", "Same name").
- Pairs already `dismissed` or `merged` are **never reopened** by a rescan. After a merge, other open candidates involving the loser become `superseded` and a rescan creates fresh ones for the survivor.
- Triggers: after every import commit (separate transaction), after manual create/patch of a person's email or name (cheap, scoped to that person), and via `POST /api/duplicates/scan`. Performance budget: 5,000 people < 5 s.

**Merge — `POST /api/duplicates/{id}/merge`** (one transaction; lock both people `FOR UPDATE` ordered by id to avoid deadlocks):
1. Survivor chosen by the caller (must be one of the two); optional final `full_name`.
2. Move the loser's enrollments to the survivor: set `person_id`, `email_norm` = survivor's email, `full_name` per the survivor; set `last_import_id = NULL`.
3. **Same-course conflicts** (both people already have an enrollment for that course): keep the enrollment that holds a certificate; if neither has one keep the `ready`+completed one, else the older one; if **both** hold certificates → abort the whole merge with 409 `MERGE_BLOCKED_BOTH_CERTIFIED` (never silently void a certificate). The discarded enrollment's `import_rows` are re-pointed to the kept enrollment, then the discarded enrollment is deleted.
4. Move the loser's certificates to the survivor (`person_id`); **certificate IDs never change**, so already-printed QR codes stay valid.
5. Mark the loser a tombstone (`merged_into = survivor`), mark the candidate `merged`, supersede related candidates.
6. Audit `person.merge` with full before/after detail (ids moved, deleted, names/emails). There is no un-merge in the UI; the audit detail allows manual restore (state this limitation).
7. Counts invariant must hold afterwards (test it).
- `GET /merge-preview?survivor=` returns exactly the plan above (moves, conflicts and which enrollment is kept, blocked reason if any) and the projected count deltas; no writes. The UI shows it before the confirm button.
- `POST /dismiss {note}` marks `dismissed` (audit-logged).

**UI (`/duplicates`):** queue sorted by score with reasons as chips; "Review" opens a **side-by-side dialog**: two columns (name, email, courses, certificate status, created date, source import), differences highlighted, a radio to choose the survivor, an editable final name, the **merge preview** (including conflicts and count deltas), and "Merge" (confirm dialog stating exact consequences) / "Not the same person" (dismiss). Empty state: "No suspected duplicates 🎉 — last scanned <time>". Sidebar badge shows the open count.

**Tests (`tests/test_f5_duplicates.py`, plus pure tests in `test_fuzzy.py`)**
- **F5-T1** Pure scoring: `priya.raman@gmail.com` vs `priya.raman@gmial.com` (same name) ≥ 0.70 with the domain-typo reason; `Jon Walker`/`John Walker` with one-char email difference ≥ 0.70 with the nickname reason.
- **F5-T2** **No false positives:** two "Sam Taylor"s with unrelated emails score < 0.70; same email local part but entirely different names < 0.70; the sample CSV's same-name pair is not flagged.
- **F5-T3** Self-learning domain typo: `exmaple.test` is recognized as a typo of the frequent `example.test` without being in the static map.
- **F5-T4** Scan after importing the sample CSV yields exactly the expected candidates (names the two pairs); rescanning is idempotent (no duplicate pairs); dismissed pairs are not reopened.
- **F5-T5** Clean merge (different courses): enrollments and certificates move to the survivor, certificate IDs unchanged, loser is a tombstone, counts invariant holds, `eligible_total` unchanged, audit row `person.merge` exists with detail.
- **F5-T6** Same-course conflict: kept enrollment follows the rules (certified > ready+completed > older); discarded enrollment's `import_rows` re-pointed; no orphan rows; invariant holds.
- **F5-T7** Both people certified for the same course → 409 `MERGE_BLOCKED_BOTH_CERTIFIED`, **nothing changed** (verify counts and rows).
- **F5-T8** After a merge, re-importing a modified file that contains the loser's old email creates no new person/enrollment (tombstone resolution) and issues nothing twice.
- **F5-T9** Concurrent merge of the same candidate from 5 threads → exactly one succeeds, the rest 409/idempotent; no deadlock (ordered locking).
- **F5-T10** Merge preview equals what the merge actually does (compare plan vs resulting rows).
- **F5-T11** Dismiss is audit-logged, removes the pair from the open queue and survives a rescan. Endpoints return 401 without a session.
- **F5-T12** Health `no_orphans` still passes after merges; the audit chain still verifies.
- **F5-T13** (perf, `make test-perf`) 5,000 synthetic people scan < 5 s.

**Manual check:** run the demo story; merge Priya (side-by-side), dismiss Jon/John, watch counts stay 10 = 0 + 10 + 0.

---

### F6. "Fix in Excel" round trip (Tier 2)

**Goal:** non-technical organizers fix problem rows in a spreadsheet and re-upload.

**Requirements — `corrections.py`, `problem_labels.py`**
- `problem_labels.py` is the **single mapping** from each problem code to `{label, how_to_fix}` in plain language (e.g. `MISSING_EMAIL` → "Email is missing" / "Type the attendee's email address in the email column."). Served by `GET /api/meta/problems` and used by both the UI chips and the export. A test asserts every problem code has a label and fix text.
- `GET /api/attendees/export-corrections.csv?course=` exports every `needs_correction` record as CSV with a UTF-8 BOM (opens correctly in Excel): columns `record_id, name, email, course, completion_date, status, problems, how_to_fix`. `problems` and `how_to_fix` are `; `-joined plain-language sentences. Values that start with `= + - @` are prefixed with `'` (CSV/formula-injection guard).
- Re-upload goes through the **normal import** (preview + commit). If a `record_id` column exists, rows are **corrections**: for an existing enrollment **without a certificate**, apply the values through the same classifier/patch logic (these *do* overwrite, because the human is correcting) → outcome `corrected` (or stays `needs_correction` if still invalid, with the new problem list). If the corrected key collides with another enrollment → outcome `duplicate` pointing at the conflicting record and the original is left unchanged. If the enrollment already has a certificate → outcome `unchanged` (recorded detail `locked_has_certificate`). An unknown `record_id` is ignored (row processed as a normal row, detail `record_id_ignored`).
- Idempotent: the same corrections file twice → `already_imported:true`; a *different* file with the same corrections → `unchanged`.

**Tests (`tests/test_f6_corrections.py`)**
- **F6-T1** Export contains exactly the `needs_correction` records, BOM present, header row exact, plain-language text, no raw problem codes in the `problems` column.
- **F6-T2** Formula-injection guard on a name like `=HYPERLINK(...)`.
- **F6-T3** Round trip: export → fill in the blanks → re-upload via commit → records become `ready`, eligible counts rise, invariant holds, outcomes are `corrected`.
- **F6-T4** Re-uploading the same corrections file → `already_imported:true`; a re-saved variant → rows `unchanged`.
- **F6-T5** Correction that collides with an existing key → `duplicate`, original untouched.
- **F6-T6** Correction row for a certified enrollment → `unchanged`, certificate untouched.
- **F6-T7** Corrections do not overwrite fields on records that are *not* in the file (no collateral changes).
- **F6-T8** Every problem code has a label and fix; `/api/meta/problems` returns all of them.

**UI:** "Export needs-correction (CSV)" button; the import preview shows the corrections banner and `corrected` rows in their own color.

---

### F7. Column-mapping step in the import wizard (Tier 2)

**Requirements — `mapping.py`**
- `POST /api/imports/preview` returns `{headers, delimiter, mapping, mapping_source:'auto'|'manual', suggestions:{field:{header, confidence}}, column_errors:[...], rows...}`.
- Auto-detect via the alias table first, then fuzzy header matching (token containment such as "Participant Email" → email, Damerau distance ≤ 2) with a confidence value; low-confidence matches are suggestions, not auto-applied.
- Optional multipart field `mapping` (JSON `{canonical_field: "Header As In File"}`) overrides detection in both preview and commit. Reject unknown canonical fields, headers not present in the file, and two canonical fields mapped to one header (422 `INVALID_MAPPING`).
- Idempotency key includes the explicit mapping (4.7).
- Delimiter sniffing (`,` `;` tab), BOM stripping, trimmed headers.

**UI:** step 2 "Map columns": a table with each canonical field, a select of detected headers, a confidence chip, a sample of the first 3 values under the chosen header, required markers, and a live preview refresh (debounced). The wizard cannot advance while required fields are unmapped.

**Tests (`tests/test_f7_mapping.py`)**
- **F7-T1** A file with headers `Participant, Contact Email, Module, Finished On, Result` auto-suggests the right mapping with confidences; applying it imports correctly.
- **F7-T2** Missing required column → preview `column_errors`; commit 422 `MISSING_COLUMNS` naming the fields; nothing written.
- **F7-T3** Semicolon- and tab-delimited, BOM-prefixed files parse identically to the comma version.
- **F7-T4** Invalid mappings (unknown field, absent header, duplicate target) → 422 `INVALID_MAPPING`.
- **F7-T5** Same file + same mapping twice → `already_imported`; same file + different mapping → a distinct import (both recorded).
- **F7-T6** Mapping a column that the alias table would have chosen differently honors the manual choice.
- **F7-T7** (Vitest) the mapping table disables "Next" until required fields are mapped.

---

### F8. Undo an import (Tier 2)

**Rule (precise):** `POST /api/imports/{id}/undo` is allowed only if **every** record the import created or changed (`new`, `updated`, `corrected` rows) satisfies: it has **no certificate**, **and** `enrollments.last_import_id = this import` (i.e. it was not manually edited, merged, or touched by a later import since). Otherwise → 409 `UNDO_BLOCKED` with `details.blockers:[{enrollment_id, reason: 'HAS_CERTIFICATE'|'MODIFIED_AFTER_IMPORT'}]` (first 50) and a count; **nothing** is changed.

When allowed, in one transaction (lock the import row `FOR UPDATE`): delete enrollments created by this import (`new`); restore `before` values for `updated`/`corrected` rows (and set `last_import_id = NULL`); delete people created by this import that have no remaining enrollments and no certificates (duplicate candidates cascade); set `imports.undone_at`/`undone_note`; audit `import.undo`. The partial unique index makes the same file re-importable afterwards. Undoing an already-undone import returns 200 `{already_undone:true}`. Imports remain in history, labelled "Undone".

**UI:** an **Undo import** button per history row. If blocked, it is disabled with a tooltip listing the reason counts; if enabled, a confirm dialog states exactly how many records will be removed or restored.

**Tests (`tests/test_f8_undo.py`)**
- **F8-T1** Import → undo → ledger exactly equals the state before the import (compare row sets and counts); invariant holds.
- **F8-T2** After undo, the same file can be re-imported and yields the original outcomes.
- **F8-T3** An import where one row's enrollment has a certificate → 409 `UNDO_BLOCKED` (`HAS_CERTIFICATE`), nothing deleted.
- **F8-T4** A manually corrected record (`MODIFIED_AFTER_IMPORT`) blocks undo; a merged record blocks undo.
- **F8-T5** Undo restores `updated` rows' previous values exactly.
- **F8-T6** A later import that touched a record blocks undo of the earlier import but not of the later one (if clean).
- **F8-T7** Undo is idempotent and concurrent-safe (5 threads → one effect).
- **F8-T8** Audit row `import.undo` written; chain still verifies; health `no_orphans` passes.

---

### F9. "Add to LinkedIn" and shareable badge (Tier 3)

- **LinkedIn:** on a `valid` certificate in the Verify page, a button builds `https://www.linkedin.com/profile/add?startTask=CERTIFICATION_NAME&name=<course title>&organizationName=<issuer>&issueYear=<YYYY>&issueMonth=<M>&certUrl=<current verify URL including ?s= if present>&certId=<cert_id>`, all URL-encoded, opening in a new tab with `rel="noopener noreferrer"`. Not shown for revoked, not found or altered links. The builder is a pure function (`lib/linkedin.ts`). (Verify the parameter names against LinkedIn's current documentation.)
- **Badge:** `GET /api/verify/{cert_id}/badge.svg` (public, `social` bucket) returns a compact SVG: status glyph drawn as vector shapes, "Valid"/"Revoked"/"Not found", the course title (truncated), issuer, and the cert ID. `Content-Type: image/svg+xml`, `Cache-Control: public, max-age=60` (so a revocation shows quickly), no PII beyond what the verify page shows, all text XML-escaped. The Verify page offers "Copy badge embed" producing `<a href="…/verify/ID"><img src="…/api/verify/ID/badge.svg" alt="Certificate ID: valid"></a>`.
- **Tests (`tests/test_f9_badge.py`, Vitest):** **F9-T1** (Vitest) LinkedIn URL builder: encoding of `&`, spaces, unicode; month/year parsed from `issued_at`; absent for non-valid. **F9-T2** badge SVG for valid, revoked, not found, malformed; well-formed XML (parse it); course title containing `<script>&"` is escaped. **F9-T3** badge reflects revocation immediately after revoke. **F9-T4** badge is rate-limited on the `social` bucket and contains no email/reason.

---

### F10. Social preview for verify links (Tier 3)

- `GET /verify/{cert_id}` and `GET /api/share/{cert_id}` (public, `social` bucket) return a minimal HTML document: `og:title` "✓ Valid certificate — Priya R., Cloud Basics" (or "✕ Revoked certificate — …"), `og:description` (issuer, issue date), `og:image` = `{PUBLIC_BASE_URL}/api/og/{cert_id}.png`, `og:url`, `twitter:card=summary_large_image`, plus a `<meta http-equiv="refresh">` and JS redirect to the SPA `/verify/{cert_id}` (preserving `?s=`) for humans. **Privacy:** holder name is abbreviated to **first name + last initial**; no email, ever. Not-found/malformed IDs return a generic neutral page with `noindex` and **no** existence leak.
- `GET /api/og/{cert_id}.png` renders a 1200×630 PNG with Pillow (`ImageFont.load_default(size=N)`): dark gradient background, vector-drawn check/cross, status word, abbreviated name, course title, issuer, cert ID; `Cache-Control: public, max-age=60`. A neutral "Certificate not found" image for unknown IDs.
- `vercel.json` bot rewrite from section 6 routes unfurlers to this handler.
- **Tests (`tests/test_f10_social.py`):** **F10-T1** HTML contains the expected `og:` tags and abbreviates the name; revoked variant says Revoked. **F10-T2** the PNG response is a valid PNG of 1200×630 (check signature bytes and decode with Pillow). **F10-T3** not-found and malformed produce identical neutral HTML (no existence oracle) with `noindex`. **F10-T4** HTML-escaping of hostile course titles/names. **F10-T5** no email/reason/full surname anywhere in the HTML. **F10-T6** `curl -A Slackbot` against `/verify/{id}` in `make smoke` returns OG HTML on the deployed site (manual/automated smoke).

---

### F11. Public revocation list and documented verify API (Tier 3)

- `GET /api/revocations?since=<ISO>&page=&format=json|csv` (public, `social` bucket): **only** `{cert_id, revoked_at}` (no names, courses, reasons), ordered by `revoked_at`, paginated (max 500 per page), with `generated_at` and a `next` cursor. CSV has a header row.
- **`/developers`** (public page): documents `GET /api/verify/{id}` (all fields, all statuses including `invalid_signature`, rate-limit headers, 429 behavior), the badge, the revocation list, the signature semantics (what the `s` parameter proves and does not prove, honestly), runnable `curl` examples, and a live "Try it" box. Link to `/api/docs`.
- **Tests (`tests/test_f11_revocations.py`):** **F11-T1** only revoked certificates appear; `valid` never; fields restricted to the two allowed keys. **F11-T2** `since` and pagination are correct and stable under a new revocation. **F11-T3** CSV format. **F11-T4** no PII (assert the JSON text contains no name or email from the fixtures). **F11-T5** rate-limited. **F11-T6** (E2E) `/developers` loads unauthenticated and the "Try it" box returns a result.

---

### F12. Batch print (Tier 3; ZIP is optional stretch)

- **Batch print page** `/courses/:code/print`: fetches `GET /api/certificates?course=&status=valid&page=&limit=50`, renders each certificate on its own landscape A4 page (`break-after: page`), shows "Rendering 50 of 180… Load more", a screen-only toolbar (Print all, Include revoked? default off, Back), and a count banner that must equal the course's `issued` count. Each certificate uses its `verify_url` QR and its course theme. Revoked certificates, when included, carry the watermark.
- `GET /api/certificates` returns the same payload as the single print page plus pagination metadata `{total, page, pages}`.
- **Optional stretch:** `GET /api/certificates/export.zip?course=` streams a ZIP of `{cert_id}.pdf` (reportlab, with the QR drawn natively) for valid certificates only; cap at 200 per request.
- **Tests:** **F12-T1** the listing returns exactly the valid certificates of the course, paginated, never includes other courses; total equals stats `issued` for the course. **F12-T2** payload includes a verifying `verify_url` and the correct `theme`. **F12-T3** 401 without a session. **F12-T4** (E2E) batch page renders N `.certificate-page` elements equal to the course's issued count. **F12-T5** (only if ZIP implemented) the ZIP contains N entries, each starting with `%PDF`, named by cert ID.

---

### F13. Funnel chart (Tier 2)

- `stats.funnel` as defined in 4.8, scoped by `scope`. Dashboard renders a Recharts funnel/horizontal-bar chart: **Unique records → Ready → Eligible → Issued ever → Currently valid**, with the exact drop-off reason between each stage, annotations for "rows received" and "duplicate rows merged", and a tooltip explaining each stage. Clicking a drop-off navigates to Attendees pre-filtered (needs correction / not completed / pending).
- **Tests (`tests/test_f13_funnel.py`):** **F13-T1** stage values are monotonically non-increasing and each drop-off equals the difference exactly (assert all four equalities) after **every step of the sample run and the demo story**. **F13-T2** funnel values agree with the KPI numbers (`ready − needs…`, `currently_valid == issued`). **F13-T3** merges and undo keep the equalities. **F13-T4** (Vitest) the chart component renders labels and a text alternative (`aria-label`/table fallback) with the same numbers.

---

### F14. Guided demo mode — "Load sample story" (Tier 1)

**Goal:** a reviewer sees every important behavior in two minutes, with every number checked against an expected value computed independently.

**Safety rules**
- Demo data is **tagged**: demo courses have `is_demo=true` (codes `DEMO-101`, `DEMO-201`, titles prefixed "Demo:"), demo imports have `is_demo=true`, demo emails use `@example.test`. Everything else is derived from those tags (an enrollment is demo if its course is a demo course or its `source_import_id` is a demo import).
- `scope` (`real`|`demo`|`all`) on stats and issue-all (4.5, 4.8). The **demo story always passes `scope=demo`**, and the default real "Issue all eligible" uses `scope=real`, so demo records are never issued by a real action and vice versa. While demo data exists, the dashboard shows a chip "Demo data included (N records) — Remove demo data".
- `POST /api/demo/reset` deletes **only** demo-tagged data in one transaction (certificates, enrollments, demo imports, people created by demo imports with no non-demo enrollments, demo courses) and audit-logs `demo.reset`. It must never touch non-demo rows. The audit log is untouched (append-only), and the chain still verifies afterwards.
- Endpoints: `GET /api/demo/status` (loaded? counts), `GET /api/demo/story` (the ordered steps, with the **expected numbers** for each step, from constants in `demo.py`), `GET /api/demo/csv?variant=base|modified`, `POST /api/demo/load` (creates the two demo courses and runs the base import through the **real importer**), `POST /api/demo/import {variant}` (same, for re-imports), `POST /api/demo/reset`.

**Demo dataset (`backend/app/assets/demo_story_base.csv`, 12 rows; the `modified` variant appends row 13)**

| # | name | email | course | date | status | expected effect |
|---|---|---|---|---|---|---|
| 1 | Ava Martin | ava.martin@example.test | DEMO-101 | 2026-03-02 | completed | new, eligible |
| 2 | Ben Carter | ben.carter@example.test | DEMO-101 | 2026-03-02 | completed | new, eligible |
| 3 | Chloe Diaz | chloe.diaz@example.test | DEMO-101 | 03/03/2026 | completed | new, eligible (date format) |
| 4 | Ava Martin | ` AVA.MARTIN@example.test ` | demo-101 | 2026-03-02 | completed | **duplicate** of row 1 |
| 5 | Priya Raman | priya.raman@example.test | DEMO-201 | 2026-03-10 | completed | new, eligible |
| 6 | Priya Raman | priya.raman@exmaple.test | DEMO-101 | 2026-03-02 | completed | new, eligible; **fuzzy pair with row 5** |
| 7 | Jon Walker | jon.walker@example.test | DEMO-101 | 2026-03-11 | completed | new, eligible; fuzzy pair with row 8 |
| 8 | John Walker | john.walker@example.test | DEMO-201 | 2026-03-11 | completed | new, eligible |
| 9 | Diego Alvarez | *(blank)* | DEMO-101 | 2026-03-04 | completed | **needs correction** (MISSING_EMAIL) |
| 10 | Emma Stone | emma.stone@example.test | DEMO-201 | *(blank)* | completed | **needs correction** (MISSING_COMPLETION_DATE) |
| 11 | Frank Lee | frank.lee@example.test | DEMO-101 | 2026-03-05 | dropped | ready, **not eligible** |
| 12 | Grace Kim | grace.kim@example.test | DEMO-201 | 2026-03-12 | completed | new, eligible |
| 13 *(modified variant only)* | Hana Ito | hana.ito@example.test | DEMO-101 | 2026-03-06 | completed | new, eligible |

**The story (each step has a callout, a "Run this step" button, an "Auto-play" option, and an expected-vs-actual check shown as ✓/✕; all numbers use `scope=demo`):**

| Step | Action (real API calls) | Expected after the step |
|---|---|---|
| S1 Load | `demo/load` | import: rows 12, inserted 9, needs_correction 2, duplicates 1. Stats: eligible 8, pending 8, issued 0, revoked 0, needs_correction 2, not_completed 1. Open fuzzy candidates 2. Funnel: unique 11, ready 9, eligible 8, issued_ever 0, valid 0 |
| S2 Correct | PATCH row 9 email → `diego.alvarez@example.test`; PATCH row 10 date → `2026-03-13` | eligible 10, pending 10, needs_correction 0; funnel unique 11, ready 11, eligible 10 |
| S3 Resolve duplicates | merge Priya pair (survivor `priya.raman@example.test`); dismiss Jon/John | open candidates 0; eligible 10; unique records 11 (no same-course conflict) |
| S4 Issue | `issue-all scope=demo` | created 10, already_issued 0; issued 10, pending 0 |
| S5 Re-import same file | `demo/import base`, then `issue-all` again | `already_imported:true`; created 0, already_issued 10; all counts unchanged |
| S6 Modified file | `demo/import modified`, then `issue-all` | import: row_count 13, inserted 1, unchanged 11, duplicates 1; then created 1, already_issued 10; eligible 11, issued 11 |
| S7 Revoke | revoke Ben Carter's certificate (reason "Demo: issued in error") | issued 10, revoked 1, pending 0, eligible 11 (11 = 0 + 10 + 1); verify page shows REVOKED |
| S8 Forgery | open Ben's verify URL with a tampered `s` | `invalid_signature` ("LINK ALTERED") |
| S9 Integrity | `audit/verify` and `health/ledger` | chain ok, all checks pass |

**UI:** a "Load sample story" button (Dashboard empty state and ⌘K) opens a right-hand **tour panel** with the steps, callouts that spotlight the relevant UI element (e.g. the "1 duplicate row merged" chip, the duplicate queue, the seal-stamp animation, the verify page), live before/after counts, and the ✓/✕ expected-vs-actual badges. "Remove demo data" is always available.

**Tests (`tests/test_f14_demo.py`)**
- **F14-T1** Run the entire story through the API; after **every** step the actual numbers (stats, funnel, import summary, candidates) equal the `expected` constants returned by `GET /api/demo/story` **and** the table above (so the constants cannot drift from reality).
- **F14-T2** Invariant `eligible = pending + issued + revoked` holds after every step.
- **F14-T3** With real (non-demo) data present, loading and running the demo never changes real counts, and `issue-all scope=real` never issues a demo record (and the reverse).
- **F14-T4** `reset` removes exactly the demo data: real data identical before/after; audit chain verifies afterwards; health passes; `reset` twice is a no-op.
- **F14-T5** `demo/load` twice → second call reports already loaded; no duplicate demo rows.
- **F14-T6** After reset, the demo can be loaded again from scratch with identical outcomes.
- **F14-T7** All demo endpoints return 401 without a session.
- **F14-T8** (E2E) the guided tour auto-plays to completion with all ✓.

---

### F15. Per-course certificate themes (Tier 3)

- Themes: `classic` (ivory + gold, default), `modern` (white + indigo), `midnight` (navy + gold), `forest` (cream + deep green), `slate` (light grey + charcoal). Implemented purely as CSS variable sets + ornament variants in the Print components; all must keep body text ≥ 4.5:1 contrast and print legibly (backgrounds use `print-color-adjust: exact`).
- `PATCH /api/courses/{code}` accepts `{title?, hours?, theme?}`; unknown theme → 422; audit-logged (`course.update`). The theme is read at print time (changing it re-styles existing certificates; state this in the README). Certificate payloads include `theme`.
- **UI:** Courses page theme picker with a live miniature preview; the Print page and batch print apply the theme.
- **Tests:** **F15-T1** valid themes accepted, unknown rejected (422), 401 without a session. **F15-T2** payload carries the course theme. **F15-T3** audit row written and chain verifies. **F15-T4** (Vitest) each theme maps to a defined variable set; contrast of text/background pairs ≥ 4.5:1 (computed in the test). **F15-T5** (E2E, optional) a screenshot per theme renders without overflow.

---

### F16. Engineering signals (Tier 2)

**Playwright E2E (`e2e/`, run by `make test-e2e`)**
- `backend/scripts/e2e_server.py` creates a scratch schema (via `DB_SCHEMA`), applies migrations, starts uvicorn plus `vite preview`, and drops the schema on exit. E2E never touches real data. Config uses fake secrets from the environment.
- **E2E-1 Full flow:** login (wrong passcode first → error) → import the sample file via the real file chooser → preview shows outcomes → commit → open a problem record, fix it in the drawer → Issue all (confirm dialog with exact count) → counts on the dashboard match the API → open a certificate print page, read `data-verify-url`, open it in a fresh context (no session) → VALID + "Authentic link" → revoke with a reason → verify again → REVOKED → re-import the same file → "Already imported" and unchanged counts → Ledger health all green → Activity "Verify ledger integrity" green.
- **E2E-2 Demo story:** click "Load sample story" and auto-play; every step shows ✓.
- **E2E-3 Forgery:** tampered `s` → "LINK ALTERED"; non-existent ID → NOT FOUND; malformed ID → MALFORMED.
- **E2E-4 Duplicate merge:** merge via the side-by-side dialog, counts unchanged.
- **E2E-5 Accessibility:** `@axe-core/playwright` finds zero `serious`/`critical` violations on Login, Dashboard, Verify, Ledger health, Duplicates.
- **E2E-6 Responsive:** at 360 px wide, Dashboard/Verify/Attendees have no horizontal page scroll.
- **E2E-7 Double-click safety:** double-click an Issue button; exactly one certificate exists.
- **E2E-8 Rate limit:** burst of lookups from the page shows the countdown message.

**GitHub Actions (`.github/workflows/ci.yml`), on every push and pull request**
- Job `backend`: Python 3.11 and 3.12 matrix, `postgres:16` service container with health check, set `TEST_DATABASE_URL`/`DIRECT_URL`/`DATABASE_URL` to the container, dummy secrets (≥ 32 chars), `pip install -r requirements-dev.txt`, `pytest -q` (includes the 20-thread concurrency tests against a real Postgres). **No real Supabase secrets are ever used in CI.**
- Job `frontend`: Node 20, `npm ci`, `tsc --noEmit` (strict), lint, Vitest, `npm run build`, and a check that the bundle contains no string `SUPABASE`/`service_role`/`LEDGER_SIGNING_KEY`.
- Job `e2e` (needs backend+frontend): installs Playwright browsers, runs `make test-e2e`, uploads the HTML report and traces as artifacts on failure.
- Job `hygiene`: fails if `.env` is tracked or any file matches common secret patterns; checks `.env.example` lists every variable that `config.py` reads (parse and compare).
- Cache pip and npm. Concurrency group cancels superseded runs. README shows the CI badge.

**In-app "How duplicates are prevented" (`/how-it-works/duplicates`, public)**
- Renders `DUPLICATE_PREVENTION.md` (imported with Vite `?raw` and a small markdown renderer) in a clean reading layout with the five layers as an animated diagram, and test names linked to the layer they prove.
- For organizers, a **live proof panel** shows the actual constraint names from `constraints_present` and a "Try to break it" button (F2 probe).
- **Tests:** **F16-T1** (Vitest) the page renders all layer headings from the markdown source. **F16-T2** (E2E) the page is reachable without login; the live panel only appears when logged in.

**Smoke script (`python -m backend.scripts.smoke <base_url> [--passcode ...]`, `make smoke URL=...`)**
Run after every deploy. It prints a PASS/FAIL line per check and exits non-zero on any FAIL: `/api/health` ok with `db:true`; unauthenticated organizer route returns 401; `/api/verify/CL-26-AAAAAAAAA` returns `malformed` or `not_found` (never 500); a burst of 40 verify calls yields at least one 429 (skippable with `--no-burst`); `curl -A Slackbot /verify/<id>` returns OG HTML (when `--cert-id` supplied); if `--passcode` is supplied: login → `/api/health/ledger` all pass → `/api/audit/verify` ok → pick a valid certificate, confirm its signed URL verifies as authentic and a tampered one is `invalid_signature`; static assets served; response headers sane (`Cache-Control` on badge, no `Set-Cookie` on public verify).

---

## 16. Verification matrix and release gate

### 16.1 Traceability matrix (must be filled in README / self-review with the real file and test names)

| Requirement | Automated proof | Manual / live proof |
|---|---|---|
| One certificate per person per course | core tests 1, 9; F2-T2 (`one_cert_per_person_course`) | Ledger health check + "Try to break it" |
| Idempotent issue and import | core tests 1, 2, 3; F6-T4; F8-T2 | E2E-7 double-click; S5 in demo |
| Accurate counts | core test 8; F2-T3/T4; F13-T1; F14-T1/T2 | Health equation with real numbers |
| Audit cannot be silently edited | F1-T3…T8 | Activity → Verify integrity (green), tamper → red |
| Forged/altered QR detected | F3-T2/T5/T6; E2E-3 | Demo S8, edit `s` in the URL |
| ID brute force slowed | F4-T1…T8 | `make smoke` burst; verify countdown |
| Near-duplicates reviewed, merges safe | F5-T1…T13 | Duplicates page, demo S3 |
| Unreliable spreadsheet handled | tests 2–5, F6, F7 | Import wizard with sample + messy file |
| Mistaken import reversible only when safe | F8-T1…T8 | Undo button states |
| Database enforces rules (not just app) | core 9, 12; F2-T2 | `constraints_present` check |
| Public data minimal | core 7; F10-T5; F11-T4; F9-T4 | Inspect public JSON/HTML |
| Auth covers every route | core 11 (route enumeration) | `make smoke` unauthenticated 401 |
| Deployed system works | — | `make smoke URL=…` all PASS |

### 16.2 Performance budgets (`make test-perf`, local Postgres; mark with `@pytest.mark.perf`)
- Commit a 5,000-row CSV < 10 s; preview < 5 s.
- Fuzzy scan, 5,000 people < 5 s.
- `audit/verify`, 50,000 audit rows < 5 s.
- `health/ledger`, 5,000 enrollments < 3 s.
- `issue-all` of 1,000 pending < 20 s (chunks of 200).
Document measured numbers in the README.

### 16.3 Release gate — `make verify` must pass, in order
1. `python -m backend.scripts.migrate` on a clean scratch schema, run twice (second is a no-op).
2. `pytest -q` (core + all feature tests).
3. `make test-perf` (budgets).
4. Frontend: `tsc --noEmit` (strict, no `any`), lint, Vitest, build.
5. `make test-e2e` (Playwright, all E2E specs).
6. Secret scan: no `.env` tracked; built bundle contains none of `SUPABASE`, `service_role`, `LEDGER_SIGNING_KEY`, `SESSION_SECRET`.
7. Failure-injection spot check (scripted, in tests): tamper an audit row → verify red; drop the certificates unique constraint → health red; both restored after.
8. After deploy: `make smoke URL=…` all PASS.

### 16.4 Reviewer's 2-minute manual path (put it in the README)
1. Log in → Dashboard empty state → **Load sample story** → auto-play; every step shows ✓.
2. Open **Duplicates** (already resolved by the story), **Ledger health** (all green, equation with real numbers), press **Try to break it**.
3. Activity → **Verify ledger integrity** (green, head hash).
4. Print a certificate, scan or open its QR URL → authentic; alter one character of `s` → LINK ALTERED.
5. Revoke it → verify page shows REVOKED; open `/developers` and the public revocation list.

---

## 17. Quality bar and delivery order

**Quality bar (non-negotiable):** TypeScript `strict: true`, no `any` in app code; Pydantic models for every request/response; all multi-statement writes in one transaction through the `db.py` context manager; parameterized SQL only (no string-built queries); no secrets in code or logs; no raw IPs stored; comments where a *rule* is enforced; the app must run from a clean checkout following the README exactly; every new table has RLS enabled; every new organizer route is covered by the route-enumeration auth test; all cryptographic comparisons use `hmac.compare_digest`; public responses never include email, revoke reason, or signatures. Mentally execute the README before finalizing and fix any gaps.

**Delivery order (emit all files per phase):**
1. **Plan recap** (≤ 25 lines): understanding, assumptions, and the order in which Tier 1/2/3 will be built.
2. **Config & database:** `.env.example`, `.gitignore`, `0001_init.sql`, `0002_standout.sql`, `config.py`, `db.py`, `migrate.py`.
3. **Backend core:** `normalize.py`, `importer.py` (with fingerprints, tombstones, mapping hooks), `certificates.py`, `stats.py` (incl. funnel and scope), `auth.py`, `problem_labels.py`, routes, `main.py`, `api/index.py`, `seed.py`, requirements files, `vercel.json`.
4. **Backend Tier 1:** `audit.py` (F1), `health.py` (F2), `signing.py` (F3), `fuzzy.py` + `duplicates.py` (F5), `demo.py` (F14) and their routes.
5. **Backend Tier 2 and 3:** `ratelimit.py` (F4), `corrections.py` (F6), `mapping.py` (F7), `undo.py` (F8), `social.py` (F9/F10/F11), batch certificate listing (F12), course PATCH + themes (F15).
6. **Sample data and demo data:** `attendees.csv`, `demo_story_base.csv`.
7. **Tests:** every test in section 12 and section 15, perf tests, the failure-injection fixtures.
8. **Frontend foundation:** Vite/Tailwind config, design tokens, shadcn components used, API client (handles 401 and 429), query hooks, layout shell, theme, command palette.
9. **Frontend pages:** Login → Dashboard (with funnel and integrity chip) → Attendees (+ drawer) → Import wizard (with mapping) → Courses (themes) → Certificate detail → Print + BatchPrint → Verify (signature, LinkedIn, badge) → Activity (verify integrity) → Duplicates → Ledger health → demo tour panel → Developers → How duplicates are prevented. Vitest tests.
10. **Engineering and docs:** Playwright specs and `e2e_server.py`, `smoke.py`, `ci.yml`, `README.md`, `DUPLICATE_PREVENTION.md`, `Makefile` (`setup | migrate | seed | dev | build | test | test-e2e | test-perf | verify | smoke`).
11. **Self-review checklist:** tick every requirement in section 1, every test in section 12, every feature test ID in section 15, and every row of the matrix in 16.1, naming the file/function that satisfies each. Flag anything not fully done, honestly, and list any Tier 3 item that was not implemented.

Start now with phase 1.
