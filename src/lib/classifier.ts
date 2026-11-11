import crypto from 'node:crypto';

export interface RawRowInput {
  name?: string | null;
  email?: string | null;
  course?: string | null;
  completion_date?: string | null;
  status?: string | null;
  course_title?: string | null;
  hours?: string | number | null;
  record_id?: string | number | null;
  [key: string]: unknown;
}

export interface ClassifiedRecord {
  fullName: string;
  emailNorm: string;
  courseCode: string;
  completionDate: string | null;
  completed: boolean;
  recordState: 'ready' | 'needs_correction';
  problems: string[];
  rawFingerprint: string;
  rawName: string;
  rawEmail: string;
  rawCourseCode: string;
  rawCompletionDate: string;
  rawStatus: string;
}

const MONTH_NAMES: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/**
 * Parses mixed date formats: YYYY-MM-DD, DD/MM/YYYY, DD-MMM-YYYY.
 * Returns ISO YYYY-MM-DD string or null if unparseable.
 */
export function parseDate(rawDate?: string | null): { date: string | null; error?: 'INVALID_DATE' | 'FUTURE_DATE' } {
  if (!rawDate || typeof rawDate !== 'string') {
    return { date: null };
  }
  const clean = rawDate.trim();
  if (!clean) return { date: null };

  let y: number = 0;
  let m: number = 0;
  let d: number = 0;

  // YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(clean);
  if (isoMatch) {
    y = parseInt(isoMatch[1], 10);
    m = parseInt(isoMatch[2], 10);
    d = parseInt(isoMatch[3], 10);
  } else {
    // DD/MM/YYYY or DD-MM-YYYY
    const dmyMatch = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(clean);
    if (dmyMatch) {
      d = parseInt(dmyMatch[1], 10);
      m = parseInt(dmyMatch[2], 10);
      y = parseInt(dmyMatch[3], 10);
    } else {
      // DD-MMM-YYYY e.g. 21-Feb-2026
      const dMmmMatch = /^(\d{1,2})[-/ ]([A-Za-z]{3})[-/ ](\d{4})$/.exec(clean);
      if (dMmmMatch) {
        d = parseInt(dMmmMatch[1], 10);
        const monthStr = dMmmMatch[2].toLowerCase();
        m = parseInt(MONTH_NAMES[monthStr] || '0', 10);
        y = parseInt(dMmmMatch[3], 10);
      }
    }
  }

  if (y === 0 || m < 1 || m > 12 || d < 1 || d > 31) {
    return { date: null, error: 'INVALID_DATE' };
  }

  // Validate actual calendar days for given month/year
  const dateObj = new Date(Date.UTC(y, m - 1, d));
  if (dateObj.getUTCFullYear() !== y || dateObj.getUTCMonth() + 1 !== m || dateObj.getUTCDate() !== d) {
    return { date: null, error: 'INVALID_DATE' };
  }

  const mm = m.toString().padStart(2, '0');
  const dd = d.toString().padStart(2, '0');
  const isoDate = `${y}-${mm}-${dd}`;

  // Future date check
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  if (isoDate > todayIso) {
    return { date: isoDate, error: 'FUTURE_DATE' };
  }

  return { date: isoDate };
}

/**
 * Normalizes attendee name: collapse whitespace, Title Case if all upper or all lower.
 */
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

/**
 * Classifies an attendee record according to Certificate Ledger rules.
 */
export function classifyRecord(
  raw: RawRowInput,
  knownCourseCodes: Set<string>
): ClassifiedRecord {
  const problems: string[] = [];

  const rawName = String(raw.name ?? '').trim();
  const rawEmail = String(raw.email ?? '').trim();
  const rawCourse = String(raw.course ?? '').trim();
  const rawDate = String(raw.completion_date ?? '').trim();
  const rawStatus = String(raw.status ?? '').trim().toLowerCase();

  // Name check
  const fullName = cleanName(rawName);
  if (!fullName) {
    problems.push('MISSING_NAME');
  }

  // Email check
  const emailNorm = rawEmail.toLowerCase();
  if (!emailNorm) {
    problems.push('MISSING_EMAIL');
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
    problems.push('INVALID_EMAIL');
  }

  // Course check
  const courseCode = rawCourse.toUpperCase();
  if (!courseCode) {
    problems.push('MISSING_COURSE');
  } else if (knownCourseCodes.size > 0 && !knownCourseCodes.has(courseCode)) {
    problems.push('UNKNOWN_COURSE');
  }

  // Status check
  let completed = false;
  if (['completed', 'complete', 'passed', 'yes', 'y', 'true'].includes(rawStatus)) {
    completed = true;
  } else if (['dropped', 'no-show', 'absent', 'incomplete', 'failed', 'no', 'n', 'false', 'in progress'].includes(rawStatus)) {
    completed = false;
  } else if (!rawStatus) {
    problems.push('UNRECOGNIZED_STATUS');
  } else {
    problems.push('UNRECOGNIZED_STATUS');
  }

  // Date check
  const { date: completionDate, error: dateError } = parseDate(rawDate);
  if (dateError === 'INVALID_DATE') {
    problems.push('INVALID_DATE');
  } else if (dateError === 'FUTURE_DATE') {
    problems.push('FUTURE_DATE');
  } else if (completed && !completionDate) {
    problems.push('MISSING_COMPLETION_DATE');
  }

  const recordState = problems.length === 0 ? 'ready' : 'needs_correction';

  // Compute raw fingerprint (F4.7)
  const fpSource = [
    rawName.toLowerCase().replace(/\s+/g, ' '),
    emailNorm,
    courseCode,
    rawDate,
    rawStatus
  ].join('|');
  const rawFingerprint = crypto.createHash('sha256').update(fpSource, 'utf-8').digest('hex');

  return {
    fullName,
    emailNorm,
    courseCode,
    completionDate,
    completed,
    recordState,
    problems,
    rawFingerprint,
    rawName,
    rawEmail,
    rawCourseCode: rawCourse,
    rawCompletionDate: rawDate,
    rawStatus,
  };
}
