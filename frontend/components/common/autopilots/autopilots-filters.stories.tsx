import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect } from 'storybook/test';
import type { FiltersState } from '@/components/data-table-filter/core/types';
import { useListFilters } from '@/components/common/filters/list-filters';
import { autopilots, liveAgents } from '@/components/common/agents/stories-fixtures';
import AutopilotsFilters, {
   DEFAULT_AUTOPILOT_CRITERIA,
   useAutopilotFilterColumns,
   type AutopilotCriteria,
} from './autopilots-filters';

const creators = [
   { id: 'user-1', name: 'Andrea Lunelio' },
   { id: 'user-2', name: 'Mira Okafor' },
];

/** The toolbar as the autopilots page wires it. */
function Toolbar({ initial }: { initial: AutopilotCriteria }) {
   const [criteria, setCriteria] = useState(initial);
   const [filters, setFilters] = useState<FiltersState>([]);
   const [query, setQuery] = useState('');
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
            criteria={criteria}
            onChange={setCriteria}
            filter={filter}
            query={query}
            onQueryChange={setQuery}
         />
         <p className="text-muted-foreground" data-testid="criteria">
            {criteria.sort}
            {criteria.sortDescending ? ' ↓' : ' ↑'} · {criteria.columns.join(', ')}
         </p>
      </div>
   );
}

const meta = {
   component: Toolbar,
   tags: ['ai-generated', 'needs-work'],
   args: { initial: DEFAULT_AUTOPILOT_CRITERIA },
} satisfies Meta<typeof Toolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByPlaceholderText('Search autopilots')).toBeVisible();
   },
};

export const NewestFirst: Story = {
   args: { initial: { sort: 'created', sortDescending: true, columns: ['status', 'quota'] } },
   play: async ({ canvas }) => {
      await expect(canvas.getByTestId('criteria')).toHaveTextContent(/^created/);
   },
};
