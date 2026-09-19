import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { BarChart3, CalendarPlus, CircleCheck, Text } from 'lucide-react';
import { expect, within } from 'storybook/test';
import {
   priorityFilterOptions,
   taskStatusFilterOptions,
} from '@/components/common/filters/filter-options';
import { createColumnConfigHelper } from '../core/filters';
import type { FiltersState } from '../core/types';
import { useDataTableFilters } from '../hooks/use-data-table-filters';
import { FilterSelector } from './filter-selector';

interface Task {
   id: string;
   title: string;
   status: string;
   priority: string;
   createdAt: Date;
}

const tasks: Task[] = [
   {
      id: 'BERR-42',
      title: 'Persist project health',
      status: 'in-progress',
      priority: 'high',
      createdAt: new Date('2026-09-10T09:00:00Z'),
   },
   {
      id: 'BERR-43',
      title: 'Move approvals into the inbox',
      status: 'in-review',
      priority: 'medium',
      createdAt: new Date('2026-09-14T09:00:00Z'),
   },
   {
      id: 'BERR-44',
      title: 'Share the list filter',
      status: 'in-progress',
      priority: 'urgent',
      createdAt: new Date('2026-09-17T09:00:00Z'),
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
      .option()
      .id('priority')
      .accessor((task: Task) => task.priority)
      .displayName('Priority')
      .icon(BarChart3)
      .options(priorityFilterOptions)
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
] as const;

/** The "Filter" button with the applied filters read back underneath. */
function Selector({ initial, iconOnly }: { initial: FiltersState; iconOnly?: boolean }) {
   const { columns, filters, actions, strategy } = useDataTableFilters({
      strategy: 'client',
      data: tasks,
      columnsConfig,
      defaultFilters: initial,
   });
   return (
      <div className="flex flex-col gap-3">
         <div>
            <FilterSelector
               columns={columns}
               filters={filters}
               actions={actions}
               strategy={strategy}
               iconOnly={iconOnly}
            />
         </div>
         <output className="font-mono text-muted-foreground">
            {filters
               .map((filter) => `${filter.columnId} ${filter.operator} ${filter.values.join(',')}`)
               .join(' · ') || 'no filters'}
         </output>
      </div>
   );
}

const meta = {
   component: Selector,
   tags: ['ai-generated', 'needs-work'],
   args: { initial: [] },
   decorators: [
      (Story) => (
         <div className="h-[420px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof Selector>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FieldList: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Filter' }));
      const body = within(canvasElement.ownerDocument.body);
      for (const field of ['Status', 'Priority', 'Created', 'Title']) {
         await expect(await body.findByRole('option', { name: field })).toBeVisible();
      }
   },
};

export const PickAStatus: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Filter' }));
      const body = within(canvasElement.ownerDocument.body);
      // Choosing a field opens its value panel beside the list.
      await userEvent.click(await body.findByRole('option', { name: 'Status' }));
      await userEvent.click(await body.findByRole('option', { name: /in review/i }));
      await expect(canvas.getByText('status is in-review')).toBeVisible();
   },
};

export const WithExistingFilter: Story = {
   args: {
      initial: [{ columnId: 'priority', type: 'option', operator: 'is', values: ['high'] }],
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Filter' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('option', { name: 'Priority' }));
      // Values already applied open ticked.
      const high = await body.findByRole('option', { name: /high/i });
      await expect(within(high).getByRole('checkbox')).toHaveAttribute('data-state', 'checked');
   },
};

export const IconOnly: Story = {
   args: { iconOnly: true },
   play: async ({ canvas }) => {
      // The label moves to aria-label when the text is hidden.
      const trigger = canvas.getByRole('button', { name: 'Filter' });
      await expect(trigger).not.toHaveTextContent('Filter');
   },
};
