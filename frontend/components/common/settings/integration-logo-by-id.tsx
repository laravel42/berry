'use client';

import { Cpu } from 'lucide-react';

import { INTEGRATION_LOGOS } from './integration-logos';

/**
 * One integration logo picked by provider id. Lives in its own module so it
 * can be loaded with `dynamic()`: the logo set is ~86 KB and a badge only
 * ever draws one of them.
 */
export default function IntegrationLogoById({ id, className }: { id: string; className?: string }) {
   const Logo = INTEGRATION_LOGOS[id];
   if (Logo) return <Logo className={className} />;
   return <Cpu className={className} aria-hidden />;
}
