// What berry-screenshots and berry-lighthouse check: a URL as given, or a
// folder (or a file in one) served here for as long as the check runs.
//
// Agents started `npx serve …` in the background before every check, and a
// command's background processes end with the command, so each check started
// the server again. Given a path, the helpers serve it themselves.
'use strict';
const http = require('node:http');
const { createReadStream, statSync } = require('node:fs');
const { basename, dirname, extname, join, normalize, resolve, sep } = require('node:path');

const TYPES = {
   '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
   '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json',
   '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
   '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
   '.ttf': 'font/ttf', '.otf': 'font/otf', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
   '.webmanifest': 'application/manifest+json', '.mp4': 'video/mp4', '.webm': 'video/webm', '.wasm': 'application/wasm',
};

function fileFor(root, urlPath) {
   let path;
   try {
      path = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
   } catch {
      return null;
   }
   const full = normalize(join(root, path));
   if (full !== root && !full.startsWith(root + sep)) return null;
   try {
      const info = statSync(full);
      if (info.isDirectory()) return fileFor(root, join(path, 'index.html'));
      return info.isFile() ? full : null;
   } catch {
      return null;
   }
}

/** `{ url, close }` for a URL or a local path; `close` stops a server this started. */
async function target(arg) {
   if (/^https?:\/\//i.test(arg)) return { url: arg, served: null, close: async () => {} };
   const full = resolve(arg);
   let info;
   try {
      info = statSync(full);
   } catch {
      throw new Error(`${arg} is neither a URL nor a file or folder here`);
   }
   const root = info.isDirectory() ? full : dirname(full);
   const entry = info.isDirectory() ? '' : basename(full);
   const server = http.createServer((request, response) => {
      const file = fileFor(root, request.url || '/');
      if (!file) {
         response.writeHead(404, { 'content-type': 'text/plain' });
         response.end('Not found');
         return;
      }
      response.writeHead(200, { 'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream' });
      createReadStream(file).pipe(response);
   });
   await new Promise((done) => server.listen(0, '127.0.0.1', done));
   const { port } = server.address();
   return {
      url: `http://127.0.0.1:${port}/${encodeURI(entry)}`,
      served: root,
      close: () => new Promise((done) => server.close(() => done())),
   };
}

module.exports = { target };
