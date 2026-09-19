/**
 * A preview's own address.
 *
 * A running app cannot be served under a path of Berry's. It asks for
 * `/_next/static/…` and `/api/…` from the root of wherever it is, so under
 * `/previews/<token>/` every absolute URL in it would miss — the file preview
 * rewrote Vite's and could go no further. And a page that runs inside Berry's
 * origin would share its cookies and storage, which the file preview avoided
 * by sandboxing the page into an opaque origin, breaking any app that uses
 * cookies or storage of its own.
 *
 * So each app of an environment gets a host name: `p-<id>-<app>.<domain>`.
 * It is a different origin from Berry and from every other preview, so the
 * browser keeps them apart with no sandbox and no rewriting, and the app runs
 * exactly as it would deployed. Locally the domain is `preview.localhost`,
 * which browsers resolve to this machine on their own; a deployment points a
 * wildcard record at Berry and sets `BERRY_PREVIEW_DOMAIN`.
 *
 * The id is twenty random hex characters minted per environment and gone with
 * it. It is the capability: a preview shows a pull request's own code and no
 * Berry data, to whoever was given its address, while it runs.
 */

export interface PreviewTargets {
   /** The loopback port of an environment's app (the primary when `app` is null), or null. */
   target(id: string, app: string | null): number | null;
}

export interface PreviewAddressing {
   domain: string;
   /** `http` locally; whatever terminates TLS in front of Berry otherwise. */
   scheme: 'http' | 'https';
   /** The port a browser uses, or null when it is the scheme's default. */
   port: number | null;
}

export function previewOrigin(addressing: PreviewAddressing, id: string, app: string): string {
   return `${addressing.scheme}://p-${id}-${app}.${addressing.domain}${addressing.port === null ? '' : `:${addressing.port}`}`;
}

/** The environment and app a host name addresses, or null when it is not a preview's. */
export function parsePreviewHost(host: string | null | undefined, domain: string): { id: string; app: string | null } | null {
   if (!host) return null;
   const name = host.toLowerCase().replace(/:\d+$/, '');
   if (!name.endsWith(`.${domain.toLowerCase()}`)) return null;
   const label = name.slice(0, -(domain.length + 1));
   const match = /^p-([0-9a-f]{20})(?:-([a-z][a-z0-9-]{0,30}))?$/.exec(label);
   return match ? { id: match[1]!, app: match[2] ?? null } : null;
}

/** Headers that describe one hop, or that the fetch below has already undone. */
const HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'content-encoding', 'content-length']);

/** Better Auth's cookies under Berry's prefix (`berry.session_token`, `__Secure-berry.…`). */
const BERRY_COOKIE = /^(?:__Secure-|__Host-)?berry[._-]/i;

/**
 * Answers a request addressed to a preview host; null for every other request,
 * which then goes to Berry's own routes untouched.
 */
export function previewProxy(targets: PreviewTargets, domain: string, doFetch: typeof fetch = fetch) {
   return async (request: Request): Promise<Response | null> => {
      const addressed = parsePreviewHost(request.headers.get('host'), domain);
      if (!addressed) return null;
      const port = targets.target(addressed.id, addressed.app);
      if (port === null) {
         return new Response('This preview is not running. Open the task\'s Preview tab in Berry to start it.', {
            status: 404,
            headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
         });
      }
      const url = new URL(request.url);
      const headers = new Headers(request.headers);
      // Berry's own session never reaches an agent's code, whatever the browser
      // decided to send (a deployment may scope its cookies to a parent domain
      // the preview host sits under). The app's own cookies are its business.
      const cookies = (request.headers.get('cookie') ?? '').split(';').map((part) => part.trim()).filter((part) => part !== '' && !BERRY_COOKIE.test(part));
      if (cookies.length > 0) headers.set('cookie', cookies.join('; '));
      else headers.delete('cookie');
      headers.set('x-forwarded-host', request.headers.get('host') ?? '');
      headers.set('x-forwarded-proto', url.protocol.replace(':', ''));
      const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
      let upstream: Response;
      try {
         upstream = await doFetch(`http://127.0.0.1:${port}${url.pathname}${url.search}`, {
            method: request.method,
            headers,
            redirect: 'manual',
            ...(hasBody ? { body: request.body, duplex: 'half' } : {}),
         } as RequestInit);
      } catch {
         return new Response('The preview did not answer. It may still be starting, or it stopped.', {
            status: 502,
            headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
         });
      }
      const answer = new Headers();
      upstream.headers.forEach((value, key) => {
         if (!HOP.has(key.toLowerCase())) answer.append(key, value);
      });
      // Shown inside Berry's review page: an app that forbids framing forbids its
      // own preview. Both ways of saying so go — helmet's defaults send the CSP one.
      answer.delete('x-frame-options');
      for (const name of ['content-security-policy', 'content-security-policy-report-only']) {
         const policy = answer.get(name);
         if (!policy) continue;
         const kept = policy.split(';').map((part) => part.trim()).filter((part) => part !== '' && !/^frame-ancestors(\s|$)/i.test(part));
         if (kept.length > 0) answer.set(name, kept.join('; '));
         else answer.delete(name);
      }
      return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: answer });
   };
}
