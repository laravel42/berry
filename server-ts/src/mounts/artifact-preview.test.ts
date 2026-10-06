import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RunArtifact, RunArtifactRepository } from '../core/run-artifacts.ts';
import { createApp } from '../http/app.ts';
import { Registry } from '../http/registry.ts';
import type { Storage } from '../storage/storage.ts';
import { artifactPreviewMounts, NAV_BRIDGE, PreviewTokens, previewAssetUrl, previewContentType, rootRelative, SANDBOX_SHIM as STORAGE_SHIM, withSandboxShim, asAppRoot } from './artifact-preview.ts';
import type { SiteBuilds } from '../previews/site-builds.ts';

/** Everything injected ahead of a preview page's own markup. */
const SANDBOX_SHIM = STORAGE_SHIM + NAV_BRIDGE;

const ISSUE = '6f1c0c52-2c6e-4d7c-9a47-0f7f3c1c9b10';
const OTHER = '7a2d1d63-3d7f-4e8d-8b58-1a8a4d2dac21';

test('a token reads its own issue, and no other, until it expires', () => {
   let now = Date.parse('2026-09-19T08:00:00Z');
   const tokens = new PreviewTokens({ secret: 's'.repeat(32), now: () => now });
   const { token } = tokens.issue(ISSUE);
   assert.equal(tokens.verify(token), ISSUE);
   // Same secret, another process: still valid.
   assert.equal(new PreviewTokens({ secret: 's'.repeat(32), now: () => now }).verify(token), ISSUE);
   // Pointed at another issue, or signed with another key: refused.
   assert.equal(tokens.verify(token.replace(ISSUE, OTHER)), null);
   assert.equal(new PreviewTokens({ secret: 't'.repeat(32), now: () => now }).verify(token), null);
   assert.equal(tokens.verify('garbage'), null);
   now += 61 * 60 * 1000;
   assert.equal(tokens.verify(token), null);
});

test('the type a browser needs comes from the extension, since agents store text/plain', () => {
   assert.equal(previewContentType('site/index.html', 'text/plain; charset=utf-8'), 'text/html; charset=utf-8');
   assert.equal(previewContentType('site/app.js', 'text/plain'), 'text/javascript; charset=utf-8');
   assert.equal(previewContentType('clip.mp4', 'application/octet-stream'), 'video/mp4');
   // A deliberate type on an unknown extension stands; an unknown one is text.
   assert.equal(previewContentType('render.bin', 'image/png'), 'image/png');
   assert.equal(previewContentType('Makefile', 'text/plain'), 'text/plain; charset=utf-8');
});

function artifact(path: string): RunArtifact {
   return {
      id: `id-${path}`, issueId: ISSUE, runId: 'r', workspaceId: 'w', path, name: path.split('/').pop()!,
      directory: '', contentType: 'text/plain; charset=utf-8', sizeBytes: 1, storageKey: `k/${path}`,
      agentName: 'Frontend Engineer', createdAt: '2026-09-19T08:00:00Z',
   };
}

function app(files: Record<string, string>) {
   const tokens = new PreviewTokens({ secret: 's'.repeat(32) });
   const artifacts = {
      async getByPath(issueId: string, path: string) {
         return issueId === ISSUE && path in files ? artifact(path) : null;
      },
      async listForIssue() {
         return Object.keys(files).map(artifact);
      },
   } as unknown as RunArtifactRepository;
   const storage = {
      async open(key: string) {
         return new TextEncoder().encode(files[key.slice(2)] ?? '');
      },
   } as unknown as Storage;
   const registry = new Registry();
   registry.registerAll(artifactPreviewMounts({ artifacts, tokens, storage }));
   return { app: createApp(registry), base: `/api/v1/previews/${tokens.issue(ISSUE).token}/` };
}

test('a site is served at its own paths, sandboxed and framable only by Berry', async () => {
   const { app: server, base } = app({ 'site/index.html': '<link href="style.css">', 'site/style.css': 'body{}' });
   const page = await server.request(`${base}site/`);
   assert.equal(page.status, 200);
   assert.equal(page.headers.get('content-type'), 'text/html; charset=utf-8');
   // The storage stand-ins come first, then the page as the agent wrote it.
   assert.equal(await page.text(), `${SANDBOX_SHIM}<link href="style.css">`);
   const policy = page.headers.get('content-security-policy') ?? '';
   assert.match(policy, /^sandbox allow-scripts/);
   assert.match(policy, /frame-ancestors 'self'/);
   assert.doesNotMatch(policy, /allow-same-origin/);
   assert.equal(page.headers.get('x-frame-options'), null);
   // Module scripts from a sandboxed (null-origin) page are CORS requests.
   assert.equal(page.headers.get('access-control-allow-origin'), '*');
   // A proxy in front of Berry must serve the agent's page as it is.
   assert.match(page.headers.get('cache-control') ?? '', /\bno-transform\b/);

   const css = await server.request(`${base}site/style.css`);
   assert.equal(css.headers.get('content-type'), 'text/css; charset=utf-8');
});

test('a bad token, a missing file and a climb out of the tree all read as one 404', async () => {
   const { app: server, base } = app({ 'site/index.html': 'x' });
   for (const url of [
      '/api/v1/previews/nope/site/index.html',
      `${base}site/missing.js`,
      `${base}site/../../etc/passwd`,
      `${base}%E0%A4%A`,
   ]) {
      const response = await server.request(url);
      assert.equal(response.status, 404, url);
      assert.match(response.headers.get('content-security-policy') ?? '', /^sandbox/);
   }
});

test('root-absolute links point at the site inside the preview, not at Berry', async () => {
   const { app: server, base } = app({
      'dist/index.html': '<script type="module" src="/assets/app.js"></script><a href="//cdn.test/x">cdn</a>',
      'dist/assets/app.css': 'body{background:url("/assets/bg.png")}',
   });
   const page = await (await server.request(`${base}dist/index.html`)).text();
   assert.equal(page, `${SANDBOX_SHIM}<script type="module" src="${base}dist/assets/app.js"></script><a href="//cdn.test/x">cdn</a>`);
   const css = await (await server.request(`${base}dist/assets/app.css`)).text();
   assert.equal(css, `body{background:url("${base}dist/assets/bg.png")}`);
});

test('relative links are left as they are', () => {
   assert.equal(rootRelative('<img src="logo.png">', 'text/html', '/b/'), '<img src="logo.png">');
   assert.equal(rootRelative('a{b:url(img.png)}', 'text/css', '/b/'), 'a{b:url(img.png)}');
});

test('the sandbox stand-ins go first in the head, before the page\'s own scripts', () => {
   assert.match(SANDBOX_SHIM, /window\.Worker=P/, 'a null origin cannot start a worker from Berry\'s host');
   assert.equal(
      withSandboxShim('<!doctype html><html><head><script src="a.js"></script></head></html>'),
      `<!doctype html><html><head>${SANDBOX_SHIM}<script src="a.js"></script></head></html>`
   );
   assert.equal(withSandboxShim('<!DOCTYPE html><p>x</p>'), `<!DOCTYPE html>${SANDBOX_SHIM}<p>x</p>`);
});

test('a built app is shown at / with its assets resolving from the build folder', () => {
   const page = asAppRoot('<html><head><script type="module" src="./assets/app.js"></script></head></html>', '/api/v1/previews/t/__build__/');
   assert.match(page, /^<html><head><base href="\/api\/v1\/previews\/t\/__build__\/"><script>try\{[^<]*history\.replaceState/);
   assert.ok(page.indexOf('<base') < page.indexOf('./assets/app.js'));
});

test('a built app reopened by the preview starts on the route it was on, and only a route on this host', () => {
   const page = asAppRoot('<html><head></head></html>', '/api/v1/previews/t/__build__/');
   // The address the app's router reads is the route when one is given…
   assert.match(page, /get\("berry-route"\)/);
   // …and only a same-host path: not "//evil.test", not "https://…".
   assert.match(page, /r\.charAt\(0\)==="\/"&&r\.charAt\(1\)!=="\/"/);
   // A path-absolute fetch or navigation stays inside the build. The page's
   // origin is null, so calling Berry's own /api or /admin is refused.
   assert.match(page, /window\.fetch=function/);
   assert.match(page, /navigation\.addEventListener\("navigate"/);
});

test('a root-absolute request is served from the build, and anything else is left alone', () => {
   const base = 'http://localhost:3000/api/v1/previews/t/__build__/';
   const page = `${base}index.html`;
   assert.equal(
      previewAssetUrl(base, page, '/api/admin/sessions'),
      `${base}api/admin/sessions`
   );
   assert.equal(previewAssetUrl(base, page, '/admin'), `${base}admin`);
   assert.equal(previewAssetUrl(base, page, `${base}assets/app.js`), null);
   assert.equal(previewAssetUrl(base, page, 'https://cdn.test/app.js'), null);
   assert.equal(previewAssetUrl(base, page, '//cdn.test/app.js'), null);
});

test('a sandboxed app can preflight its own API, and a client route reopens the app', async () => {
   const tokens = new PreviewTokens({ secret: 's'.repeat(32) });
   const index = '<html><head><title>App</title></head><body>app</body></html>';
   const builds = {
      async file(_issueId: string, path: string) {
         return path === 'index.html' ? { bytes: new TextEncoder().encode(index), path } : null;
      },
   } as unknown as SiteBuilds;
   const registry = new Registry();
   registry.registerAll(artifactPreviewMounts({
      artifacts: { async getByPath() { return null; }, async listForIssue() { return []; } } as unknown as RunArtifactRepository,
      tokens,
      storage: null,
      builds,
   }));
   const server = createApp(registry);
   const base = `/api/v1/previews/${tokens.issue(ISSUE).token}/`;

   const preflight = await server.request(`${base}__build__/api/admin/sessions`, {
      method: 'OPTIONS',
      headers: { Origin: 'null', 'Access-Control-Request-Method': 'GET' },
   });
   assert.equal(preflight.status, 204);
   assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
   assert.match(preflight.headers.get('access-control-allow-methods') ?? '', /\bGET\b/);
   assert.equal(preflight.headers.get('access-control-allow-headers'), '*');

   const api = await server.request(`${base}__build__/api/admin/sessions`, { headers: { 'Sec-Fetch-Dest': 'empty' } });
   assert.equal(api.status, 404);
   assert.equal(api.headers.get('access-control-allow-origin'), '*');

   const route = await server.request(`${base}__build__/admin`, { headers: { 'Sec-Fetch-Dest': 'iframe' } });
   assert.equal(route.status, 200);
   assert.match(await route.text(), /<title>App<\/title>/);
   assert.match(route.headers.get('content-type') ?? '', /^text\/html/);
});
