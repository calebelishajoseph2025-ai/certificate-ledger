import type {Funnel, Stats} from './schemas';

const MONTH_NAMES: Record<string, string> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

export function parseDate(rawDate?: string | null): {
  date: string | null;
  error?: 'INVALID_DATE' | 'FUTURE_DATE';
} {
  if (!rawDate || typeof rawDate !== 'string') return {date: null};
  const clean = rawDate.trim();
  if (!clean) return {date: null};

  let y = 0;
  let m = 0;
  let d = 0;

  const isoMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(clean);
  if (isoMatch) {
    y = parseInt(isoMatch[1] ?? '0', 10);
    m = parseInt(isoMatch[2] ?? '0', 10);
    d = parseInt(isoMatch[3] ?? '0', 10);
  } else {
    const dmyMatch = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(clean);
    if (dmyMatch) {
      d = parseInt(dmyMatch[1] ?? '0', 10);
      m = parseInt(dmyMatch[2] ?? '0', 10);
      y = parseInt(dmyMatch[3] ?? '0', 10);
    } else {
      const dMmmMatch = /^(\d{1,2})[-/ ]([A-Za-z]{3})[-/ ](\d{4})$/.exec(clean);
      if (dMmmMatch) {
        d = parseInt(dMmmMatch[1] ?? '0', 10);
        const monthStr = (dMmmMatch[2] ?? '').toLowerCase();
        m = parseInt(MONTH_NAMES[monthStr] || '0', 10);
        y = parseInt(dMmmMatch[3] ?? '0', 10);
      }
    }
  }

  if (y === 0 || m < 1 || m > 12 || d < 1 || d > 31) {
    return {date: null, error: 'INVALID_DATE'};
  }

  const dateObj = new Date(Date.UTC(y, m - 1, d));
  if (dateObj.getUTCFullYear() !== y || dateObj.getUTCMonth() + 1 !== m || dateObj.getUTCDate() !== d) {
    return {date: null, error: 'INVALID_DATE'};
  }

  const isoDate = `${y}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
  const todayIso = new Date().toISOString().slice(0, 10);
  if (isoDate > todayIso) return {date: isoDate, error: 'FUTURE_DATE'};
  return {date: isoDate};
}

export function cleanName(rawName?: string | null): string {
  if (!rawName || typeof rawName !== 'string') return '';
  const collapsed = rawName.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  const isAllUpper = collapsed === collapsed.toUpperCase();
  const isAllLower = collapsed === collapsed.toLowerCase();
  if (isAllUpper || isAllLower) {
    return collapsed
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }
  return collapsed;
}

export function classifyLive(raw: {
  name?: string;
  email?: string;
  course?: string;
  completion_date?: string;
  status?: string;
}, knownCourseCodes: Set<string>): {problems: string[]; recordState: 'ready' | 'needs_correction'} {
  const problems: string[] = [];
  const fullName = cleanName(raw.name);
  if (!fullName) problems.push('MISSING_NAME');

  const emailNorm = String(raw.email ?? '').trim().toLowerCase();
  if (!emailNorm) problems.push('MISSING_EMAIL');
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) problems.push('INVALID_EMAIL');

  const courseCode = String(raw.course ?? '').trim().toUpperCase();
  if (!courseCode) problems.push('MISSING_COURSE');
  else if (knownCourseCodes.size > 0 && !knownCourseCodes.has(courseCode)) problems.push('UNKNOWN_COURSE');

  const rawStatus = String(raw.status ?? '').trim().toLowerCase();
  let completed = false;
  if (['completed', 'complete', 'passed', 'yes', 'y', 'true'].includes(rawStatus)) completed = true;
  else if (['dropped', 'no-show', 'absent', 'incomplete', 'failed', 'no', 'n', 'false', 'in progress'].includes(rawStatus)) {
    completed = false;
  } else {
    problems.push('UNRECOGNIZED_STATUS');
  }

  const {date: completionDate, error: dateError} = parseDate(raw.completion_date ?? '');
  if (dateError === 'INVALID_DATE') problems.push('INVALID_DATE');
  else if (dateError === 'FUTURE_DATE') problems.push('FUTURE_DATE');
  else if (completed && !completionDate) problems.push('MISSING_COMPLETION_DATE');

  return {problems, recordState: problems.length === 0 ? 'ready' : 'needs_correction'};
}

export function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {day: '2-digit', month: 'short', year: 'numeric'}).format(d);
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-GB').format(n);
}

export function formatPercent(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const delta = Date.now() - then;
  const minutes = Math.round(delta / 60000);
  if (Math.abs(minutes) < 1) return 'just now';
  if (Math.abs(minutes) < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function formatCertId(id: string): string {
  return id.trim().toUpperCase();
}

export function formatHash(hash: string, size = 8): string {
  if (hash.length <= size * 2) return hash;
  return `${hash.slice(0, size)}…${hash.slice(-size)}`;
}

export function invariantEquation(stats: Stats): {holds: boolean; formula: string} {
  const sum = stats.pending + stats.issued + stats.revoked;
  const holds = stats.eligibleTotal === sum;
  return {
    holds,
    formula: `${stats.eligibleTotal} eligible = ${stats.pending} pending + ${stats.issued} issued + ${stats.revoked} revoked`,
  };
}

export function dropOffSum(funnel: Funnel): number {
  const d = funnel.dropOffs;
  return d.needsCorrection + d.notCompleted + d.pending + d.revoked;
}

export function publicVerifyUrl(certId: string, signature?: string): string {
  const origin = window.location.origin;
  const base = `${origin}/verify/${encodeURIComponent(certId)}`;
  return signature ? `${base}?s=${encodeURIComponent(signature)}` : base;
}

export function badgeUrl(certId: string): string {
  return `${window.location.origin}/api/verify/${encodeURIComponent(certId)}/badge.svg`;
}

export function linkedInUrl(payload: {
  holderName: string;
  courseTitle: string;
  issuerName: string;
  issuedAt?: string;
  certId: string;
}): string {
  const params = new URLSearchParams({
    startTask: 'CERTIFICATION_NAME',
    name: payload.courseTitle,
    organizationName: payload.issuerName,
    certId: payload.certId,
    certUrl: publicVerifyUrl(payload.certId),
  });
  if (payload.issuedAt) {
    const d = new Date(payload.issuedAt);
    if (!Number.isNaN(d.getTime())) {
      params.set('issueYear', String(d.getUTCFullYear()));
      params.set('issueMonth', String(d.getUTCMonth() + 1));
    }
  }
  return `https://www.linkedin.com/profile/add?${params.toString()}`;
}
