import type { ChampionInfo, ItemIndex, RuneIndex } from "../data/ddragon.ts";
import { buildForClass, type BuildAdvice } from "../draft/global.ts";
import type { CompClass, GlobalStats, WL } from "../global/stats.ts";
import { skillSequence } from "../global/skills.ts";

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
  skillOrder?: SkillOrder;
  runePage?: RunePage;
}

export interface RunePage {
  key: string;
  primary: number;
  primaryRunes: number[];
  secondary: number;
  secondaryRunes: number[];
  shards: number[];
  games: number;
  winrate: number;
  pick: number;
}

/** La page de runes la plus jouée sur ce champion (au moins 20 parties). */
export function runePage(stats: GlobalStats, championId: number): RunePage | undefined {
  const table = stats.pages?.[championId];
  if (!table) return undefined;
  const total = Object.values(table).reduce((s, r) => s + r.g, 0);
  const [key, r] = Object.entries(table).sort((a, b) => b[1].g - a[1].g)[0] ?? [];
  if (!key || !r || r.g < 20) return undefined;
  const [main = "", sub = "", shards = ""] = key.split("|");
  const [p, pr = ""] = main.split(":");
  const [s, sr = ""] = sub.split(":");
  const nums = (x: string) => x.split(",").filter(Boolean).map(Number);
  return {
    key,
    primary: Number(p),
    primaryRunes: nums(pr),
    secondary: Number(s),
    secondaryRunes: nums(sr),
    shards: nums(shards),
    games: r.g,
    winrate: r.w / r.g,
    pick: r.g / total,
  };
}

export interface SkillOrder {
  key: string; // « QEW|QEW »
  levels: string[]; // 18 niveaux
  games: number;
  winrate: number;
  /** Part des parties où cet ordre est choisi. */
  pick: number;
}

/** L'ordre des sorts le plus joué sur ce champion (au moins 20 parties). */
export function skillOrder(stats: GlobalStats, championId: number): SkillOrder | undefined {
  const table = stats.skills?.[championId];
  if (!table) return undefined;
  const total = Object.values(table).reduce((s, r) => s + r.g, 0);
  const [key, r] = Object.entries(table).sort((a, b) => b[1].g - a[1].g)[0] ?? [];
  if (!key || !r || r.g < 20) return undefined;
  return { key, levels: skillSequence(key), games: r.g, winrate: r.w / r.g, pick: r.g / total };
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
    skillOrder: skillOrder(stats, champion.id),
    runePage: runePage(stats, champion.id),
  };
}
