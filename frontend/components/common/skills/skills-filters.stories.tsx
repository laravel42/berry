import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect } from 'storybook/test';
import type { FiltersState } from '@/components/data-table-filter/core/types';
import { useListFilters } from '@/components/common/filters/list-filters';
import { liveAgents, skills } from '@/components/common/agents/stories-fixtures';
import SkillsFilters, {
   DEFAULT_CRITERIA,
   useSkillFilterColumns,
   type SkillCriteria,
} from './skills-filters';

const creators = [
   { id: 'user-1', name: 'Andrea Lunelio' },
   { id: 'user-2', name: 'Mira Okafor' },
];

/** The toolbar as the skills page wires it: criteria in state, filters through the shared controller. */
function Toolbar({ initial }: { initial: SkillCriteria }) {
   const [query, setQuery] = useState('');
   const [filters, setFilters] = useState<FiltersState>([]);
   const columns = useSkillFilterColumns(skills, liveAgents, creators);
   const filter = useListFilters({ data: skills, columns, filters, onFiltersChange: setFilters });
   return (
      <div className="flex w-[720px] flex-col gap-2">
         <SkillsFilters filter={filter} query={query} onQueryChange={setQuery} />
         <p className="text-muted-foreground" data-testid="criteria">
            {initial.sort} · {initial.columns.join(', ')}
         </p>
      </div>
   );
}

const meta = {
   component: Toolbar,
   tags: ['ai-generated', 'needs-work'],
   args: { initial: DEFAULT_CRITERIA },
} satisfies Meta<typeof Toolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Search and Filter on the left; scope tabs on the right. */
export const Filter: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('textbox', { name: /Search skills/i })).toBeVisible();
      await expect(canvas.getByRole('button', { name: /Filter/i })).toBeVisible();
      await expect(canvas.queryByRole('button', { name: 'Columns' })).not.toBeInTheDocument();
      await expect(canvas.getByTestId('criteria')).toHaveTextContent('name · agents');
   },
};

export const AllColumns: Story = {
   args: {
      initial: { sort: 'usage', columns: ['agents', 'creator', 'updated'] },
   },
};
