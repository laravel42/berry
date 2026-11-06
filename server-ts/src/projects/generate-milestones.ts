import { z } from 'zod';
import { CompletionFailed, type RuntimeCompletion } from '../runtime/completion.ts';
import type { SkillRepository, SkillWithFiles } from '../skills/repository.ts';
import { EditorAssistUnavailable } from '../editor/assist.ts';

/**
 * Propose project milestones from a project's brief.
 *
 * Runs as the workspace Orchestrator (a `kind: 'completion'` task). Guidance
 * from the workspace's project skills is adapted into the system prompt so the
 * answer follows the same craft those skills teach for schedules and kickoffs.
 */

/** Skills whose bodies are adapted into the prompt when the workspace has them. */
export const PROJECT_MILESTONE_SKILLS = [
   'project-schedule',
   'project-kickoff-pack',
   'project-scope-statement',
] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const proposedMilestoneSchema = z.object({
   title: z.string(),
   // Models often send null instead of ""; accept both.
   date: z.union([z.string(), z.null()]).optional().default(''),
});

const answerSchema = z.object({
   milestones: z.array(proposedMilestoneSchema).max(12),
});

export type ProposedMilestone = {
   title: string;
   /** Target date as `YYYY-MM-DD`, or null when the model left it blank. */
   date: string | null;
};

function system(today: string, skillBodies: string[]): string {
   const skills =
      skillBodies.length === 0
         ? ''
         : `\n\nAdapted skill guidance (follow the craft; the answer shape below still wins):\n\n${skillBodies.join('\n\n---\n\n')}`;

   return `You turn a new Berry project brief into a short list of milestones.

A milestone is an outcome someone could see working on its own — not a phase
name like "backend" or "testing", and not a layer of the system. List them in
delivery order. Size the list to the brief: a thin project is two or three
milestones; a broad one may need more, and never more than twelve.

Today is ${today}.

Answer with JSON only:
{
  "milestones": [
    { "title": "…", "date": "YYYY-MM-DD" }
  ]
}

- title: the milestone as it will appear on the project (a few words).
- date: the target date as YYYY-MM-DD. Always set one — never leave date
  empty. Prefer on or after today. Space milestones in delivery order: a few
  weeks apart for a thin project, or across several months for a broad one
  (launch / GTM briefs usually need a multi-month arc). When the project
  names start or target dates, stay inside that window.
- Do not invent work the brief does not support. If the brief is empty or too
  vague for any milestone, return { "milestones": [] }.
- Do not wrap the answer in code fences.${skills}`;
}

function skillBody(skill: SkillWithFiles): string {
   const manifest = skill.fileContents.find((file) => file.path === 'SKILL.md')?.content;
   const body = (manifest ?? skill.content).trim();
   if (body === '') return '';
   return `# Skill: ${skill.name}\n\n${body}`;
}

export interface ProjectMilestoneGeneratorOptions {
   defaultModel: string;
   completion: Pick<RuntimeCompletion, 'structured'>;
   skills: Pick<SkillRepository, 'byNames'>;
   timeoutMs?: number;
   /** For a test that wants a fixed calendar. */
   today?: () => string;
}

export class ProjectMilestoneGenerator {
   readonly #completion: Pick<RuntimeCompletion, 'structured'>;
   readonly #skills: Pick<SkillRepository, 'byNames'>;
   readonly #defaultModel: string;
   readonly #timeoutMs: number;
   readonly #today: () => string;

   constructor(options: ProjectMilestoneGeneratorOptions) {
      this.#completion = options.completion;
      this.#skills = options.skills;
      this.#defaultModel = options.defaultModel;
      this.#timeoutMs = options.timeoutMs ?? 90_000;
      this.#today = options.today ?? (() => new Date().toISOString().slice(0, 10));
   }

   async propose(input: {
      workspaceId: string;
      projectName: string;
      description: string;
      startDate?: string | null;
      targetDate?: string | null;
      signal?: AbortSignal;
   }): Promise<ProposedMilestone[]> {
      const description = input.description.trim();
      if (description === '') return [];

      const adapted = await this.#skills
         .byNames(input.workspaceId, [...PROJECT_MILESTONE_SKILLS])
         .catch(() => [] as SkillWithFiles[]);
      const bodies = adapted.map(skillBody).filter((body) => body !== '');

      const result = await this.#completion
         .structured({
            workspaceId: input.workspaceId,
            purpose: 'project_milestones',
            model: this.#defaultModel,
            system: system(this.#today(), bodies),
            user: userTurn(input.projectName, description, input.startDate, input.targetDate),
            schema: answerSchema,
            timeoutMs: this.#timeoutMs,
            ...(input.signal ? { signal: input.signal } : {}),
         })
         .catch((cause: unknown) => {
            throw new EditorAssistUnavailable(describeGenerationFailure(cause));
         });

      return fillMissingDates(normalizeProposed(result.value.milestones), this.#today());
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
   return `milestones could not be generated: ${raw}`;
}

function userTurn(
   projectName: string,
   description: string,
   startDate?: string | null,
   targetDate?: string | null
): string {
   const windowLines: string[] = [];
   const start = startDate?.trim() ?? '';
   const target = targetDate?.trim() ?? '';
   if (start !== '') windowLines.push(`Project start date: ${start}`);
   if (target !== '') windowLines.push(`Project target date: ${target}`);
   const window =
      windowLines.length === 0 ? '' : `\n\n${windowLines.join('\n')}`;
   return `Project name: ${projectName.trim() || '(untitled)'}${window}\n\nDescription (Markdown):\n${description}`;
}

/** Drop blanks and duplicates; keep delivery order. */
export function normalizeProposed(
   raw: readonly { title: string; date?: string | null }[]
): ProposedMilestone[] {
   const seen = new Set<string>();
   const out: ProposedMilestone[] = [];
   for (const entry of raw) {
      const title = entry.title.trim().slice(0, 500);
      if (title === '') continue;
      const key = title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ title, date: isoDate(entry.date ?? '') });
   }
   return out;
}

function isoDate(value: string): string | null {
   const trimmed = value.trim();
   if (trimmed === '' || !ISO_DATE.test(trimmed)) return null;
   return Number.isNaN(Date.parse(trimmed)) ? null : trimmed;
}

/** When the model skips dates, space milestones ~3 weeks apart from today. */
export function fillMissingDates(
   milestones: readonly ProposedMilestone[],
   today: string
): ProposedMilestone[] {
   const start = Date.parse(today);
   if (Number.isNaN(start)) return [...milestones];
   let missingIndex = 0;
   return milestones.map((entry) => {
      if (entry.date !== null) return entry;
      const day = new Date(start);
      day.setUTCDate(day.getUTCDate() + 21 * (missingIndex + 1));
      missingIndex += 1;
      return { title: entry.title, date: day.toISOString().slice(0, 10) };
   });
}
