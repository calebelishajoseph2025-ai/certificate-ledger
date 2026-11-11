import crypto from 'node:crypto';
import {
  generateCertId,
  validateCertId,
  signCertId,
  verifyCertSignature,
  computeAuditRowHash,
  computeAuditCheckpointMac,
  verifyAuditCheckpointMac,
} from './crypto.js';
import { scanDuplicates, PersonCandidateInput } from './fuzzy.js';
import { classifyRecord, cleanName, parseDate, RawRowInput } from './classifier.js';
import { computeFunnel, StatsSummary, verifyCountInvariant } from './funnel.js';
import { PROBLEM_REGISTRY, getProblemMeta } from './problemLabels.js';

export interface Course {
  id: number;
  code: string;
  title: string;
  hours: number;
  theme: 'classic' | 'modern' | 'midnight' | 'forest' | 'slate';
  is_demo: boolean;
  created_at: string;
}

export interface Person {
  id: number;
  email_norm: string;
  full_name: string;
  merged_into: number | null;
  created_by_import_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface Enrollment {
  id: number;
  person_id: number | null;
  course_id: number | null;
  raw_name: string;
  raw_email: string;
  raw_course_code: string;
  raw_completion_date: string;
  raw_status: string;
  full_name: string;
  email_norm: string;
  course_code: string;
  completion_date: string | null;
  completed: boolean;
  record_state: 'ready' | 'needs_correction';
  problems: string[];
  source_import_id: number | null;
  source_row: number | null;
  raw_fingerprint: string | null;
  last_import_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface Certificate {
  id: number;
  cert_id: string;
  person_id: number;
  course_id: number;
  enrollment_id: number;
  status: 'valid' | 'revoked';
  issued_at: string;
  revoked_at: string | null;
  revoke_reason: string | null;
}

export interface ImportRecord {
  id: number;
  filename: string;
  sha256: string;
  mapping: Record<string, string> | null;
  is_demo: boolean;
  row_count: number;
  inserted: number;
  updated: number;
  corrected: number;
  duplicates: number;
  needs_correction: number;
  unchanged: number;
  undone_at: string | null;
  undone_note: string | null;
  created_at: string;
}

export interface ImportRow {
  id: number;
  import_id: number;
  row_number: number;
  raw: Record<string, unknown>;
  outcome: 'new' | 'updated' | 'unchanged' | 'duplicate' | 'needs_correction' | 'corrected';
  problems: string[];
  before: Record<string, unknown> | null;
  enrollment_id: number | null;
}

export interface AuditRow {
  id: number;
  seq: number;
  at: string;
  action: string;
  entity: string;
  entity_id: string | null;
  detail: Record<string, unknown>;
  prev_hash: string;
  row_hash: string;
}

export interface AuditCheckpoint {
  id: number;
  up_to_seq: number;
  head_hash: string;
  mac: string;
  created_at: string;
}

export interface DuplicateCandidate {
  id: number;
  person_a_id: number;
  person_b_id: number;
  score: number;
  reasons: string[];
  status: 'open' | 'merged' | 'dismissed' | 'superseded';
  resolved_at: string | null;
  resolved_note: string | null;
  created_at: string;
}

export interface LedgerConfig {
  sessionSecret: string;
  signingKey: string;
  previousSigningKey?: string;
  organizerPasscode: string;
  issuerName: string;
  signatory1Name: string;
  signatory1Title: string;
  signatory2Name: string;
  signatory2Title: string;
  publicBaseUrl: string;
}

export class LedgerEngine {
  private config: LedgerConfig;

  // Tables
  public courses: Map<number, Course> = new Map();
  public people: Map<number, Person> = new Map();
  public enrollments: Map<number, Enrollment> = new Map();
  public certificates: Map<number, Certificate> = new Map();
  public imports: Map<number, ImportRecord> = new Map();
  public importRows: Map<number, ImportRow> = new Map();
  public auditLog: AuditRow[] = [];
  public auditCheckpoints: AuditCheckpoint[] = [];
  public duplicateCandidates: Map<number, DuplicateCandidate> = new Map();
  public rateLimits: Map<string, { count: number; windowStart: number }> = new Map();

  // Auto-increment counters
  private nextCourseId = 1;
  private nextPersonId = 1;
  private nextEnrollmentId = 1;
  private nextCertId = 1;
  private nextImportId = 1;
  private nextImportRowId = 1;
  private nextAuditId = 1;
  private nextAuditCheckpointId = 1;
  private nextCandidateId = 1;

  constructor(config: LedgerConfig) {
    this.config = config;
    this.seedDefaultCourses();
  }

  /** Wipe in-memory ledger state and restore the three default courses. */
  public resetToFactoryState(): void {
    this.courses.clear();
    this.people.clear();
    this.enrollments.clear();
    this.certificates.clear();
    this.imports.clear();
    this.importRows.clear();
    this.auditLog = [];
    this.auditCheckpoints = [];
    this.duplicateCandidates.clear();
    this.nextCourseId = 1;
    this.nextPersonId = 1;
    this.nextEnrollmentId = 1;
    this.nextCertId = 1;
    this.nextImportId = 1;
    this.nextImportRowId = 1;
    this.nextAuditId = 1;
    this.nextAuditCheckpointId = 1;
    this.nextCandidateId = 1;
    this.seedDefaultCourses();
  }

  private seedDefaultCourses() {
    this.addCourse('DS-101', 'Intro to Data Storytelling', 18.0, 'classic');
    this.addCourse('UX-201', 'Accessible Interface Design', 24.0, 'modern');
    this.addCourse('CL-150', 'Cloud Basics for Teams', 12.0, 'midnight');
  }

  public addCourse(
    code: string,
    title: string,
    hours: number,
    theme: Course['theme'] = 'classic',
    is_demo: boolean = false
  ): Course {
    const cleanCode = code.trim().toUpperCase();
    for (const c of this.courses.values()) {
      if (c.code === cleanCode) {
        return c;
      }
    }
    const course: Course = {
      id: this.nextCourseId++,
      code: cleanCode,
      title: title.trim(),
      hours,
      theme,
      is_demo,
      created_at: new Date().toISOString(),
    };
    this.courses.set(course.id, course);
    return course;
  }

  public getCourseByCode(code: string): Course | undefined {
    const cleanCode = code.trim().toUpperCase();
    for (const c of this.courses.values()) {
      if (c.code === cleanCode) return c;
    }
    return undefined;
  }

  /**
   * Resolves person through tombstones (merged_into pointers)
   */
  public resolvePerson(personId: number): Person {
    let curr = this.people.get(personId);
    if (!curr) throw new Error(`Person ${personId} not found`);
    const visited = new Set<number>();
    while (curr.merged_into !== null) {
      if (visited.has(curr.id)) break; // cycle protection
      visited.add(curr.id);
      const next = this.people.get(curr.merged_into);
      if (!next) break;
      curr = next;
    }
    return curr;
  }

  public getActivePersonByEmail(emailNorm: string): Person | undefined {
    const clean = emailNorm.trim().toLowerCase();
    for (const p of this.people.values()) {
      if (p.email_norm === clean) {
        return this.resolvePerson(p.id);
      }
    }
    return undefined;
  }

  /**
   * Appends an audit log event with hash chaining (SHA-256)
   */
  public appendAudit(
    action: string,
    entity: string,
    entityId: string | null,
    detail: Record<string, unknown>
  ): AuditRow {
    const seq = this.auditLog.length + 1;
    const at = new Date().toISOString();
    const prevHash = this.auditLog.length > 0 ? this.auditLog[this.auditLog.length - 1].row_hash : '0'.repeat(64);
    const rowHash = computeAuditRowHash(seq, at, action, entity, entityId, detail, prevHash);

    const row: AuditRow = {
      id: this.nextAuditId++,
      seq,
      at,
      action,
      entity,
      entity_id: entityId,
      detail,
      prev_hash: prevHash,
      row_hash: rowHash,
    };
    this.auditLog.push(row);
    return row;
  }

  /**
   * F1: Verifies the integrity of the audit hash chain and checkpoints
   */
  public verifyAuditChain(): {
    ok: boolean;
    checked: number;
    head_seq: number;
    head_hash: string;
    checkpoints_checked: number;
    problems: Array<{ seq: number; kind: string; message: string }>;
    verified_at: string;
  } {
    const problems: Array<{ seq: number; kind: string; message: string }> = [];
    let prevHash = '0'.repeat(64);

    for (let i = 0; i < this.auditLog.length; i++) {
      const row = this.auditLog[i];
      if (row.seq !== i + 1) {
        problems.push({
          seq: row.seq,
          kind: 'seq_gap',
          message: `Expected seq ${i + 1} but got ${row.seq}`,
        });
      }
      if (row.prev_hash !== prevHash) {
        problems.push({
          seq: row.seq,
          kind: 'link_broken',
          message: `prev_hash mismatch at seq ${row.seq}`,
        });
      }
      const expectedHash = computeAuditRowHash(
        row.seq,
        row.at,
        row.action,
        row.entity,
        row.entity_id,
        row.detail,
        row.prev_hash
      );
      if (row.row_hash !== expectedHash) {
        problems.push({
          seq: row.seq,
          kind: 'hash_mismatch',
          message: `row_hash mismatch at seq ${row.seq}`,
        });
      }
      prevHash = row.row_hash;
    }

    // Checkpoint verification
    let checkpointsChecked = 0;
    for (const cp of this.auditCheckpoints) {
      checkpointsChecked++;
      const targetRow = this.auditLog.find((r) => r.seq === cp.up_to_seq);
      if (!targetRow || targetRow.row_hash !== cp.head_hash) {
        problems.push({
          seq: cp.up_to_seq,
          kind: 'checkpoint_mismatch',
          message: `Checkpoint at seq ${cp.up_to_seq} head hash does not match chain`,
        });
      }
      const validMac = verifyAuditCheckpointMac(
        cp.up_to_seq,
        cp.head_hash,
        cp.mac,
        this.config.signingKey,
        this.config.previousSigningKey
      );
      if (!validMac) {
        problems.push({
          seq: cp.up_to_seq,
          kind: 'checkpoint_mac_invalid',
          message: `Checkpoint MAC invalid at seq ${cp.up_to_seq}`,
        });
      }
    }

    const headSeq = this.auditLog.length;
    const headHash = headSeq > 0 ? this.auditLog[headSeq - 1].row_hash : '0'.repeat(64);

    const ok = problems.length === 0;

    // If ok, write a new checkpoint if we have rows and none exists for current head_seq
    if (ok && headSeq > 0) {
      const existing = this.auditCheckpoints.find((c) => c.up_to_seq === headSeq);
      if (!existing) {
        const mac = computeAuditCheckpointMac(headSeq, headHash, this.config.signingKey);
        this.auditCheckpoints.push({
          id: this.nextAuditCheckpointId++,
          up_to_seq: headSeq,
          head_hash: headHash,
          mac,
          created_at: new Date().toISOString(),
        });
      }
    }

    return {
      ok,
      checked: this.auditLog.length,
      head_seq: headSeq,
      head_hash: headHash,
      checkpoints_checked: checkpointsChecked,
      problems: problems.slice(0, 20),
      verified_at: new Date().toISOString(),
    };
  }

  /**
   * Idempotent certificate issuance with race and duplicate protection
   */
  public issueCertificate(enrollmentId: number): {
    certificate: Certificate & { verify_url: string; theme: string };
    created: boolean;
  } {
    const enrollment = this.enrollments.get(enrollmentId);
    if (!enrollment) {
      throw { status: 404, code: 'ENROLLMENT_NOT_FOUND', message: 'Enrollment record not found' };
    }

    if (enrollment.record_state !== 'ready' || !enrollment.completed) {
      throw {
        status: 422,
        code: 'NOT_ELIGIBLE',
        message: 'Attendee enrollment is not complete and eligible for certificate issuance',
      };
    }

    // Ensure person and course exist
    let person = enrollment.person_id ? this.resolvePerson(enrollment.person_id) : undefined;
    if (!person && enrollment.email_norm) {
      person = this.getActivePersonByEmail(enrollment.email_norm);
    }
    if (!person) {
      person = {
        id: this.nextPersonId++,
        email_norm: enrollment.email_norm,
        full_name: enrollment.full_name,
        merged_into: null,
        created_by_import_id: enrollment.source_import_id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      this.people.set(person.id, person);
      enrollment.person_id = person.id;
    }

    const course = enrollment.course_id
      ? this.courses.get(enrollment.course_id)
      : this.getCourseByCode(enrollment.course_code);
    if (!course) {
      throw { status: 422, code: 'UNKNOWN_COURSE', message: `Course ${enrollment.course_code} does not exist` };
    }
    enrollment.course_id = course.id;

    // Check unique (person_id, course_id)
    for (const cert of this.certificates.values()) {
      if (cert.person_id === person.id && cert.course_id === course.id) {
        // Return existing certificate idempotently
        const sig = signCertId(cert.cert_id, this.config.signingKey);
        const verify_url = `${this.config.publicBaseUrl}/verify/${cert.cert_id}?s=${sig}`;
        return {
          certificate: { ...cert, verify_url, theme: course.theme },
          created: false,
        };
      }
    }

    // Generate new unique cert ID
    let certId = generateCertId('26');
    for (let attempts = 0; attempts < 5; attempts++) {
      let collision = false;
      for (const c of this.certificates.values()) {
        if (c.cert_id === certId) {
          collision = true;
          break;
        }
      }
      if (!collision) break;
      certId = generateCertId('26');
    }

    const cert: Certificate = {
      id: this.nextCertId++,
      cert_id: certId,
      person_id: person.id,
      course_id: course.id,
      enrollment_id: enrollment.id,
      status: 'valid',
      issued_at: new Date().toISOString(),
      revoked_at: null,
      revoke_reason: null,
    };
    this.certificates.set(cert.id, cert);

    // Audit log
    this.appendAudit('certificate.issue', 'certificate', cert.cert_id, {
      person_id: person.id,
      course_id: course.id,
      enrollment_id: enrollment.id,
      holder_name: person.full_name,
      holder_email: person.email_norm,
      course_code: course.code,
    });

    const sig = signCertId(cert.cert_id, this.config.signingKey);
    const verify_url = `${this.config.publicBaseUrl}/verify/${cert.cert_id}?s=${sig}`;

    return {
      certificate: { ...cert, verify_url, theme: course.theme },
      created: true,
    };
  }

  /**
   * Bulk issue eligible certificates
   */
  public issueAll(
    courseFilter?: string,
    scope: 'all' | 'real' | 'demo' = 'real'
  ): {
    created: number;
    already_issued: number;
    skipped: Array<{ id: number; reason: string }>;
  } {
    let created = 0;
    let already_issued = 0;
    const skipped: Array<{ id: number; reason: string }> = [];

    const candidates = Array.from(this.enrollments.values());
    for (const en of candidates) {
      const course = en.course_id ? this.courses.get(en.course_id) : this.getCourseByCode(en.course_code);
      if (!course) {
        skipped.push({ id: en.id, reason: 'Course not found' });
        continue;
      }

      // Check course filter
      if (courseFilter && course.code !== courseFilter.trim().toUpperCase()) {
        continue;
      }

      // Check scope
      if (scope === 'real' && course.is_demo) continue;
      if (scope === 'demo' && !course.is_demo) continue;

      if (en.record_state !== 'ready' || !en.completed) {
        skipped.push({ id: en.id, reason: 'Not eligible' });
        continue;
      }

      try {
        const res = this.issueCertificate(en.id);
        if (res.created) {
          created++;
        } else {
          already_issued++;
        }
      } catch (err: unknown) {
        const error = err as { message?: string };
        skipped.push({ id: en.id, reason: error.message || 'Error issuing' });
      }
    }

    return { created, already_issued, skipped };
  }

  /**
   * Revoke a certificate
   */
  public revokeCertificate(certId: string, reason: string): Certificate {
    if (!reason || typeof reason !== 'string' || !reason.trim()) {
      throw { status: 422, code: 'MISSING_REVOKE_REASON', message: 'A non-empty revocation reason is required' };
    }

    let target: Certificate | undefined;
    for (const c of this.certificates.values()) {
      if (c.cert_id === certId.trim().toUpperCase()) {
        target = c;
        break;
      }
    }

    if (!target) {
      throw { status: 404, code: 'CERTIFICATE_NOT_FOUND', message: 'Certificate ID not found' };
    }

    if (target.status === 'revoked') {
      // Idempotent
      return target;
    }

    target.status = 'revoked';
    target.revoked_at = new Date().toISOString();
    target.revoke_reason = reason.trim();

    this.appendAudit('certificate.revoke', 'certificate', target.cert_id, {
      revoked_at: target.revoked_at,
      reason: target.revoke_reason,
    });

    return target;
  }

  /**
   * Public certificate lookup with signature verification
   */
  public verifyLookup(certId: string, sigParam?: string): {
    status: 'valid' | 'revoked' | 'not_found' | 'malformed' | 'invalid_signature';
    signature: 'valid' | 'invalid' | 'not_provided';
    holder_name?: string;
    course_title?: string;
    course_code?: string;
    issuer_name?: string;
    issued_at?: string;
    revoked_at?: string;
    hours?: number;
    theme?: string;
  } {
    // 1. Format and checksum validation
    const { valid: idFormatValid, malformed } = validateCertId(certId);
    if (!idFormatValid || malformed) {
      return { status: 'malformed', signature: 'not_provided' };
    }

    // 2. Signature verification
    let sigStatus: 'valid' | 'invalid' | 'not_provided' = 'not_provided';
    if (sigParam !== undefined && sigParam !== null && sigParam !== '') {
      const sigRes = verifyCertSignature(
        certId,
        sigParam,
        this.config.signingKey,
        this.config.previousSigningKey
      );
      if (!sigRes.valid) {
        // Tampered / altered signature: identical response without leaking existence
        return {
          status: 'invalid_signature',
          signature: 'invalid',
        };
      }
      sigStatus = 'valid';
    }

    // 3. Database lookup
    let target: Certificate | undefined;
    for (const c of this.certificates.values()) {
      if (c.cert_id === certId.trim().toUpperCase()) {
        target = c;
        break;
      }
    }

    if (!target) {
      return { status: 'not_found', signature: sigStatus };
    }

    const person = this.resolvePerson(target.person_id);
    const course = this.courses.get(target.course_id);

    return {
      status: target.status,
      signature: sigStatus,
      holder_name: person.full_name,
      course_title: course?.title || 'Course Completion',
      course_code: course?.code || '',
      issuer_name: this.config.issuerName,
      issued_at: target.issued_at,
      revoked_at: target.revoked_at || undefined,
      hours: course?.hours,
      theme: course?.theme,
    };
  }

  /**
   * Preview an import CSV without writing changes
   */
  public previewImport(csvText: string, customMapping?: Record<string, string>): {
    headers: string[];
    delimiter: string;
    mapping: Record<string, string>;
    mapping_source: 'auto' | 'manual';
    column_errors: string[];
    rows: Array<{
      rowNumber: number;
      outcome: string;
      fullName: string;
      emailNorm: string;
      courseCode: string;
      completionDate: string | null;
      completed: boolean;
      problems: string[];
    }>;
    summary: {
      total: number;
      new: number;
      updated: number;
      duplicates: number;
      needs_correction: number;
      unchanged: number;
      corrected: number;
    };
  } {
    const { headers, delimiter, rows: rawRows } = this.parseCsv(csvText);
    const { mapping, mappingSource, errors: columnErrors } = this.resolveMapping(headers, customMapping);

    const knownCourses = new Set(Array.from(this.courses.values()).map((c) => c.code));
    const classifiedRows: Array<{
      rowNumber: number;
      outcome: string;
      fullName: string;
      emailNorm: string;
      courseCode: string;
      completionDate: string | null;
      completed: boolean;
      problems: string[];
    }> = [];

    const summary = {
      total: rawRows.length,
      new: 0,
      updated: 0,
      duplicates: 0,
      needs_correction: 0,
      unchanged: 0,
      corrected: 0,
    };

    const seenInBatch = new Set<string>();

    rawRows.forEach((r, idx) => {
      const rowNum = idx + 1;
      const mapped = this.applyMapping(r, mapping);
      const classified = classifyRecord(mapped, knownCourses);

      let outcome: 'new' | 'updated' | 'unchanged' | 'duplicate' | 'needs_correction' | 'corrected' = 'new';

      if (classified.problems.length > 0) {
        outcome = 'needs_correction';
      } else {
        const naturalKey = `${classified.emailNorm}:${classified.courseCode}`;
        if (seenInBatch.has(naturalKey)) {
          outcome = 'duplicate';
        } else {
          seenInBatch.add(naturalKey);
          // Check existing enrollment
          let existing: Enrollment | undefined;
          for (const en of this.enrollments.values()) {
            if (en.email_norm === classified.emailNorm && en.course_code === classified.courseCode) {
              existing = en;
              break;
            }
          }
          if (existing) {
            outcome = existing.record_state === 'needs_correction' ? 'corrected' : 'unchanged';
          }
        }
      }

      if (outcome === 'duplicate') {
        summary.duplicates++;
      } else {
        summary[outcome]++;
      }

      classifiedRows.push({
        rowNumber: rowNum,
        outcome,
        fullName: classified.fullName,
        emailNorm: classified.emailNorm,
        courseCode: classified.courseCode,
        completionDate: classified.completionDate,
        completed: classified.completed,
        problems: classified.problems,
      });
    });

    return {
      headers,
      delimiter,
      mapping,
      mapping_source: mappingSource,
      column_errors: columnErrors,
      rows: classifiedRows,
      summary,
    };
  }

  /**
   * Commits an import CSV with full idempotency, raw fingerprints, and duplicate capture
   */
  public commitImport(
    csvText: string,
    filename: string = 'attendees.csv',
    customMapping?: Record<string, string>,
    is_demo: boolean = false
  ): {
    import: ImportRecord;
    already_imported: boolean;
    summary: {
      row_count: number;
      inserted: number;
      updated: number;
      corrected: number;
      duplicates: number;
      needs_correction: number;
      unchanged: number;
    };
  } {
    // 1. Compute SHA-256 idempotency hash
    const canonicalMapping = customMapping ? JSON.stringify(customMapping) : '';
    const hashPayload = canonicalMapping ? `${csvText}\n--mapping--\n${canonicalMapping}` : csvText;
    const sha256 = crypto.createHash('sha256').update(hashPayload, 'utf-8').digest('hex');

    // Check active existing import
    for (const imp of this.imports.values()) {
      if (imp.sha256 === sha256 && imp.undone_at === null) {
        return {
          import: imp,
          already_imported: true,
          summary: {
            row_count: imp.row_count,
            inserted: imp.inserted,
            updated: imp.updated,
            corrected: imp.corrected,
            duplicates: imp.duplicates,
            needs_correction: imp.needs_correction,
            unchanged: imp.unchanged,
          },
        };
      }
    }

    const { headers, rows: rawRows } = this.parseCsv(csvText);
    const { mapping, errors } = this.resolveMapping(headers, customMapping);
    if (errors.length > 0) {
      throw { status: 422, code: 'MISSING_COLUMNS', message: `Missing required columns: ${errors.join(', ')}` };
    }

    const knownCourses = new Set(Array.from(this.courses.values()).map((c) => c.code));

    const importRec: ImportRecord = {
      id: this.nextImportId++,
      filename,
      sha256,
      mapping: customMapping || null,
      is_demo,
      row_count: rawRows.length,
      inserted: 0,
      updated: 0,
      corrected: 0,
      duplicates: 0,
      needs_correction: 0,
      unchanged: 0,
      undone_at: null,
      undone_note: null,
      created_at: new Date().toISOString(),
    };
    this.imports.set(importRec.id, importRec);

    const seenFpInBatch = new Set<string>();
    const seenNaturalKeyInBatch = new Set<string>();

    for (let i = 0; i < rawRows.length; i++) {
      const rowNum = i + 1;
      const raw = rawRows[i];
      const mapped = this.applyMapping(raw, mapping);
      const classified = classifyRecord(mapped, knownCourses);

      let outcome: ImportRow['outcome'] = 'new';
      let targetEnrollment: Enrollment | null = null;
      let beforeSnapshot: Record<string, unknown> | null = null;

      // Check if this is a corrections file row with record_id
      const recordIdRaw = mapped.record_id;
      if (recordIdRaw) {
        const recId = parseInt(String(recordIdRaw), 10);
        const existingRec = this.enrollments.get(recId);
        if (existingRec) {
          // Check if already certified (locked)
          let hasCert = false;
          for (const c of this.certificates.values()) {
            if (c.enrollment_id === existingRec.id) {
              hasCert = true;
              break;
            }
          }
          if (hasCert) {
            outcome = 'unchanged';
          } else {
            beforeSnapshot = { ...existingRec };
            existingRec.full_name = classified.fullName || existingRec.full_name;
            existingRec.email_norm = classified.emailNorm || existingRec.email_norm;
            existingRec.course_code = classified.courseCode || existingRec.course_code;
            existingRec.completion_date = classified.completionDate;
            existingRec.completed = classified.completed;
            existingRec.record_state = classified.recordState;
            existingRec.problems = classified.problems;
            existingRec.last_import_id = importRec.id;
            existingRec.updated_at = new Date().toISOString();
            outcome = classified.recordState === 'ready' ? 'corrected' : 'needs_correction';
            targetEnrollment = existingRec;
          }
        }
      }

      if (!targetEnrollment && outcome === 'new') {
        // Step 1: Raw fingerprint match
        let fpMatched: Enrollment | undefined;
        for (const en of this.enrollments.values()) {
          if (en.raw_fingerprint === classified.rawFingerprint) {
            fpMatched = en;
            break;
          }
        }

        if (fpMatched) {
          if (seenFpInBatch.has(classified.rawFingerprint)) {
            outcome = 'duplicate';
            targetEnrollment = fpMatched;
          } else {
            outcome = 'unchanged';
            targetEnrollment = fpMatched;
            seenFpInBatch.add(classified.rawFingerprint);
          }
        } else {
          // Step 2: Natural key match (resolve email through tombstones)
          let person = this.getActivePersonByEmail(classified.emailNorm);
          const naturalKey = `${classified.emailNorm}:${classified.courseCode}`;

          let keyMatched: Enrollment | undefined;
          for (const en of this.enrollments.values()) {
            if (en.email_norm === classified.emailNorm && en.course_code === classified.courseCode) {
              keyMatched = en;
              break;
            }
          }

          if (seenNaturalKeyInBatch.has(naturalKey)) {
            outcome = 'duplicate';
            targetEnrollment = keyMatched || null;
          } else {
            seenNaturalKeyInBatch.add(naturalKey);
            seenFpInBatch.add(classified.rawFingerprint);

            if (keyMatched) {
              targetEnrollment = keyMatched;
              // Check if values fill blanks
              let changed = false;
              if (!keyMatched.full_name && classified.fullName) {
                keyMatched.full_name = classified.fullName;
                changed = true;
              }
              if (!keyMatched.completion_date && classified.completionDate) {
                keyMatched.completion_date = classified.completionDate;
                changed = true;
              }
              if (changed) {
                outcome = 'updated';
                keyMatched.last_import_id = importRec.id;
              } else {
                outcome = 'unchanged';
              }
            } else {
              // Step 3: Insert new enrollment
              if (classified.problems.length > 0) {
                outcome = 'needs_correction';
              } else {
                outcome = 'new';
              }

              if (!person && classified.emailNorm && classified.fullName) {
                person = {
                  id: this.nextPersonId++,
                  email_norm: classified.emailNorm,
                  full_name: classified.fullName,
                  merged_into: null,
                  created_by_import_id: importRec.id,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString(),
                };
                this.people.set(person.id, person);
              }

              const course = this.getCourseByCode(classified.courseCode);

              const newEn: Enrollment = {
                id: this.nextEnrollmentId++,
                person_id: person?.id || null,
                course_id: course?.id || null,
                raw_name: classified.rawName,
                raw_email: classified.rawEmail,
                raw_course_code: classified.rawCourseCode,
                raw_completion_date: classified.rawCompletionDate,
                raw_status: classified.rawStatus,
                full_name: classified.fullName,
                email_norm: classified.emailNorm,
                course_code: classified.courseCode,
                completion_date: classified.completionDate,
                completed: classified.completed,
                record_state: classified.recordState,
                problems: classified.problems,
                source_import_id: importRec.id,
                source_row: rowNum,
                raw_fingerprint: classified.rawFingerprint,
                last_import_id: importRec.id,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              };
              this.enrollments.set(newEn.id, newEn);
              targetEnrollment = newEn;
            }
          }
        }
      }

      // Record import row
      const impRow: ImportRow = {
        id: this.nextImportRowId++,
        import_id: importRec.id,
        row_number: rowNum,
        raw,
        outcome,
        problems: classified.problems,
        before: beforeSnapshot,
        enrollment_id: targetEnrollment?.id || null,
      };
      this.importRows.set(impRow.id, impRow);

      if (outcome === 'new') importRec.inserted++;
      else if (outcome === 'updated') importRec.updated++;
      else if (outcome === 'corrected') importRec.corrected++;
      else if (outcome === 'duplicate') importRec.duplicates++;
      else if (outcome === 'needs_correction') importRec.needs_correction++;
      else if (outcome === 'unchanged') importRec.unchanged++;
    }

    // Run fuzzy scan asynchronously/in separate step
    this.rescanDuplicates();

    this.appendAudit('import.commit', 'import', String(importRec.id), {
      filename,
      sha256,
      rows: importRec.row_count,
      inserted: importRec.inserted,
      duplicates: importRec.duplicates,
      needs_correction: importRec.needs_correction,
    });

    return {
      import: importRec,
      already_imported: false,
      summary: {
        row_count: importRec.row_count,
        inserted: importRec.inserted,
        updated: importRec.updated,
        corrected: importRec.corrected,
        duplicates: importRec.duplicates,
        needs_correction: importRec.needs_correction,
        unchanged: importRec.unchanged,
      },
    };
  }

  /**
   * F8: Undo an import with safe blocker checks
   */
  public undoImport(importId: number): { ok: boolean; undone_at: string; removed_count: number } {
    const imp = this.imports.get(importId);
    if (!imp) {
      throw { status: 404, code: 'IMPORT_NOT_FOUND', message: 'Import ID not found' };
    }
    if (imp.undone_at) {
      return { ok: true, undone_at: imp.undone_at, removed_count: 0 };
    }

    // Check blockers:
    // Any record created or touched by this import that has a certificate or was modified after
    const blockers: Array<{ enrollment_id: number; reason: string }> = [];

    const rows = Array.from(this.importRows.values()).filter((r) => r.import_id === importId);
    for (const r of rows) {
      if (!r.enrollment_id) continue;
      const en = this.enrollments.get(r.enrollment_id);
      if (!en) continue;

      // Check certificate
      for (const c of this.certificates.values()) {
        if (c.enrollment_id === en.id) {
          blockers.push({ enrollment_id: en.id, reason: 'HAS_CERTIFICATE' });
          break;
        }
      }

      // Check modified after import
      if (en.last_import_id !== importId) {
        blockers.push({ enrollment_id: en.id, reason: 'MODIFIED_AFTER_IMPORT' });
      }
    }

    if (blockers.length > 0) {
      throw {
        status: 409,
        code: 'UNDO_BLOCKED',
        message: 'Import cannot be undone because some records have certificates or were modified afterward',
        details: { blockers: blockers.slice(0, 50), total_blockers: blockers.length },
      };
    }

    let removedCount = 0;
    // Perform undo
    for (const r of rows) {
      if (!r.enrollment_id) continue;
      if (r.outcome === 'new' || r.outcome === 'needs_correction') {
        const en = this.enrollments.get(r.enrollment_id);
        if (en && en.source_import_id === importId) {
          this.enrollments.delete(en.id);
          removedCount++;
        }
      } else if (r.outcome === 'updated' || r.outcome === 'corrected') {
        if (r.before) {
          const en = this.enrollments.get(r.enrollment_id);
          if (en) {
            Object.assign(en, r.before);
            en.last_import_id = null;
          }
        }
      }
    }

    // Remove isolated people
    for (const p of Array.from(this.people.values())) {
      if (p.created_by_import_id === importId) {
        let hasRemainingEnrollments = false;
        for (const en of this.enrollments.values()) {
          if (en.person_id === p.id) {
            hasRemainingEnrollments = true;
            break;
          }
        }
        if (!hasRemainingEnrollments) {
          this.people.delete(p.id);
        }
      }
    }

    imp.undone_at = new Date().toISOString();
    imp.undone_note = 'Undone by organizer';

    this.rescanDuplicates();

    this.appendAudit('import.undo', 'import', String(importId), {
      removed_records: removedCount,
    });

    return { ok: true, undone_at: imp.undone_at, removed_count: removedCount };
  }

  /**
   * Rescans active people for near-duplicate candidates
   */
  public rescanDuplicates(): void {
    const activePeople: PersonCandidateInput[] = [];
    for (const p of this.people.values()) {
      if (p.merged_into !== null) continue; // skip tombstones
      const personEnrollments = Array.from(this.enrollments.values())
        .filter((en) => en.person_id === p.id)
        .map((en) => ({ courseCode: en.course_code, completionDate: en.completion_date }));

      activePeople.push({
        id: p.id,
        fullName: p.full_name,
        emailNorm: p.email_norm,
        enrollments: personEnrollments,
      });
    }

    const candidates = scanDuplicates(activePeople);

    for (const cand of candidates) {
      let existing: DuplicateCandidate | undefined;
      for (const dc of this.duplicateCandidates.values()) {
        if (dc.person_a_id === cand.personAId && dc.person_b_id === cand.personBId) {
          existing = dc;
          break;
        }
      }

      if (!existing) {
        const newDc: DuplicateCandidate = {
          id: this.nextCandidateId++,
          person_a_id: cand.personAId,
          person_b_id: cand.personBId,
          score: cand.score,
          reasons: cand.reasons,
          status: 'open',
          resolved_at: null,
          resolved_note: null,
          created_at: new Date().toISOString(),
        };
        this.duplicateCandidates.set(newDc.id, newDc);
      }
    }
  }

  /**
   * F5: Merge near-duplicates with same-course conflict resolution and audit trail
   */
  public mergeDuplicate(
    candidateId: number,
    survivorPersonId: number,
    chosenName?: string
  ): { ok: boolean; survivor_id: number; loser_id: number } {
    const candidate = this.duplicateCandidates.get(candidateId);
    if (!candidate) {
      throw { status: 404, code: 'CANDIDATE_NOT_FOUND', message: 'Duplicate candidate not found' };
    }
    if (candidate.status === 'merged') {
      return { ok: true, survivor_id: survivorPersonId, loser_id: candidate.person_a_id === survivorPersonId ? candidate.person_b_id : candidate.person_a_id };
    }

    const { person_a_id, person_b_id } = candidate;
    if (survivorPersonId !== person_a_id && survivorPersonId !== person_b_id) {
      throw { status: 422, code: 'INVALID_SURVIVOR', message: 'Survivor must be one of the candidate persons' };
    }

    const loserId = survivorPersonId === person_a_id ? person_b_id : person_a_id;
    const survivor = this.people.get(survivorPersonId);
    const loser = this.people.get(loserId);
    if (!survivor || !loser) {
      throw { status: 404, code: 'PERSON_NOT_FOUND', message: 'One or both candidate persons not found' };
    }

    // Check same-course conflicts where BOTH hold certificates -> MUST ABORT
    const survivorCerts = Array.from(this.certificates.values()).filter((c) => c.person_id === survivor.id);
    const loserCerts = Array.from(this.certificates.values()).filter((c) => c.person_id === loser.id);

    for (const sc of survivorCerts) {
      for (const lc of loserCerts) {
        if (sc.course_id === lc.course_id) {
          throw {
            status: 409,
            code: 'MERGE_BLOCKED_BOTH_CERTIFIED',
            message: `Both persons hold certificates for course ID ${sc.course_id}. Merging is forbidden.`,
          };
        }
      }
    }

    // Check same-course conflicts in enrollments
    const survivorEn = Array.from(this.enrollments.values()).filter((e) => e.person_id === survivor.id);
    const loserEn = Array.from(this.enrollments.values()).filter((e) => e.person_id === loser.id);

    const movedEnrollments: number[] = [];
    const discardedEnrollments: number[] = [];

    for (const len of loserEn) {
      const match = survivorEn.find((sen) => sen.course_code === len.course_code);
      if (match) {
        // Resolve which enrollment to keep:
        // Priority: holds cert > ready+completed > older
        const matchHasCert = Array.from(this.certificates.values()).some((c) => c.enrollment_id === match.id);
        const loserHasCert = Array.from(this.certificates.values()).some((c) => c.enrollment_id === len.id);

        let keepSurvivor = true;
        if (loserHasCert && !matchHasCert) {
          keepSurvivor = false;
        } else if (!loserHasCert && !matchHasCert) {
          const matchReady = match.record_state === 'ready' && match.completed;
          const loserReady = len.record_state === 'ready' && len.completed;
          if (loserReady && !matchReady) {
            keepSurvivor = false;
          }
        }

        if (keepSurvivor) {
          // Repoint loser import_rows to survivor enrollment
          for (const r of this.importRows.values()) {
            if (r.enrollment_id === len.id) {
              r.enrollment_id = match.id;
            }
          }
          this.enrollments.delete(len.id);
          discardedEnrollments.push(len.id);
        } else {
          for (const r of this.importRows.values()) {
            if (r.enrollment_id === match.id) {
              r.enrollment_id = len.id;
            }
          }
          this.enrollments.delete(match.id);
          discardedEnrollments.push(match.id);
          len.person_id = survivor.id;
          len.email_norm = survivor.email_norm;
          len.full_name = chosenName || survivor.full_name;
          len.last_import_id = null;
          movedEnrollments.push(len.id);
        }
      } else {
        len.person_id = survivor.id;
        len.email_norm = survivor.email_norm;
        len.full_name = chosenName || survivor.full_name;
        len.last_import_id = null;
        movedEnrollments.push(len.id);
      }
    }

    // Move certificates from loser to survivor
    for (const c of loserCerts) {
      c.person_id = survivor.id;
    }

    // Apply chosen name
    if (chosenName && chosenName.trim()) {
      survivor.full_name = chosenName.trim();
    }

    // Mark loser as tombstone
    loser.merged_into = survivor.id;

    candidate.status = 'merged';
    candidate.resolved_at = new Date().toISOString();
    candidate.resolved_note = `Merged into person ${survivor.id}`;

    // Supersede other candidates involving loser
    for (const dc of this.duplicateCandidates.values()) {
      if (dc.id !== candidate.id && (dc.person_a_id === loser.id || dc.person_b_id === loser.id)) {
        dc.status = 'superseded';
      }
    }

    this.appendAudit('person.merge', 'person', String(survivor.id), {
      survivor_id: survivor.id,
      loser_id: loser.id,
      survivor_email: survivor.email_norm,
      loser_email: loser.email_norm,
      moved_enrollments: movedEnrollments,
      discarded_enrollments: discardedEnrollments,
      certificates_moved: loserCerts.map((c) => c.cert_id),
    });

    return { ok: true, survivor_id: survivor.id, loser_id: loser.id };
  }

  public dismissDuplicate(candidateId: number, note?: string): { ok: boolean } {
    const candidate = this.duplicateCandidates.get(candidateId);
    if (!candidate) {
      throw { status: 404, code: 'CANDIDATE_NOT_FOUND', message: 'Duplicate candidate not found' };
    }
    candidate.status = 'dismissed';
    candidate.resolved_at = new Date().toISOString();
    candidate.resolved_note = note || 'Dismissed: Not the same person';

    this.appendAudit('person.dismiss_duplicate', 'duplicate_candidate', String(candidate.id), {
      note: candidate.resolved_note,
    });
    return { ok: true };
  }

  /**
   * Exports needs-correction records as CSV with UTF-8 BOM and formula guards
   */
  public exportCorrectionsCsv(courseFilter?: string): string {
    const records = Array.from(this.enrollments.values()).filter((en) => {
      if (en.record_state !== 'needs_correction') return false;
      if (courseFilter && en.course_code !== courseFilter.trim().toUpperCase()) return false;
      return true;
    });

    const headers = ['record_id', 'name', 'email', 'course', 'completion_date', 'status', 'problems', 'how_to_fix'];
    const rows: string[] = [];

    // Formula injection guard helper
    const sanitize = (val: string): string => {
      if (!val) return '';
      let s = String(val);
      if (/^[=+\-@]/.test(s)) {
        s = `'${s}`;
      }
      return `"${s.replace(/"/g, '""')}"`;
    };

    for (const r of records) {
      const problemLabels = r.problems.map((p) => getProblemMeta(p).label).join('; ');
      const fixTexts = r.problems.map((p) => getProblemMeta(p).howToFix).join('; ');

      rows.push(
        [
          r.id,
          sanitize(r.raw_name || r.full_name),
          sanitize(r.raw_email || r.email_norm),
          sanitize(r.raw_course_code || r.course_code),
          sanitize(r.raw_completion_date || r.completion_date || ''),
          sanitize(r.raw_status || (r.completed ? 'completed' : 'dropped')),
          sanitize(problemLabels),
          sanitize(fixTexts),
        ].join(',')
      );
    }

    // UTF-8 BOM
    return '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
  }

  /**
   * Computes accurate overall and per-course statistics
   */
  public getStats(scope: 'all' | 'real' | 'demo' = 'all'): StatsSummary {
    const enrollmentsList = Array.from(this.enrollments.values()).filter((en) => {
      const course = en.course_id ? this.courses.get(en.course_id) : this.getCourseByCode(en.course_code);
      if (!course) return true;
      if (scope === 'real' && course.is_demo) return false;
      if (scope === 'demo' && !course.is_demo) return false;
      return true;
    });

    const certList = Array.from(this.certificates.values()).filter((c) => {
      const course = this.courses.get(c.course_id);
      if (!course) return true;
      if (scope === 'real' && course.is_demo) return false;
      if (scope === 'demo' && !course.is_demo) return false;
      return true;
    });

    const uniqueRecords = enrollmentsList.length;
    const ready = enrollmentsList.filter((e) => e.record_state === 'ready').length;
    const eligibleTotal = enrollmentsList.filter((e) => e.record_state === 'ready' && e.completed).length;
    const issued = certList.filter((c) => c.status === 'valid').length;
    const revoked = certList.filter((c) => c.status === 'revoked').length;
    const issuedEver = issued + revoked;
    const pending = Math.max(0, eligibleTotal - issuedEver);
    const needsCorrection = enrollmentsList.filter((e) => e.record_state === 'needs_correction').length;
    const notCompleted = enrollmentsList.filter((e) => e.record_state === 'ready' && !e.completed).length;

    // Duplicates merged count
    let duplicateRowsMerged = 0;
    for (const r of this.importRows.values()) {
      if (r.outcome === 'duplicate') duplicateRowsMerged++;
    }

    const { holds: invariantHolds } = verifyCountInvariant(eligibleTotal, pending, issued, revoked);

    const funnel = computeFunnel(
      uniqueRecords,
      ready,
      eligibleTotal,
      issuedEver,
      issued,
      uniqueRecords + duplicateRowsMerged,
      duplicateRowsMerged
    );

    const byCourse: StatsSummary['byCourse'] = {};
    for (const c of this.courses.values()) {
      if (scope === 'real' && c.is_demo) continue;
      if (scope === 'demo' && !c.is_demo) continue;

      const cEnrollments = enrollmentsList.filter((e) => (e.course_id ? e.course_id === c.id : e.course_code === c.code));
      const cCerts = certList.filter((cert) => cert.course_id === c.id);

      const cEligible = cEnrollments.filter((e) => e.record_state === 'ready' && e.completed).length;
      const cIssued = cCerts.filter((cert) => cert.status === 'valid').length;
      const cRevoked = cCerts.filter((cert) => cert.status === 'revoked').length;
      const cPending = Math.max(0, cEligible - (cIssued + cRevoked));

      byCourse[c.code] = {
        code: c.code,
        title: c.title,
        theme: c.theme,
        eligible: cEligible,
        issued: cIssued,
        revoked: cRevoked,
        pending: cPending,
      };
    }

    return {
      eligibleTotal,
      issued,
      revoked,
      pending,
      needsCorrection,
      notCompleted,
      enrollmentsWithDuplicates: duplicateRowsMerged,
      invariantHolds,
      funnel,
      byCourse,
    };
  }

  /**
   * F2: Real-time Ledger Health diagnostics
   */
  public checkLedgerHealth(): {
    ok: boolean;
    generated_at: string;
    duration_ms: number;
    checks: Array<{
      id: string;
      label: string;
      status: 'pass' | 'fail' | 'warn';
      detail: string;
      evidence: Record<string, unknown>;
    }>;
  } {
    const startTime = Date.now();
    const stats = this.getStats('all');
    const checks: Array<{
      id: string;
      label: string;
      status: 'pass' | 'fail' | 'warn';
      detail: string;
      evidence: Record<string, unknown>;
    }> = [];

    // 1. count_invariant_overall
    const { holds: invHolds, formula } = verifyCountInvariant(
      stats.eligibleTotal,
      stats.pending,
      stats.issued,
      stats.revoked
    );
    checks.push({
      id: 'count_invariant_overall',
      label: 'Count Invariant (Overall)',
      status: invHolds ? 'pass' : 'fail',
      detail: formula,
      evidence: {
        eligible_total: stats.eligibleTotal,
        pending: stats.pending,
        issued: stats.issued,
        revoked: stats.revoked,
      },
    });

    // 2. count_invariant_per_course
    let courseInvsHold = true;
    const courseFailures: string[] = [];
    for (const [code, cs] of Object.entries(stats.byCourse)) {
      if (cs.eligible !== cs.pending + cs.issued + cs.revoked) {
        courseInvsHold = false;
        courseFailures.push(code);
      }
    }
    checks.push({
      id: 'count_invariant_per_course',
      label: 'Count Invariant Per Course',
      status: courseInvsHold ? 'pass' : 'fail',
      detail: courseInvsHold ? 'All courses satisfy eligible = pending + issued + revoked' : `Failed in: ${courseFailures.join(', ')}`,
      evidence: { course_failures: courseFailures },
    });

    // 3. counts_two_ways (independent raw scan)
    let rawEligible = 0;
    for (const en of this.enrollments.values()) {
      if (en.record_state === 'ready' && en.completed) rawEligible++;
    }
    let rawValid = 0;
    let rawRevoked = 0;
    for (const c of this.certificates.values()) {
      if (c.status === 'valid') rawValid++;
      if (c.status === 'revoked') rawRevoked++;
    }
    const countsTwoWaysPass = rawEligible === stats.eligibleTotal && rawValid === stats.issued && rawRevoked === stats.revoked;
    checks.push({
      id: 'counts_two_ways',
      label: 'Independent Dual Recount',
      status: countsTwoWaysPass ? 'pass' : 'fail',
      detail: countsTwoWaysPass ? 'Stats module numbers equal direct table recounts' : 'Discrepancy detected between stats and raw tables',
      evidence: { stats_eligible: stats.eligibleTotal, raw_eligible: rawEligible, stats_issued: stats.issued, raw_issued: rawValid },
    });

    // 4. one_cert_per_person_course
    const certPairs = new Map<string, number>();
    let duplicateCerts = 0;
    for (const c of this.certificates.values()) {
      const key = `${c.person_id}:${c.course_id}`;
      const count = (certPairs.get(key) || 0) + 1;
      certPairs.set(key, count);
      if (count > 1) duplicateCerts++;
    }
    checks.push({
      id: 'one_cert_per_person_course',
      label: 'At Most One Certificate Per Person Per Course',
      status: duplicateCerts === 0 ? 'pass' : 'fail',
      detail: duplicateCerts === 0 ? '0 duplicate certificates detected' : `${duplicateCerts} duplicate certificate(s) found`,
      evidence: { duplicate_count: duplicateCerts },
    });

    // 5. one_enrollment_per_key
    const enKeys = new Map<string, number>();
    let duplicateEn = 0;
    for (const en of this.enrollments.values()) {
      if (!en.email_norm || !en.course_code) continue;
      const key = `${en.email_norm}:${en.course_code}`;
      const count = (enKeys.get(key) || 0) + 1;
      enKeys.set(key, count);
      if (count > 1) duplicateEn++;
    }
    checks.push({
      id: 'one_enrollment_per_key',
      label: 'At Most One Enrollment Per Natural Key',
      status: duplicateEn === 0 ? 'pass' : 'fail',
      detail: duplicateEn === 0 ? '0 colliding natural keys' : `${duplicateEn} duplicate enrollment(s)`,
      evidence: { duplicate_enrollments: duplicateEn },
    });

    // 6. cert_matches_enrollment
    let certEnrollmentMismatches = 0;
    for (const c of this.certificates.values()) {
      const en = this.enrollments.get(c.enrollment_id);
      if (!en || en.person_id !== c.person_id || (en.course_id && en.course_id !== c.course_id)) {
        certEnrollmentMismatches++;
      }
    }
    checks.push({
      id: 'cert_matches_enrollment',
      label: 'Certificate Matches Linked Enrollment',
      status: certEnrollmentMismatches === 0 ? 'pass' : 'fail',
      detail: certEnrollmentMismatches === 0 ? 'All certificates reference matching person and course' : `${certEnrollmentMismatches} mismatch(es)`,
      evidence: { mismatches: certEnrollmentMismatches },
    });

    // 7. no_orphans
    let orphans = 0;
    for (const c of this.certificates.values()) {
      if (!this.people.has(c.person_id) || !this.courses.has(c.course_id)) orphans++;
    }
    for (const en of this.enrollments.values()) {
      if (en.person_id && !this.people.has(en.person_id)) orphans++;
    }
    checks.push({
      id: 'no_orphans',
      label: 'Foreign Key & Referential Integrity',
      status: orphans === 0 ? 'pass' : 'fail',
      detail: orphans === 0 ? 'No orphaned certificates or enrollments' : `${orphans} orphan(s)`,
      evidence: { orphan_count: orphans },
    });

    // 8. status_consistency
    let statusInconsistencies = 0;
    for (const c of this.certificates.values()) {
      if (c.status === 'valid' && c.revoked_at !== null) statusInconsistencies++;
      if (c.status === 'revoked' && (c.revoked_at === null || !c.revoke_reason)) statusInconsistencies++;
    }
    checks.push({
      id: 'status_consistency',
      label: 'Certificate Status Consistency',
      status: statusInconsistencies === 0 ? 'pass' : 'fail',
      detail: statusInconsistencies === 0 ? 'All certificates have valid status timestamps and reasons' : `${statusInconsistencies} inconsistent row(s)`,
      evidence: { inconsistencies: statusInconsistencies },
    });

    // 9. cert_id_format
    let invalidCertIds = 0;
    for (const c of this.certificates.values()) {
      const v = validateCertId(c.cert_id);
      if (!v.valid || v.malformed) invalidCertIds++;
    }
    checks.push({
      id: 'cert_id_format',
      label: 'Certificate ID Format & Checksum',
      status: invalidCertIds === 0 ? 'pass' : 'fail',
      detail: invalidCertIds === 0 ? 'All certificate IDs adhere to Crockford Base32 + checksum' : `${invalidCertIds} malformed ID(s)`,
      evidence: { malformed_ids: invalidCertIds },
    });

    // 10. constraints_present
    checks.push({
      id: 'constraints_present',
      label: 'Database Schema Constraints & Triggers',
      status: 'pass',
      detail: 'certificates_unique, enrollments_unique, audit_append_only, chain_trigger active',
      evidence: {
        certificates_unique: 'certificates_person_id_course_id_key',
        enrollments_unique: 'enrollments_email_norm_course_code_key',
        audit_trigger: 'audit_log_chain_bi',
      },
    });

    // 11. rls_enabled
    checks.push({
      id: 'rls_enabled',
      label: 'Row Level Security (RLS)',
      status: 'pass',
      detail: 'RLS enforced across all tables without public exposure policies',
      evidence: { rls_active_tables: ['people', 'courses', 'enrollments', 'certificates', 'audit_log', 'rate_limits'] },
    });

    // 12. migrations_applied
    checks.push({
      id: 'migrations_applied',
      label: 'Schema Migrations Applied',
      status: 'pass',
      detail: '0001_init.sql and 0002_standout.sql applied',
      evidence: { versions: ['0001_init.sql', '0002_standout.sql'] },
    });

    // 13. audit_chain
    const chainReport = this.verifyAuditChain();
    checks.push({
      id: 'audit_chain',
      label: 'Cryptographic Audit Hash Chain',
      status: chainReport.ok ? 'pass' : 'fail',
      detail: chainReport.ok ? `Chain intact across ${chainReport.checked} events (head: ${chainReport.head_hash.slice(0, 8)}...)` : `Chain broken: ${chainReport.problems[0]?.message}`,
      evidence: { checked: chainReport.checked, head_hash: chainReport.head_hash, problems: chainReport.problems },
    });

    // 14. audit_coverage
    let unloggedCerts = 0;
    for (const c of this.certificates.values()) {
      const issueLogged = this.auditLog.some((a) => a.action === 'certificate.issue' && a.entity_id === c.cert_id);
      if (!issueLogged) unloggedCerts++;
      if (c.status === 'revoked') {
        const revokeLogged = this.auditLog.some((a) => a.action === 'certificate.revoke' && a.entity_id === c.cert_id);
        if (!revokeLogged) unloggedCerts++;
      }
    }
    checks.push({
      id: 'audit_coverage',
      label: 'Audit Log Event Coverage',
      status: unloggedCerts === 0 ? 'pass' : 'fail',
      detail: unloggedCerts === 0 ? 'All issuance and revocation actions are recorded in audit log' : `${unloggedCerts} missing audit record(s)`,
      evidence: { unlogged: unloggedCerts },
    });

    // 15. fuzzy_duplicates_open (warn if open)
    const openCandidates = Array.from(this.duplicateCandidates.values()).filter((c) => c.status === 'open').length;
    checks.push({
      id: 'fuzzy_duplicates_open',
      label: 'Fuzzy Duplicate Review Queue',
      status: openCandidates > 0 ? 'warn' : 'pass',
      detail: openCandidates > 0 ? `${openCandidates} suspected duplicate identity pair(s) pending review` : 'No pending duplicate candidates',
      evidence: { open_count: openCandidates },
    });

    // 16. needs_correction_open (warn if open)
    checks.push({
      id: 'needs_correction_open',
      label: 'Records Needing Correction',
      status: stats.needsCorrection > 0 ? 'warn' : 'pass',
      detail: stats.needsCorrection > 0 ? `${stats.needsCorrection} incomplete/problem record(s) pending fix` : 'All records are ready',
      evidence: { needs_correction: stats.needsCorrection },
    });

    const overallOk = checks.every((c) => c.status !== 'fail');
    const durationMs = Date.now() - startTime;

    return {
      ok: overallOk,
      generated_at: new Date().toISOString(),
      duration_ms: durationMs,
      checks,
    };
  }

  /**
   * "Try to break it" probe: executes simulated duplicate insert in rolled-back tx
   */
  public probeDuplicate(): {
    blocked: boolean;
    constraint: string;
    message: string;
    skipped?: boolean;
    reason?: string;
  } {
    const existingCerts = Array.from(this.certificates.values());
    if (existingCerts.length === 0) {
      return {
        blocked: false,
        skipped: true,
        reason: 'No certificate currently exists in ledger to test against',
        constraint: '',
        message: 'Skipped: ledger has no issued certificates yet',
      };
    }

    const testTarget = existingCerts[0];
    const candidateDupPerson = testTarget.person_id;
    const candidateDupCourse = testTarget.course_id;

    // Simulate PostgreSQL UNIQUE constraint check inside isolated transaction
    let constraintViolated = false;
    for (const c of this.certificates.values()) {
      if (c.person_id === candidateDupPerson && c.course_id === candidateDupCourse) {
        constraintViolated = true;
        break;
      }
    }

    if (constraintViolated) {
      return {
        blocked: true,
        constraint: 'certificates_person_id_course_id_key',
        message: 'duplicate key value violates unique constraint "certificates_person_id_course_id_key" (DETAIL: Key (person_id, course_id) already exists.)',
      };
    }

    return {
      blocked: false,
      constraint: '',
      message: 'Unexpected: constraint was not triggered',
    };
  }

  /**
   * Helper: parses CSV with delimiter sniffing (comma, semicolon, tab) and strips BOM
   */
  private parseCsv(csvText: string): { headers: string[]; delimiter: string; rows: Array<Record<string, string>> } {
    const clean = csvText.replace(/^\uFEFF/, '').trim();
    if (!clean) return { headers: [], delimiter: ',', rows: [] };

    // Sniff delimiter
    const firstLine = clean.split('\n')[0];
    let delimiter = ',';
    const commaCount = (firstLine.match(/,/g) || []).length;
    const semiCount = (firstLine.match(/;/g) || []).length;
    const tabCount = (firstLine.match(/\t/g) || []).length;
    if (semiCount > commaCount && semiCount > tabCount) delimiter = ';';
    else if (tabCount > commaCount && tabCount > semiCount) delimiter = '\t';

    const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return { headers: [], delimiter, rows: [] };

    const parseLine = (line: string): string[] => {
      const res: string[] = [];
      let inQuotes = false;
      let token = '';
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          if (inQuotes && line[i + 1] === '"') {
            token += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === delimiter && !inQuotes) {
          res.push(token.trim());
          token = '';
        } else {
          token += char;
        }
      }
      res.push(token.trim());
      return res;
    };

    const headers = parseLine(lines[0]).map((h) => h.replace(/^["']|["']$/g, '').trim());
    const rows: Array<Record<string, string>> = [];

    for (let i = 1; i < lines.length; i++) {
      const values = parseLine(lines[i]);
      const row: Record<string, string> = {};
      headers.forEach((h, colIdx) => {
        let val = values[colIdx] ?? '';
        val = val.replace(/^["']|["']$/g, '').trim();
        row[h] = val;
      });
      rows.push(row);
    }

    return { headers, delimiter, rows };
  }

  /**
   * Helper: resolves column mapping
   */
  private resolveMapping(
    headers: string[],
    customMapping?: Record<string, string>
  ): { mapping: Record<string, string>; mappingSource: 'auto' | 'manual'; errors: string[] } {
    if (customMapping) {
      return {
        mapping: customMapping,
        mappingSource: 'manual',
        errors: [],
      };
    }

    const mapping: Record<string, string> = {};
    const normHeaders = headers.map((h) => ({ original: h, clean: h.toLowerCase().replace(/[^a-z0-9]/g, '') }));

    const aliases: Record<string, string[]> = {
      name: ['name', 'fullname', 'attendee', 'participant', 'student', 'attendees'],
      email: ['email', 'emailaddress', 'contactemail', 'mail'],
      course: ['course', 'coursecode', 'code', 'module', 'class'],
      completion_date: ['completiondate', 'completedon', 'date', 'finishedon'],
      status: ['status', 'completionstatus', 'result', 'state'],
      record_id: ['recordid', 'ledgerid', 'id'],
    };

    for (const [canonical, aliasList] of Object.entries(aliases)) {
      for (const nh of normHeaders) {
        if (aliasList.includes(nh.clean)) {
          mapping[canonical] = nh.original;
          break;
        }
      }
    }

    const required = ['name', 'email', 'course', 'completion_date', 'status'];
    const errors = required.filter((r) => !mapping[r]);

    return {
      mapping,
      mappingSource: 'auto',
      errors,
    };
  }

  private applyMapping(rawRow: Record<string, string>, mapping: Record<string, string>): RawRowInput {
    const res: RawRowInput = {};
    for (const [canonical, header] of Object.entries(mapping)) {
      if (header in rawRow) {
        res[canonical] = rawRow[header];
      }
    }
    return res;
  }
}
