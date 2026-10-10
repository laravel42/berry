import { chmod, rm } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { createInterface } from 'node:readline';
import type { Tool, ToolContext } from '@strands-agents/sdk';
import { WORKDIR_KEY } from '../command-tool.ts';

/**
 * The only tools Kiro may call. Native shell and filesystem stay denied in
 * the ACP permission handler. This server exposes the tools Berry already
 * admitted for the run.
 */
export class BerryMcpHost {
   readonly #server: Server;
   readonly #tools: Tool[];
   readonly #workingDirectory: string;
   readonly #signal: AbortSignal;
   readonly #socketPath: string;

   constructor(socketPath: string, tools: Tool[], workingDirectory: string, signal: AbortSignal) {
      this.#socketPath = socketPath;
      this.#tools = tools;
      this.#workingDirectory = workingDirectory;
      this.#signal = signal;
      this.#server = createServer((socket) => {
         void this.#serve(socket);
      });
   }

   listen(): Promise<void> {
      return new Promise((resolve, reject) => {
         let retried = false;
         const onError = (error: NodeJS.ErrnoException) => {
            this.#server.removeListener('error', onError);
            if (error.code === 'EADDRINUSE' && !retried) {
               retried = true;
               void rm(this.#socketPath, { force: true }).then(start, reject);
               return;
            }
            reject(error);
         };
         const start = () => {
            this.#server.once('error', onError);
            this.#server.listen(this.#socketPath, () => {
               this.#server.removeListener('error', onError);
               void chmod(this.#socketPath, 0o600).then(() => resolve(), reject);
            });
         };
         void rm(this.#socketPath, { force: true }).then(start, reject);
      });
   }

   async close(): Promise<void> {
      await new Promise<void>((resolve) => this.#server.close(() => resolve()));
      await rm(this.#socketPath, { force: true });
   }

   async #serve(socket: Socket): Promise<void> {
      const lines = createInterface({ input: socket });
      for await (const line of lines) {
         const trimmed = line.trim();
         if (trimmed === '') continue;
         let message: { id?: number; method?: string; params?: { name?: string; arguments?: unknown } };
         try {
            message = JSON.parse(trimmed) as typeof message;
         } catch {
            continue;
         }
         const response = await this.#respond(message);
         if (response) socket.write(`${JSON.stringify(response)}\n`);
      }
   }

   async #respond(message: {
      id?: number;
      method?: string;
      params?: { name?: string; arguments?: unknown };
   }): Promise<unknown | null> {
      if (message.id === undefined) return null;
      if (message.method === 'ping' || message.method === 'initialize') {
         return {
            jsonrpc: '2.0',
            id: message.id,
            result:
               message.method === 'ping'
                  ? {}
                  : {
                       protocolVersion: '2024-11-05',
                       capabilities: { tools: {} },
                       serverInfo: { name: 'berry', version: '1' },
                    },
         };
      }
      if (message.method === 'tools/list') {
         return {
            jsonrpc: '2.0',
            id: message.id,
            result: {
               tools: this.#tools.map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  inputSchema: tool.toolSpec?.inputSchema ?? { type: 'object', properties: {} },
               })),
            },
         };
      }
      if (message.method === 'tools/call') {
         const name = message.params?.name ?? '';
         const tool = this.#tools.find((candidate) => candidate.name === name);
         if (!tool) {
            return {
               jsonrpc: '2.0',
               id: message.id,
               result: { content: [{ type: 'text', text: `Unknown tool ${name}` }], isError: true },
            };
         }
         try {
            const value = await invokeStrandsTool(tool, message.params?.arguments ?? {}, this.#workingDirectory, this.#signal);
            return {
               jsonrpc: '2.0',
               id: message.id,
               result: { content: [{ type: 'text', text: stringifyToolResult(value) }], isError: false },
            };
         } catch (cause) {
            const text = cause instanceof Error ? cause.message : 'The tool failed.';
            return {
               jsonrpc: '2.0',
               id: message.id,
               result: { content: [{ type: 'text', text: text.slice(0, 2000) }], isError: true },
            };
         }
      }
      return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } };
   }
}

export async function invokeStrandsTool(
   tool: Tool,
   input: unknown,
   workingDirectory: string,
   signal: AbortSignal
): Promise<unknown> {
   const context = {
      toolUse: { name: tool.name, toolUseId: `kiro-${tool.name}`, input },
      agent: { appState: new Map([[WORKDIR_KEY, workingDirectory]]) },
      invocationState: new Map<string, unknown>(),
      cancelSignal: signal,
   } as unknown as ToolContext;
   const candidate = tool as unknown as { invoke?: (value: unknown, toolContext: ToolContext) => Promise<unknown> };
   if (typeof candidate.invoke === 'function') return candidate.invoke(input, context);
   const stream = tool.stream(context);
   let next = await stream.next();
   while (!next.done) next = await stream.next();
   return next.value;
}

export function stringifyToolResult(value: unknown): string {
   if (typeof value === 'string') return value;
   try {
      return JSON.stringify(value) ?? '';
   } catch {
      return '';
   }
}
