/**
 * Stdio MCP proxy for the Claude Code CLI.
 *
 * Claude frames JSON-RPC with `Content-Length`. Berry's tool host speaks one
 * JSON object per line on a Unix socket. This process is the only thing
 * between them. It sees tool names, not the CLI login.
 */
import { connect } from 'node:net';
import { createInterface } from 'node:readline';

const socketPath = process.argv[2];
if (!socketPath) process.exit(1);

const socket = connect(socketPath);
socket.on('error', () => process.exit(1));

const queued: string[] = [];
let wait: ((line: string) => void) | null = null;
createInterface({ input: socket }).on('line', (line) => {
   if (wait) {
      const resolve = wait;
      wait = null;
      resolve(line);
      return;
   }
   queued.push(line);
});

function nextLine(): Promise<string> {
   const line = queued.shift();
   if (line !== undefined) return Promise.resolve(line);
   return new Promise((resolve) => {
      wait = resolve;
   });
}

let incoming = Buffer.alloc(0);
let reading = false;

process.stdin.on('data', (chunk: Buffer | string) => {
   incoming = Buffer.concat([incoming, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
   void pump();
});

async function pump(): Promise<void> {
   if (reading) return;
   reading = true;
   try {
      for (;;) {
         const framed = takeFrame();
         if (framed === null) break;
         let message: { id?: unknown };
         try {
            message = JSON.parse(framed) as { id?: unknown };
         } catch {
            continue;
         }
         socket.write(`${framed}\n`);
         if (message.id === undefined) continue;
         const response = await nextLine();
         const body = Buffer.from(response, 'utf8');
         process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
         process.stdout.write(body);
      }
   } finally {
      reading = false;
   }
}

/** One JSON-RPC message, either Content-Length framed or a single JSON line. */
function takeFrame(): string | null {
   const source = incoming.toString('utf8');
   if (source.startsWith('{')) {
      const newline = source.indexOf('\n');
      if (newline === -1) return null;
      incoming = Buffer.from(source.slice(newline + 1), 'utf8');
      return source.slice(0, newline).trim();
   }
   const headerEnd = incoming.indexOf('\r\n\r\n');
   if (headerEnd === -1) return null;
   const header = incoming.subarray(0, headerEnd).toString('utf8');
   const match = /content-length:\s*(\d+)/i.exec(header);
   if (!match?.[1]) return null;
   const length = Number(match[1]);
   const start = headerEnd + 4;
   if (incoming.length < start + length) return null;
   const body = incoming.subarray(start, start + length).toString('utf8');
   incoming = incoming.subarray(start + length);
   return body;
}
