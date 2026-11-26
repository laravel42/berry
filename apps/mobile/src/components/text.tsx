import { Text, type TextProps, type TextStyle } from 'react-native';

import { colors, fonts } from '@/theme/tokens';

type Tone =
  | 'chalk'
  | 'ash'
  | 'slate'
  | 'berry'
  | 'berryText'
  | 'azure'
  | 'amber'
  | 'verdant'
  | 'danger'
  | 'white';

type Weight = 'regular' | 'medium' | 'semibold';

type Props = TextProps & {
  tone?: Tone;
  weight?: Weight;
  mono?: boolean;
  size?: number;
};

const SANS_FONTS: Record<Weight, string> = {
  regular: fonts.regular,
  medium: fonts.medium,
  semibold: fonts.semibold,
};

const MONO_FONTS: Record<Weight, string> = {
  regular: fonts.monoRegular,
  medium: fonts.monoMedium,
  semibold: fonts.monoSemibold,
};

export function AppText({
  tone = 'chalk',
  weight = 'regular',
  mono = false,
  size = 14,
  style,
  ...props
}: Props) {
  const textStyle: TextStyle = {
    color: colors[tone],
    fontFamily: mono ? MONO_FONTS[weight] : SANS_FONTS[weight],
    fontSize: size,
    lineHeight: Math.round(size * 1.4),
  };
  return <Text style={[textStyle, style]} {...props} />;
}
