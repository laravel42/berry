import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const port = Number(process.env.PORT || 4175);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8' };
http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' }); res.end(data);
  } catch { res.writeHead(404, { 'content-type': 'text/html' }); res.end(await readFile(path.join(root, '404.html'))); }
}).listen(port, '127.0.0.1', () => console.log(`Berry docs: http://127.0.0.1:${port}`));
