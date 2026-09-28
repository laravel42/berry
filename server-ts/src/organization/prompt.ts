import type { RoleContract } from './contract.ts';

/**
 * The section headings of an agent's instructions, in order. The web app's
 * Instructions tab edits one section per heading (`frontend/lib/instructions.ts`
 * holds the same list), so a role's prompt opens there already filled in.
 */
export const PROMPT_SECTIONS = {
   role: 'Role',
   context: 'Context',
   approach: 'How to work',
   done: 'Definition of done',
   boundaries: 'Boundaries',
} as const;

/**
 * A role's system prompt, rendered from its contract so the prompt and the
 * enforced contract cannot drift. `expertise` is the one hand-written
 * paragraph: how this profession analyses before it acts.
 */
export function renderSystemPrompt(contract: Omit<RoleContract, 'system_prompt'>, expertise: string): string {
   const bullet = (items: readonly string[]) => items.map((item) => `- ${item}`).join('\n');

   const role = [`You are the ${contract.role}. ${contract.mission}`, '', 'You are responsible for:', bullet(contract.responsibilities)];

   const context = [`You work from: ${contract.inputs.join('; ')}.`];

   const approach = [`Before acting: ${expertise}`];
   if (contract.can_delegate_to.length > 0) {
      approach.push(
         '',
         `Hand work to ${contract.can_delegate_to.join(', ')}: a new piece of your task with delegate_to_agent, always with acceptance criteria; an existing task (by its key, as shown on the task) with assign_task. When one task needs another's result, record it with link_tasks (or create_task's dependsOn) before assigning: the later task then waits, and starts by itself when its prerequisites finish. Do not take on work that belongs to another role. Hand on new work only: never ask another role to review or test what you did, because the reviews your work needs run by themselves when you deliver it.`
      );
   }
   if (contract.autonomy_level === 5) {
      approach.push(
         '',
         `You review: ${contract.review_domains.join('; ')}. Review independently — verify against acceptance criteria, the diff and the checks, not the author's summary. Where a task produced no code, judge the author's account against what the task asked and refuse it if it is vague, restates the task, or claims work you have been shown no evidence of. A rejection states findings with evidence; an approval states what you verified. On a task under AutoGate your approval, with every other blocking reviewer's, is what closes it — a person delegated that to you in advance, so approve only work you would sign your name to.`
      );
   }
   // Each step is a model call of about ten seconds, and a run has a step
   // limit. Measured on implementation runs: one tool per step and a sentence
   // of narration before each, so writing a small app took more than 40 steps.
   approach.push(
      '',
      'Work in few, full steps: every step costs time and your run has a step limit. Call independent tools together in one step — read or write several files at once, run a command beside them — and chain shell commands with && instead of running them one by one. Do not narrate between tool calls; say what you did once, at the end.',
      '',
      'When you find worthwhile work outside your task, file it with propose_work, with evidence, impact, severity, effort, dependencies, the responsible role and required reviewers.'
   );
   // A run once spent its time downloading a browser and its system
   // libraries to screenshot its own work, and hung there.
   if (contract.allowed_tools.includes('run_command')) {
      approach.push(
         '',
         'Check your work with what the workspace already has: its toolchain, and `berry-screenshots <url> <dir>` for a page (phone, tablet and desktop in one command), and `berry-lighthouse <url>` for its performance and budget. Do not install browsers or other large tools just to check it; your work is reviewed after you deliver it.'
      );
   }

   const done = [`You produce: ${contract.outputs.join('; ')}.`];
   if (contract.review_requirements.length > 0) {
      const reviewers = [...new Set(contract.review_requirements.map((rule) => `${rule.reviewer} (${rule.authority})`))];
      done.push('', `Your work is reviewed by: ${reviewers.join(', ')}. Make it easy to verify: state what you changed and how you tested it.`);
   }

   const boundaries = ['You never:', bullet(contract.never)];
   if (contract.escalation_rules.length > 0) {
      boundaries.push(
         '',
         'Escalate with escalate:',
         bullet(contract.escalation_rules.map((rule) => `${rule.when} → ${rule.to} (${rule.decision} decision)`))
      );
   }
   boundaries.push(
      '',
      'Do not silently execute changes with product, security, architectural, financial or operational impact.',
      'If you have no tool for what is asked, say so plainly and say what you can do instead — never describe an action as done.'
   );

   const sections: Array<[string, string[]]> = [
      [PROMPT_SECTIONS.role, role],
      [PROMPT_SECTIONS.context, context],
      [PROMPT_SECTIONS.approach, approach],
      [PROMPT_SECTIONS.done, done],
      [PROMPT_SECTIONS.boundaries, boundaries],
   ];
   return sections.map(([heading, lines]) => `## ${heading}\n\n${lines.join('\n')}`).join('\n\n');
}
