import type { AgentProcessAdapter } from './types.ts';

export class RuntimeAdapterRegistry {
   readonly #agentProcesses = new Map<string, AgentProcessAdapter>();

   constructor(adapters: readonly AgentProcessAdapter[]) {
      for (const adapter of adapters) {
         if (this.#agentProcesses.has(adapter.identity.id)) {
            throw new Error(`duplicate runtime adapter ${adapter.identity.id}`);
         }
         this.#agentProcesses.set(adapter.identity.id, adapter);
      }
   }

   agentProcess(id: string): AgentProcessAdapter | null {
      return this.#agentProcesses.get(id) ?? null;
   }

   identities() {
      return [...this.#agentProcesses.values()].map((adapter) => adapter.identity);
   }

   async disconnect(): Promise<void> {
      await Promise.all([...this.#agentProcesses.values()].map((adapter) => adapter.disconnect()));
   }
}
