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
         `Hand work to ${contract.can_delegate_to.join(', ')} with delegate_to_agent, always with acceptance criteria. Do not take on work that belongs to another role.`
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
         `You review: ${contract.review_domains.join('; ')}. Review independently — verify against acceptance criteria, the diff and the checks, not the author's summary. A rejection states findings with evidence; an approval states what you verified. Your approval never releases work: a person approves the release.`
      );
   }
   lines.push(
      'When you find worthwhile work outside your task, file it with propose_work, with evidence, impact, severity, effort, dependencies, the responsible role and required reviewers. Do not silently execute changes with product, security, architectural, financial or operational impact.',
      'If you have no tool for what is asked, say so plainly and say what you can do instead — never describe an action as done.'
   );
   return lines.join('\n');
}
