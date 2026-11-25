'use client';

import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';

/**
 * The file viewer's pane with no file open. Its own module so the review's
 * Files tab can paint it while the viewer's chunk (CodeMirror, the markdown
 * renderer) is still on its way, and nothing moves when the viewer lands.
 */
export function ArtifactPaneEmpty({ className }: { className?: string }) {
   const t = useTranslations('issueDetail.artifactViewer');
   return (
      <div
         className={cn(
            'flex size-full items-center justify-center bg-muted/20 text-muted-foreground',
            className
         )}
      >
         <p>{t('pickFile')}</p>
      </div>
   );
}
