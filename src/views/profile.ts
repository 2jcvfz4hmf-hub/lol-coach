import type { GameAnalysis } from "../analysis/game.ts";
import type { Match } from "../riot/types.ts";

// Profil façon dpm.lol : dernières games avec leur note, et stats par champion.

export const QUEUE_FR: Record<number, string> = {
  420: "Solo/Duo",
  440: "Flex",
  400: "Normale",
  430: "Normale",
  490: "Rapide",
  700: "Clash",
};

export interface GameRow {
  matchId: string;
  champion: string; // nom technique Match-V5 (« MonkeyKing »)
  opponent?: string;
  position: string;
  queue: string;
  win: boolean;
  kills: number;
  deaths: number;
  assists: number;
  cs: number;
  durationMin: number;
  date: number;
  score?: number;
}

export interface ChampRow {
  champion: string;
  games: number;
  wins: number;
  kda: number;
  avgScore?: number;
}

export function gameRow(match: Match, puuid: string, analysis?: GameAnalysis): GameRow | undefined {
  const me = match.info.participants.find((p) => p.puuid === puuid);
  if (!me) return undefined;
  const opponent = match.info.participants.find((p) => p.teamId !== me.teamId && p.teamPosition && p.teamPosition === me.teamPosition);
  return {
    matchId: match.metadata.matchId,
    champion: me.championName,
    opponent: opponent?.championName,
    position: me.teamPosition,
    queue: QUEUE_FR[match.info.queueId] ?? "Autre",
    win: me.win,
    kills: me.kills,
    deaths: me.deaths,
    assists: me.assists,
    cs: me.totalMinionsKilled + me.neutralMinionsKilled,
    durationMin: match.info.gameDuration / 60,
    date: match.info.gameCreation,
    score: analysis?.score.score,
  };
}

export function champRows(games: GameRow[]): ChampRow[] {
  const by = new Map<string, GameRow[]>();
  for (const g of games) by.set(g.champion, [...(by.get(g.champion) ?? []), g]);
  return [...by.entries()]
    .map(([champion, gs]) => {
      const k = gs.reduce((s, g) => s + g.kills + g.assists, 0);
      const d = gs.reduce((s, g) => s + g.deaths, 0);
      const scored = gs.filter((g) => g.score !== undefined);
      return {
        champion,
        games: gs.length,
        wins: gs.filter((g) => g.win).length,
        kda: k / Math.max(1, d),
        avgScore: scored.length ? scored.reduce((s, g) => s + g.score!, 0) / scored.length : undefined,
      };
    })
    .sort((a, b) => b.games - a.games);
}
