'use client';

import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { SettingsCard, SettingsRow, SettingsSection, SettingsShell } from './shared';
import { useSettingsResource } from './use-settings-resource';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
   getOrganization,
   resetRole,
   setDiscovery,
   type Organization,
   type OrganizationRole,
} from '@/lib/organization';
import { useSessionStore } from '@/store/session-store';

/**
 * The default organization: every role your agents fill, grouped by
 * department, plus whether roles look for their own work each week.
 *
 * A role whose stored contract no longer validates (`contractValid: false`)
 * is still listed — its catalog data (name, autonomy level) still renders —
 * but is flagged and offered only a reset, since there is nothing else safe
 * to show for it.
 */
export default function OrganizationSettings() {
   const t = useTranslations('organization');
   const { orgId } = useParams<{ orgId: string }>();
   const router = useRouter();
   const org = useSettingsResource<Organization>(getOrganization);
   const value = org.value;
   const workspaceRole = useSessionStore((state) => state.workspace?.role);
   const canEdit = workspaceRole === 'owner' || workspaceRole === 'admin';
   // Which role's reset is in flight, so only that row's button disables and
   // a double-click cannot fire a second POST before the first settles.
   const [resettingKey, setResettingKey] = useState<string | null>(null);

   const toggleDiscovery = (enabled: boolean) => {
      if (!value || !canEdit) return;
      void org.mutate(
         { ...value, discoveryEnabled: enabled },
         async () => {
            const discoveryEnabled = await setDiscovery(enabled);
            return { ...value, discoveryEnabled };
         }
      );
   };

   const reset = async (roleKey: string) => {
      if (!canEdit || resettingKey) return;
      setResettingKey(roleKey);
      try {
         await resetRole(roleKey);
         org.reload();
      } catch (error) {
         toast.error(error instanceof Error ? error.message : String(error));
      } finally {
         setResettingKey(null);
      }
   };

   /** "Role · Autonomy level N · Active/Paused" — the one line of context a row needs. */
   const roleDescription = (role: OrganizationRole): string => {
      const status = role.discovery
         ? t(role.discovery.status === 'active' ? 'settings.active' : 'settings.paused')
         : '—';
      return `${role.role} · ${t('roleTab.autonomy', { level: role.autonomyLevel ?? '—' })} · ${status}`;
   };

   return (
      <SettingsShell title={t('settings.title')} description={t('settings.description')}>
         {org.error ? <p className="text-destructive">{org.error}</p> : null}
         {org.loading && !value ? (
            <div className="flex flex-col gap-3">
               <Skeleton className="h-14 w-full" />
               <Skeleton className="h-40 w-full" />
               <Skeleton className="h-40 w-full" />
            </div>
         ) : null}

         {value ? (
            <>
               <SettingsSection>
                  <SettingsCard>
                     <SettingsRow
                        title={t('settings.discovery')}
                        description={t('settings.discoveryHint')}
                        trailing={
                           <Switch
                              checked={value.discoveryEnabled}
                              disabled={org.saving || !canEdit}
                              onCheckedChange={toggleDiscovery}
                           />
                        }
                     >
                        {!canEdit ? (
                           <p className="text-muted-foreground">{t('settings.adminOnly')}</p>
                        ) : null}
                     </SettingsRow>
                  </SettingsCard>
               </SettingsSection>

               {value.departments.map((department) => (
                  <SettingsSection
                     key={department.key}
                     title={t(`departments.${department.key}` as 'departments.product')}
                  >
                     <SettingsCard>
                        {department.roles.map((role) =>
                           role.contractValid ? (
                              <SettingsRow
                                 key={role.roleKey}
                                 title={role.name}
                                 description={roleDescription(role)}
                                 chevron
                                 onClick={() =>
                                    router.push(`/${orgId}/agents/${role.agentId}?view=role`)
                                 }
                              />
                           ) : (
                              <SettingsRow
                                 key={role.roleKey}
                                 title={role.name}
                                 description={roleDescription(role)}
                                 trailing={
                                    <span className="flex items-center gap-2">
                                       <span className="text-destructive">
                                          {t('settings.contractInvalid')}
                                       </span>
                                       <Button
                                          size="xs"
                                          variant="outline"
                                          disabled={!canEdit || resettingKey === role.roleKey}
                                          title={canEdit ? undefined : t('settings.adminOnly')}
                                          onClick={() => void reset(role.roleKey)}
                                       >
                                          {t('settings.reset')}
                                       </Button>
                                    </span>
                                 }
                              />
                           )
                        )}
                     </SettingsCard>
                  </SettingsSection>
               ))}

               <SettingsSection title={t('settings.workflows')}>
                  <SettingsCard>
                     {value.workflows.map((workflow) => (
                        <SettingsRow
                           key={workflow.key}
                           title={workflow.name}
                           description={workflow.chain.join(' → ')}
                        />
                     ))}
                  </SettingsCard>
               </SettingsSection>
            </>
         ) : null}
      </SettingsShell>
   );
}
