import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { workspaceRoute } from '../../stories-fixtures';
import AgentDetailHeader from './detail-header';

const meta = {
   component: AgentDetailHeader,
   tags: ['ai-generated', 'needs-work'],
   args: { agentName: 'Backend Engineer' },
   parameters: {
      layout: 'fullscreen',
      nextjs: { navigation: workspaceRoute('/elian/agents/agent-1', [['agentId', 'agent-1']]) },
   },
} satisfies Meta<typeof AgentDetailHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RoleAgent: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('link', { name: 'Agents' })).toHaveAttribute(
         'href',
         '/elian/agents'
      );
   },
};

export const LongName: Story = {
   args: { agentName: 'Release Coordinator for the Berry Server and Web Deployments' },
};
