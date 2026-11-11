# Architecture & Codebase Map: Certificate Ledger

This document describes the architectural layout, directory structure, and responsibilities of every file and folder in the Certificate Ledger system.

---

## 1. Directory Tree Overview

```
certificate-ledger/
├── .env                               # Active local environment variables (git-ignored)
├── .env.example                       # Committed template documenting all environment variables
├── .gitignore                         # Git exclusion rules (secrets, build artifacts, playwright)
├── DUPLICATE_PREVENTION.md            # Multi-layer mathematical proof against duplicate issuance
├── README.md                          # Full system documentation, threat model, and setup guide
├── architecture.md                    # This document: full folder and file inventory
├── Makefile                           # Unified developer CLI (test, build, migrate, seed, smoke)
├── vercel.json                        # Vercel deployment configuration, function routing, and bot rewrites
├── package.json                       # Node.js dependencies, build, and test scripts
├── tsconfig.json                      # Strict TypeScript compiler options
├── vite.config.ts                     # Vite build configuration, Tailwind plugin, and path aliases
├── index.html                         # SPA entry point with Google Fonts and metadata
├── server.ts                          # Express full-stack runtime with Vite middleware & REST endpoints
├── requirements.txt                   # Production Python dependencies for Vercel functions
├── requirements-dev.txt               # Testing and development Python dependencies
├── api/
│   └── index.py                       # Vercel serverless entry point exporting FastAPI app
├── supabase/
│   └── migrations/
│       ├── 0001_init.sql              # Core schema: people, courses, enrollments, certificates, audit
│       └── 0002_standout.sql          # Cryptographic audit hash chain, checkpoints, rate limits, fuzzy dups
├── sample_data/
│   └── attendees.csv                  # 34-row representative dataset with dirty, incomplete, & typo rows
├── backend/
│   ├── app/
│   │   ├── config.py                  # Pydantic v2 settings, secret validation, and key derivation
│   │   ├── main.py                    # FastAPI application, OpenAPI documentation, and route mount
│   │   ├── signing.py                 # Crockford base32 ID generation, checksums, and HMAC link signing
│   │   └── assets/
│   │       ├── demo_story_base.csv    # 12-row dataset for the F14 guided walkthrough
│   │       └── demo_story_modified.csv# Modified dataset with row 13 (Hana Ito) for step S6
│   └── scripts/
│       ├── migrate.py                 # Migration runner calculating and verifying SQL checksums
│       ├── seed.py                    # Seeder parsing attendees.csv and printing initial counts
│       └── smoke.py                   # Automated post-deployment smoke verification suite
├── frontend/
│   ├── components/
│   │   ├── layout/
│   │   │   └── Shell.tsx              # Sidebar navigation, header breadcrumbs, theme switch, ⌘K palette
│   │   └── features/
│   │       ├── CertificateCard.tsx    # Landscape A4 certificate canvas with Fraunces serif and signed QR
│   │       ├── FunnelChart.tsx        # F13 Funnel visualizer with mathematical drop-offs and filter links
│   │       ├── DemoStoryTour.tsx      # F14 9-step guided walkthrough panel with auto-play and checkmarks
│   │       ├── SideBySideMergeModal.tsx # F5 Near-duplicate reviewer with diff highlights and merge preview
│   │       └── AttendeeDrawer.tsx     # Slide-over drawer for live inline attendee correction
│   ├── pages/
│   │   ├── Home.tsx                   # Public landing page with hero search, live invariants, and defense cards
│   │   ├── Dashboard.tsx              # Bento grid: 4 KPIs, Funnel, course progress, quick verify, audit feed
│   │   ├── Attendees.tsx              # Attendee registry table, faceted search, bulk bar, CSV export
│   │   ├── Import.tsx                 # 4-step wizard: upload, column mapping, diff preview, undo import
│   │   ├── Courses.tsx                # Course cards, progress rings, theme picker (F15), issue all modal
│   │   ├── Duplicates.tsx             # Fuzzy duplicate candidate queue with confidence badges
│   │   ├── ActivityLog.tsx            # Tamper-evident event log with "Verify Ledger Integrity" chain walk
│   │   ├── LedgerHealth.tsx           # Live 16-check diagnostic console with "Try to Break It" probe
│   │   ├── Verify.tsx                 # Public lookup page, animated seal stamp, LinkedIn link, embed badge
│   │   ├── Developers.tsx             # Public API documentation, interactive test console, revocation list
│   │   ├── HowDuplicatesArePrevented.tsx # 5-layer visual defense diagram and live constraint inspector
│   │   ├── CertificateDetail.tsx      # Single certificate view, status timeline, audit trail, revocation modal
│   │   ├── Print.tsx                  # Dedicated landscape A4 print view for single certificate
│   │   ├── BatchPrint.tsx             # Dedicated landscape A4 print view with page breaks for course batch
│   │   └── Login.tsx                  # Passcode authentication modal with error shake and rate-limit timer
│   └── lib/
│       ├── api.ts                     # Frontend API client module re-exporting typed API helpers
│       └── problemLabels.ts           # Frontend mapping of problem codes to labels and fix instructions
└── src/
    ├── main.tsx                       # React DOM entry point mounting App.tsx
    ├── App.tsx                        # Root application component wiring routes & frontend components
    ├── index.css                      # Global styles, Tailwind v4 imports, design tokens, print CSS
    └── lib/
        ├── api.ts                     # Typed API client with 401 handling, 429 countdowns, and REST calls
        ├── crypto.ts                  # Crockford base32 generator, HMAC link signer, audit SHA-256 chain
        ├── crypto.test.ts             # Unit tests for Crockford check char, link signing, and audit hashes
        ├── classifier.ts              # Normalizer, date parser, problem code flags, raw-row fingerprints
        ├── classifier.test.ts         # Unit tests for date formats, name cleaning, and classification
        ├── fuzzy.ts                   # Damerau-Levenshtein distance, nickname groups, domain typo detection
        ├── fuzzy.test.ts              # Unit tests for typo scoring, nickname matching, and false-positive checks
        ├── funnel.ts                  # Funnel arithmetic, monotonic validation, and invariant check
        ├── funnel.test.ts             # Unit tests for drop-off calculation and mathematical invariant equation
        ├── problemLabels.ts           # Single source of truth for problem codes, labels, and fix instructions
        ├── ledgerEngine.ts            # Complete in-memory/persistent transaction engine implementing rules
        └── ledgerEngine.test.ts       # Integration tests for issuance, idempotency, health, and rollback
```

---

## 2. Directory & Component Breakdown

### Root Directory
- **`server.ts`**: The full-stack Express server that serves the backend API (`/api/*`), handles cookie-based organizer sessions, manages the rate-limiter buckets (`verify`, `notfound`, `login`, `social`), runs the `LedgerEngine`, and mounts Vite dev middleware (`vite.middlewares`) to host the SPA seamlessly on port 3000.
- **`package.json`**: Defines Node.js dependencies (`express`, `cookie-parser`, `qrcode.react`, `lucide-react`, `motion`, `react`, `vite`, `tailwindcss`), dev dependencies, and execution scripts:
  - `npm run dev`: starts the unified full-stack server via `tsx server.ts`.
  - `npm test`: executes all unit tests using Node's test runner via `tsx --test src/**/*.test.ts`.
  - `npm run build`: builds the frontend production bundle.
- **`vercel.json`**: Deployment manifest configuring the Node serverless function at `api/index.ts`, header-conditional rewrites for social bot crawlers (Slackbot, Twitterbot, LinkedInbot) accessing `/verify/:id`, and SPA fallbacks.
- **`.env.example`**: Complete template defining all required and optional configuration keys with comments explaining where to obtain them.
- **`DUPLICATE_PREVENTION.md`**: Architectural document detailing the 5 layers of defense (Database Constraints, Transaction Row Locks, Importer Fingerprints, Fuzzy Human Review, and UI Safeguards).

---

### Database (`supabase/migrations/`)
- **`0001_init.sql`**: Initial migration creating the foundational schema:
  - `people`: Attendee identity identified by normalized email with `merged_into` tombstone pointers.
  - `courses`: Course code, title, hours, and aesthetic theme.
  - `enrollments`: Unique `(email_norm, course_code)` records with raw fingerprint indexing.
  - `certificates`: Unique `(person_id, course_id)` physical constraint preventing double issuance.
  - `imports` & `import_rows`: Idempotent file tracking with before/after state captures.
  - `audit_log`: Base event table protected by append-only triggers.
  - Row Level Security (RLS) enabled on all tables without public exposure policies.
- **`0002_standout.sql`**: Stand-out integrity migration adding:
  - `audit_log` hash chain: contiguous `seq`, `prev_hash`, `row_hash`, and trigger `audit_log_chain_bi`.
  - `audit_checkpoints`: Signed state checkpoints storing HMAC MACs.
  - `rate_limits`: Distributed fixed-window rate counters.
  - `duplicate_candidates`: Fuzzy duplicate review queue table.

---

### Backend Python Engine (`backend/`)
- **`api/index.ts`**: Entry point re-exporting the Express `app` for Vercel's Node runtime (`backend/` is the legacy Python engine, kept for reference and not deployed).
- **`backend/app/config.py`**: Pydantic v2 settings class loading `.env`, asserting secret length (≥ 32 chars), ensuring `SESSION_SECRET != LEDGER_SIGNING_KEY`, and deriving domain-separated subkeys (`k_cert`, `k_audit`).
- **`backend/app/signing.py`**: Python implementation of Crockford base32 ID generation, checksum calculation, and HMAC-SHA256 link signing.
- **`backend/app/main.py`**: FastAPI application exposing REST routes, CORS middleware, and OpenAPI documentation at `/api/docs`.
- **`backend/scripts/migrate.py`**: Migration tool verifying SQL files and applying them in strict order.
- **`backend/scripts/seed.py`**: Seed tool loading `sample_data/attendees.csv` through the importer.
- **`backend/scripts/smoke.py`**: Automated post-deployment smoke checker verifying public endpoints, rate limits, and authentication gates.

---

### Core Business Logic (`src/lib/`)
- **`crypto.ts` & `crypto.test.ts`**:
  - `generateCertId(year)`: Generates non-sequential IDs formatted as `CL-YY-XXXXXXXXX` using Crockford base32 characters.
  - `computeCheckChar(str)`: Computes weighted modulo check character to catch typos prior to database queries.
  - `signCertId(id, key)`: Computes 16-character base64url HMAC tag using domain-separated key `certificate-link-v1`.
  - `verifyCertSignature(id, sig, key, prevKey)`: Constant-time signature verification supporting key rotation.
  - `computeAuditRowHash(...)`: Generates canonical SHA-256 row hash over array `[seq, at, action, entity, entity_id, detail, prev_hash]`.
- **`classifier.ts` & `classifier.test.ts`**:
  - `cleanName(name)`: Collapses whitespace and Title Cases mixed strings.
  - `parseDate(date)`: Parses ISO (`YYYY-MM-DD`), European (`DD/MM/YYYY`), and text formats (`21-Feb-2026`), flagging invalid calendar dates or future dates.
  - `classifyRecord(raw, knownCourses)`: Evaluates records against rules, outputs problem codes (`MISSING_EMAIL`, `UNKNOWN_COURSE`, etc.), sets `record_state` to `ready` or `needs_correction`, and computes raw row SHA-256 fingerprint.
- **`fuzzy.ts` & `fuzzy.test.ts`**:
  - `damerauLevenshtein(a, b)`: Distance algorithm handling transpositions.
  - `areNicknames(a, b)`: Dictionary of >20 common first-name pairs (Jon/John, Bob/Robert, etc.).
  - `scorePair(a, b)`: Calculates combined confidence score (0.0 to 1.0) requiring both a name signal and an email signal. Prevents false positives between distinct people with the same name.
  - `scanDuplicates(people)`: Scans active people using blocking (last name token, email prefix, domain typo) to avoid $O(n^2)$ overhead.
- **`funnel.ts` & `funnel.test.ts`**:
  - Calculates exact funnel stages: *Unique Records → Ready → Eligible → Issued Ever → Currently Valid*.
  - Enforces mathematical drop-off identities and verifies the invariant formula `eligible == pending + issued + revoked`.
- **`problemLabels.ts`**:
  - Single registry mapping problem codes to human labels and actionable fix recommendations.
- **`ledgerEngine.ts` & `ledgerEngine.test.ts`**:
  - Comprehensive transactional engine managing in-memory and persistent tables with row-locking semantics.
  - Implements idempotent issuance (`issueCertificate`), bulk issuance (`issueAll`), revocations (`revokeCertificate`), public lookup (`verifyLookup`), preview and commit of imports (`commitImport`), rollback (`undoImport`), duplicate merging (`mergeDuplicate`), and diagnostic health evaluation (`checkLedgerHealth`).

---

### User Interface & Pages (`src/pages/` & `src/components/`)
- **`Shell.tsx`**: Navigation wrapper featuring the responsive collapsible sidebar, top bar with breadcrumbs, theme switcher (dark/light mode), live health indicator dot, and ⌘K command palette modal.
- **`CertificateCard.tsx`**: High-fidelity landscape A4 certificate renderer with Fraunces serif calligraphy, gold/emerald embossed seal, signatory signatures, and signed QR code. Includes revoked watermark overlay.
- **`FunnelChart.tsx`**: Interactive funnel visualization showing exact drop-offs with clickable filters.
- **`DemoStoryTour.tsx`**: Floating interactive runner for the 9-stage guided demo story with auto-play and validation checkmarks.
- **`SideBySideMergeModal.tsx`**: Modal for reviewing candidate identities with diff highlights, survivor radio selectors, editable legal name, and merge preview.
- **`AttendeeDrawer.tsx`**: Slide-over drawer for live inline attendee corrections with dynamic re-classification.
- **`Dashboard.tsx`**: Showpiece bento grid displaying 4 KPI tiles, Funnel chart, course progress bars, quick verify search box, and recent audit activity feed.
- **`Attendees.tsx`**: Registry table with faceted state/course/cert filters, instant search, bulk issue bar, and export needs-correction CSV.
- **`Import.tsx`**: 4-step wizard (Upload → Map Columns → Diff Preview → Commit) plus history table and safe undo buttons.
- **`Courses.tsx`**: Course cards with aesthetic theme selector (`classic`, `modern`, `midnight`, `forest`, `slate`), progress rings, and batch issuance confirmation modals.
- **`Duplicates.tsx`**: Fuzzy candidate review queue with confidence score chips and review action buttons.
- **`ActivityLog.tsx`**: Full audit log viewer with "Verify Ledger Integrity" interactive chain walk and external anchor hash copy.
- **`LedgerHealth.tsx`**: Real-time diagnostic board checking 16 invariants and featuring the "Try to Break It" probe.
- **`Verify.tsx`**: Public verification page with uppercase auto-formatting, animated seal stamps, LinkedIn credential builder, and SVG badge embed snippet.
- **`Developers.tsx`**: Developer documentation portal with interactive live API test console and revocation list.
- **`HowDuplicatesArePrevented.tsx`**: Public visual defense explainer rendering the 5-layer diagram and live constraint inspector.
- **`CertificateDetail.tsx`**: Certificate inspection view with status timeline, cryptographic audit trail, and revocation modal.
- **`Print.tsx` & `BatchPrint.tsx`**: Print layouts optimized for landscape A4 output with `@page` media rules.
- **`Login.tsx`**: Passcode authentication modal with error shake and rate-limit cooldown.
