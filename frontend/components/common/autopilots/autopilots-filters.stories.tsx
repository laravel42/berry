import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect } from 'storybook/test';
import type { FiltersState } from '@/components/data-table-filter/core/types';
import { useListFilters } from '@/components/common/filters/list-filters';
import { autopilots, liveAgents } from '@/components/common/agents/stories-fixtures';
import AutopilotsFilters, {
   useAutopilotFilterColumns,
   type AutopilotScope,
} from './autopilots-filters';

const creators = [
   { id: 'user-1', name: 'Andrea Lunelio' },
   { id: 'user-2', name: 'Mira Okafor' },
];

/** The toolbar as the Loops page wires it. */
function Toolbar({ initial }: { initial: AutopilotScope }) {
   const [scope, setScope] = useState(initial);
   const [filters, setFilters] = useState<FiltersState>([]);
   const columns = useAutopilotFilterColumns(liveAgents, creators);
   const filter = useListFilters({
      data: autopilots,
      columns,
      filters,
      onFiltersChange: setFilters,
   });
   return (
      <div className="flex w-[820px] flex-col gap-2">
         <AutopilotsFilters
            filter={filter}
            scope={scope}
            onScopeChange={setScope}
            counts={{ all: autopilots.length, archived: 0 }}
         />
         <p className="text-muted-foreground" data-testid="scope">
            {scope}
         </p>
      </div>
   );
}

const meta = {
   component: Toolbar,
   tags: ['ai-generated', 'needs-work'],
   args: { initial: 'all' },
} satisfies Meta<typeof Toolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('tab', { name: /All/ })).toBeVisible();
   },
};

export const Archived: Story = {
   args: { initial: 'archived' },
   play: async ({ canvas }) => {
      await expect(canvas.getByTestId('scope')).toHaveTextContent('archived');
   },
};
