import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, waitFor, within } from 'storybook/test';
import { useProjectsStore } from '@/store/projects-store';
import { HealthPopover } from './health-popover';
import {
   projectBilling,
   projectHealth,
   projectInbox,
   projectPatchHandler,
   projectRunner,
   seedProjectStores,
} from './stories-fixtures';

const meta = {
   component: HealthPopover,
   tags: ['ai-generated', 'needs-work'],
   args: { project: projectHealth },
   beforeEach: ({ msw }) => {
      seedProjectStores();
      msw.use(projectPatchHandler);
   },
} satisfies Meta<typeof HealthPopover>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The projects list cell: icon, with the name from xl up. */
export const OnTrack: Story = {};
export const AtRisk: Story = { args: { project: projectRunner } };
export const OffTrack: Story = { args: { project: projectBilling } };
export const NoUpdate: Story = { args: { project: projectInbox } };

/** A board card: a coloured dot and the name. */
export const Compact: Story = { args: { project: projectRunner, compact: true } };

/** The sidebar, where the name sits beside the control instead. */
export const IconOnly: Story = { args: { showLabel: false } };

/** Choosing a health writes it to the project, optimistically. */
export const ChangeHealth: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('combobox', { name: 'Health: On track' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('option', { name: /At risk/ }));
      await expect(canvas.getByRole('combobox', { name: 'Health: At risk' })).toBeVisible();
      await waitFor(() =>
         expect(useProjectsStore.getState().getProjectById(projectHealth.id)?.health.id).toBe(
            'at-risk'
         )
      );
   },
};
