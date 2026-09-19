import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor, within } from 'storybook/test';
import { useIssuesStore } from '@/store/issues-store';
import { CustomStatusSelect } from './custom-status-select';
import { apiIssue, persistHealth, seedIssuesWorkspace } from '../stories-fixtures';

const workspaceStatus = (
   id: string,
   name: string,
   category: string,
   isSystem: boolean,
   sortOrder: number
) => ({
   id,
   key: id,
   name,
   description: null,
   category,
   color: '#3e63dd',
   sortOrder,
   isSystem,
   archivedAt: null,
});

const statuses = [
   workspaceStatus('st-progress', 'In Progress', 'started', true, 1),
   workspaceStatus('st-qa', 'In QA', 'started', false, 2),
   workspaceStatus('st-staging', 'On staging', 'started', false, 3),
];

const meta = {
   component: CustomStatusSelect,
   tags: ['ai-generated', 'needs-work'],
   args: { issue: persistHealth },
   decorators: [
      (Story) => (
         <div className="w-[240px]">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedIssuesWorkspace({ withSession: true });
      msw.use(
         http.get('*/api/v1/catalogs/:workspaceId/issue-statuses', () =>
            HttpResponse.json({ nodes: statuses })
         ),
         http.put('*/api/v1/issues/:ref/status', () =>
            HttpResponse.json({ ...apiIssue(persistHealth), statusId: 'st-qa' })
         )
      );
   },
} satisfies Meta<typeof CustomStatusSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoNamedStatusYet: Story = {
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('Named status')).toBeInTheDocument();
   },
};

export const NamedStatusSet: Story = {
   args: { issue: { ...persistHealth, statusId: 'st-staging' } },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('On staging')).toBeInTheDocument();
   },
};

export const ChooseNamedStatus: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(await canvas.findByRole('combobox'));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('option', { name: 'In QA' }));
      await waitFor(() =>
         expect(useIssuesStore.getState().getIssueById(persistHealth.id)?.statusId).toBe('st-qa')
      );
   },
};

export const OnlySystemStatuses: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/catalogs/:workspaceId/issue-statuses', () =>
            HttpResponse.json({ nodes: [statuses[0]] })
         )
      );
   },
   play: async ({ canvasElement }) => {
      // Nothing to refine the status with, so nothing is drawn.
      await expect(canvasElement.querySelector('button')).toBeNull();
   },
};
