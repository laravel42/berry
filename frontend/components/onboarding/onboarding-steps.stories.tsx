import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn, waitFor } from 'storybook/test';
import { OnboardingSteps } from './onboarding-steps';

/** `POST /api/v1/workspaces`, as `workspaceSchema` in lib/workspaces.ts parses it. */
const createdWorkspace = {
   id: 'ws-new',
   name: 'Acme Engineering',
   slug: 'acme-engineering',
   description: null,
   role: 'owner',
   createdAt: '2026-09-18T12:00:00Z',
   updatedAt: '2026-09-18T12:00:00Z',
   settings: { issuePrefix: 'ACM', defaultRole: 'member', allowMemberInvites: true },
};

/** One entry of `GET /api/v1/runtimes`, as `runtimeSchema` in lib/runtimes.ts parses it. */
const runtime = {
   id: 'rt-1',
   name: 'Berry platform (us-east-1)',
   kind: 'platform' as const,
   driver: 'agentcore' as const,
   arn: 'arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/berry-agents',
   endpointUrl: null,
   qualifier: 'DEFAULT',
   region: 'us-east-1',
   status: 'active' as const,
   lastHealthAt: '2026-09-18T11:55:00Z',
   lastHealthError: null,
   concurrencyLimit: 8,
   visibility: 'workspace' as const,
   ownerId: null,
   idleTimeoutS: 900,
   maxLifetimeS: 28800,
   isDefault: true,
   activeRuns: 0,
};

const customRuntime = {
   ...runtime,
   id: 'rt-2',
   name: 'Team sandbox',
   kind: 'custom' as const,
   driver: 'http' as const,
   arn: null,
   endpointUrl: 'https://agents.acme.example/invocations',
   region: null,
   visibility: 'private' as const,
   ownerId: 'user-1',
   isDefault: false,
};

const onboardingState = {
   version: 1,
   step: 'welcome',
   answers: null,
   skipped: false,
   completed: false,
};

const updateRuntime = fn();

const meta = {
   component: OnboardingSteps,
   tags: ['ai-generated', 'needs-work'],
   parameters: { layout: 'fullscreen' },
   args: { onEntered: fn(), onSkipped: fn() },
   beforeEach: ({ msw }) => {
      updateRuntime.mockClear();
      msw.use(
         http.patch('*/api/v1/me/onboarding', () => HttpResponse.json(onboardingState)),
         http.post('*/api/v1/workspaces', () => HttpResponse.json(createdWorkspace)),
         http.patch('*/api/v1/workspaces/:id/settings', () =>
            HttpResponse.json(createdWorkspace.settings)
         ),
         http.get('*/api/v1/runtimes', () =>
            HttpResponse.json({ nodes: [runtime, customRuntime] })
         ),
         http.patch('*/api/v1/runtimes/:id', async ({ params, request }) => {
            updateRuntime(params.id, await request.json());
            return HttpResponse.json({ ...customRuntime, isDefault: true });
         })
      );
   },
} satisfies Meta<typeof OnboardingSteps>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Welcome: Story = {
   play: async ({ canvas, userEvent }) => {
      await expect(canvas.getByRole('heading', { name: 'Welcome to Berry' })).toBeVisible();
      await userEvent.click(canvas.getByRole('button', { name: 'Get started' }));
      await expect(await canvas.findByRole('heading', { name: 'About you' })).toBeVisible();
   },
};

export const SkipSetup: Story = {
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Skip setup' }));
      // No workspace exists yet, so skipping hands back to the parent.
      await expect(args.onSkipped).toHaveBeenCalledTimes(1);
      await expect(args.onEntered).not.toHaveBeenCalled();
   },
};

/** The address and prefix are derived as you type, and reserved addresses are refused. */
export const WorkspaceStep: Story = {
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Get started' }));
      await userEvent.click(await canvas.findByRole('button', { name: 'Skip this' }));
      const name = await canvas.findByRole('textbox', { name: 'Name' });

      await userEvent.type(name, 'Acme Engineering');
      await expect(canvas.getByRole('textbox', { name: /address/i })).toHaveValue(
         'acme-engineering'
      );
      await expect(canvas.getByRole('textbox', { name: /task prefix/i })).toHaveValue('ACM');
      await expect(canvas.getByText('Tasks will be numbered ACM-1.')).toBeVisible();

      await userEvent.clear(name);
      await userEvent.type(name, 'Settings');
      await expect(canvas.getByText('That address is reserved by Berry.')).toBeVisible();
      await expect(canvas.getByRole('button', { name: 'Create workspace' })).toBeDisabled();
   },
};

/** Create the workspace, then make a runtime the default and enter it. */
export const CreateAndPickRuntime: Story = {
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Get started' }));
      await userEvent.click(await canvas.findByRole('button', { name: 'Skip this' }));
      await userEvent.type(
         await canvas.findByRole('textbox', { name: 'Name' }),
         'Acme Engineering'
      );
      await userEvent.click(canvas.getByRole('button', { name: 'Create workspace' }));

      await expect(await canvas.findByRole('heading', { name: 'Where agents run' })).toBeVisible();
      await userEvent.click(await canvas.findByRole('button', { name: /team sandbox/i }));
      await waitFor(() => expect(args.onEntered).toHaveBeenCalledWith('ws-new'));
      await expect(updateRuntime).toHaveBeenCalledWith('rt-2', { isDefault: true });
   },
};

export const NoRuntimes: Story = {
   beforeEach: ({ msw }) => {
      msw.use(http.get('*/api/v1/runtimes', () => HttpResponse.json({ nodes: [] })));
   },
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Get started' }));
      await userEvent.click(await canvas.findByRole('button', { name: 'Skip this' }));
      await userEvent.type(await canvas.findByRole('textbox', { name: 'Name' }), 'Acme');
      await userEvent.click(canvas.getByRole('button', { name: 'Create workspace' }));
      await expect(await canvas.findByText(/No runtime has been added yet/)).toBeVisible();
      await userEvent.click(canvas.getByRole('button', { name: 'Use the workspace default' }));
      await waitFor(() => expect(args.onEntered).toHaveBeenCalledWith('ws-new'));
   },
};

export const CreateFails: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.post('*/api/v1/workspaces', () =>
            HttpResponse.json(
               { error: { code: 'conflict', message: 'workspace slug already exists' } },
               { status: 409 }
            )
         )
      );
   },
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Get started' }));
      await userEvent.click(await canvas.findByRole('button', { name: 'Skip this' }));
      await userEvent.type(await canvas.findByRole('textbox', { name: 'Name' }), 'Acme');
      await userEvent.click(canvas.getByRole('button', { name: 'Create workspace' }));
      await expect(await canvas.findByRole('alert')).toHaveTextContent(
         'That address is already taken.'
      );
   },
};
