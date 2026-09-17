import type { User } from '@/data/users';
import { useMembersStore } from '@/store/members-store';

/**
 * Who leads a project, on the wire.
 *
 * Two shapes because the two answers are not alike: a person has an id, and the
 * AI workflow is not a row anywhere. `null` from the server means nobody has
 * decided — true of every project created before the lead was stored at all.
 *
 * Read loosely on purpose: `type` is a plain string here rather than a literal
 * union, so a value this build does not know degrades to the fallback instead of
 * failing the whole project's parse and dropping it out of the list.
 */
export interface ApiProjectLead {
   type: string;
   id?: string | null;
}

/**
 * The lead that means Berry runs this project rather than a person.
 *
 * Shaped as a `User` so every list, avatar and filter can hold it without a
 * second branch, but it is not a workspace member: the id is a Berry-reserved
 * name, and `isAiWorkflow` is what tells the two apart. Picking it is what turns
 * creating a project into planning one.
 */
export const AI_WORKFLOW_LEAD: User = {
   id: 'berry:ai-workflow',
   name: 'AI workflow',
   avatarUrl: '',
   email: '',
   status: 'online',
   role: 'Application',
   joinedDate: '',
   teamIds: [],
   timezone: 'UTC',
};

export function isAiWorkflow(lead: User | undefined | null): boolean {
   return lead?.id === AI_WORKFLOW_LEAD.id;
}

/** The chosen lead as the API takes it. */
export function leadToApi(lead: User): ApiProjectLead {
   return isAiWorkflow(lead) ? { type: 'aiWorkflow' } : { type: 'user', id: lead.id };
}

/**
 * The stored lead as a `User` the UI can render.
 *
 * `viewer` is the last resort, not the answer: it stands in only for a project
 * that recorded no lead, which is what every project created before the columns
 * existed looks like. Filling that gap with whoever is looking is exactly the
 * bug this API field fixes, so it must not be reached for a project that does
 * carry a lead — a person Berry cannot name is shown as an unnamed member with
 * their real id, not as you.
 */
export function leadFromApi(lead: ApiProjectLead | null | undefined, viewer: User): User {
   if (!lead) return viewer;
   if (lead.type === 'aiWorkflow') return AI_WORKFLOW_LEAD;
   if (lead.type === 'user' && lead.id) {
      return useMembersStore.getState().getMemberById(lead.id) ?? unknownMember(lead.id);
   }
   return viewer;
}

/** A lead the roster has not loaded (or no longer holds), named by its id. */
function unknownMember(id: string): User {
   return {
      id,
      name: 'Unknown member',
      avatarUrl: '',
      email: '',
      status: 'offline',
      role: 'Member',
      joinedDate: '',
      teamIds: [],
      timezone: 'UTC',
   };
}
