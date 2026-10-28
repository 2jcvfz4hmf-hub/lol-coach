import type { GlobalStats } from "../global/stats.ts";

// Tier list par poste, d'après les stats du serveur.

export type Tier = "S" | "A" | "B" | "C" | "D";

export interface TierRow {
  championId: number;
  tier: Tier;
  winrate: number;
  pickrate: number;
  games: number;
}

const MIN_PICKRATE = 0.005;

/** Winrate ramené vers 50 % tant qu'il y a peu de parties, pour ne pas classer S un champion vu 10 fois. */
const smoothed = (w: number, g: number) => (w + 50) / (g + 100);

export function tierOf(winrate: number): Tier {
  if (winrate >= 0.525) return "S";
  if (winrate >= 0.51) return "A";
  if (winrate >= 0.495) return "B";
  if (winrate >= 0.48) return "C";
  return "D";
}

export function tierList(stats: GlobalStats, position: string): TierRow[] {
  const table = stats.champs[position] ?? {};
  return Object.entries(table)
    .map(([id, r]) => ({ championId: Number(id), winrate: r.w / r.g, pickrate: r.g / Math.max(1, stats.games), games: r.g, score: smoothed(r.w, r.g) }))
    .filter((r) => r.pickrate >= MIN_PICKRATE)
    .sort((a, b) => b.score - a.score)
    .map(({ score, ...r }) => ({ ...r, tier: tierOf(score) }));
}
