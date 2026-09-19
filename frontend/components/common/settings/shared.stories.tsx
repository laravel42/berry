import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Bell, KeyRound, Monitor } from 'lucide-react';
import { expect, fn, within } from 'storybook/test';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
   EnabledDot,
   SelectMenu,
   SettingsCard,
   SettingsRow,
   SettingsSection,
   SettingsShell,
} from './shared';

const meta = {
   component: SettingsShell,
   tags: ['ai-generated', 'needs-work'],
   args: {
      title: 'Preferences',
      description: 'How Berry looks and behaves for you.',
      children: null,
   },
} satisfies Meta<typeof SettingsShell>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The building blocks every settings page is made of, composed as a page. */
export const Page: Story = {
   render: (args) => (
      <SettingsShell {...args}>
         <SettingsSection title="General" description="Saved to your account.">
            <SettingsCard>
               <SettingsRow
                  icon={<Bell className="size-4" />}
                  title="Mentions"
                  description="Someone names you in a comment."
                  trailing={<Switch defaultChecked aria-label="Mentions" />}
               />
               <SettingsRow
                  title="Language"
                  trailing={
                     <SelectMenu
                        aria-label="Language"
                        options={['en']}
                        labels={{ en: 'English' }}
                     />
                  }
               />
               <SettingsRow
                  icon={<KeyRound className="size-4" />}
                  title="API tokens"
                  description="2 active keys"
                  chevron
                  onClick={fn()}
               />
               <SettingsRow title="Legacy importer" description="Retired in 2026." muted />
            </SettingsCard>
         </SettingsSection>
         <SettingsSection
            title="Sessions"
            action={
               <Button size="xs" variant="ghost">
                  Sign out everywhere
               </Button>
            }
         >
            <SettingsCard>
               <SettingsRow
                  icon={<Monitor className="size-4" />}
                  title="Chrome on macOS"
                  description="93.41.12.7 · last used just now"
                  trailing={<EnabledDot>This device</EnabledDot>}
               />
            </SettingsCard>
         </SettingsSection>
      </SettingsShell>
   ),
};

export const WithBadge: Story = {
   args: { title: 'Connected accounts', badge: 'Not yet implemented' },
   render: (args) => (
      <SettingsShell {...args}>
         <SettingsCard>
            <SettingsRow title="No addresses yet" />
         </SettingsCard>
      </SettingsShell>
   ),
};

export const CompactPanel: Story = {
   args: { title: 'Keyboard shortcuts', compact: true },
   render: (args) => (
      <SettingsShell {...args}>
         <SettingsSection panel title="Tools" description="3 approved">
            <SettingsCard>
               <SettingsRow title="post_digest" trailing={<Switch aria-label="post_digest" />} />
            </SettingsCard>
         </SettingsSection>
      </SettingsShell>
   ),
};

/** The searchable variant of SelectMenu opens a command list in a popover. */
export const SearchableSelect: Story = {
   render: () => {
      const onChange = fn();
      return (
         <SettingsCard className="max-w-xl">
            <SettingsRow
               title="Time zone"
               trailing={
                  <SelectMenu
                     searchable
                     aria-label="Time zone"
                     searchPlaceholder="Search time zones…"
                     emptyLabel="No time zone matches."
                     options={['Europe/Rome', 'UTC', 'America/New_York', 'Asia/Tokyo']}
                     defaultValue="Europe/Rome"
                     onChange={onChange}
                  />
               }
            />
         </SettingsCard>
      );
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Time zone' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.type(await body.findByPlaceholderText('Search time zones…'), 'tok');
      await userEvent.click(body.getByRole('option', { name: /Asia\/Tokyo/ }));
      await expect(canvas.getByRole('button', { name: 'Time zone' })).toHaveTextContent(
         'Asia/Tokyo'
      );
   },
};
