export type NormalizeServerUrlResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

const PRIVATE_IPV4_RE = /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})$/;

function isLocalOrLanHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return lower === 'localhost' || lower === '::1' || lower === '[::1]' || PRIVATE_IPV4_RE.test(lower);
}

/**
 * Default Berry server URL from Expo public env (direct property access required by Metro).
 */
export function defaultServerUrl(): string {
  const raw = process.env.EXPO_PUBLIC_BERRY_API_URL ?? '';
  const parsed = normalizeServerUrl(raw);
  return parsed.ok ? parsed.url : '';
}

export function normalizeServerUrl(raw: string): NormalizeServerUrlResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: 'Enter your Berry server URL.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'Enter a valid URL (for example https://berry.example.com).' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'Server URL must start with https:// (or http:// on local network).' };
  }

  if (parsed.protocol === 'http:' && !isLocalOrLanHost(parsed.hostname)) {
    return { ok: false, error: 'Use https:// for remote Berry servers. http:// is allowed only on localhost or LAN.' };
  }

  const normalizedPath = parsed.pathname.replace(/\/+$/, '');
  return { ok: true, url: `${parsed.origin}${normalizedPath}` };
}
