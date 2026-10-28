import { analyseGame, isPlayable, type GameAnalysis } from "./analysis/game.ts";
import { summarise } from "./analysis/recurring.ts";
import { buildPool, type PoolStats } from "./draft/pool.ts";
import { gameReport, summaryReport } from "./report/fr.ts";
import type { RiotClient } from "./riot/client.ts";
import type { Match, Timeline } from "./riot/types.ts";

// Enchaînements communs à la ligne de commande (API Riot) et à l'app PC
// (client LoL), qui fournissent les parties chacun à leur façon.

export interface GameSource {
  /** Identifiants des dernières parties, de la plus récente à la plus ancienne. */
  recentGameIds(count: number, rankedOnly: boolean): Promise<string[]>;
  match(id: string): Promise<Match>;
  timeline(id: string): Promise<Timeline>;
}

export function riotSource(riot: RiotClient, puuid: string, type = "ranked"): GameSource {
  return {
    recentGameIds: (count, rankedOnly) => riot.matchIds(puuid, count, rankedOnly ? type : ""),
    match: (id) => riot.match(id),
    timeline: (id) => riot.timeline(id),
  };
}

export async function analyseRecent(
  source: GameSource,
  puuid: string,
  count: number,
  onProgress?: (done: number, total: number) => void,
): Promise<GameAnalysis[]> {
  const ids = await source.recentGameIds(count, true);
  const games: GameAnalysis[] = [];
  for (const [i, id] of ids.entries()) {
    onProgress?.(i + 1, ids.length);
    const [match, timeline] = await Promise.all([source.match(id), source.timeline(id)]);
    if (isPlayable(match)) games.push(analyseGame(match, timeline, puuid));
  }
  return games;
}

export function fullReport(name: string, games: GameAnalysis[]): string {
  return [summaryReport(name, summarise(games)), "## Détail partie par partie", ...games.map(gameReport)].join("\n\n");
}

/** Pool de champions sur les dernières parties (sans les timelines, plus rapide). */
export async function loadPool(source: GameSource, puuid: string, count = 40): Promise<PoolStats> {
  const ids = await source.recentGameIds(count, true);
  const matches: Match[] = [];
  for (const id of ids) {
    const m = await source.match(id);
    if (isPlayable(m)) matches.push(m);
  }
  return buildPool(matches, puuid);
}

/** Analyse de la dernière partie jouée, ou undefined si elle a déjà été analysée. */
export async function analyseLatest(
  source: GameSource,
  puuid: string,
  alreadySeen?: string,
): Promise<{ matchId: string; report: string; score?: number } | undefined> {
  const [id] = await source.recentGameIds(1, false);
  if (!id || id === alreadySeen) return undefined;
  const [match, timeline] = await Promise.all([source.match(id), source.timeline(id)]);
  if (!isPlayable(match)) return { matchId: id, report: "Partie trop courte (remake), pas d'analyse." };
  const g = analyseGame(match, timeline, puuid);
  return { matchId: id, report: gameReport(g), score: g.score.score };
}
