import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn } from 'storybook/test';
import type { PreviewEnvFile } from '@/lib/preview-environment';
import { PreviewEnv } from './preview-env';

const path = (issueRef: string) => `*/api/v1/issues/${issueRef}/preview-environment/env`;

const meta = {
   component: PreviewEnv,
   tags: ['ai-generated'],
   args: { issueRef: 'BERR-1', wanted: null, onRebuild: fn() },
} satisfies Meta<typeof PreviewEnv>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Still being fetched: a plain loading line, not an empty editor. */
export const Loading: Story = {
   beforeEach: ({ msw }) => {
      msw.use(http.get(path('BERR-1'), () => new Promise<Response>(() => {})));
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Loading the variables…')).toBeVisible();
   },
};

/** The server has no `INTEGRATION_ENCRYPTION_KEY`: it cannot keep secrets, so there is nothing to edit. */
export const Unavailable: Story = {
   beforeEach: ({ msw }) => {
      const file: PreviewEnvFile = { available: false, project: null, text: '', updatedAt: null };
      msw.use(http.get(path('BERR-1'), () => HttpResponse.json(file)));
   },
   play: async ({ canvas }) => {
      await expect(
         await canvas.findByText(
            'This server has no INTEGRATION_ENCRYPTION_KEY, so it cannot keep secrets.'
         )
      ).toBeVisible();
   },
};

/** A task in no project: build variables belong to a project, and this task has none to keep them in. */
export const NoProject: Story = {
   beforeEach: ({ msw }) => {
      const file: PreviewEnvFile = { available: true, project: null, text: '', updatedAt: null };
      msw.use(http.get(path('BERR-1'), () => HttpResponse.json(file)));
   },
   play: async ({ canvas }) => {
      await expect(
         await canvas.findByText(
            'Build variables belong to a project, and this task is in none. Add it to a project to keep them.'
         )
      ).toBeVisible();
   },
};

/** A project's real `.env` text, sealed on the server: editable, and unchanged so Save stays disabled. */
export const Editable: Story = {
   beforeEach: ({ msw }) => {
      const file: PreviewEnvFile = {
         available: true,
         project: { id: 'proj-health', name: 'Persist project health' },
         text: 'DATABASE_URL=postgres://localhost/berry\nOPENAI_API_KEY=sk-test',
         updatedAt: '2026-09-17T14:00:00Z',
      };
      msw.use(http.get(path('BERR-1'), () => HttpResponse.json(file)));
   },
   play: async ({ canvasElement, canvas }) => {
      await expect(await canvas.findByText('Encrypted')).toBeVisible();
      const editor = canvasElement.querySelector('.cm-content');
      await expect(editor).toHaveAttribute('contenteditable', 'true');
      await expect(editor).toHaveTextContent('DATABASE_URL=postgres://localhost/berry');
      await expect(canvas.getByRole('button', { name: 'Save' })).toBeDisabled();
   },
};
