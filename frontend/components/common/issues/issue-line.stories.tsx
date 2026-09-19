import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { expect, within } from 'storybook/test';
import { useDisplaySettingsStore } from '@/store/display-settings-store';
import { IssueLine } from './issue-line';
import {
   healthTests,
   issueApiHandlers,
   persistHealth,
   rotateKey,
   seedIssuesWorkspace,
   sharedFilter,
   storyIssues,
   tightenSurfaces,
} from './stories-fixtures';

const meta = {
   component: IssueLine,
   tags: ['ai-generated', 'needs-work'],
   args: { issue: sharedFilter },
   decorators: [
      (Story) => (
         <DndProvider backend={HTML5Backend}>
            <div className="w-[900px] border-t bg-container">
               <Story />
            </div>
         </DndProvider>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedIssuesWorkspace();
      msw.use(...issueApiHandlers);
   },
} satisfies Meta<typeof IssueLine>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PersonAssigned: Story = {
   play: async ({ canvas }) => {
      // The row is one link to the task; the controls sit above it.
      await expect(canvas.getByRole('link', { name: /Share the list filter/ })).toHaveAttribute(
         'href',
         expect.stringMatching(/\/issue\/BERR-44$/)
      );
      await expect(
         canvas.getByRole('button', { name: 'Assigned to Andrea Lunelio' })
      ).toBeInTheDocument();
   },
};

export const AgentWorking: Story = {
   args: { issue: persistHealth },
   play: async ({ canvas }) => {
      // The run in flight puts the agent's live mark beside the title.
      await expect(canvas.getByTitle('Backend Engineer is working on this')).toBeInTheDocument();
   },
};

export const Blocked: Story = { args: { issue: rotateKey } };
export const Done: Story = { args: { issue: tightenSurfaces } };
export const Unassigned: Story = { args: { issue: healthTests } };

export const Selectable: Story = {
   args: { issue: sharedFilter, order: storyIssues.map((issue) => issue.id), draggable: true },
};

export const MinimalProperties: Story = {
   beforeEach: () => {
      useDisplaySettingsStore.setState({
         displayProperties: {
            id: false,
            status: true,
            priority: false,
            assignee: false,
            labels: false,
            created: false,
         },
      });
   },
   play: async ({ canvas }) => {
      await expect(canvas.queryByRole('combobox', { name: /Priority/ })).toBeNull();
      await expect(canvas.queryByText('Frontend')).toBeNull();
   },
};

export const RightClickMenu: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.pointer({
         keys: '[MouseRight]',
         target: canvas.getByRole('link', { name: /Share the list filter/ }),
      });
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByRole('menuitem', { name: /Copy link/ })).toBeVisible();
   },
};
