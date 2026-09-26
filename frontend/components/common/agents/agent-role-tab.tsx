'use client';

import { Check } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { AutonomyLevelChip } from '@/components/common/agents/autonomy-level-chip';
import { FormRow } from '@/components/common/settings/form-row';
import { SettingsCard } from '@/components/common/settings/shared';
import { UnsavedChangesBar } from '@/components/common/unsaved-changes-bar';
import {
   AlertDialog,
   AlertDialogAction,
   AlertDialogCancel,
   AlertDialogContent,
   AlertDialogDescription,
   AlertDialogFooter,
   AlertDialogHeader,
   AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { BerryApiError } from '@/lib/api';
import {
   AGENT_PERMISSIONS,
   setAgentPermissions,
   updateAgentContract,
   type Agent,
} from '@/lib/agents';
import { permissionsForLevel, type AutonomyLevel } from '@/lib/autonomy-level';
import { cn } from '@/lib/utils';
import { resetRole } from '@/lib/organization';
import { useSessionStore } from '@/store/session-store';

const AUTONOMY_LEVELS: AutonomyLevel[] = [1, 2, 3, 4, 5];

type LevelKey = '1' | '2' | '3' | '4' | '5';

const sameSet = (a: readonly string[], b: readonly string[]) =>
   a.length === b.length && a.every((entry) => b.includes(entry));

/**
 * The organization role this agent fills, on the agent's Role and Permissions
 * tab: its autonomy level, then its permissions. The rest of the contract is
 * Berry's and is not shown here. An agent with no role shows only its
 * permissions.
 *
 * Both are a draft until Save. Choosing a level sets the switches to what the
 * server will give that level, so the change can be seen and adjusted first;
 * choosing the saved level again brings back the saved permissions. Save
 * writes the level, then any permissions that still differ from what the
 * level gave.
 *
 * A role someone changed offers Reset, after a confirmation: it puts the
 * level, permissions, instructions and description back to Berry's.
 */
export function AgentRoleTab({
   agent,
   readOnly,
   onReset,
   onChange,
   onDirtyChange,
   onForbidden,
}: {
   agent: Agent;
   readOnly: boolean;
   onReset: () => void;
   onChange: (agent: Agent) => void;
   /** Told whenever the tab holds unsaved changes, for the page's leave guard. */
   onDirtyChange: (dirty: boolean) => void;
   /** Called when the server refuses a write, so the page can say so once. */
   onForbidden: () => void;
}) {
   const t = useTranslations('organization');
   const detail = useTranslations('agentsChat.detail');
   const common = useTranslations('agentsChat.common');
   const admin = useTranslations('workspaceAdmin.agents');
   const [resetting, setResetting] = useState(false);
   const [confirmingReset, setConfirmingReset] = useState(false);
   const [saving, setSaving] = useState(false);
   const [levelDraft, setLevelDraft] = useState<AutonomyLevel | null>(null);
   const [permissionsDraft, setPermissionsDraft] = useState<string[] | null>(null);
   const workspaceRole = useSessionStore((state) => state.workspace?.role);
   const canEdit = !readOnly && (workspaceRole === 'owner' || workspaceRole === 'admin');

   const saved = agent.roleKey ? (agent.contract ?? null) : null;
   const level = levelDraft ?? saved?.autonomy_level ?? null;
   const permissions = permissionsDraft ?? agent.permissions;

   const levelDirty = saved !== null && level !== saved.autonomy_level;
   const permissionsDirty = !sameSet(permissions, agent.permissions);
   const dirty = levelDirty || permissionsDirty;

   useEffect(() => {
      onDirtyChange(dirty);
   }, [dirty, onDirtyChange]);

   const discard = () => {
      setLevelDraft(null);
      setPermissionsDraft(null);
   };

   const chooseLevel = (next: AutonomyLevel) => {
      if (!saved) return;
      if (next === saved.autonomy_level) {
         discard();
         return;
      }
      setLevelDraft(next);
      setPermissionsDraft(permissionsForLevel(next));
   };

   const togglePermission = (key: string, granted: boolean) => {
      setPermissionsDraft(
         granted
            ? [...new Set([...permissions, key])]
            : permissions.filter((entry) => entry !== key)
      );
   };

   const save = async () => {
      setSaving(true);
      try {
         let next = agent;
         if (saved && levelDirty && level !== null) {
            next = await updateAgentContract(agent.id, { ...saved, autonomy_level: level });
         }
         if (!sameSet(permissions, next.permissions)) {
            next = await setAgentPermissions(agent.id, permissions);
         }
         onChange(next);
         discard();
         toast.success(common('saved'));
      } catch (error) {
         if (error instanceof BerryApiError && error.status === 403) onForbidden();
         toast.error(error instanceof BerryApiError ? error.message : t('roleTab.saveFailed'));
      } finally {
         setSaving(false);
      }
   };

   const reset = async () => {
      setResetting(true);
      try {
         await resetRole(agent.roleKey as string);
         discard();
         toast.success(t('roleTab.resetDone'));
         onReset();
      } catch (error) {
         toast.error(error instanceof Error ? error.message : String(error));
      } finally {
         setResetting(false);
      }
   };

   const whatChanged = [
      levelDirty ? detail('change_autonomy') : null,
      permissionsDirty ? detail('change_permissions') : null,
   ]
      .filter(Boolean)
      .join(', ');

   const permissionsLocked = readOnly || saving;

   const permissionsPanel = (
      <FormRow label={admin('permissions')} caption={admin('permissionsHint')}>
         <SettingsCard>
            {AGENT_PERMISSIONS.map((permission) => (
               <label
                  key={permission.key}
                  className="flex items-start gap-3 px-4 py-3"
                  htmlFor={`${agent.id}-${permission.key}`}
               >
                  <span className="min-w-0 flex-1">
                     <span
                        className={cn('block', 'dangerous' in permission && 'text-status-danger')}
                     >
                        {permission.label}
                     </span>
                     <span className="block text-muted-foreground">{permission.description}</span>
                  </span>
                  <Switch
                     id={`${agent.id}-${permission.key}`}
                     checked={permissions.includes(permission.key)}
                     disabled={permissionsLocked}
                     onCheckedChange={(granted) => togglePermission(permission.key, granted)}
                  />
               </label>
            ))}
         </SettingsCard>
      </FormRow>
   );

   const saveBar =
      !readOnly && dirty ? (
         <UnsavedChangesBar
            what={whatChanged}
            busy={saving}
            onDiscard={discard}
            onSave={() => void save()}
         />
      ) : null;

   // The form scrolls; the save bar stays on the bottom edge of the tab.
   const pane = (body: ReactNode) => (
      <div className="flex h-full min-h-0 flex-1 flex-col">
         <div className="min-h-0 flex-1 overflow-auto px-8 py-6">{body}</div>
         {saveBar}
      </div>
   );

   if (!agent.roleKey) {
      return pane(
         <div className="flex flex-col gap-4">
            <p className="text-muted-foreground">{t('roleTab.notARole')}</p>
            {permissionsPanel}
         </div>
      );
   }

   const resetButton = !readOnly ? (
      <div className="flex flex-col items-end gap-1">
         <Button
            size="sm"
            variant="outline"
            disabled={resetting || !canEdit || saving}
            onClick={() => void reset()}
         >
            {t('roleTab.reset')}
         </Button>
         {!canEdit ? <p className="text-muted-foreground">{t('roleTab.adminOnly')}</p> : null}
      </div>
   ) : null;

   if (!saved) {
      return pane(
         <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-4 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3">
               <div>
                  <p>{t('roleTab.contractInvalid')}</p>
                  <p className="text-muted-foreground">{t('roleTab.contractInvalidHint')}</p>
               </div>
               {resetButton}
            </div>
            {permissionsPanel}
         </div>
      );
   }

   const levelLocked = !canEdit || saving;

   return pane(
      <>
         <FormRow label={t('roleTab.autonomyLevel')} caption={t('roleTab.autonomyLevelHint')}>
            <div
               role="radiogroup"
               aria-label={t('roleTab.autonomyLevel')}
               className="flex flex-col overflow-hidden rounded-md border"
            >
               {AUTONOMY_LEVELS.map((entry) => {
                  const selected = entry === level;
                  return (
                     <button
                        key={entry}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        disabled={levelLocked}
                        onClick={() => {
                           if (!selected) chooseLevel(entry);
                        }}
                        className={cn(
                           'flex min-w-0 items-center gap-3 border-t px-3 py-2 text-left outline-none first:border-t-0 focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default',
                           selected ? 'bg-accent/60' : 'enabled:hover:bg-accent/30'
                        )}
                     >
                        <AutonomyLevelChip
                           level={entry}
                           className="inline-flex shrink-0 items-center rounded-md px-2 py-1"
                        />
                        <span
                           className={cn('min-w-0 flex-1', !selected && 'text-muted-foreground')}
                        >
                           {t(`levels.${String(entry) as LevelKey}`)}
                        </span>
                        {selected ? <Check aria-hidden className="size-4 shrink-0" /> : null}
                     </button>
                  );
               })}
            </div>
         </FormRow>
         {permissionsPanel}
         {agent.customized && !readOnly ? (
            <FormRow label={t('roleTab.customized')} caption={t('roleTab.customizedHint')}>
               <div className="flex flex-col items-start gap-1">
                  <Button
                     size="sm"
                     variant="outline"
                     disabled={resetting || !canEdit || saving}
                     onClick={() => setConfirmingReset(true)}
                  >
                     {t('roleTab.reset')}
                  </Button>
                  {!canEdit ? (
                     <p className="text-muted-foreground">{t('roleTab.adminOnly')}</p>
                  ) : null}
               </div>
            </FormRow>
         ) : null}
         <AlertDialog open={confirmingReset} onOpenChange={setConfirmingReset}>
            <AlertDialogContent>
               <AlertDialogHeader>
                  <AlertDialogTitle>{t('roleTab.resetConfirmTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>{t('roleTab.resetConfirmBody')}</AlertDialogDescription>
               </AlertDialogHeader>
               <AlertDialogFooter>
                  <AlertDialogCancel>{common('cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void reset()}>
                     {t('roleTab.reset')}
                  </AlertDialogAction>
               </AlertDialogFooter>
            </AlertDialogContent>
         </AlertDialog>
      </>
   );
}
