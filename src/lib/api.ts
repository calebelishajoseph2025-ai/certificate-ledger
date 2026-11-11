import {z, type ZodType} from 'zod';
import {ApiClientError, ContractError, recordContractError, type ApiErrorBody} from './errors';
import {
  attendeesResponseSchema,
  attendeeMutationSchema,
  auditResponseSchema,
  auditVerifySchema,
  brandingSchema,
  certificateDetailSchema,
  certificatesResponseSchema,
  courseMutationSchema,
  coursesResponseSchema,
  deleteAttendeeSchema,
  demoStatusSchema,
  duplicateDetailSchema,
  duplicatesResponseSchema,
  healthSchema,
  importCommitSchema,
  importPreviewSchema,
  importRowsSchema,
  importsResponseSchema,
  issueAllSchema,
  issueResponseSchema,
  ledgerHealthSchema,
  loginSchema,
  logoutSchema,
  meSchema,
  mergePreviewSchema,
  mergeResultSchema,
  okSchema,
  probeSchema,
  problemsMetaSchema,
  revocationsSchema,
  revokeResponseSchema,
  scanDuplicatesSchema,
  statsSchema,
  verifyLookupSchema,
} from './schemas';

export {ApiClientError} from './errors';

type AuthHandler = (status: number) => void;
let onUnauthorized: AuthHandler | null = null;

export function setUnauthorizedHandler(handler: AuthHandler | null): void {
  onUnauthorized = handler;
}

function isStrictMode(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('strict') === '1';
}

function toQueryString(params?: Record<string, unknown>): string {
  if (!params) return '';
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      searchParams.set(key, String(value));
    }
  }
  const s = searchParams.toString();
  return s ? `?${s}` : '';
}

async function request<T>(
  path: string,
  schema: ZodType<T>,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers || {});
  const hasBody = options.body !== undefined && options.body !== null;
  if (hasBody && !headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, {
    ...options,
    headers,
    credentials: 'same-origin',
  });

  const retryAfterHeader = res.headers.get('Retry-After');
  const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;

  if (!res.ok) {
    if (res.status === 401) {
      onUnauthorized?.(401);
    }
    let errBody: {error?: ApiErrorBody} = {};
    try {
      errBody = (await res.json()) as {error?: ApiErrorBody};
    } catch {
      /* not json */
    }
    const apiErr: ApiErrorBody = errBody.error || {
      code: res.status === 401 ? 'UNAUTHENTICATED' : res.status === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR',
      message: res.statusText,
      retryAfter: retryAfterSeconds,
    };
    if (retryAfterSeconds) apiErr.retryAfter = retryAfterSeconds;
    throw new ApiClientError(res.status, apiErr);
  }

  const contentType = res.headers.get('content-type') || '';
  const payload: unknown = contentType.includes('application/json') ? await res.json() : await res.text();
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    recordContractError(path, issues);
    if (isStrictMode()) {
      throw new ContractError(path, issues);
    }
    throw new ContractError(path, issues);
  }
  return parsed.data;
}

export const api = {
  login: (passcode: string, signal?: AbortSignal) =>
    request('/api/auth/login', loginSchema, {
      method: 'POST',
      body: JSON.stringify({passcode}),
      signal,
    }),
  logout: (signal?: AbortSignal) =>
    request('/api/auth/logout', logoutSchema, {method: 'POST', signal}),
  me: (signal?: AbortSignal) => request('/api/auth/me', meSchema, {signal}),

  getHealth: (signal?: AbortSignal) => request('/api/health', healthSchema, {signal}),
  getLedgerHealth: (signal?: AbortSignal) => request('/api/health/ledger', ledgerHealthSchema, {signal}),
  probeDuplicate: (signal?: AbortSignal) =>
    request('/api/health/probe-duplicate', probeSchema, {method: 'POST', signal}),

  getStats: (scope: 'all' | 'real' | 'demo' = 'all', signal?: AbortSignal) =>
    request(`/api/stats?scope=${scope}`, statsSchema, {signal}),
  getBranding: (signal?: AbortSignal) => request('/api/branding', brandingSchema, {signal}),
  getProblemsMeta: (signal?: AbortSignal) => request('/api/meta/problems', problemsMetaSchema, {signal}),

  getAttendees: (
    params?: {state?: string; course?: string; cert?: string; q?: string},
    signal?: AbortSignal,
  ) => request(`/api/attendees${toQueryString(params)}`, attendeesResponseSchema, {signal}),
  addAttendee: (
    data: {name: string; email: string; course: string; completion_date?: string; status?: string},
    signal?: AbortSignal,
  ) =>
    request('/api/attendees', attendeeMutationSchema, {
      method: 'POST',
      body: JSON.stringify(data),
      signal,
    }),
  patchAttendee: (id: number, data: Record<string, unknown>, signal?: AbortSignal) =>
    request(`/api/attendees/${id}`, attendeeMutationSchema, {
      method: 'PATCH',
      body: JSON.stringify(data),
      signal,
    }),
  deleteAttendee: (id: number, signal?: AbortSignal) =>
    request(`/api/attendees/${id}`, deleteAttendeeSchema, {method: 'DELETE', signal}),
  issueAttendee: (id: number, signal?: AbortSignal) =>
    request(`/api/attendees/${id}/issue`, issueResponseSchema, {method: 'POST', signal}),
  exportCorrectionsCsvUrl: (course?: string) =>
    `/api/attendees/export-corrections.csv${toQueryString({course})}`,

  issueAll: (course?: string, scope: 'all' | 'real' | 'demo' = 'real', signal?: AbortSignal) =>
    request('/api/certificates/issue-all', issueAllSchema, {
      method: 'POST',
      body: JSON.stringify({course, scope}),
      signal,
    }),
  getCertificates: (
    params?: {course?: string; status?: string; page?: number; limit?: number},
    signal?: AbortSignal,
  ) => request(`/api/certificates${toQueryString(params)}`, certificatesResponseSchema, {signal}),
  getCertificate: (certId: string, signal?: AbortSignal) =>
    request(`/api/certificates/${encodeURIComponent(certId)}`, certificateDetailSchema, {signal}),
  revokeCertificate: (certId: string, reason: string, signal?: AbortSignal) =>
    request(`/api/certificates/${encodeURIComponent(certId)}/revoke`, revokeResponseSchema, {
      method: 'POST',
      body: JSON.stringify({reason}),
      signal,
    }),

  verifyLookup: (certId: string, sig?: string, signal?: AbortSignal) => {
    const qry = sig ? `?s=${encodeURIComponent(sig)}` : '';
    return request(`/api/verify/${encodeURIComponent(certId)}${qry}`, verifyLookupSchema, {signal});
  },
  getRevocations: (params?: {since?: string; format?: string}, signal?: AbortSignal) =>
    request(`/api/revocations${toQueryString(params)}`, revocationsSchema, {signal}),

  previewImport: (csv: string, mapping?: Record<string, string>, signal?: AbortSignal) =>
    request('/api/imports/preview', importPreviewSchema, {
      method: 'POST',
      body: JSON.stringify({csv, mapping}),
      signal,
    }),
  commitImport: (
    csv: string,
    filename?: string,
    mapping?: Record<string, string>,
    signal?: AbortSignal,
  ) =>
    request('/api/imports/commit', importCommitSchema, {
      method: 'POST',
      body: JSON.stringify({csv, filename, mapping}),
      signal,
    }),
  undoImport: (id: number, signal?: AbortSignal) =>
    request(`/api/imports/${id}/undo`, z.unknown(), {method: 'POST', signal}),
  getImports: (signal?: AbortSignal) => request('/api/imports', importsResponseSchema, {signal}),
  getImportRows: (id: number, signal?: AbortSignal) =>
    request(`/api/imports/${id}/rows`, importRowsSchema, {signal}),

  getCourses: (signal?: AbortSignal) => request('/api/courses', coursesResponseSchema, {signal}),
  createCourse: (
    data: {code: string; title: string; hours?: number; theme?: string},
    signal?: AbortSignal,
  ) =>
    request('/api/courses', courseMutationSchema, {
      method: 'POST',
      body: JSON.stringify(data),
      signal,
    }),
  patchCourse: (
    code: string,
    data: {title?: string; hours?: number; theme?: string},
    signal?: AbortSignal,
  ) =>
    request(`/api/courses/${encodeURIComponent(code)}`, courseMutationSchema, {
      method: 'PATCH',
      body: JSON.stringify(data),
      signal,
    }),

  getAuditLog: (signal?: AbortSignal) => request('/api/audit', auditResponseSchema, {signal}),
  verifyAudit: (signal?: AbortSignal) =>
    request('/api/audit/verify', auditVerifySchema, {method: 'POST', signal}),

  getDuplicates: (status?: string, signal?: AbortSignal) =>
    request(`/api/duplicates${status ? `?status=${encodeURIComponent(status)}` : ''}`, duplicatesResponseSchema, {
      signal,
    }),
  scanDuplicates: (signal?: AbortSignal) =>
    request('/api/duplicates/scan', scanDuplicatesSchema, {method: 'POST', signal}),
  getDuplicateDetail: (id: number, signal?: AbortSignal) =>
    request(`/api/duplicates/${id}`, duplicateDetailSchema, {signal}),
  getMergePreview: (id: number, survivorId: number, signal?: AbortSignal) =>
    request(`/api/duplicates/${id}/merge-preview?survivor=${survivorId}`, mergePreviewSchema, {signal}),
  mergeDuplicate: (id: number, survivorId: number, chosenName?: string, signal?: AbortSignal) =>
    request(`/api/duplicates/${id}/merge`, mergeResultSchema, {
      method: 'POST',
      body: JSON.stringify({survivor_person_id: survivorId, full_name: chosenName}),
      signal,
    }),
  dismissDuplicate: (id: number, note?: string, signal?: AbortSignal) =>
    request(`/api/duplicates/${id}/dismiss`, z.unknown(), {
      method: 'POST',
      body: JSON.stringify({note}),
      signal,
    }),

  getDemoStatus: (signal?: AbortSignal) => request('/api/demo/status', demoStatusSchema, {signal}),
  getDemoCsv: (variant: 'base' | 'modified', signal?: AbortSignal) =>
    request(`/api/demo/csv?variant=${variant}`, z.string(), {signal}),
  loadDemo: (signal?: AbortSignal) => request('/api/demo/load', z.unknown(), {method: 'POST', signal}),
  importDemo: (variant: 'base' | 'modified', signal?: AbortSignal) =>
    request('/api/demo/import', z.unknown(), {
      method: 'POST',
      body: JSON.stringify({variant}),
      signal,
    }),
  resetDemo: (signal?: AbortSignal) => request('/api/demo/reset', okSchema, {method: 'POST', signal}),
  resetLedger: (adminKey: string, signal?: AbortSignal) =>
    request('/api/system/reset', okSchema, {
      method: 'POST',
      body: JSON.stringify({admin_key: adminKey}),
      signal,
    }),
};
