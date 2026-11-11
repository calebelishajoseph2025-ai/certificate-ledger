/**
 * Problem codes and their plain-language descriptions and fix instructions.
 * Single source of truth across UI, API, and export files.
 */

export interface ProblemMeta {
  code: string;
  label: string;
  howToFix: string;
}

export const PROBLEM_REGISTRY: Record<string, ProblemMeta> = {
  MISSING_NAME: {
    code: 'MISSING_NAME',
    label: 'Attendee name is missing',
    howToFix: 'Enter the full legal or preferred name of the participant in the name column.',
  },
  MISSING_EMAIL: {
    code: 'MISSING_EMAIL',
    label: 'Email address is missing',
    howToFix: 'Provide a valid email address for the attendee in the email column.',
  },
  INVALID_EMAIL: {
    code: 'INVALID_EMAIL',
    label: 'Email format is invalid',
    howToFix: 'Correct the email address format (e.g., user@domain.com) without spaces.',
  },
  MISSING_COURSE: {
    code: 'MISSING_COURSE',
    label: 'Course code is missing',
    howToFix: 'Enter the registered course code (e.g., DS-101) in the course column.',
  },
  UNKNOWN_COURSE: {
    code: 'UNKNOWN_COURSE',
    label: 'Course code does not exist in ledger',
    howToFix: 'Create the course in the courses view or fix the course code spelling.',
  },
  MISSING_COMPLETION_DATE: {
    code: 'MISSING_COMPLETION_DATE',
    label: 'Completion date missing for completed status',
    howToFix: 'Provide the date of course completion (YYYY-MM-DD or DD/MM/YYYY).',
  },
  INVALID_DATE: {
    code: 'INVALID_DATE',
    label: 'Date format cannot be parsed',
    howToFix: 'Use ISO format YYYY-MM-DD or European DD/MM/YYYY format.',
  },
  FUTURE_DATE: {
    code: 'FUTURE_DATE',
    label: 'Completion date is in the future',
    howToFix: 'Adjust the completion date to today or a past date.',
  },
  UNRECOGNIZED_STATUS: {
    code: 'UNRECOGNIZED_STATUS',
    label: 'Completion status value is unrecognized',
    howToFix: 'Change status to "completed", "dropped", "no-show", or "in progress".',
  },
};

export function getProblemMeta(code: string): ProblemMeta {
  return (
    PROBLEM_REGISTRY[code] || {
      code,
      label: `Issue: ${code}`,
      howToFix: 'Review and update the record data.',
    }
  );
}
