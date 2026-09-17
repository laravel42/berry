import type { RoleContract } from './contract.ts';

/**
 * Which roles must review a piece of delivered work, from the author's
 * contract and what the work touched: its labels, the paths it changed, the
 * impact classes it carries and the workflow it belongs to.
 */

export interface ReviewSubject {
   labels: string[];
   paths: string[];
   impactClasses: string[];
   /** The severity of the accepted proposal that raised the task; null when it was not proposed. */
   severity: string | null;
   workflow: string | null;
}

/** `class` needs that proposal impact class; `class:severity` also needs the proposal's severity. */
function impactMatches(rule: string, subject: ReviewSubject): boolean {
   const [impact, severity] = rule.split(':', 2);
   if (!subject.impactClasses.includes(impact ?? '')) return false;
   return severity === undefined || severity === subject.severity;
}

export function globMatch(pattern: string, path: string): boolean {
   let source = '';
   for (let i = 0; i < pattern.length; i += 1) {
      const char = pattern[i]!;
      if (char === '*' && pattern[i + 1] === '*') {
         // "**/" matches zero or more directories; a trailing "**" matches the rest.
         if (pattern[i + 2] === '/') { source += '(?:.*/)?'; i += 2; } else { source += '.*'; i += 1; }
      } else if (char === '*') {
         source += '[^/]*';
      } else {
         source += /[.+?^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
      }
   }
   return new RegExp(`^${source}$`, 's').test(path);
}

function applies(when: RoleContract['review_requirements'][number]['when'], subject: ReviewSubject): boolean {
   if (when.always) return true;
   const labels = new Set(subject.labels.map((label) => label.toLowerCase()));
   return Boolean(
      when.labels_any?.some((label) => labels.has(label.toLowerCase())) ||
         when.paths_any?.some((pattern) => subject.paths.some((path) => globMatch(pattern, path))) ||
         when.impact_any?.some((impact) => impactMatches(impact, subject)) ||
         (subject.workflow !== null && when.workflow_any?.includes(subject.workflow))
   );
}

export function requiredReviews(
   requirements: RoleContract['review_requirements'],
   subject: ReviewSubject
): Array<{ reviewer: string; authority: 'blocking' | 'advisory' }> {
   const chosen = new Map<string, 'blocking' | 'advisory'>();
   for (const rule of requirements) {
      if (!applies(rule.when, subject)) continue;
      if (chosen.get(rule.reviewer) === 'blocking') continue;
      chosen.set(rule.reviewer, rule.authority);
   }
   return [...chosen].map(([reviewer, authority]) => ({ reviewer, authority }));
}
