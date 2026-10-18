import { MetaBadge } from '@/components/common/meta-badge';
import { INTEGRATION_LOGOS } from '@/components/common/settings/integration-logos';
import { cn } from '@/lib/utils';
import { Cpu } from 'lucide-react';
import { useId, type ReactNode } from 'react';

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

function OpenAiLogo({ className }: LogoProps) {
   const id = `openai-${useId().replace(/:/g, '')}`;
   return (
      <svg viewBox="0 0 512 512" className={className} fill="currentColor" aria-hidden>
         <defs>
            <path
               id={id}
               d="m243.3 208.7 88.9 51.3c.3.1.5.4.5.7V361c5.8-.3 11.5-.7 17-.9a79.8 79.8 0 0053.3-38.7c17.6-30.3 13.6-68.5-9.9-94.5-6-5-12-10-17.8-14.8-.5-.3-1.3-.8-1.9-1.1l-61.8-35.7a10.4 10.4 0 00-10.5 0l-57.7 33.5zm105.1 43.7-77.8-44.9 26.9-15.5c.3-.2.6-.2.9-.1l64.4 37.2c28.7 16.6 38.5 53.3 21.9 81.9a59.9 59.9 0 01-31.2 26.3v-75.8c0-3.7-2-7.2-5.2-9.1z"
            />
         </defs>
         <use href={`#${id}`} />
         <use href={`#${id}`} transform="rotate(60 256 256)" />
         <use href={`#${id}`} transform="rotate(120 256 256)" />
         <use href={`#${id}`} transform="rotate(180 256 256)" />
         <use href={`#${id}`} transform="rotate(240 256 256)" />
         <use href={`#${id}`} transform="rotate(300 256 256)" />
      </svg>
   );
}

function GeminiLogo({ className }: LogoProps) {
   const id = `gemini-${useId().replace(/:/g, '')}`;
   return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden>
         <defs>
            <linearGradient id={id} x1="0%" y1="100%" x2="100%" y2="0%">
               <stop offset="0%" stopColor="#1C7DFF" />
               <stop offset="50%" stopColor="#7B61FF" />
               <stop offset="100%" stopColor="#FF4E8A" />
            </linearGradient>
         </defs>
         <path
            fill={`url(#${id})`}
            d="M12 0c0 6.627 5.373 12 12 12-6.627 0-12 5.373-12 12 0-6.627-5.373-12-12-12C6.627 12 12 6.627 12 0Z"
         />
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
   xai: GrokLogo,
   kiro: KiroLogo,
   kimi: KimiLogo,
   qoder: QoderLogo,
   openai: OpenAiLogo,
   anthropic: INTEGRATION_LOGOS.claude,
   gemini: GeminiLogo,
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
