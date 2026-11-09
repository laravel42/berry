'use client';

import { ArrowLeft, Sparkles } from 'lucide-react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import AutopilotDialog, { type LoopSeed } from '@/components/common/autopilots/autopilot-dialog';
import { FALLBACK_TEMPLATE_ICON, TEMPLATE_ICON } from '@/components/common/autopilots/autopilots';
import { SettingsTile } from '@/components/common/settings/shared';
import MainLayout from '@/components/layout/main-layout';
import { PageTitleBar } from '@/components/layout/headers/page-title-bar';
import { Button } from '@/components/ui/button';
import {
   describeAutopilotFailure,
   draftLoop,
   listLoopTemplates,
   type LoopDraftSuggestion,
   type LoopTemplate,
} from '@/lib/autopilots';
import { WORKSPACE_SLUG } from '@/lib/config';
import { useSessionStore } from '@/store/session-store';

function fromTemplate(template: LoopTemplate, projectId: string | null): LoopSeed {
   return {
      name: template.name,
      description: template.description,
      instructions: template.instructions,
      trigger: template.trigger,
      assigneeId: template.suggestedAgent?.id ?? null,
      accessMode: template.accessMode,
      allowAgentEvents: template.allowAgentEvents,
      templateKey: template.key,
      projectId,
   };
}

function fromDraft(draft: LoopDraftSuggestion, projectId: string | null): LoopSeed {
   return {
      name: draft.name,
      instructions: draft.instructions,
      trigger: draft.trigger,
      assigneeId: draft.suggestedAgent?.id ?? null,
      accessMode: draft.accessMode,
      allowAgentEvents: draft.allowAgentEvents,
      projectId,
   };
}

/**
 * New loop: say what to automate, or pick a template, then review.
 *
 * The sentence is read on the server — by the workspace's model when one is
 * connected, by plain rules otherwise — into a draft for the same form the
 * Loop is edited with. Nothing is created until the person presses Create,
 * and a draft is always Recommend: turning on Act is their decision.
 */
export default function NewLoop() {
   const t = useTranslations('loops.create');
   const router = useRouter();
   const searchParams = useSearchParams();
   const params = useParams<{ orgId?: string }>();
   const orgId = params?.orgId || WORKSPACE_SLUG;
   const workspaceId = useSessionStore((state) => state.workspace?.id ?? '');
   const projectId = searchParams?.get('project') ?? null;
   const templateKey = searchParams?.get('template') ?? null;

   const [prompt, setPrompt] = useState('');
   const [templates, setTemplates] = useState<LoopTemplate[]>([]);
   const [seed, setSeed] = useState<LoopSeed | null>(null);
   const [notes, setNotes] = useState<string[]>([]);
   const [source, setSource] = useState<'model' | 'rules' | 'template' | 'scratch' | null>(null);
   const [drafting, setDrafting] = useState(false);
   const [error, setError] = useState<string | null>(null);
   const composer = useRef<HTMLTextAreaElement>(null);
   const abort = useRef<AbortController | null>(null);

   useEffect(() => {
      if (!workspaceId) return;
      let cancelled = false;
      void listLoopTemplates(workspaceId).then(
         (found) => {
            if (cancelled) return;
            setTemplates(found);
            const chosen = templateKey
               ? found.find((template) => template.key === templateKey)
               : undefined;
            if (chosen) {
               setSeed(fromTemplate(chosen, projectId));
               setSource('template');
               setNotes(
                  chosen.requires.length > 0
                     ? [t('requires', { list: chosen.requires.join(' · ') })]
                     : []
               );
            }
         },
         () => undefined
      );
      return () => {
         cancelled = true;
      };
   }, [workspaceId, templateKey, projectId, t]);

   useEffect(() => {
      if (!seed) composer.current?.focus();
      return () => abort.current?.abort();
   }, [seed]);

   const draft = async () => {
      const text = prompt.trim();
      if (text.length < 3 || drafting || !workspaceId) return;
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setDrafting(true);
      setError(null);
      try {
         const suggestion = await draftLoop(workspaceId, text, controller.signal);
         setSeed(fromDraft(suggestion, projectId));
         setNotes(suggestion.notes);
         setSource(suggestion.source);
      } catch (failure) {
         if (!controller.signal.aborted) setError(describeAutopilotFailure(failure));
      } finally {
         setDrafting(false);
      }
   };

   const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
         event.preventDefault();
         void draft();
      }
   };

   const back = () => {
      setSeed(null);
      setNotes([]);
      setSource(null);
      if (templateKey)
         router.replace(
            `/${orgId}/loops/new${projectId ? `?project=${encodeURIComponent(projectId)}` : ''}`
         );
   };

   const header = <PageTitleBar title={t('title')} />;

   if (seed) {
      return (
         <MainLayout header={header}>
            <div className="mx-auto w-full max-w-2xl px-5 py-6">
               <Button type="button" variant="ghost" size="xs" className="mb-3" onClick={back}>
                  <ArrowLeft className="size-3.5" aria-hidden />
                  {t('back')}
               </Button>
               <h2 data-heading="h1" className="mb-1">
                  {t('reviewTitle')}
               </h2>
               <p className="mb-4 text-muted-foreground">
                  {source === 'model'
                     ? t('fromModel')
                     : source === 'rules'
                       ? t('fromRules')
                       : source === 'template'
                         ? t('fromTemplate')
                         : t('fromScratch')}
               </p>
               {notes.length > 0 ? (
                  <ul
                     className="mb-5 grid gap-1 rounded-md border border-status-warning/40 bg-status-warning/5 px-3 py-2"
                     aria-label={t('notes')}
                  >
                     {notes.map((note) => (
                        <li key={note}>{note}</li>
                     ))}
                  </ul>
               ) : null}
               <AutopilotDialog
                  open
                  presentation="inline"
                  seed={seed}
                  onOpenChange={(open) => {
                     if (!open) back();
                  }}
               />
            </div>
         </MainLayout>
      );
   }

   return (
      <MainLayout header={header}>
         <div className="mx-auto flex w-full max-w-3xl flex-col px-5 py-10">
            <h2 data-heading="display" className="mb-4 text-center">
               {t('heading')}
            </h2>
            <div className="rounded-[10px] border bg-background focus-within:ring-2 focus-within:ring-ring/50">
               <label htmlFor="loop-composer" className="sr-only">
                  {t('heading')}
               </label>
               <textarea
                  id="loop-composer"
                  ref={composer}
                  rows={4}
                  maxLength={4000}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={t('placeholder')}
                  className="w-full resize-none bg-transparent px-4 pt-3 text-foreground placeholder:text-placeholder focus:outline-none [-webkit-text-fill-color:var(--foreground)]"
               />
               <div className="flex items-center justify-between gap-2 px-3 pb-3">
                  <span className="text-subtle-foreground">{t('composerHint')}</span>
                  <div className="flex items-center gap-2">
                     <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                           setSeed({
                              name: '',
                              instructions: prompt.trim(),
                              trigger: null,
                              projectId,
                           });
                           setSource('scratch');
                        }}
                     >
                        {t('scratch')}
                     </Button>
                     <Button
                        type="button"
                        onClick={() => void draft()}
                        disabled={prompt.trim().length < 3 || drafting}
                     >
                        <Sparkles className="size-4" aria-hidden />
                        {drafting ? t('drafting') : t('draft')}
                     </Button>
                  </div>
               </div>
            </div>
            <p className="sr-only" role="status" aria-live="polite">
               {drafting ? t('drafting') : ''}
            </p>
            {error ? (
               <p className="mt-3 text-destructive" role="alert">
                  {error}
               </p>
            ) : null}

            <h3 data-heading="label" className="mb-3 mt-10 text-subtle-foreground">
               {t('templates')}
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
               {templates.map((template) => {
                  const Icon = TEMPLATE_ICON[template.category] ?? FALLBACK_TEMPLATE_ICON;
                  return (
                     <button
                        key={template.key}
                        type="button"
                        onClick={() => {
                           setSeed(fromTemplate(template, projectId));
                           setSource('template');
                           setNotes(
                              template.requires.length > 0
                                 ? [t('requires', { list: template.requires.join(' · ') })]
                                 : []
                           );
                        }}
                        className="flex min-w-0 items-start gap-3 rounded-[10px] bg-settings-group p-4 text-left transition-colors hover:bg-settings-row-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]"
                     >
                        <SettingsTile size="lg">
                           <Icon className="size-[55%]" aria-hidden />
                        </SettingsTile>
                        <span className="grid min-w-0 gap-1">
                           <span className="truncate font-medium">{template.name}</span>
                           <span className="line-clamp-2 text-muted-foreground">
                              {template.description}
                           </span>
                           <span className="truncate text-subtle-foreground">
                              {template.trigger.description}
                              {template.suggestedAgent ? ` · ${template.suggestedAgent.name}` : ''}
                           </span>
                        </span>
                     </button>
                  );
               })}
            </div>
         </div>
      </MainLayout>
   );
}
