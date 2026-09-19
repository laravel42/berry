import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import AgentLine from './agent-line';
import {
   archivedAgent,
   frontendAgent,
   importerAgent,
   orchestratorAgent,
   orgParams,
   releaseAgent,
   rosterMap,
} from './stories-fixtures';

const meta = {
   component: AgentLine,
   tags: ['ai-generated', 'needs-work'],
   parameters: orgParams,
   args: {
      agent: frontendAgent,
      roster: rosterMap.get(frontendAgent.id),
      columns: ['activity', 'lastActive', 'model', 'access'],
      selected: false,
      onToggleSelected: fn(),
      actions: {
         onDuplicate: fn(),
         onCancelRuns: fn(),
         onArchive: fn(),
         onRestore: fn(),
      },
   },
   decorators: [
      (Story) => (
         <div className="w-[1400px] border">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof AgentLine>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Working, two queued. */
export const Working: Story = {
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('checkbox', { name: 'Select Frontend Engineer' }));
      await expect(args.onToggleSelected).toHaveBeenCalledWith(frontendAgent.id);
   },
};

/** The orchestrator cannot be archived, and the menu says so before the click. */
export const Protected: Story = {
   args: { agent: orchestratorAgent, roster: rosterMap.get(orchestratorAgent.id) },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Actions for Orchestrator' }));
      const body = within(canvasElement.ownerDocument.body);
      const archive = await body.findByRole('menuitem', { name: 'Archive' });
      await expect(archive).toHaveAttribute('aria-disabled', 'true');
   },
};

export const OwnedByMember: Story = {
   args: { agent: releaseAgent, roster: rosterMap.get(releaseAgent.id), selected: true },
};

/** Never run and no model assigned. */
export const NoModel: Story = {
   args: {
      agent: importerAgent,
      roster: rosterMap.get(importerAgent.id),
   },
};

/** The roster has not arrived yet: only the agent's own fields show. */
export const RosterLoading: Story = { args: { roster: undefined } };

export const Archived: Story = {
   args: { agent: archivedAgent, roster: undefined },
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Actions for standup-bot' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('menuitem', { name: 'Restore' }));
      await expect(args.actions.onRestore).toHaveBeenCalledWith(archivedAgent);
   },
};
