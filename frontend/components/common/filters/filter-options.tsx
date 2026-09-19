'use client';

import { BerryMark } from '@/components/brand/berry-mark';
import type { ColumnOption } from '@/components/data-table-filter/core/types';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { priorities } from '@/data/priorities';
import { status } from '@/data/status';
import type { User } from '@/data/users';
import { colorForAgent } from '@/lib/agent-color';

/**
 * Option builders shared by list filters, so a person, an agent, a priority
 * or a task status reads the same in every "Filter" menu.
 */

/** An agent, drawn as the Berry mark in its colour. */
export function agentFilterOption(agent: { id: string; name: string }): ColumnOption {
   return {
      value: agent.id,
      label: agent.name,
      icon: (
         <BerryMark
            size="sm"
            tone="working"
            dotColor={colorForAgent(agent.id)}
            label={`${agent.name}, agent`}
         />
      ),
   };
}

/** A member, drawn as their avatar. */
export function memberFilterOption(member: {
   id: string;
   name: string;
   avatarUrl?: string;
}): ColumnOption {
   return {
      value: member.id,
      label: member.name,
      icon: (
         <Avatar className="size-4">
            <AvatarImage src={member.avatarUrl} alt={member.name} />
            <AvatarFallback>{member.name[0]}</AvatarFallback>
         </Avatar>
      ),
   };
}

/** A user record that may stand for either a member or an agent. */
export function personFilterOption(person: User): ColumnOption {
   return person.role === 'Application' ? agentFilterOption(person) : memberFilterOption(person);
}

export const priorityFilterOptions: ColumnOption[] = priorities.map((priority) => ({
   value: priority.id,
   label: priority.name,
   icon: <priority.icon className="size-4 text-muted-foreground" />,
}));

export const taskStatusFilterOptions: ColumnOption[] = status.map((item) => ({
   value: item.id,
   label: item.name,
   icon: <item.icon />,
}));

/** Name order, the way every picker in the app lists people. */
export const byLabel = (left: ColumnOption, right: ColumnOption) =>
   left.label.localeCompare(right.label);
