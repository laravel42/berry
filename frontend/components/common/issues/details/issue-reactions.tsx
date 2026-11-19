'use client';

import { EmojiPickerPopover } from '@/components/common/emoji-picker';
import { Button } from '@/components/ui/button';
import { loadReactions, QUICK_EMOJI, toggleReaction, type ReactionGroup } from '@/lib/reactions';
import { cn } from '@/lib/utils';
import { SmilePlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

/**
 * Reaction chips for a task or a comment, and the button that adds one: the
 * usual few in one tap, the whole emoji catalogue behind More.
 */
export function ReactionBar({ target, id }: { target: 'issue' | 'comment'; id: string }) {
   const t = useTranslations('common.reactions');
   const [groups, setGroups] = useState<ReactionGroup[]>([]);

   useEffect(() => {
      if (!id) return;
      let cancelled = false;
      void loadReactions(target, id)
         .then((loaded) => !cancelled && setGroups(loaded))
         .catch(() => undefined);
      return () => {
         cancelled = true;
      };
   }, [target, id]);

   const reacted = (emoji: string) =>
      groups.find((group) => group.emoji === emoji)?.reactedByMe ?? false;

   const toggle = (emoji: string) => {
      void toggleReaction(target, id, emoji, reacted(emoji))
         .then(setGroups)
         .catch(() => toast.error(t('failed')));
   };

   return (
      <div className="flex flex-wrap items-center gap-1.5">
         {groups.map((group) => (
            <Button
               key={group.emoji}
               variant="outline"
               size="sm"
               onClick={() => toggle(group.emoji)}
               aria-pressed={group.reactedByMe}
               className={cn(
                  'gap-1 px-2.5 font-normal shadow-none',
                  group.reactedByMe ? 'bg-accent' : 'bg-transparent'
               )}
            >
               {group.emoji} {group.count}
            </Button>
         ))}
         <EmojiPickerPopover
            quick={QUICK_EMOJI}
            isActive={reacted}
            // The quick row toggles, as the chips do. From the catalogue a
            // reaction already given stays given rather than being taken back.
            onSelect={(emoji, from) => {
               if (from === 'quick' || !reacted(emoji)) toggle(emoji);
            }}
         >
            <Button variant="ghost" size="icon-sm" aria-label={t('add')} title={t('add')}>
               <SmilePlus className="size-4" />
            </Button>
         </EmojiPickerPopover>
      </div>
   );
}

export function IssueReactions({ issueRef }: { issueRef: string }) {
   return <ReactionBar target="issue" id={issueRef} />;
}
