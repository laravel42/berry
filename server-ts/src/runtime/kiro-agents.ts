import { execFile } from 'node:child_process';

export interface KiroAgent {
   id: string;
   name: string;
}

const ANSI = /\u001b\[[0-9;]*m/g;

/** Built-in profiles `kiro-cli agent list` ships when the CLI cannot be read. */
const BUILTIN: KiroAgent[] = [
   { id: 'kiro_default', name: 'Default agent' },
   { id: 'kiro_help', name: 'Help agent' },
   { id: 'kiro_planner', name: 'Planning agent' },
];

/** Parses `kiro-cli agent list`. Header lines and blank rows are skipped. */
export function parseKiroAgentList(text: string): KiroAgent[] {
   const agents: KiroAgent[] = [];
   for (const raw of text.replace(ANSI, '').split('\n')) {
      const line = raw.trim();
      if (line === '' || line.startsWith('Workspace') || line.startsWith('Global')) continue;
      const match = /^\*?\s*([A-Za-z][A-Za-z0-9_-]{0,79})\s+(?:\(Built-in\)\s+)?(.*)$/.exec(line);
      const id = match?.[1];
      if (!id) continue;
      const name = (match?.[2] ?? '').trim();
      agents.push({ id, name: name === '' ? id : name });
   }
   return agents;
}

/** Agents installed for the person running Berry. Falls back to the built-in three. */
export function listKiroAgents(): Promise<KiroAgent[]> {
   return new Promise((resolve) => {
      execFile(
         'kiro-cli',
         ['agent', 'list'],
         { timeout: 15_000, env: process.env },
         (error, stdout) => {
            if (error) {
               resolve(BUILTIN);
               return;
            }
            const parsed = parseKiroAgentList(stdout);
            resolve(parsed.length > 0 ? parsed : BUILTIN);
         }
      );
   });
}
