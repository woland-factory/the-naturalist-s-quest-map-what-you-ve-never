export const MONTHS: { value: number; label: string }[] = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

export function monthLabel(value: number): string {
  return MONTHS.find((m) => m.value === value)?.label ?? "";
}

// Format a YYYY-MM-DD date as "September 3, 2026". Parsed from the string
// parts, not through Date, so a local timezone never shifts the day.
export function formatIsoDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  const [, year, month, day] = match;
  const label = monthLabel(Number(month));
  if (!label) return iso;
  return `${label} ${Number(day)}, ${year}`;
}

// Format a millisecond timestamp the same human-readable way, in UTC so it
// matches how the season month is resolved.
export function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  return `${monthLabel(d.getUTCMonth() + 1)} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

// The simple week of year in UTC (1..53), matching iNat's week_of_year
// buckets closely enough to highlight "this week" on the indicator: day of
// year divided into 7-day windows from January 1.
export function weekOfYear(dateMs: number): number {
  const d = new Date(dateMs);
  const utcMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const jan1 = Date.UTC(d.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((utcMidnight - jan1) / 86_400_000) + 1;
  return Math.min(53, Math.floor((dayOfYear - 1) / 7) + 1);
}

// Month (1..12) of a week's representative date, so a peak week maps to a
// month name for the caption. Uses a fixed non-leap year; the drift is at
// most a day and never changes the label meaningfully.
export function monthOfWeek(week: number): number {
  const d = new Date(Date.UTC(2001, 0, 1 + (week - 1) * 7));
  return d.getUTCMonth() + 1;
}
