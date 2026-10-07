import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, within } from 'storybook/test';
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
   const [criteria, setCriteria] = useState(initial);
   const [filters, setFilters] = useState<FiltersState>([]);
   const columns = useSkillFilterColumns(skills, liveAgents, creators);
   const filter = useListFilters({ data: skills, columns, filters, onFiltersChange: setFilters });
   return (
      <div className="flex w-[720px] flex-col gap-2">
         <SkillsFilters criteria={criteria} onChange={setCriteria} filter={filter} />
         <p className="text-muted-foreground" data-testid="criteria">
            {criteria.sort} · {criteria.columns.join(', ')}
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

/**
 * Sorting lives on the table headings now; the toolbar's own criterion is
 * which columns show. Adding one keeps the sort as it was.
 */
export const AddColumn: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await expect(canvas.queryByRole('button', { name: 'Name' })).not.toBeInTheDocument();
      await userEvent.click(canvas.getByRole('button', { name: 'Columns' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('option', { name: 'Creator' }));
      await expect(canvas.getByTestId('criteria')).toHaveTextContent(
         'name · labels, agents, files, creator'
      );
   },
};

export const AllColumns: Story = {
   args: {
      initial: { sort: 'usage', columns: ['labels', 'agents', 'files', 'creator', 'updated'] },
   },
};
