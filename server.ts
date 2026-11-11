import express, { Request, Response, NextFunction } from 'express';
import 'dotenv/config';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LedgerEngine } from './src/lib/ledgerEngine.js';
import { PROBLEM_REGISTRY } from './src/lib/problemLabels.js';
import { signCertId } from './src/lib/crypto.js';
import { createLedgerPersistence } from './src/lib/ledgerPersistence.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET = process.env.SESSION_SECRET || 'a8f9c2e4b6d0123456789abcdef0123456789abcdef0123456789abcdef01234';
const SIGNING_KEY = process.env.LEDGER_SIGNING_KEY || 'd7e5f3a1c9b80123456789abcdef0123456789abcdef0123456789abcdef01234';
const PREVIOUS_SIGNING_KEY = process.env.LEDGER_SIGNING_KEY_PREVIOUS || '';
const ORGANIZER_PASSCODE = process.env.ORGANIZER_PASSCODE || 'demo2026';
const SYSTEM_RESET_KEY = process.env.SYSTEM_RESET_KEY || 'system_reset_csi_2026';
const PUBLIC_BASE_URL = (() => {
  const configured = process.env.PUBLIC_BASE_URL;
  if (configured && configured !== 'http://localhost:3000') return configured;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${PORT}`;
})();

const engine = new LedgerEngine({
  sessionSecret: SESSION_SECRET,
  signingKey: SIGNING_KEY,
  previousSigningKey: PREVIOUS_SIGNING_KEY,
  organizerPasscode: ORGANIZER_PASSCODE,
  issuerName: process.env.ISSUER_NAME || 'Northwind Learning Collective',
  signatory1Name: process.env.SIGNATORY_1_NAME || 'Dr. Amara Okonkwo',
  signatory1Title: process.env.SIGNATORY_1_TITLE || 'Program Director',
  signatory2Name: process.env.SIGNATORY_2_NAME || 'Lucas Brandt',
  signatory2Title: process.env.SIGNATORY_2_TITLE || 'Head of Faculty',
  publicBaseUrl: PUBLIC_BASE_URL,
});

function loadSampleSeed(): void {
  const samplePath = path.join(__dirname, 'sample_data', 'attendees.csv');
  if (!fs.existsSync(samplePath)) return;
  const csvContent = fs.readFileSync(samplePath, 'utf-8');
  engine.commitImport(csvContent, 'attendees.csv', undefined, false);
}

function secretEquals(input: string, expected: string): boolean {
  const a = crypto.createHash('sha256').update(input, 'utf8').digest();
  const b = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
}

// Load sample seed data into engine initially so dashboard and verify work out of the box
try {
  loadSampleSeed();
} catch (e) {
  console.error('Failed to load initial sample_data/attendees.csv', e);
}

const app = express();
app.use(cookieParser(SESSION_SECRET));
app.use(express.json({ limit: '5mb' }));
app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '5mb' }));

// ----------------------------------------------------------------------------
// Durable Postgres persistence (Supabase). No-op when DATABASE_URL is unset;
// fail-closed (503) when set but unreachable — see src/lib/ledgerPersistence.ts.
// ----------------------------------------------------------------------------
const ledgerPersistence = createLedgerPersistence(engine);
app.use(ledgerPersistence.middleware);

// Track DB readiness for the health endpoint.
let dbReady = ledgerPersistence.mode === 'memory'; // memory = always ready
ledgerPersistence.ready.then(() => { dbReady = true; }).catch(() => { dbReady = false; });

// ----------------------------------------------------------------------------
// Rate Limiter (F4)
// ----------------------------------------------------------------------------
interface RateLimitBucket {
  limit: number;
  windowMs: number;
}

const LIMITS: Record<string, RateLimitBucket> = {
  verify: { limit: parseInt(process.env.RATE_LIMIT_VERIFY_PER_MIN || '30', 10), windowMs: 60 * 1000 },
  notfound: { limit: parseInt(process.env.RATE_LIMIT_NOTFOUND_PER_10MIN || '10', 10), windowMs: 10 * 60 * 1000 },
  login: { limit: parseInt(process.env.RATE_LIMIT_LOGIN_FAILS_PER_15MIN || '5', 10), windowMs: 15 * 60 * 1000 },
  social: { limit: parseInt(process.env.RATE_LIMIT_SOCIAL_PER_MIN || '120', 10), windowMs: 60 * 1000 },
  reset: { limit: 5, windowMs: 15 * 60 * 1000 },
};

const rateLimitStore = new Map<string, { hits: number; windowStart: number }>();

function getHashedIp(req: Request): string {
  const ip =
    (req.headers['x-vercel-forwarded-for'] as string) ||
    ((req.headers['x-forwarded-for'] as string) || '').split(',')[0].trim() ||
    req.socket.remoteAddress ||
    '127.0.0.1';
  return crypto.createHmac('sha256', SESSION_SECRET).update(ip).digest('hex').slice(0, 32);
}

function checkRateLimit(
  req: Request,
  bucketName: string,
  options?: { always?: boolean },
): { allowed: boolean; retryAfter: number; remaining: number } {
  // Organizers with valid session are exempt unless the bucket must always apply
  if (!options?.always && isOrganizerAuthenticated(req)) {
    return { allowed: true, retryAfter: 0, remaining: 999 };
  }

  const bucket = LIMITS[bucketName] || { limit: 60, windowMs: 60000 };
  const key = `${bucketName}:${getHashedIp(req)}`;
  const now = Date.now();

  const record = rateLimitStore.get(key);
  if (!record || now - record.windowStart >= bucket.windowMs) {
    rateLimitStore.set(key, { hits: 1, windowStart: now });
    return { allowed: true, retryAfter: 0, remaining: bucket.limit - 1 };
  }

  if (record.hits >= bucket.limit) {
    const retryAfter = Math.ceil((record.windowStart + bucket.windowMs - now) / 1000);
    return { allowed: false, retryAfter: Math.max(1, retryAfter), remaining: 0 };
  }

  record.hits++;
  return { allowed: true, retryAfter: 0, remaining: bucket.limit - record.hits };
}

// ----------------------------------------------------------------------------
// Authentication (Section 4.9)
// ----------------------------------------------------------------------------
function signSessionToken(val: string): string {
  const hmac = crypto.createHmac('sha256', SESSION_SECRET).update(val).digest('hex');
  return `${val}.${hmac}`;
}

function verifySessionToken(token?: string): boolean {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [val, sig] = parts;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(val).digest('hex');
  const bufA = Buffer.from(sig, 'hex');
  const bufB = Buffer.from(expectedSig, 'hex');
  if (bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB)) {
    const expiry = parseInt(val, 10);
    return Date.now() < expiry;
  }
  return false;
}

function isOrganizerAuthenticated(req: Request): boolean {
  const cookie = req.cookies?.ledger_session || req.signedCookies?.ledger_session;
  return verifySessionToken(cookie);
}

function requireOrganizer(req: Request, res: Response, next: NextFunction) {
  if (isOrganizerAuthenticated(req)) {
    return next();
  }
  res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Organizer authentication required' } });
}

// ----------------------------------------------------------------------------
// API Routes
// ----------------------------------------------------------------------------

// 1. Health & Diagnostics
app.get('/api/health', (_req: Request, res: Response) => {
  const mode = ledgerPersistence.mode;
  const db = mode === 'memory' ? true : dbReady;
  res.json({ ok: true, db, mode });
});

app.get('/api/health/ledger', requireOrganizer, (_req: Request, res: Response) => {
  const health = engine.checkLedgerHealth();
  res.json(health);
});

app.post('/api/health/probe-duplicate', requireOrganizer, (_req: Request, res: Response) => {
  const probe = engine.probeDuplicate();
  res.json(probe);
});

// 2. Auth Endpoints
app.post('/api/auth/login', (req: Request, res: Response) => {
  const rate = checkRateLimit(req, 'login');
  if (!rate.allowed) {
    res.setHeader('Retry-After', rate.retryAfter);
    return res.status(429).json({
      error: { code: 'RATE_LIMITED', message: 'Too many failed login attempts', details: { retry_after_seconds: rate.retryAfter } },
    });
  }

  const { passcode } = req.body || {};
  if (!passcode || typeof passcode !== 'string') {
    return res.status(400).json({ error: { code: 'MISSING_PASSCODE', message: 'Passcode required' } });
  }

  const bufInput = Buffer.from(passcode.trim(), 'utf-8');
  const bufExpected = Buffer.from(ORGANIZER_PASSCODE, 'utf-8');
  let match = false;
  if (bufInput.length === bufExpected.length && crypto.timingSafeEqual(bufInput, bufExpected)) {
    match = true;
  }

  if (!match) {
    return res.status(401).json({ error: { code: 'INVALID_PASSCODE', message: 'Incorrect organizer passcode' } });
  }

  // 12-hour session expiry
  const expiry = Date.now() + 12 * 60 * 60 * 1000;
  const token = signSessionToken(String(expiry));
  res.cookie('ledger_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 12 * 60 * 60 * 1000,
  });

  res.json({ ok: true, authenticated: true });
});

app.post('/api/auth/logout', (_req: Request, res: Response) => {
  res.clearCookie('ledger_session');
  res.json({ ok: true, authenticated: false });
});

app.get('/api/auth/me', (req: Request, res: Response) => {
  res.json({ authenticated: isOrganizerAuthenticated(req) });
});

app.post('/api/system/reset', requireOrganizer, (req: Request, res: Response) => {
  const rate = checkRateLimit(req, 'reset', { always: true });
  if (!rate.allowed) {
    res.setHeader('Retry-After', rate.retryAfter);
    return res.status(429).json({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many reset attempts',
        details: { retry_after_seconds: rate.retryAfter },
      },
    });
  }

  const adminKey = req.body?.admin_key;
  if (typeof adminKey !== 'string' || !secretEquals(adminKey.trim(), SYSTEM_RESET_KEY)) {
    return res.status(403).json({
      error: { code: 'INVALID_RESET_KEY', message: 'Incorrect admin key' },
    });
  }

  engine.resetToFactoryState();
  try {
    loadSampleSeed();
  } catch (e) {
    console.error('Failed to reload sample_data/attendees.csv after reset', e);
    return res.status(500).json({
      error: { code: 'RESET_SEED_FAILED', message: 'Ledger was cleared but the sample seed could not be reloaded' },
    });
  }

  res.json({ ok: true });
});

// 3. Stats & Branding
app.get('/api/stats', requireOrganizer, (req: Request, res: Response) => {
  const scope = (req.query.scope as 'all' | 'real' | 'demo') || 'all';
  const stats = engine.getStats(scope);
  res.json(stats);
});

app.get('/api/branding', (_req: Request, res: Response) => {
  res.json({
    issuerName: engine['config'].issuerName,
    signatory1Name: engine['config'].signatory1Name,
    signatory1Title: engine['config'].signatory1Title,
    signatory2Name: engine['config'].signatory2Name,
    signatory2Title: engine['config'].signatory2Title,
    publicBaseUrl: PUBLIC_BASE_URL,
  });
});

app.get('/api/meta/problems', requireOrganizer, (_req: Request, res: Response) => {
  res.json(PROBLEM_REGISTRY);
});

// 4. Attendees Management
app.get('/api/attendees', requireOrganizer, (req: Request, res: Response) => {
  const { state, course, cert, q } = req.query as Record<string, string>;
  let list = Array.from(engine.enrollments.values());

  if (state) {
    list = list.filter((e) => e.record_state === state);
  }
  if (course) {
    list = list.filter((e) => e.course_code === course.trim().toUpperCase());
  }
  if (cert) {
    const certEnrollmentIds = new Set(
      Array.from(engine.certificates.values())
        .filter((c) => c.status === cert)
        .map((c) => c.enrollment_id)
    );
    list = list.filter((e) => certEnrollmentIds.has(e.id));
  }
  if (q) {
    const term = q.trim().toLowerCase();
    list = list.filter(
      (e) =>
        e.full_name.toLowerCase().includes(term) ||
        e.email_norm.toLowerCase().includes(term) ||
        e.course_code.toLowerCase().includes(term)
    );
  }

  // Attach certificate details if issued
  const enriched = list.map((e) => {
    let certData: { cert_id: string; status: string; verify_url: string } | null = null;
    for (const c of engine.certificates.values()) {
      if (c.enrollment_id === e.id) {
        const sig = engine['config'].signingKey ? signCertId(c.cert_id, engine['config'].signingKey) : '';
        certData = {
          cert_id: c.cert_id,
          status: c.status,
          verify_url: `${PUBLIC_BASE_URL}/verify/${c.cert_id}?s=${sig}`,
        };
        break;
      }
    }
    return {
      ...e,
      certificate: certData,
    };
  });

  res.json({ attendees: enriched, total: enriched.length });
});

app.get('/api/attendees/export-corrections.csv', requireOrganizer, (req: Request, res: Response) => {
  const course = req.query.course as string | undefined;
  const csv = engine.exportCorrectionsCsv(course);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="needs-correction-attendees.csv"');
  res.send(csv);
});

app.post('/api/attendees', requireOrganizer, (req: Request, res: Response) => {
  const { name, email, course, completion_date, status } = req.body || {};
  const fakeCsv = `name,email,course,completion_date,status\n"${name || ''}","${email || ''}","${course || ''}","${completion_date || ''}","${status || 'completed'}"`;
  const result = engine.commitImport(fakeCsv, 'manual-entry.csv');
  const en = Array.from(engine.enrollments.values()).pop();
  res.status(201).json({ attendee: en, summary: result.summary });
});

app.patch('/api/attendees/:id', requireOrganizer, (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const en = engine.enrollments.get(id);
  if (!en) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Attendee not found' } });
  }

  const { name, email, course, completion_date, status } = req.body;
  if (name !== undefined) en.full_name = String(name).trim();
  if (email !== undefined) en.email_norm = String(email).trim().toLowerCase();
  if (course !== undefined) en.course_code = String(course).trim().toUpperCase();
  if (completion_date !== undefined) en.completion_date = String(completion_date).trim();
  if (status !== undefined) {
    en.completed = ['completed', 'passed', 'yes', 'y', 'true'].includes(String(status).toLowerCase());
  }

  // Reclassify
  const recheck = engine.previewImport(
    `name,email,course,completion_date,status\n"${en.full_name}","${en.email_norm}","${en.course_code}","${en.completion_date || ''}","${en.completed ? 'completed' : 'dropped'}"`
  );
  if (recheck.rows[0]) {
    en.problems = recheck.rows[0].problems;
    en.record_state = recheck.rows[0].problems.length === 0 ? 'ready' : 'needs_correction';
  }
  en.last_import_id = null;
  en.updated_at = new Date().toISOString();

  engine.appendAudit('attendee.patch', 'enrollment', String(en.id), {
    full_name: en.full_name,
    email_norm: en.email_norm,
    record_state: en.record_state,
    problems: en.problems,
  });

  res.json({ attendee: en });
});

app.delete('/api/attendees/:id', requireOrganizer, (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const en = engine.enrollments.get(id);
  if (!en) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Attendee not found' } });
  }

  for (const c of engine.certificates.values()) {
    if (c.enrollment_id === id) {
      return res.status(409).json({
        error: { code: 'CANNOT_DELETE_CERTIFIED', message: 'Cannot delete attendee with an issued certificate' },
      });
    }
  }

  engine.enrollments.delete(id);
  engine.appendAudit('attendee.delete', 'enrollment', String(id), { deleted_email: en.email_norm });
  res.json({ ok: true, deleted_id: id });
});

// 5. Imports & Undo
app.post('/api/imports/preview', requireOrganizer, (req: Request, res: Response) => {
  const csvText = typeof req.body === 'string' ? req.body : req.body?.csv || '';
  const mapping = typeof req.body === 'object' ? req.body.mapping : undefined;
  const result = engine.previewImport(csvText, mapping);
  res.json(result);
});

app.post('/api/imports/commit', requireOrganizer, (req: Request, res: Response) => {
  const csvText = typeof req.body === 'string' ? req.body : req.body?.csv || '';
  const mapping = typeof req.body === 'object' ? req.body.mapping : undefined;
  const filename = (req.body?.filename as string) || 'attendees.csv';
  const result = engine.commitImport(csvText, filename, mapping);
  res.json(result);
});

app.post('/api/imports/:id/undo', requireOrganizer, (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  try {
    const result = engine.undoImport(id);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err });
  }
});

app.get('/api/imports', requireOrganizer, (_req: Request, res: Response) => {
  res.json({ imports: Array.from(engine.imports.values()).reverse() });
});

app.get('/api/imports/:id/rows', requireOrganizer, (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  const rows = Array.from(engine.importRows.values()).filter((r) => r.import_id === id);
  res.json({ rows });
});

// 6. Courses
app.get('/api/courses', requireOrganizer, (_req: Request, res: Response) => {
  res.json({ courses: Array.from(engine.courses.values()) });
});

app.post('/api/courses', requireOrganizer, (req: Request, res: Response) => {
  const { code, title, hours, theme } = req.body || {};
  if (!code || !title) {
    return res.status(422).json({ error: { code: 'INVALID_COURSE', message: 'Code and title are required' } });
  }
  const course = engine.addCourse(code, title, Number(hours || 10), theme || 'classic');
  engine.appendAudit('course.create', 'course', course.code, { title: course.title, theme: course.theme });
  res.status(201).json({ course });
});

app.patch('/api/courses/:code', requireOrganizer, (req: Request, res: Response) => {
  const course = engine.getCourseByCode(req.params.code);
  if (!course) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Course not found' } });
  }
  const { title, hours, theme } = req.body || {};
  if (theme && !['classic', 'modern', 'midnight', 'forest', 'slate'].includes(theme)) {
    return res.status(422).json({ error: { code: 'INVALID_THEME', message: 'Invalid theme name' } });
  }
  if (title) course.title = String(title).trim();
  if (hours !== undefined) course.hours = Number(hours);
  if (theme) course.theme = theme;

  engine.appendAudit('course.update', 'course', course.code, { title: course.title, theme: course.theme });
  res.json({ course });
});

// 7. Certificates Issuance & Revocation
app.post('/api/attendees/:id/issue', requireOrganizer, (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  try {
    const result = engine.issueCertificate(id);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err });
  }
});

app.post('/api/certificates/issue-all', requireOrganizer, (req: Request, res: Response) => {
  const { course, scope = 'real' } = req.body || {};
  const result = engine.issueAll(course, scope);
  res.json(result);
});

app.get('/api/certificates', requireOrganizer, (req: Request, res: Response) => {
  const { course, status, page = '1', limit = '50' } = req.query as Record<string, string>;
  let list = Array.from(engine.certificates.values());

  if (course) {
    const cObj = engine.getCourseByCode(course);
    if (cObj) {
      list = list.filter((c) => c.course_id === cObj.id);
    }
  }
  if (status) {
    list = list.filter((c) => c.status === status);
  }

  const p = Math.max(1, parseInt(page, 10));
  const l = Math.max(1, parseInt(limit, 10));
  const total = list.length;
  const paged = list.slice((p - 1) * l, p * l).map((c) => {
    const person = engine.resolvePerson(c.person_id);
    const courseObj = engine.courses.get(c.course_id);
    const en = engine.enrollments.get(c.enrollment_id);
    const sig = signCertId(c.cert_id, engine['config'].signingKey);
    return {
      ...c,
      holder_name: person.full_name,
      holder_email: person.email_norm,
      course_title: courseObj?.title || '',
      course_code: courseObj?.code || '',
      completion_date: en?.completion_date || '',
      theme: courseObj?.theme || 'classic',
      verify_url: `${PUBLIC_BASE_URL}/verify/${c.cert_id}?s=${sig}`,
    };
  });

  res.json({ certificates: paged, total, page: p, pages: Math.ceil(total / l) });
});

app.get('/api/certificates/:cert_id', requireOrganizer, (req: Request, res: Response) => {
  let cert: any;
  for (const c of engine.certificates.values()) {
    if (c.cert_id === req.params.cert_id.trim().toUpperCase()) {
      cert = c;
      break;
    }
  }
  if (!cert) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Certificate not found' } });
  }

  const person = engine.resolvePerson(cert.person_id);
  const course = engine.courses.get(cert.course_id);
  const en = engine.enrollments.get(cert.enrollment_id);
  const sig = signCertId(cert.cert_id, engine['config'].signingKey);

  // Fetch audit trail for this certificate
  const auditTrail = engine.auditLog.filter((a) => a.entity_id === cert.cert_id);

  res.json({
    certificate: {
      ...cert,
      holder_name: person.full_name,
      holder_email: person.email_norm,
      course_title: course?.title || '',
      course_code: course?.code || '',
      hours: course?.hours,
      completion_date: en?.completion_date || '',
      theme: course?.theme || 'classic',
      verify_url: `${PUBLIC_BASE_URL}/verify/${cert.cert_id}?s=${sig}`,
    },
    audit_trail: auditTrail,
  });
});

app.post('/api/certificates/:cert_id/revoke', requireOrganizer, (req: Request, res: Response) => {
  const { reason } = req.body || {};
  try {
    const revoked = engine.revokeCertificate(req.params.cert_id, reason);
    res.json({ certificate: revoked });
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err });
  }
});

// 8. Public Verification (Rate-Limited)
app.get('/api/verify/:cert_id', (req: Request, res: Response) => {
  const rate = checkRateLimit(req, 'verify');
  res.setHeader('X-RateLimit-Limit', LIMITS.verify.limit);
  res.setHeader('X-RateLimit-Remaining', rate.remaining);

  if (!rate.allowed) {
    res.setHeader('Retry-After', rate.retryAfter);
    return res.status(429).json({
      error: { code: 'RATE_LIMITED', message: 'Too many verification lookups', details: { retry_after_seconds: rate.retryAfter } },
    });
  }

  const certId = req.params.cert_id;
  const sigParam = req.query.s as string | undefined;

  const result = engine.verifyLookup(certId, sigParam);

  // If not found, malformed, or invalid signature, track against notfound bucket
  if (['not_found', 'malformed', 'invalid_signature'].includes(result.status)) {
    checkRateLimit(req, 'notfound');
  }

  res.json(result);
});

// 9. Status Badge SVG (F9)
app.get('/api/verify/:cert_id/badge.svg', (req: Request, res: Response) => {
  const rate = checkRateLimit(req, 'social');
  if (!rate.allowed) {
    res.setHeader('Retry-After', rate.retryAfter);
    return res.status(429).send('Rate limited');
  }

  const certId = req.params.cert_id;
  const result = engine.verifyLookup(certId);

  const isValid = result.status === 'valid';
  const isRevoked = result.status === 'revoked';

  const badgeColor = isValid ? '#10b981' : isRevoked ? '#ef4444' : '#f59e0b';
  const statusLabel = isValid ? 'VALID' : isRevoked ? 'REVOKED' : 'NOT FOUND';
  const courseTitle = (result.course_title || 'Certificate').replace(/[<>&"]/g, '');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="36" viewBox="0 0 280 36">
  <rect width="280" height="36" rx="6" fill="#0f172a" />
  <rect x="0" y="0" width="70" height="36" rx="6" fill="${badgeColor}" />
  <rect x="64" y="0" width="6" height="36" fill="${badgeColor}" />
  <text x="35" y="22" font-family="system-ui, sans-serif" font-size="11" font-weight="700" fill="#ffffff" text-anchor="middle">${statusLabel}</text>
  <text x="80" y="22" font-family="system-ui, sans-serif" font-size="11" fill="#cbd5e1">${courseTitle.slice(0, 24)} (${certId})</text>
</svg>`;

  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.send(svg);
});

// 10. Public Revocation List (F11)
app.get('/api/revocations', (req: Request, res: Response) => {
  const rate = checkRateLimit(req, 'social');
  if (!rate.allowed) {
    res.setHeader('Retry-After', rate.retryAfter);
    return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } });
  }

  const { since, format } = req.query as Record<string, string>;
  let list = Array.from(engine.certificates.values()).filter((c) => c.status === 'revoked');
  if (since) {
    list = list.filter((c) => c.revoked_at && c.revoked_at >= since);
  }

  if (format === 'csv') {
    const csv = 'cert_id,revoked_at\n' + list.map((c) => `${c.cert_id},${c.revoked_at}`).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    return res.send(csv);
  }

  const items = list.map((c) => ({ cert_id: c.cert_id, revoked_at: c.revoked_at }));
  res.json({ revocations: items, total: items.length, generated_at: new Date().toISOString() });
});

// 11. Audit Log & Integrity Verification
app.get('/api/audit', requireOrganizer, (_req: Request, res: Response) => {
  res.json({
    audit_log: engine.auditLog.slice().reverse(),
    checkpoints: engine.auditCheckpoints,
  });
});

app.post('/api/audit/verify', requireOrganizer, (_req: Request, res: Response) => {
  const report = engine.verifyAuditChain();
  res.json(report);
});

// 12. Fuzzy Duplicates Queue & Merge
app.get('/api/duplicates', requireOrganizer, (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  let candidates = Array.from(engine.duplicateCandidates.values());
  if (status) {
    candidates = candidates.filter((c) => c.status === status);
  }
  candidates.sort((a, b) => b.score - a.score);

  const enriched = candidates.map((c) => {
    const pA = engine.people.get(c.person_a_id);
    const pB = engine.people.get(c.person_b_id);
    return {
      ...c,
      person_a: pA,
      person_b: pB,
    };
  });

  res.json({ candidates: enriched, open_count: candidates.filter((c) => c.status === 'open').length });
});

app.post('/api/duplicates/scan', requireOrganizer, (_req: Request, res: Response) => {
  engine.rescanDuplicates();
  res.json({ ok: true, open_count: Array.from(engine.duplicateCandidates.values()).filter((c) => c.status === 'open').length });
});

app.get('/api/duplicates/:id', requireOrganizer, (req: Request, res: Response) => {
  const cand = engine.duplicateCandidates.get(parseInt(req.params.id, 10));
  if (!cand) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Candidate not found' } });
  const pA = engine.people.get(cand.person_a_id);
  const pB = engine.people.get(cand.person_b_id);
  const enA = Array.from(engine.enrollments.values()).filter((e) => e.person_id === cand.person_a_id);
  const enB = Array.from(engine.enrollments.values()).filter((e) => e.person_id === cand.person_b_id);
  res.json({ candidate: cand, person_a: { ...pA, enrollments: enA }, person_b: { ...pB, enrollments: enB } });
});

app.get('/api/duplicates/:id/merge-preview', requireOrganizer, (req: Request, res: Response) => {
  const cand = engine.duplicateCandidates.get(parseInt(req.params.id, 10));
  if (!cand) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Candidate not found' } });
  const survivorId = parseInt(req.query.survivor as string, 10);
  const loserId = survivorId === cand.person_a_id ? cand.person_b_id : cand.person_a_id;

  const survivorEn = Array.from(engine.enrollments.values()).filter((e) => e.person_id === survivorId);
  const loserEn = Array.from(engine.enrollments.values()).filter((e) => e.person_id === loserId);

  // Check conflicts
  const conflicts: Array<{ course_code: string; resolution: string }> = [];
  for (const len of loserEn) {
    const match = survivorEn.find((sen) => sen.course_code === len.course_code);
    if (match) {
      conflicts.push({
        course_code: len.course_code,
        resolution: 'Retain highest eligibility / certified record and re-point duplicate rows',
      });
    }
  }

  res.json({
    survivor_id: survivorId,
    loser_id: loserId,
    conflicts,
    enrollments_to_move: loserEn.length - conflicts.length,
    blocked: false,
  });
});

app.post('/api/duplicates/:id/merge', requireOrganizer, (req: Request, res: Response) => {
  const { survivor_person_id, full_name } = req.body || {};
  try {
    const result = engine.mergeDuplicate(parseInt(req.params.id, 10), Number(survivor_person_id), full_name);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err });
  }
});

app.post('/api/duplicates/:id/dismiss', requireOrganizer, (req: Request, res: Response) => {
  const { note } = req.body || {};
  try {
    const result = engine.dismissDuplicate(parseInt(req.params.id, 10), note);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ error: err });
  }
});

// 13. Guided Demo Mode (F14)
app.get('/api/demo/status', requireOrganizer, (_req: Request, res: Response) => {
  const demoCourses = Array.from(engine.courses.values()).filter((c) => c.is_demo);
  const demoCerts = Array.from(engine.certificates.values()).filter((c) => {
    const crs = engine.courses.get(c.course_id);
    return crs?.is_demo;
  });
  res.json({ loaded: demoCourses.length > 0, demo_courses: demoCourses.length, demo_certificates: demoCerts.length });
});

app.get('/api/demo/csv', requireOrganizer, (req: Request, res: Response) => {
  const variant = req.query.variant === 'modified' ? 'modified' : 'base';
  const assetName = variant === 'modified' ? 'demo_story_modified.csv' : 'demo_story_base.csv';
  const csvPath = path.join(__dirname, 'backend', 'app', 'assets', assetName);
  const content = fs.existsSync(csvPath) ? fs.readFileSync(csvPath, 'utf-8') : '';
  res.setHeader('Content-Type', 'text/csv');
  res.send(content);
});

app.post('/api/demo/load', requireOrganizer, (_req: Request, res: Response) => {
  // Ensure DEMO-101 and DEMO-201 exist
  engine.addCourse('DEMO-101', 'Demo: Foundations of Data', 10.0, 'classic', true);
  engine.addCourse('DEMO-201', 'Demo: Applied Systems Architecture', 15.0, 'modern', true);

  const csvPath = path.join(__dirname, 'backend', 'app', 'assets', 'demo_story_base.csv');
  if (!fs.existsSync(csvPath)) {
    return res.status(500).json({ error: { code: 'FILE_MISSING', message: 'Demo base CSV missing' } });
  }
  const csvText = fs.readFileSync(csvPath, 'utf-8');
  const result = engine.commitImport(csvText, 'demo_story_base.csv', undefined, true);
  res.json(result);
});

app.post('/api/demo/import', requireOrganizer, (req: Request, res: Response) => {
  const variant = req.body?.variant === 'modified' ? 'demo_story_modified.csv' : 'demo_story_base.csv';
  const csvPath = path.join(__dirname, 'backend', 'app', 'assets', variant);
  if (!fs.existsSync(csvPath)) {
    return res.status(500).json({ error: { code: 'FILE_MISSING', message: 'Demo CSV missing' } });
  }
  const csvText = fs.readFileSync(csvPath, 'utf-8');
  const result = engine.commitImport(csvText, variant, undefined, true);
  res.json(result);
});

app.post('/api/demo/reset', requireOrganizer, (_req: Request, res: Response) => {
  // Remove demo data cleanly: demo courses, demo certificates, demo enrollments, demo imports
  const demoCourseIds = new Set(
    Array.from(engine.courses.values())
      .filter((c) => c.is_demo)
      .map((c) => c.id)
  );
  const demoImportIds = new Set(
    Array.from(engine.imports.values())
      .filter((i) => i.is_demo)
      .map((i) => i.id)
  );

  // Delete certificates
  for (const [id, c] of engine.certificates.entries()) {
    if (demoCourseIds.has(c.course_id)) {
      engine.certificates.delete(id);
    }
  }

  // Delete enrollments
  for (const [id, en] of engine.enrollments.entries()) {
    if ((en.course_id && demoCourseIds.has(en.course_id)) || (en.source_import_id && demoImportIds.has(en.source_import_id))) {
      engine.enrollments.delete(id);
    }
  }

  // Delete import rows and imports
  for (const [id, ir] of engine.importRows.entries()) {
    if (demoImportIds.has(ir.import_id)) {
      engine.importRows.delete(id);
    }
  }
  for (const id of demoImportIds) {
    engine.imports.delete(id);
  }

  // Delete demo courses
  for (const id of demoCourseIds) {
    engine.courses.delete(id);
  }

  engine.rescanDuplicates();
  engine.appendAudit('demo.reset', 'demo', 'all', { note: 'Demo data removed' });

  res.json({ ok: true });
});

// ----------------------------------------------------------------------------
// Vite Integration (local only — Vercel serves dist/ and routes /api here)
// ----------------------------------------------------------------------------
export { app };

async function startServer() {
  // Use a computed specifier so bundlers (esbuild/Vercel) do NOT statically
  // follow this import — Vite is a devDependency, absent in the serverless bundle.
  const viteModule = 'vite';
  const { createServer: createViteServer } = await import(/* @vite-ignore */ viteModule);
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });

  app.use(vite.middlewares);

  const distIndex = path.join(__dirname, 'dist', 'index.html');
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (process.env.NODE_ENV !== 'production') return next();
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api')) return next();
    if (!fs.existsSync(distIndex)) return next();
    res.sendFile(distIndex);
  });

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Certificate Ledger server running at http://0.0.0.0:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
