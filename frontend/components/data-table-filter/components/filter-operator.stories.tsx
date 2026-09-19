import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { CalendarPlus, CircleCheck, Gauge, Tag, Text } from 'lucide-react';
import { expect, within } from 'storybook/test';
import { taskStatusFilterOptions } from '@/components/common/filters/filter-options';
import { createColumnConfigHelper } from '../core/filters';
import type { FilterModel } from '../core/types';
import { useDataTableFilters } from '../hooks/use-data-table-filters';
import { getColumn } from '../lib/helpers';
import { FilterOperator } from './filter-operator';

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
      labels: ['backend'],
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
];

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
         { value: 'backend', label: 'backend' },
         { value: 'frontend', label: 'frontend' },
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

/** The operator segment of a filter chip, for one applied filter. */
function OperatorChip({ initial }: { initial: FilterModel }) {
   const { columns, filters, actions } = useDataTableFilters({
      strategy: 'client',
      data: tasks,
      columnsConfig,
      defaultFilters: [initial],
   });
   const filter = filters[0];
   if (!filter) return <p>Filter removed</p>;
   return (
      <div className="flex h-7 w-fit items-center rounded-2xl border bg-background">
         <FilterOperator
            column={getColumn(columns, filter.columnId)}
            filter={filter}
            actions={actions}
         />
      </div>
   );
}

const meta = {
   component: OperatorChip,
   tags: ['ai-generated', 'needs-work'],
   args: {
      initial: { columnId: 'status', type: 'option', operator: 'is', values: ['in-progress'] },
   },
   decorators: [
      (Story) => (
         <div className="h-[320px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof OperatorChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OptionIs: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'is' }));
      const body = within(canvasElement.ownerDocument.body);
      // A single value only offers the single-value operators.
      await expect(await body.findByRole('option', { name: 'is not' })).toBeVisible();
      await expect(body.queryByRole('option', { name: 'is any of' })).toBeNull();
      await userEvent.click(body.getByRole('option', { name: 'is not' }));
      await expect(canvas.getByRole('button', { name: 'is not' })).toBeVisible();
   },
};

export const OptionAnyOf: Story = {
   args: {
      initial: {
         columnId: 'status',
         type: 'option',
         operator: 'is any of',
         values: ['in-progress', 'in-review'],
      },
   },
};

export const MultiOption: Story = {
   args: {
      initial: {
         columnId: 'labels',
         type: 'multiOption',
         operator: 'include',
         values: ['backend'],
      },
   },
};

export const DateBetween: Story = {
   args: {
      initial: {
         columnId: 'createdAt',
         type: 'date',
         operator: 'is between',
         values: [new Date('2026-09-08T12:00:00Z'), new Date('2026-09-18T12:00:00Z')],
      },
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'is between' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByRole('option', { name: 'is not between' })).toBeVisible();
   },
};

export const TextContains: Story = {
   args: {
      initial: { columnId: 'title', type: 'text', operator: 'contains', values: ['inbox'] },
   },
};

export const NumberGreaterThan: Story = {
   args: {
      initial: { columnId: 'estimate', type: 'number', operator: 'is greater than', values: [3] },
   },
};
