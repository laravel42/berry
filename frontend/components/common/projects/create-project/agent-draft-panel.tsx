'use client';

import { BerryMark } from '@/components/brand/berry-mark';
import { ChatMarkdown } from '@/components/common/chat/chat-markdown';
import { Button } from '@/components/ui/button';
import { BerryApiError } from '@/lib/api';
import {
   draftProject,
   type ProjectDraftFields,
   type ProjectDraftMessage,
   type ProjectDraftPatch,
} from '@/lib/editor-ai';
import { cn } from '@/lib/utils';
import { ArrowUp, Square, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/**
 * The assistant beside the new-project form.
 *
 * Every message is one round trip: the exchange so far and the form as it
 * stands go up, a reply and a patch come back, and the patch lands in the form
 * the person is still editing. Nothing is stored — closing the dialog ends
 * the exchange — so the panel owns its own messages rather than a store.
 */

interface PanelMessage extends ProjectDraftMessage {
   id: string;
   /** Which fields the reply set, so the person can see the form move. */
   applied?: string[];
   /** A failed turn, kept in the thread so the person knows to try again. */
   failed?: boolean;
}

const STARTERS: { label: string; prompt: string }[] = [
   {
      label: 'Outline the scope',
      prompt:
         'Outline the scope of this project as a brief: the outcome, what is in scope, and what is out of scope.',
   },
   {
      label: 'Draft a brief',
      prompt: 'Draft the project brief from what is in the form so far.',
   },
   {
      label: 'Plan the timeline',
      prompt:
         'Propose a start date and a target date for this project, and the milestones between them.',
   },
   {
      label: 'Suggest a name',
      prompt: 'Suggest a short, specific project name from the draft.',
   },
];

const FIELD_WORDS: Record<keyof ProjectDraftPatch, string> = {
   name: 'name',
   description: 'description',
   status: 'status',
   priority: 'priority',
   startDate: 'start date',
   targetDate: 'target date',
};

let nextId = 0;
const newId = () => `draft-${Date.now()}-${nextId++}`;

interface AgentDraftPanelProps {
   /** The form as it stands, read at send time. */
   draft: ProjectDraftFields;
   onPatch: (patch: ProjectDraftPatch) => void;
   /** Folds the panel away; the form keeps whatever was drafted. */
   onHide: () => void;
   /** Closes the whole dialog. */
   onClose: () => void;
   className?: string;
}

export function AgentDraftPanel({
   draft,
   onPatch,
   onHide,
   onClose,
   className,
}: AgentDraftPanelProps) {
   const [messages, setMessages] = useState<PanelMessage[]>([]);
   const [text, setText] = useState('');
   const [pending, setPending] = useState(false);
   const input = useRef<HTMLTextAreaElement>(null);
   const endRef = useRef<HTMLDivElement>(null);
   const controller = useRef<AbortController | null>(null);
   // Read at send time, not captured: the person edits the form while typing.
   const draftRef = useRef(draft);
   draftRef.current = draft;

   useEffect(() => {
      input.current?.focus();
   }, []);

   useEffect(() => {
      endRef.current?.scrollIntoView({ block: 'end' });
   }, [messages.length, pending]);

   // Grow with the message, up to the max the className allows.
   useEffect(() => {
      const element = input.current;
      if (!element) return;
      element.style.height = '0px';
      element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
   }, [text]);

   useEffect(() => () => controller.current?.abort(), []);

   const send = async (prompt: string) => {
      const body = prompt.trim();
      if (!body || pending) return;
      const mine: PanelMessage = { id: newId(), role: 'user', text: body };
      // Only what was said travels: a failed turn is shown, never resent.
      const history = messages.filter((message) => !message.failed);
      const outgoing: ProjectDraftMessage[] = [...history, mine].map(({ role, text }) => ({
         role,
         text,
      }));
      setMessages([...messages, mine]);
      setText('');
      setPending(true);
      const abort = new AbortController();
      controller.current = abort;
      try {
         const answer = await draftProject(
            { messages: outgoing, draft: draftRef.current },
            { signal: abort.signal }
         );
         const applied = (Object.keys(answer.patch) as (keyof ProjectDraftPatch)[])
            .filter((key) => answer.patch[key] !== undefined)
            .map((key) => FIELD_WORDS[key]);
         if (applied.length > 0) onPatch(answer.patch);
         setMessages((current) => [
            ...current,
            { id: newId(), role: 'assistant', text: answer.reply, applied },
         ]);
      } catch (error) {
         if (abort.signal.aborted) {
            setMessages((current) => current.filter((message) => message.id !== mine.id));
            setText(body);
            return;
         }
         const reason =
            error instanceof BerryApiError ? error.message : 'The assistant could not answer.';
         setMessages((current) => [
            ...current,
            { id: newId(), role: 'assistant', text: reason, failed: true },
         ]);
      } finally {
         if (controller.current === abort) controller.current = null;
         setPending(false);
      }
   };

   const stop = () => controller.current?.abort();
   const canSend = !pending && text.trim() !== '';

   return (
      <aside
         aria-label="Project assistant"
         className={cn(
            'flex min-h-0 w-[400px] shrink-0 flex-col border-l border-border/60',
            className
         )}
      >
         <div className="flex items-center justify-end gap-1 px-3 pt-3">
            <Button
               type="button"
               variant="secondary"
               size="xs"
               onClick={onHide}
               className="rounded-full"
            >
               <BerryMark size="sm" />
               Hide
            </Button>
            <Button
               type="button"
               variant="ghost"
               size="icon"
               className="size-8"
               aria-label="Close"
               onClick={onClose}
            >
               <X className="size-4" />
            </Button>
         </div>

         <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-4">
            {messages.length === 0 ? (
               <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
                  <BerryMark size="md" className="text-muted-foreground" />
                  <div className="flex flex-col gap-1.5">
                     <h3 className="font-medium text-foreground">Draft a new project</h3>
                     <p className="text-muted-foreground">
                        Projects define a clear outcome and completion date, and group the related
                        work. Describe what you want to build and the form fills in.
                     </p>
                  </div>
                  <div className="flex flex-wrap justify-center gap-1.5">
                     {STARTERS.map((starter) => (
                        <button
                           key={starter.label}
                           type="button"
                           onClick={() => void send(starter.prompt)}
                           className="rounded-md bg-secondary px-2.5 py-1 text-secondary-foreground transition-colors hover:bg-secondary/80"
                        >
                           {starter.label}
                        </button>
                     ))}
                  </div>
               </div>
            ) : null}

            {messages.map((message) =>
               message.role === 'user' ? (
                  <div key={message.id} className="flex justify-end">
                     <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-foreground">
                        {message.text}
                     </div>
                  </div>
               ) : (
                  <div key={message.id} className="flex flex-col gap-1.5">
                     <div className="flex items-start gap-2">
                        <BerryMark size="sm" className="mt-1 shrink-0 text-muted-foreground" />
                        {message.failed ? (
                           <p className="text-destructive">{message.text}</p>
                        ) : (
                           <ChatMarkdown body={message.text} tone="page" className="min-w-0" />
                        )}
                     </div>
                     {message.applied && message.applied.length > 0 ? (
                        <p className="pl-6 text-muted-foreground">
                           Updated {message.applied.join(', ')}
                        </p>
                     ) : null}
                  </div>
               )
            )}

            {pending ? (
               <div className="flex items-center gap-2 text-muted-foreground" aria-live="polite">
                  <BerryMark size="sm" className="animate-pulse" />
                  <span>Drafting…</span>
               </div>
            ) : null}
            <div ref={endRef} />
         </div>

         <form
            className="px-3 pb-3"
            onSubmit={(event) => {
               event.preventDefault();
               void send(text);
            }}
         >
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-background px-3 py-2 shadow-xs focus-within:border-ring">
               <textarea
                  ref={input}
                  rows={1}
                  value={text}
                  disabled={pending}
                  placeholder="Draft your project…"
                  aria-label="Message the project assistant"
                  onChange={(event) => setText(event.target.value)}
                  onKeyDown={(event) => {
                     if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        if (canSend) void send(text);
                     }
                  }}
                  className="max-h-40 min-h-6 w-full resize-none overflow-y-auto bg-transparent leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
               />
               <div className="flex items-center justify-end gap-1">
                  {pending ? (
                     <Button
                        type="button"
                        variant="secondary"
                        size="icon"
                        className="size-7 rounded-full"
                        aria-label="Stop drafting"
                        onClick={stop}
                     >
                        <Square className="size-3" />
                     </Button>
                  ) : (
                     <Button
                        type="submit"
                        size="icon"
                        className="size-7 rounded-full"
                        aria-label="Send"
                        disabled={!canSend}
                     >
                        <ArrowUp className="size-3.5" />
                     </Button>
                  )}
               </div>
            </div>
         </form>
      </aside>
   );
}
