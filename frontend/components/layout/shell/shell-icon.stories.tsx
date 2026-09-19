import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { BerryMark, ShellIcon, shellNavRow } from './shell-icon';

const INBOX_ICON = '<path d="M4 13h4l1.5 3h5L16 13h4M4 13l2.5-7h11L20 13v5H4z" />';
const CHAT_ICON = '<path d="M4 5h16v11H9l-5 4z" />';

const meta = {
   component: ShellIcon,
   tags: ['ai-generated', 'needs-work'],
   args: { path: INBOX_ICON },
   decorators: [
      (Story) => (
         <div className="w-[218px] bg-[var(--shell-rail)] p-3 font-mono font-light text-[var(--shell-text)]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof ShellIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Glyph: Story = {};

export const Large: Story = { args: { path: CHAT_ICON, size: 24 } };

/** Icons as the rail draws them: in a nav row, selected and not, beside the brand mark. */
export const InNavRows: Story = {
   render: (args) => (
      <div className="flex flex-col gap-1">
         <div className="flex items-center gap-2.5 px-3 py-2">
            <BerryMark size={24} />
            <span className="font-display">Berry</span>
         </div>
         <span className={shellNavRow(true)}>
            <ShellIcon {...args} />
            Inbox
         </span>
         <span className={shellNavRow(false)}>
            <ShellIcon path={CHAT_ICON} />
            Chat
         </span>
      </div>
   ),
};
