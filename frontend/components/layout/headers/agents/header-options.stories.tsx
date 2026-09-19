import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { useAgentsListStore } from '@/store/agents-list-store';
import { useAgentsStore } from '@/store/agents-store';
import { agents, seedSession, workspaceRoute } from '../../stories-fixtures';
import HeaderOptions from './header-options';

const meta = {
   component: HeaderOptions,
   tags: ['ai-generated', 'needs-work'],
   parameters: {
      layout: 'fullscreen',
      nextjs: { navigation: workspaceRoute('/elian/agents') },
   },
   beforeEach: () => {
      seedSession('admin');
      useAgentsListStore.setState(useAgentsListStore.getInitialState());
      useAgentsStore.setState({ agents, archived: null });
   },
} satisfies Meta<typeof HeaderOptions>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
   play: async ({ canvas, userEvent }) => {
      const all = canvas.getByRole('tab', { name: /All/ });
      await expect(all).toHaveAttribute('data-state', 'active');
      await expect(all).toHaveTextContent('2');
      await userEvent.click(canvas.getByRole('tab', { name: /Archived/ }));
      await expect(useAgentsListStore.getState().scope).toBe('archived');
   },
};

/** The columns menu stays open while several columns are toggled. */
export const Columns: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: /Columns/ }));
      const body = within(canvasElement.ownerDocument.body);
      const menu = await body.findByRole('menu');
      const before = useAgentsListStore.getState().columns.length;
      await userEvent.click(within(menu).getAllByRole('menuitem')[0]);
      await expect(within(menu).getAllByRole('menuitem').length).toBeGreaterThan(0);
      await expect(useAgentsListStore.getState().columns.length).not.toBe(before);
   },
};

/** An archive that has been opened has a count of its own. */
export const WithArchive: Story = {
   beforeEach: () => {
      useAgentsStore.setState({
         archived: [
            {
               ...agents[1],
               id: 'agent-9',
               name: 'Legacy Coder',
               archivedAt: '2026-06-01T00:00:00Z',
            },
         ],
      });
   },
};
