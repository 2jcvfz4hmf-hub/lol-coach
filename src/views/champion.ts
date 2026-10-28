import type { ChampionInfo, ItemIndex, RuneIndex } from "../data/ddragon.ts";
import { buildForClass, type BuildAdvice } from "../draft/global.ts";
import type { CompClass, GlobalStats, WL } from "../global/stats.ts";

// Page d'un champion : postes, counters, duos et builds selon la compo d'en face.

export interface MatchupRow {
  championId: number;
  games: number;
  winrate: number; // winrate du champion de la page dans ce matchup
  delta: number; // écart avec son winrate moyen
}

export interface ChampionDetail {
  positions: { position: string; games: number; winrate: number }[];
  position?: string;
  games: number;
  winrate: number;
  /** Adversaires de lane contre qui il gagne le plus, et le moins. */
  bestMatchups: MatchupRow[];
  worstMatchups: MatchupRow[];
  synergies: MatchupRow[];
  builds: { against: CompClass; build: BuildAdvice }[];
}

const MIN_MATCHUP = 20;

function rows(table: Record<string, WL> | undefined, base: number): MatchupRow[] {
  return Object.entries(table ?? {})
    .filter(([, r]) => r.g >= MIN_MATCHUP)
    .map(([id, r]) => ({ championId: Number(id), games: r.g, winrate: r.w / r.g, delta: (r.w - r.g * base) / (r.g + 50) }));
}

export function championDetail(
  stats: GlobalStats,
  champion: ChampionInfo,
  items: ItemIndex,
  runes: RuneIndex,
  position?: string,
  limit = 5,
): ChampionDetail {
  const positions = Object.entries(stats.champs)
    .map(([pos, t]) => ({ position: pos, games: t[champion.id]?.g ?? 0, winrate: t[champion.id] ? t[champion.id]!.w / t[champion.id]!.g : 0 }))
    .filter((p) => p.games > 0)
    .sort((a, b) => b.games - a.games);
  const pos = position && positions.some((p) => p.position === position) ? position : positions[0]?.position;
  const record = pos ? stats.champs[pos]?.[champion.id] : undefined;
  const base = record ? record.w / record.g : 0.5;

  const lane = rows(pos ? stats.lane[pos]?.[champion.id] : undefined, base).sort((a, b) => b.delta - a.delta);
  const synergies = rows(stats.with[champion.id], base)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, limit);

  const builds = (["AD", "AP", "mixte"] as const)
    .map((against) => ({ against, build: buildForClass(stats, champion, against, items, runes) }))
    .filter((b): b is { against: CompClass; build: BuildAdvice } => !!b.build);

  return {
    positions,
    position: pos,
    games: record?.g ?? 0,
    winrate: base,
    bestMatchups: lane.slice(0, limit),
    worstMatchups: lane.slice(-limit).reverse(),
    synergies,
    builds,
  };
}
