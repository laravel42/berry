import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn, waitFor } from 'storybook/test';
import { WorkspaceStep } from './workspace-step';

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

const apiError = (status: number, message: string, code = 'INTERNAL') =>
   HttpResponse.json({ error: { code, message, requestId: 'req-story' } }, { status });

let createCalls = 0;

const meta = {
   component: WorkspaceStep,
   tags: ['ai-generated', 'needs-work'],
   args: { onEntered: fn() },
   decorators: [
      (Story) => (
         <div className="w-[470px]">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      createCalls = 0;
      msw.use(
         http.post('*/api/v1/workspaces', () => {
            createCalls += 1;
            return HttpResponse.json(createdWorkspace, { status: 201 });
         })
      );
   },
} satisfies Meta<typeof WorkspaceStep>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No name yet: the button is disabled, with no join option offered. */
export const Empty: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('heading', { name: 'Your workspace' })).toBeVisible();
      await expect(canvas.getByRole('button', { name: 'Create workspace' })).toBeDisabled();
      await expect(canvas.queryByText(/Join a workspace instead/)).toBeNull();
   },
};

/** A name that derives to a route Berry already serves is refused before submit. */
export const ReservedAddressBlocked: Story = {
   play: async ({ canvas, userEvent }) => {
      const [nameInput] = canvas.getAllByRole('textbox');
      await userEvent.type(nameInput, 'Settings');
      await expect(await canvas.findByText('That address is reserved by Berry.')).toBeVisible();
      await expect(canvas.getByRole('button', { name: 'Create workspace' })).toBeDisabled();
   },
};

/** Creating hands the new workspace id up; the parent owns routing into it. */
export const CreateSucceeds: Story = {
   play: async ({ args, canvas, userEvent }) => {
      const [nameInput] = canvas.getAllByRole('textbox');
      await userEvent.type(nameInput, 'Acme Engineering');
      await userEvent.click(canvas.getByRole('button', { name: 'Create workspace' }));
      await waitFor(() => expect(args.onEntered).toHaveBeenCalledWith('ws-new'));
      expect(createCalls).toBe(1);
   },
};

/** The server refuses the address: the step stays, and says why. */
export const AddressTaken: Story = {
   beforeEach: ({ msw }) => {
      msw.use(http.post('*/api/v1/workspaces', () => apiError(409, 'Conflict')));
   },
   play: async ({ args, canvas, userEvent }) => {
      const [nameInput] = canvas.getAllByRole('textbox');
      await userEvent.type(nameInput, 'Acme Engineering');
      await userEvent.click(canvas.getByRole('button', { name: 'Create workspace' }));
      await expect(await canvas.findByRole('alert')).toHaveTextContent(
         'That address is already taken.'
      );
      await expect(args.onEntered).not.toHaveBeenCalled();
   },
};

/** Entering the created workspace fails: retrying enters it again, without recreating it. */
export const RetryAfterEntryFailure: Story = {
   args: { onEntered: fn(() => Promise.reject(new Error('offline'))) },
   play: async ({ args, canvas, userEvent }) => {
      const [nameInput] = canvas.getAllByRole('textbox');
      await userEvent.type(nameInput, 'Acme Engineering');
      const submit = canvas.getByRole('button', { name: 'Create workspace' });
      await userEvent.click(submit);
      await waitFor(() => expect(args.onEntered).toHaveBeenCalledTimes(1));
      await expect(await canvas.findByRole('alert')).toBeVisible();

      await userEvent.click(submit);
      await waitFor(() => expect(args.onEntered).toHaveBeenCalledTimes(2));
      await expect(args.onEntered).toHaveBeenLastCalledWith('ws-new');
      expect(createCalls).toBe(1);
   },
};

/** With an invitation path offered, it hands control to the parent and creates nothing. */
export const JoinInstead: Story = {
   args: { onJoin: fn() },
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: /Join a workspace instead/ }));
      await expect(args.onJoin).toHaveBeenCalledTimes(1);
      expect(createCalls).toBe(0);
   },
};
