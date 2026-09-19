import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor, within } from 'storybook/test';
import { useIssuesStore } from '@/store/issues-store';
import { IssueProjectProperty } from './issue-project-property';
import {
   issueApiHandlers,
   persistHealth,
   seedIssuesWorkspace,
   sharedFilter,
} from '../stories-fixtures';

const meta = {
   component: IssueProjectProperty,
   tags: ['ai-generated', 'needs-work'],
   args: { issue: persistHealth },
   decorators: [
      (Story) => (
         <div className="w-[260px]">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedIssuesWorkspace();
      msw.use(...issueApiHandlers);
   },
} satisfies Meta<typeof IssueProjectProperty>;

export default meta;
type Story = StoryObj<typeof meta>;

export const InAProject: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('button', { name: 'Project' })).toHaveTextContent(
         'Project health'
      );
   },
};

export const NoProject: Story = { args: { issue: sharedFilter } };

export const MoveToAnotherProject: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Project' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('option', { name: /Unified inbox/ }));
      await waitFor(() =>
         expect(useIssuesStore.getState().getIssueById(persistHealth.id)?.project?.id).toBe(
            'project-inbox'
         )
      );
   },
};

export const SaveRefused: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.patch('*/api/v1/issues/:ref', () =>
            HttpResponse.json(
               {
                  error: {
                     code: 'FORBIDDEN',
                     message: 'Only project members can move tasks here.',
                     details: null,
                  },
               },
               { status: 403 }
            )
         )
      );
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Project' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('option', { name: /^None/ }));
      // The link is put back once the server says no.
      await waitFor(() =>
         expect(useIssuesStore.getState().getIssueById(persistHealth.id)?.project?.id).toBe(
            'project-health'
         )
      );
   },
};
