import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RunArtifact, RunArtifactRepository } from '../core/run-artifacts.ts';
import { createApp } from '../http/app.ts';
import { Registry } from '../http/registry.ts';
import type { Storage } from '../storage/storage.ts';
import { artifactPreviewMounts, PreviewTokens, previewContentType, rootRelative } from './artifact-preview.ts';

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
   assert.equal(await page.text(), '<link href="style.css">');
   const policy = page.headers.get('content-security-policy') ?? '';
   assert.match(policy, /^sandbox allow-scripts/);
   assert.match(policy, /frame-ancestors 'self'/);
   assert.doesNotMatch(policy, /allow-same-origin/);
   assert.equal(page.headers.get('x-frame-options'), null);
   // Module scripts from a sandboxed (null-origin) page are CORS requests.
   assert.equal(page.headers.get('access-control-allow-origin'), '*');

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
   assert.equal(page, `<script type="module" src="${base}dist/assets/app.js"></script><a href="//cdn.test/x">cdn</a>`);
   const css = await (await server.request(`${base}dist/assets/app.css`)).text();
   assert.equal(css, `body{background:url("${base}dist/assets/bg.png")}`);
});

test('relative links are left as they are', () => {
   assert.equal(rootRelative('<img src="logo.png">', 'text/html', '/b/'), '<img src="logo.png">');
   assert.equal(rootRelative('a{b:url(img.png)}', 'text/css', '/b/'), 'a{b:url(img.png)}');
});
