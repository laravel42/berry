import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { INTEGRATION_LOGOS } from './integration-logos';

/** Every brand logo the integrations directory can show, keyed by provider id. */
function LogoGallery({ size = 'size-9' }: { size?: string }) {
   return (
      <ul className="grid grid-cols-6 gap-3">
         {Object.entries(INTEGRATION_LOGOS).map(([id, Logo]) => (
            <li key={id} className="flex flex-col items-center gap-1.5 text-muted-foreground">
               <span
                  className={`inline-flex ${size} items-center justify-center rounded-md border bg-background`}
               >
                  <Logo className="size-[60%]" />
               </span>
               <span className="max-w-full truncate">{id}</span>
            </li>
         ))}
      </ul>
   );
}

const meta = {
   component: LogoGallery,
   tags: ['ai-generated', 'needs-work'],
} satisfies Meta<typeof LogoGallery>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Gallery: Story = {};

export const Large: Story = { args: { size: 'size-14' } };
