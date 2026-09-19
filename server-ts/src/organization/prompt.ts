import type { RoleContract } from './contract.ts';

/**
 * A role's system prompt, rendered from its contract so the prompt and the
 * enforced contract cannot drift. `expertise` is the one hand-written
 * paragraph: how this profession analyses before it acts.
 */
export function renderSystemPrompt(contract: Omit<RoleContract, 'system_prompt'>, expertise: string): string {
   const bullet = (items: readonly string[]) => items.map((item) => `- ${item}`).join('\n');
   const lines: string[] = [
      `You are the ${contract.role}. ${contract.mission}`,
      '',
      'You are responsible for:',
      bullet(contract.responsibilities),
      '',
      `You produce: ${contract.outputs.join('; ')}.`,
      `You work from: ${contract.inputs.join('; ')}.`,
      '',
      `Before acting: ${expertise}`,
      '',
      'You never:',
      bullet(contract.never),
      '',
   ];
   if (contract.can_delegate_to.length > 0) {
      lines.push(
         `Hand work to ${contract.can_delegate_to.join(', ')}: a new piece of your task with delegate_to_agent, always with acceptance criteria; an existing task (by key, e.g. L42-341) with assign_task. When one task needs another's result, record it with link_tasks (or create_task's dependsOn) before assigning: the later task then waits, and starts by itself when its prerequisites finish. Do not take on work that belongs to another role.`
      );
   }
   if (contract.escalation_rules.length > 0) {
      lines.push('Escalate with escalate:');
      lines.push(bullet(contract.escalation_rules.map((rule) => `${rule.when} → ${rule.to} (${rule.decision} decision)`)));
   }
   if (contract.review_requirements.length > 0) {
      const reviewers = [...new Set(contract.review_requirements.map((rule) => `${rule.reviewer} (${rule.authority})`))];
      lines.push(`Your work is reviewed by: ${reviewers.join(', ')}. Make it easy to verify: state what you changed and how you tested it.`);
   }
   if (contract.autonomy_level === 5) {
      lines.push(
         `You review: ${contract.review_domains.join('; ')}. Review independently — verify against acceptance criteria, the diff and the checks, not the author's summary. Where a task produced no code, judge the author's account against what the task asked and refuse it if it is vague, restates the task, or claims work you have been shown no evidence of. A rejection states findings with evidence; an approval states what you verified. On a task under AutoGate your approval, with every other blocking reviewer's, is what closes it — a person delegated that to you in advance, so approve only work you would sign your name to.`
      );
   }
   // Each step is a model call of about ten seconds, and a run has a step
   // limit. Measured on implementation runs: one tool per step and a sentence
   // of narration before each, so writing a small app took more than 40 steps.
   lines.push(
      'Work in few, full steps: every step costs time and your run has a step limit. Call independent tools together in one step — read or write several files at once, run a command beside them — and chain shell commands with && instead of running them one by one. Do not narrate between tool calls; say what you did once, at the end.'
   );
   lines.push(
      'When you find worthwhile work outside your task, file it with propose_work, with evidence, impact, severity, effort, dependencies, the responsible role and required reviewers. Do not silently execute changes with product, security, architectural, financial or operational impact.',
      'If you have no tool for what is asked, say so plainly and say what you can do instead — never describe an action as done.'
   );
   return lines.join('\n');
}
