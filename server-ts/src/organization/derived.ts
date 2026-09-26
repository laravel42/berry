import type { RoleContract } from './contract.ts';

/**
 * The parts of a role contract Berry works out rather than a person sets.
 *
 * Who a role receives work from is who hands work to it; who reviews it
 * follows from whether it writes code and from the impact of what it
 * proposes. Stored contracts still carry these fields — the catalogue wrote
 * them, and an untouched role's stored values are exactly what this derives —
 * but nothing reads the stored copy: every reader asks here, so an agent a
 * person described is reviewed and reached the same way a catalogue role is.
 */

/** Paths whose change calls in a specialist reviewer. */
export const CODE_PATHS = {
   security: ['**/auth/**', '**/integrations/**', '**/*secret*', '**/Dockerfile', '.github/**', '**/iam/**', '**/sealing*'],
   architecture: ['server-ts/src/index.ts', '**/migrations/**', 'server-ts/src/http/**', 'server-ts/src/runtime/**'],
   database: ['**/migrations/**', '**/*.sql'],
   frontend: ['frontend/components/**', 'frontend/app/**'],
};

/** A role writes code when its tools can run commands in the workspace. */
export function writesCode(contract: Pick<RoleContract, 'allowed_tools'>): boolean {
   return contract.allowed_tools.includes('run_command');
}

/**
 * Who reviews a role's work, and with what authority. A role that writes code
 * is always reviewed by QA, and by a specialist when its change touches that
 * specialist's paths or labels; any role's proposals are reviewed by the
 * owner of their impact. A role never reviews itself.
 */
export function deriveReviewRequirements(
   contract: Pick<RoleContract, 'id' | 'allowed_tools'>
): RoleContract['review_requirements'] {
   const rules: RoleContract['review_requirements'] = [];
   const add = (rule: RoleContract['review_requirements'][number]) => {
      if (rule.reviewer !== contract.id) rules.push(rule);
   };
   if (writesCode(contract)) {
      add({ reviewer: 'qa-engineer', authority: 'blocking', when: { always: true } });
      add({ reviewer: 'security-engineer', authority: 'blocking', when: { labels_any: ['security'], paths_any: CODE_PATHS.security } });
      add({ reviewer: 'software-architect', authority: 'blocking', when: { labels_any: ['architecture'], paths_any: CODE_PATHS.architecture } });
      add({ reviewer: 'database-engineer', authority: 'advisory', when: { paths_any: CODE_PATHS.database } });
      add({ reviewer: 'product-designer', authority: 'advisory', when: { labels_any: ['design'], paths_any: CODE_PATHS.frontend } });
   }
   add({ reviewer: 'product-lead', authority: 'blocking', when: { workflow_any: ['full-delivery'], impact_any: ['product'] } });
   add({ reviewer: 'security-engineer', authority: 'blocking', when: { impact_any: ['security'] } });
   add({ reviewer: 'software-architect', authority: 'blocking', when: { impact_any: ['architectural'] } });
   // Spec §9: the CTO reviews proposals whose impact is architectural and whose severity is critical.
   add({ reviewer: 'cto', authority: 'blocking', when: { impact_any: ['architectural:critical'] } });
   const seen = new Set<string>();
   return rules.filter((rule) => {
      const key = JSON.stringify(rule);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
   });
}

/** Who hands work to `roleKey`: every other role whose contract lists it, in the order given. */
export function deriveReceivesWorkFrom(
   roleKey: string,
   peers: ReadonlyArray<Pick<RoleContract, 'id' | 'can_delegate_to'>>
): RoleContract['receives_work_from'] {
   return peers
      .filter((peer) => peer.id !== roleKey && peer.can_delegate_to.includes(roleKey as never))
      .map((peer) => peer.id);
}

/**
 * The contract as Berry reads it: the stored one with the derived parts
 * worked out again from it and from the workspace's other roles.
 */
export function effectiveContract(
   contract: RoleContract,
   peers: ReadonlyArray<Pick<RoleContract, 'id' | 'can_delegate_to'>>
): RoleContract {
   return {
      ...contract,
      receives_work_from: deriveReceivesWorkFrom(contract.id, peers),
      review_requirements: deriveReviewRequirements(contract),
   };
}
