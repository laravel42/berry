'use client';

import { RepositoryPicker } from '@/components/common/projects/repository-selector';
import type { Issue } from '@/data/issues';
import { describePatchFailure, patchBoardIssue } from '@/lib/issues';
import { useIssuesStore } from '@/store/issues-store';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

/**
 * The repository this task is worked in, in the properties sidebar.
 *
 * A task starts with its project's repository and may name another, or
 * none. Runs check out this one. The picker shows only for hosts that can
 * actually list repositories, and hides itself when none can.
 */
export function IssueRepositoryProperty({ issue }: { issue: Issue }) {
   const t = useTranslations('issueDetail.properties');
   const updateIssue = useIssuesStore((state) => state.updateIssue);
   const [saving, setSaving] = useState(false);

   const save = (choice: { provider: 'github' | 'gitlab'; fullName: string } | null) => {
      const previous = issue.repository ?? null;
      updateIssue(issue.id, { repository: choice });
      setSaving(true);
      void patchBoardIssue(issue.id, { repository: choice })
         .catch((cause: unknown) => {
            updateIssue(issue.id, { repository: previous });
            toast.error(describePatchFailure(cause) || t('saveFailed'));
         })
         .finally(() => setSaving(false));
   };

   return (
      <RepositoryPicker
         value={issue.repository?.fullName}
         valueProvider={issue.repository?.provider}
         onSelect={save}
         disabled={saving}
         pending={saving}
         placeholder={t('noRepository')}
      />
   );
}
