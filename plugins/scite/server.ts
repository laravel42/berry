import { API_URL_HEADER } from '@berry/plugin-sdk';
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { handleMcp, readPluginManifest } from './mcp.ts';

/** Serves the MCP endpoint an agent run calls. Berry's address arrives on each request. */
export function start(port: number): void {
   const server = createServer((req, res) => {
      void handleNode(req, res);
   });
   server.listen(port);
}

async function handleNode(req: IncomingMessage, res: ServerResponse): Promise<void> {
   const mcpPath = readPluginManifest().mcp?.path;
   if (req.method !== 'POST' || !mcpPath || req.url?.split('?')[0] !== mcpPath) {
      res.writeHead(404);
      res.end();
      return;
   }
   const chunks: Buffer[] = [];
   for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
   const response = await handleMcp({
      body: Buffer.concat(chunks).toString('utf8'),
      authorization: header(req.headers, 'authorization'),
      apiUrl: header(req.headers, API_URL_HEADER.toLowerCase()) ?? '',
   });
   res.writeHead(response.status, response.body ? { 'content-type': 'application/json' } : {});
   res.end(response.body);
}

function header(headers: IncomingHttpHeaders, name: string): string | null {
   const value = headers[name];
   return typeof value === 'string' ? value : null;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
   const manifest = readPluginManifest();
   const port = Number(process.env.PORT);
   if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT is required');
   start(port);
   process.stdout.write(`${manifest.name} plugin listening on ${port}\n`);
}
