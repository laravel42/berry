import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { AgentMarkdown } from './agent-markdown';

const summary = `## Delivery summary

Added a \`health\` column to \`projects\` and a forward-only migration.

- \`server-ts/migrations/0042_project_health.sql\`
- \`server-ts/src/core/projects.ts\` now writes the column in the same transaction as the outbox event
- \`frontend/lib/projects.ts\` parses the new field

**Tests:** \`pnpm test:server\` passes; DB tests ran against the schema-only copy.

1. Review the migration.
2. Approve the run.

Nothing in the review gate is left open. The column defaults to \`on_track\`, so existing
projects read the same as before; the chip only changes once somebody posts an update.
The backfill is not needed because the default covers every row.`;

const clamp = { lines: 4, moreLabel: 'Read the rest', lessLabel: 'Show less' };

const meta = {
   component: AgentMarkdown,
   tags: ['ai-generated', 'needs-work'],
   args: { body: summary },
   decorators: [
      (Story) => (
         <div className="w-[560px] bg-container p-4">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof AgentMarkdown>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Full: Story = {
   play: async ({ canvas }) => {
      // Parsed into elements, not printed as syntax.
      await expect(canvas.getByText('Delivery summary')).toBeVisible();
      await expect(canvas.queryByText(/## Delivery/)).toBeNull();
      await expect(canvas.getAllByRole('listitem').length).toBeGreaterThanOrEqual(5);
   },
};

export const Clamped: Story = {
   args: { clamp },
   play: async ({ canvas, userEvent }) => {
      const more = await canvas.findByRole('button', { name: 'Read the rest' });
      await expect(more).toHaveAttribute('aria-expanded', 'false');
      await userEvent.click(more);
      const less = canvas.getByRole('button', { name: 'Show less' });
      await expect(less).toHaveAttribute('aria-expanded', 'true');
   },
};

/** Short text under a clamp shows no fold control: nothing is hidden. */
export const ShortUnderClamp: Story = {
   args: { body: 'Opened a pull request for **BERR-42**.', clamp },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('BERR-42')).toBeVisible();
      await expect(canvas.queryByRole('button')).toBeNull();
   },
};

export const StraySyntaxStaysLiteral: Story = {
   args: { body: 'Priority went from 3 * 2 to 6, and | pipes | stay as written.' },
};
