import type { Match } from "../riot/types.ts";

// Ton pool de champions et tes résultats contre chaque champion adverse,
// calculés à partir de tes dernières parties.

export interface MatchupRecord {
  games: number;
  wins: number;
}

export interface PoolEntry extends MatchupRecord {
  champion: string; // nom technique en minuscules (Match-V5 et Data Dragon diffèrent parfois sur la casse)
  kills: number;
  deaths: number;
  assists: number;
  positions: Record<string, number>;
}

export interface PoolStats {
  champions: Map<string, PoolEntry>;
  /** Résultats quand ce champion était dans l'équipe adverse. */
  against: Map<string, MatchupRecord>;
}

export const normalize = (championKey: string) => championKey.toLowerCase();

export function buildPool(matches: Match[], puuid: string): PoolStats {
  const champions = new Map<string, PoolEntry>();
  const against = new Map<string, MatchupRecord>();
  for (const m of matches) {
    const me = m.info.participants.find((p) => p.puuid === puuid);
    if (!me) continue;
    const key = normalize(me.championName);
    const e = champions.get(key) ?? { champion: key, games: 0, wins: 0, kills: 0, deaths: 0, assists: 0, positions: {} };
    e.games++;
    if (me.win) e.wins++;
    e.kills += me.kills;
    e.deaths += me.deaths;
    e.assists += me.assists;
    if (me.teamPosition) e.positions[me.teamPosition] = (e.positions[me.teamPosition] ?? 0) + 1;
    champions.set(key, e);

    for (const p of m.info.participants) {
      if (p.teamId === me.teamId) continue;
      const k = normalize(p.championName);
      const r = against.get(k) ?? { games: 0, wins: 0 };
      r.games++;
      if (me.win) r.wins++;
      against.set(k, r);
    }
  }
  return { champions, against };
}
