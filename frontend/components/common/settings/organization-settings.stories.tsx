import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor } from 'storybook/test';
import OrganizationSettings from './organization-settings';
import { apiError, memberWorkspace, organization, seedSession } from './stories-fixtures';

const meta = {
   component: OrganizationSettings,
   tags: ['ai-generated', 'needs-work'],
   parameters: {
      nextjs: { navigation: { segments: [['orgId', 'elian']] } },
   },
   beforeEach: ({ msw }) => {
      seedSession();
      msw.use(
         http.get('*/api/v1/organization', () => HttpResponse.json(organization)),
         http.put('*/api/v1/organization/discovery', async ({ request }) => {
            const { enabled } = (await request.json()) as { enabled: boolean };
            return HttpResponse.json({ discoveryEnabled: enabled });
         }),
         http.post(
            '*/api/v1/organization/roles/:key/reset',
            () => new HttpResponse(null, { status: 204 })
         )
      );
   },
} satisfies Meta<typeof OrganizationSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Roles: Story = {
   play: async ({ canvas, userEvent }) => {
      await expect(
         await canvas.findByText('Backend engineer · Autonomy level 4 · Active')
      ).toBeVisible();
      // A role whose stored contract no longer validates is offered only a reset.
      await expect(canvas.getByText('Contract invalid')).toBeVisible();
      await expect(
         canvas.getByText('Product manager → Backend engineer → Security reviewer')
      ).toBeVisible();

      const discovery = canvas.getByRole('switch');
      await userEvent.click(discovery);
      await waitFor(() => expect(discovery).toHaveAttribute('aria-checked', 'false'));
   },
};

/** Specialists the workspace can add; adding one lists it with the roles. */
export const AddSpecialist: Story = {
   beforeEach: ({ msw }) => {
      let added = false;
      const specialist = {
         roleKey: 'security-engineer',
         name: 'Security Engineer',
         role: 'Application Security Engineer',
         department: 'quality-security',
         mission: 'Continuously reduce security risk.',
      };
      msw.use(
         http.get('*/api/v1/organization', () =>
            HttpResponse.json({ ...organization, specialists: added ? [] : [specialist] })
         ),
         http.post('*/api/v1/organization/roles/:key', () => {
            added = true;
            return HttpResponse.json({}, { status: 201 });
         })
      );
   },
   play: async ({ canvas, userEvent }) => {
      await expect(await canvas.findByText('Specialists')).toBeVisible();
      await expect(canvas.getByText('Continuously reduce security risk.')).toBeVisible();
      await userEvent.click(canvas.getByRole('button', { name: 'Add' }));
      await waitFor(() =>
         expect(canvas.queryByText('Continuously reduce security risk.')).not.toBeInTheDocument()
      );
   },
};

export const MemberCannotEdit: Story = {
   beforeEach: () => {
      seedSession(memberWorkspace);
   },
   play: async ({ canvas }) => {
      await expect(
         await canvas.findByText('Only workspace owners and admins can change this.')
      ).toBeVisible();
      await expect(canvas.getByRole('switch')).toBeDisabled();
      await expect(canvas.getByRole('button', { name: 'Reset' })).toBeDisabled();
   },
};

export const Loading: Story = {
   beforeEach: ({ msw }) => {
      msw.use(http.get('*/api/v1/organization', () => new Promise<Response>(() => undefined)));
   },
};

export const LoadFailed: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/organization', () =>
            apiError(500, 'The organization could not be read.')
         )
      );
   },
};
