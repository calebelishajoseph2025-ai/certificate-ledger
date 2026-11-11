import {z} from 'zod';

export const errorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});

export const healthSchema = z.object({
  ok: z.boolean(),
  db: z.boolean(),
});

export const meSchema = z.object({
  authenticated: z.boolean(),
});

export const loginSchema = z.object({
  ok: z.boolean(),
  authenticated: z.boolean(),
});

export const logoutSchema = z.object({
  ok: z.boolean(),
  authenticated: z.boolean().optional(),
});

export const brandingSchema = z.object({
  issuerName: z.string(),
  signatory1Name: z.string(),
  signatory1Title: z.string(),
  signatory2Name: z.string(),
  signatory2Title: z.string(),
  publicBaseUrl: z.string(),
});

export const funnelSchema = z.object({
  uniqueRecords: z.number(),
  ready: z.number(),
  eligible: z.number(),
  issuedEver: z.number(),
  currentlyValid: z.number(),
  dropOffs: z.object({
    needsCorrection: z.number(),
    notCompleted: z.number(),
    pending: z.number(),
    revoked: z.number(),
  }),
  annotations: z.object({
    rowsReceived: z.number(),
    duplicateRowsMerged: z.number(),
  }),
});

export const courseStatsSchema = z.object({
  code: z.string(),
  title: z.string(),
  theme: z.string(),
  eligible: z.number(),
  issued: z.number(),
  revoked: z.number(),
  pending: z.number(),
});

export const statsSchema = z.object({
  eligibleTotal: z.number(),
  issued: z.number(),
  revoked: z.number(),
  pending: z.number(),
  needsCorrection: z.number(),
  notCompleted: z.number(),
  enrollmentsWithDuplicates: z.number(),
  invariantHolds: z.boolean(),
  funnel: funnelSchema,
  byCourse: z.record(courseStatsSchema),
});

export const healthCheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(['pass', 'fail', 'warn']),
  detail: z.string(),
  evidence: z.record(z.unknown()),
});

export const ledgerHealthSchema = z.object({
  ok: z.boolean(),
  generated_at: z.string(),
  duration_ms: z.number(),
  checks: z.array(healthCheckSchema),
});

export const probeSchema = z.object({
  blocked: z.boolean(),
  constraint: z.string(),
  message: z.string(),
  skipped: z.boolean().optional(),
  reason: z.string().optional(),
});

export const certificateLiteSchema = z
  .object({
    cert_id: z.string(),
    status: z.string(),
    verify_url: z.string(),
  })
  .nullable();

export const attendeeSchema = z.object({
  id: z.number(),
  person_id: z.number().nullable(),
  course_id: z.number().nullable(),
  raw_name: z.string(),
  raw_email: z.string(),
  raw_course_code: z.string(),
  raw_completion_date: z.string(),
  raw_status: z.string(),
  full_name: z.string(),
  email_norm: z.string(),
  course_code: z.string(),
  completion_date: z.string().nullable(),
  completed: z.boolean(),
  record_state: z.enum(['ready', 'needs_correction']),
  problems: z.array(z.string()),
  source_import_id: z.number().nullable(),
  source_row: z.number().nullable(),
  raw_fingerprint: z.string().nullable(),
  last_import_id: z.number().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  certificate: certificateLiteSchema.optional(),
});

export const attendeesResponseSchema = z.object({
  attendees: z.array(attendeeSchema),
  total: z.number(),
});

export const attendeeMutationSchema = z.object({
  attendee: attendeeSchema.optional(),
  summary: z.unknown().optional(),
});

export const deleteAttendeeSchema = z.object({
  ok: z.boolean(),
  deleted_id: z.number(),
});

export const courseSchema = z.object({
  id: z.number(),
  code: z.string(),
  title: z.string(),
  hours: z.number(),
  theme: z.enum(['classic', 'modern', 'midnight', 'forest', 'slate']),
  is_demo: z.boolean(),
  created_at: z.string(),
});

export const coursesResponseSchema = z.object({
  courses: z.array(courseSchema),
});

export const courseMutationSchema = z.object({
  course: courseSchema,
});

export const certificateSchema = z.object({
  id: z.number(),
  cert_id: z.string(),
  person_id: z.number(),
  course_id: z.number(),
  enrollment_id: z.number(),
  status: z.enum(['valid', 'revoked']),
  issued_at: z.string(),
  revoked_at: z.string().nullable(),
  revoke_reason: z.string().nullable(),
  holder_name: z.string().optional(),
  holder_email: z.string().optional(),
  course_title: z.string().optional(),
  course_code: z.string().optional(),
  completion_date: z.string().optional(),
  hours: z.number().optional(),
  theme: z.string().optional(),
  verify_url: z.string().optional(),
});

export const issueResponseSchema = z.object({
  certificate: certificateSchema.extend({
    verify_url: z.string(),
    theme: z.string(),
  }),
  created: z.boolean(),
});

export const issueAllSchema = z.object({
  created: z.number(),
  already_issued: z.number(),
  skipped: z.array(z.object({id: z.number(), reason: z.string()})),
});

export const certificatesResponseSchema = z.object({
  certificates: z.array(certificateSchema),
  total: z.number(),
  page: z.number(),
  pages: z.number(),
});

export const auditRowSchema = z.object({
  id: z.number(),
  seq: z.number(),
  at: z.string(),
  action: z.string(),
  entity: z.string(),
  entity_id: z.string().nullable(),
  detail: z.record(z.unknown()),
  prev_hash: z.string(),
  row_hash: z.string(),
});

export const certificateDetailSchema = z.object({
  certificate: certificateSchema,
  audit_trail: z.array(auditRowSchema),
});

export const revokeResponseSchema = z.object({
  certificate: certificateSchema,
});

export const verifyLookupSchema = z.object({
  status: z.enum(['valid', 'revoked', 'not_found', 'malformed', 'invalid_signature']),
  signature: z.enum(['valid', 'invalid', 'not_provided']),
  holder_name: z.string().optional(),
  course_title: z.string().optional(),
  course_code: z.string().optional(),
  issuer_name: z.string().optional(),
  issued_at: z.string().optional(),
  revoked_at: z.string().optional(),
  hours: z.number().optional(),
  theme: z.string().optional(),
});

export const revocationsSchema = z.object({
  revocations: z.array(
    z.object({
      cert_id: z.string(),
      revoked_at: z.string().nullable(),
    }),
  ),
  total: z.number(),
  generated_at: z.string(),
});

export const importPreviewRowSchema = z.object({
  rowNumber: z.number(),
  outcome: z.string(),
  fullName: z.string(),
  emailNorm: z.string(),
  courseCode: z.string(),
  completionDate: z.string().nullable(),
  completed: z.boolean(),
  problems: z.array(z.string()),
});

export const importPreviewSchema = z.object({
  headers: z.array(z.string()),
  delimiter: z.string(),
  mapping: z.record(z.string()),
  mapping_source: z.enum(['auto', 'manual']),
  column_errors: z.array(z.string()),
  rows: z.array(importPreviewRowSchema),
  summary: z.object({
    total: z.number(),
    new: z.number(),
    updated: z.number(),
    duplicates: z.number(),
    needs_correction: z.number(),
    unchanged: z.number(),
    corrected: z.number(),
  }),
});

export const importRecordSchema = z.object({
  id: z.number(),
  filename: z.string(),
  sha256: z.string(),
  mapping: z.record(z.string()).nullable(),
  is_demo: z.boolean(),
  row_count: z.number(),
  inserted: z.number(),
  updated: z.number(),
  corrected: z.number(),
  duplicates: z.number(),
  needs_correction: z.number(),
  unchanged: z.number(),
  undone_at: z.string().nullable(),
  undone_note: z.string().nullable(),
  created_at: z.string(),
});

export const importCommitSchema = z.object({
  import: importRecordSchema,
  already_imported: z.boolean(),
  summary: z.object({
    row_count: z.number(),
    inserted: z.number(),
    updated: z.number(),
    corrected: z.number(),
    duplicates: z.number(),
    needs_correction: z.number(),
    unchanged: z.number(),
  }),
});

export const importsResponseSchema = z.object({
  imports: z.array(importRecordSchema),
});

export const importRowSchema = z.object({
  id: z.number(),
  import_id: z.number(),
  row_number: z.number(),
  raw: z.record(z.unknown()),
  outcome: z.string(),
  problems: z.array(z.string()),
  before: z.record(z.unknown()).nullable(),
  enrollment_id: z.number().nullable(),
});

export const importRowsSchema = z.object({
  rows: z.array(importRowSchema),
});

export const undoImportSchema = z.unknown();

export const checkpointSchema = z.object({
  id: z.number(),
  up_to_seq: z.number(),
  head_hash: z.string(),
  mac: z.string(),
  created_at: z.string(),
});

export const auditResponseSchema = z.object({
  audit_log: z.array(auditRowSchema),
  checkpoints: z.array(checkpointSchema),
});

export const auditVerifySchema = z.object({
  ok: z.boolean(),
  checked: z.number(),
  head_seq: z.number(),
  head_hash: z.string(),
  checkpoints_checked: z.number(),
  problems: z.array(
    z.object({
      seq: z.number(),
      kind: z.string(),
      message: z.string(),
    }),
  ),
  verified_at: z.string(),
});

export const personSchema = z.object({
  id: z.number(),
  email_norm: z.string(),
  full_name: z.string(),
  merged_into: z.number().nullable(),
  created_by_import_id: z.number().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const duplicateCandidateSchema = z.object({
  id: z.number(),
  person_a_id: z.number(),
  person_b_id: z.number(),
  score: z.number(),
  reasons: z.array(z.string()),
  status: z.enum(['open', 'merged', 'dismissed', 'superseded']),
  resolved_at: z.string().nullable(),
  resolved_note: z.string().nullable(),
  created_at: z.string(),
  person_a: personSchema.optional(),
  person_b: personSchema.optional(),
});

export const duplicatesResponseSchema = z.object({
  candidates: z.array(duplicateCandidateSchema),
  open_count: z.number(),
});

export const scanDuplicatesSchema = z.object({
  ok: z.boolean(),
  open_count: z.number(),
});

export const duplicateDetailSchema = z.object({
  candidate: duplicateCandidateSchema,
  person_a: personSchema.extend({enrollments: z.array(attendeeSchema).optional()}).optional(),
  person_b: personSchema.extend({enrollments: z.array(attendeeSchema).optional()}).optional(),
});

export const mergePreviewSchema = z.object({
  survivor_id: z.number(),
  loser_id: z.number(),
  conflicts: z.array(z.object({course_code: z.string(), resolution: z.string()})),
  enrollments_to_move: z.number(),
  blocked: z.boolean(),
});

export const mergeResultSchema = z.object({
  ok: z.boolean(),
  survivor_id: z.number(),
  loser_id: z.number(),
});

export const demoStatusSchema = z.object({
  loaded: z.boolean(),
  demo_courses: z.number(),
  demo_certificates: z.number(),
});

export const problemsMetaSchema = z.record(
  z.object({
    code: z.string(),
    label: z.string(),
    howToFix: z.string(),
  }),
);

export const okSchema = z.object({ok: z.boolean()}).passthrough();

export type Stats = z.infer<typeof statsSchema>;
export type Funnel = z.infer<typeof funnelSchema>;
export type Attendee = z.infer<typeof attendeeSchema>;
export type Course = z.infer<typeof courseSchema>;
export type Certificate = z.infer<typeof certificateSchema>;
export type VerifyLookup = z.infer<typeof verifyLookupSchema>;
export type LedgerHealth = z.infer<typeof ledgerHealthSchema>;
export type Branding = z.infer<typeof brandingSchema>;
export type ImportPreview = z.infer<typeof importPreviewSchema>;
export type ImportRecord = z.infer<typeof importRecordSchema>;
export type AuditRow = z.infer<typeof auditRowSchema>;
export type DuplicateCandidate = z.infer<typeof duplicateCandidateSchema>;
export type HealthCheck = z.infer<typeof healthCheckSchema>;
