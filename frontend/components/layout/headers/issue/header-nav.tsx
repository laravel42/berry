'use client';

import { IssueHeaderMenu } from '@/components/common/issues/details/issue-header-menu';
import { IssueStepControls } from '@/components/common/issues/details/issue-nav-controls';
import { useDetailDrawerClose, useInDetailDrawer } from '@/components/layout/detail-drawer-context';
import { Button } from '@/components/ui/button';
import type { Issue } from '@/data/issues';
import { getBoardIssue } from '@/lib/issues';
import { cn } from '@/lib/utils';
import { useIssuesStore } from '@/store/issues-store';
import { useRunConsoleStore } from '@/store/run-console-store';
import { CornerLeftUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * The task header.
 *
 * It answers where this task sits, whether anything is happening to it right
 * now, and keeps subscribe / finish / pin / delete behind one overflow menu.
 *
 * The breadcrumb is not decoration. A task reached from search or from an
 * inbox row arrives with no context at all, and "which project is this" is the
 * first thing anybody asks.
 */
export default function HeaderNav() {
   const t = useTranslations('issueDetail.header');
   const { orgId, issueId } = useParams<{ orgId: string; issueId: string }>();
   const router = useRouter();
   const inDrawer = useInDetailDrawer();
   const closeDrawer = useDetailDrawerClose();
   const issues = useIssuesStore((state) => state.issues);
   const consoleFor = useRunConsoleStore((state) => state.openIssueId);

   const issue = issues.find(
      (candidate) => candidate.identifier === issueId || candidate.id === issueId
   );

   const [parent, setParent] = useState<Issue | null>(null);
   useEffect(() => {
      if (!issue?.parentId) {
         setParent(null);
         return;
      }
      let cancelled = false;
      void getBoardIssue(issue.parentId).then((found) => {
         if (!cancelled) setParent(found ?? null);
      });
      return () => {
         cancelled = true;
      };
   }, [issue?.parentId]);

   // The open console puts its own bar in this slot.
   if (issue && consoleFor === issue.id) return null;

   const onDeleted = () => {
      if (closeDrawer) {
         closeDrawer();
         return;
      }
      router.push(`/${orgId}/tasks`);
   };

   return (
      <div
         className={cn(
            'flex h-[52px] w-full items-center justify-between gap-4 border-b py-1.5',
            inDrawer ? 'pr-4 pl-1.5 lg:px-5' : 'px-4 md:px-5'
         )}
      >
         <div className="flex min-w-0 items-center gap-2">
            {issue ? (
               <>
                  {/* A sub-task's way up: one quiet icon before the
                      breadcrumb, named in full for touch and screen readers. */}
                  {parent ? (
                     <Button
                        variant="ghost"
                        size="icon-sm"
                        className="shrink-0 text-muted-foreground"
                        asChild
                     >
                        <Link
                           href={`/${orgId}/issue/${parent.identifier}`}
                           aria-label={t('openParent', { identifier: parent.identifier })}
                           title={t('parentOf', {
                              identifier: parent.identifier,
                              title: parent.title,
                           })}
                        >
                           <CornerLeftUp className="size-4" aria-hidden />
                        </Link>
                     </Button>
                  ) : null}

                  {/* Overflow is clipped: a narrow header shortens the
                      project and the title rather than drawing past its edge. */}
                  <nav
                     aria-label={t('breadcrumb')}
                     className="flex min-w-0 items-center gap-1.5 overflow-hidden"
                  >
                     {issue.project ? (
                        <Link
                           href={`/${orgId}/project/${issue.project.id}/issues`}
                           className="max-w-[160px] min-w-[3ch] shrink truncate whitespace-nowrap text-muted-foreground hover:underline"
                        >
                           {issue.project.name}
                        </Link>
                     ) : (
                        <span className="shrink-0 whitespace-nowrap text-muted-foreground">
                           {t('noProject')}
                        </span>
                     )}
                     <span aria-hidden className="text-muted-foreground">
                        /
                     </span>
                     <span className="min-w-0 truncate">
                        <span className="mr-1.5 font-medium text-muted-foreground">
                           {issue.identifier}
                        </span>
                        <span className="font-medium">{issue.title}</span>
                     </span>
                  </nav>
               </>
            ) : null}
         </div>

         {/* On mobile (< md), stepper and overflow menu move into the wider
             inline bar alongside the description copy button in IssueDetails,
             freeing the top header for the breadcrumb. */}
         <div data-header-issue-controls className="hidden shrink-0 items-center gap-1 md:flex">
            <IssueStepControls issueRef={issueId} orgId={orgId} />
            {issue ? <IssueHeaderMenu issue={issue} onDeleted={onDeleted} /> : null}
         </div>
      </div>
   );
}
