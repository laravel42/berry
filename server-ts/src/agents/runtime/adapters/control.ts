import type { RuntimeControlRequest, RuntimeControlResponse } from '../../../runtime/envelope.ts';
import type { RuntimeAdapterRegistry } from './registry.ts';
import { RuntimeAdapterError } from './types.ts';

/** Executes non-inference adapter control operations inside the runtime image. */
export async function handleRuntimeControl(
   registry: RuntimeAdapterRegistry | undefined,
   request: RuntimeControlRequest
): Promise<RuntimeControlResponse> {
   const adapter = registry?.agentProcess(request.runtimeId) ?? null;
   if (!adapter) {
      return {
         ok: false,
         error: {
            code: 'RUNTIME_NOT_INSTALLED',
            message: `${request.runtimeId} is not installed in this runtime image.`,
            retryable: false,
         },
      };
   }
   try {
      if (request.operation === 'availability') {
         return { ok: true, availability: await adapter.checkAvailability() };
      }
      if (request.operation === 'connection') {
         return { ok: true, connection: await adapter.connectionStatus(request.credential) };
      }
      if (!request.credential) {
         throw new RuntimeAdapterError('AUTH_REQUIRED', 'Connect this runtime before listing models.', false);
      }
      return { ok: true, models: await adapter.discoverModels(request.credential) };
   } catch (error) {
      if (error instanceof RuntimeAdapterError) {
         return {
            ok: false,
            error: { code: error.code, message: error.message, retryable: error.retryable },
         };
      }
      return {
         ok: false,
         error: {
            code: 'RUNTIME_ERROR',
            message: 'The runtime control operation failed.',
            retryable: true,
         },
      };
   }
}
