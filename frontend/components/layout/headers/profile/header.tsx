'use client';

import { IssueFilterTrigger } from '@/components/common/issues/issue-filter-trigger';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button, trackButtonPressedClass } from '@/components/ui/button';
import { issuesCreatedBy } from '@/data/issues';
import { User } from '@/data/users';
import { cn } from '@/lib/utils';
import { useIssuesStore } from '@/store/issues-store';
import { useRightPanelStore } from '@/store/right-panel-store';
import { useSearchStore } from '@/store/search-store';
import { ToolbarSearch } from '@/components/common/page/toolbar-search';
import { BarChart3, ChevronRight, PanelRight, Star } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { parseAsString, useQueryState } from 'nuqs';
import { DisplayOptions } from '../display-options';

const PROFILE_TABS = [
   { label: 'Assigned', value: 'assigned' },
   { label: 'Created', value: 'created' },
];

function ProfileTabs() {
   const [activeTab, setActiveTab] = useQueryState('tab', parseAsString.withDefault('assigned'));

   return (
      <div className="flex items-center gap-1">
         {PROFILE_TABS.map((tab) => {
            const isActive = activeTab === tab.value;
            return (
               <button
                  key={tab.value}
                  type="button"
                  onClick={() => void setActiveTab(tab.value === 'assigned' ? null : tab.value)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                     'px-2.5 h-7 inline-flex items-center rounded-full border font-medium transition-colors',
                     isActive
                        ? 'border-azure/50 bg-azure/20 text-foreground'
                        : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-accent/50'
                  )}
               >
                  {tab.label}
               </button>
            );
         })}
      </div>
   );
}

/**
 * The member's task search: the shared toolbar search (a field from `sm` up,
 * an icon that opens it on a phone). The search store is open while a query
 * is applied, which is what the task list reads.
 */
function HeaderSearch() {
   const searchQuery = useSearchStore((state) => state.searchQuery);
   const setSearchQuery = useSearchStore((state) => state.setSearchQuery);
   const openSearch = useSearchStore((state) => state.openSearch);
   const closeSearch = useSearchStore((state) => state.closeSearch);

   return (
      <ToolbarSearch
         label="Search tasks"
         value={searchQuery}
         onChange={(next) => {
            setSearchQuery(next);
            if (next.trim() === '') closeSearch();
            else openSearch();
         }}
         className="w-56"
      />
   );
}

export default function Header({ member }: { member: User }) {
   const { orgId } = useParams<{ orgId: string }>();
   const [activeTab] = useQueryState('tab', parseAsString.withDefault('assigned'));
   const issues = useIssuesStore((state) => state.issues);
   const { openPanel, togglePanel } = useRightPanelStore();
   const count =
      activeTab === 'created'
         ? issuesCreatedBy(issues, member.id).length
         : issues.filter((issue) => issue.assignee?.id === member.id).length;

   return (
      <>
         <div className="flex min-h-[52px] w-full flex-wrap items-center justify-between gap-y-1.5 border-b px-2 py-1.5 sm:px-5">
            <div className="flex items-center gap-2 min-w-0">
               <div className="flex items-center gap-1.5 min-w-0">
                  <Link
                     href={`/${orgId}/settings/members`}
                     className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                     Members
                  </Link>
                  <ChevronRight className="size-3.5 text-muted-foreground shrink-0" />
                  <Avatar className="size-4 shrink-0">
                     <AvatarImage src={member.avatarUrl} alt={member.name} />
                     <AvatarFallback>{member.name[0]}</AvatarFallback>
                  </Avatar>
                  <span className="font-medium truncate">{member.name}</span>
                  <Button variant="ghost" size="icon" className="size-6 text-muted-foreground">
                     <Star className="size-3.5" />
                  </Button>
               </div>
            </div>
            {/* On a phone an opened search takes a line of its own. */}
            <div className="flex items-center gap-2 max-sm:contents">
               <HeaderSearch />
            </div>
         </div>
         <div className="flex h-[52px] w-full items-center justify-between border-b px-2 py-1.5 sm:px-5">
            <div className="flex items-center gap-3">
               <ProfileTabs />
               <span className="text-muted-foreground hidden sm:inline">
                  {count} {count === 1 ? 'issue' : 'issues'}
               </span>
            </div>
            <div className="flex items-center gap-1">
               <IssueFilterTrigger iconOnly />
               <Button
                  size="icon-sm"
                  variant="track"
                  aria-label={'Insights'}
                  title={'Insights'}
                  aria-pressed={openPanel === 'insights'}
                  className={cn(openPanel === 'insights' && trackButtonPressedClass)}
                  onClick={() => togglePanel('insights')}
               >
                  <BarChart3 className="size-4" aria-hidden="true" />
               </Button>
               <Button
                  size="icon-sm"
                  variant="track"
                  aria-label={'Profile'}
                  title={'Profile'}
                  aria-pressed={openPanel !== 'hidden' && openPanel !== 'insights'}
                  className={cn(
                     openPanel !== 'hidden' && openPanel !== 'insights' && trackButtonPressedClass
                  )}
                  onClick={() => togglePanel('hidden')}
               >
                  <PanelRight className="size-4" aria-hidden="true" />
               </Button>
               <DisplayOptions iconOnly />
            </div>
         </div>
      </>
   );
}
