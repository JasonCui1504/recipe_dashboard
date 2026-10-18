/** Date helpers for the meal planner. All dates are local calendar days as YYYY-MM-DD. */

const pad = (n: number) => String(n).padStart(2, '0');

export function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12); // noon avoids DST edge cases
}

export function isValidIsoDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  return toIsoDate(parseIsoDate(iso)) === iso;
}

export function addDays(iso: string, days: number): string {
  const d = parseIsoDate(iso);
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

/** Monday of the week containing `iso`. */
export function startOfWeek(iso: string): string {
  const d = parseIsoDate(iso);
  const offset = (d.getDay() + 6) % 7; // Monday = 0
  return addDays(iso, -offset);
}

export function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

export function formatDay(iso: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }): string {
  return parseIsoDate(iso).toLocaleDateString(undefined, opts);
}

export function formatWeekRange(weekStart: string): string {
  const a = parseIsoDate(weekStart);
  const b = parseIsoDate(addDays(weekStart, 6));
  const month = (d: Date) => d.toLocaleDateString(undefined, { month: 'long' });
  if (a.getFullYear() !== b.getFullYear()) {
    return `${month(a)} ${a.getDate()}, ${a.getFullYear()} – ${month(b)} ${b.getDate()}, ${b.getFullYear()}`;
  }
  if (a.getMonth() !== b.getMonth()) {
    return `${month(a)} ${a.getDate()} – ${month(b)} ${b.getDate()}, ${b.getFullYear()}`;
  }
  return `${month(a)} ${a.getDate()} – ${b.getDate()}, ${b.getFullYear()}`;
}
