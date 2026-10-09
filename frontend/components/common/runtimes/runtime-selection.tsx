'use client';

import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuLabel,
   DropdownMenuRadioGroup,
   DropdownMenuRadioItem,
   DropdownMenuSeparator,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
   aiRuntimeModelsFrom,
   getConversationRuntimeSelection,
   getIssueRuntimeSelection,
   getProjectRuntimeSelection,
   loadAiRuntimeCatalog,
   saveConversationRuntimeSelection,
   saveIssueRuntimeSelection,
   saveProjectRuntimeSelection,
   type AiRuntimeCatalog,
   type AiRuntimeSelection,
} from '@/lib/runtimes';
import { cn } from '@/lib/utils';
import { ChevronDown, Cpu } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

const INHERIT = 'inherit';
const NATIVE = 'berry-native';

export function RuntimeSelectionControl({
   target,
   disabled,
   className,
}: {
   target: { kind: 'issue' | 'conversation' | 'project'; id: string };
   disabled?: boolean;
   className?: string;
}) {
   const [catalog, setCatalog] = useState<AiRuntimeCatalog | null>(null);
   const [selection, setSelection] = useState<AiRuntimeSelection | null>(null);
   const [saving, setSaving] = useState(false);

   useEffect(() => {
      let cancelled = false;
      const readSelection =
         target.kind === 'issue'
            ? getIssueRuntimeSelection(target.id)
            : target.kind === 'project'
              ? getProjectRuntimeSelection(target.id)
              : getConversationRuntimeSelection(target.id);
      void Promise.all([loadAiRuntimeCatalog(), readSelection]).then(
         ([nextCatalog, nextSelection]) => {
            if (cancelled) return;
            setCatalog(nextCatalog);
            setSelection(nextSelection);
         },
         () => undefined
      );
      return () => {
         cancelled = true;
      };
   }, [target.id, target.kind]);

   const selectedRuntime = selection?.runtimeId ?? INHERIT;
   const definition = catalog?.nodes.find((runtime) => runtime.id === selection?.runtimeId);
   const connected = useMemo(
      () =>
         (catalog?.nodes ?? []).filter(
            (runtime) =>
               runtime.availability === 'available' && runtime.connection?.status === 'connected'
         ),
      [catalog]
   );
   const label =
      selectedRuntime === INHERIT
         ? (connected[0]?.name ?? 'Workspace default')
         : selectedRuntime === NATIVE
           ? (catalog?.native.name ?? 'Berry managed')
           : (definition?.name ?? selectedRuntime);

   const save = async (next: AiRuntimeSelection) => {
      setSaving(true);
      try {
         const saved =
            target.kind === 'issue'
               ? await saveIssueRuntimeSelection(target.id, next)
               : target.kind === 'project'
                 ? await saveProjectRuntimeSelection(target.id, next)
                 : await saveConversationRuntimeSelection(target.id, next);
         setSelection(saved);
      } catch (error) {
         toast.error(
            error instanceof Error ? error.message : 'The AI runtime could not be changed.'
         );
      } finally {
         setSaving(false);
      }
   };

   const chooseRuntime = (runtimeId: string) => {
      if (runtimeId === selectedRuntime) return;
      if (runtimeId === INHERIT)
         return void save({ runtimeId: null, modelId: null, agentId: null });
      if (runtimeId === NATIVE)
         return void save({ runtimeId: NATIVE, modelId: null, agentId: null });
      const runtime = connected.find((candidate) => candidate.id === runtimeId);
      if (!runtime) return;
      const first = aiRuntimeModelsFrom(runtime)[0];
      void save({
         runtimeId,
         modelId: first?.id ?? runtime.defaultModel ?? 'default',
         agentId: null,
      });
   };

   const effective = definition ?? (selectedRuntime === INHERIT ? connected[0] : undefined);
   const effectiveModels = useMemo(() => aiRuntimeModelsFrom(effective), [effective]);
   const modelValue =
      selection?.modelId ?? effective?.defaultModel ?? effectiveModels[0]?.id ?? 'default';

   return (
      <div className={cn('flex min-w-0 items-center gap-1', className)}>
         <DropdownMenu>
            <DropdownMenuTrigger asChild>
               <button
                  type="button"
                  disabled={disabled || saving || !catalog || !selection}
                  aria-label="AI runtime for this work"
                  className="inline-flex h-8 max-w-64 items-center gap-1.5 rounded-md border border-border/60 bg-container px-2.5 text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60 max-sm:size-8 max-sm:px-0 max-sm:justify-center"
               >
                  <Cpu className="size-3.5 shrink-0" aria-hidden />
                  <span className="min-w-0 truncate max-sm:sr-only">{label}</span>
                  <ChevronDown className="size-3.5 shrink-0 max-sm:hidden" aria-hidden />
               </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
               <DropdownMenuLabel>Run with</DropdownMenuLabel>
               <DropdownMenuRadioGroup value={selectedRuntime} onValueChange={chooseRuntime}>
                  <DropdownMenuRadioItem value={INHERIT}>Workspace default</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value={NATIVE}>Berry managed</DropdownMenuRadioItem>
                  {connected.map((runtime) => (
                     <DropdownMenuRadioItem key={runtime.id} value={runtime.id}>
                        {runtime.name}
                     </DropdownMenuRadioItem>
                  ))}
               </DropdownMenuRadioGroup>
               {connected.length === 0 ? (
                  <>
                     <DropdownMenuSeparator />
                     <p className="max-w-64 px-2 py-1.5 text-muted-foreground">
                        Connect a subscription in Settings → AI Runtimes to use it here.
                     </p>
                  </>
               ) : null}
               {effective && effectiveModels.length > 0 ? (
                  <>
                     <DropdownMenuSeparator />
                     <DropdownMenuLabel>Model</DropdownMenuLabel>
                     <DropdownMenuRadioGroup
                        value={modelValue}
                        onValueChange={(modelId) =>
                           void save({ runtimeId: effective.id, modelId, agentId: null })
                        }
                     >
                        {effectiveModels.map((model) => (
                           <DropdownMenuRadioItem key={model.id} value={model.id}>
                              {model.name}
                           </DropdownMenuRadioItem>
                        ))}
                     </DropdownMenuRadioGroup>
                  </>
               ) : null}
            </DropdownMenuContent>
         </DropdownMenu>

         {effective && effectiveModels.length > 0 ? (
            <DropdownMenu>
               <DropdownMenuTrigger asChild>
                  <button
                     type="button"
                     disabled={disabled || saving}
                     aria-label="Model for this work"
                     className="inline-flex h-8 max-w-40 items-center gap-1 rounded-md border border-border/60 bg-container px-2.5 text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60 max-sm:hidden"
                  >
                     <span className="min-w-0 truncate">
                        {effectiveModels.find((model) => model.id === modelValue)?.name ??
                           'Automatic'}
                     </span>
                     <ChevronDown className="size-3.5 shrink-0" aria-hidden />
                  </button>
               </DropdownMenuTrigger>
               <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Model</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                     value={modelValue}
                     onValueChange={(modelId) =>
                        void save({ runtimeId: effective.id, modelId, agentId: null })
                     }
                  >
                     {effectiveModels.map((model) => (
                        <DropdownMenuRadioItem key={model.id} value={model.id}>
                           {model.name}
                        </DropdownMenuRadioItem>
                     ))}
                  </DropdownMenuRadioGroup>
               </DropdownMenuContent>
            </DropdownMenu>
         ) : null}
      </div>
   );
}
