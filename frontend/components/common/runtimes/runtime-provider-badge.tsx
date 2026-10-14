import { MetaBadge } from '@/components/common/meta-badge';
import { INTEGRATION_LOGOS } from '@/components/common/settings/integration-logos';
import { cn } from '@/lib/utils';
import { Cpu } from 'lucide-react';
import type { ReactNode } from 'react';

type LogoProps = { className?: string };

function GrokLogo({ className }: LogoProps) {
   return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
         <path d="M12 1.25 13.85 9.1 21.75 12 13.85 14.9 12 22.75 10.15 14.9 2.25 12l7.9-2.9z" />
      </svg>
   );
}

function KiroLogo({ className }: LogoProps) {
   return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
         <path d="M5 3h5.2v8.1L17.8 3H24l-8.6 9.2L24 21h-6.3l-7.5-8.2V21H5z" />
      </svg>
   );
}

function KimiLogo({ className }: LogoProps) {
   return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
         <path d="M16.4 3.2a9.2 9.2 0 1 0 4.4 16.6 11 11 0 0 1-4.4-16.6Z" />
      </svg>
   );
}

function QoderLogo({ className }: LogoProps) {
   return (
      <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
         <path d="M12 2.5A9.5 9.5 0 1 0 18.7 19l2.1 2.1 1.4-1.4-2-2A9.5 9.5 0 0 0 12 2.5Zm0 2a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15Z" />
      </svg>
   );
}

const RUNTIME_LOGOS: Record<string, (props: LogoProps) => ReactNode> = {
   grok: GrokLogo,
   kiro: KiroLogo,
   kimi: KimiLogo,
   qoder: QoderLogo,
};

function RuntimeMark({ runtimeId, className }: { runtimeId?: string | null; className?: string }) {
   const Logo = runtimeId ? (RUNTIME_LOGOS[runtimeId] ?? INTEGRATION_LOGOS[runtimeId]) : undefined;
   if (Logo) return <Logo className={className} />;
   return <Cpu className={className} aria-hidden />;
}

/**
 * A subscription runtime's mark, framed like Settings → Integrations, with an
 * optional label (the model or the product name).
 */
export function RuntimeProviderBadge({
   runtimeId,
   label,
   title,
   className,
   size = 'sm',
   bare = false,
   truncate = true,
}: {
   runtimeId?: string | null;
   label?: string;
   title?: string;
   className?: string;
   size?: 'sm' | 'md';
   /** Just the SVG, for a control that already has its own chrome. */
   bare?: boolean;
   truncate?: boolean;
}) {
   const framed = size === 'md';
   const mark = (
      <RuntimeMark
         runtimeId={runtimeId}
         className={framed && !bare ? 'size-[60%]' : 'size-3.5 shrink-0'}
      />
   );

   if (bare) {
      return (
         <span className={cn('inline-flex shrink-0', className)} title={title}>
            {mark}
         </span>
      );
   }

   if (!label) {
      return (
         <span
            className={cn(
               'inline-flex shrink-0 items-center justify-center rounded-md border bg-background',
               framed ? 'size-9' : 'size-5',
               className
            )}
            title={title}
            aria-hidden={title ? undefined : true}
         >
            {mark}
         </span>
      );
   }

   return (
      <MetaBadge icon={mark} title={title ?? label} className={className} truncate={truncate}>
         {label}
      </MetaBadge>
   );
}
