import {
  ApiClientError,
  createBerryClient,
  createIdempotencyKey,
  type BerryClient,
  type FetchLike,
} from '@/api/client';
import type { ApiPersonalTokenResponse, BootstrapResponse, ServerConfig } from '@/api/types';

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const PAT_PREFIX = 'berry_pat_';

function defaultFetch(): FetchLike {
  return (input, init) => globalThis.fetch(input, init);
}

function cleanBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

/**
 * Extracts `name=value` cookie pairs from `Set-Cookie` headers across Fetch, Bun, and React Native.
 */
function extractCookiePairs(headers: Headers): Map<string, string> {
  const pairs = new Map<string, string>();
  const rawList: string[] = [];
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetSetCookie.getSetCookie === 'function') {
    rawList.push(...withGetSetCookie.getSetCookie());
  } else {
    const combined = headers.get('set-cookie');
    if (combined) {
      // Split comma-joined Set-Cookie headers while preserving Expires=Day, DD Mon YYYY dates.
      rawList.push(...combined.split(/,(?=\s*[!#$%&'*+\-.^_`|~0-9A-Za-z]+=)/));
    }
  }

  for (const raw of rawList) {
    const firstSegment = raw.split(';', 1)[0]?.trim() ?? '';
    const eqIndex = firstSegment.indexOf('=');
    if (eqIndex <= 0) continue;
    const name = firstSegment.slice(0, eqIndex).trim();
    const value = firstSegment.slice(eqIndex + 1).trim();
    if (name && value) {
      pairs.set(name, value);
    }
  }
  return pairs;
}

function mergeCookieHeader(existing: string, headers: Headers): string {
  const merged = new Map<string, string>();
  for (const part of existing.split(';')) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      merged.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
    }
  }
  for (const [k, v] of extractCookiePairs(headers)) {
    merged.set(k, v);
  }
  return Array.from(merged.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

async function parseJsonSafe(response: Response): Promise<Record<string, unknown> | null> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function authErrorFromResponse(response: Response, parsed: Record<string, unknown> | null): ApiClientError {
  const nested = parsed?.error;
  if (nested && typeof nested === 'object') {
    const err = nested as Record<string, unknown>;
    if (typeof err.message === 'string') {
      return new ApiClientError({
        status: response.status,
        code: typeof err.code === 'string' ? err.code : 'AUTH_ERROR',
        message: err.message,
      });
    }
  }
  const message =
    typeof parsed?.message === 'string'
      ? parsed.message
      : response.status === 401
        ? 'Invalid email or password.'
        : `Sign-in failed (${response.status}).`;
  const code = typeof parsed?.code === 'string' ? parsed.code : 'AUTH_ERROR';
  return new ApiClientError({ status: response.status, code, message });
}

async function mintMobilePat(input: {
  baseUrl: string;
  sessionCookie: string;
  deviceLabel: string;
  origin: string;
  fetchImpl: FetchLike;
}): Promise<{ token: string; tokenId: string }> {
  const expiresAt = new Date(Date.now() + NINETY_DAYS_MS).toISOString();
  const payload = JSON.stringify({
    name: `Berry Mobile (${input.deviceLabel})`,
    expiresAt,
  });

  const postToken = (mode: 'explicit-cookie' | 'native-jar') => {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Idempotency-Key': createIdempotencyKey(),
    };
    if (mode === 'explicit-cookie' && input.sessionCookie) {
      headers.Cookie = input.sessionCookie;
    }
    // On iOS NSURLSession, mixing `credentials: 'include'` with a manual `Cookie` header
    // can prepend stale NSHTTPCookieStorage cookies or drop the manual header. Keep them
    // mutually exclusive: `omit` when sending an explicit Cookie, `include` for the native jar.
    return input.fetchImpl(`${cleanBaseUrl(input.baseUrl)}/api/v1/tokens`, {
      method: 'POST',
      headers,
      credentials: mode === 'explicit-cookie' ? 'omit' : 'include',
      body: payload,
    });
  };

  let response = await postToken(input.sessionCookie ? 'explicit-cookie' : 'native-jar');
  if (response.status === 401 && input.sessionCookie) {
    // Set-Cookie may have only exposed a non-session cookie (e.g. edge/CDN) while the
    // HttpOnly session cookie lives in the native jar; retry once with the jar alone.
    response = await postToken('native-jar');
  }

  const parsed = await parseJsonSafe(response);
  if (!response.ok) {
    if (response.status === 401 && !input.sessionCookie) {
      throw new ApiClientError({
        status: 401,
        code: 'COOKIE_UNAVAILABLE',
        message:
          'Signed in, but this device did not keep the session cookie. Use an API key (berry_pat_) instead.',
      });
    }
    throw authErrorFromResponse(response, parsed);
  }

  const data = parsed as unknown as ApiPersonalTokenResponse | null;
  const token = data?.token;
  const tokenId = data?.personalToken?.id;
  if (typeof token !== 'string' || !token.startsWith(PAT_PREFIX) || typeof tokenId !== 'string') {
    throw new ApiClientError({
      status: 500,
      code: 'TOKEN_EXCHANGE_FAILED',
      message: 'Signed in, but the server did not return a mobile API token. Try signing in with an API key.',
    });
  }

  // Best-effort sign-out of the temporary cookie session now that we hold a revocable PAT.
  try {
    await input.fetchImpl(`${cleanBaseUrl(input.baseUrl)}/api/auth/sign-out`, {
      method: 'POST',
      credentials: input.sessionCookie ? 'omit' : 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Origin: input.origin,
        ...(input.sessionCookie ? { Cookie: input.sessionCookie } : {}),
      },
      body: JSON.stringify({}),
    });
  } catch {
    // Ignore cleanup errors; the PAT is already issued.
  }

  return { token, tokenId };
}

export async function probeServer(baseUrl: string, fetchImpl?: FetchLike): Promise<ServerConfig> {
  const client = createBerryClient({ baseUrl, token: null, fetchImpl });
  return client.get<ServerConfig>('/api/v1/config');
}

export type PasswordSignInResult =
  | { kind: 'signed_in'; token: string; tokenId: string }
  | { kind: 'two_factor'; sessionCookie: string };

export async function signInWithPassword(
  input: {
    baseUrl: string;
    email: string;
    password: string;
    deviceLabel: string;
    origin?: string | null;
  },
  fetchImpl: FetchLike = defaultFetch(),
): Promise<PasswordSignInResult> {
  const base = cleanBaseUrl(input.baseUrl);
  const origin = input.origin ? cleanBaseUrl(input.origin) : base;
  // Accounts are stored lowercase; phone keyboards like to capitalise the first letter.
  const email = input.email.trim().toLowerCase();

  let response: Response;
  try {
    response = await fetchImpl(`${base}/api/auth/sign-in/email`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Origin: origin,
      },
      body: JSON.stringify({
        email,
        password: input.password,
      }),
    });
  } catch {
    throw new ApiClientError({
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'Could not reach the Berry server. Check your connection and server URL.',
    });
  }

  const parsed = await parseJsonSafe(response);
  if (!response.ok) {
    throw authErrorFromResponse(response, parsed);
  }

  const sessionCookie = mergeCookieHeader('', response.headers);
  if (parsed?.twoFactorRedirect === true) {
    return { kind: 'two_factor', sessionCookie };
  }

  // An empty cookie is not fatal: on iOS the native jar holds it and `credentials: 'include'`
  // attaches it to the token request. mintMobilePat reports a clear error if that fails too.
  const minted = await mintMobilePat({
    baseUrl: base,
    sessionCookie,
    deviceLabel: input.deviceLabel,
    origin,
    fetchImpl,
  });
  return { kind: 'signed_in', ...minted };
}

export async function verifyTwoFactorAndMintToken(
  input: {
    baseUrl: string;
    sessionCookie: string;
    code: string;
    deviceLabel: string;
    origin?: string | null;
  },
  fetchImpl: FetchLike = defaultFetch(),
): Promise<{ token: string; tokenId: string }> {
  const base = cleanBaseUrl(input.baseUrl);
  const origin = input.origin ? cleanBaseUrl(input.origin) : base;

  let response: Response;
  try {
    response = await fetchImpl(`${base}/api/auth/two-factor/verify-totp`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Origin: origin,
        ...(input.sessionCookie ? { Cookie: input.sessionCookie } : {}),
      },
      body: JSON.stringify({
        code: input.code.trim(),
        trustDevice: true,
      }),
    });
  } catch {
    throw new ApiClientError({
      status: 0,
      code: 'NETWORK_ERROR',
      message: 'Could not reach the Berry server.',
    });
  }

  const parsed = await parseJsonSafe(response);
  if (!response.ok) {
    throw authErrorFromResponse(response, parsed);
  }

  const freshCookie = mergeCookieHeader('', response.headers);
  const nextCookie = freshCookie || mergeCookieHeader(input.sessionCookie, response.headers);
  return mintMobilePat({
    baseUrl: base,
    sessionCookie: nextCookie,
    deviceLabel: input.deviceLabel,
    origin,
    fetchImpl,
  });
}

export async function signInWithPat(
  baseUrl: string,
  rawToken: string,
  fetchImpl?: FetchLike,
): Promise<BootstrapResponse> {
  const token = rawToken.trim();
  if (!token.startsWith(PAT_PREFIX) || token.length < PAT_PREFIX.length + 6) {
    throw new ApiClientError({
      status: 422,
      code: 'INVALID_TOKEN_FORMAT',
      message: 'Enter a valid Berry personal access token starting with berry_pat_.',
    });
  }
  const client = createBerryClient({ baseUrl, token, fetchImpl });
  return client.get<BootstrapResponse>('/api/v1/me/bootstrap');
}

export async function signOutSession(client: BerryClient, tokenId: string | null): Promise<void> {
  if (!tokenId) return;
  try {
    await client.del(`/api/v1/tokens/${tokenId}`);
  } catch (error) {
    if (error instanceof ApiClientError && (error.status === 401 || error.status === 404 || error.status === 0)) {
      return;
    }
    throw error;
  }
}
