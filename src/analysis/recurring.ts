import type { GameAnalysis, Severity } from "./game.ts";

export interface RecurringIssue {
  code: string;
  severity: Severity;
  games: number;
  share: number; // part des parties concernées, 0..1
  example: string;
}

export interface Summary {
  games: number;
  wins: number;
  avgKda: number;
  avgCsDiffAt10?: number;
  avgGoldDiffAt15?: number;
  avgVisionPerMin: number;
  issues: RecurringIssue[];
  strengths: RecurringIssue[];
}

const MIN_SHARE = 0.3;

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

/** Repère ce qui revient dans au moins 30 % des parties analysées. */
export function summarise(games: GameAnalysis[]): Summary {
  const byCode = new Map<string, { severity: Severity; count: number; example: string }>();
  for (const g of games) {
    for (const f of g.findings) {
      const entry = byCode.get(f.code);
      if (entry) entry.count++;
      else byCode.set(f.code, { severity: f.severity, count: 1, example: f.text });
    }
  }
  const rank: Record<Severity, number> = { grave: 0, moyen: 1, positif: 2 };
  const all = [...byCode.entries()]
    .map(([code, e]) => ({ code, severity: e.severity, games: e.count, share: e.count / games.length, example: e.example }))
    .filter((i) => games.length > 0 && i.share >= MIN_SHARE)
    .sort((a, b) => rank[a.severity] - rank[b.severity] || b.share - a.share);

  const defined = (xs: (number | undefined)[]) => xs.filter((x): x is number => x !== undefined);
  return {
    games: games.length,
    wins: games.filter((g) => g.win).length,
    avgKda: avg(games.map((g) => (g.kda.kills + g.kda.assists) / Math.max(1, g.kda.deaths))) ?? 0,
    avgCsDiffAt10: avg(defined(games.map((g) => g.stats.lane.csDiffAt10))),
    avgGoldDiffAt15: avg(defined(games.map((g) => g.stats.lane.goldDiffAt15))),
    avgVisionPerMin: avg(games.map((g) => g.stats.lane.visionPerMin)) ?? 0,
    issues: all.filter((i) => i.severity !== "positif"),
    strengths: all.filter((i) => i.severity === "positif"),
  };
}
