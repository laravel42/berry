import { LMSTUDIO_NO_TOKEN } from '../../runtime/envelope.ts';

/**
 * LM Studio applies context length at load time, not on chat/completions.
 * Berry loads the model itself so agent prompts are not clipped by whatever
 * context the person last chose in the LM Studio UI.
 */

/** Context Berry asks for on agent and completion turns. */
export const LMSTUDIO_AGENT_CONTEXT = 16_384;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const ensured = new Map<string, number>();

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
   const want = input.contextLength ?? LMSTUDIO_AGENT_CONTEXT;
   const cached = ensured.get(cacheKey);
   if (cached !== undefined && cached >= want) return cached;

   const doFetch = input.fetchImpl ?? fetch;
   const headers = authHeaders(input.token);
   const listed = await listModel(doFetch, origin, input.model, headers).catch(() => null);
   const max = listed?.maxContextLength ?? want;
   const target = Math.min(want, max);
   if (target < 1) return null;

   const loaded = listed?.loadedContext ?? null;
   if (loaded !== null && loaded >= target) {
      ensured.set(cacheKey, loaded);
      return loaded;
   }

   for (const instanceId of listed?.instanceIds ?? (loaded !== null ? [input.model] : [])) {
      await post(doFetch, `${origin}/api/v1/models/unload`, headers, { instance_id: instanceId }).catch(
         () => undefined
      );
   }

   const loadedOk = await post(doFetch, `${origin}/api/v1/models/load`, headers, {
      model: input.model,
      context_length: target,
      echo_load_config: true,
   })
      .then((body) => readLoadedContext(body) ?? target)
      .catch(() => null);

   if (loadedOk === null) return null;
   ensured.set(cacheKey, loadedOk);
   return loadedOk;
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
      const message =
         parsed && typeof parsed === 'object' && parsed !== null && 'error' in parsed
            ? String((parsed as { error?: { message?: unknown } }).error?.message ?? response.status)
            : `HTTP ${response.status}`;
      throw new Error(message);
   }
   return parsed;
}

function readLoadedContext(body: unknown): number | null {
   if (!body || typeof body !== 'object') return null;
   const config = (body as { load_config?: { context_length?: unknown } }).load_config;
   const value = config?.context_length;
   return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null;
}
