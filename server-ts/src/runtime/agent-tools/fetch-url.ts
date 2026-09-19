import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';

/**
 * `fetch_url`: one read-only GET of a public web page, made by the Berry
 * server on an agent's behalf.
 *
 * The server is on a private network (a database, a metadata endpoint, other
 * services), so an agent must never be able to aim this at it. Every hop —
 * the first URL and each redirect — is checked twice: the host a URL names,
 * and the address its name resolves to at connect time, so a name that
 * resolves to a private address (DNS rebinding included) is refused rather
 * than fetched. Only http and https, only GET, bounded in time, size and
 * redirects, with no cookies or credentials of any kind.
 */

export interface FetchLimits {
   timeoutMs: number;
   maxBytes: number;
   maxRedirects: number;
   /**
    * Test seam only: exact hostnames exempt from the address checks, so a test
    * can reach its own loopback server while every other private address —
    * a redirect to a metadata endpoint included — is still refused. Never set
    * in production.
    */
   trustedHosts?: readonly string[];
}

export const DEFAULT_FETCH_LIMITS: FetchLimits = {
   timeoutMs: 10_000,
   maxBytes: 2 * 1024 * 1024,
   maxRedirects: 5,
};

export class FetchRefused extends Error {
   override readonly name = 'FetchRefused';
   readonly code: 'URL_NOT_ALLOWED' | 'ADDRESS_NOT_ALLOWED' | 'TOO_MANY_REDIRECTS' | 'FETCH_FAILED';
   constructor(code: FetchRefused['code'], message: string) {
      super(message);
      this.code = code;
   }
}

/**
 * Every range a public page cannot live in: loopback, private, carrier-grade
 * NAT, link-local (cloud metadata), benchmarking, documentation, multicast and
 * reserved, for both families. IPv4-mapped and NAT64 IPv6 forms are unwrapped
 * and judged as the IPv4 address they carry.
 */
const BLOCKED = new BlockList();
for (const [network, prefix] of [
   ['0.0.0.0', 8],
   ['10.0.0.0', 8],
   ['100.64.0.0', 10],
   ['127.0.0.0', 8],
   ['169.254.0.0', 16],
   ['172.16.0.0', 12],
   ['192.0.0.0', 24],
   ['192.0.2.0', 24],
   ['192.88.99.0', 24],
   ['192.168.0.0', 16],
   ['198.18.0.0', 15],
   ['198.51.100.0', 24],
   ['203.0.113.0', 24],
   ['224.0.0.0', 4],
   ['240.0.0.0', 4],
] as const) {
   BLOCKED.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
   ['::', 128],
   ['::1', 128],
   ['100::', 64],
   ['2001:db8::', 32],
   ['fc00::', 7],
   ['fe80::', 10],
   ['ff00::', 8],
] as const) {
   BLOCKED.addSubnet(network, prefix, 'ipv6');
}

/** The IPv4 address an IPv6 address carries, for the mapped and NAT64 forms. */
function embeddedIpv4(address: string): string | null {
   const lower = address.toLowerCase();
   const dotted = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
   if (dotted?.[1]) return dotted[1];
   const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
   if (hex?.[1] && hex[2]) {
      const high = parseInt(hex[1], 16);
      const low = parseInt(hex[2], 16);
      return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
   }
   return null;
}

/** Whether an IP literal is somewhere a public page cannot be. Anything unparseable is blocked. */
export function isBlockedAddress(address: string): boolean {
   const bare = address.replace(/^\[|\]$/g, '').split('%')[0] ?? '';
   const family = isIP(bare);
   if (family === 4) return BLOCKED.check(bare, 'ipv4');
   if (family === 6) {
      const v4 = embeddedIpv4(bare);
      return v4 ? BLOCKED.check(v4, 'ipv4') : BLOCKED.check(bare, 'ipv6');
   }
   return true;
}

/** Checks a URL's shape before any network access: scheme, credentials, and a literal host. */
export function checkUrl(raw: string, limits: Pick<FetchLimits, 'trustedHosts'>): URL {
   let url: URL;
   try {
      url = new URL(raw);
   } catch {
      throw new FetchRefused('URL_NOT_ALLOWED', 'That is not a valid URL.');
   }
   if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new FetchRefused('URL_NOT_ALLOWED', 'Only http and https URLs can be fetched.');
   }
   if (url.username || url.password) {
      throw new FetchRefused('URL_NOT_ALLOWED', 'A URL with credentials in it cannot be fetched.');
   }
   const host = url.hostname.replace(/^\[|\]$/g, '');
   if (!limits.trustedHosts?.includes(host)) {
      if (isIP(host) && isBlockedAddress(host)) {
         throw new FetchRefused('ADDRESS_NOT_ALLOWED', 'That address is not on the public internet.');
      }
      if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
         throw new FetchRefused('ADDRESS_NOT_ALLOWED', 'That host is not on the public internet.');
      }
   }
   return url;
}

type LookupCallback = (
   error: NodeJS.ErrnoException | null,
   address: string | LookupAddress[],
   family?: number
) => void;

/** A DNS lookup that refuses a name resolving to any blocked address, at connect time. */
function guardedLookup(trustedHosts: readonly string[]) {
   return (hostname: string, options: { all?: boolean; family?: number }, callback: LookupCallback) => {
      dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
         if (error) return callback(error, []);
         const list = addresses as LookupAddress[];
         if (list.length === 0) return callback(new Error(`${hostname} did not resolve`), []);
         if (!trustedHosts.includes(hostname) && list.some((entry) => isBlockedAddress(entry.address))) {
            const refused = new FetchRefused('ADDRESS_NOT_ALLOWED', `${hostname} resolves to an address that is not on the public internet.`);
            return callback(refused as NodeJS.ErrnoException, []);
         }
         if (options.all) return callback(null, list);
         const first = list[0] as LookupAddress;
         return callback(null, first.address, first.family);
      });
   };
}

export interface FetchedPage {
   url: string;
   status: number;
   contentType: string;
   body: Buffer;
   truncated: boolean;
}

function once(url: URL, limits: FetchLimits): Promise<{ response: IncomingMessage; body: Buffer; truncated: boolean }> {
   return new Promise((resolve, reject) => {
      const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const request = send(
         url,
         {
            method: 'GET',
            lookup: guardedLookup(limits.trustedHosts ?? []) as never,
            headers: {
               'user-agent': 'BerryAgent/1.0 (+fetch_url; read-only)',
               'accept': 'text/html,application/xhtml+xml,text/css,text/plain,application/json;q=0.9,*/*;q=0.5',
               'accept-encoding': 'identity',
            },
            timeout: limits.timeoutMs,
         },
         (response) => {
            const chunks: Buffer[] = [];
            let size = 0;
            let truncated = false;
            response.on('data', (chunk: Buffer) => {
               if (truncated) return;
               size += chunk.length;
               if (size > limits.maxBytes) {
                  truncated = true;
                  chunks.push(chunk.subarray(0, chunk.length - (size - limits.maxBytes)));
                  response.destroy();
                  resolve({ response, body: Buffer.concat(chunks), truncated });
                  return;
               }
               chunks.push(chunk);
            });
            response.on('end', () => resolve({ response, body: Buffer.concat(chunks), truncated }));
            response.on('error', (error) => {
               if (!truncated) reject(error);
            });
         }
      );
      request.on('timeout', () => request.destroy(new FetchRefused('FETCH_FAILED', 'The page took too long to answer.')));
      request.on('error', reject);
      request.end();
   });
}

/** GETs a public URL, following at most `maxRedirects` redirects, each re-checked. */
export async function fetchPublicUrl(raw: string, limits: FetchLimits = DEFAULT_FETCH_LIMITS): Promise<FetchedPage> {
   let url = checkUrl(raw, limits);
   for (let hop = 0; hop <= limits.maxRedirects; hop++) {
      let result;
      try {
         result = await once(url, limits);
      } catch (error) {
         // The guarded lookup's refusal arrives as the request's own error.
         if (error instanceof FetchRefused) throw error;
         const message = error instanceof Error ? error.message : 'network error';
         throw new FetchRefused('FETCH_FAILED', `The page could not be fetched: ${message}`);
      }
      const { response } = result;
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location) {
         url = checkUrl(new URL(location, url).toString(), limits);
         continue;
      }
      return {
         url: url.toString(),
         status,
         contentType: String(response.headers['content-type'] ?? ''),
         body: result.body,
         truncated: result.truncated,
      };
   }
   throw new FetchRefused('TOO_MANY_REDIRECTS', `The page redirected more than ${limits.maxRedirects} times.`);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text: string): string {
   return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
      if (entity[0] === '#') {
         const code = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
         return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : match;
      }
      return ENTITIES[entity.toLowerCase()] ?? match;
   });
}

const clean = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

export interface ReadablePage {
   title: string;
   description: string;
   headings: Array<{ level: number; text: string }>;
   links: Array<{ href: string; text: string }>;
   stylesheets: string[];
   text: string;
}

/**
 * What an agent needs from a page to understand it: the title, the outline,
 * where it links, which stylesheets dress it, and its readable text — without
 * the scripts, styles and markup that would spend its context on noise.
 */
export function readableHtml(html: string, base: string, maxTextChars = 60_000): ReadablePage {
   const absolute = (href: string) => {
      try {
         return new URL(decodeEntities(href), base).toString();
      } catch {
         return href;
      }
   };
   const title = clean(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '');
   const description = decodeEntities(
      /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(html)?.[1] ??
         /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i.exec(html)?.[1] ??
         ''
   );
   const headings = [...html.matchAll(/<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/gi)]
      .map((match) => ({ level: Number(match[1]), text: clean(match[2] ?? '') }))
      .filter((heading) => heading.text.length > 0)
      .slice(0, 120);
   const links = [...html.matchAll(/<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)]
      .map((match) => ({ href: absolute(match[1] ?? ''), text: clean(match[2] ?? '') }))
      .slice(0, 100);
   const stylesheets = [
      ...html.matchAll(/<link\b[^>]*rel=["'][^"']*stylesheet[^"']*["'][^>]*>/gi),
   ]
      .map((match) => /href=["']([^"']+)["']/i.exec(match[0])?.[1])
      .filter((href): href is string => Boolean(href))
      .map(absolute)
      .slice(0, 20);
   const body = html
      .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(br|hr)\b[^>]*>/gi, '\n')
      .replace(/<\/(p|div|section|article|header|footer|li|h[1-6]|tr|ul|ol|nav|main|aside)>/gi, '\n');
   const text = decodeEntities(body.replace(/<[^>]+>/g, ' '))
      .split('\n')
      .map((line) => line.replace(/[ \t\f\v\r]+/g, ' ').trim())
      .filter(Boolean)
      .join('\n');
   return {
      title,
      description,
      headings,
      links,
      stylesheets,
      text: text.length > maxTextChars ? `${text.slice(0, maxTextChars)}\n[truncated]` : text,
   };
}

/** Text a body can be read as; anything else is described, not dumped. */
export function isTextual(contentType: string): boolean {
   const type = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
   return (
      type.startsWith('text/') ||
      type === 'application/json' ||
      type === 'application/xml' ||
      type === 'application/xhtml+xml' ||
      type === 'application/javascript' ||
      type.endsWith('+json') ||
      type.endsWith('+xml') ||
      type === ''
   );
}
