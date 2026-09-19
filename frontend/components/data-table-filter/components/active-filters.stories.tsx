import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { CalendarPlus, CircleCheck, Gauge, Tag, Text } from 'lucide-react';
import { expect } from 'storybook/test';
import { taskStatusFilterOptions } from '@/components/common/filters/filter-options';
import { createColumnConfigHelper } from '../core/filters';
import type { FiltersState } from '../core/types';
import { useDataTableFilters } from '../hooks/use-data-table-filters';
import { ActiveFilters, ActiveFiltersMobileContainer } from './active-filters';

interface Task {
   id: string;
   title: string;
   status: string;
   labels: string[];
   createdAt: Date;
   estimate: number;
}

const tasks: Task[] = [
   {
      id: 'BERR-42',
      title: 'Persist project health',
      status: 'in-progress',
      labels: ['backend', 'migration'],
      createdAt: new Date('2026-09-10T09:00:00Z'),
      estimate: 3,
   },
   {
      id: 'BERR-43',
      title: 'Move approvals into the inbox',
      status: 'in-review',
      labels: ['frontend'],
      createdAt: new Date('2026-09-14T09:00:00Z'),
      estimate: 5,
   },
   {
      id: 'BERR-44',
      title: 'Share the list filter',
      status: 'to-do',
      labels: ['frontend', 'design'],
      createdAt: new Date('2026-09-17T09:00:00Z'),
      estimate: 2,
   },
];

const dot = (color: string) => (
   <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} />
);

const dtf = createColumnConfigHelper<Task>();
const columnsConfig = [
   dtf
      .option()
      .id('status')
      .accessor((task: Task) => task.status)
      .displayName('Status')
      .icon(CircleCheck)
      .options(taskStatusFilterOptions)
      .build(),
   dtf
      .multiOption()
      .id('labels')
      .accessor((task: Task) => task.labels)
      .displayName('Labels')
      .icon(Tag)
      .options([
         { value: 'backend', label: 'backend', icon: dot('#4f9dff') },
         { value: 'frontend', label: 'frontend', icon: dot('#e5484d') },
         { value: 'design', label: 'design', icon: dot('#8e4ec6') },
         { value: 'migration', label: 'migration', icon: dot('#f5a524') },
      ])
      .build(),
   dtf
      .date()
      .id('createdAt')
      .accessor((task: Task) => task.createdAt)
      .displayName('Created')
      .icon(CalendarPlus)
      .build(),
   dtf
      .text()
      .id('title')
      .accessor((task: Task) => task.title)
      .displayName('Title')
      .icon(Text)
      .build(),
   dtf
      .number()
      .id('estimate')
      .accessor((task: Task) => task.estimate)
      .displayName('Estimate')
      .icon(Gauge)
      .build(),
] as const;

/** The chip row as a list page draws it, with the live filter count beside it. */
function ActiveFilterRow({ initial, mobile = false }: { initial: FiltersState; mobile?: boolean }) {
   const { columns, filters, actions, strategy } = useDataTableFilters({
      strategy: 'client',
      data: tasks,
      columnsConfig,
      defaultFilters: initial,
   });
   const chips = (
      <ActiveFilters columns={columns} filters={filters} actions={actions} strategy={strategy} />
   );
   return (
      <div className="flex w-[720px] flex-col gap-3">
         {mobile ? (
            <div className="w-[320px]">
               <ActiveFiltersMobileContainer>{chips}</ActiveFiltersMobileContainer>
            </div>
         ) : (
            <div className="flex flex-wrap gap-2">{chips}</div>
         )}
         <output className="text-muted-foreground">{filters.length} active</output>
      </div>
   );
}

const meta = {
   component: ActiveFilterRow,
   tags: ['ai-generated', 'needs-work'],
   args: {
      initial: [{ columnId: 'status', type: 'option', operator: 'is', values: ['in-progress'] }],
   },
} satisfies Meta<typeof ActiveFilterRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SingleOption: Story = {
   play: async ({ canvas, userEvent }) => {
      // Subject, operator and value read left to right.
      await expect(canvas.getByText('Status')).toBeVisible();
      await expect(canvas.getByRole('button', { name: 'is' })).toBeVisible();
      await expect(canvas.getByRole('button', { name: /in progress/i })).toBeVisible();
      // The last control in a chip removes it (it has no accessible name).
      const buttons = canvas.getAllByRole('button');
      await userEvent.click(buttons[buttons.length - 1]!);
      await expect(canvas.getByText('0 active')).toBeVisible();
      await expect(canvas.queryByText('Status')).toBeNull();
   },
};

export const EveryKind: Story = {
   args: {
      initial: [
         {
            columnId: 'status',
            type: 'option',
            operator: 'is any of',
            values: ['in-progress', 'in-review'],
         },
         { columnId: 'labels', type: 'multiOption', operator: 'include', values: ['frontend'] },
         {
            columnId: 'createdAt',
            type: 'date',
            operator: 'is between',
            values: [new Date('2026-09-08T12:00:00Z'), new Date('2026-09-18T12:00:00Z')],
         },
         { columnId: 'title', type: 'text', operator: 'contains', values: ['inbox'] },
         { columnId: 'estimate', type: 'number', operator: 'is between', values: [2, 5] },
      ],
   },
   play: async ({ canvas }) => {
      // Several statuses collapse into a count; the date range shares its month.
      await expect(canvas.getByText('2 statuses')).toBeVisible();
      await expect(canvas.getByText('Sep 8 - 18, 2026')).toBeVisible();
      await expect(canvas.getByText('5 active')).toBeVisible();
   },
};

export const MobileScroller: Story = {
   args: { ...EveryKind.args, mobile: true },
};
