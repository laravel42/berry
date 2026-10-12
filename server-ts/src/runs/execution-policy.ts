/** Workstation adapters that the dispatcher can execute without a native host. */
export const WORKSTATION_RUNTIME_KEYS = ['kiro', 'claude', 'codex', 'cursor', 'kimi', 'grok', 'qoder'] as const;

export interface TaskExecutionPolicy {
   nativeExecution: boolean;
   workstationKeys: readonly string[];
}

let policy: TaskExecutionPolicy | null = null;

/** Set once by the composition root; null keeps isolated repository tests unrestricted. */
export function configureTaskExecution(value: TaskExecutionPolicy | null): void {
   policy = value ? { nativeExecution: value.nativeExecution, workstationKeys: [...value.workstationKeys] } : null;
}

/** Subscription selection never silently becomes a native/API-billed run. */
export function taskExecutionAllowed(runtimeKey: string | null): boolean {
   if (!policy) return true;
   return runtimeKey === null ? policy.nativeExecution : policy.workstationKeys.includes(runtimeKey) || policy.nativeExecution;
}
