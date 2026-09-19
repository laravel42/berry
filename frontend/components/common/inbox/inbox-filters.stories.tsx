import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, fn, within } from 'storybook/test';
import { ListFilterBar, useListFilters } from '@/components/common/filters/list-filters';
import type { FiltersState } from '@/components/data-table-filter/core/types';
import { inboxItems } from '@/components/layout/stories-fixtures';
import { InboxFilterBar } from './inbox-filters';
import {
   senderKey,
   useInboxFilterColumns,
   type InboxFacets,
   type InboxShowFilter,
} from './use-inbox';

const facetsOf = (item: (typeof inboxItems)[number]): InboxFacets => ({
   status: item.issue?.status.id ?? null,
   priority: item.issue?.priority.id ?? null,
   sender: senderKey(item),
});

/** The toolbar as the inbox page wires it: list mode, filter menu, chip row. */
function InboxToolbar({
   archivedView,
   initialFilters,
   onShowArchived,
   onShowActive,
}: {
   archivedView: boolean;
   initialFilters: FiltersState;
   onShowArchived: () => void;
   onShowActive: () => void;
}) {
   const [show, setShow] = useState<InboxShowFilter>('all');
   const [filters, setFilters] = useState<FiltersState>(initialFilters);
   const columns = useInboxFilterColumns(facetsOf);
   const filter = useListFilters({
      data: inboxItems,
      columns,
      filters,
      onFiltersChange: setFilters,
   });
   return (
      <div className="w-[520px] border bg-container">
         <div className="flex items-center gap-1.5 border-b px-4 py-2">
            <InboxFilterBar
               filter={filter}
               show={show}
               onShowChange={setShow}
               archivedView={archivedView}
               showCounts={{
                  all: inboxItems.length,
                  unread: inboxItems.filter((item) => !item.read).length,
                  archived: 1,
               }}
               onShowArchived={onShowArchived}
               onShowActive={onShowActive}
            />
         </div>
         <ListFilterBar filter={filter} className="px-4" />
      </div>
   );
}

const meta = {
   component: InboxToolbar,
   tags: ['ai-generated', 'needs-work'],
   args: {
      archivedView: false,
      initialFilters: [],
      onShowArchived: fn(),
      onShowActive: fn(),
   },
} satisfies Meta<typeof InboxToolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllNotifications: Story = {
   play: async ({ canvas, canvasElement, args, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'All' }));
      // Each list mode carries its count, so an empty one is visible before it is picked.
      const body = within(canvasElement.ownerDocument.body);
      const unread = await body.findByRole('menuitemradio', { name: /Unread/ });
      await expect(unread).toHaveTextContent('3');
      await userEvent.click(body.getByRole('menuitemradio', { name: /Archived/ }));
      await expect(args.onShowArchived).toHaveBeenCalled();
   },
};

export const ArchivedView: Story = {
   args: { archivedView: true },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('button', { name: 'Archived' })).toBeVisible();
   },
};

export const FilteredByPriority: Story = {
   args: {
      initialFilters: [
         { columnId: 'priority', type: 'option', operator: 'is', values: ['urgent'] },
      ],
   },
};
