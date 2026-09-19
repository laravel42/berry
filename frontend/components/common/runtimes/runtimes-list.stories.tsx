import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor, within } from 'storybook/test';

import RuntimesList from './runtimes-list';
import { customRuntime, disabledRuntime, platformRuntime } from './stories-fixtures';

const list = (nodes: unknown[]) =>
   HttpResponse.json({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });

const meta = {
   component: RuntimesList,
   tags: ['ai-generated', 'needs-work'],
   parameters: { nextjs: { navigation: { segments: [['orgId', 'elian']] } } },
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/runtimes', () =>
            list([platformRuntime, customRuntime, disabledRuntime])
         )
      );
   },
} satisfies Meta<typeof RuntimesList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Online, recently lost and disabled, as the health dot and label say. */
export const Registered: Story = {
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('Berry platform')).toBeVisible();
      // The health label shares a text run with the run count and last-seen time.
      await expect(canvas.getByText(/^Recently lost/)).toBeVisible();
      await expect(canvas.getByText(/^Disabled/)).toBeVisible();
   },
};

/** Registering needs both fields; a success reloads the list. */
export const Register: Story = {
   beforeEach: ({ msw }) => {
      let registered = false;
      const created = {
         ...customRuntime,
         id: 'rt-new',
         name: 'Load test',
         arn: 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/load_test-q1',
         status: 'active',
         lastHealthAt: null,
         lastHealthError: null,
      };
      msw.use(
         http.get('*/api/v1/runtimes', () =>
            list(registered ? [platformRuntime, created] : [platformRuntime])
         ),
         http.post('*/api/v1/runtimes', () => {
            registered = true;
            return HttpResponse.json(created, { status: 201 });
         })
      );
   },
   play: async ({ canvas, userEvent }) => {
      const submit = canvas.getByRole('button', { name: 'Register runtime' });
      await expect(submit).toBeDisabled();
      await userEvent.type(canvas.getByRole('textbox', { name: 'Runtime name' }), 'Load test');
      await userEvent.type(
         canvas.getByRole('textbox', { name: 'Runtime ARN' }),
         'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/load_test-q1'
      );
      await userEvent.click(submit);
      await expect(await canvas.findByText('Load test')).toBeVisible();
      await waitFor(() =>
         expect(canvas.getByRole('textbox', { name: 'Runtime name' })).toHaveValue('')
      );
   },
};

export const RegisterRefused: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.post('*/api/v1/runtimes', () =>
            HttpResponse.json(
               {
                  error: {
                     code: 'VALIDATION_FAILED',
                     message: 'That ARN does not name an AgentCore runtime.',
                  },
               },
               { status: 422 }
            )
         )
      );
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.type(canvas.getByRole('textbox', { name: 'Runtime name' }), 'Typo');
      await userEvent.type(
         canvas.getByRole('textbox', { name: 'Runtime ARN' }),
         'arn:aws:s3:::nope'
      );
      await userEvent.click(canvas.getByRole('button', { name: 'Register runtime' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(
         await body.findByText('That ARN does not name an AgentCore runtime.')
      ).toBeVisible();
   },
};

export const NoneConfigured: Story = {
   beforeEach: ({ msw }) => {
      msw.use(http.get('*/api/v1/runtimes', () => list([])));
   },
};

export const Failed: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/runtimes', () =>
            HttpResponse.json(
               { error: { code: 'FORBIDDEN', message: 'Only an owner can see runtimes.' } },
               { status: 403 }
            )
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('Only an owner can see runtimes.')).toBeVisible();
   },
};
