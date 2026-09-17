'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { AgentMultiselect } from '@/components/common/agents/agent-multiselect';
import { AutonomyLevelChip } from '@/components/common/agents/autonomy-level-chip';
import { EscalationRulesRepeater } from '@/components/common/agents/escalation-rules-repeater';
import { StringListRepeater } from '@/components/common/agents/string-list-repeater';
import { SettingsCard, SettingsSection } from '@/components/common/settings/shared';
import { UnsavedChangesBar } from '@/components/common/unsaved-changes-bar';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { BerryApiError } from '@/lib/api';
import { updateAgentContract, type Agent } from '@/lib/agents';
import { asAutonomyLevel, type AutonomyLevel } from '@/lib/autonomy-level';
import {
   getOrganization,
   resetRole,
   type OrganizationRole,
   type RoleContract,
} from '@/lib/organization';
import { useSessionStore } from '@/store/session-store';

const AUTONOMY_LEVELS: AutonomyLevel[] = [1, 2, 3, 4, 5];

function sameContract(left: RoleContract, right: RoleContract): boolean {
   return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * The organization role this agent fills: mission, permissions, delegation.
 *
 * Edits stay in a draft until Save — same unsaved bar as skills and
 * capabilities — so a half-finished contract change is not written mid-keystroke.
 */
export function AgentRoleTab({
   agent,
   readOnly,
   onReset,
   onChange,
   onDirtyChange,
}: {
   agent: Agent;
   readOnly: boolean;
   onReset: () => void;
   onChange: (agent: Agent) => void;
   onDirtyChange?: (dirty: boolean) => void;
}) {
   const t = useTranslations('organization');
   const detail = useTranslations('agentsChat.detail');
   const common = useTranslations('agentsChat.common');
   const [resetting, setResetting] = useState(false);
   const [saving, setSaving] = useState(false);
   const [roles, setRoles] = useState<OrganizationRole[]>([]);
   const [draft, setDraft] = useState<RoleContract | null>(agent.contract ?? null);
   const workspaceRole = useSessionStore((state) => state.workspace?.role);
   const canEdit = !readOnly && (workspaceRole === 'owner' || workspaceRole === 'admin');

   useEffect(() => {
      setDraft(agent.contract ?? null);
   }, [agent.contract]);

   useEffect(() => {
      let cancelled = false;
      void getOrganization()
         .then((org) => {
            if (cancelled) return;
            setRoles(org.departments.flatMap((department) => department.roles));
         })
         .catch(() => {
            if (!cancelled) setRoles([]);
         });
      return () => {
         cancelled = true;
      };
   }, []);

   const roleOptions = useMemo(
      () =>
         roles
            .filter((role) => role.roleKey !== agent.roleKey)
            .map((role) => ({
               id: role.roleKey,
               label: role.name,
               colorSeed: role.agentId,
            }))
            .sort((left, right) => left.label.localeCompare(right.label)),
      [roles, agent.roleKey]
   );

   const saved = agent.contract;
   const dirty = draft !== null && saved != null && !sameContract(draft, saved);

   useEffect(() => {
      onDirtyChange?.(dirty);
   }, [dirty, onDirtyChange]);

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

   const resetButton = !readOnly ? (
      <div className="flex flex-col items-end gap-1">
         <Button
            size="sm"
            variant="outline"
            disabled={resetting || !canEdit || dirty}
            onClick={() => void reset()}
         >
            {t('roleTab.reset')}
         </Button>
         {!canEdit ? <p className="text-muted-foreground">{t('roleTab.adminOnly')}</p> : null}
      </div>
   ) : null;

   if (!saved || !draft) {
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

   const patch = (next: RoleContract) => setDraft(next);

   const discard = () => setDraft(saved);

   const save = async () => {
      const mission = draft.mission.trim();
      if (!mission) {
         toast.error(t('roleTab.saveFailed'));
         return;
      }
      const trimList = (items: string[]) =>
         items.map((item) => item.trim()).filter((item) => item.length > 0);
      setSaving(true);
      try {
         onChange(
            await updateAgentContract(agent.id, {
               ...draft,
               mission,
               responsibilities: trimList(draft.responsibilities),
               outputs: trimList(draft.outputs),
               inputs: trimList(draft.inputs),
               never: trimList(draft.never),
               review_domains: trimList(draft.review_domains),
               discovery: draft.discovery
                  ? { ...draft.discovery, focus: trimList(draft.discovery.focus) }
                  : draft.discovery,
               escalation_rules: draft.escalation_rules
                  .map((rule) => ({ ...rule, when: rule.when.trim() }))
                  .filter((rule) => rule.when.length > 0),
            })
         );
         toast.success(common('saved'));
      } catch (error) {
         toast.error(error instanceof BerryApiError ? error.message : t('roleTab.saveFailed'));
      } finally {
         setSaving(false);
      }
   };

   const reviewerAuthority = (reviewer: string): 'blocking' | 'advisory' => {
      const rules = draft.review_requirements.filter((rule) => rule.reviewer === reviewer);
      return rules.some((rule) => rule.authority === 'blocking') ? 'blocking' : 'advisory';
   };

   const blockingReviewers = [
      ...new Set(
         draft.review_requirements
            .map((rule) => rule.reviewer)
            .filter((reviewer) => reviewerAuthority(reviewer) === 'blocking')
      ),
   ];
   const advisoryReviewers = [
      ...new Set(
         draft.review_requirements
            .map((rule) => rule.reviewer)
            .filter((reviewer) => reviewerAuthority(reviewer) === 'advisory')
      ),
   ];

   const setReviewers = (authority: 'blocking' | 'advisory', nextIds: string[]) => {
      const other: 'blocking' | 'advisory' = authority === 'blocking' ? 'advisory' : 'blocking';
      const otherIds = (authority === 'blocking' ? advisoryReviewers : blockingReviewers).filter(
         (id) => !nextIds.includes(id)
      );

      const keptOther = draft.review_requirements
         .filter((rule) => otherIds.includes(rule.reviewer))
         .map((rule) => ({ ...rule, authority: other }));

      const forThis = nextIds.flatMap((reviewer) => {
         const existing = draft.review_requirements.filter((rule) => rule.reviewer === reviewer);
         if (existing.length > 0) {
            return existing.map((rule) => ({ ...rule, authority }));
         }
         return [{ reviewer, authority, when: { always: true as const } }];
      });

      patch({ ...draft, review_requirements: [...keptOther, ...forThis] });
   };

   const locked = !canEdit || saving;

   return (
      <div className="flex h-full min-h-0 flex-col">
         <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto p-6">
            {agent.customized ? (
               <div className="flex items-center justify-between gap-4 rounded-md border px-4 py-3">
                  <span>{t('roleTab.customized')}</span>
                  {resetButton}
               </div>
            ) : null}
            <SettingsSection
               panel
               title={t('roleTab.autonomyLevel')}
               description={t('roleTab.autonomyLevelHint')}
            >
               <Select
                  value={String(draft.autonomy_level)}
                  disabled={locked}
                  onValueChange={(value) => {
                     const next = asAutonomyLevel(Number(value));
                     if (next === null || next === draft.autonomy_level) return;
                     patch({ ...draft, autonomy_level: next });
                  }}
               >
                  <SelectTrigger className="w-full">
                     <span className="flex min-w-0 items-center gap-2">
                        <AutonomyLevelChip
                           level={draft.autonomy_level}
                           className="inline-flex items-center rounded-md px-2 py-1"
                        />
                        <span className="truncate text-muted-foreground">
                           {t(
                              `levels.${String(draft.autonomy_level) as '1' | '2' | '3' | '4' | '5'}`
                           )}
                        </span>
                     </span>
                  </SelectTrigger>
                  <SelectContent>
                     {AUTONOMY_LEVELS.map((entry) => {
                        const key = String(entry) as '1' | '2' | '3' | '4' | '5';
                        return (
                           <SelectItem key={entry} value={key}>
                              <span className="flex min-w-0 items-center gap-2">
                                 <AutonomyLevelChip
                                    level={entry}
                                    className="inline-flex items-center rounded-md px-2 py-1"
                                 />
                                 <span className="truncate text-muted-foreground">
                                    {t(`levels.${key}`)}
                                 </span>
                              </span>
                           </SelectItem>
                        );
                     })}
                  </SelectContent>
               </Select>
            </SettingsSection>
            <StringListRepeater
               title={t('roleTab.responsibilities')}
               description={t('roleTab.responsibilitiesHint')}
               value={draft.responsibilities}
               disabled={locked}
               onChange={(responsibilities) => patch({ ...draft, responsibilities })}
            />
            <StringListRepeater
               title={t('roleTab.outputs')}
               description={t('roleTab.outputsHint')}
               value={draft.outputs}
               disabled={locked}
               onChange={(outputs) => patch({ ...draft, outputs })}
            />
            <StringListRepeater
               title={t('roleTab.inputs')}
               description={t('roleTab.inputsHint')}
               value={draft.inputs}
               disabled={locked}
               onChange={(inputs) => patch({ ...draft, inputs })}
            />
            <SettingsSection
               panel
               title={t('roleTab.delegatesTo')}
               description={t('roleTab.delegatesToHint')}
            >
               <SettingsCard className="p-4">
                  <AgentMultiselect
                     value={draft.can_delegate_to}
                     options={roleOptions}
                     disabled={locked}
                     onChange={(can_delegate_to) => patch({ ...draft, can_delegate_to })}
                  />
               </SettingsCard>
            </SettingsSection>
            <SettingsSection
               panel
               title={t('roleTab.receivesFrom')}
               description={t('roleTab.receivesFromHint')}
            >
               <SettingsCard className="p-4">
                  <AgentMultiselect
                     value={draft.receives_work_from}
                     options={roleOptions}
                     disabled={locked}
                     onChange={(receives_work_from) => patch({ ...draft, receives_work_from })}
                  />
               </SettingsCard>
            </SettingsSection>
            <EscalationRulesRepeater
               title={t('roleTab.escalation')}
               description={t('roleTab.escalationHint')}
               value={draft.escalation_rules}
               roleOptions={roleOptions}
               disabled={locked}
               onChange={(escalation_rules) => patch({ ...draft, escalation_rules })}
            />
            <SettingsSection
               panel
               title={t('roleTab.reviewsBlocking')}
               description={t('roleTab.reviewsBlockingHint')}
            >
               <SettingsCard className="p-4">
                  <AgentMultiselect
                     value={blockingReviewers}
                     options={roleOptions}
                     disabled={locked}
                     onChange={(next) => setReviewers('blocking', next)}
                  />
               </SettingsCard>
            </SettingsSection>
            <SettingsSection
               panel
               title={t('roleTab.reviewsAdvisory')}
               description={t('roleTab.reviewsAdvisoryHint')}
            >
               <SettingsCard className="p-4">
                  <AgentMultiselect
                     value={advisoryReviewers}
                     options={roleOptions}
                     disabled={locked}
                     onChange={(next) => setReviewers('advisory', next)}
                  />
               </SettingsCard>
            </SettingsSection>
            <StringListRepeater
               title={t('roleTab.reviewDomains')}
               description={t('roleTab.reviewDomainsHint')}
               value={draft.review_domains}
               disabled={locked}
               onChange={(review_domains) => patch({ ...draft, review_domains })}
            />
            <StringListRepeater
               title={t('roleTab.never')}
               description={t('roleTab.neverHint')}
               value={draft.never}
               disabled={locked}
               onChange={(never) => patch({ ...draft, never })}
            />
            {draft.discovery ? (
               <StringListRepeater
                  title={t('roleTab.discovery')}
                  description={t('roleTab.discoveryHint')}
                  value={draft.discovery.focus}
                  disabled={locked}
                  onChange={(focus) =>
                     patch({
                        ...draft,
                        discovery: { ...draft.discovery!, focus },
                     })
                  }
               />
            ) : null}
         </div>

         {canEdit && dirty ? (
            <UnsavedChangesBar
               what={detail('change_role')}
               busy={saving}
               onDiscard={discard}
               onSave={() => void save()}
            />
         ) : null}
      </div>
   );
}
