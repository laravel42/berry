import { LMSTUDIO_NO_TOKEN } from '../../runtime/envelope.ts';

/**
 * LM Studio applies context length at load time, not on chat/completions.
 * Berry loads the model itself so agent prompts are not clipped by whatever
 * context the person last chose in the LM Studio UI.
 */

/**
 * Context Berry asks for on agent and completion turns.
 *
 * 16k was too small for an agent: the system prompt, the tool definitions and
 * the task already take a good part of it, and one command's output (a page of
 * minified HTML) is enough to overflow it, which LM Studio refuses with a 400.
 * `BERRY_LMSTUDIO_CONTEXT` sets another size for the machine LM Studio runs on.
 */
export const LMSTUDIO_AGENT_CONTEXT = 65_536;

/** The smallest context a load falls back to when a larger one does not fit. */
export const LMSTUDIO_MIN_CONTEXT = 16_384;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Per model: the context asked for, and what LM Studio actually loaded. */
const ensured = new Map<string, { want: number; context: number }>();

/** The configured agent context: `BERRY_LMSTUDIO_CONTEXT` when it is a sane number. */
export function lmStudioAgentContext(env: NodeJS.ProcessEnv = process.env): number {
   const raw = Number.parseInt((env.BERRY_LMSTUDIO_CONTEXT ?? '').trim(), 10);
   return Number.isFinite(raw) && raw >= 2_048 && raw <= 1_048_576 ? raw : LMSTUDIO_AGENT_CONTEXT;
}

/** Origin of the OpenAI-compatible `/v1` base, for `/api/v1/models/*`. */
export function lmStudioApiOrigin(baseUrl: string): string | null {
   try {
      return new URL(baseUrl).origin;
   } catch {
      return null;
   }
}

/**
 * Ensures `model` is loaded with at least Berry's agent context (capped by
 * the model's own maximum). No-ops when an instance already has enough.
 * A load that does not fit (not enough memory for that context) is retried at
 * half the size, down to `LMSTUDIO_MIN_CONTEXT`, and the size that loaded is
 * remembered so the next turn does not unload and reload it again.
 * Load failures are swallowed so a chat can still proceed on a JIT-loaded
 * instance; a too-small context then fails the chat with LM Studio's own error.
 */
export async function ensureLmStudioContext(input: {
   baseUrl: string;
   model: string;
   token: string;
   fetchImpl?: FetchLike;
   /** Override for tests. */
   contextLength?: number;
}): Promise<number | null> {
   const origin = lmStudioApiOrigin(input.baseUrl);
   if (origin === null) return null;
   const cacheKey = `${origin}\0${input.model}`;
   const want = input.contextLength ?? lmStudioAgentContext();
   const cached = ensured.get(cacheKey);
   if (cached !== undefined && (cached.context >= want || cached.want >= want)) return cached.context;

   const doFetch = input.fetchImpl ?? fetch;
   const headers = authHeaders(input.token);
   const listed = await listModel(doFetch, origin, input.model, headers).catch(() => null);
   const max = listed?.maxContextLength ?? want;
   const target = Math.min(want, max);
   if (target < 1) return null;

   const loaded = listed?.loadedContext ?? null;
   if (loaded !== null && loaded >= target) {
      ensured.set(cacheKey, { want, context: loaded });
      return loaded;
   }

   for (const instanceId of listed?.instanceIds ?? (loaded !== null ? [input.model] : [])) {
      await post(doFetch, `${origin}/api/v1/models/unload`, headers, { instance_id: instanceId }).catch(
         () => undefined
      );
   }

   const floor = Math.min(target, LMSTUDIO_MIN_CONTEXT);
   for (let size = target; size >= floor; size = size > floor ? Math.max(floor, Math.floor(size / 2)) : 0) {
      const loadedOk = await post(doFetch, `${origin}/api/v1/models/load`, headers, {
         model: input.model,
         context_length: size,
         echo_load_config: true,
      })
         .then((body) => readLoadedContext(body) ?? size)
         .catch(() => null);
      if (loadedOk !== null) {
         ensured.set(cacheKey, { want, context: loadedOk });
         return loadedOk;
      }
   }
   return null;
}

/** Test helper: drop the per-process load cache. */
export function clearLmStudioContextCache(): void {
   ensured.clear();
}

function authHeaders(token: string): Record<string, string> {
   const headers: Record<string, string> = { accept: 'application/json', 'content-type': 'application/json' };
   if (token !== LMSTUDIO_NO_TOKEN) headers.authorization = `Bearer ${token}`;
   return headers;
}

async function listModel(
   doFetch: FetchLike,
   origin: string,
   modelId: string,
   headers: Record<string, string>
): Promise<{ maxContextLength: number | null; loadedContext: number | null; instanceIds: string[] }> {
   const response = await doFetch(`${origin}/api/v1/models`, {
      method: 'GET',
      redirect: 'error',
      headers: { accept: 'application/json', ...(headers.authorization ? { authorization: headers.authorization } : {}) },
      signal: AbortSignal.timeout(15_000),
   });
   if (!response.ok) throw new Error(`list ${response.status}`);
   const body: unknown = await response.json();
   const rows =
      body && typeof body === 'object' && Array.isArray((body as { models?: unknown }).models)
         ? ((body as { models: unknown[] }).models)
         : [];
   for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const record = row as Record<string, unknown>;
      const key = typeof record.key === 'string' ? record.key : null;
      if (key !== modelId) continue;
      const max =
         typeof record.max_context_length === 'number' && Number.isFinite(record.max_context_length)
            ? Math.trunc(record.max_context_length)
            : null;
      const instances = Array.isArray(record.loaded_instances) ? record.loaded_instances : [];
      let loadedContext: number | null = null;
      const instanceIds: string[] = [];
      for (const instance of instances) {
         if (!instance || typeof instance !== 'object') continue;
         const entry = instance as { id?: unknown; config?: { context_length?: unknown } };
         if (typeof entry.id === 'string' && entry.id !== '') instanceIds.push(entry.id);
         const ctx = entry.config?.context_length;
         if (typeof ctx === 'number' && Number.isFinite(ctx)) {
            const n = Math.trunc(ctx);
            loadedContext = loadedContext === null ? n : Math.max(loadedContext, n);
         }
      }
      return { maxContextLength: max, loadedContext, instanceIds };
   }
   return { maxContextLength: null, loadedContext: null, instanceIds: [] };
}

async function post(
   doFetch: FetchLike,
   url: string,
   headers: Record<string, string>,
   body: Record<string, unknown>
): Promise<unknown> {
   const response = await doFetch(url, {
      method: 'POST',
      redirect: 'error',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(600_000),
   });
   const text = await response.text();
   let parsed: unknown = null;
   try {
      parsed = text === '' ? null : JSON.parse(text);
   } catch {
      parsed = null;
   }
   if (!response.ok) {
      throw new Error(lmStudioErrorMessage(parsed) ?? `HTTP ${response.status}`);
   }
   return parsed;
}

function readLoadedContext(body: unknown): number | null {
   if (!body || typeof body !== 'object') return null;
   const config = (body as { load_config?: { context_length?: unknown } }).load_config;
   const value = config?.context_length;
   return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}

/**
 * The sentence in an LM Studio error body. LM Studio answers `{"error": "..."}`
 * with a plain string, often wrapping its engine's own JSON error:
 * `Engine protocol predict request returned 400: {"error":{"message":"..."}}`.
 * The innermost message is the one a person can act on.
 */
export function lmStudioErrorMessage(body: unknown): string | null {
   if (!body || typeof body !== 'object') return null;
   const error = (body as { error?: unknown; message?: unknown }).error;
   if (typeof error === 'string' && error.trim() !== '') return innermost(error.trim());
   if (error && typeof error === 'object') {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string' && message.trim() !== '') return innermost(message.trim());
   }
   const message = (body as { message?: unknown }).message;
   return typeof message === 'string' && message.trim() !== '' ? innermost(message.trim()) : null;
}

function innermost(text: string): string {
   const start = text.indexOf('{');
   if (start < 0) return text;
   try {
      return lmStudioErrorMessage(JSON.parse(text.slice(start))) ?? text;
   } catch {
      return text;
   }
}
