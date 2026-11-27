export const colors = {
  // Canvas & surfaces (aligned with Web .dark Ledger tokens)
  void: '#0A0A0B',
  ink: '#111113',
  base: '#121214',
  panel: '#19191C',
  surface: '#1F1F23',
  field: '#222226',
  deep: '#121820',

  // Borders
  hair: '#262629',
  line: '#333338',
  divider: '#2A2A2F',
  railBorder: '#222226',

  // Text
  chalk: '#F6F6F7',
  ash: '#A8A8AE',
  slate: '#8A8A93',
  placeholder: '#5E5D64',
  white: '#FFFFFF',

  // Brand & buttons
  berry: '#C9325C',
  berryHover: '#D14868',
  berryText: '#F0738F',
  berrySoft: '#2A1018',
  settingsAccent: '#C74A5E',
  buttonPrimary: '#CDCDCD',
  buttonPrimaryInk: '#222226',

  // Status / semantic (Ledger monochromatic — accent only for human attention/urgent)
  statusNeutral: '#8A8A93',
  statusInfo: '#A8A8AE',
  statusWarning: '#F0738F',
  statusSuccess: '#E4E4E8',
  statusDanger: '#FF8A8A',
  avatarAgent: '#C8C8CE',
  avatarPerson: '#8A8A93',
  avatarInk: '#0A0A0B',
  switchOff: '#3A3A40',

  // Legacy semantic keys mapped harmoniously to Ledger dark values
  amber: '#F0738F',
  azure: '#A8A8AE',
  verdant: '#5FB08A',
  danger: '#FF8A8A',
} as const;

export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  monoRegular: 'JetBrainsMono_400Regular',
  monoMedium: 'JetBrainsMono_500Medium',
  monoSemibold: 'JetBrainsMono_600SemiBold',
} as const;

export const radii = {
  sm: 6,
  md: 10,
  card: 16,
  cardLg: 20,
  pill: 999,
} as const;

/**
 * 7-step semantic type scale aligned 1:1 with Web Option A (14px compact base):
 *   micro   11px  tab bar badges, 20px avatar initials, micro tags
 *   caption 12px  timestamps, metadata, identifiers, secondary labels
 *   body    14px  default UI: rows, controls, buttons, inputs, prose
 *   h3      15px  prominent row titles, sheet headers, subheadings
 *   h2      16px  section headings, modal titles
 *   h1      20px  page titles, detail titles, auth titles
 *   display 28px  hero / display headings
 */
export const typeScale = {
  micro: { fontSize: 11, lineHeight: 14 },
  caption: { fontSize: 12, lineHeight: 17 },
  body: { fontSize: 14, lineHeight: 20 },
  h3: { fontSize: 15, lineHeight: 21 },
  h2: { fontSize: 16, lineHeight: 22 },
  h1: { fontSize: 20, lineHeight: 26 },
  display: { fontSize: 28, lineHeight: 34 },
} as const;

export type TypeVariant = keyof typeof typeScale;
