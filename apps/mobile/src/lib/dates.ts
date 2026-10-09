const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function parseDay(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const date = parseDay(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDay(date);
}

export function weekday(iso: string): string {
  return WEEKDAYS[parseDay(iso).getUTCDay()] ?? '';
}

export function monthShort(iso: string): string {
  return (MONTHS[parseDay(iso).getUTCMonth()] ?? '').slice(0, 3);
}

export function monthDay(iso: string): number {
  return parseDay(iso).getUTCDate();
}

export function weekLabel(start: string): string {
  const end = addDays(start, 6);
  const startMonth = monthShort(start);
  const endMonth = monthShort(end);
  if (startMonth === endMonth) {
    return `${startMonth} ${monthDay(start)} – ${monthDay(end)}, ${parseDay(end).getUTCFullYear()}`;
  }
  return `${startMonth} ${monthDay(start)} – ${endMonth} ${monthDay(end)}`;
}

export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}
