'use client';

import { CustomizeSidebarDialog } from '@/components/layout/sidebar/customize-sidebar-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { writeLocaleCookie } from '@/lib/i18n/client-locale';
import { LOCALE_NAMES, LOCALES, isLocale } from '@/lib/i18n/locales';
import {
   loadProfile,
   loadUserSettings,
   saveProfile,
   saveUserSettings,
   type Profile as ProfileRecord,
   type UserSettings,
} from '@/lib/settings';
import { useSessionStore } from '@/store/session-store';
import { CREATE_FIELDS, useUiPrefsStore } from '@/store/ui-prefs-store';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { SaveIndicator } from './save-indicator';
import { SelectMenu, SettingsCard, SettingsRow, SettingsSection, SettingsShell } from './shared';
import { useAutosave } from './use-autosave';
import { useSettingsResource } from './use-settings-resource';

/**
 * Personal "Preferences" settings.
 *
 * Language, timezone, full name and reduced motion live on `/me/settings`
 * and `/me`. Theme is Berry dark, always; there is no picker.
 * Anything neither endpoint stores is not offered: a switch that accepts a
 * click and forgets it teaches people that the settings page does not work.
 *
 * Sidebar customisation stays because it is real: it is stored in the browser
 * by `sidebar-prefs-store`, and it says so.
 */
export default function Preferences() {
   const t = useTranslations('settings.preferences');
   const t5 = useTranslations('workspaceAdmin.preferences');
   const rendered = useLocale();
   const ui = useUiPrefsStore();
   const router = useRouter();
   const setPreferredLocale = useSessionStore((state) => state.setPreferredLocale);
   const [customizeOpen, setCustomizeOpen] = useState(false);
   const settings = useSettingsResource<UserSettings>(loadUserSettings);
   const profile = useSettingsResource<ProfileRecord>(loadProfile);
   const locale = settings.value?.locale;

   const name = useAutosave<string>({
      saved: profile.value?.name,
      equals: (a, b) => a.trim() === b.trim(),
      accepts: (next) => next.trim() !== '',
      save: async (next) => profile.set(await saveProfile({ name: next.trim() })),
   });

   // The browser's own list, which is the only list guaranteed to match what
   // the server will accept — it validates against the same IANA database.
   //
   // The browser's zone leads it, and says so. Hoisting it without a label
   // made it a row among several hundred identical-looking ones, so the
   // commonest answer — "wherever I am" — was the hardest one to find.
   const browserZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
   const zones = useMemo(() => {
      const supported =
         typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
      const current = settings.value?.timezone;
      return [...new Set([current, browserZone, 'UTC', ...supported].filter(Boolean))] as string[];
   }, [settings.value?.timezone, browserZone]);
   const zoneLabels = useMemo(
      () => ({ [browserZone]: t5('timezoneBrowser', { zone: browserZone }) }),
      [browserZone, t5]
   );

   const change = (patch: Partial<UserSettings>) => {
      if (!settings.value) return;
      void settings.mutate({ ...settings.value, ...patch }, () => saveUserSettings(patch));
   };

   const changeLocale = (locale: string) => {
      if (!isLocale(locale)) return;
      change({ locale });
      // The store first, or LocaleSync would see the old account value and
      // switch straight back.
      setPreferredLocale(locale);
      writeLocaleCookie(locale);
      router.refresh();
   };

   return (
      <SettingsShell title={t('title')}>
         <SettingsSection
            title={t('general')}
            description={settings.error ?? profile.error ?? undefined}
         >
            <SettingsCard>
               <SettingsRow
                  title={t('name')}
                  trailing={
                     <span className="flex items-center gap-2">
                        <SaveIndicator state={name.state} error={name.error} onRetry={name.retry} />
                        <Input
                           value={name.value ?? ''}
                           aria-label={t('name')}
                           disabled={profile.loading}
                           placeholder={t('namePlaceholder')}
                           className="h-8 w-44"
                           onChange={(event) => name.change(event.target.value)}
                           onBlur={() =>
                              (name.value ?? '').trim() === '' ? name.revert() : name.flush()
                           }
                           onKeyDown={(event) => {
                              if (event.key === 'Enter') event.currentTarget.blur();
                              if (event.key === 'Escape') name.revert();
                           }}
                        />
                     </span>
                  }
               />
               <SettingsRow
                  title={t('language')}
                  description={t('languageDescription')}
                  trailing={
                     <SelectMenu
                        options={[...LOCALES]}
                        labels={LOCALE_NAMES}
                        value={isLocale(locale) ? locale : rendered}
                        disabled={settings.loading || settings.saving}
                        onChange={changeLocale}
                     />
                  }
               />
               <SettingsRow
                  title={t('timezone')}
                  description={t('timezoneDescription')}
                  trailing={
                     <SelectMenu
                        searchable
                        aria-label={t('timezone')}
                        searchPlaceholder={t('timezoneSearch')}
                        emptyLabel={t('timezoneEmpty')}
                        options={zones}
                        labels={zoneLabels}
                        value={settings.value?.timezone ?? 'UTC'}
                        disabled={settings.loading || settings.saving}
                        onChange={(timezone) => change({ timezone })}
                     />
                  }
               />
               <SettingsRow
                  title={t5('stickyCommentBar')}
                  description={t5('stickyCommentBarDescription')}
                  trailing={
                     <Switch
                        checked={ui.stickyCommentBar}
                        onCheckedChange={ui.setStickyCommentBar}
                     />
                  }
               />
            </SettingsCard>
         </SettingsSection>

         <SettingsSection title={t5('issue')} description={t5('issueDescription')}>
            <SettingsCard>
               {CREATE_FIELDS.map((field) => (
                  <SettingsRow
                     key={field}
                     title={t5(`createField_${field}`)}
                     trailing={
                        <Switch
                           checked={ui.createFields[field]}
                           onCheckedChange={(shown) => ui.setCreateField(field, shown)}
                        />
                     }
                  />
               ))}
            </SettingsCard>
         </SettingsSection>

         <SettingsSection title={t5('chat')}>
            <SettingsCard>
               <SettingsRow
                  title={t5('floatingChat')}
                  description={t5('floatingChatDescription')}
                  trailing={
                     <Switch checked={ui.floatingChat} onCheckedChange={ui.setFloatingChat} />
                  }
               />
            </SettingsCard>
         </SettingsSection>

         <SettingsSection title={t('interface')}>
            <SettingsCard>
               <SettingsRow
                  title={t('sidebar')}
                  description={t('sidebarDescription')}
                  trailing={
                     <Button size="xs" variant="ghost" onClick={() => setCustomizeOpen(true)}>
                        {t('customize')}
                     </Button>
                  }
               />
               <SettingsRow
                  title={t('reduceMotion')}
                  description={t('reduceMotionDescription')}
                  trailing={
                     <Switch
                        checked={settings.value?.reducedMotion ?? false}
                        disabled={settings.loading || settings.saving}
                        onCheckedChange={(reducedMotion) => change({ reducedMotion })}
                     />
                  }
               />
            </SettingsCard>
         </SettingsSection>
         <CustomizeSidebarDialog open={customizeOpen} onOpenChange={setCustomizeOpen} />
      </SettingsShell>
   );
}
