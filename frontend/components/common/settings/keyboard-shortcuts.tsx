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
import { Input } from '@/components/ui/input';
import {
   FIXED_SHORTCUTS,
   SHORTCUTS,
   comboFromEvent,
   comboProblem,
   formatCombo,
   shortcutById,
   type ShortcutDefinition,
   type ShortcutGroup,
} from '@/lib/shortcuts';
import { setShortcutsSuspended } from '@/components/layout/shortcut-provider';
import { useShortcutBindings, useShortcutsStore } from '@/store/shortcuts-store';
import { SettingsCard, SettingsShell } from './shared';

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

   const fixed = useMemo(() => {
      const needle = search.trim().toLowerCase();
      if (!needle) return FIXED_SHORTCUTS;
      return FIXED_SHORTCUTS.filter(
         (entry) =>
            t(`fixedActions.${entry.labelKey}` as never)
               .toLowerCase()
               .includes(needle) || formatCombo(entry.combo).toLowerCase().includes(needle)
      );
   }, [search, t]);

   const nothingMatches = matching.length === 0 && fixed.length === 0;

   return (
      <SettingsShell compact title={t('title')} description={t('description')}>
         <div className="flex items-center gap-2">
            <Input
               value={search}
               onChange={(event) => setSearch(event.target.value)}
               aria-label={t('searchLabel')}
               placeholder={t('searchPlaceholder')}
               className="h-8 max-w-xs"
            />
            <AlertDialog>
               <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="xs" className="ml-auto">
                     {t('restoreAll')}
                  </Button>
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

         {nothingMatches ? <p className="text-muted-foreground">{t('noMatches')}</p> : null}

         <SettingsCard>
            {groups.map(({ group, title }) => {
               const rows = matching.filter((shortcut) => shortcut.group === group);
               if (rows.length === 0) return null;
               return (
                  <div key={group} className="divide-y divide-border/60">
                     <div className="bg-muted/30 px-3 py-1 text-muted-foreground uppercase tracking-[0.14em]">
                        {title}
                     </div>
                     {rows.map((shortcut) => {
                        const combo = bindings[shortcut.id];
                        const isRecording = recording === shortcut.id;
                        const overridden = combo !== defaultOf(shortcut);
                        return (
                           <div
                              key={shortcut.id}
                              className="group flex items-center gap-2 px-3 py-1 text-left"
                           >
                              <div className="min-w-0 flex-1">
                                 <div>{label(shortcut)}</div>
                                 {isRecording ? (
                                    <div className="text-muted-foreground">
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
                                 className={[
                                    'h-6 min-w-16 rounded-md border px-1.5 tabular-nums transition-colors',
                                    isRecording
                                       ? 'border-primary text-foreground'
                                       : 'bg-container hover:bg-accent',
                                 ].join(' ')}
                              >
                                 {isRecording
                                    ? t('recording')
                                    : combo
                                      ? formatCombo(combo)
                                      : shortcut.id in overrides
                                        ? t('disabled')
                                        : t('unbound')}
                              </button>
                              <button
                                 type="button"
                                 onClick={() => disable(shortcut.id)}
                                 disabled={combo === null}
                                 aria-label={t('disableAction', { action: label(shortcut) })}
                                 title={t('disableAction', { action: label(shortcut) })}
                                 className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-colors group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100 disabled:opacity-0"
                              >
                                 <X className="size-3.5" />
                              </button>
                              <button
                                 type="button"
                                 onClick={() => reset(shortcut.id)}
                                 disabled={!overridden}
                                 aria-label={t('reset', { action: label(shortcut) })}
                                 title={t('reset', { action: label(shortcut) })}
                                 className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-colors group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100 disabled:opacity-0"
                              >
                                 <RotateCcw className="size-3.5" />
                              </button>
                           </div>
                        );
                     })}
                  </div>
               );
            })}
            {fixed.length > 0 ? (
               <div className="divide-y divide-border/60">
                  <div className="bg-muted/30 px-3 py-1 text-muted-foreground uppercase tracking-[0.14em]">
                     {t('fixed')}
                  </div>
                  {fixed.map((entry) => (
                     <div key={entry.labelKey} className="flex items-center gap-2 px-3 py-1">
                        <span className="min-w-0 flex-1 truncate">
                           {t(`fixedActions.${entry.labelKey}` as never)}
                        </span>
                        <span className="inline-flex h-6 min-w-16 items-center justify-center rounded-md border px-1.5 tabular-nums text-muted-foreground">
                           {formatCombo(entry.combo)}
                        </span>
                     </div>
                  ))}
               </div>
            ) : null}
         </SettingsCard>
      </SettingsShell>
   );
}

/** The shipped combination for an action, normalised the way bindings are. */
function defaultOf(shortcut: ShortcutDefinition): string | null {
   return shortcut.defaultCombo ? shortcut.defaultCombo.toLowerCase() : null;
}
