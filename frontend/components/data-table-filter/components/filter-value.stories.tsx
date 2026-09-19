import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { CalendarPlus, CircleCheck, Gauge, Tag, Text } from 'lucide-react';
import { expect, within } from 'storybook/test';
import { taskStatusFilterOptions } from '@/components/common/filters/filter-options';
import { createColumnConfigHelper } from '../core/filters';
import type { FilterModel } from '../core/types';
import { useDataTableFilters } from '../hooks/use-data-table-filters';
import { getColumn } from '../lib/helpers';
import { FilterValue } from './filter-value';

interface Task {
   title: string;
   status: string;
   labels: string[];
   createdAt: Date;
   estimate: number;
}

const tasks: Task[] = [
   {
      title: 'Persist project health',
      status: 'in-progress',
      labels: ['backend', 'migration'],
      createdAt: new Date('2026-09-10T09:00:00Z'),
      estimate: 3,
   },
   {
      title: 'Move approvals into the inbox',
      status: 'in-review',
      labels: ['frontend'],
      createdAt: new Date('2026-09-14T09:00:00Z'),
      estimate: 5,
   },
   {
      title: 'Share the list filter',
      status: 'in-progress',
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

/** The value segment of a filter chip, with the filter's values read back. */
function ValueChip({ initial }: { initial: FilterModel }) {
   const { columns, filters, actions, strategy } = useDataTableFilters({
      strategy: 'client',
      data: tasks,
      columnsConfig,
      defaultFilters: [initial],
   });
   const filter = filters[0];
   return (
      <div className="flex flex-col gap-3">
         {filter ? (
            <div className="flex h-7 w-fit items-center rounded-2xl border bg-background">
               <FilterValue
                  column={getColumn(columns, filter.columnId)}
                  filter={filter}
                  actions={actions}
                  strategy={strategy}
               />
            </div>
         ) : null}
         <output className="font-mono text-muted-foreground">
            {filter ? filter.values.map(String).join(', ') : 'filter removed'}
         </output>
      </div>
   );
}

const meta = {
   component: ValueChip,
   tags: ['ai-generated', 'needs-work'],
   args: {
      initial: { columnId: 'status', type: 'option', operator: 'is', values: ['in-progress'] },
   },
   decorators: [
      (Story) => (
         <div className="h-[420px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof ValueChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OneStatus: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: /in progress/i }));
      const body = within(canvasElement.ownerDocument.body);
      // Adding a second value collapses the chip into a count.
      await userEvent.click(await body.findByRole('option', { name: /in review/i }));
      await expect(canvas.getByRole('button', { name: /2 statuses/ })).toBeVisible();
   },
};

export const SeveralStatuses: Story = {
   args: {
      initial: {
         columnId: 'status',
         type: 'option',
         operator: 'is any of',
         values: ['in-progress', 'in-review'],
      },
   },
};

export const Labels: Story = {
   args: {
      initial: {
         columnId: 'labels',
         type: 'multiOption',
         operator: 'include any of',
         values: ['frontend', 'design'],
      },
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('2 labels')).toBeVisible();
   },
};

export const DateRange: Story = {
   args: {
      initial: {
         columnId: 'createdAt',
         type: 'date',
         operator: 'is between',
         values: [new Date('2026-08-20T12:00:00Z'), new Date('2026-09-18T12:00:00Z')],
      },
   },
   play: async ({ canvas }) => {
      // Same year, different months: both months are spelled out.
      await expect(canvas.getByText('Aug 20 - Sep 18, 2026')).toBeVisible();
   },
};

export const TitleContains: Story = {
   args: {
      initial: { columnId: 'title', type: 'text', operator: 'contains', values: ['inbox'] },
   },
};

export const EstimateBetween: Story = {
   args: {
      initial: { columnId: 'estimate', type: 'number', operator: 'is between', values: [2, 5] },
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('button', { name: '2 and 5' })).toBeVisible();
   },
};
