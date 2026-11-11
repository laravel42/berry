'use client';

import { SparkIcon } from '@/components/ui/spark-icon';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { type LoopSeed } from '@/components/common/autopilots/autopilot-dialog';
import NewLoopEditor from '@/components/common/loops/new-loop-editor';
import { TemplateCard } from '@/components/common/loops/template-card';
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

   const chooseTemplate = (template: LoopTemplate) => {
      setSeed(fromTemplate(template, projectId));
      setSource('template');
      setNotes(
         template.requires.length > 0
            ? [t('requires', { list: template.requires.join(' · ') })]
            : []
      );
   };

   if (seed) {
      return (
         <MainLayout>
            <NewLoopEditor
               seed={seed}
               sourceNote={
                  source === 'model'
                     ? t('fromModel')
                     : source === 'rules'
                       ? t('fromRules')
                       : source === 'template'
                         ? t('fromTemplate')
                         : t('fromScratch')
               }
               notes={notes}
               onBack={back}
            />
         </MainLayout>
      );
   }

   const examples = [t('example1'), t('example2'), t('example3')];

   return (
      <MainLayout header={header}>
         <div className="h-full min-h-0 overflow-y-auto">
            <div
               className="px-5 pt-14 pb-10"
               style={{
                  backgroundImage:
                     'radial-gradient(60% 120% at 50% 0%, color-mix(in oklab, var(--primary) 14%, transparent), transparent 70%)',
               }}
            >
               <div className="mx-auto flex w-full max-w-3xl flex-col items-center">
                  <span className="mb-4 flex size-11 items-center justify-center rounded-2xl bg-card text-primary shadow-[0_0_0_1px_color-mix(in_oklab,var(--primary)_40%,transparent),0_10px_30px_-14px_var(--primary)]">
                     <SparkIcon className="size-5" />
                  </span>
                  <h2 data-heading="display" className="text-center text-balance">
                     {t('heading')}
                  </h2>
                  <p className="mt-2 max-w-xl text-center text-pretty text-muted-foreground">
                     {t('subheading')}
                  </p>

                  <div className="mt-8 w-full rounded-xl border bg-card shadow-sm transition-shadow focus-within:shadow-md focus-within:ring-[3px] focus-within:ring-ring/40">
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
                        className="w-full resize-none bg-transparent px-4 pt-4 text-foreground placeholder:text-placeholder focus:outline-none [-webkit-text-fill-color:var(--foreground)]"
                     />
                     <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2.5">
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
                              <SparkIcon className="size-4" />
                              {drafting ? t('drafting') : t('draft')}
                           </Button>
                        </div>
                     </div>
                  </div>
                  <p className="sr-only" role="status" aria-live="polite">
                     {drafting ? t('drafting') : ''}
                  </p>
                  {error ? (
                     <p className="mt-3 self-start text-destructive" role="alert">
                        {error}
                     </p>
                  ) : null}

                  <div
                     className="mt-4 flex flex-wrap justify-center gap-2"
                     aria-label={t('examples')}
                  >
                     {examples.map((example) => (
                        <button
                           key={example}
                           type="button"
                           onClick={() => {
                              setPrompt(example);
                              composer.current?.focus();
                           }}
                           className="rounded-full border border-border/70 bg-card/70 px-3 py-1 text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                        >
                           {example}
                        </button>
                     ))}
                  </div>
               </div>
            </div>

            {templates.length > 0 ? (
               <div className="mx-auto w-full max-w-5xl px-5 pb-12">
                  <h3 data-heading="label" className="mb-3 text-subtle-foreground">
                     {t('templates')}
                  </h3>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                     {templates.map((template) => (
                        <TemplateCard
                           key={template.key}
                           template={template}
                           onChoose={chooseTemplate}
                        />
                     ))}
                  </div>
               </div>
            ) : null}
         </div>
      </MainLayout>
   );
}
