/** One authoritative game clock: two complete table rounds per season. */
export const SEASONS = ["春", "夏", "秋", "冬"] as const;
export function gameCalendar(round: number) {
  const elapsed = Math.max(0, round - 1);
  const seasonIndex = Math.floor(elapsed / 2) % 4;
  return {
    year: Math.floor(elapsed / 8) + 1,
    seasonIndex,
    season: SEASONS[seasonIndex],
    roundInSeason: (elapsed % 2) + 1,
    roundsUntilSeason: 2 - (elapsed % 2),
  };
}
/** Annual cash dividend per share in yuan; numeric value also equals ledger units per 1000-share lot. */
export const DIVIDENDS = [
  { season: 0, perShare: 1 },
  { season: 0, perShare: 2 },
  { season: 1, perShare: 2 },
  { season: 1, perShare: 3 },
  { season: 2, perShare: 1 },
  { season: 3, perShare: 2 },
] as const;
export function stockQuote(lotPrice: number): string {
  return `${lotPrice.toLocaleString("zh-TW")} 元／股`;
}
