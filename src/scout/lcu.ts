import { lcuGet, type LcuCredentials } from "../lcu/connection.ts";
import type { LcuGame } from "../lcu/history.ts";
import type { RankedEntry } from "../riot/types.ts";
import { describeRank, type PlayerProfile } from "./profile.ts";

// Fiche d'un joueur lue dans ton client LoL, sans clé Riot : rang et dernières games.

const RANKED_QUEUES = new Set([420, 440]);

interface LcuRankedQueue {
  tier?: string;
  division?: string;
  leaguePoints?: number;
  wins?: number;
  losses?: number;
}

export interface LcuRankedStats {
  queueMap?: Record<string, LcuRankedQueue>;
}

/** Rang solo/duo au format de l'API Riot, pour réutiliser la même mise en forme. */
export function rankedFromLcu(stats: LcuRankedStats): RankedEntry[] {
  const solo = stats.queueMap?.RANKED_SOLO_5x5;
  if (!solo?.tier || solo.tier === "NONE" || solo.tier === "UNRANKED") return [];
  return [
    {
      queueType: "RANKED_SOLO_5x5",
      tier: solo.tier,
      rank: solo.division && solo.division !== "NA" ? solo.division : "",
      leaguePoints: solo.leaguePoints ?? 0,
      wins: solo.wins ?? 0,
      losses: solo.losses ?? 0,
    },
  ];
}

/** Forme récente et expérience sur le champion, d'après la liste des dernières games du joueur. */
export function recentForm(games: LcuGame[], puuid: string, championId?: number): string[] {
  const mine = games
    .filter((g) => RANKED_QUEUES.has(g.queueId))
    .map((g) => {
      const id = g.participantIdentities.find((i) => i.player.puuid === puuid)?.participantId;
      return g.participants.find((p) => p.participantId === id) ?? (g.participants.length === 1 ? g.participants[0] : undefined);
    })
    .filter((p) => p !== undefined);
  const badges: string[] = [];
  if (mine.length === 0) return badges;

  if (championId) {
    const onChamp = mine.filter((p) => p.championId === championId);
    if (onChamp.length === 0) badges.push(`⚠️ pas joué ce champion sur ses ${mine.length} dernières ranked`);
    else if (onChamp.length / mine.length >= 0.6) badges.push(`★ one-trick : ${onChamp.length} de ses ${mine.length} dernières ranked`);
    else {
      const wins = onChamp.filter((p) => p.stats.win).length;
      badges.push(`${onChamp.length} ranked récentes sur ce champion (${wins} victoire(s))`);
    }
  }
  const last = mine.slice(0, 5);
  const streak = (win: boolean) => {
    let n = 0;
    for (const p of mine) {
      if (p.stats.win !== win) break;
      n++;
    }
    return n;
  };
  if (streak(true) >= 3) badges.push(`🔥 ${streak(true)} victoires d'affilée`);
  else if (streak(false) >= 3) badges.push(`😬 ${streak(false)} défaites d'affilée`);
  else if (last.length === 5) badges.push(`${last.filter((p) => p.stats.win).length}/5 sur ses dernières ranked`);
  return badges;
}

export async function puuidByRiotId(creds: LcuCredentials, gameName: string, tagLine: string): Promise<string> {
  const q = `gameName=${encodeURIComponent(gameName)}&tagLine=${encodeURIComponent(tagLine)}`;
  const r = await lcuGet<{ puuid: string }>(creds, `/lol-summoner/v1/alias/lookup?${q}`);
  return r.puuid;
}

export async function profileFromLcu(creds: LcuCredentials, puuid: string, championId?: number): Promise<PlayerProfile> {
  const [ranked, history] = await Promise.all([
    lcuGet<LcuRankedStats>(creds, `/lol-ranked/v1/ranked-stats/${puuid}`).catch(() => ({})),
    lcuGet<{ games?: { games?: LcuGame[] } }>(creds, `/lol-match-history/v1/products/lol/${puuid}/matches?begIndex=0&endIndex=20`).catch(() => ({})),
  ]);
  const r = describeRank(rankedFromLcu(ranked));
  // Les dernières games d'abord.
  const games = [...((history as { games?: { games?: LcuGame[] } }).games?.games ?? [])].sort((a, b) => b.gameCreation - a.gameCreation);
  return { rank: r.rank, record: r.record, badges: [...recentForm(games, puuid, championId), ...r.badges] };
}
