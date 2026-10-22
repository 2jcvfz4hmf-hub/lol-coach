import { analyseGame, isPlayable, type GameAnalysis } from "./analysis/game.ts";
import { summarise } from "./analysis/recurring.ts";
import { buildPool, type PoolStats } from "./draft/pool.ts";
import { gameReport, summaryReport } from "./report/fr.ts";
import type { RiotClient } from "./riot/client.ts";
import type { Match } from "./riot/types.ts";

// Enchaînements communs à la ligne de commande et à l'app PC.

export async function analyseRecent(
  riot: RiotClient,
  puuid: string,
  count: number,
  type = "ranked",
  onProgress?: (done: number, total: number) => void,
): Promise<GameAnalysis[]> {
  const ids = await riot.matchIds(puuid, count, type);
  const games: GameAnalysis[] = [];
  for (const [i, id] of ids.entries()) {
    onProgress?.(i + 1, ids.length);
    const [match, timeline] = await Promise.all([riot.match(id), riot.timeline(id)]);
    if (isPlayable(match)) games.push(analyseGame(match, timeline, puuid));
  }
  return games;
}

export function fullReport(name: string, games: GameAnalysis[]): string {
  return [summaryReport(name, summarise(games)), "## Détail partie par partie", ...games.map(gameReport)].join("\n\n");
}

/** Pool de champions sur les dernières parties (sans les timelines, plus rapide). */
export async function loadPool(riot: RiotClient, puuid: string, count = 40): Promise<PoolStats> {
  const ids = await riot.matchIds(puuid, count, "ranked");
  const matches: Match[] = [];
  for (const id of ids) {
    const m = await riot.match(id);
    if (isPlayable(m)) matches.push(m);
  }
  return buildPool(matches, puuid);
}

/** Analyse de la dernière partie jouée, ou undefined si elle a déjà été analysée. */
export async function analyseLatest(riot: RiotClient, puuid: string, alreadySeen?: string): Promise<{ matchId: string; report: string } | undefined> {
  const [id] = await riot.matchIds(puuid, 1, "");
  if (!id || id === alreadySeen) return undefined;
  const [match, timeline] = await Promise.all([riot.match(id), riot.timeline(id)]);
  if (!isPlayable(match)) return { matchId: id, report: "Partie trop courte (remake), pas d'analyse." };
  return { matchId: id, report: gameReport(analyseGame(match, timeline, puuid)) };
}
