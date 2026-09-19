import { z } from 'zod';

/**
 * Everything a runtime needs to work one task, in one JSON body.
 *
 * Shipped in the runtime image; imports nothing but zod. It carries secrets —
 * the task token, a git credential, sealed-then-opened profile env — which is
 * why it travels only over the AWS SDK (or the local runtime's loopback) and
 * why anything that logs it must log `redactEnvelope(envelope)` instead.
 */

export const transcriptMessageSchema = z.object({
   role: z.enum(['user', 'assistant']),
   text: z.string(),
});

/**
 * Where a conflict-resolution run keeps the material it merges from: this
 * task's version and the common ancestor of every file both sides changed, and
 * a status file. Reserved — the runtime leaves it out of the candidate and the
 * control plane refuses to publish a path under it — so neither can reach the
 * repository by accident.
 */
export const MERGE_DIRECTORY = '.berry-merge';

/**
 * The label on the opening conflict marker of a file git could not merge.
 *
 * Berry's own, so that delivery can refuse a file that still carries one
 * without mistaking a document that merely shows `<<<<<<<` for unfinished work.
 */
export const MERGE_MARKER_LABEL = 'berry: this task';

/** What the runtime reads first from the overlay archive of a conflict-resolution run. */
export const MERGE_MANIFEST_PATH = `${MERGE_DIRECTORY}/manifest.json`;

const mergePath = z
   .string()
   .min(1)
   .max(4096)
   .refine((path) => !path.startsWith('/') && !/[\\\0\n]/.test(path) && path.split('/').every((part) => part !== '' && part !== '.' && part !== '..' && part.toLowerCase() !== '.git'));

export const mergeManifestSchema = z.object({
   /** Files the task branch deleted and the default branch left alone. */
   remove: z.array(mergePath),
   conflicts: z.array(
      z.object({
         path: mergePath,
         /** Which versions exist. A missing one means that side deleted the file, or never had it. */
         ours: z.boolean(),
         base: z.boolean(),
         theirs: z.boolean(),
         /** False when a side is a symbolic link: there is no text to merge. */
         mergeable: z.boolean(),
      })
   ),
});

export type MergeManifest = z.infer<typeof mergeManifestSchema>;

/** True when text still holds a conflict marker this run's merge wrote. */
export function hasMergeMarker(text: string): boolean {
   return text.startsWith(`<<<<<<< ${MERGE_MARKER_LABEL}`) || text.includes(`\n<<<<<<< ${MERGE_MARKER_LABEL}`);
}

export const repoPlanSchema = z.object({
   /** `owner/name` on GitHub. */
   fullName: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
   branch: z.string().min(1),
   baseBranch: z.string().min(1),
   readOnly: z.boolean().optional(),
   snapshotCommit: z.string().regex(/^[0-9a-f]{40,64}$/).optional(),
   /**
    * Present on a conflict-resolution run. The snapshot is then the default
    * branch head, and the runtime lays the task branch's changes over it from
    * `/api/v1/agent-tools/repository-merge` before the agent starts.
    * `conflicts` are the files both sides changed.
    */
   merge: z.object({ conflicts: z.array(z.string()) }).optional(),
   credential: z.object({ username: z.string(), password: z.string() }),
   verifyCommands: z.array(z.string()),
   issueReference: z.string(),
   issueTitle: z.string(),
});

export const skillRefSchema = z.object({
   name: z.string().min(1),
   files: z.array(z.object({ path: z.string().min(1), content: z.string() })),
});

/**
 * The one MCP transport vocabulary: the API, the `mcp_servers` column, the
 * agent builder, plugin servers and the envelope all say the same thing, so
 * nothing translates between them. The runtime maps it to Strands' names.
 */
export const mcpTransportSchema = z.enum(['streamable_http', 'sse']);

export const mcpServerRefSchema = z.object({
   name: z.string().min(1),
   url: z.url(),
   transport: mcpTransportSchema,
   headers: z.record(z.string(), z.string()),
   /**
    * Server-side tool names the agent may use; null exposes every tool the
    * server lists (a server the workspace registered itself). A plugin's
    * server always carries its admin-approved list, and nothing else of it
    * reaches the agent.
    */
   allowedTools: z.array(z.string().min(1)).nullable(),
});

export const taskEnvelopeSchema = z.object({
   kind: z.enum(['agent', 'completion']),
   runId: z.string().min(1),
   /** Human-readable `(agent, issue)` / `(agent, chat)` / `completion:<run>` key. */
   sessionKey: z.string().min(1),
   /** AgentCore requires at least 33 characters. */
   runtimeSessionId: z.string().min(33).max(100).regex(/^[A-Za-z0-9_-]+$/),
   agent: z.object({
      name: z.string().min(1),
      instructions: z.string(),
      model: z.string().min(1),
      skills: z.array(skillRefSchema),
      mcpServers: z.array(mcpServerRefSchema),
      permissions: z.array(z.string()),
      /**
       * Berry organization enforcement (Task 5): the tools this agent's
       * contract allows, or null for an agent outside the organization
       * (no `role_key`), which keeps its existing unrestricted behaviour.
       */
      tools: z.array(z.string().min(1)).nullable().default(null),
      maxTokens: z.number().int().positive().nullable(),
      maxTurns: z.number().int().positive().optional(),
      maxOutputTokens: z.number().int().positive().optional(),
      temperature: z.number().nullable(),
   }),
   task: z.object({
      /** The full first user message, already built by the server. */
      prompt: z.string(),
      issue: z
         .object({
            id: z.string(),
            identifier: z.string(),
            title: z.string(),
            description: z.string().nullable(),
         })
         .nullable(),
      comments: z.array(z.object({ author: z.string(), body: z.string(), createdAt: z.string() })),
      dependencies: z.array(
         z.object({
            identifier: z.string(),
            title: z.string(),
            status: z.string(),
            direction: z.enum(['depends_on', 'blocks']),
         })
      ),
      projectResources: z.array(
         z.object({ title: z.string(), url: z.string().nullable(), content: z.string().nullable() })
      ),
      priorWork: z.string().nullable(),
   }),
   /** The prior conversation for this session, oldest first; used only on a cold start. */
   transcript: z.array(transcriptMessageSchema),
   repo: repoPlanSchema.nullable(),
   completion: z
      .object({
         system: z.string(),
         /** `z.toJSONSchema(schema)` of the answer, or null for free text. */
         jsonSchema: z.record(z.string(), z.unknown()).nullable(),
      })
      .nullable(),
   env: z.record(z.string(), z.string()),
   berry: z.object({ apiUrl: z.url(), token: z.string().min(1) }),
});

export type TaskEnvelope = z.infer<typeof taskEnvelopeSchema>;
export type TranscriptMessage = z.infer<typeof transcriptMessageSchema>;
export type RepoPlan = z.infer<typeof repoPlanSchema>;
export type SkillRef = z.infer<typeof skillRefSchema>;
export type McpServerRef = z.infer<typeof mcpServerRefSchema>;
export type McpTransport = z.infer<typeof mcpTransportSchema>;

const REDACTED = '[redacted]';

/** The envelope as it may be logged: every secret replaced, shape kept. */
export function redactEnvelope(envelope: TaskEnvelope): unknown {
   return {
      ...envelope,
      env: Object.fromEntries(Object.keys(envelope.env).map((key) => [key, REDACTED])),
      berry: { apiUrl: envelope.berry.apiUrl, token: REDACTED },
      repo: envelope.repo
         ? { ...envelope.repo, credential: { username: envelope.repo.credential.username, password: REDACTED } }
         : null,
      agent: {
         ...envelope.agent,
         mcpServers: envelope.agent.mcpServers.map((server) => ({
            ...server,
            headers: Object.fromEntries(Object.keys(server.headers).map((key) => [key, REDACTED])),
         })),
      },
   };
}
