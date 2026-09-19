import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, within } from 'storybook/test';
import type { Skill } from '@/lib/skills';
import { useSkillsCatalogueStore } from '@/store/skills-catalogue-store';
import { agents, seedSession, workspaceRoute } from '../../stories-fixtures';
import SkillDetailHeader from './detail-header';

const skill: Skill = {
   id: 'skill-2',
   name: 'postgres-migrations',
   description: 'Write forward-only, checksummed migrations for server-ts.',
   content: '# Postgres migrations\n\nNever edit an applied migration; add a new numbered one.',
   labels: ['backend', 'database'],
   source: {
      kind: 'github',
      url: 'https://github.com/berry-dev/skills',
      ref: 'main',
      importedAt: '2026-08-20T09:00:00Z',
   },
   files: [{ path: 'SKILL.md', size: 1_204 }],
   agentEnabled: null,
   createdBy: 'user-1',
   creatorName: 'Elian Rossi',
   agents: [{ id: 'agent-1', name: 'Backend Engineer', enabled: true }],
   createdAt: '2026-08-20T09:00:00Z',
   updatedAt: '2026-09-10T09:00:00Z',
};

const connection = (nodes: unknown[]) => ({
   nodes,
   pageInfo: { hasNextPage: false, endCursor: null },
});

const meta = {
   component: SkillDetailHeader,
   tags: ['ai-generated', 'needs-work'],
   args: { skillId: 'skill-2' },
   parameters: {
      layout: 'fullscreen',
      nextjs: { navigation: workspaceRoute('/elian/skills/skill-2', [['skillId', 'skill-2']]) },
   },
   beforeEach: ({ msw }) => {
      seedSession('admin');
      useSkillsCatalogueStore.setState({
         revision: 0,
         orderedIds: ['skill-1', 'skill-2', 'skill-3'],
      });
      msw.use(
         http.get('*/api/v1/skills/:id', () => HttpResponse.json(skill)),
         http.get('*/api/v1/skills', () =>
            HttpResponse.json({ nodes: [skill, { ...skill, id: 'skill-1', labels: ['frontend'] }] })
         ),
         http.get('*/api/v1/agents', () => HttpResponse.json(connection(agents)))
      );
   },
} satisfies Meta<typeof SkillDetailHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Imported from GitHub, second of three in the catalogue. */
export const FromGithub: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await expect(await canvas.findByText('postgres-migrations')).toBeVisible();
      await expect(canvas.getByText('2 / 3')).toBeVisible();
      await userEvent.click(canvas.getByRole('button', { name: 'Skill actions' }));
      const body = within(canvasElement.ownerDocument.body);
      // Only a GitHub import can be refreshed from its source.
      await expect(await body.findByRole('menuitem', { name: /Update from source/ })).toBeVisible();
   },
};

export const ConfirmDelete: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await canvas.findByText('postgres-migrations');
      await userEvent.click(canvas.getByRole('button', { name: 'Skill actions' }));
      const body = within(canvasElement.ownerDocument.body);
      const items = await body.findAllByRole('menuitem');
      const last = items[items.length - 1];
      if (!last) throw new Error('The actions menu is empty');
      await userEvent.click(last);
      await expect(await body.findByRole('alertdialog')).toBeVisible();
   },
};

/** A viewer sees the breadcrumb and the stepper, but no actions. */
export const Viewer: Story = {
   beforeEach: () => {
      seedSession('viewer');
   },
   play: async ({ canvas }) => {
      await canvas.findByText('postgres-migrations');
      await expect(canvas.queryByRole('button', { name: 'Skill actions' })).toBeNull();
   },
};

export const Loading: Story = {
   beforeEach: ({ msw }) => {
      msw.use(http.get('*/api/v1/skills/:id', () => new Promise<Response>(() => undefined)));
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Loading skill…')).toBeVisible();
   },
};
