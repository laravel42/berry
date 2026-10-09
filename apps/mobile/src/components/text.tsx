import { Text, type TextProps, type TextStyle } from 'react-native';

import { colors, fonts } from '@/theme/tokens';

type Props = TextProps & {
  tone?: 'chalk' | 'ash' | 'slate' | 'berry' | 'azure' | 'amber' | 'verdant' | 'danger';
  weight?: 'regular' | 'medium';
  size?: number;
};

export function AppText({ tone = 'chalk', weight = 'regular', size = 14, style, ...props }: Props) {
  const textStyle: TextStyle = {
    color: colors[tone],
    fontFamily: weight === 'medium' ? fonts.medium : fonts.regular,
    fontSize: size,
    lineHeight: Math.round(size * 1.4),
  };
  return <Text style={[textStyle, style]} {...props} />;
}
