import { monthLabel, monthOfWeek, weekOfYear } from "../months.js";

// The compact week-of-year indicator: 53 thin bars, the current week
// highlighted, a two-word Peak caption. It is an enhancement on the top
// target cards, so it is silent (renders nothing) when there is no data,
// and holds layout with a skeleton strip while the batch loads.

export function Seasonality({ weeks, nowMs, loading }: { weeks?: number[] | null; nowMs: number; loading?: boolean }) {
  if (weeks === undefined || weeks === null) {
    if (loading) return <div className="seasonality seasonality-skeleton skeleton-box" aria-hidden="true" />;
    return null;
  }

  const max = Math.max(...weeks);
  if (max <= 0) return null;

  const peakWeek = weeks.indexOf(max) + 1;
  const peakMonth = monthLabel(monthOfWeek(peakWeek));
  const currentWeek = weekOfYear(nowMs);
  const goodWeek = weeks[currentWeek - 1] >= max / 2;
  const label = goodWeek
    ? `Seen most often in ${peakMonth} here. This is a good week to look.`
    : `Seen most often in ${peakMonth} here. Quieter this week.`;

  return (
    <div className="seasonality" role="img" aria-label={label}>
      <div className="seasonality-track" aria-hidden="true">
        {weeks.map((count, i) => {
          const height = count > 0 ? Math.max(1, Math.round((count / max) * 22)) : 0;
          const isNow = i + 1 === currentWeek;
          return (
            <span key={i} className={isNow ? "season-bar now" : "season-bar"} style={{ height: `${height}px` }} />
          );
        })}
      </div>
      <span className="seasonality-caption" aria-hidden="true">
        Peak {peakMonth}
      </span>
    </div>
  );
}
