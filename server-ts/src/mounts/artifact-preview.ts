import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import type { AuthVariables } from '../auth/middleware.ts';
import type { IssueRepository } from '../core/issues.ts';
import type { RunArtifactRepository } from '../core/run-artifacts.ts';
import { json } from '../http/app.ts';
import { ApiError } from '../http/errors.ts';
import type { Mount } from '../http/registry.ts';
import { Forbidden, NotFound } from '../identity/errors.ts';
import { ObjectNotFound, type Storage } from '../storage/storage.ts';
import type { SiteBuilds } from '../previews/site-builds.ts';

/**
 * What an agent built on a task, opened as the thing it is: a page runs as a
 * page, beside the stylesheet and script it links to by relative path.
 *
 * A single file can be shown from its download. A site cannot: `index.html`
 * asks for `style.css` and `app.js` relative to itself, so every file has to
 * be reachable at its own path under one base URL. That base is a signed,
 * short-lived token rather than the session:
 *
 * - The page runs sandboxed (a CSP `sandbox` on every response, and the
 *   iframe's own attribute), so it has an opaque origin. It cannot read Berry's
 *   cookies or storage, and its requests carry no session — so the files it
 *   loads could not authenticate with one anyway.
 * - The token grants reading one task's agent files, for an hour, and nothing
 *   else. Paths are looked up in `run_artifacts`, never on a filesystem, so
 *   `..` finds nothing.
 */

const TOKEN_TTL_SECONDS = 60 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Agents write through `write_file`, which stores everything as text/plain, so
 * the type a browser needs comes from the extension. Unknown types are served
 * as plain text rather than guessed.
 */
const TYPES: Record<string, string> = {
   html: 'text/html; charset=utf-8',
   htm: 'text/html; charset=utf-8',
   css: 'text/css; charset=utf-8',
   js: 'text/javascript; charset=utf-8',
   mjs: 'text/javascript; charset=utf-8',
   json: 'application/json; charset=utf-8',
   map: 'application/json; charset=utf-8',
   svg: 'image/svg+xml',
   png: 'image/png',
   jpg: 'image/jpeg',
   jpeg: 'image/jpeg',
   gif: 'image/gif',
   webp: 'image/webp',
   avif: 'image/avif',
   ico: 'image/x-icon',
   mp4: 'video/mp4',
   webm: 'video/webm',
   mov: 'video/quicktime',
   mp3: 'audio/mpeg',
   wav: 'audio/wav',
   ogg: 'audio/ogg',
   pdf: 'application/pdf',
   woff: 'font/woff',
   woff2: 'font/woff2',
   ttf: 'font/ttf',
   otf: 'font/otf',
   md: 'text/markdown; charset=utf-8',
   txt: 'text/plain; charset=utf-8',
   xml: 'application/xml; charset=utf-8',
   wasm: 'application/wasm',
};

export function previewContentType(path: string, stored: string): string {
   const dot = path.lastIndexOf('.');
   const extension = dot === -1 ? '' : path.slice(dot + 1).toLowerCase();
   const known = TYPES[extension];
   if (known) return known;
   // A type the uploader set deliberately (an attached image, a video) stands.
   if (!/^text\/plain\b|^application\/octet-stream\b/i.test(stored)) return stored;
   return 'text/plain; charset=utf-8';
}

/**
 * The headers every preview response carries. `sandbox` makes even a page
 * opened directly in a tab run in an opaque origin, so it can never act as
 * Berry: scripts, forms and popups work, same-origin access does not.
 */
const SANDBOX_HEADERS = {
   // `frame-ancestors 'self'`: only Berry's own pages may frame a preview.
   'Content-Security-Policy':
      "sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads; frame-ancestors 'self'",
   'X-Content-Type-Options': 'nosniff',
   'Referrer-Policy': 'no-referrer',
   // `no-transform`: a proxy in front of Berry (Cloudflare) must not rewrite
   // the agent's page. Cloudflare otherwise injects its analytics beacon, which
   // runs in the sandbox, fails its CORS check on every page and fills the
   // console, and can rewrite scripts (Rocket Loader) the site depends on.
   'Cache-Control': 'private, max-age=60, no-transform',
   'Cross-Origin-Resource-Policy': 'cross-origin',
   // A sandboxed page has the origin `null`, and module scripts, fonts and
   // fetches are CORS requests: without this a built site's
   // `<script type="module">` is refused and the page stays blank. Nothing
   // here carries credentials, and the token already grants the read.
   'Access-Control-Allow-Origin': '*',
};

export class PreviewTokens {
   readonly #key: Buffer;
   readonly #now: () => number;

   /**
    * Derived from the auth secret, so every API process agrees on a token.
    * Without one (no cookie sessions configured) a per-process key is used:
    * a token then works on the process that issued it until it restarts.
    */
   constructor(options: { secret: string | null; now?: () => number }) {
      this.#key = options.secret
         ? createHmac('sha256', options.secret).update('berry:artifact-preview:v1').digest()
         : randomBytes(32);
      this.#now = options.now ?? Date.now;
   }

   issue(issueId: string): { token: string; expiresAt: string } {
      const expires = Math.floor(this.#now() / 1000) + TOKEN_TTL_SECONDS;
      const body = `${issueId.toLowerCase()}.${expires.toString(36)}`;
      return { token: `${body}.${this.#sign(body)}`, expiresAt: new Date(expires * 1000).toISOString() };
   }

   /** The issue a token reads, or null when it is malformed, forged or expired. */
   verify(token: string): string | null {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const [issueId, expiresRaw, mac] = parts as [string, string, string];
      if (!UUID.test(issueId)) return null;
      const expected = Buffer.from(this.#sign(`${issueId}.${expiresRaw}`));
      const given = Buffer.from(mac);
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
      const expires = Number.parseInt(expiresRaw, 36);
      if (!Number.isFinite(expires) || expires * 1000 < this.#now()) return null;
      return issueId;
   }

   #sign(body: string): string {
      return createHmac('sha256', this.#key).update(body).digest('base64url').slice(0, 32);
   }
}

/**
 * `POST /issues/:issueRef/artifacts/preview`, nested under the issues mount:
 * a token for this task's files, for a person who may read the task.
 */
export function issueArtifactPreviewRoutes(options: {
   issues: IssueRepository;
   tokens: PreviewTokens;
   builds?: SiteBuilds | null;
}) {
   const route = new Hono<{ Variables: AuthVariables }>();

   const issueFor = async (context: { req: { param: (name: string) => string | undefined }; get: (key: 'user') => { id: string } }, permission: 'product.read' | 'product.write') => {
      const issue = await options.issues.get(context.req.param('issueRef') ?? '').catch(() => {
         throw ApiError.notFound('Issue');
      });
      await options.issues.authorize(context.get('user').id, issue.id, permission).catch(rethrow);
      return issue;
   };

   /** Where the site build of this task stands, and whether this server can build at all. */
   route.get('/:issueRef/artifacts/preview/build', async (context) => {
      const issue = await issueFor(context, 'product.read');
      if (!options.builds) return json({ available: false, state: 'idle', log: '', startedAt: null, finishedAt: null });
      return json({ available: await options.builds.available(), ...(await options.builds.status(issue.id)) });
   });

   /**
    * Builds the task's web project for its preview. Runs the agent's code, in a
    * container, so it takes write access to the task rather than read.
    */
   route.post('/:issueRef/artifacts/preview/build', async (context) => {
      const issue = await issueFor(context, 'product.write');
      if (!options.builds || !(await options.builds.available())) {
         throw new ApiError(503, 'BUILDS_UNAVAILABLE', 'This server cannot build sites: Docker is not available.');
      }
      // `{ "force": true }` builds again even when the current files are built.
      const body = (await context.req.json().catch(() => ({}))) as { force?: unknown };
      return json({ available: true, ...(await options.builds.start(issue.id, { force: body?.force === true })) }, 202);
   });

   route.post('/:issueRef/artifacts/preview', async (context) => {
      const issue = await options.issues.get(context.req.param('issueRef') ?? '').catch(() => {
         throw ApiError.notFound('Issue');
      });
      await options.issues.authorize(context.get('user').id, issue.id, 'product.read').catch(rethrow);
      const { token, expiresAt } = options.tokens.issue(issue.id);
      return json({ baseUrl: `/api/v1/previews/${token}/`, expiresAt });
   });
   return route;
}

/** `GET /api/v1/previews/:token/<path>`: one of the task's files, sandboxed. No session. */
/** Where a built site is served under a preview base. */
export const BUILD_PREFIX = '__build__/';

export function artifactPreviewMounts(options: {
   artifacts: RunArtifactRepository;
   tokens: PreviewTokens;
   storage: Storage | null;
   builds?: SiteBuilds | null;
}): Mount[] {
   const route = new Hono();
   route.get('/:token/*', async (context) => {
      const issueId = options.tokens.verify(context.req.param('token'));
      if (!issueId) return notFound();
      const prefix = `/api/v1/previews/${context.req.param('token')}/`;
      const pathname = new URL(context.req.url).pathname;
      let path: string;
      try {
         path = decodeURIComponent(pathname.startsWith(prefix) ? pathname.slice(prefix.length) : '');
      } catch {
         return notFound();
      }
      // The built site, when the task's project has been built for preview.
      // `__build__` without its slash too: Next's proxy strips trailing slashes.
      if (path === BUILD_PREFIX.slice(0, -1)) path = BUILD_PREFIX;
      if (path.startsWith(BUILD_PREFIX)) {
         const built = options.builds ? await options.builds.file(issueId, path.slice(BUILD_PREFIX.length)) : null;
         if (!built) return notFound();
         return serve(built.bytes, previewContentType(built.path, 'application/octet-stream'), `${prefix}${BUILD_PREFIX}`, {
            app: true,
         });
      }
      // A directory, or the base itself, is its index page — how a static
      // host answers, and what a site's own links expect.
      if (path === '' || path.endsWith('/')) path = `${path}index.html`;
      const artifact = await options.artifacts.getByPath(issueId, path);
      if (!artifact || !options.storage) return notFound();
      const bytes = await options.storage.open(artifact.storageKey).catch((error: unknown) => {
         if (error instanceof ObjectNotFound) return null;
         throw error;
      });
      if (!bytes) return notFound();
      const type = previewContentType(artifact.path, artifact.contentType);
      const root = /^text\/(html|css)\b/.test(type) ? `${prefix}${await siteRoot(options.artifacts, issueId)}` : '';
      return serve(bytes, type, root);
   });
   return [{ prefix: '/api/v1/previews', handler: route }];
}

/**
 * Storage for a page with no origin of its own.
 *
 * A sandboxed page (no `allow-same-origin`, which would hand the agent's
 * scripts Berry's session) throws a SecurityError on `localStorage`,
 * `sessionStorage` and `document.cookie`. Most apps touch one of them while
 * they start, so a built React site crashed to a blank frame. These stand-ins
 * keep the values in memory for the life of the page, and are only installed
 * where the real ones are refused.
 */
export const SANDBOX_SHIM = `<script>(function(){function m(){var d={};return{get length(){return Object.keys(d).length},key:function(i){return Object.keys(d)[i]??null},getItem:function(k){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[k]=String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}}}}["localStorage","sessionStorage"].forEach(function(n){try{window[n].getItem("x")}catch(e){try{Object.defineProperty(window,n,{value:m(),configurable:true})}catch(_){}}});try{void document.cookie}catch(e){var c="";try{Object.defineProperty(document,"cookie",{get:function(){return c},set:function(v){var p=String(v).split(";")[0];c=c?c+"; "+p:p},configurable:true})}catch(_){}}})();</script>`;

/**
 * Back and forward for a page Berry cannot reach into.
 *
 * The page has no origin, so Berry's Preview bar cannot read or drive its
 * history; it asks by message instead, and the page reports what it can do.
 *
 * Every history entry the page makes carries its position (`__berryIdx` in
 * `history.state`, copied into the app's own state object, never replacing
 * it), and a traversal reads the position of the entry it landed on — so the
 * count cannot drift, whoever moved the history. `window.name`, which survives
 * a page load inside the frame, carries it across full page loads.
 *
 * A step is only taken where the page has an entry to go to; stepping past its
 * first would move Berry's own page. While one is in flight further requests
 * are refused (a double-click used to send two, and the second left the
 * site), and the page reports it cannot move until the step lands.
 */
export const NAV_BRIDGE = `<script>(function(){var K="berry-preview:",s={i:0,m:0,p:null},ps=history.pushState,rs=history.replaceState,pending=0;try{var o=JSON.parse(window.name||"{}");if(o&&o.b===1)s={i:o.i|0,m:o.m|0,p:o.p||null}}catch(e){}function idx(st){return st&&typeof st==="object"&&typeof st.__berryIdx==="number"?st.__berryIdx:null}function stamp(st){if(st==null)return{__berryIdx:s.i};if(typeof st!=="object"||Array.isArray(st))return st;var c={};for(var k in st)if(Object.prototype.hasOwnProperty.call(st,k))c[k]=st[k];c.__berryIdx=s.i;return c}var here=idx(history.state),nav=(performance.getEntriesByType&&performance.getEntriesByType("navigation")[0]||{}).type;if(here!==null)s.i=here;else if(s.p==="back")s.i=Math.max(0,s.i-1);else if(s.p==="forward")s.i=Math.min(s.m,s.i+1);else if(nav==="navigate"&&window.name){s.i++;s.m=s.i}s.m=Math.max(s.m,s.i);s.p=null;try{rs.call(history,stamp(history.state),"")}catch(e){}function save(){try{window.name=JSON.stringify({b:1,i:s.i,m:s.m,p:s.p})}catch(e){}}function post(){save();try{parent.postMessage({type:K+"state",canBack:s.i>0&&s.p===null,canForward:s.i<s.m&&s.p===null},"*")}catch(e){}}history.pushState=function(st,t,u){s.i++;s.m=s.i;var r=ps.call(history,stamp(st),t,u);post();return r};history.replaceState=function(st,t,u){return rs.call(history,stamp(st),t,u)};function settle(){clearTimeout(pending);s.p=null;post()}addEventListener("popstate",function(e){var x=idx(e.state);if(x!==null)s.i=x;else if(s.p==="back")s.i=Math.max(0,s.i-1);else if(s.p==="forward")s.i=Math.min(s.m,s.i+1);settle()});addEventListener("message",function(e){if(e.source!==parent||!e.data||e.data.type!==K+"go")return;if(s.p!==null){post();return}if(e.data.dir<0&&s.i>0){s.p="back";save();pending=setTimeout(settle,2000);history.back()}else if(e.data.dir>0&&s.i<s.m){s.p="forward";save();pending=setTimeout(settle,2000);history.forward()}else post()});addEventListener("pagehide",save);if(document.readyState==="loading")addEventListener("DOMContentLoaded",post);else post();save()})();</script>`;

/** The stand-ins and the navigation bridge, first thing in the page, before any of its own scripts. */
export function withSandboxShim(html: string): string {
   const SHIMS = SANDBOX_SHIM + NAV_BRIDGE;
   const head = /<head\b[^>]*>/i.exec(html);
   if (head) return html.slice(0, head.index + head[0].length) + SHIMS + html.slice(head.index + head[0].length);
   const doctype = /<!doctype[^>]*>/i.exec(html);
   if (doctype) return html.slice(0, doctype.index + doctype[0].length) + SHIMS + html.slice(doctype.index + doctype[0].length);
   return SHIMS + html;
}

/**
 * A built single-page app, shown as its host would serve it: its router reads
 * `/`, not the preview's long path, or it renders its own "page not found".
 * The address is rewritten before any of its scripts run, and a `<base>`
 * keeps its relative assets and lazily loaded chunks resolving from the build.
 */
export function asAppRoot(html: string, root: string): string {
   // `berry-route` is the route the app was on before the preview had to
   // reopen it (see frontend/proxy.ts); only a path on this host is taken.
   const base = `<base href="${root.replace(/"/g, '&quot;')}"><script>try{var r=new URLSearchParams(location.search).get("berry-route");history.replaceState(history.state,"",r&&r.charAt(0)==="/"&&r.charAt(1)!=="/"?r:"/"+location.search+location.hash)}catch(e){}</script>`;
   const head = /<head\b[^>]*>/i.exec(html);
   if (head) return html.slice(0, head.index + head[0].length) + base + html.slice(head.index + head[0].length);
   return base + html;
}

/** A preview file, sandboxed; HTML and CSS have their root-absolute URLs pointed at `root`. */
function serve(bytes: Uint8Array, type: string, root: string, options: { app?: boolean } = {}): Response {
   let body = bytes;
   if (/^text\/(html|css)\b/.test(type)) {
      let text = new TextDecoder().decode(bytes);
      if (root) text = rootRelative(text, type, root);
      if (type.startsWith('text/html')) {
         if (options.app) text = asAppRoot(text, root);
         // Last in, so first in the page: storage before anything reads it.
         text = withSandboxShim(text);
      }
      body = new TextEncoder().encode(text);
   }
   return new Response(body, {
      status: 200,
      headers: { ...SANDBOX_HEADERS, 'Content-Type': type, 'Content-Length': String(body.byteLength) },
   });
}

/**
 * The folder a site lives in: where its shallowest `index.html` sits, so that
 * `dist/index.html` makes `dist/` the site's `/`. Empty when there is none.
 */
async function siteRoot(artifacts: RunArtifactRepository, issueId: string): Promise<string> {
   const pages = (await artifacts.listForIssue(issueId))
      .map((artifact) => artifact.path)
      .filter((path) => path === 'index.html' || path.endsWith('/index.html'))
      .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
   const entry = pages[0];
   return entry ? entry.slice(0, entry.length - 'index.html'.length) : '';
}

/**
 * Root-absolute URLs (`/assets/app.js`, `/favicon.svg`) pointed at the site's
 * root inside the preview instead of Berry's own root. Built sites use them by
 * default (Vite's `base: '/'`), and served as they are they would load Berry's
 * pages, not the site's. Protocol-relative `//host` URLs are left alone.
 */
export function rootRelative(text: string, type: string, root: string): string {
   if (type.startsWith('text/css')) {
      return text.replace(/url\(\s*(["']?)\/(?!\/)/gi, (_match, quote: string) => `url(${quote}${root}`);
   }
   return text.replace(
      /(\s(?:src|href|action|poster)\s*=\s*["'])\/(?!\/)/gi,
      (_match, lead: string) => `${lead}${root}`
   );
}

/** Plain, sandboxed and identical for every miss: a bad token and a missing file read the same. */
function notFound(): Response {
   return new Response('Not found', {
      status: 404,
      headers: { ...SANDBOX_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' },
   });
}

function rethrow(error: unknown): never {
   if (error instanceof NotFound) throw ApiError.notFound('Issue');
   if (error instanceof Forbidden) {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
   }
   throw error;
}
