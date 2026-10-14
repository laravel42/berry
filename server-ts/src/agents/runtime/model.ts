import type { BaseModelConfig, Model } from '@strands-agents/sdk';

/**
 * The one place a native model would be built.
 *
 * Bedrock and Kilo factories are gone. Subscription runtimes own their own
 * model clients. This module keeps the factory type so tests can still inject
 * a scripted model, and so a native call fails in one place.
 */

export interface AwsCredentials {
   accessKeyId: string;
   secretAccessKey: string;
   sessionToken?: string;
}

export interface ModelSpec {
   model: string;
   region: string;
   credentials?: AwsCredentials | null | undefined;
   maxTokens?: number | undefined;
   temperature?: number | undefined;
   stream?: boolean | undefined;
   sessionId?: string | undefined;
   cacheConversation?: boolean | undefined;
   onReasoning?: ((text: string) => void) | undefined;
}

export type ModelFactory = (spec: ModelSpec) => Model<BaseModelConfig>;

export const DEFAULT_MAX_TOKENS = 32_000;

export function maxTokensFor(_model: string, requested: number): number {
   return requested;
}

export function nativeModelUnavailable(_spec: ModelSpec): never {
   throw new Error(
      'this deployment has no native model provider; connect a subscription AI runtime'
   );
}
