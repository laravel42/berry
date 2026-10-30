import {
   Model,
   ModelContentBlockDeltaEvent,
   ModelContentBlockStartEvent,
   ModelContentBlockStopEvent,
   ModelMessageStartEvent,
   ModelMessageStopEvent,
   ModelMetadataEvent,
   type BaseModelConfig,
   type Message,
   type ModelStreamEvent,
   type StreamOptions,
   type ToolSpec,
} from '@strands-agents/sdk';
import type { TaskEnvelope } from '../../runtime/envelope.ts';
import type { ModelFactory } from './model.ts';

/**
 * A pasted API token, called from the runtime image.
 *
 * The control plane seals the key and puts it on the envelope. This model
 * is the only caller: fetch, no provider SDK. The token is a header, never a
 * query string, and never copied into an error.
 */

const TIMEOUT_MS = 120_000;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ApiTokenModelOptions {
   runtimeId: string;
   model: string;
   token: string;
   maxTokens?: number | undefined;
   temperature?: number | undefined;
   fetchImpl?: FetchLike;
}

export class ApiTokenCallError extends Error {
   override readonly name = 'ApiTokenCallError';
   readonly status: number | null;

   constructor(message: string, status: number | null = null) {
      super(message);
      this.status = status;
   }
}

export function apiTokenModelFactory(
   envelope: TaskEnvelope,
   fetchImpl: FetchLike = fetch
): ModelFactory {
   return (spec) => {
      const runtime = envelope.runtime;
      if (!runtime || runtime.executionMode !== 'direct_inference') {
         throw new Error('this run has no API-token runtime');
      }
      if (runtime.credential.type !== 'api_key') {
         throw new Error('this API-token runtime has no usable credential');
      }
      const model = spec.model || runtime.model;
      if (!model) {
         throw new Error('Choose a model for this API token before running this task.');
      }
      return new ApiTokenModel({
         runtimeId: runtime.id,
         model,
         token: runtime.credential.token,
         maxTokens: spec.maxTokens,
         temperature: spec.temperature,
         fetchImpl,
      });
   };
}

export class ApiTokenModel extends Model<BaseModelConfig> {
   readonly #runtimeId: string;
   readonly #model: string;
   readonly #token: string;
   readonly #maxTokens: number | undefined;
   readonly #temperature: number | undefined;
   readonly #fetch: FetchLike;

   constructor(options: ApiTokenModelOptions) {
      super();
      this.#runtimeId = options.runtimeId;
      this.#model = options.model;
      this.#token = options.token;
      this.#maxTokens = options.maxTokens;
      this.#temperature = options.temperature;
      this.#fetch = options.fetchImpl ?? fetch;
   }

   updateConfig(): void {}

   getConfig(): BaseModelConfig {
      return {
         modelId: this.#model,
         ...(this.#maxTokens ? { maxTokens: this.#maxTokens } : {}),
         ...(this.#temperature !== undefined ? { temperature: this.#temperature } : {}),
      };
   }

   async *stream(messages: Message[], options?: StreamOptions): AsyncIterable<ModelStreamEvent> {
      const reply = await invokeProvider(
         {
            runtimeId: this.#runtimeId,
            model: this.#model,
            token: this.#token,
            maxTokens: this.#maxTokens,
            temperature: this.#temperature,
            fetchImpl: this.#fetch,
         },
         messages,
         options
      );
      yield* emitReply(reply);
   }
}

interface ProviderReply {
   text: string;
   tools: Array<{ id: string; name: string; input: Record<string, unknown> }>;
   usage: { inputTokens: number; outputTokens: number; cacheReadInputTokens?: number };
   blocked: boolean;
}

async function invokeProvider(
   options: Required<Pick<ApiTokenModelOptions, 'runtimeId' | 'model' | 'token' | 'fetchImpl'>> &
      Pick<ApiTokenModelOptions, 'maxTokens' | 'temperature'>,
   messages: Message[],
   stream?: StreamOptions
): Promise<ProviderReply> {
   const request = buildRequest(options, messages, stream);
   const timeout = AbortSignal.timeout(TIMEOUT_MS);
   const signal = stream?.cancelSignal ? AbortSignal.any([stream.cancelSignal, timeout]) : timeout;
   let response: Response;
   try {
      response = await options.fetchImpl(request.url, {
         method: 'POST',
         redirect: 'error',
         signal,
         headers: { accept: 'application/json', 'content-type': 'application/json', ...request.headers },
         body: JSON.stringify(request.body),
      });
   } catch (error) {
      if (stream?.cancelSignal?.aborted) throw error;
      throw new ApiTokenCallError('The model provider could not be reached.');
   }
   if (response.status === 401 || response.status === 403) {
      throw new ApiTokenCallError('The API token was refused.', response.status);
   }
   let body: unknown;
   try {
      body = await response.json();
   } catch {
      throw new ApiTokenCallError('The model provider returned an unreadable reply.', response.status);
   }
   if (!response.ok) {
      throw new ApiTokenCallError(providerMessage(body) ?? 'The model provider rejected the request.', response.status);
   }
   const reply = readReply(options.runtimeId, body);
   if (reply.blocked) {
      throw new ApiTokenCallError('blocked by the provider content filter', response.status);
   }
   return reply;
}

export function buildRequest(
   options: Required<Pick<ApiTokenModelOptions, 'runtimeId' | 'model' | 'token'>> &
      Pick<ApiTokenModelOptions, 'maxTokens' | 'temperature'>,
   messages: Message[],
   stream?: StreamOptions
): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
   switch (options.runtimeId) {
      case 'gemini':
         return geminiRequest(options, messages, stream);
      case 'openai':
         return openAiRequest('https://api.openai.com/v1/chat/completions', options, messages, stream);
      case 'xai':
         return openAiRequest('https://api.x.ai/v1/chat/completions', options, messages, stream);
      case 'anthropic':
         return anthropicRequest(options, messages, stream);
      default:
         throw new ApiTokenCallError('That runtime does not take an API token.');
   }
}

export function readReply(runtimeId: string, body: unknown): ProviderReply {
   switch (runtimeId) {
      case 'gemini':
         return readGemini(body);
      case 'openai':
      case 'xai':
         return readOpenAi(body);
      case 'anthropic':
         return readAnthropic(body);
      default:
         throw new ApiTokenCallError('That runtime does not take an API token.');
   }
}

function geminiRequest(
   options: Required<Pick<ApiTokenModelOptions, 'model' | 'token'>> & Pick<ApiTokenModelOptions, 'maxTokens' | 'temperature'>,
   messages: Message[],
   stream?: StreamOptions
): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
   const model = options.model.startsWith('models/') ? options.model.slice('models/'.length) : options.model;
   const system = systemText(stream?.systemPrompt);
   const generation: Record<string, unknown> = {};
   if (options.maxTokens) generation.maxOutputTokens = options.maxTokens;
   if (options.temperature !== undefined) generation.temperature = options.temperature;
   const tools = geminiTools(stream?.toolSpecs);
   const body: Record<string, unknown> = {
      contents: geminiContents(messages),
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      ...(Object.keys(generation).length > 0 ? { generationConfig: generation } : {}),
      ...(tools ? { tools } : {}),
      ...geminiToolConfig(stream),
   };
   return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      headers: { 'x-goog-api-key': options.token },
      body,
   };
}

function openAiRequest(
   url: string,
   options: Required<Pick<ApiTokenModelOptions, 'model' | 'token'>> & Pick<ApiTokenModelOptions, 'maxTokens' | 'temperature'>,
   messages: Message[],
   stream?: StreamOptions
): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
   const tools = (stream?.toolSpecs ?? []).map((spec) => ({
      type: 'function',
      function: {
         name: spec.name,
         description: spec.description,
         parameters: spec.inputSchema ?? { type: 'object', properties: {} },
      },
   }));
   const body: Record<string, unknown> = {
      model: options.model,
      messages: openAiMessages(messages, stream?.systemPrompt),
      ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(tools.length > 0 ? { tools } : {}),
      ...openAiToolChoice(stream),
   };
   return {
      url,
      headers: { authorization: `Bearer ${options.token}` },
      body,
   };
}

function anthropicRequest(
   options: Required<Pick<ApiTokenModelOptions, 'model' | 'token'>> & Pick<ApiTokenModelOptions, 'maxTokens' | 'temperature'>,
   messages: Message[],
   stream?: StreamOptions
): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
   const tools = (stream?.toolSpecs ?? []).map((spec) => ({
      name: spec.name,
      description: spec.description,
      input_schema: spec.inputSchema ?? { type: 'object', properties: {} },
   }));
   const body: Record<string, unknown> = {
      model: options.model,
      max_tokens: options.maxTokens ?? 32_000,
      messages: anthropicMessages(messages),
      ...(systemText(stream?.systemPrompt) ? { system: systemText(stream?.systemPrompt) } : {}),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(tools.length > 0 ? { tools } : {}),
      ...anthropicToolChoice(stream),
   };
   return {
      url: 'https://api.anthropic.com/v1/messages',
      headers: { 'x-api-key': options.token, 'anthropic-version': '2023-06-01' },
      body,
   };
}

function geminiContents(messages: Message[]): Array<{ role: string; parts: Record<string, unknown>[] }> {
   const names = toolNames(messages);
   const contents: Array<{ role: string; parts: Record<string, unknown>[] }> = [];
   for (const message of messages) {
      const data = message.toJSON();
      const parts: Record<string, unknown>[] = [];
      for (const block of data.content) {
         if ('text' in block && typeof block.text === 'string' && block.text !== '') {
            parts.push({ text: block.text });
            continue;
         }
         if ('toolUse' in block && block.toolUse) {
            const use = block.toolUse;
            const call: Record<string, unknown> = {
               name: use.name,
               args: asObject(use.input),
            };
            if (use.toolUseId) call.id = use.toolUseId;
            if (use.reasoningSignature) call.thoughtSignature = use.reasoningSignature;
            parts.push({ functionCall: call });
            continue;
         }
         if ('toolResult' in block && block.toolResult) {
            const result = block.toolResult;
            parts.push({
               functionResponse: {
                  name: names.get(result.toolUseId) ?? result.toolUseId,
                  id: result.toolUseId,
                  response: { result: toolResultText(result.content) },
               },
            });
         }
      }
      if (parts.length === 0) continue;
      const last = contents.at(-1);
      const role = data.role === 'assistant' ? 'model' : 'user';
      if (last && last.role === role) last.parts.push(...parts);
      else contents.push({ role, parts });
   }
   return contents;
}

function openAiMessages(
   messages: Message[],
   system?: StreamOptions['systemPrompt']
): Array<Record<string, unknown>> {
   const out: Array<Record<string, unknown>> = [];
   const systemPrompt = systemText(system);
   if (systemPrompt) out.push({ role: 'system', content: systemPrompt });
   for (const message of messages) {
      const data = message.toJSON();
      const texts: string[] = [];
      const toolCalls: Array<Record<string, unknown>> = [];
      for (const block of data.content) {
         if ('text' in block && typeof block.text === 'string' && block.text !== '') texts.push(block.text);
         if ('toolUse' in block && block.toolUse) {
            toolCalls.push({
               id: block.toolUse.toolUseId,
               type: 'function',
               function: { name: block.toolUse.name, arguments: JSON.stringify(block.toolUse.input ?? {}) },
            });
         }
         if ('toolResult' in block && block.toolResult) {
            out.push({
               role: 'tool',
               tool_call_id: block.toolResult.toolUseId,
               content: toolResultText(block.toolResult.content),
            });
         }
      }
      if (texts.length === 0 && toolCalls.length === 0) continue;
      if (data.role === 'assistant' || toolCalls.length > 0) {
         out.push({
            role: 'assistant',
            ...(texts.length > 0 ? { content: texts.join('\n') } : { content: null }),
            ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
         });
      } else {
         out.push({ role: 'user', content: texts.join('\n') });
      }
   }
   return out;
}

function anthropicMessages(messages: Message[]): Array<Record<string, unknown>> {
   const out: Array<Record<string, unknown>> = [];
   for (const message of messages) {
      const data = message.toJSON();
      const content: Array<Record<string, unknown>> = [];
      for (const block of data.content) {
         if ('text' in block && typeof block.text === 'string' && block.text !== '') {
            content.push({ type: 'text', text: block.text });
         }
         if ('toolUse' in block && block.toolUse) {
            content.push({
               type: 'tool_use',
               id: block.toolUse.toolUseId,
               name: block.toolUse.name,
               input: asObject(block.toolUse.input),
            });
         }
         if ('toolResult' in block && block.toolResult) {
            content.push({
               type: 'tool_result',
               tool_use_id: block.toolResult.toolUseId,
               content: toolResultText(block.toolResult.content),
               ...(block.toolResult.status === 'error' ? { is_error: true } : {}),
            });
         }
      }
      if (content.length === 0) continue;
      const role = data.role === 'assistant' ? 'assistant' : 'user';
      const last = out.at(-1);
      if (last && last.role === role && Array.isArray(last.content)) {
         last.content.push(...content);
      } else {
         out.push({ role, content });
      }
   }
   return out;
}

function geminiTools(specs: ToolSpec[] | undefined): Array<{ functionDeclarations: Record<string, unknown>[] }> | null {
   if (!specs || specs.length === 0) return null;
   return [
      {
         functionDeclarations: specs.map((spec) => ({
            name: spec.name,
            description: spec.description,
            parameters: geminiParameters(spec.inputSchema),
         })),
      },
   ];
}

function geminiParameters(schema: unknown): Record<string, unknown> {
   if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
      return { type: 'OBJECT', properties: {} };
   }
   const copy = { ...(schema as Record<string, unknown>) };
   if (typeof copy.type === 'string') copy.type = copy.type.toUpperCase();
   return copy;
}

function geminiToolConfig(stream?: StreamOptions): Record<string, unknown> {
   const choice = stream?.toolChoice;
   if (!choice) return {};
   if ('any' in choice) return { toolConfig: { functionCallingConfig: { mode: 'ANY' } } };
   if ('tool' in choice) {
      return { toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [choice.tool.name] } } };
   }
   return { toolConfig: { functionCallingConfig: { mode: 'AUTO' } } };
}

function openAiToolChoice(stream?: StreamOptions): Record<string, unknown> {
   const choice = stream?.toolChoice;
   if (!choice) return {};
   if ('any' in choice) return { tool_choice: 'required' };
   if ('tool' in choice) return { tool_choice: { type: 'function', function: { name: choice.tool.name } } };
   return { tool_choice: 'auto' };
}

function anthropicToolChoice(stream?: StreamOptions): Record<string, unknown> {
   const choice = stream?.toolChoice;
   if (!choice) return {};
   if ('any' in choice) return { tool_choice: { type: 'any' } };
   if ('tool' in choice) return { tool_choice: { type: 'tool', name: choice.tool.name } };
   return { tool_choice: { type: 'auto' } };
}

function readGemini(body: unknown): ProviderReply {
   const root = asRecord(body);
   const usage = asRecord(root?.usageMetadata);
   const candidate = firstRecord(root?.candidates);
   const finish = text(asRecord(candidate)?.finishReason);
   const parts = arrayOf(asRecord(asRecord(candidate)?.content)?.parts);
   const tools: ProviderReply['tools'] = [];
   const texts: string[] = [];
   for (const part of parts) {
      const textPart = text(part.text);
      if (textPart) texts.push(textPart);
      const call = asRecord(part.functionCall);
      if (!call) continue;
      const name = text(call.name);
      if (!name) continue;
      tools.push({
         id: text(call.id) ?? `call_${tools.length + 1}`,
         name,
         input: asObject(call.args),
      });
   }
   return {
      text: texts.join(''),
      tools,
      usage: {
         inputTokens: number(usage?.promptTokenCount),
         outputTokens: number(usage?.candidatesTokenCount),
         ...(number(usage?.cachedContentTokenCount) > 0
            ? { cacheReadInputTokens: number(usage?.cachedContentTokenCount) }
            : {}),
      },
      blocked: finish === 'SAFETY' || finish === 'BLOCKLIST' || finish === 'PROHIBITED_CONTENT',
   };
}

function readOpenAi(body: unknown): ProviderReply {
   const root = asRecord(body);
   const usage = asRecord(root?.usage);
   const message = asRecord(asRecord(firstRecord(root?.choices))?.message);
   const tools: ProviderReply['tools'] = [];
   for (const call of arrayOf(message?.tool_calls)) {
      const fn = asRecord(call.function);
      const name = text(fn?.name);
      if (!name) continue;
      tools.push({
         id: text(call.id) ?? `call_${tools.length + 1}`,
         name,
         input: parseJsonObject(text(fn?.arguments) ?? '{}'),
      });
   }
   return {
      text: text(message?.content) ?? '',
      tools,
      usage: {
         inputTokens: number(usage?.prompt_tokens),
         outputTokens: number(usage?.completion_tokens),
         ...(number(asRecord(usage?.prompt_tokens_details)?.cached_tokens) > 0
            ? { cacheReadInputTokens: number(asRecord(usage?.prompt_tokens_details)?.cached_tokens) }
            : {}),
      },
      blocked: false,
   };
}

function readAnthropic(body: unknown): ProviderReply {
   const root = asRecord(body);
   const usage = asRecord(root?.usage);
   const tools: ProviderReply['tools'] = [];
   const texts: string[] = [];
   for (const block of arrayOf(root?.content)) {
      if (text(block.type) === 'text') {
         const value = text(block.text);
         if (value) texts.push(value);
      }
      if (text(block.type) === 'tool_use') {
         const name = text(block.name);
         if (!name) continue;
         tools.push({
            id: text(block.id) ?? `call_${tools.length + 1}`,
            name,
            input: asObject(block.input),
         });
      }
   }
   return {
      text: texts.join(''),
      tools,
      usage: {
         inputTokens: number(usage?.input_tokens),
         outputTokens: number(usage?.output_tokens),
         ...(number(usage?.cache_read_input_tokens) > 0
            ? { cacheReadInputTokens: number(usage?.cache_read_input_tokens) }
            : {}),
      },
      blocked: text(root?.stop_reason) === 'refusal',
   };
}

async function* emitReply(reply: ProviderReply): AsyncIterable<ModelStreamEvent> {
   yield new ModelMessageStartEvent({ type: 'modelMessageStartEvent', role: 'assistant' });
   if (reply.text !== '') {
      yield new ModelContentBlockStartEvent({ type: 'modelContentBlockStartEvent' });
      for (const piece of reply.text.split(/(?<= )/)) {
         if (piece === '') continue;
         yield new ModelContentBlockDeltaEvent({
            type: 'modelContentBlockDeltaEvent',
            delta: { type: 'textDelta', text: piece },
         });
      }
      yield new ModelContentBlockStopEvent({ type: 'modelContentBlockStopEvent' });
   }
   for (const tool of reply.tools) {
      yield new ModelContentBlockStartEvent({
         type: 'modelContentBlockStartEvent',
         start: { type: 'toolUseStart', name: tool.name, toolUseId: tool.id },
      });
      yield new ModelContentBlockDeltaEvent({
         type: 'modelContentBlockDeltaEvent',
         delta: { type: 'toolUseInputDelta', input: JSON.stringify(tool.input) },
      });
      yield new ModelContentBlockStopEvent({ type: 'modelContentBlockStopEvent' });
   }
   yield new ModelMessageStopEvent({
      type: 'modelMessageStopEvent',
      stopReason: reply.tools.length > 0 ? 'toolUse' : 'endTurn',
   });
   yield new ModelMetadataEvent({
      type: 'modelMetadataEvent',
      usage: {
         inputTokens: reply.usage.inputTokens,
         outputTokens: reply.usage.outputTokens,
         totalTokens: reply.usage.inputTokens + reply.usage.outputTokens,
         ...(reply.usage.cacheReadInputTokens
            ? { cacheReadInputTokens: reply.usage.cacheReadInputTokens }
            : {}),
      },
   });
}

function systemText(prompt: StreamOptions['systemPrompt']): string | null {
   if (typeof prompt === 'string') {
      const trimmed = prompt.trim();
      return trimmed === '' ? null : trimmed;
   }
   if (!Array.isArray(prompt)) return null;
   const texts = prompt
      .map((block) => {
         if (typeof block === 'string') return block;
         if (block && typeof block === 'object' && 'text' in block && typeof block.text === 'string') return block.text;
         return '';
      })
      .filter((piece) => piece !== '');
   return texts.length === 0 ? null : texts.join('\n');
}

function toolNames(messages: Message[]): Map<string, string> {
   const names = new Map<string, string>();
   for (const message of messages) {
      for (const block of message.toJSON().content) {
         if (!('toolUse' in block) || !block.toolUse) continue;
         names.set(block.toolUse.toolUseId, block.toolUse.name);
      }
   }
   return names;
}

function toolResultText(content: unknown): string {
   if (!Array.isArray(content)) return content == null ? '' : JSON.stringify(content);
   const parts: string[] = [];
   for (const item of content) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      if (typeof row.text === 'string') parts.push(row.text);
      else if ('json' in row) parts.push(JSON.stringify(row.json));
   }
   return parts.join('\n');
}

function providerMessage(body: unknown): string | null {
   const root = asRecord(body);
   const error = asRecord(root?.error);
   const message = text(error?.message) ?? text(root?.message);
   if (!message) return null;
   return message.length > 300 ? `${message.slice(0, 300)}…` : message;
}

function asRecord(value: unknown): Record<string, unknown> | null {
   return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function firstRecord(value: unknown): Record<string, unknown> | null {
   if (!Array.isArray(value) || value.length === 0) return null;
   return asRecord(value[0]);
}

function arrayOf(value: unknown): Record<string, unknown>[] {
   if (!Array.isArray(value)) return [];
   return value.filter((row): row is Record<string, unknown> => row !== null && typeof row === 'object' && !Array.isArray(row));
}

function text(value: unknown): string | null {
   return typeof value === 'string' && value !== '' ? value : null;
}

function number(value: unknown): number {
   return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asObject(value: unknown): Record<string, unknown> {
   return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function parseJsonObject(raw: string): Record<string, unknown> {
   try {
      return asObject(JSON.parse(raw));
   } catch {
      return {};
   }
}
