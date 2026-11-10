import { isIP } from 'node:net';

/**
 * Where an LM Studio server answers.
 *
 * LM Studio's OpenAI-compatible API lives at `<origin>/v1`, on
 * `http://localhost:1234/v1` unless the person changed the port or turned on
 * Serve on Local Network. Berry fetches this address from the product server
 * (to list models) and from the runtime image (to run), so a member must not
 * be able to point it at the host's cloud metadata service. Loopback and
 * private LAN addresses stay allowed: that is where LM Studio runs.
 *
 * This checks the address as written. A public name that resolves to a
 * link-local address is not caught here; the fetches refuse redirects.
 */

export const LMSTUDIO_DEFAULT_BASE_URL = 'http://localhost:1234/v1';

const MAX_LENGTH = 2048;

const METADATA_HOSTS = new Set([
   'metadata',
   'metadata.google.internal',
   'metadata.goog',
   'instance-data',
   'instance-data.ec2.internal',
]);

/** The normalized `/v1` base URL, or null when Berry will not call it. */
export function lmStudioBaseUrl(raw: string): string | null {
   const trimmed = raw.trim();
   if (trimmed === '' || trimmed.length > MAX_LENGTH) return null;
   let url: URL;
   try {
      url = new URL(trimmed);
   } catch {
      return null;
   }
   if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
   if (url.username !== '' || url.password !== '') return null;
   if (url.search !== '' || url.hash !== '') return null;
   const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
   if (host === '' || refusedHost(host)) return null;
   let path = url.pathname.replace(/\/+$/, '');
   if (path === '') path = '/v1';
   return `${url.protocol}//${url.host}${path}`;
}

/** `localhost:1234` style label for the connection row. */
export function lmStudioEndpointLabel(baseUrl: string): string {
   try {
      return new URL(baseUrl).host;
   } catch {
      return 'LM Studio';
   }
}

function refusedHost(host: string): boolean {
   if (METADATA_HOSTS.has(host)) return true;
   const family = isIP(host);
   if (family === 4) return refusedIpv4(host);
   if (family === 6) return refusedIpv6(host);
   return false;
}

function refusedIpv4(host: string): boolean {
   const [a, b] = host.split('.').map(Number);
   if (a === 0) return true; // "this network"; 0.0.0.0 is a bind address, not a destination
   if (a === 169 && b === 254) return true; // link-local, including 169.254.169.254
   if (a === 100 && b === 100 && host === '100.100.100.200') return true; // Alibaba Cloud metadata
   if (a !== undefined && a >= 224) return true; // multicast and reserved
   return false;
}

function refusedIpv6(host: string): boolean {
   if (host === '::') return true;
   if (/^fe[89ab]/.test(host)) return true; // fe80::/10 link-local
   if (host === 'fd00:ec2::254') return true; // AWS metadata over IPv6
   if (host.startsWith('ff')) return true; // multicast
   const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
   if (dotted?.[1]) return refusedIpv4(dotted[1]);
   // URL parsing rewrites ::ffff:169.254.169.254 as ::ffff:a9fe:a9fe.
   const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
   if (hex?.[1] && hex[2]) {
      const high = Number.parseInt(hex[1], 16);
      const low = Number.parseInt(hex[2], 16);
      return refusedIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
   }
   return false;
}
