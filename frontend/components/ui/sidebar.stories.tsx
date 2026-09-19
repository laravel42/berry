import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { FolderKanban, Inbox, ListTodo, Plus, Settings } from 'lucide-react';
import { expect } from 'storybook/test';
import {
   Sidebar,
   SidebarContent,
   SidebarFooter,
   SidebarGroup,
   SidebarGroupAction,
   SidebarGroupContent,
   SidebarGroupLabel,
   SidebarHeader,
   SidebarInset,
   SidebarMenu,
   SidebarMenuBadge,
   SidebarMenuButton,
   SidebarMenuItem,
   SidebarMenuSkeleton,
   SidebarMenuSub,
   SidebarMenuSubButton,
   SidebarMenuSubItem,
   SidebarProvider,
   SidebarSeparator,
} from './sidebar';

/**
 * `collapsible="none"` keeps the rail a plain column at any viewport width;
 * the offcanvas variants hide it below `md` and turn it into a sheet below
 * the app's 1024px mobile breakpoint.
 */
function Shell({ loading = false }: { loading?: boolean }) {
   return (
      <SidebarProvider className="h-[480px] border">
         <Sidebar collapsible="none">
            <SidebarHeader className="px-4 py-3 font-medium">Acme Engineering</SidebarHeader>
            <SidebarContent>
               <SidebarGroup>
                  <SidebarGroupContent>
                     <SidebarMenu>
                        <SidebarMenuItem>
                           <SidebarMenuButton>
                              <Inbox />
                              <span>Inbox</span>
                           </SidebarMenuButton>
                           <SidebarMenuBadge>4</SidebarMenuBadge>
                        </SidebarMenuItem>
                        <SidebarMenuItem>
                           <SidebarMenuButton isActive>
                              <ListTodo />
                              <span>Tasks</span>
                           </SidebarMenuButton>
                           <SidebarMenuSub>
                              <SidebarMenuSubItem>
                                 <SidebarMenuSubButton href="#mine">
                                    Assigned to me
                                 </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                              <SidebarMenuSubItem>
                                 <SidebarMenuSubButton href="#agents" isActive>
                                    Running agents
                                 </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                           </SidebarMenuSub>
                        </SidebarMenuItem>
                     </SidebarMenu>
                  </SidebarGroupContent>
               </SidebarGroup>
               <SidebarSeparator />
               <SidebarGroup>
                  <SidebarGroupLabel>Projects</SidebarGroupLabel>
                  <SidebarGroupAction aria-label="New project">
                     <Plus />
                  </SidebarGroupAction>
                  <SidebarGroupContent>
                     <SidebarMenu>
                        {loading ? (
                           [0, 1, 2].map((row) => (
                              <SidebarMenuItem key={row}>
                                 <SidebarMenuSkeleton showIcon />
                              </SidebarMenuItem>
                           ))
                        ) : (
                           <>
                              <SidebarMenuItem>
                                 <SidebarMenuButton>
                                    <FolderKanban />
                                    <span>Runtime hardening</span>
                                 </SidebarMenuButton>
                              </SidebarMenuItem>
                              <SidebarMenuItem>
                                 <SidebarMenuButton>
                                    <FolderKanban />
                                    <span>Inbox and approvals</span>
                                 </SidebarMenuButton>
                              </SidebarMenuItem>
                           </>
                        )}
                     </SidebarMenu>
                  </SidebarGroupContent>
               </SidebarGroup>
            </SidebarContent>
            <SidebarFooter>
               <SidebarMenu>
                  <SidebarMenuItem>
                     <SidebarMenuButton size="sm">
                        <Settings />
                        <span>Settings</span>
                     </SidebarMenuButton>
                  </SidebarMenuItem>
               </SidebarMenu>
            </SidebarFooter>
         </Sidebar>
         <SidebarInset className="p-6">
            <h1 className="font-medium">Tasks</h1>
         </SidebarInset>
      </SidebarProvider>
   );
}

const meta = {
   component: Shell,
   tags: ['ai-generated', 'needs-work'],
   parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Shell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Navigation: Story = {
   play: async ({ canvas }) => {
      const active = canvas.getByRole('button', { name: 'Tasks' });
      await expect(active).toHaveAttribute('data-active', 'true');
      await expect(canvas.getByRole('button', { name: 'Inbox' })).toHaveAttribute(
         'data-active',
         'false'
      );
      await expect(canvas.getByText('4')).toBeVisible();
   },
};

export const LoadingProjects: Story = { args: { loading: true } };
