import type { PreviewAddressing } from './proxy.ts';

/**
 * A built site's own address: `s-<id>.<domain>`.
 *
 * Same reason a repository preview is not served under a path of Berry's
 * (`proxy.ts`): the page asks for `/admin` and `/api/…` from the root of
 * wherever it is, and a sandbox with no origin cannot navigate to those or
 * call them. The id is twenty random hex characters minted when the site
 * comes up. It is the capability, and it is not a pull-request environment
 * (`p-`), so the two never share a host.
 */

export function siteOrigin(addressing: PreviewAddressing, hostId: string): string {
   return `${addressing.scheme}://s-${hostId}.${addressing.domain}${addressing.port === null ? '' : `:${addressing.port}`}`;
}

/** The site a host name addresses, or null when it is not a built site's. */
export function parseSiteHost(host: string | null | undefined, domain: string): string | null {
   if (!host) return null;
   const name = host.toLowerCase().replace(/:\d+$/, '');
   if (!name.endsWith(`.${domain.toLowerCase()}`)) return null;
   const label = name.slice(0, -(domain.length + 1));
   return /^s-([0-9a-f]{20})$/.exec(label)?.[1] ?? null;
}

/**
 * Relative asset URLs (`./assets/app.js`) resolve against the document's
 * directory. On `/admin/sessions/1` that is not the host root, so the built
 * page gets a base that pins them there. A page that already has one is left
 * as it was built.
 */
export function atSiteRoot(html: string): string {
   if (/<base\b/i.test(html)) return html;
   const base = '<base href="/">';
   if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, (head) => `${head}${base}`);
   return `<head>${base}</head>${html}`;
}

export interface SiteHostTarget {
   serve(hostId: string, request: Request, options: { fetch: typeof fetch; hostAddr: string }): Promise<Response>;
}

/**
 * Answers a request addressed to a built site's host; null for every other
 * request, which then goes to Berry's own routes untouched.
 */
export function sitePreviewProxy(builds: SiteHostTarget, domain: string, doFetch: typeof fetch = fetch, hostAddr = '127.0.0.1') {
   return async (request: Request): Promise<Response | null> => {
      const hostId = parseSiteHost(request.headers.get('host'), domain);
      if (!hostId) return null;
      return builds.serve(hostId, request, { fetch: doFetch, hostAddr });
   };
}
