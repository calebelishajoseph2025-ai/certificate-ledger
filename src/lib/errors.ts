export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  retryAfter?: number;
}

export class ApiClientError extends Error {
  status: number;
  code: string;
  details?: Record<string, unknown>;
  retryAfter?: number;

  constructor(status: number, errorData: ApiErrorBody) {
    super(errorData.message || 'API request failed');
    this.name = 'ApiClientError';
    this.status = status;
    this.code = errorData.code || 'UNKNOWN_ERROR';
    this.details = errorData.details;
    this.retryAfter = errorData.retryAfter;
  }
}

export class ContractError extends Error {
  path: string;
  issues: string;

  constructor(path: string, issues: string) {
    super(`Contract mismatch on ${path}: ${issues}`);
    this.name = 'ContractError';
    this.path = path;
    this.issues = issues;
  }
}

export type ContractErrorRecord = {
  path: string;
  at: string;
  issues: string;
};

declare global {
  interface Window {
    __contractErrors?: ContractErrorRecord[];
    __sky?: {
      fps: number;
      dpr: number;
      quality: 'high' | 'medium' | 'low' | 'off';
      layerCount: number;
      reducedMotion: boolean;
      webgl: boolean;
    };
  }
}

export function recordContractError(path: string, issues: string): void {
  if (typeof window === 'undefined') return;
  const bucket = window.__contractErrors ?? [];
  bucket.push({path, at: new Date().toISOString(), issues});
  window.__contractErrors = bucket;
}

export function isApiError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError;
}
