import {
   CancelledIcon,
   DoneIcon,
   InProgressIcon,
   PausedIcon,
   ToDoIcon,
   type Status,
} from '@/data/status';

export interface ProjectCreateStatusOption {
   status: Status;
   label: string;
}

const projectPausedStatus: Status = {
   id: 'paused',
   name: 'Paused',
   color: 'var(--status-neutral)',
   category: 'started',
   icon: PausedIcon,
};

const PROJECT_STATUS_OPTIONS: ProjectCreateStatusOption[] = [
   {
      status: {
         id: 'to-do',
         name: 'Todo',
         color: 'var(--status-neutral)',
         category: 'unstarted',
         icon: ToDoIcon,
      },
      label: 'Planned',
   },
   {
      status: {
         id: 'in-progress',
         name: 'In Progress',
         color: 'var(--status-info)',
         category: 'started',
         icon: InProgressIcon,
      },
      label: 'Active',
   },
   { status: projectPausedStatus, label: 'Paused' },
   {
      status: {
         id: 'done',
         name: 'Done',
         color: 'var(--status-success)',
         category: 'completed',
         icon: DoneIcon,
      },
      label: 'Completed',
   },
   {
      status: {
         id: 'cancelled',
         name: 'Cancelled',
         color: 'var(--status-warning)',
         category: 'canceled',
         icon: CancelledIcon,
      },
      label: 'Cancelled',
   },
];

export const projectCreateStatusOptions: ProjectCreateStatusOption[] = PROJECT_STATUS_OPTIONS;

export const defaultProjectCreateStatus =
   projectCreateStatusOptions.find((option) => option.status.id === 'to-do') ??
   projectCreateStatusOptions[0];
