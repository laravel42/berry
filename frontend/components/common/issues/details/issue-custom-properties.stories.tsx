import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, within } from 'storybook/test';
import type { PropertyDefinition, PropertyKind } from '@/lib/properties';
import { IssueCustomProperties } from './issue-custom-properties';
import { andrea, emptyPage, maya, seedIssuesWorkspace } from '../stories-fixtures';

const definition = (
   id: string,
   name: string,
   kind: PropertyKind,
   overrides: Partial<PropertyDefinition> = {}
): PropertyDefinition => ({
   id,
   workspaceId: 'ws-1',
   name,
   description: null,
   kind,
   options: [],
   icon: null,
   sortOrder: 0,
   createdAt: '2026-08-01T09:00:00Z',
   updatedAt: '2026-08-01T09:00:00Z',
   archivedAt: null,
   ...overrides,
});

const definitions = [
   definition('prop-area', 'Area', 'select', {
      options: [
         { id: 'opt-api', name: 'API', color: '#3e63dd' },
         { id: 'opt-ui', name: 'UI', color: '#30a46c' },
      ],
   }),
   definition('prop-estimate', 'Estimate (pts)', 'number'),
   definition('prop-customer', 'Customer facing', 'boolean'),
   definition('prop-owner', 'Domain owner', 'person'),
   definition('prop-spec', 'Spec', 'url'),
   definition('prop-legacy', 'Legacy squad', 'text', { archivedAt: '2026-07-01T09:00:00Z' }),
];

const member = (user: typeof andrea) => ({
   userId: user.id,
   workspaceId: 'ws-1',
   role: 'member',
   email: user.email,
   name: user.name,
   avatarUrl: null,
   joinedAt: '2026-01-12T09:00:00Z',
   updatedAt: '2026-01-12T09:00:00Z',
});

const values = (entries: Array<[string, unknown]>) =>
   http.get('*/api/v1/issues/:ref/properties', () =>
      HttpResponse.json({ nodes: entries.map(([propertyId, value]) => ({ propertyId, value })) })
   );

const meta = {
   component: IssueCustomProperties,
   tags: ['ai-generated', 'needs-work'],
   args: { issueRef: 'BERR-42' },
   decorators: [
      (Story) => (
         <div className="w-[292px]">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedIssuesWorkspace({ withSession: true });
      msw.use(
         http.get('*/api/v1/catalogs/:workspaceId/issue-properties', () =>
            HttpResponse.json({ nodes: definitions })
         ),
         http.get('*/api/v1/workspaces/:workspaceId/members', () =>
            HttpResponse.json({ nodes: [member(andrea), member(maya)], pageInfo: emptyPage })
         ),
         http.put(
            '*/api/v1/issues/:ref/properties/:propertyId',
            () => new HttpResponse(null, { status: 204 })
         ),
         http.delete(
            '*/api/v1/issues/:ref/properties/:propertyId',
            () => new HttpResponse(null, { status: 204 })
         ),
         values([
            ['prop-area', 'opt-api'],
            ['prop-estimate', 5],
            ['prop-owner', { type: 'user', id: 'user-2' }],
            ['prop-legacy', 'Platform'],
         ])
      );
   },
} satisfies Meta<typeof IssueCustomProperties>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FieldsWithValues: Story = {
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('Area')).toBeInTheDocument();
      // An archived field still shows its value, read-only.
      await expect(canvas.getByText('Archived')).toBeInTheDocument();
      await expect(canvas.getByText('Platform')).toBeInTheDocument();
      // Empty fields stay off the sidebar until asked for.
      await expect(canvas.queryByText('Spec')).toBeNull();
   },
};

export const RevealAnEmptyField: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await canvas.findByText('Area');
      await userEvent.click(canvas.getByRole('button', { name: 'Add property' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('menuitem', { name: 'Spec' }));
      await expect(await canvas.findByText('Spec')).toBeInTheDocument();
   },
};

export const NoValuesYet: Story = {
   beforeEach: ({ msw }) => {
      msw.use(values([]));
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('None')).toBeInTheDocument();
   },
};

export const WorkspaceHasNoFields: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/catalogs/:workspaceId/issue-properties', () =>
            HttpResponse.json({ nodes: [] })
         )
      );
   },
};
