import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { CalendarPlus, CircleCheck } from 'lucide-react';
import { expect } from 'storybook/test';
import { taskStatusFilterOptions } from '@/components/common/filters/filter-options';
import { createColumnConfigHelper } from '../core/filters';
import { useDataTableFilters } from '../hooks/use-data-table-filters';
import { getColumn } from '../lib/helpers';
import { FilterSubject } from './filter-subject';

interface Task {
   status: string;
   createdAt: Date;
}

const tasks: Task[] = [{ status: 'in-progress', createdAt: new Date('2026-09-10T09:00:00Z') }];

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
      .date()
      .id('createdAt')
      .accessor((task: Task) => task.createdAt)
      .displayName('Created')
      .icon(CalendarPlus)
      .build(),
] as const;

/** The left segment of a filter chip: the field's icon and name. */
function Subject({ columnId }: { columnId: 'status' | 'createdAt' }) {
   const { columns } = useDataTableFilters({ strategy: 'client', data: tasks, columnsConfig });
   return (
      <div className="flex h-7 w-fit items-center rounded-2xl border bg-background">
         <FilterSubject column={getColumn(columns, columnId)} />
      </div>
   );
}

const meta = {
   component: Subject,
   tags: ['ai-generated', 'needs-work'],
   args: { columnId: 'status' },
} satisfies Meta<typeof Subject>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Status: Story = {
   play: async ({ canvasElement, canvas }) => {
      await expect(canvas.getByText('Status')).toBeVisible();
      await expect(canvasElement.querySelector('svg')).not.toBeNull();
   },
};

export const Created: Story = { args: { columnId: 'createdAt' } };
