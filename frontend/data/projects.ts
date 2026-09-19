import { Status } from './status';
import { RemixiconComponentType } from '@remixicon/react';
import type { LucideIcon } from 'lucide-react';
import { User } from './users';
import { LabelInterface } from './labels';
import { Priority } from './priorities';

export interface Project {
   id: string;
   name: string;
   status: Status;
   icon: LucideIcon | RemixiconComponentType;
   percentComplete: number;
   startDate: string;
   /** Planned completion date (Linear "Target date"). */
   targetDate?: string;
   lead: User;
   priority: Priority;
   health: Health;
   /** Owning team (see data/teams.ts). */
   teamId: string;
   labels: LabelInterface[];
   initiative?: string;
   /** Days since the last health update (undefined = no update yet). */
   healthUpdatedAgoDays?: number;
   /** GitHub repository this project delivers into, as owner/name. */
   githubRepo?: string;
   /** What the project is for, as stored Markdown. */
   description?: string;
   /** Who created the project, when known. */
   createdById?: string | null;
   createdAt: string;
   updatedAt: string;
}

export interface Health {
   id: 'no-update' | 'off-track' | 'on-track' | 'at-risk';
   name: string;
   color: string;
   description: string;
}

export const health: Health[] = [
   {
      id: 'no-update',
      name: 'No update',
      color: 'var(--status-neutral)',
      description: 'The project has not been updated in the last 30 days.',
   },
   {
      id: 'off-track',
      name: 'Off track',
      color: 'var(--status-danger)',
      description: 'The project is not on track and may be delayed.',
   },
   {
      id: 'on-track',
      name: 'On track',
      color: 'var(--status-success)',
      description: 'The project is on track and on schedule.',
   },
   {
      id: 'at-risk',
      name: 'At risk',
      color: 'var(--status-warning)',
      description: 'The project is at risk and may be delayed.',
   },
];
