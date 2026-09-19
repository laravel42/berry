import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { useDetailDrawerClose } from '@/components/layout/detail-drawer-context';
import { Button } from '@/components/ui/button';
import { useShellStore } from '@/store/shell-store';
import DetailDrawerShell from './detail-drawer-shell';
import AgentDetailHeader from './headers/agents/detail-header';
import { workspaceRoute } from './stories-fixtures';

/** What an intercepted detail route puts in the drawer, with its own way out. */
function AgentBody() {
   const close = useDetailDrawerClose();
   return (
      <div className="flex flex-col gap-3 overflow-y-auto p-6">
         <h2>Backend Engineer</h2>
         <p className="text-muted-foreground">
            Owns server-ts: migrations, repositories and the dispatcher. Autonomy level 3.
         </p>
         <Button variant="outline" size="sm" className="w-fit" onClick={close}>
            Done
         </Button>
      </div>
   );
}

const meta = {
   component: DetailDrawerShell,
   tags: ['ai-generated', 'needs-work'],
   args: {
      open: true,
      onClose: fn(),
      header: <AgentDetailHeader agentName="Backend Engineer" />,
      children: <AgentBody />,
   },
   parameters: {
      layout: 'fullscreen',
      nextjs: { navigation: workspaceRoute('/elian/agents/agent-1') },
   },
   beforeEach: () => {
      useShellStore.setState({ railOpen: true });
   },
} satisfies Meta<typeof DetailDrawerShell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AgentDetail: Story = {
   play: async ({ canvasElement, args, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      const drawer = await body.findByRole('dialog');
      await expect(within(drawer).getByRole('link', { name: 'Agents' })).toBeVisible();
      // The body closes through the drawer context rather than the router.
      await userEvent.click(within(drawer).getByRole('button', { name: 'Done' }));
      await expect(args.onClose).toHaveBeenCalled();
   },
};

export const EscapeCloses: Story = {
   play: async ({ canvasElement, args, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      await body.findByRole('dialog');
      await userEvent.keyboard('{Escape}');
      await expect(args.onClose).toHaveBeenCalled();
   },
};

/** A narrower ceiling than the global `--drawer-max-width`. */
export const Narrow: Story = {
   args: { maxWidth: 480 },
};

export const RailCollapsed: Story = {
   beforeEach: () => {
      useShellStore.setState({ railOpen: false });
   },
};
