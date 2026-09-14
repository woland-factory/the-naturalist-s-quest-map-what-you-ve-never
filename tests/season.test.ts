import { describe, expect, it } from "vitest";
import { resolveSeasonMonth } from "../server/targets.js";

// The live season is always "now": a quest stores no month and re-ranks for
// the current month every time it is built. These prove the month tracks the
// clock and rolls over at a month boundary.
describe("resolveSeasonMonth", () => {
  it("returns the current calendar month (1..12) in UTC", () => {
    const jan = Date.UTC(2026, 0, 15); // January
    const sep = Date.UTC(2026, 8, 14); // September
    const dec = Date.UTC(2026, 11, 31); // December
    expect(resolveSeasonMonth(() => jan)).toBe(1);
    expect(resolveSeasonMonth(() => sep)).toBe(9);
    expect(resolveSeasonMonth(() => dec)).toBe(12);
  });

  it("changes when the clock crosses a month boundary", () => {
    const endOfSep = Date.UTC(2026, 8, 30, 23, 59); // Sep 30
    const startOfOct = Date.UTC(2026, 9, 1, 0, 1); // Oct 1
    expect(resolveSeasonMonth(() => endOfSep)).toBe(9);
    expect(resolveSeasonMonth(() => startOfOct)).toBe(10);
  });
});
