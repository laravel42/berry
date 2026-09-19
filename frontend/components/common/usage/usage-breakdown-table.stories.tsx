import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { readableModelName } from '@/components/common/agents/model-name';

import { workspaceUsage } from './stories-fixtures';
import { UsageBreakdownTable } from './usage-breakdown-table';

const meta = {
   component: UsageBreakdownTable,
   tags: ['ai-generated', 'needs-work'],
   args: {
      title: 'Agents by spend',
      ranked: true,
      rows: workspaceUsage.byAgent.map((row) => ({
         id: row.key,
         label: row.agentName,
         href: `/elian/agents/${row.key}`,
         bucket: row,
      })),
   },
   decorators: [
      (Story) => (
         <div className="w-[560px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof UsageBreakdownTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AgentLeaderboard: Story = {};

/** Model rows show the readable name with the raw inference profile as the tooltip; one is unpriced. */
export const Models: Story = {
   args: {
      title: 'Models by spend',
      rows: workspaceUsage.byModel.map((row) => ({
         id: row.key,
         label: readableModelName(row.key),
         title: row.key,
         bucket: row,
      })),
   },
};

export const Unranked: Story = { args: { ranked: false } };

export const Empty: Story = { args: { rows: [] } };
