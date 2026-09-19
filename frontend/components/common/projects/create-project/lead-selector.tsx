'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
   Command,
   CommandEmpty,
   CommandGroup,
   CommandItem,
   CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { User } from '@/data/users';
import { isAgentUser } from '@/components/common/issues/actor-avatar';
import { useMembersStore } from '@/store/members-store';
import { CheckIcon, User as UserIcon } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

interface ProjectLeadSelectorProps {
   /** Undefined until the person chooses; nothing is preselected. */
   lead: User | undefined;
   onChange: (lead: User) => void;
}

export function ProjectLeadSelector({ lead, onChange }: ProjectLeadSelectorProps) {
   const id = useId();
   const [open, setOpen] = useState(false);
   const members = useMembersStore((state) => state.members);

   // People only — agents and the AI-workflow sentinel are not leads here.
   const candidates = useMemo(() => members.filter((member) => !isAgentUser(member)), [members]);

   const handleChange = (userId: string) => {
      setOpen(false);
      const next = candidates.find((user) => user.id === userId);
      if (next) onChange(next);
   };

   return (
      <Popover open={open} onOpenChange={setOpen}>
         <PopoverTrigger asChild>
            <Button
               id={id}
               className="flex items-center justify-center"
               size="xs"
               variant="secondary"
               role="combobox"
               aria-expanded={open}
            >
               {lead ? (
                  <>
                     <Avatar className="size-4">
                        <AvatarImage src={lead.avatarUrl || undefined} alt="" />
                        <AvatarFallback>{lead.name.charAt(0)}</AvatarFallback>
                     </Avatar>
                     <span>{lead.name}</span>
                  </>
               ) : (
                  <>
                     <UserIcon className="size-3.5" />
                     <span>Project lead</span>
                  </>
               )}
            </Button>
         </PopoverTrigger>
         <PopoverContent
            className="border-input w-full min-w-[var(--radix-popper-anchor-width)] p-0"
            align="start"
         >
            <Command>
               <CommandList>
                  <CommandEmpty>No user found.</CommandEmpty>
                  <CommandGroup>
                     {candidates.map((user) => (
                        <CommandItem
                           key={user.id}
                           value={user.id}
                           onSelect={() => handleChange(user.id)}
                           className="flex items-center justify-between"
                        >
                           <div className="flex items-center gap-2">
                              <Avatar className="size-5">
                                 <AvatarImage src={user.avatarUrl || undefined} alt="" />
                                 <AvatarFallback>{user.name.charAt(0)}</AvatarFallback>
                              </Avatar>
                              <span>{user.name}</span>
                           </div>
                           {lead?.id === user.id ? (
                              <CheckIcon size={16} className="ml-auto" />
                           ) : null}
                        </CommandItem>
                     ))}
                  </CommandGroup>
               </CommandList>
            </Command>
         </PopoverContent>
      </Popover>
   );
}
