import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, waitFor, within } from 'storybook/test';
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import { useIssuesStore } from '@/store/issues-store';
import { IssueContextMenu } from './issue-context-menu';
import {
   healthTests,
   issueApiHandlers,
   seedIssuesWorkspace,
   sharedFilter,
} from './stories-fixtures';

/** A row-shaped target; the menu is what a right-click on it opens. */
function RowWithMenu({ issueId }: { issueId: string }) {
   const issue = useIssuesStore((state) => state.getIssueById(issueId));
   return (
      <ContextMenu>
         <ContextMenuTrigger asChild>
            <div className="flex h-11 w-[640px] items-center gap-3 border px-4">
               <span className="text-muted-foreground">{issue?.identifier}</span>
               <span>{issue?.title}</span>
               <span className="ml-auto text-muted-foreground">
                  {issue?.status.name} · {issue?.priority.name}
               </span>
            </div>
         </ContextMenuTrigger>
         <IssueContextMenu issueId={issueId} />
      </ContextMenu>
   );
}

const meta = {
   component: RowWithMenu,
   tags: ['ai-generated', 'needs-work'],
   args: { issueId: sharedFilter.id },
   beforeEach: ({ msw }) => {
      seedIssuesWorkspace();
      msw.use(...issueApiHandlers);
   },
} satisfies Meta<typeof RowWithMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

export const Open: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.pointer({
         keys: '[MouseRight]',
         target: canvas.getByText(sharedFilter.title),
      });
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByRole('menuitem', { name: /Copy link/ })).toBeVisible();
      await expect(body.getByRole('menuitem', { name: /Delete/ })).toBeVisible();
   },
};

export const SetPriorityFromSubmenu: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.pointer({
         keys: '[MouseRight]',
         target: canvas.getByText(sharedFilter.title),
      });
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('menuitem', { name: /Priority/ }));
      await userEvent.click(await body.findByRole('menuitem', { name: /^Low/ }));
      await waitFor(() =>
         expect(useIssuesStore.getState().getIssueById(sharedFilter.id)?.priority.id).toBe('low')
      );
      await expect(await body.findByText('Priority updated to Low')).toBeVisible();
   },
};

export const DeleteAsksFirst: Story = {
   args: { issueId: healthTests.id },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.pointer({
         keys: '[MouseRight]',
         target: canvas.getByText(healthTests.title),
      });
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('menuitem', { name: /Delete/ }));
      await expect(await body.findByText('Delete BERR-47?')).toBeVisible();
   },
};
