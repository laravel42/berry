import { z } from 'zod';
import { CompletionFailed, type RuntimeCompletion } from '../runtime/completion.ts';
import type { SkillRepository, SkillWithFiles } from '../skills/repository.ts';
import { EditorAssistUnavailable } from '../editor/assist.ts';
import { parseContract } from '../organization/contract.ts';
import type { Sql } from '../db/pool.ts';
import { PROJECT_MILESTONE_SKILLS } from './generate-milestones.ts';

/**
 * Propose board tasks for a project's existing milestones.
 *
 * Runs as the workspace Orchestrator (`kind: 'completion'`). Guidance from
 * the same project skills the milestone generator adapts keeps the craft
 * consistent: few-day tasks, one outcome each, in delivery order. Each task
 * is also routed to the best-fit workspace agent (same roster triage uses).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PRIORITIES = new Set(['none', 'low', 'medium', 'high', 'urgent']);

const proposedTaskSchema = z.object({
   milestoneId: z.string(),
   title: z.string(),
   description: z.union([z.string(), z.null()]).optional().default(''),
   priority: z.union([z.string(), z.null()]).optional().default('medium'),
   agentId: z.union([z.string(), z.null()]).optional().default(''),
});

const answerSchema = z.object({
   tasks: z.array(proposedTaskSchema).max(60),
});

export type MilestoneBrief = {
   id: string;
   title: string;
   targetDate: string | null;
};

/** An agent the generator may assign; mirrors triage's non-orchestrator roster. */
export type AssignableAgent = {
   id: string;
   name: string;
   roleKey: string | null;
   mission: string | null;
};

export type ProposedTask = {
   milestoneId: string;
   title: string;
   description: string | null;
   priority: string;
   /** Workspace agent id, or null when none fits / none are available. */
   agentId: string | null;
};

/**
 * Who may be given generated work. The orchestrator is excluded: it decides,
 * and assigning work to itself is a loop rather than a fit.
 */
export async function listAssignableAgents(
   sql: Sql,
   workspaceId: string
): Promise<AssignableAgent[]> {
   const rows = await sql<
      Array<{
         id: string;
         name: string;
         role_key: string | null;
         role_contract: unknown;
      }>
   >`
      SELECT id, name, role_key, role_contract
        FROM agents
       WHERE workspace_id = ${workspaceId}
         AND archived_at IS NULL
         AND status <> 'offline'
         AND protected = false
       ORDER BY name`;
   return rows.map((row) => {
      const contract = row.role_contract ? parseContract(row.role_contract) : null;
      return {
         id: row.id,
         name: row.name,
         roleKey: row.role_key,
         mission: contract?.mission ?? null,
      };
   });
}

function system(today: string, skillBodies: string[], hasAgents: boolean): string {
   const skills =
      skillBodies.length === 0
         ? ''
         : `\n\nAdapted skill guidance (follow the craft; the answer shape below still wins):\n\n${skillBodies.join('\n\n---\n\n')}`;

   const assignment = hasAgents
      ? `
- agentId: the id of the best-fit agent from the Agents list for this task.
  Prefer the specialist whose mission covers the work over a generalist.
  Never invent an id. Use "" only when none of the listed agents fit.`
      : `
- agentId: always "" — this workspace has no assignable agents.`;

   return `You turn a Berry project's milestones into concrete board tasks.

Each task is work one person or agent could finish in a few days — not a
phase name, not a layer of the system, and not a restatement of the
milestone title. Every task belongs to exactly one of the milestones listed
in the user turn (use that milestone's id). List tasks in delivery order
within each milestone.

Today is ${today}.

Answer with JSON only:
{
  "tasks": [
    {
      "milestoneId": "<uuid from the list>",
      "title": "…",
      "description": "…",
      "priority": "medium",
      "agentId": "<uuid from Agents, or empty>"
    }
  ]
}

- milestoneId: must be one of the ids supplied. Never invent an id.
- title: a few words as it will appear on the board (1–120 characters).
- description: one or two sentences on done-when; use "" when nothing more
  than the title is needed.
- priority: one of none, low, medium, high, urgent. Prefer medium unless the
  brief makes urgency clear.${assignment}
- Size: two to six tasks per milestone. Never more than eight for one
  milestone, and never more than sixty in total.
- Do not invent work the brief and milestones do not support. If nothing
  can be broken down, return { "tasks": [] }.
- Do not wrap the answer in code fences.${skills}`;
}

function skillBody(skill: SkillWithFiles): string {
   const manifest = skill.fileContents.find((file) => file.path === 'SKILL.md')?.content;
   const body = (manifest ?? skill.content).trim();
   if (body === '') return '';
   return `# Skill: ${skill.name}\n\n${body}`;
}

export interface ProjectMilestoneTaskGeneratorOptions {
   defaultModel: string;
   completion: Pick<RuntimeCompletion, 'structured'>;
   skills: Pick<SkillRepository, 'byNames'>;
   /** Loads the workspace agents that may be assigned. */
   loadAgents: (workspaceId: string) => Promise<AssignableAgent[]>;
   timeoutMs?: number;
   today?: () => string;
}

export class ProjectMilestoneTaskGenerator {
   readonly #completion: Pick<RuntimeCompletion, 'structured'>;
   readonly #skills: Pick<SkillRepository, 'byNames'>;
   readonly #loadAgents: (workspaceId: string) => Promise<AssignableAgent[]>;
   readonly #defaultModel: string;
   readonly #timeoutMs: number;
   readonly #today: () => string;

   constructor(options: ProjectMilestoneTaskGeneratorOptions) {
      this.#completion = options.completion;
      this.#skills = options.skills;
      this.#loadAgents = options.loadAgents;
      this.#defaultModel = options.defaultModel;
      this.#timeoutMs = options.timeoutMs ?? 120_000;
      this.#today = options.today ?? (() => new Date().toISOString().slice(0, 10));
   }

   async propose(input: {
      workspaceId: string;
      projectName: string;
      description: string;
      milestones: readonly MilestoneBrief[];
      startDate?: string | null;
      targetDate?: string | null;
      signal?: AbortSignal;
   }): Promise<ProposedTask[]> {
      const description = input.description.trim();
      if (description === '' || input.milestones.length === 0) return [];

      const agents = await this.#loadAgents(input.workspaceId).catch(() => [] as AssignableAgent[]);

      const adapted = await this.#skills
         .byNames(input.workspaceId, [...PROJECT_MILESTONE_SKILLS])
         .catch(() => [] as SkillWithFiles[]);
      const bodies = adapted.map(skillBody).filter((body) => body !== '');

      const result = await this.#completion
         .structured({
            workspaceId: input.workspaceId,
            purpose: 'project_milestone_tasks',
            model: this.#defaultModel,
            system: system(this.#today(), bodies, agents.length > 0),
            user: userTurn(
               input.projectName,
               description,
               input.milestones,
               agents,
               input.startDate,
               input.targetDate
            ),
            schema: answerSchema,
            timeoutMs: this.#timeoutMs,
            ...(input.signal ? { signal: input.signal } : {}),
         })
         .catch((cause: unknown) => {
            throw new EditorAssistUnavailable(describeGenerationFailure(cause));
         });

      return normalizeProposedTasks(result.value.tasks, input.milestones, agents);
   }
}

function describeGenerationFailure(cause: unknown): string {
   const raw =
      cause instanceof CompletionFailed
         ? cause.message
         : cause instanceof Error
           ? cause.message
           : String(cause);
   if (/OAuth access token has expired|authentication_error|Re-authenticate/i.test(raw)) {
      return 'Claude OAuth expired — run `claude auth login` on this machine, then retry';
   }
   return `tasks could not be generated: ${raw}`;
}

function userTurn(
   projectName: string,
   description: string,
   milestones: readonly MilestoneBrief[],
   agents: readonly AssignableAgent[],
   startDate?: string | null,
   targetDate?: string | null
): string {
   const windowLines: string[] = [];
   const start = startDate?.trim() ?? '';
   const target = targetDate?.trim() ?? '';
   if (start !== '') windowLines.push(`Project start date: ${start}`);
   if (target !== '') windowLines.push(`Project target date: ${target}`);
   const window = windowLines.length === 0 ? '' : `\n${windowLines.join('\n')}`;

   const milestoneBlock = milestones
      .map((entry) => {
         const date = entry.targetDate?.trim() ? ` (target ${entry.targetDate.trim()})` : '';
         return `- ${entry.id}: ${entry.title}${date}`;
      })
      .join('\n');

   const agentsBlock =
      agents.length === 0
         ? '(none — leave agentId empty)'
         : agents
              .map((agent) => {
                 const role = agent.roleKey ? ` role=${agent.roleKey}` : '';
                 const mission = agent.mission?.trim()
                    ? `\n  mission: ${agent.mission.trim()}`
                    : '';
                 return `- ${agent.id}: ${agent.name}${role}${mission}`;
              })
              .join('\n');

   return `Project name: ${projectName.trim() || '(untitled)'}${window}

Milestones (use these ids only):
${milestoneBlock}

Agents (use these ids only for agentId):
${agentsBlock}

Description (Markdown):
${description}`;
}

const MAX_PER_MILESTONE = 8;

/** Drop blanks, unknown milestones/agents, and per-milestone overflow; keep order. */
export function normalizeProposedTasks(
   raw: readonly {
      milestoneId: string;
      title: string;
      description?: string | null;
      priority?: string | null;
      agentId?: string | null;
   }[],
   milestones: readonly MilestoneBrief[],
   agents: readonly AssignableAgent[] = []
): ProposedTask[] {
   const known = new Set(milestones.map((entry) => entry.id));
   const knownAgents = new Set(agents.map((entry) => entry.id));
   const perMilestone = new Map<string, number>();
   const seen = new Set<string>();
   const out: ProposedTask[] = [];

   for (const entry of raw) {
      const milestoneId = entry.milestoneId.trim();
      if (!UUID.test(milestoneId) || !known.has(milestoneId)) continue;

      const title = entry.title.trim().slice(0, 500);
      if (title === '') continue;
      const key = `${milestoneId}:${title.toLowerCase()}`;
      if (seen.has(key)) continue;

      const count = perMilestone.get(milestoneId) ?? 0;
      if (count >= MAX_PER_MILESTONE) continue;

      const descriptionRaw = (entry.description ?? '').trim().slice(0, 10_000);
      const priorityRaw = (entry.priority ?? 'medium').trim().toLowerCase();
      const priority = PRIORITIES.has(priorityRaw) ? priorityRaw : 'medium';
      const agentRaw = (entry.agentId ?? '').trim();
      const agentId =
         agentRaw !== '' && UUID.test(agentRaw) && knownAgents.has(agentRaw) ? agentRaw : null;

      seen.add(key);
      perMilestone.set(milestoneId, count + 1);
      out.push({
         milestoneId,
         title,
         description: descriptionRaw === '' ? null : descriptionRaw,
         priority,
         agentId,
      });
   }
   return out;
}
