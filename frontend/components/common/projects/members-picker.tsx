'use client';

import { ActorAvatar, isAgentUser } from '@/components/common/issues/actor-avatar';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { User } from '@/data/users';
import { Users } from 'lucide-react';
import type { ReactElement } from 'react';

/**
 * Who may sit on a project: people only. Agents are not offered, matching
 * the lead picker.
 */
export function memberCandidates(members: readonly User[]): User[] {
   return members.filter((member) => !isAgentUser(member));
}

interface MembersPickerProps {
   /** People already chosen for the project. */
   value: readonly User[];
   /** The people on offer, usually `memberCandidates(members)`. */
   candidates: readonly User[];
   onChange: (members: User[]) => void;
   /** The trigger, usually a `PickerChipButton`. */
   children: ReactElement;
}

/** Choose zero or more project members. The menu stays open while toggling. */
export function MembersPicker({ value, candidates, onChange, children }: MembersPickerProps) {
   const selected = new Set(value.map((member) => member.id));

   const toggle = (id: string) => {
      if (selected.has(id)) {
         onChange(value.filter((member) => member.id !== id));
         return;
      }
      const next = candidates.find((member) => member.id === id);
      if (next) onChange([...value, next]);
   };

   return (
      <Popover>
         <PopoverTrigger asChild>{children}</PopoverTrigger>
         <PopoverContent align="start" className="w-64 p-1">
            {candidates.length === 0 ? (
               <p className="px-2 py-1.5 text-muted-foreground">No people to add.</p>
            ) : (
               <ul role="listbox" aria-label="Members" aria-multiselectable="true">
                  {candidates.map((member) => {
                     const on = selected.has(member.id);
                     return (
                        <li key={member.id} role="option" aria-selected={on}>
                           <label className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent">
                              <Checkbox
                                 checked={on}
                                 onCheckedChange={() => toggle(member.id)}
                                 aria-label={member.name}
                              />
                              <ActorAvatar user={member} size="sm" className="size-4 shrink-0" />
                              <span className="min-w-0 flex-1 truncate">{member.name}</span>
                           </label>
                        </li>
                     );
                  })}
               </ul>
            )}
         </PopoverContent>
      </Popover>
   );
}

/** Chip label for the create-project members control. */
export function MembersChipContent({ members }: { members: readonly User[] }) {
   if (members.length === 0) {
      return (
         <>
            <Users className="size-3.5" />
            <span>Members</span>
         </>
      );
   }
   const only = members.length === 1 ? members[0] : undefined;
   if (only) {
      return (
         <>
            <ActorAvatar user={only} size="sm" className="size-4" />
            <span>{only.name}</span>
         </>
      );
   }
   return (
      <>
         <Users className="size-3.5" />
         <span>{members.length} members</span>
      </>
   );
}
