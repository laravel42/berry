import Svg, { Circle, Path } from 'react-native-svg';

import { TONE_COLOR } from '@/data/people';
import type { Status } from '@/model/types';
import { STATUS } from '@/data/people';
import { colors } from '@/theme/tokens';

type MarkProps = {
  size?: number;
  dot?: string;
  stroke?: string;
  hollow?: boolean;
  crossed?: boolean;
};

export function BerryMark({ size = 18, dot = colors.berry, stroke = colors.chalk, hollow = false, crossed = false }: MarkProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <Path d="M20 10H10V54H20M44 10H54V54H44" stroke={stroke} strokeWidth={6} />
      {crossed ? (
        <Path d="M24 24L40 40M40 24L24 40" stroke={dot} strokeWidth={6} />
      ) : (
        <Circle cx={32} cy={32} r={10} fill={hollow ? 'none' : dot} stroke={dot} strokeWidth={hollow ? 5 : 0} />
      )}
    </Svg>
  );
}

export function StatusMark({ status, size = 16 }: { status: Status; size?: number }) {
  const meta = STATUS[status];
  const color = TONE_COLOR[meta.tone];
  return <BerryMark size={size} dot={color} stroke={colors.ash} hollow={meta.hollow} crossed={meta.crossed} />;
}
