'use client';

import dynamic from 'next/dynamic';

/**
 * Holds the panel's place until its chunk arrives. The panel fills the aside
 * it sits in (`h-full w-full`) whatever its rows, so this takes the same box
 * and nothing moves when the chart lands.
 */
function InsightsPanelPlaceholder() {
   return <div aria-hidden className="flex flex-col h-full w-full" />;
}

/**
 * The insights panel, with Recharts inside it, loaded after the page rather
 * than with it. Not prerendered: `ResponsiveContainer` has nothing to measure
 * on the server.
 */
export const InsightsPanel = dynamic(
   () => import('@/components/common/issues/insights-panel').then((m) => m.InsightsPanel),
   { ssr: false, loading: InsightsPanelPlaceholder }
);
