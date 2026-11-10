import { BedrockModel } from '@strands-agents/sdk';
import type { TaskEnvelope } from '../../runtime/envelope.ts';
import type { AwsCredentials, ModelFactory } from './model.ts';

/**
 * The model Berry provides, called from the runtime image
 * (src/runtime/platform-model.ts on the server side).
 *
 * The envelope names the model and region and carries no credential: the call
 * is signed with this host's own AWS credentials. Those are the runtime's
 * environment locally, else the default chain, which on AgentCore and Lambda
 * MicroVMs is the host's role.
 */
export function bedrockModelFactory(
   platform: NonNullable<TaskEnvelope['platformModel']>,
   credentials: AwsCredentials | null | undefined
): ModelFactory {
   return (spec) =>
      new BedrockModel({
         modelId: platform.model,
         region: platform.region,
         ...(credentials ? { clientConfig: { credentials } } : {}),
         ...(spec.maxTokens ? { maxTokens: spec.maxTokens } : {}),
         ...(spec.temperature !== undefined ? { temperature: spec.temperature } : {}),
      });
}
