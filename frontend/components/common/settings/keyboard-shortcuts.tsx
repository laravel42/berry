'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { RotateCcw, X } from 'lucide-react';

import {
   AlertDialog,
   AlertDialogAction,
   AlertDialogCancel,
   AlertDialogContent,
   AlertDialogDescription,
   AlertDialogFooter,
   AlertDialogHeader,
   AlertDialogTitle,
   AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
   SHORTCUTS,
   comboFromEvent,
   comboProblem,
   formatCombo,
   formatComboKeys,
   shortcutById,
   type ShortcutDefinition,
   type ShortcutGroup,
} from '@/lib/shortcuts';
import { setShortcutsSuspended } from '@/components/layout/shortcut-provider';
import { useShortcutBindings, useShortcutsStore } from '@/store/shortcuts-store';
import { cn } from '@/lib/utils';
import {
   KeyCap,
   SettingsCard,
   SettingsEmpty,
   SettingsIconButton,
   SettingsSearch,
   SettingsSection,
   SettingsShell,
} from './shared';

/**
 * Settings › keyboard shortcuts.
 *
 * Recording a shortcut is the whole of this page, and the awkward part of it
 * is that while someone is choosing keys, those keys must not *be* shortcuts.
 * So the recorder listens in the capture phase and stops the event there: the
 * global listener never sees it, and pressing C to bind C does not also open
 * the create-task modal.
 *
 * A combination is refused for one of three reasons, and the row says which:
 * the browser has it, typing needs it, or something else here is already using
 * it — in which case the thing using it is named, because "already in use" is
 * not an answer anyone can act on.
 */
export function KeyboardShortcuts() {
   const t = useTranslations('navigation.shortcuts');
   const bindings = useShortcutBindings();
   // The person's own edits, so a row they switched off reads "Off" rather
   // than "Not set" — an action that never had a key and one somebody turned
   // off look the same otherwise.
   const overrides = useShortcutsStore((state) => state.overrides);
   const setBinding = useShortcutsStore((state) => state.setBinding);
   const disable = useShortcutsStore((state) => state.disable);
   const reset = useShortcutsStore((state) => state.reset);
   const resetAll = useShortcutsStore((state) => state.resetAll);

   const [search, setSearch] = useState('');
   const [recording, setRecording] = useState<string | null>(null);
   const [problem, setProblem] = useState<string | null>(null);

   const label = (shortcut: ShortcutDefinition) => t(`actions.${shortcut.labelKey}` as never);

   // While recording, the global listener must not act on what is pressed.
   useEffect(() => {
      setShortcutsSuspended(recording !== null);
      return () => setShortcutsSuspended(false);
   }, [recording]);

   useEffect(() => {
      if (!recording) return;
      const onKeyDown = (event: KeyboardEvent) => {
         if (event.isComposing || event.repeat) return;
         // Capture phase plus stopPropagation: nothing downstream, including
         // the app's own shortcut listener, sees these keystrokes.
         event.preventDefault();
         event.stopPropagation();

         if (event.key === 'Escape') {
            setRecording(null);
            setProblem(null);
            return;
         }
         if (event.key === 'Backspace') {
            disable(recording);
            setRecording(null);
            setProblem(null);
            return;
         }

         const combo = comboFromEvent(event);
         if (!combo) return;

         const found = comboProblem(combo, recording, bindings);
         if (found) {
            setProblem(
               found.kind === 'reserved'
                  ? t('problemReserved')
                  : found.kind === 'typing'
                    ? t('problemTyping')
                    : found.kind === 'fixed'
                      ? t('problemFixed', { action: t(`fixedActions.${found.labelKey}` as never) })
                      : t('problemConflict', {
                           action: (() => {
                              const other = shortcutById(found.shortcutId);
                              return other
                                 ? t(`actions.${other.labelKey}` as never)
                                 : found.shortcutId;
                           })(),
                        })
            );
            return;
         }

         setBinding(recording, combo);
         setRecording(null);
         setProblem(null);
      };
      window.addEventListener('keydown', onKeyDown, true);
      return () => window.removeEventListener('keydown', onKeyDown, true);
   }, [recording, bindings, disable, setBinding, t]);

   const groups: { group: ShortcutGroup; title: string }[] = [
      { group: 'general', title: t('general') },
      { group: 'navigation', title: t('navigation') },
   ];

   const matching = useMemo(() => {
      const needle = search.trim().toLowerCase();
      if (!needle) return SHORTCUTS;
      return SHORTCUTS.filter((shortcut) => {
         const combo = bindings[shortcut.id];
         return (
            t(`actions.${shortcut.labelKey}` as never)
               .toLowerCase()
               .includes(needle) ||
            (combo ? formatCombo(combo).toLowerCase().includes(needle) : false)
         );
      });
   }, [search, bindings, t]);

   const nothingMatches = matching.length === 0;

   return (
      <SettingsShell compact title={t('title')} description={t('description')}>
         <div className="flex items-center gap-2.5">
            <SettingsSearch
               value={search}
               onChange={setSearch}
               aria-label={t('searchLabel')}
               placeholder={t('searchPlaceholder')}
            />
            <AlertDialog>
               <AlertDialogTrigger asChild>
                  <Button variant="soft">{t('restoreAll')}</Button>
               </AlertDialogTrigger>
               <AlertDialogContent>
                  <AlertDialogHeader>
                     <AlertDialogTitle>{t('restoreTitle')}</AlertDialogTitle>
                     <AlertDialogDescription>{t('restoreBody')}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                     <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                     <AlertDialogAction onClick={() => resetAll()}>
                        {t('restoreConfirm')}
                     </AlertDialogAction>
                  </AlertDialogFooter>
               </AlertDialogContent>
            </AlertDialog>
         </div>

         {nothingMatches ? (
            <SettingsCard>
               <SettingsEmpty title={t('noMatches')} />
            </SettingsCard>
         ) : null}

         {groups.map(({ group, title }) => {
            const rows = matching.filter((shortcut) => shortcut.group === group);
            if (rows.length === 0) return null;
            return (
               <SettingsSection key={group} title={title}>
                  <SettingsCard>
                     {rows.map((shortcut) => {
                        const combo = bindings[shortcut.id];
                        const isRecording = recording === shortcut.id;
                        const overridden = combo !== defaultOf(shortcut);
                        return (
                           <div
                              key={shortcut.id}
                              className="group flex min-h-[42px] items-center gap-2 py-1.5 pr-3 pl-4 transition-colors hover:bg-settings-row-hover"
                           >
                              <div className="min-w-0 flex-1">
                                 <div className="text-[var(--brand-body)]">{label(shortcut)}</div>
                                 {isRecording ? (
                                    <div
                                       data-settings-type="caption"
                                       className="text-subtle-foreground"
                                    >
                                       {problem ?? t('recordHint')}
                                    </div>
                                 ) : null}
                              </div>
                              <button
                                 type="button"
                                 onClick={() => {
                                    setProblem(null);
                                    setRecording(isRecording ? null : shortcut.id);
                                 }}
                                 aria-label={t('record', { action: label(shortcut) })}
                                 className={cn(
                                    'flex min-h-[26px] cursor-pointer items-center gap-1 rounded-[7px] px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                    isRecording && 'ring-1 ring-settings-field-focus'
                                 )}
                              >
                                 {isRecording ? (
                                    <span
                                       data-settings-type="caption"
                                       className="px-1 text-foreground"
                                    >
                                       {t('recording')}
                                    </span>
                                 ) : combo ? (
                                    formatComboKeys(combo).map((chord, chordIndex) =>
                                       chord.map((key, keyIndex) => (
                                          <KeyCap key={`${chordIndex}-${keyIndex}`}>{key}</KeyCap>
                                       ))
                                    )
                                 ) : (
                                    <span
                                       data-settings-type="caption"
                                       className="px-1 text-subtle-foreground"
                                    >
                                       {shortcut.id in overrides ? t('disabled') : t('unbound')}
                                    </span>
                                 )}
                              </button>
                              <span className="hidden group-focus-within:flex group-hover:flex">
                                 <SettingsIconButton
                                    label={t('disableAction', { action: label(shortcut) })}
                                    disabled={combo === null}
                                    destructive
                                    onClick={() => disable(shortcut.id)}
                                 >
                                    <X />
                                 </SettingsIconButton>
                                 <SettingsIconButton
                                    label={t('reset', { action: label(shortcut) })}
                                    disabled={!overridden}
                                    onClick={() => reset(shortcut.id)}
                                 >
                                    <RotateCcw />
                                 </SettingsIconButton>
                              </span>
                           </div>
                        );
                     })}
                  </SettingsCard>
               </SettingsSection>
            );
         })}
      </SettingsShell>
   );
}

/** The shipped combination for an action, normalised the way bindings are. */
function defaultOf(shortcut: ShortcutDefinition): string | null {
   return shortcut.defaultCombo ? shortcut.defaultCombo.toLowerCase() : null;
}
