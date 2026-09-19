'use client';

import { Button } from '@/components/ui/button';
import { CodeEditor } from '@/components/ui/code-editor';
import { loadPreviewEnv, savePreviewEnv, type PreviewEnvFile } from '@/lib/preview-environment';
import type { EditorView } from '@codemirror/view';
import { Loader2, LockKeyhole } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The panel's ENV tab: the variables the project's builds are given, written
 * as the `.env` file a person would have on their own machine.
 *
 * A repository says which variables it needs and never what they are, so a
 * build of it stops at "Missing required environment variable". The values
 * are written here once and kept, sealed, with the project: the next build of
 * any of its tasks has them.
 *
 * `wanted` is a variable a problem named as missing: a line for it is added if
 * there is none, and the cursor put at the end of it, ready for the value.
 */
export function PreviewEnv({
   issueRef,
   wanted,
   onRebuild,
}: {
   issueRef: string;
   /** `nonce` makes asking for the same variable twice two requests. */
   wanted: { name: string; nonce: number } | null;
   onRebuild: () => void;
}) {
   const t = useTranslations('issueDetail.environmentPreview.panel.env');
   const [file, setFile] = useState<PreviewEnvFile | null>(null);
   const [text, setText] = useState('');
   const [error, setError] = useState<string | null>(null);
   const [saving, setSaving] = useState(false);
   const [saved, setSaved] = useState(false);
   const view = useRef<EditorView | null>(null);

   useEffect(() => {
      let cancelled = false;
      setFile(null);
      setError(null);
      loadPreviewEnv(issueRef)
         .then((loaded) => {
            if (cancelled) return;
            setFile(loaded);
            setText(loaded.text);
         })
         .catch(
            (cause: unknown) =>
               !cancelled && setError(cause instanceof Error ? cause.message : t('loadFailed'))
         );
      return () => {
         cancelled = true;
      };
   }, [issueRef, t]);

   // A variable asked for: its line, made if there is none, and the cursor after the `=`.
   const handled = useRef(0);
   const editable = file?.available === true && file.project !== null;
   useEffect(() => {
      if (!wanted || !editable || handled.current === wanted.nonce) return;
      // The editor mounts a moment after the text is there to mount it with.
      const timer = window.setInterval(() => {
         const editor = view.current;
         if (!editor) return;
         window.clearInterval(timer);
         handled.current = wanted.nonce;
         const document = editor.state.doc;
         const line = new RegExp(`^(?:export\\s+)?${wanted.name}\\s*=`, 'm').exec(
            document.toString()
         );
         if (!line) {
            const gap = document.length === 0 || document.toString().endsWith('\n') ? '' : '\n';
            const insert = `${gap}${wanted.name}=`;
            editor.dispatch({
               changes: { from: document.length, insert },
               selection: { anchor: document.length + insert.length },
               scrollIntoView: true,
            });
         } else {
            editor.dispatch({
               selection: { anchor: document.lineAt(line.index).to },
               scrollIntoView: true,
            });
         }
         editor.focus();
      }, 50);
      return () => window.clearInterval(timer);
   }, [wanted, editable]);

   const save = useCallback(
      async (rebuild: boolean) => {
         setSaving(true);
         setError(null);
         try {
            const kept = await savePreviewEnv(issueRef, text);
            setFile(kept);
            setSaved(true);
            if (rebuild) onRebuild();
         } catch (cause) {
            setError(cause instanceof Error ? cause.message : t('saveFailed'));
         } finally {
            setSaving(false);
         }
      },
      [issueRef, text, onRebuild, t]
   );

   if (!file) {
      return (
         <p className="px-4 py-3 text-muted-foreground" role={error ? 'alert' : undefined}>
            {error ?? t('loading')}
         </p>
      );
   }
   if (!file.available)
      return <p className="px-4 py-3 text-muted-foreground">{t('unavailable')}</p>;
   if (!file.project) return <p className="px-4 py-3 text-muted-foreground">{t('noProject')}</p>;

   const dirty = text !== file.text;
   return (
      <div className="flex min-h-0 flex-1 flex-col" role="tabpanel" aria-label={t('label')}>
         <div className="min-h-0 flex-1">
            <CodeEditor
               value={text}
               language="bash"
               className="size-full min-h-0 rounded-none"
               readOnly={false}
               onChange={(next) => {
                  setText(next);
                  setSaved(false);
               }}
               viewRef={view}
            />
         </div>
         <div className="flex shrink-0 items-center gap-2 border-t px-3 py-1.5">
            {error || dirty || saved ? (
               <span
                  className={
                     error
                        ? 'min-w-0 flex-1 truncate text-status-danger'
                        : 'min-w-0 flex-1 truncate text-muted-foreground'
                  }
                  role={error ? 'alert' : undefined}
                  title={error ?? undefined}
               >
                  {error ?? (dirty ? t('unsaved') : t('saved'))}
               </span>
            ) : (
               <>
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-status-warning/40 bg-status-warning/10 px-2 py-0.5 text-status-warning">
                     <LockKeyhole className="size-3.5 shrink-0" aria-hidden />
                     {t('scope')}
                  </span>
                  <span className="min-w-0 flex-1" />
               </>
            )}
            {saving ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
            <Button
               size="xs"
               variant="outline"
               disabled={!dirty || saving}
               onClick={() => void save(false)}
            >
               {t('save')}
            </Button>
            <Button
               size="xs"
               disabled={saving || (!dirty && !saved)}
               onClick={() => void save(true)}
            >
               {t('saveAndRebuild')}
            </Button>
         </div>
      </div>
   );
}
