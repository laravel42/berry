import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect } from 'storybook/test';
import IssuePropertiesSettings from './issue-properties-settings';
import { apiError, page, seedSession, workspaceProperties } from './stories-fixtures';

const meta = {
   component: IssuePropertiesSettings,
   tags: ['ai-generated', 'needs-work'],
   beforeEach: ({ msw }) => {
      seedSession();
      msw.use(
         http.get('*/api/v1/catalogs/:ws/issue-properties', () =>
            HttpResponse.json(page(workspaceProperties))
         ),
         http.patch('*/api/v1/catalogs/:ws/issue-properties/:id', ({ params }) => {
            const found = workspaceProperties.find((entry) => entry.id === params.id);
            return HttpResponse.json({ ...found, archivedAt: null });
         })
      );
   },
} satisfies Meta<typeof IssuePropertiesSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Fields: Story = {
   play: async ({ canvas, userEvent }) => {
      await expect(await canvas.findByText('4 of 20 in use')).toBeVisible();
      await expect(canvas.getByText('· Staging, Production')).toBeVisible();
      // Archived fields hide behind a toggle, and can be restored from there.
      await userEvent.click(canvas.getByRole('switch'));
      await userEvent.click(canvas.getByRole('button', { name: 'Restore' }));
      await expect(await canvas.findByText('5 of 20 in use')).toBeVisible();
   },
};

export const AtCapacity: Story = {
   beforeEach: ({ msw }) => {
      const twenty = Array.from({ length: 20 }, (_, index) => ({
         ...workspaceProperties[0]!,
         id: `prop-cap-${index}`,
         name: `Field ${index + 1}`,
      }));
      msw.use(
         http.get('*/api/v1/catalogs/:ws/issue-properties', () => HttpResponse.json(page(twenty)))
      );
   },
   play: async ({ canvas }) => {
      await expect(
         await canvas.findByText('This workspace is at its limit. Remove a field to make room.')
      ).toBeVisible();
      await expect(canvas.getByPlaceholderText('Field name')).toBeDisabled();
   },
};

export const Empty: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/catalogs/:ws/issue-properties', () => HttpResponse.json(page([])))
      );
   },
};

export const LoadFailed: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/catalogs/:ws/issue-properties', () =>
            apiError(500, 'Task fields could not be loaded.')
         )
      );
   },
};
