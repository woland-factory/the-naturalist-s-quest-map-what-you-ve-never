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
