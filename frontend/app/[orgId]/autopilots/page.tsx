'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import AutopilotDialog from '@/components/common/autopilots/autopilot-dialog';
import Autopilots from '@/components/common/autopilots/autopilots';
import AutopilotsFilters, {
   DEFAULT_AUTOPILOT_CRITERIA,
   activeAutopilotFilters,
   type AutopilotCriteria,
} from '@/components/common/autopilots/autopilots-filters';
import MainLayout from '@/components/layout/main-layout';
import { Button } from '@/components/ui/button';
import type { User } from '@/data/users';
import { Plus } from 'lucide-react';
import { useAutopilots } from '@/hooks/use-autopilots';
import type { Autopilot } from '@/lib/autopilots';
import { loadWorkspaceMembers } from '@/lib/members';
import { canEditProduct } from '@/lib/workspace-role';
import { useAgentsStore } from '@/store/agents-store';
import { useSessionStore } from '@/store/session-store';

export default function AutopilotsPage() {
   const t = useTranslations('areas.autopilots');
   const workspaceId = useSessionStore((state) => state.workspace?.id);
   const canEdit = canEditProduct(useSessionStore((state) => state.workspace?.role));
   const agents = useAgentsStore((state) => state.agents);
   const { autopilots, error, loaded, reload } = useAutopilots();

   const [people, setPeople] = useState<User[]>([]);
   const [criteria, setCriteria] = useState<AutopilotCriteria>(DEFAULT_AUTOPILOT_CRITERIA);
   const [creating, setCreating] = useState(false);
   const [template, setTemplate] = useState<{ name: string; prompt: string } | null>(null);

   useEffect(() => {
      if (!workspaceId) return;
      let cancelled = false;
      void loadWorkspaceMembers(workspaceId).then(
         (found) => {
            if (!cancelled) setPeople(found);
         },
         () => undefined
      );
      return () => {
         cancelled = true;
      };
   }, [workspaceId]);

   const assigneeName = useMemo(() => {
      return (autopilot: Autopilot) => {
         const name = agents.find((agent) => agent.id === autopilot.assigneeId)?.name;
         return name ?? t('row.unknownAssignee');
      };
   }, [agents, t]);

   const assignees = useMemo(
      () => agents.map((agent) => ({ id: agent.id, name: agent.name })),
      [agents]
   );

   const creators = useMemo(() => {
      const seen = new Set<string>();
      for (const autopilot of autopilots) if (autopilot.createdBy) seen.add(autopilot.createdBy);
      return [...seen].map((id) => ({
         id,
         name: people.find((person) => person.id === id)?.name ?? t('row.someone'),
      }));
   }, [autopilots, people, t]);

   /** The list arrives whole and is short, so it is narrowed here. */
   const shown = useMemo(() => {
      return autopilots.filter((autopilot) => {
         if (criteria.scope !== 'all' && autopilot.status !== criteria.scope) return false;
         if (criteria.assigneeId && autopilot.assigneeId !== criteria.assigneeId) return false;
         if (criteria.mode !== 'all' && autopilot.executionMode !== criteria.mode) return false;
         if (criteria.createdBy && autopilot.createdBy !== criteria.createdBy) return false;
         if (criteria.trigger === 'none' && autopilot.triggerKinds.length > 0) return false;
         if (
            (criteria.trigger === 'cron' || criteria.trigger === 'webhook') &&
            !autopilot.triggerKinds.includes(criteria.trigger)
         ) {
            return false;
         }
         return true;
      });
   }, [autopilots, criteria]);

   const header = (
      <div className="flex w-full flex-col gap-2 border-b px-6 py-3">
         <div className="flex flex-wrap items-center justify-between gap-4">
            <h1 className="min-w-0 truncate">{t('title')}</h1>
            {canEdit ? (
               <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => {
                     setTemplate(null);
                     setCreating(true);
                  }}
               >
                  <Plus className="size-4" />
                  {t('new')}
               </Button>
            ) : null}
         </div>
         <AutopilotsFilters
            criteria={criteria}
            onChange={setCriteria}
            assignees={assignees}
            creators={creators}
         />
      </div>
   );

   return (
      <MainLayout header={header}>
         <Autopilots
            autopilots={shown}
            loaded={loaded}
            error={error}
            criteria={criteria}
            assigneeName={assigneeName}
            canEdit={canEdit}
            onChanged={reload}
            narrowed={activeAutopilotFilters(criteria) > 0}
            onUseTemplate={(chosen) => {
               setTemplate(chosen);
               setCreating(true);
            }}
         />
         <AutopilotDialog
            open={creating}
            onOpenChange={setCreating}
            template={template}
            onSaved={reload}
         />
      </MainLayout>
   );
}
