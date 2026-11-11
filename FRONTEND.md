# Certificate Ledger frontend

Observatory console for tamper-evident credential issuance. Meridian visual language: Geist, Instrument Serif, brass on ink, instrument-panel chrome, optional WebGL sky.

## Phase 1 recap

- Repository is not a git checkout. Protected-file SHA-256 baseline: `scripts/.protected-baseline.json`.
- Leftover UI (`src/App.tsx`, `src/main.tsx`, `src/index.css`) existed and was **replaced** (allowed files). `frontend/` was already gone.
- `classifier.ts` imports `node:crypto` — browser code reimplements live validation in `src/lib/format.ts`.
- `problemLabels.ts` is imported read-only.
- Real API is `server.ts`. Notable contract diffs versus the brief’s section 9:
  - Stats are **camelCase** (`eligibleTotal`, `funnel.uniqueRecords`, `funnel.dropOffs.*`).
  - Import is **JSON** `{ csv, mapping, filename }`, not multipart.
  - `GET /api/attendees` has no pagination.
  - `GET /api/demo/story` does not exist; the tour uses `/api/demo/*` plus `GET /api/stats?scope=demo`.
  - `GET /api/branding` exists and is used for issuer / signatories.
  - `GET /api/health` is `{ ok, db }` only — public status strip does not invent counts.
  - Login limiter is 5 attempts / 15 minutes; the 6th failed attempt is `429`.

`server.ts` gained a production-only SPA fallback for `dist/index.html` so `/verify/:id` deep links work when `NODE_ENV=production`. Dev still uses Vite middleware.

## Scripts

```
npm run dev
npm run typecheck
npm run lint
npm run test:ui
npm test
npm run build
npm run e2e
npm run ui:gate
```

Organizer secret is never in the client. Sign in through the organizer form; the server cookie is httpOnly.

## Sky

`src/sky/*`. Named three.js imports, seeded stars, nebula, governor, `window.__sky`. Reduced motion uses the CSS gradient fallback.

## Known gaps versus the brief

- No 30-day series on `/api/stats`, so KPI tiles have no sparkline.
- Demo tour expected/actual uses live demo-scope stats; there is no story endpoint.
- Lighthouse CI is configured (`npm run lhci`) but is not part of `ui:gate` by default.
