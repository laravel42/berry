import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { archivedItems, inboxItems } from '@/components/layout/stories-fixtures';
import { InboxRow } from './inbox-row';

const [assignment, mention, approval, runFailed] = inboxItems;

const meta = {
   component: InboxRow,
   tags: ['ai-generated', 'needs-work'],
   args: {
      item: assignment,
      selected: false,
      archived: false,
      href: '/elian/issue/BERR-51',
      onSelect: fn(),
      onToggleRead: fn(),
      onArchive: fn(),
      onUnarchive: fn(),
   },
   decorators: [
      (Story) => (
         <div className="w-[420px] border bg-container">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof InboxRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const UnreadAssignment: Story = {
   play: async ({ canvas, args, userEvent }) => {
      await expect(canvas.getByLabelText('Unread')).toBeInTheDocument();
      await userEvent.click(canvas.getByRole('button', { name: /BERR-51/ }));
      await expect(args.onSelect).toHaveBeenCalled();
   },
};

export const SelectedMention: Story = {
   args: { item: mention, selected: true, href: '/elian/issue/BERR-42' },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('button', { name: /BERR-42/ })).toHaveAttribute(
         'aria-current',
         'true'
      );
   },
};

/** Not about a task: no key in front of the title. */
export const Approval: Story = {
   args: { item: approval, href: '/elian/inbox?approval=appr-1' },
};

export const ReadRunFailure: Story = {
   args: { item: runFailed, href: null },
   play: async ({ canvas, canvasElement, args, userEvent }) => {
      await expect(canvas.queryByLabelText('Unread')).toBeNull();
      // Everything but opening lives on the right-click menu.
      await userEvent.pointer({
         keys: '[MouseRight]',
         target: canvas.getByRole('button', { name: /Run failed/ }),
      });
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('menuitem', { name: 'Mark unread' }));
      await expect(args.onToggleRead).toHaveBeenCalled();
   },
};

export const InArchive: Story = {
   args: { item: archivedItems[0], archived: true, href: '/elian/issue/BERR-38' },
   play: async ({ canvas, canvasElement, args, userEvent }) => {
      await userEvent.pointer({
         keys: '[MouseRight]',
         target: canvas.getByRole('button', { name: /BERR-38/ }),
      });
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('menuitem', { name: 'Move to inbox' }));
      await expect(args.onUnarchive).toHaveBeenCalled();
   },
};
