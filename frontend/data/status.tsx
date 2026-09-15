import type React from 'react';

import { BerryMark, type BerryMarkState, type BerryMarkTone } from '@/components/brand/berry-mark';

export type StatusCategory = 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled';

/**
 * The semantic tone a status wears, naming a `--status-*` token. Board column
 * and list group tints, and anything else that colours by status, derive
 * from this rather than from a colour of their own, so a column can never
 * disagree with the glyph beside it.
 */
export type StatusTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

export interface Status {
   id: string;
   name: string;
   /**
    * A CSS colour for the status, always a `var(--status-*)` reference so it
    * follows the theme. Kept for the descriptors that still carry a colour
    * field; new code should read `statusTone()` and pick the token it needs.
    */
   color: string;
   category: StatusCategory;
   icon: React.FC;
   /** Set on Berry's own statuses; `statusTone()` derives it for any other. */
   tone?: StatusTone;
}

const toneColor = (tone: StatusTone): string => `var(--status-${tone})`;

/**
 * The tone of any status, including ones built elsewhere without a `tone`
 * (project workflow states): the id decides where it is a Berry status, and
 * the category stands in for the rest.
 */
export function statusTone(
   status: Pick<Status, 'id' | 'category'> & { tone?: StatusTone }
): StatusTone {
   if (status.tone) return status.tone;
   switch (status.id) {
      case 'in-progress':
         return 'info';
      case 'in-review':
      case 'blocked':
         return 'warning';
      case 'done':
         return 'success';
      case 'backlog':
      case 'to-do':
      case 'cancelled':
      case 'paused':
         return 'neutral';
      default:
         break;
   }
   switch (status.category) {
      case 'started':
         return 'info';
      case 'completed':
         return 'success';
      default:
         return 'neutral';
   }
}

function statusIcon(
   tone: BerryMarkTone,
   options: { pulse?: boolean; state?: BerryMarkState; label: string }
): React.FC {
   const Icon = () => (
      <BerryMark
         size="sm"
         tone={tone}
         state={options.state}
         pulse={options.pulse}
         label={options.label}
      />
   );
   return Icon;
}

export const BacklogIcon = statusIcon('neutral', { state: 'hollow', label: 'Backlog' });
export const ToDoIcon = statusIcon('neutral', { state: 'hollow', label: 'Todo' });
export const InProgressIcon = statusIcon('working', { pulse: true, label: 'In Progress' });
export const InReviewIcon = statusIcon('attention', { label: 'In Review' });
export const DoneIcon = statusIcon('complete', { label: 'Done' });
export const BlockedIcon = statusIcon('attention', { state: 'hollow', label: 'Blocked' });
export const CancelledIcon = statusIcon('attention', { state: 'crossed', label: 'Cancelled' });
/** Project-only workflow state (not an issue status). */
export const PausedIcon = statusIcon('neutral', { state: 'hollow', label: 'Paused' });

/**
 * Berry issue workflow statuses in board/list order.
 * IDs stay stable for UI state; API mapping lives in `lib/catalog.ts`.
 *
 * Each carries the tone its glyph is drawn in (see the icons above): the
 * board column tint, the list group bar and the mark all read the same
 * `--status-*` token, in both themes.
 */
export const status: Status[] = [
   {
      id: 'backlog',
      name: 'Backlog',
      tone: 'neutral',
      color: toneColor('neutral'),
      category: 'backlog',
      icon: BacklogIcon,
   },
   {
      id: 'to-do',
      name: 'Todo',
      tone: 'neutral',
      color: toneColor('neutral'),
      category: 'unstarted',
      icon: ToDoIcon,
   },
   {
      id: 'in-progress',
      name: 'In Progress',
      tone: 'info',
      color: toneColor('info'),
      category: 'started',
      icon: InProgressIcon,
   },
   {
      id: 'in-review',
      name: 'In Review',
      tone: 'warning',
      color: toneColor('warning'),
      category: 'started',
      icon: InReviewIcon,
   },
   {
      id: 'done',
      name: 'Done',
      tone: 'success',
      color: toneColor('success'),
      category: 'completed',
      icon: DoneIcon,
   },
   {
      id: 'blocked',
      name: 'Blocked',
      tone: 'warning',
      color: toneColor('warning'),
      category: 'started',
      icon: BlockedIcon,
   },
   {
      id: 'cancelled',
      name: 'Cancelled',
      tone: 'neutral',
      color: toneColor('neutral'),
      category: 'canceled',
      icon: CancelledIcon,
   },
];

/** Same order as `status` — used by list, board, insights, and filters. */
export const workflowOrderedStatus: Status[] = status;

export const displayOrderedStatus: Status[] = status;

export function getStatusesByCategory(categories: StatusCategory[]): Status[] {
   return status.filter((item) => categories.includes(item.category));
}

export const StatusIcon: React.FC<{ statusId: string }> = ({ statusId }) => {
   const currentStatus = status.find((item) => item.id === statusId);
   if (!currentStatus) return null;

   const IconComponent = currentStatus.icon;
   return <IconComponent />;
};
