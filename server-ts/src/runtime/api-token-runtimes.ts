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

export interface ApiTokenModel {
   id: string;
   name: string;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 10_000;

interface Probe {
   url: string;
   headers: (token: string) => Record<string, string>;
   read: (body: unknown) => ApiTokenModel[];
   refused: string;
   unreachable: string;
}

const PROBES: Record<string, Probe> = {
   openai: {
      url: 'https://api.openai.com/v1/models',
      headers: (token) => ({ authorization: `Bearer ${token}` }),
      read: (body) => fromList(body, 'data', namedId),
      refused: 'OpenAI refused that API token.',
      unreachable: 'OpenAI could not be reached.',
   },
   xai: {
      url: 'https://api.x.ai/v1/models',
      headers: (token) => ({ authorization: `Bearer ${token}` }),
      read: (body) => fromList(body, 'data', namedId),
      refused: 'xAI refused that API token.',
      unreachable: 'xAI could not be reached.',
   },
   anthropic: {
      url: 'https://api.anthropic.com/v1/models',
      headers: (token) => ({ 'x-api-key': token, 'anthropic-version': '2023-06-01' }),
      read: (body) =>
         fromList(body, 'data', (row) => {
            const id = text(row.id);
            return id === null ? null : { id, name: text(row.display_name) ?? id };
         }),
      refused: 'Anthropic refused that API token.',
      unreachable: 'Anthropic could not be reached.',
   },
   gemini: {
      url: 'https://generativelanguage.googleapis.com/v1beta/models',
      headers: (token) => ({ 'x-goog-api-key': token }),
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
      unreachable: 'Google could not be reached.',
   },
};

/** Asks the provider which models this token may call. At most fifty, by id. */
export async function listApiTokenModels(
   runtimeId: string,
   token: string,
   fetchImpl: FetchLike = fetch
): Promise<ApiTokenModel[]> {
   const probe = PROBES[runtimeId];
   if (!probe) {
      throw new ApiTokenError('AI_RUNTIME_AUTH_UNAVAILABLE', 'That runtime does not take an API token.');
   }
   let response: Response;
   try {
      response = await fetchImpl(probe.url, {
         method: 'GET',
         redirect: 'error',
         signal: AbortSignal.timeout(TIMEOUT_MS),
         headers: { accept: 'application/json', ...probe.headers(token) },
      });
   } catch {
      throw new ApiTokenError('AI_RUNTIME_AUTH_UNAVAILABLE', probe.unreachable);
   }
   if (response.status === 401 || response.status === 403) {
      throw new ApiTokenError('AI_RUNTIME_AUTH_FAILED', probe.refused);
   }
   if (!response.ok) {
      throw new ApiTokenError('AI_RUNTIME_AUTH_UNAVAILABLE', probe.unreachable);
   }
   let body: unknown;
   try {
      body = await response.json();
   } catch {
      throw new ApiTokenError('AI_RUNTIME_AUTH_UNAVAILABLE', probe.unreachable);
   }
   const models = probe
      .read(body)
      .filter((model, index, all) => all.findIndex((other) => other.id === model.id) === index)
      .toSorted((left, right) => left.id.localeCompare(right.id))
      .slice(0, 50);
   if (models.length === 0) {
      throw new ApiTokenError(
         'AI_RUNTIME_AUTH_FAILED',
         'That token did not return any models Berry can place.'
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
