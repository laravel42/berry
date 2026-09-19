import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { BarChart3, CircleCheck } from 'lucide-react';
import { useState } from 'react';
import { expect, within } from 'storybook/test';
import { createColumnConfigHelper } from '@/components/data-table-filter/core/filters';
import type { FiltersState } from '@/components/data-table-filter/core/types';
import { priorityFilterOptions, taskStatusFilterOptions } from './filter-options';
import { applyListFilters, ListFilterBar, ListFilterTrigger, useListFilters } from './list-filters';

interface Row {
   id: string;
   title: string;
   status: string;
   priority: string;
}

const rows: Row[] = [
   { id: '1', title: 'Persist project health', status: 'in-progress', priority: 'high' },
   { id: '2', title: 'Move approvals into the inbox', status: 'to-do', priority: 'medium' },
   { id: '3', title: 'Share the list filter', status: 'completed', priority: 'high' },
];

const dtf = createColumnConfigHelper<Row>();
const columns = [
   dtf
      .option()
      .id('status')
      .accessor((row: Row) => row.status)
      .displayName('Status')
      .icon(CircleCheck)
      .options(taskStatusFilterOptions)
      .build(),
   dtf
      .option()
      .id('priority')
      .accessor((row: Row) => row.priority)
      .displayName('Priority')
      .icon(BarChart3)
      .options(priorityFilterOptions)
      .build(),
] as const;

/** The toolbar trigger, the chip row, and the list they narrow — as a page wires them. */
function FilteredList({ initial }: { initial: FiltersState }) {
   const [filters, setFilters] = useState<FiltersState>(initial);
   const filter = useListFilters({ data: rows, columns, filters, onFiltersChange: setFilters });
   const shown = applyListFilters(rows, columns, filters);
   return (
      <div className="flex w-[640px] flex-col border">
         <div className="flex h-10 items-center border-b px-6">
            <div className="ml-auto">
               <ListFilterTrigger filter={filter} />
            </div>
         </div>
         <ListFilterBar filter={filter} />
         <ul className="flex flex-col gap-1 px-6 py-2">
            {shown.map((row) => (
               <li key={row.id}>{row.title}</li>
            ))}
         </ul>
      </div>
   );
}

const meta = {
   component: FilteredList,
   tags: ['ai-generated'],
   args: { initial: [] },
} satisfies Meta<typeof FilteredList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoFilters: Story = {
   play: async ({ canvas }) => {
      // With nothing applied the chip row stays out of the way.
      await expect(canvas.queryByRole('button', { name: /clear/i })).toBeNull();
      await expect(canvas.getAllByRole('listitem')).toHaveLength(3);
   },
};

export const OpenMenu: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: /filter/i }));
      // The field list renders in a Radix portal on the document body.
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('Priority')).toBeVisible();
   },
};

export const Filtered: Story = {
   args: {
      initial: [{ columnId: 'priority', type: 'option', operator: 'is', values: ['high'] }],
   },
   play: async ({ canvas, userEvent }) => {
      await expect(canvas.getAllByRole('listitem')).toHaveLength(2);
      await userEvent.click(canvas.getByRole('button', { name: /clear/i }));
      await expect(canvas.getAllByRole('listitem')).toHaveLength(3);
   },
};
