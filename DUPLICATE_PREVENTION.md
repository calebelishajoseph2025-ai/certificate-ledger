# Duplicate Prevention in Certificate Ledger

Certificate Ledger provides a mathematical guarantee: **no person can ever receive more than one valid certificate for the same course**, regardless of user double-clicks, network retries, conflicting spreadsheet re-imports, or concurrent API requests.

---

## 1. What "Same Person, Same Course" Means

Identity in Certificate Ledger is rigorously defined:
- **Person**: identified solely by **normalized email** (`trim().toLowerCase()`). Names are display labels, not identity. Two people with the same name and different emails are distinct; the same email with typographical variations in the name resolves to the single existing person.
- **Course**: identified by uppercase trimmed course code (e.g., `DS-101`).
- **Natural Key**: `(email_norm, course_code)`. This tuple defines uniqueness across all imports, corrections, and issuance transactions.

---

## 2. Layer 1 — The Database (Absolute Invariant)

The strongest guarantee lives inside PostgreSQL engine constraints:
- `certificates(person_id, course_id)` carries an unconditional `UNIQUE` constraint. Even if application logic had an unhandled edge case or race, PostgreSQL physically rejects any second certificate insertion with a `UniqueViolation` error (`23505`).
- `enrollments(email_norm, course_code)` has a `UNIQUE` constraint. Two attendee records for the same course cannot coexist as distinct enrollments.
- `enrollments(raw_fingerprint)` maintains a partial unique index over non-null fingerprints: `sha256(normalized_raw_fields)`.

---

## 3. Layer 2 — Transactional Concurrency & Row Locks

Certificate issuance (`issue(enrollment_id)`) executes inside an isolated transaction:
1. `SELECT ... FROM enrollments WHERE id = $1 FOR UPDATE`: takes an exclusive row-level lock, strictly serializing any concurrent issuance or edit requests for the same enrollment.
2. Eligibility check: validates `record_state = 'ready' AND completed = true`.
3. Atomic insertion: `INSERT INTO certificates (...) VALUES (...) ON CONFLICT (person_id, course_id) DO NOTHING RETURNING *`.
4. If a conflict occurs, the transaction selects the existing certificate and returns `{ certificate, created: false }` with HTTP 200.
5. The tamper-evident `audit_log` row is appended only when `created: true`. Concurrent worker tests prove 20 parallel threads result in exactly 1 certificate row and 0 duplicate audit events.

---

## 4. Layer 3 — Importer Hardening & Idempotency

Spreadsheets in the real world are messy and repeatedly re-uploaded:
- **File-level Idempotency**: computes SHA-256 over raw CSV bytes + canonical column mapping. An advisory transaction lock `pg_advisory_xact_lock(hashtext(sha256))` serializes simultaneous uploads. If an active import matches the hash, it returns the previous summary with `already_imported: true` without touching rows.
- **Raw-Row Fingerprinting**: each row calculates `raw_fingerprint = sha256(clean_name + clean_email + clean_course + clean_date + clean_status)`. If an older uncorrected spreadsheet is re-imported after an organizer manually corrected an email, the fingerprint matches the existing row without overwriting the human correction or resurrecting invalid blanks.
- **Natural Key Upsert**: non-duplicate rows upsert onto `(email_norm, course_code)`. Duplicate rows within the same file are preserved in `import_rows` with `outcome = 'duplicate'` and linked to the surviving enrollment, but are never eligible for issuance.

---

## 5. Layer 4 — Fuzzy Detection & Safe Merging

Exact email matches cannot catch typos like `priya.raman@gmial.com` or nickname variations like `Jon Walker` vs `John Walker`:
- **Blocking & Scoring**: groups candidates by tokenized last name, email prefix, and domain typo clustering. Candidate pairs scoring $\ge 0.70$ (requiring at least one name signal and one email signal) enter a dedicated review queue.
- **Explicit Human Review**: organizers inspect side-by-side attributes and select the surviving identity.
- **Safety Rule on Merge**: if **both** identities already hold certificates for the same course, the merge is hard-blocked with HTTP 409 `MERGE_BLOCKED_BOTH_CERTIFIED`. Certificates are never silently destroyed.
- **Tombstone Architecture**: the loser person record points to the survivor via `merged_into`. Any future imports matching the old email transparently resolve to the survivor.

---

## 6. Layer 5 — User Interface Safeguards

- Buttons transition to optimistic loading states and are disabled immediately upon click.
- Confirmation dialogs state exact counts before bulk actions (e.g., "Issue 10 certificates").
- The Attendees table displays an informative chip ("1 duplicate row merged") detailing original source rows.

---

## 7. Automated Proof & Live Diagnostics

| Guarantee | Automated Test Proof | Live Verification |
|---|---|---|
| Concurrent Double-Issue | `tests/test_core.py::test_concurrent_double_issue` | 20 threads simultaneously call API |
| Duplicate CSV Entry | `tests/test_core.py::test_duplicate_entry_in_file` | Outcome logged as `duplicate`, 1 cert issued |
| Database Constraint | `tests/test_core.py::test_db_constraint` | Raw SQL insert raises `UniqueViolation` |
| Live Invariant Check | `tests/test_f2_health.py::test_health_checks` | `/health` proves `one_cert_per_person_course` is 0 rows |
| "Try to Break It" Probe | `tests/test_f2_health.py::test_probe_duplicate` | Runs duplicate insert in rolled-back tx; confirms constraint fires |

---

## 8. Architectural Trade-off: Revocation Immutability

In Certificate Ledger, `unique(person_id, course_id)` is **unconditional**. When a certificate is revoked, it remains recorded as `status = 'revoked'`. It cannot be re-issued under a new ID. This deliberate design decision ensures cryptographic audit trails and public verification records remain tamper-evident and unambiguous forever.
