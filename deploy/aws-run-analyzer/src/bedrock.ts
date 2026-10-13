import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { AnalysisRejected, RECORD_TOOL, RECORD_TOOL_SCHEMA, SYSTEM_PROMPT, parseAnalysis, type Analysis } from './analysis.ts';

export interface ModelCall {
   modelId: string;
   maxTokens: number;
}

export interface ModelAnswer {
   analysis: Analysis;
   inputTokens: number;
   outputTokens: number;
}

export function bedrockClient(region: string): BedrockRuntimeClient {
   return new BedrockRuntimeClient({ region, maxAttempts: 5, retryMode: 'adaptive' });
}

/** One Converse call, its answer forced through the record tool. */
export async function askModel(client: BedrockRuntimeClient, call: ModelCall, prompt: string): Promise<ModelAnswer> {
   const response = await client.send(
      new ConverseCommand({
         modelId: call.modelId,
         system: [{ text: SYSTEM_PROMPT }],
         messages: [{ role: 'user', content: [{ text: prompt }] }],
         inferenceConfig: { maxTokens: call.maxTokens, temperature: 0 },
         toolConfig: {
            tools: [
               {
                  toolSpec: {
                     name: RECORD_TOOL,
                     description: 'Record the review of this run.',
                     inputSchema: { json: RECORD_TOOL_SCHEMA as unknown as Record<string, never> },
                  },
               },
            ],
            toolChoice: { tool: { name: RECORD_TOOL } },
         },
      })
   );
   if (response.stopReason === 'max_tokens') {
      throw new AnalysisRejected(`the model ran out of output tokens (${call.maxTokens}) before finishing its findings`);
   }
   const use = response.output?.message?.content?.find((block) => block.toolUse?.name === RECORD_TOOL)?.toolUse;
   if (!use) throw new AnalysisRejected(`the model did not call ${RECORD_TOOL} (stop reason ${response.stopReason ?? 'unknown'})`);
   return {
      analysis: parseAnalysis(use.input),
      inputTokens: response.usage?.inputTokens ?? 0,
      outputTokens: response.usage?.outputTokens ?? 0,
   };
}
