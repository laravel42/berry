import type { ApiErrorEnvelope, ApiFieldError } from './types';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string;
  readonly details: Record<string, unknown> | null;

  constructor(input: {
    status: number;
    code: string;
    message: string;
    requestId?: string;
    details?: Record<string, unknown> | null;
  }) {
    super(input.message);
    this.name = 'ApiClientError';
    this.status = input.status;
    this.code = input.code;
    this.requestId = input.requestId ?? '';
    this.details = input.details ?? null;
  }

  fieldErrors(): ApiFieldError[] {
    const raw = this.details?.fields;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (item): item is ApiFieldError =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as Record<string, unknown>).path === 'string' &&
        typeof (item as Record<string, unknown>).code === 'string' &&
        typeof (item as Record<string, unknown>).message === 'string',
    );
  }
}

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  idempotent?: boolean;
  emptyBody?: boolean;
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

export type BerryClient = {
  readonly baseUrl: string;
  request<T>(path: string, options?: RequestOptions): Promise<T>;
  get<T>(path: string, signal?: AbortSignal): Promise<T>;
  post<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T>;
  patch<T>(path: string, body: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T>;
  del(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<void>;
};

export function createIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function isErrorEnvelope(value: unknown): value is ApiErrorEnvelope {
  if (!value || typeof value !== 'object') return false;
  const err = (value as Record<string, unknown>).error;
  if (!err || typeof err !== 'object') return false;
  const record = err as Record<string, unknown>;
  return typeof record.code === 'string' && typeof record.message === 'string';
}

export function createBerryClient(options: {
  baseUrl: string;
  token: string | null;
  fetchImpl?: FetchLike;
  onUnauthorized?: () => void;
}): BerryClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const fetchImpl: FetchLike =
    options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  let unauthorizedFired = false;

  async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const method = opts.method ?? 'GET';
    const headers = new Headers(opts.headers);
    headers.set('Accept', 'application/json');
    if (options.token) {
      headers.set('Authorization', `Bearer ${options.token}`);
    }
    if (opts.idempotent) {
      headers.set('Idempotency-Key', createIdempotencyKey());
    }

    let serializedBody: string | undefined;
    if (!opts.emptyBody && opts.body !== undefined) {
      headers.set('Content-Type', 'application/json');
      serializedBody = JSON.stringify(opts.body);
    }

    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        body: serializedBody,
        signal: opts.signal,
      });
    } catch {
      throw new ApiClientError({
        status: 0,
        code: 'NETWORK_ERROR',
        message: 'Could not reach the Berry server. Check your connection and server URL.',
      });
    }

    if (response.status === 401 && options.onUnauthorized && !unauthorizedFired) {
      unauthorizedFired = true;
      options.onUnauthorized();
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    let parsed: unknown = null;
    if (text.trim().length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }

    if (!response.ok) {
      if (isErrorEnvelope(parsed)) {
        throw new ApiClientError({
          status: response.status,
          code: parsed.error.code,
          message: parsed.error.message,
          requestId: parsed.error.requestId || response.headers.get('x-request-id') || '',
          details: parsed.error.details,
        });
      }
      throw new ApiClientError({
        status: response.status,
        code: response.status === 401 ? 'UNAUTHENTICATED' : 'HTTP_ERROR',
        message:
          response.status === 401
            ? 'Your session expired. Please sign in again.'
            : `Request failed with status ${response.status}.`,
        requestId: response.headers.get('x-request-id') ?? '',
      });
    }

    return parsed as T;
  }

  return {
    baseUrl,
    request,
    get: <T>(path: string, signal?: AbortSignal) => request<T>(path, { method: 'GET', signal }),
    post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
      request<T>(path, { ...opts, method: 'POST', body }),
    patch: <T>(path: string, body: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
      request<T>(path, { ...opts, method: 'PATCH', body }),
    del: async (path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) => {
      await request<void>(path, { ...opts, method: 'DELETE', emptyBody: true });
    },
  };
}
