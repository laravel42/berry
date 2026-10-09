import Svg, { Path } from 'react-native-svg';

import { colors } from '@/theme/tokens';

const PATHS = {
  inbox:
    'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
  tasks: 'M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  chat: 'M7.9 20A9 9 0 1 0 4 16.1L2 22z',
  compose: 'M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z',
  plus: 'M12 5v14M5 12h14',
  checks: 'M18 6 7 17l-5-5M22 10l-7.5 7.5L13 16',
  check: 'M20 6 9 17l-5-5',
  chevronLeft: 'm15 18-6-6 6-6',
  chevronRight: 'm9 18 6-6-6-6',
  chevronDown: 'm6 9 6 6 6-6',
  arrowLeft: 'M19 12H5M12 19l-7-7 7-7',
  close: 'M18 6 6 18M6 6l12 12',
  search: 'M21 21l-4.3-4.3M19 11a8 8 0 1 1-16 0a8 8 0 1 1 16 0',
  send: 'M22 2 11 13M22 2l-7 20-4-9-9-4z',
  mic: 'M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3',
  micOff: 'M2 2l20 20M18.89 13.23A7 7 0 0 0 19 12v-2M5 10v2a7 7 0 0 0 12 5M15 9.34V5a3 3 0 0 0-5.68-1.33M9 9v3a3 3 0 0 0 5.12 2.12M12 19v3',
  cam: 'M16 13l5.22 3.48a.5.5 0 0 0 .78-.42V7.94a.5.5 0 0 0-.76-.43L16 10.5M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z',
  camOff: 'M2 2l20 20M10.66 6H14a2 2 0 0 1 2 2v2.34l1 1L22 8v8M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2',
  phone:
    'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z',
  speaker: 'M11 5 6 9H2v6h4l5 4zM15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14',
  speakerOff: 'M11 5 6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6',
  addUser: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0a4 4 0 1 1 8 0M19 8v6M22 11h-6',
  mail: 'M2 4h20v16H2zM22 7l-10 6L2 7',
  archive: 'M2 3h20v5H2zM4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4',
  trash: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
  review: 'M13 6h3a2 2 0 0 1 2 2v7M6 9v12M21 18a3 3 0 1 1-6 0a3 3 0 1 1 6 0M9 6a3 3 0 1 1-6 0a3 3 0 1 1 6 0',
  approval:
    'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1zM9 12l2 2 4-4',
  failed: 'M22 12a10 10 0 1 1-20 0a10 10 0 1 1 20 0M9 15l6-6',
  blocked:
    'M18 11V6a2 2 0 0 0-4 0v1M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15',
  mention: 'M16 12a4 4 0 1 1-8 0a4 4 0 1 1 8 0M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8',
  done: 'M22 12a10 10 0 1 1-20 0a10 10 0 1 1 20 0M9 12l2 2 4-4',
  play: 'M8 5v14l11-7z',
  pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  git: 'M13 6h3a2 2 0 0 1 2 2v7M6 9v12M18 18a3 3 0 1 0 0.01 0M6 6a3 3 0 1 0 0.01 0',
} as const;

export type IconName = keyof typeof PATHS;

type Props = {
  name: IconName;
  size?: number;
  color?: string;
  fill?: boolean;
};

export function Icon({ name, size = 22, color = colors.chalk, fill = false }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d={PATHS[name]}
        stroke={fill ? 'none' : color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={fill ? color : 'none'}
      />
    </Svg>
  );
}
