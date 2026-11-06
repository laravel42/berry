import { LMSTUDIO_DEFAULT_BASE_URL } from './lmstudio-endpoint.ts';

/**
 * Lists models for an API-token runtime.
 *
 * The token is sent only on this request and never copied into an error, a
 * log line, or a URL. A refused token and a network failure use the same
 * shape of message so a response body cannot echo the secret back out.
 */

export class ApiTokenError extends Error {
   override readonly name = 'ApiTokenError';
   readonly code: 'AI_RUNTIME_AUTH_FAILED' | 'AI_RUNTIME_AUTH_UNAVAILABLE';

   constructor(code: 'AI_RUNTIME_AUTH_FAILED' | 'AI_RUNTIME_AUTH_UNAVAILABLE', message: string) {
      super(message);
      this.code = code;
   }
}

const REASONING_OPTIONS = ['off', 'on', 'low', 'medium', 'high', 'xhigh'] as const;

export type ReasoningOption = (typeof REASONING_OPTIONS)[number];

/** What LM Studio reports for a chat model on `GET /api/v1/models`. */
export interface LmStudioCapabilities {
   vision: boolean;
   trainedForToolUse: boolean;
   reasoning?: { allowedOptions: ReasoningOption[]; default: ReasoningOption };
}

export interface ApiTokenModel {
   id: string;
   name: string;
   /** Maximum context, in tokens, when the provider reports one. */
   maxContextLength?: number;
   capabilities?: LmStudioCapabilities;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 10_000;

interface Probe {
   url: (baseUrl: string | undefined) => string;
   headers: (token: string | null) => Record<string, string>;
   read: (body: unknown) => ApiTokenModel[];
   /** Used when the primary list is missing, so an older server still connects. */
   fallback?: {
      url: (baseUrl: string | undefined) => string;
      read: (body: unknown) => ApiTokenModel[];
   };
   refused: string;
   unreachable: (baseUrl: string | undefined) => string;
   /** Shown when the reply held no model Berry can place. */
   empty?: string;
}

const bearer = (token: string | null): Record<string, string> =>
   token === null ? {} : { authorization: `Bearer ${token}` };

const PROBES: Record<string, Probe> = {
   openai: {
      url: () => 'https://api.openai.com/v1/models',
      headers: bearer,
      read: (body) => fromList(body, 'data', namedId),
      refused: 'OpenAI refused that API token.',
      unreachable: () => 'OpenAI could not be reached.',
   },
   xai: {
      url: () => 'https://api.x.ai/v1/models',
      headers: bearer,
      read: (body) => fromList(body, 'data', namedId),
      refused: 'xAI refused that API token.',
      unreachable: () => 'xAI could not be reached.',
   },
   anthropic: {
      url: () => 'https://api.anthropic.com/v1/models',
      headers: (token) => ({ 'x-api-key': token ?? '', 'anthropic-version': '2023-06-01' }),
      read: (body) =>
         fromList(body, 'data', (row) => {
            const id = text(row.id);
            return id === null ? null : { id, name: text(row.display_name) ?? id };
         }),
      refused: 'Anthropic refused that API token.',
      unreachable: () => 'Anthropic could not be reached.',
   },
   gemini: {
      url: () => 'https://generativelanguage.googleapis.com/v1beta/models',
      headers: (token) => ({ 'x-goog-api-key': token ?? '' }),
      read: (body) =>
         fromList(body, 'models', (row) => {
            const methods = Array.isArray(row.supportedGenerationMethods)
               ? row.supportedGenerationMethods
               : [];
            if (methods.length > 0 && !methods.includes('generateContent')) return null;
            const raw = text(row.name);
            if (raw === null) return null;
            const id = raw.startsWith('models/') ? raw.slice('models/'.length) : raw;
            return { id, name: text(row.displayName) ?? id };
         }),
      refused: 'Google refused that API token.',
      unreachable: () => 'Google could not be reached.',
   },
   lmstudio: {
      // Native list: context length, vision, tool use, and reasoning. The
      // OpenAI-compatible `/v1/models` list is only id and owner.
      url: (baseUrl) => lmStudioModelsUrl(baseUrl),
      headers: bearer,
      read: readLmStudioModels,
      fallback: {
         url: (baseUrl) => `${baseUrl ?? LMSTUDIO_DEFAULT_BASE_URL}/models`,
         // That list does not say which models are embeddings; their ids do,
         // and an embedding model cannot run a task.
         read: (body) =>
            fromList(body, 'data', (row) => {
               const model = namedId(row);
               return model === null || /embed/i.test(model.id) ? null : model;
            }),
      },
      refused:
         'LM Studio asked for an API token. Paste one from Server Settings → Manage Tokens, or turn authentication off.',
      unreachable: (baseUrl) =>
         `LM Studio did not answer at ${baseUrl ?? LMSTUDIO_DEFAULT_BASE_URL}. Start its server (Developer → Start server, or \`lms server start\`) and check the address.`,
      empty: 'LM Studio listed no chat models. Download a model in LM Studio, then connect again.',
   },
};

/**
 * Asks the provider which models this token may call. At most fifty, by id.
 * `token` is null only for LM Studio with authentication off; `baseUrl` is
 * that server's normalized `/v1` address.
 */
export async function listApiTokenModels(
   runtimeId: string,
   token: string | null,
   fetchImpl: FetchLike = fetch,
   baseUrl?: string
): Promise<ApiTokenModel[]> {
   const probe = PROBES[runtimeId];
   if (!probe) {
      throw new ApiTokenError('AI_RUNTIME_AUTH_UNAVAILABLE', 'That runtime does not take an API token.');
   }
   const headers = { accept: 'application/json', ...probe.headers(token) };
   const ask = async (url: string): Promise<Response> => {
      try {
         return await fetchImpl(url, {
            method: 'GET',
            redirect: 'error',
            signal: AbortSignal.timeout(TIMEOUT_MS),
            headers,
         });
      } catch {
         throw new ApiTokenError('AI_RUNTIME_AUTH_UNAVAILABLE', probe.unreachable(baseUrl));
      }
   };
   let read = probe.read;
   let response = await ask(probe.url(baseUrl));
   if (response.status === 404 && probe.fallback) {
      read = probe.fallback.read;
      response = await ask(probe.fallback.url(baseUrl));
   }
   if (response.status === 401 || response.status === 403) {
      throw new ApiTokenError('AI_RUNTIME_AUTH_FAILED', probe.refused);
   }
   if (!response.ok) {
      throw new ApiTokenError('AI_RUNTIME_AUTH_UNAVAILABLE', probe.unreachable(baseUrl));
   }
   let body: unknown;
   try {
      body = await response.json();
   } catch {
      throw new ApiTokenError('AI_RUNTIME_AUTH_UNAVAILABLE', probe.unreachable(baseUrl));
   }
   const models = read(body)
      .filter((model, index, all) => all.findIndex((other) => other.id === model.id) === index)
      .toSorted((left, right) => left.id.localeCompare(right.id))
      .slice(0, 50);
   if (models.length === 0) {
      throw new ApiTokenError(
         'AI_RUNTIME_AUTH_FAILED',
         probe.empty ?? 'That token did not return any models Berry can place.'
      );
   }
   return models;
}

function text(value: unknown): string | null {
   if (typeof value !== 'string') return null;
   const trimmed = value.trim();
   return trimmed.length > 0 && trimmed.length <= 200 ? trimmed : null;
}

function namedId(row: Record<string, unknown>): ApiTokenModel | null {
   const id = text(row.id);
   return id === null ? null : { id, name: id };
}

function fromList(
   body: unknown,
   key: string,
   map: (row: Record<string, unknown>) => ApiTokenModel | null
): ApiTokenModel[] {
   if (typeof body !== 'object' || body === null) return [];
   const rows = (body as Record<string, unknown>)[key];
   if (!Array.isArray(rows)) return [];
   const models: ApiTokenModel[] = [];
   for (const row of rows) {
      if (typeof row !== 'object' || row === null) continue;
      const mapped = map(row as Record<string, unknown>);
      if (mapped === null) continue;
      models.push({ id: mapped.id, name: mapped.name });
   }
   return models;
}

/** `GET /api/v1/models` on the same origin as the OpenAI-compatible `/v1` base. */
function lmStudioModelsUrl(baseUrl: string | undefined): string {
   const base = baseUrl ?? LMSTUDIO_DEFAULT_BASE_URL;
   try {
      return `${new URL(base).origin}/api/v1/models`;
   } catch {
      return 'http://localhost:1234/api/v1/models';
   }
}

/**
 * LM Studio's native model list. Embedding models are omitted: they cannot
 * run a task. Context length and capabilities are kept for the tier row.
 */
function readLmStudioModels(body: unknown): ApiTokenModel[] {
   if (typeof body !== 'object' || body === null) return [];
   const rows = (body as { models?: unknown }).models;
   if (!Array.isArray(rows)) return [];
   const models: ApiTokenModel[] = [];
   for (const row of rows) {
      if (typeof row !== 'object' || row === null) continue;
      const record = row as Record<string, unknown>;
      if (record.type === 'embedding') continue;
      const id = text(record.key);
      if (id === null || /embed/i.test(id)) continue;
      const model: ApiTokenModel = { id, name: text(record.display_name) ?? id };
      const context = contextLength(record.max_context_length);
      if (context !== null) model.maxContextLength = context;
      const capabilities = readCapabilities(record.capabilities);
      if (capabilities !== null) model.capabilities = capabilities;
      models.push(model);
   }
   return models;
}

function contextLength(value: unknown): number | null {
   if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100_000_000) return null;
   return value;
}

function isReasoningOption(value: string): value is ReasoningOption {
   return (REASONING_OPTIONS as readonly string[]).includes(value);
}

function readCapabilities(value: unknown): LmStudioCapabilities | null {
   if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
   const record = value as Record<string, unknown>;
   const reasoning = readReasoning(record.reasoning);
   return {
      vision: record.vision === true,
      trainedForToolUse: record.trained_for_tool_use === true,
      ...(reasoning ? { reasoning } : {}),
   };
}

function readReasoning(value: unknown): LmStudioCapabilities['reasoning'] {
   if (typeof value !== 'object' || value === null) return undefined;
   const record = value as Record<string, unknown>;
   const allowed = Array.isArray(record.allowed_options)
      ? record.allowed_options.filter((option): option is ReasoningOption =>
           typeof option === 'string' && isReasoningOption(option)
        )
      : [];
   const rawDefault = typeof record.default === 'string' && isReasoningOption(record.default) ? record.default : allowed[0];
   if (rawDefault === undefined || allowed.length === 0) return undefined;
   const allowedOptions = allowed.includes(rawDefault) ? allowed : [...allowed, rawDefault];
   return { allowedOptions, default: rawDefault };
}
