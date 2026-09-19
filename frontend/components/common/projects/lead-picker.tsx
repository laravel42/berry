'use client';

import { ActorAvatar, isAgentUser } from '@/components/common/issues/actor-avatar';
import { OptionPicker } from '@/components/common/pickers/option-picker';
import { statusUserColors, type User } from '@/data/users';
import { cn } from '@/lib/utils';
import type { ComponentProps, ReactElement } from 'react';

/**
 * Who may lead a project: people only. Agents and the AI-workflow sentinel
 * (both `role: 'Application'`) are not offered. With no roster loaded yet the
 * current lead is the only candidate, so the menu is never empty for a person.
 */
export function leadCandidates(members: readonly User[], lead: User | undefined): User[] {
   const roster = members.length > 0 ? members : lead ? [lead] : [];
   return roster.filter((member) => !isAgentUser(member));
}

interface LeadPickerProps {
   /** Undefined until someone is chosen; the trigger shows the empty state. */
   lead: User | undefined;
   /** The people on offer, usually `leadCandidates(members, lead)`. */
   candidates: readonly User[];
   onChange: (lead: User) => void;
   /** The trigger: `LeadAvatarButton`, `PickerChipButton`, or a row button. */
   children: ReactElement;
}

/** Choose a project's lead. Each person is drawn through `ActorAvatar`. */
export function LeadPicker({ lead, candidates, onChange, children }: LeadPickerProps) {
   const choose = (id: string) => {
      const next = candidates.find((member) => member.id === id);
      if (next) onChange(next);
   };

   return (
      <OptionPicker
         options={candidates.map((member) => ({
            value: member.id,
            label: member.name,
            icon: <ActorAvatar user={member} size="sm" />,
         }))}
         value={lead?.id}
         onValueChange={choose}
         emptyLabel="No user found."
         menuWidth="menu"
      >
         {children}
      </OptionPicker>
   );
}

interface LeadAvatarButtonProps extends Omit<ComponentProps<'button'>, 'children'> {
   lead: User;
   /**
    * `md` (default): a 28px target with a presence dot, for property panels.
    * `sm`: a 16px avatar with no dot, for a board card.
    */
   size?: 'md' | 'sm';
}

/** The lead's avatar as a picker trigger. Labelled "Lead: {name}" for assistive tech. */
export function LeadAvatarButton({
   lead,
   size = 'md',
   className,
   ...props
}: LeadAvatarButtonProps) {
   const compact = size === 'sm';
   return (
      <button
         type="button"
         className={cn(
            'relative flex shrink-0 items-center justify-center overflow-visible rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
            compact ? 'size-4' : 'size-7',
            className
         )}
         aria-label={`Lead: ${lead.name}`}
         {...props}
      >
         <ActorAvatar
            user={lead}
            size={compact ? 'sm' : 'md'}
            className={compact ? 'size-4' : undefined}
         />
         {compact ? null : (
            <span
               className="border-background absolute -end-0.5 -bottom-0.5 size-2.5 rounded-full border-2"
               style={{ backgroundColor: statusUserColors[lead.status] }}
            >
               <span className="sr-only">{lead.status}</span>
            </span>
         )}
      </button>
   );
}
