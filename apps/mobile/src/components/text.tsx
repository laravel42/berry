import { Text, type TextProps, type TextStyle } from 'react-native';

import { colors, fonts, typeScale, type TypeVariant } from '@/theme/tokens';

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
  variant?: TypeVariant;
  /** @deprecated Prefer `variant`. Numeric sizes snap onto `typeScale`. */
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

function snapSizeToVariant(size: number): TypeVariant {
  if (size <= 11) return 'micro';
  if (size <= 12) return 'caption';
  if (size <= 14) return 'body';
  if (size <= 15) return 'h3';
  if (size <= 18) return 'h2';
  if (size <= 24) return 'h1';
  return 'display';
}

export function AppText({
  tone = 'chalk',
  weight = 'regular',
  mono = false,
  variant,
  size,
  style,
  ...props
}: Props) {
  const resolvedVariant = variant ?? (size !== undefined ? snapSizeToVariant(size) : 'body');
  const metrics = typeScale[resolvedVariant];
  const textStyle: TextStyle = {
    color: colors[tone],
    fontFamily: mono ? MONO_FONTS[weight] : SANS_FONTS[weight],
    fontSize: metrics.fontSize,
    lineHeight: metrics.lineHeight,
  };
  return <Text style={[textStyle, style]} {...props} />;
}
