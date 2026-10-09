import Svg, { Rect } from 'react-native-svg';

import { PRIORITY_LEVEL } from '@/data/people';
import type { Priority } from '@/model/types';
import { colors } from '@/theme/tokens';

export function PriorityBars({ priority, size = 16 }: { priority: Priority; size?: number }) {
  const level = PRIORITY_LEVEL[priority]?.bars ?? 0;
  const on = level === 4 ? colors.amber : colors.chalk;
  const fill = (index: number) => (level >= index ? on : colors.line);
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" accessibilityLabel={PRIORITY_LEVEL[priority]?.label ?? 'Priority'}>
      <Rect x={1} y={10} width={3} height={5} rx={1} fill={fill(1)} />
      <Rect x={6.5} y={6} width={3} height={9} rx={1} fill={fill(2)} />
      <Rect x={12} y={2} width={3} height={13} rx={1} fill={fill(3)} />
    </Svg>
  );
}
