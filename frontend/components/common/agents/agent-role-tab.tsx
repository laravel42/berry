'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { SettingsCard, SettingsSection } from '@/components/common/settings/shared';
import { Button } from '@/components/ui/button';
import type { Agent } from '@/lib/agents';
import { resetRole } from '@/lib/organization';
import { useSessionStore } from '@/store/session-store';

function List({ items }: { items: string[] }) {
   return (
      <ul className="list-disc space-y-1 pl-5">
         {items.map((item) => (
            <li key={item}>{item}</li>
         ))}
      </ul>
   );
}

/**
 * The organization role this agent fills: mission, permissions, delegation.
 *
 * Three states: not a role at all (`agent.roleKey` is null — a plain agent,
 * whose permissions live in Settings → Agents instead); a role whose stored
 * contract no longer validates (`roleKey` set, `contract` null — reset is the
 * only action offered, since there is nothing else to render); and a normal
 * role, optionally customized away from Berry's shipped version.
 */
export function AgentRoleTab({
   agent,
   readOnly,
   onReset,
}: {
   agent: Agent;
   readOnly: boolean;
   onReset: () => void;
}) {
   const t = useTranslations('organization');
   const [resetting, setResetting] = useState(false);
   const workspaceRole = useSessionStore((state) => state.workspace?.role);
   const canEdit = workspaceRole === 'owner' || workspaceRole === 'admin';

   if (!agent.roleKey) {
      return <p className="p-6 text-muted-foreground">{t('roleTab.notARole')}</p>;
   }

   const reset = async () => {
      setResetting(true);
      try {
         await resetRole(agent.roleKey as string);
         toast.success(t('roleTab.resetDone'));
         onReset();
      } catch (error) {
         toast.error(error instanceof Error ? error.message : String(error));
      } finally {
         setResetting(false);
      }
   };

   // Not hidden when the viewer cannot edit: a disabled control plus a hint
   // says what is possible here at all, where an absent one just looks like
   // the feature does not exist.
   const resetButton = !readOnly ? (
      <div className="flex flex-col items-end gap-1">
         <Button
            size="sm"
            variant="outline"
            disabled={resetting || !canEdit}
            onClick={() => void reset()}
         >
            {t('roleTab.reset')}
         </Button>
         {!canEdit ? <p className="text-muted-foreground">{t('roleTab.adminOnly')}</p> : null}
      </div>
   ) : null;

   const contract = agent.contract;
   if (!contract) {
      return (
         <div className="flex flex-col gap-3 p-6">
            <div className="flex items-center justify-between gap-4 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3">
               <div>
                  <p>{t('roleTab.contractInvalid')}</p>
                  <p className="text-muted-foreground">{t('roleTab.contractInvalidHint')}</p>
               </div>
               {resetButton}
            </div>
         </div>
      );
   }

   const level = String(contract.autonomy_level) as '1' | '2' | '3' | '4' | '5';
   const reviewers = [
      ...new Set(contract.review_requirements.map((rule) => `${rule.reviewer} (${rule.authority})`)),
   ];

   return (
      <div className="flex flex-col gap-6 p-6">
         <div>
            <h2 className="font-medium">{contract.role}</h2>
            <div className="text-muted-foreground">
               {t(`departments.${contract.department}` as 'departments.product')} ·{' '}
               {t('roleTab.autonomy', { level: contract.autonomy_level })} — {t(`levels.${level}`)}
            </div>
         </div>
         {agent.customized ? (
            <div className="flex items-center justify-between gap-4 rounded-md border px-4 py-3">
               <span>{t('roleTab.customized')}</span>
               {resetButton}
            </div>
         ) : null}
         <SettingsSection title={t('roleTab.mission')}>
            <SettingsCard className="p-4">{contract.mission}</SettingsCard>
         </SettingsSection>
         <SettingsSection title={t('roleTab.responsibilities')}>
            <SettingsCard className="p-4">
               <List items={contract.responsibilities} />
            </SettingsCard>
         </SettingsSection>
         <SettingsSection title={t('roleTab.outputs')}>
            <SettingsCard className="p-4">
               <List items={contract.outputs} />
            </SettingsCard>
         </SettingsSection>
         <SettingsSection title={t('roleTab.inputs')}>
            <SettingsCard className="p-4">
               <List items={contract.inputs} />
            </SettingsCard>
         </SettingsSection>
         <SettingsSection title={t('roleTab.delegatesTo')}>
            <SettingsCard className="p-4">{contract.can_delegate_to.join(', ') || '—'}</SettingsCard>
         </SettingsSection>
         <SettingsSection title={t('roleTab.receivesFrom')}>
            <SettingsCard className="p-4">{contract.receives_work_from.join(', ') || '—'}</SettingsCard>
         </SettingsSection>
         <SettingsSection title={t('roleTab.escalation')}>
            <SettingsCard className="p-4">
               <List items={contract.escalation_rules.map((rule) => `${rule.when} → ${rule.to}`)} />
            </SettingsCard>
         </SettingsSection>
         {reviewers.length ? (
            <SettingsSection title={t('roleTab.reviews')}>
               <SettingsCard className="p-4">{reviewers.join(', ')}</SettingsCard>
            </SettingsSection>
         ) : null}
         {contract.review_domains.length ? (
            <SettingsSection title={t('roleTab.reviewDomains')}>
               <SettingsCard className="p-4">
                  <List items={contract.review_domains} />
               </SettingsCard>
            </SettingsSection>
         ) : null}
         <SettingsSection title={t('roleTab.never')}>
            <SettingsCard className="p-4">
               <List items={contract.never} />
            </SettingsCard>
         </SettingsSection>
         {contract.discovery ? (
            <SettingsSection title={t('roleTab.discovery')}>
               <SettingsCard className="p-4">
                  <List items={contract.discovery.focus} />
               </SettingsCard>
            </SettingsSection>
         ) : null}
      </div>
   );
}
