'use client';

import { StatusBadge } from '@/components/common/status-badge';
import type { StatusLook } from '@/lib/catalog';
import { describePlanStatus, type PlanRecord, type PlanSummary } from '@/lib/plans';

/** A plan's look is a `StatusLook` derived from the whole record, not one status field. */
export type PlanLook = StatusLook;

/**
 * One glyph and one word for where a plan is. Generation and compile
 * outrank the record's own status because they are what the person is
 * waiting on; a draft that failed validation reads as needing fixes rather
 * than as a draft like any other.
 */
export function planLook(record: PlanRecord): PlanLook {
   return lookOf({
      status: record.status,
      generation: record.generation.status,
      validation: record.validation.status,
      errors: record.validation.errors.length,
      compile: record.compile?.status ?? null,
   });
}

/** The same look for a row of the Plans list, which carries the states but not the report. */
export function planSummaryLook(summary: PlanSummary): PlanLook {
   return lookOf({
      status: summary.status,
      generation: summary.generation.status,
      validation: summary.validationStatus,
      errors: 0,
      compile: summary.compileStatus,
   });
}

function lookOf(record: {
   status: PlanRecord['status'];
   generation: PlanRecord['generation']['status'];
   validation: PlanRecord['validation']['status'];
   errors: number;
   compile: string | null;
}): PlanLook {
   if (record.generation === 'running') {
      return { tone: 'working', state: 'solid', pulse: true, label: 'Planning' };
   }
   switch (record.status) {
      case 'approved':
         if (record.compile === 'failed') {
            return { tone: 'danger', state: 'solid', label: 'Start failed' };
         }
         if (record.compile === 'running') {
            return { tone: 'working', state: 'solid', pulse: true, label: 'Starting' };
         }
         return { tone: 'complete', state: 'solid', label: 'Started' };
      case 'pendingApproval':
         return { tone: 'attention', state: 'solid', label: describePlanStatus(record.status) };
      case 'rejected':
         return { tone: 'attention', state: 'crossed', label: 'Rejected' };
      case 'superseded':
         return { tone: 'neutral', state: 'crossed', label: 'Superseded' };
      case 'draft':
         break;
   }
   if (record.generation === 'failed') {
      return { tone: 'danger', state: 'solid', label: 'Planning failed' };
   }
   if (record.validation === 'blocked') {
      return { tone: 'attention', state: 'hollow', label: 'Needs answers' };
   }
   if (record.validation === 'invalid' || record.errors > 0) {
      return { tone: 'danger', state: 'hollow', label: 'Needs fixes' };
   }
   return { tone: 'neutral', state: 'hollow', label: 'Draft' };
}

export function PlanStatusBadge({ record, className }: { record: PlanRecord; className?: string }) {
   return <StatusBadge look={planLook(record)} className={className} />;
}
