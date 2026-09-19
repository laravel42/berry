'use client';

import type { User } from '@/data/users';
import { resolveProjectLead } from '@/lib/project-lead';
import { useMembersStore } from '@/store/members-store';
import { useSessionStore } from '@/store/session-store';

/** Live lead for a card or picker: roster first, then the signed-in account. */
export function useResolvedProjectLead(lead: User): User {
   const members = useMembersStore((state) => state.members);
   const viewer = useSessionStore((state) => state.user);
   return resolveProjectLead(lead, members, viewer);
}
